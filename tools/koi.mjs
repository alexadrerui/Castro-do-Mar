// QA of the koi ponds (world/koi): digs a test lake in the terrain edits, reloads, and captures the
// pond from above, from the bank and under the water.
//   node tools/koi.mjs [prefix] [--x=-18 --z=-48 --r=9]
// Writes public/terrain-edits.bin for the run and deletes it afterwards (does not run if one exists).
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const arg = ( k, d ) => Number( ( process.argv.find( ( a ) => a.startsWith( `--${ k }=` ) ) || `=${ d }` ).split( '=' )[ 1 ] );
const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'koi';
const X = arg( 'x', - 18 ), Z = arg( 'z', - 48 ), R = arg( 'r', 9 );
const FILE = 'public/terrain-edits.bin';
if ( fs.existsSync( FILE ) ) { console.log( `${ FILE } exists: not touching it` ); process.exit( 1 ); }
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
try {
	// 1. the edits: a basin with a wobbly shore, 2.2 m deep in the middle, sloping banks
	await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
	await ready();
	const bytes = await page.evaluate( ( X, Z, R ) => {
		const hf = window.__app.hf, n = hf.n, e = new Float32Array( n * n );
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
				const depth = t < 1 ? 2.2 * ( 1 - t * t ) + 0.15 : 0; // below the water
				const target = t < 1 ? - depth : Math.min( h, ( t - 1 ) / 0.35 * h );
				e[ j * n + i ] = Math.min( 0, target - h );
			}
		}
		return Array.from( new Uint8Array( e.buffer ) );
	}, X, Z, R );
	fs.writeFileSync( FILE, Buffer.from( bytes ) );
	// 2. reload with the lake
	await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
	await ready();
	const info = await page.evaluate( () => { const k = window.__app.koi; return k.ponds.map( ( p ) => ( { area: Math.round( p.lake.area ), fish: p.fishes.length, lotus: p.lotus?.userData.count, cx: p.lake.cx, cz: p.lake.cz } ) ); } );
	console.log( 'ponds', JSON.stringify( info ) );
	const p = info[ 0 ];
	if ( p ) {
		const g = await page.evaluate( ( x, z ) => window.__app.hf.heightAt( x, z + 14 ), p.cx, p.cz );
		const shots = [
			[ 'above', [ p.cx + 2, 16, p.cz + 12 ], [ p.cx, 0, p.cz ] ],
			[ 'bank', [ p.cx + 6, Math.max( g, 1 ) + 1.7, p.cz + 11 ], [ p.cx - 1, - 0.5, p.cz ] ],
			[ 'close', [ p.cx + 2.5, 2.2, p.cz + 3.5 ], [ p.cx, - 0.6, p.cz ] ],
			[ 'under', [ p.cx + 3, - 1.2, p.cz + 3 ], [ p.cx, - 1.0, p.cz ] ]
		];
		for ( const [ name, pos, at ] of shots ) {
			await page.evaluate( ( pos, at ) => { const a = window.__app; a.dynamicRes = false; a.views.push( { label: 'k', pos, target: at } ); a.setView( a.views.length - 1, true ); }, pos, at );
			await sleep( 3500 );
			await page.evaluate( ( n ) => window.__app.capture( n ), `${ prefix }_${ name }` );
		}
	}
} finally {
	if ( fs.existsSync( FILE ) ) fs.unlinkSync( FILE );
	console.log( errors.length ? 'errors: ' + errors.join( ' | ' ) : 'no console errors' );
	await browser.close();
}
