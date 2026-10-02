// QA of the lakes at their own level and the koi ponds (world/lakeWater.js, world/koi): sinks a shallow
// hollow in the terrain edits, pours a lake into it ("Encher": world-edits lakes), reloads, and
// captures the pond from above, from the bank, close up and under the water.
//   node tools/koi.mjs [prefix] [--x=-18 --z=-48 --r=9] [--sea]
// --sea: the old way instead, a basin dug below the sea level (no lake seed).
// Writes public/terrain-edits.bin and public/world-edits.json for the run and deletes them afterwards
// (does not run if either exists).
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const arg = ( k, d ) => Number( ( process.argv.find( ( a ) => a.startsWith( `--${ k }=` ) ) || `=${ d }` ).split( '=' )[ 1 ] );
const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'koi';
const X = arg( 'x', - 18 ), Z = arg( 'z', - 48 ), R = arg( 'r', 9 );
const FILE = 'public/terrain-edits.bin', WFILE = 'public/world-edits.json';
const SEA = process.argv.includes( '--sea' );
for ( const f of [ FILE, WFILE ] ) if ( fs.existsSync( f ) ) { console.log( `${ f } exists: not touching it` ); process.exit( 1 ); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 300 ) ); if ( /^koi:/.test( m.text() ) ) console.log( '[page]', m.text() ); } );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + String( e ).slice( 0, 300 ) ) );
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const ready = () => page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
let p = null;
try {
	// 1. the edits: a basin with a wobbly shore, 2.2 m deep in the middle, sloping banks
	await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
	await ready();
	const bytes = await page.evaluate( ( X, Z, R, SEA ) => {
		const hf = window.__app.hf, n = hf.n, e = new Float32Array( n * n );
		// the rim height: the ground around the hollow (the lowest of a ring), so the bowl is the same
		// depth below it everywhere
		let rim = Infinity;
		for ( let a = 0; a < 64; a ++ ) rim = Math.min( rim, hf.heightAt( X + Math.cos( a / 64 * 6.283 ) * R * 1.3, Z + Math.sin( a / 64 * 6.283 ) * R * 1.3 ) );
		for ( let j = 0; j < n; j ++ ) {
			const z = hf.z0 + j * hf.cell;
			if ( Math.abs( z - Z ) > R * 1.6 ) continue;
			for ( let i = 0; i < n; i ++ ) {
				const x = hf.x0 + i * hf.cell;
				if ( Math.abs( x - X ) > R * 1.6 ) continue;
				const a = Math.atan2( z - Z, x - X ), rr = R * ( 1 + 0.12 * Math.sin( 2 * a + 0.6 ) + 0.08 * Math.sin( 3 * a + 2.1 ) );
				const t = Math.hypot( x - X, z - Z ) / rr;
				if ( t > 1.35 ) continue;
				const h = hf.data[ j * n + i ];
				let target;
				if ( SEA ) target = t < 1 ? - ( 2.2 * ( 1 - t * t ) + 0.15 ) : Math.min( h, ( t - 1 ) / 0.35 * h );
				else {
					// a bowl 2.6 m below the rim, banks easing back to the ground
					const bed = rim - 0.4 - 2.2 * Math.max( 0, 1 - t * t );
					target = t < 1 ? bed : bed + ( h - bed ) * Math.min( 1, ( t - 1 ) / 0.35 );
				}
				e[ j * n + i ] = Math.min( 0, target - h );
			}
		}
		return Array.from( new Uint8Array( e.buffer ) );
	}, X, Z, R, SEA );
	fs.writeFileSync( FILE, Buffer.from( bytes ) );
	if ( ! SEA ) fs.writeFileSync( WFILE, JSON.stringify( { objects: {}, added: [], lakes: [ { x: X, z: Z } ] } ) );
	// 2. reload with the lake
	await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
	await ready();
	const info = await page.evaluate( () => { const k = window.__app.koi; return k.ponds.map( ( p ) => ( { level: +( p.lake.level ?? 0 ).toFixed( 2 ), area: Math.round( p.lake.area ), deepest: +p.lake.deepest.toFixed( 2 ), fish: p.fishes.length, lotus: p.lotus?.userData.count, flora: p.flora?.userData.count, cx: p.lake.cx, cz: p.lake.cz, surface: !! p.lake.mesh } ) ); } );
	console.log( 'ponds', JSON.stringify( info ) );
	// the terrain's water level under the lake (silt), and the sea life kept out of a sea-level lake
	const extra = await page.evaluate( ( SEA ) => {
		const a = window.__app, l = a.koi.lakes[ 0 ];
		if ( ! l ) return null;
		const hf = a.hf, k = Math.round( ( l.cz - hf.z0 ) / hf.cell ) * hf.n + Math.round( ( l.cx - hf.x0 ) / hf.cell );
		const half = a.terrain.waterTex.image.data[ k ];
		const level = SEA ? null : a.THREE.DataUtils.fromHalfFloat( half );
		const sea = a.seabed.habitat( l.cx, l.cz, {} ).depth;
		return { level, lakeLevel: l.level, seabedDepth: sea };
	}, SEA );
	if ( extra ) {
		if ( ! SEA ) console.log( `${ Math.abs( extra.level - extra.lakeLevel ) < 0.05 ? 'ok  ' : 'FAIL' } lodo: nível na textura ${ extra.level?.toFixed( 2 ) } (lago ${ extra.lakeLevel.toFixed( 2 ) })` );
		else console.log( `${ extra.seabedDepth < 0 ? 'ok  ' : 'FAIL' } lago ao nível do mar: fundo do mar e peixes fora (profundidade de habitat ${ extra.seabedDepth })` );
	}
	p = info[ 0 ];
	if ( p ) {
		const L = p.level;
		const g = await page.evaluate( ( x, z ) => window.__app.hf.heightAt( x, z + 14 ), p.cx, p.cz );
		const shots = [
			[ 'above', [ p.cx + 2, L + 16, p.cz + 12 ], [ p.cx, L, p.cz ] ],
			[ 'bank', [ p.cx + 6, Math.max( g, L + 1 ) + 1.7, p.cz + 11 ], [ p.cx - 1, L - 0.5, p.cz ] ],
			[ 'close', [ p.cx + 2.5, L + 2.2, p.cz + 3.5 ], [ p.cx, L - 0.6, p.cz ] ],
			// the cattails of the margin, from the bank across the water (before the dive: a wet lens)
			[ 'reeds', [ p.cx - 11, L + 1.8, p.cz + 7 ], [ p.cx + 4, L + 0.4, p.cz - 3 ] ],
			[ 'under', [ p.cx + 3, L - 1.2, p.cz + 3 ], [ p.cx, L - 1.0, p.cz ] ]
		];
		for ( const [ name, pos, at ] of shots ) {
			// a dive: over the water first (the camera's dive limit takes the level under it), then down
			if ( pos[ 1 ] < L ) { await page.evaluate( ( pos, at ) => { const a = window.__app; a.views.push( { label: 'k', pos: [ pos[ 0 ], pos[ 1 ] + 3, pos[ 2 ] ], target: at } ); a.setView( a.views.length - 1, true ); }, pos, at ); await sleep( 800 ); }
			await page.evaluate( ( pos, at ) => { const a = window.__app; a.dynamicRes = false; a.views.push( { label: 'k', pos, target: at } ); a.setView( a.views.length - 1, true ); }, pos, at );
			await sleep( 3500 );
			await page.evaluate( ( n ) => window.__app.capture( n ), `${ prefix }_${ name }` );
		}
	}
	// 3. the "Encher" tool in the editor: remove the lake (Shift), pour it again, and a slope refuses
	if ( ! SEA && p ) {
		await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
		await page.waitForFunction( () => window.__app?.ready && window.__app.editor && window.__app.objectEditor, { timeout: 300000, polling: 250 } );
		const r = await page.evaluate( ( x, z ) => {
			const a = window.__app, ed = a.editor, msgs = [];
			const toast = ed._toast.bind( ed ); ed._toast = ( m ) => { msgs.push( m ); toast( m ); };
			const out = { start: a.lakes.list.length };
			ed.invert = true; ed._pour( { x, z } ); out.removed = a.lakes.list.length; out.seedsAfterRemove = a.objectEditor.edits.lakes.length;
			ed.invert = false; ed._pour( { x, z } ); out.again = a.lakes.list.length; out.seeds = a.objectEditor.edits.lakes.length; out.surface = !! a.lakes.list[ 0 ]?.mesh;
			ed._pour( { x: x + 40, z: z + 40 } ); out.slope = a.lakes.list.length;
			// a stroke raising the bed by 1.2 m in the middle: the lake refills shallower and smaller
			const area0 = a.lakes.list[ 0 ].area, deep0 = a.lakes.list[ 0 ].deepest, hf = a.hf, n = hf.n;
			ed.stroke = { touched: new Map(), flattenTo: 0, noise: null, last: new a.THREE.Vector3() };
			for ( const k of a.lakes.list[ 0 ].cells ) { const i = k % n, j = ( k - i ) / n; if ( Math.hypot( hf.x0 + i * hf.cell - x, hf.z0 + j * hf.cell - z ) < 5 ) ed._set( k, hf.data[ k ] + 1.2 ); }
			ed._end();
			out.refilled = { deepest0: +deep0.toFixed( 2 ), before: Math.round( area0 ), after: Math.round( a.lakes.list[ 0 ]?.area ?? 0 ), deepest: +( a.lakes.list[ 0 ]?.deepest ?? 0 ).toFixed( 2 ) };
			out.msgs = msgs;
			return out;
		}, p.cx, p.cz );
		console.log( 'editor', JSON.stringify( r ) );
		const ok = r.start === 1 && r.removed === 0 && r.seedsAfterRemove === 0 && r.again === 1 && r.seeds === 1 && r.surface && r.slope === 1 && r.refilled.after > 0 && r.refilled.deepest < r.refilled.deepest0 - 0.3;
		console.log( ok ? `ok   Encher: remover, encher de novo, encosta recusada; o lago acompanha a pincelada (fundo ${ r.refilled.deepest0 } -> ${ r.refilled.deepest } m)` : 'FAIL Encher' );
		if ( ! ok ) process.exitCode = 1;
	}
} finally {
	for ( const f of [ FILE, WFILE ] ) if ( fs.existsSync( f ) ) fs.unlinkSync( f );
	console.log( errors.length ? 'errors: ' + errors.join( ' | ' ) : 'no console errors' );
	await browser.close();
}
