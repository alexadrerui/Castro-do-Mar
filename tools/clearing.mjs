// QA of two fixes: the clearing of objects added in the object editor, and the focus of app.capture.
//   node tools/clearing.mjs [prefix]
// 1. Focus: with the render loop stopped, jumps to a close view and captures; the depth of field must
//    be settled on that view (focus distance = the distance measured under the screen centre).
// 2. Clearing: finds a wood near the village (< 300 m) and one far from it (> 420 m), writes
//    public/world-edits.json with a stall in the near wood and a cart and a round house in the far
//    one, reloads and counts the trees, shrubs and rocks around each (they must be gone), captures
//    shots/<prefix>_<n>.png, then deletes the file. Does not run if public/world-edits.json exists.
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'clearing';
const FILE = 'public/world-edits.json';
if ( fs.existsSync( FILE ) ) { console.log( `${ FILE } exists: not touching it (move it away to run)` ); process.exit( 1 ); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + String( e ).slice( 0, 300 ) ) );
const check = ( ok, msg ) => { console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ msg }` ); if ( ! ok ) process.exitCode = 1; };
const ready = async ( url ) => {
	await page.goto( url, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
	await page.waitForFunction( () => { const l = document.getElementById( 'loader' ); return ! l || getComputedStyle( l ).visibility === 'hidden'; }, { timeout: 30000, polling: 200 } );
	await page.evaluate( () => { window.__app.dynamicRes = false; } );
};
// instances of the chunked sets (vegetation and rocks) within r of c, by set name
const census = ( c, r ) => page.evaluate( ( c, r ) => {
	const a = window.__app, M = new a.camera.matrixWorld.constructor(), p = a.camera.position.clone(), out = {};
	for ( const root of [ a.layers.vegetation.object, a.layers.rocks.object ] ) for ( const ch of root.children ) {
		if ( ! ch.tiles ) continue;
		for ( const t of ch.tiles ) {
			const { matrices, count } = t.hi.userData.instances;
			for ( let i = 0; i < count; i ++ ) {
				M.fromArray( matrices, i * 16 ); p.setFromMatrixPosition( M );
				if ( Math.hypot( p.x - c.x, p.z - c.z ) < r ) out[ ch.name ] = ( out[ ch.name ] || 0 ) + 1;
			}
		}
	}
	return out;
}, c, r );
const sum = ( o, names ) => names.reduce( ( s, n ) => s + ( o[ n ] || 0 ), 0 );
const PLANTS = [ 'oak', 'pine', 'birch', 'bush', 'fern' ];
// look at c from 14 m away, 6 m up
const lookAt = ( c ) => page.evaluate( ( c ) => {
	const a = window.__app, y = a.hf.heightAt( c.x, c.z );
	const V = a.camera.position.constructor;
	a.freecam.jumpTo( new V( c.x - 14, y + 6, c.z + 4 ), new V( c.x, y + 1, c.z ) );
}, c );

await ready( 'http://localhost:5190/?auto' );

// 1. focus with the loop stopped
{
	const r = await page.evaluate( async () => {
		const a = window.__app;
		a.renderer.setAnimationLoop( null ); // as with a hidden tab: update() never runs
		a.setView( 0 );
		// a close target: the castro house (layout.js, -63, 24) from 14 m away, at eye height
		const hx = - 63, hz = 24, y = a.hf.heightAt( hx + 14, hz );
		a.camera.position.set( hx + 14, y + 1.7, hz ); a.camera.lookAt( hx, y + 1.5, hz );
		a.camera.updateMatrixWorld();
		const before = a.focus.focusDistance.value;
		await a.capture( 'clearing_focus' );
		return { before, after: a.focus.focusDistance.value, measured: a.focus.measure(), bokeh: a.focus.bokeh.value };
	} );
	console.log( 'focus', JSON.stringify( r ) );
	check( Math.abs( r.after - r.measured ) < 0.5, `capture settles the focus on the view (${ r.after.toFixed( 1 ) } m, measured ${ r.measured.toFixed( 1 ) } m, before ${ r.before.toFixed( 1 ) } m)` );
	check( r.measured < 22 ? r.bokeh > 3 : true, `full depth of field up close (bokeh ${ r.bokeh.toFixed( 2 ) })` );
}

// 2. clearing: the densest wood spots near and far from the village
const spots = await page.evaluate( () => {
	const a = window.__app, M = new a.camera.matrixWorld.constructor(), p = a.camera.position.clone(), pts = [];
	for ( const ch of a.layers.vegetation.object.children ) {
		if ( ! [ 'oak', 'pine', 'birch' ].includes( ch.name ) || ! ch.tiles ) continue;
		for ( const t of ch.tiles ) { const { matrices, count } = t.hi.userData.instances; for ( let i = 0; i < count; i ++ ) { M.fromArray( matrices, i * 16 ); p.setFromMatrixPosition( M ); pts.push( [ p.x, p.z ] ); } }
	}
	const V = { x: - 15, z: 5 };
	const best = ( lo, hi ) => {
		let top = null, n0 = - 1;
		for ( let k = 0; k < pts.length; k += 3 ) {
			const [ x, z ] = pts[ k ], dv = Math.hypot( x - V.x, z - V.z );
			if ( dv < lo || dv > hi || a.hf.slopeAt( x, z ) > 0.35 ) continue;
			let n = 0; for ( const [ u, v ] of pts ) if ( Math.abs( u - x ) < 10 && Math.abs( v - z ) < 10 && Math.hypot( u - x, v - z ) < 10 ) n ++;
			if ( n > n0 ) { n0 = n; top = { x, z, n }; }
		}
		return top;
	};
	return { near: best( 140, 300 ), far: best( 420, 900 ) };
} );
console.log( 'spots', JSON.stringify( spots ) );
const near = spots.near, far = spots.far;
const cart = { x: far.x, z: far.z }, house = { x: far.x + 22, z: far.z };
const R = { stall: 3, cart: 1.8, house: 6 };
const before = { stall: await census( near, R.stall ), cart: await census( cart, R.cart ), house: await census( house, R.house ) };
console.log( 'before', JSON.stringify( before ) );

fs.writeFileSync( FILE, JSON.stringify( { objects: {}, lakes: [], rivers: [], added: [
	{ id: 'a0', kind: 'stall', x: near.x, z: near.z, rot: 0, seed: 7, red: true, yaw: 0, scale: 1 },
	{ id: 'a1', kind: 'prop', type: 'cart', x: cart.x, z: cart.z, rot: 0.4, yaw: 0, scale: 1 },
	{ id: 'a2', kind: 'building', type: 'round', x: house.x, z: house.z, r: 5, seed: 100, yaw: 0, scale: 1 }
] } ) );
try {
	await ready( 'http://localhost:5190/?auto' );
	const after = { stall: await census( near, R.stall ), cart: await census( cart, R.cart ), house: await census( house, R.house ) };
	console.log( 'after', JSON.stringify( after ) );
	for ( const k of [ 'stall', 'cart', 'house' ] ) {
		check( sum( after[ k ], PLANTS ) === 0, `${ k }: no plants within ${ R[ k ] } m (before ${ sum( before[ k ], PLANTS ) }, after ${ sum( after[ k ], PLANTS ) })` );
		const rocks = Object.keys( after[ k ] ).filter( ( n ) => ! PLANTS.includes( n ) && ! /^(grass|gravel)/.test( n ) );
		check( rocks.length === 0, `${ k }: no rocks (${ rocks.join( ', ' ) || 'none' })` );
	}
	// the grass mask: no blades on the stall's ground
	const g = await page.evaluate( ( c ) => window.__app.grass?.densityAt?.( c.x, c.z ) ?? null, near );
	if ( g !== null ) check( g < 0.05, `no grass under the stall (${ g })` );
	let n = 0;
	for ( const c of [ near, cart, house ] ) {
		await lookAt( c );
		// twice: right after a change app.capture returns the previous frame (CLAUDE.md, lightning QA)
		await page.evaluate( async ( name ) => { await window.__app.capture( name ); await window.__app.capture( name ); }, `${ prefix }_${ n ++ }` );
	}
} finally {
	fs.unlinkSync( FILE );
}
check( errors.length === 0, `console errors: ${ errors.length }` );
for ( const e of errors ) console.log( '  ', e );
await browser.close();
