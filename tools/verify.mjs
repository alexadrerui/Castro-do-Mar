// Image regression check (idea from Makone's harness/verify.mjs, MIT): measures every preset view
// and compares it with a saved baseline, so a frame that goes wrong without any console error
// (the white sky of a cold load, a black pass, washed-out colour) fails on its own.
//   node tools/verify.mjs [views...] [--cold | --warm] [--update] [--params=a=1&b=2]
// Runs a cold load (empty IndexedDB and shader cache) and then a reload with the caches, unless
// --cold / --warm picks one. Per view: luma mean and spread, chroma, the colour of the top band
// (the sky in most views), and the share of clipped white / crushed black pixels.
// --update writes the measurements as the new baseline (tools/verify.baseline.json); write it from
// a known-good build.
// Frames land in shots/verify_<cold|warm>_<view>.png. Exit code 1 when something is off.
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const args = process.argv.slice( 2 );
const update = args.includes( '--update' );
const modes = args.includes( '--cold' ) ? [ 'cold' ] : args.includes( '--warm' ) ? [ 'warm' ] : [ 'cold', 'warm' ];
const extra = ( args.find( ( a ) => a.startsWith( '--params=' ) ) || '' ).slice( 9 );
const views = args.filter( ( a ) => ! a.startsWith( '--' ) ).map( Number );
const BASE = 'tools/verify.baseline.json';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// allowed drift from the baseline (0..255 scales; clip / black are fractions). Clouds, water,
// birds and smoke move, so a frame never repeats exactly.
const TOL = { luma: 12, spread: 10, chroma: 10, clip: 0.04, black: 0.04, sky: 25 };
// The top band of a view that shows sky: its blueness (blue - red) is compared as the mean over
// those views, one-sided. Clouds move and change the band of any single view a lot, but a broken
// sky (the white sky of a cold load) takes the blue out of every view at once.
const SKY_LUMA = 110; // a top band this bright is sky, not ground (the aerial view)
const blueness = ( top ) => top[ 2 ] - top[ 0 ];
const skyMean = ( vs ) => { const s = vs.filter( ( v ) => 0.2126 * v.top[ 0 ] + 0.7152 * v.top[ 1 ] + 0.0722 * v.top[ 2 ] > SKY_LUMA || blueness( v.top ) > 20 ); return s.length ? s.reduce( ( a, v ) => a + blueness( v.top ), 0 ) / s.length : null; };
// absolute sanity, baseline or not
const SANE = { lumaMin: 25, lumaMax: 225, chromaMin: 8, clipMax: 0.25, blackMax: 0.25 };
const IGNORE = /maxLeafSize|powerPreference|crbug\.com\/369219127/;

const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
let precompile = null;
page.on( 'console', ( m ) => {
	const t = m.text();
	if ( t.startsWith( 'precompile done' ) ) precompile = t;
	if ( m.type() === 'error' && ! IGNORE.test( t ) ) errors.push( t.slice( 0, 300 ) );
} );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + String( e ).slice( 0, 300 ) ) );

const url = 'http://localhost:5190/?auto' + ( extra ? '&' + extra : '' );
const measure = async ( mode ) => {
	errors.length = 0; precompile = null;
	const t0 = Date.now();
	await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 250 } );
	const ready = ( Date.now() - t0 ) / 1000;
	const out = await page.evaluate( async ( mode, list ) => {
		const a = window.__app;
		a.dynamicRes = false;
		// the focus (depth of field) stays as the user gets it: the white sky of a cold load only
		// showed through its output
		const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
		const ids = list.length ? list : a.views.map( ( _, i ) => i );
		const res = [];
		for ( const i of ids ) {
			a.setView( i );
			await sleep( 1500 );
			await a.capture( `verify_${ mode }_${ i }` );
			const bmp = await createImageBitmap( a.lastCaptureBlob );
			const W = 320, H = 180;
			const c = new OffscreenCanvas( W, H ), g = c.getContext( '2d' );
			g.drawImage( bmp, 0, 0, W, H );
			const d = g.getImageData( 0, 0, W, H ).data;
			let sl = 0, sl2 = 0, sc = 0, clip = 0, black = 0;
			const top = [ 0, 0, 0 ]; let nTop = 0;
			for ( let p = 0, k = 0; p < d.length; p += 4, k ++ ) {
				const r = d[ p ], gg = d[ p + 1 ], b = d[ p + 2 ];
				const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
				sl += l; sl2 += l * l; sc += Math.max( r, gg, b ) - Math.min( r, gg, b );
				if ( l > 250 ) clip ++;
				if ( l < 6 ) black ++;
				if ( k < W * Math.round( H * 0.08 ) ) { top[ 0 ] += r; top[ 1 ] += gg; top[ 2 ] += b; nTop ++; }
			}
			const n = W * H, mean = sl / n;
			res.push( {
				view: i, label: a.views[ i ].label,
				luma: +mean.toFixed( 1 ), spread: +Math.sqrt( Math.max( 0, sl2 / n - mean * mean ) ).toFixed( 1 ),
				chroma: +( sc / n ).toFixed( 1 ), top: top.map( ( v ) => Math.round( v / nTop ) ),
				clip: +( clip / n ).toFixed( 3 ), black: +( black / n ).toFixed( 3 )
			} );
		}
		return res;
	}, mode, views );
	return { ready, precompile, errors: [ ...errors ], views: out };
};

