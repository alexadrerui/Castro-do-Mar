// QA for diving: finds open water off the coast, captures the underwater view, surfaces and
// captures the water drops on the lens a moment later and a few seconds later.
//   node tools/dive.mjs [prefix]   -> shots/<prefix>_under.png, _wet0.png, _wet1.png, _dry.png
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'dive';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE,
	headless: 'new',
	protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( m.type() === 'error' || ( m.type() === 'warn' && ! /maxLeafSize|powerPreference/.test( m.text() ) ) ) console.log( '[page]', m.type(), m.text().slice( 0, 400 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 400 ) ) );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 240000, polling: 1000 } );

const out = await page.evaluate( async ( prefix ) => {
	const a = window.__app;
	a.dynamicRes = false;
	// open water: walk east from the village until the bottom is 6+ m deep
	let x = 0, z = 0, g = 0;
	for ( x = 40; x < 2000; x += 10 ) { g = a.hf.heightAt( x, z ); if ( g < - 6 ) break; }
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	const view = ( pos, target ) => { a.views.push( { label: 'qa', pos, target } ); a.setView( a.views.length - 1 ); a.views.pop(); };
	const res = { spot: [ x, z, +g.toFixed( 1 ) ] };
	// seabed spots: a rocky one (steep bottom) and a sandy one (flat), 2-8 m deep, near the spot
	const spots = [];
	for ( const want of [ 'rock', 'sand' ] ) {
		let best = null;
		for ( let k = 0; k < 4000 && ! best; k ++ ) {
			const px = x - 150 + Math.random() * 300, pz = z - 150 + Math.random() * 300;
			const h = a.hf.heightAt( px, pz ), sl = a.hf.slopeAt( px, pz );
			if ( h > - 8 && h < - 2.5 && ( want === 'rock' ? sl > 0.3 : sl < 0.05 ) ) best = [ px, pz ];
		}
		if ( best ) spots.push( best );
	}
	// looking back toward the shore, slightly up
	view( [ x, - 2.5, z ], [ x - 60, 4, z ] );
	await sleep( 600 );
	await sleep( 2500 ); // let the seabed tiles stream in
	res.under = { on: a.underwater.on.value, depth: +a.underwater.depth.value.toFixed( 2 ), seabed: { ...a.seabed.stats } };
	await a.capture( prefix + '_under' );
	// looking up at the surface from below (Snell's window), then at shallow sand (caustics)
	a.setFocus?.( false );
	view( [ x, - 3, z ], [ x - 2, 6, z + 1 ] );
	await sleep( 800 );
	await a.capture( prefix + '_up' );
	{
		// shallow, flat sand 2 - 3.5 m deep near the spot (the depth of field off for a sharp look)
		let sx = x, sz = z;
		for ( let k = 0; k < 6000; k ++ ) { const tx = x - 250 + Math.random() * 500, tz = z - 250 + Math.random() * 500; const h = a.hf.heightAt( tx, tz ); if ( h > - 3.5 && h < - 2 && a.hf.slopeAt( tx, tz ) < 0.1 ) { sx = tx; sz = tz; break; } }
		a.setFocus?.( false );
		const gs = a.hf.heightAt( sx, sz );
		view( [ sx + 3, gs + 1.6, sz ], [ sx - 2, gs, sz ] );
		await sleep( 800 );
		res.caustics = { at: [ +sx.toFixed( 1 ), +gs.toFixed( 1 ) ] };
		await a.capture( prefix + '_caust' );
		a.setFocus?.( true );
	}
	// close to the bottom, looking down and ahead (seabed life)
	for ( const [ i, [ bx, bz ] ] of spots.entries() ) {
		const gb = a.hf.heightAt( bx, bz );
		view( [ bx, gb + 2.2, bz ], [ bx - 7, gb + 0.3, bz + 2 ] );
		await sleep( 2500 );
		res[ 'bed' + i ] = { at: [ bx, bz, +gb.toFixed( 1 ) ], seabed: { ...a.seabed.stats } };
		await a.capture( prefix + '_bed' + i );
	}
	// surface: same spot, above the water
	view( [ x, 1.6, z ], [ x - 60, 4, z ] );
	await sleep( 700 );
	res.wet0 = { wet: +a.lens.wet.value.toFixed( 2 ), age: +a.lens.age.value.toFixed( 2 ) };
	await a.capture( prefix + '_wet0' );
	await sleep( 3500 );
	res.wet1 = { wet: +a.lens.wet.value.toFixed( 2 ), age: +a.lens.age.value.toFixed( 2 ) };
	await a.capture( prefix + '_wet1' );
	await sleep( 7000 );
	res.dry = { wet: +a.lens.wet.value.toFixed( 2 ) };
	await a.capture( prefix + '_dry' );
	return res;
}, prefix );
console.log( JSON.stringify( out ) );
await browser.close();
