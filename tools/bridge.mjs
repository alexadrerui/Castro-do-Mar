// QA of the bridges (world/bridges.js) where a path crosses a river, both ways round: a river laid
// across the main road, then a new path laid across that river (the "Caminhos" tab), each one getting
// its bridge at once in the editor; saved, reloaded in the normal mode: both bridges built at the load.
// Captures shots/<prefixo>_{road,path,reload}.png. Deletes the test files (does not run if any exists).
//   node tools/bridge.mjs [prefixo]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'bridge';
const FILES = [ 'public/terrain-edits.bin', 'public/world-edits.json' ];
for ( const f of FILES ) if ( fs.existsSync( f ) ) { console.log( `${ f } exists: not touching it` ); process.exit( 1 ); }
const browser = await puppeteer.launch( { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ], defaultViewport: { width: 1600, height: 900 } } );
const page = await browser.newPage();
const errors = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + String( e ).slice( 0, 300 ) ) );
let fails = 0;
const check = ( ok, msg ) => { console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ msg }` ); if ( ! ok ) fails ++; };
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
// a view of a crossing from the side, a little above
const look = ( c, name ) => page.evaluate( async ( c, n ) => {
	const a = window.__app, hf = a.hf, mx = ( c.a.x + c.b.x ) / 2, mz = ( c.a.z + c.b.z ) / 2;
	const ux = c.b.x - c.a.x, uz = c.b.z - c.a.z, l = Math.hypot( ux, uz ), vx = - uz / l, vz = ux / l;
	const px = mx + vx * 16 + ux / l * 6, pz = mz + vz * 16 + uz / l * 6;
	a.views.push( { label: n, pos: [ px, Math.max( hf.heightAt( px, pz ), c.level ) + 4, pz ], target: [ mx, c.level + 1, mz ] } );
	a.setView( a.views.length - 1 );
	a.setFocus?.( false );
	await new Promise( ( r ) => setTimeout( r, 1500 ) );
	await a.capture( n ); await a.capture( n );
}, c, `${ prefix }_${ name }` );

try {
	await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready && window.__app.pathEditor && window.__app.bridges, { timeout: 300000, polling: 250 } );
	let s = await page.evaluate( () => window.__app.bridges.count );
	check( s === 0, `sem rios: ${ s } pontes` );
	// 1) a river laid across the main road (near ( -100, 118 ))
	s = await page.evaluate( () => {
		const a = window.__app, ed = a.editor;
		ed.river.points = [ [ - 112, 98, 6 ], [ - 100, 118, 6 ], [ - 88, 140, 6 ] ];
		ed._riverFinish();
		return { rivers: a.rivers.list.length, bridges: a.bridges.count, c: a.bridges.crossings[ 0 ] };
	} );
	check( s.rivers === 1 && s.bridges === 1, `rio traçado sobre a estrada: ${ s.bridges } ponte na hora (vão ${ s.c ? Math.hypot( s.c.b.x - s.c.a.x, s.c.b.z - s.c.a.z ).toFixed( 1 ) : '-' } m, água a ${ s.c?.level.toFixed( 2 ) } m)` );
	if ( s.c ) await look( s.c, 'road' );
	// 2) a path laid across that river (the "Caminhos" tab)
	await page.click( '#editor-tabs [data-tab=paths]' ); await sleep( 300 );
	s = await page.evaluate( () => {
		const a = window.__app, P = a.pathEditor;
		P.points = [ [ - 125, 128 ], [ - 104, 128 ], [ - 80, 116 ] ];
		P._finishDraw();
		return { bridges: a.bridges.count, c: a.bridges.crossings.at( - 1 ) };
	} );
	check( s.bridges === 2, `caminho traçado sobre o rio: ${ s.bridges } pontes na hora` );
	if ( s.c ) await look( s.c, 'path' );
	// save and reload in the normal mode
	await page.evaluate( () => window.__app.editor.save() ).catch( () => {} );
	await sleep( 3000 );
	check( FILES.every( ( f ) => fs.existsSync( f ) ), 'salvo: terrain-edits.bin e world-edits.json' );
	await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready && window.__app.bridges, { timeout: 300000, polling: 250 } );
	s = await page.evaluate( () => ( { n: window.__app.bridges.count, meshes: window.__app.bridges.group.children.length, c: window.__app.bridges.crossings[ 0 ] } ) );
	check( s.n === 2 && s.meshes >= 2, `depois de recarregar: ${ s.n } pontes na carga (${ s.meshes } malhas, madeira das casas)` );
	if ( s.c ) await look( s.c, 'reload' );
} finally {
	for ( const f of FILES ) if ( fs.existsSync( f ) ) { fs.unlinkSync( f ); console.log( 'deleted', f ); }
	console.log( errors.length ? 'page errors:\n' + errors.join( '\n' ) : 'no page errors' );
	console.log( fails ? `FAILED: ${ fails }` : 'ALL OK' );
	await browser.close();
}
process.exit( fails || errors.length ? 1 : 0 );