const results = {};
for ( const mode of modes ) {
	if ( mode === 'cold' || ! results.cold ) {
		// the first navigation of a fresh profile is the cold load: IndexedDB and the shader cache
		// are empty. (Clearing IndexedDB and reloading is not: the first, cut-short load has
		// already filled the shader cache, and the white sky of a cold load did not show.)
		await page.goto( url, { waitUntil: 'domcontentloaded' } );
		if ( mode === 'warm' ) {
			// warm only: fill the caches with one load first
			await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 250 } );
			await new Promise( ( r ) => setTimeout( r, 4000 ) );
			await page.reload( { waitUntil: 'domcontentloaded' } );
		}
	} else {
		await new Promise( ( r ) => setTimeout( r, 4000 ) ); // the background cache writes
		await page.reload( { waitUntil: 'domcontentloaded' } );
	}
	results[ mode ] = await measure( mode );
}
await browser.close();

// ---- compare
const base = fs.existsSync( BASE ) ? JSON.parse( fs.readFileSync( BASE, 'utf8' ) ) : null;
const problems = [];
for ( const [ mode, r ] of Object.entries( results ) ) {
	console.log( `\n${ mode }: ready in ${ r.ready.toFixed( 1 ) } s; ${ r.precompile || 'precompile did NOT finish within the limit' }` );
	for ( const e of r.errors ) problems.push( `${ mode}: console: ${ e }` );
	for ( const v of r.views ) {
		const ref = base?.views?.[ v.view ];
		const bad = [];
		if ( v.luma < SANE.lumaMin || v.luma > SANE.lumaMax ) bad.push( `luma ${ v.luma } out of ${ SANE.lumaMin }..${ SANE.lumaMax }` );
		if ( v.chroma < SANE.chromaMin ) bad.push( `chroma ${ v.chroma } (washed out)` );
		if ( v.clip > SANE.clipMax ) bad.push( `clip ${ v.clip }` );
		if ( v.black > SANE.blackMax ) bad.push( `black ${ v.black }` );
		if ( ref ) {
			for ( const k of [ 'luma', 'spread', 'chroma' ] ) if ( Math.abs( v[ k ] - ref[ k ] ) > TOL[ k ] ) bad.push( `${ k } ${ v[ k ] } (baseline ${ ref[ k ] })` );
			for ( const k of [ 'clip', 'black' ] ) if ( v[ k ] - ref[ k ] > TOL[ k ] ) bad.push( `${ k } ${ v[ k ] } (baseline ${ ref[ k ] })` );
		}
		console.log( `  ${ bad.length ? 'FAIL' : 'ok  ' } view ${ v.view } ${ ( v.label || '' ).padEnd( 12 ) } luma ${ v.luma } spread ${ v.spread } chroma ${ v.chroma } top rgb(${ v.top }) clip ${ v.clip } black ${ v.black }` );
		for ( const b of bad ) { console.log( `         ${ b }` ); problems.push( `${ mode } view ${ v.view }: ${ b }` ); }
	}
	// the sky, over all the views that show it
	const sky = skyMean( r.views );
	if ( sky !== null ) {
		const refSky = base ? skyMean( r.views.map( ( v ) => base.views[ v.view ] ).filter( Boolean ) ) : null;
		const low = sky < 0 || ( refSky !== null && sky < refSky - TOL.sky );
		console.log( `  ${ low ? 'FAIL' : 'ok  ' } sky blueness (blue - red of the top band, mean of the sky views) ${ sky.toFixed( 1 ) }${ refSky !== null ? ` (baseline ${ refSky.toFixed( 1 ) })` : '' }` );
		if ( low ) problems.push( `${ mode }: the sky lost its blue (${ sky.toFixed( 1 ) }${ refSky !== null ? `, baseline ${ refSky.toFixed( 1 ) }` : '' })` );
	}
}
// cold and warm must look alike (the cache paths had their own bugs)
if ( results.cold && results.warm ) {
	for ( const c of results.cold.views ) {
		const w = results.warm.views.find( ( x ) => x.view === c.view );
		if ( w && Math.abs( c.luma - w.luma ) > TOL.luma ) problems.push( `view ${ c.view }: cold and warm differ (luma ${ c.luma } / ${ w.luma })` );
	}
	const sc = skyMean( results.cold.views ), sw = skyMean( results.warm.views );
	if ( sc !== null && sw !== null && Math.abs( sc - sw ) > TOL.sky ) problems.push( `cold and warm skies differ (blueness ${ sc.toFixed( 1 ) } / ${ sw.toFixed( 1 ) })` );
}

if ( update ) {
	const src = results.cold || results.warm;
	const out = { note: 'tools/verify.mjs baseline: per-view image statistics of a known-good build', date: new Date().toISOString().slice( 0, 10 ), views: { ...( base?.views || {} ) } };
	for ( const v of src.views ) out.views[ v.view ] = v;
	fs.writeFileSync( BASE, JSON.stringify( out, null, '\t' ) + '\n' );
	console.log( `\nbaseline written: ${ BASE }` );
}
if ( ! base && ! update ) console.log( '\nno baseline yet: run with --update on a known-good build' );
console.log( problems.length ? `\nFAIL (${ problems.length })` : '\nOK' );
for ( const p of problems ) console.log( '  - ' + p );
process.exit( problems.length && ! update ? 1 : 0 );
