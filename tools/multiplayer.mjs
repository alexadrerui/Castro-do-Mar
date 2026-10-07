// The shared visit (core/multiplayer.js) with two visitors, each in its own browser profile, as the
// offroad test does: A clicks Convidar, B opens the link; they must find each other through the public
// Nostr relays (needs internet), B must fly to A, see A's lantern where A's camera is, follow A's hour and
// rain, see A's new name, and A must see B leave. Captures shots/<prefixo>_*.png.
//   node tools/multiplayer.mjs [prefixo]
import puppeteer from 'puppeteer-core';

const prefix = process.argv.slice( 2 ).find( ( x ) => ! x.startsWith( '--' ) ) || 'mp';
const BASE = 'http://localhost:5190/';
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1280,720' ],
	defaultViewport: { width: 1280, height: 720 }
} );
const errors = [];
const fail = [];
const check = ( what, ok, extra = '' ) => { if ( ! ok ) fail.push( what ); console.log( ok ? '  ok  ' : '  FAIL', what, extra ); };
const settle = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

async function visitor( label, url ) {
	const ctx = await browser.createBrowserContext();
	await ctx.overridePermissions( new URL( BASE ).origin, [ 'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write' ] );
	const page = await ctx.newPage();
	page.on( 'pageerror', ( e ) => errors.push( label + ': ' + String( e ).slice( 0, 300 ) ) );
	page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource|WebSocket|wss:/.test( m.text() ) ) errors.push( label + ': ' + m.text().slice( 0, 300 ) ); } );
	page.on( 'dialog', ( d ) => d.accept() );
	await page.goto( url, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready && window.__app.mp, { timeout: 300000, polling: 500 } );
	await page.waitForFunction( () => getComputedStyle( document.getElementById( 'loader' ) ).visibility === 'hidden', { timeout: 20000 } );
	return page;
}
const state = ( page ) => page.evaluate( () => {
	const a = window.__app, mp = a.mp, c = a.camera.position;
	const peers = [ ...mp.peers.values() ].map( ( p ) => ( { name: p.name, at: p.lantern?.visible ? p.lantern.position.toArray().map( ( v ) => +v.toFixed( 2 ) ) : null, tag: ! p.tag.hidden } ) );
	return { room: mp.roomId, url: location.search, peers, cam: [ c.x, c.y, c.z ].map( ( v ) => +v.toFixed( 2 ) ), hour: +a.clock.hour.toFixed( 3 ), playing: a.clock.playing,
		rain: +document.getElementById( 'r-rain' ).value, note: document.getElementById( 't-mp' ).textContent, panel: ! document.getElementById( 'mp-panel' ).hidden,
		list: document.getElementById( 'mp-list' ).textContent };
} );
const dist = ( a, b ) => Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] );
const waitFor = async ( page, fn, arg, ms = 60000 ) => { try { await page.waitForFunction( fn, { timeout: ms, polling: 250 }, arg ); return true; } catch ( e ) { return false; } };

console.log( 'A: loading' );
const A = await visitor( 'A', BASE + '?auto' );
await A.evaluate( () => { window.__app.settings.setName( 'Alice' ); document.getElementById( 'i-name' ).value = 'Alice'; window.__app.goView( 0 ); } );
await A.click( '#b-invite' );
await settle( 800 );
let a = await state( A );
const link = await A.evaluate( () => navigator.clipboard.readText().catch( () => '' ) );
console.log( 'A', JSON.stringify( a ), 'link', link );
check( 'Convidar: room in the address and the link copied', !! a.room && a.url.includes( 'sala=' + a.room ) && link.endsWith( '?sala=' + a.room ) );
check( 'panel open, "esperando"', a.panel && /esperando/.test( a.note ) );

console.log( 'B: loading from the link' );
const t0 = Date.now();
const B = await visitor( 'B', link + '&auto' );
await B.evaluate( () => window.__app.settings.setName( 'Bruno' ) );
const met = await waitFor( A, () => [ ...window.__app.mp.peers.values() ].some( ( p ) => p.name ) ) && await waitFor( B, () => [ ...window.__app.mp.peers.values() ].some( ( p ) => p.name ) );
check( 'they find each other', met, `(${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ) } s from B's page opening)` );
if ( ! met ) { console.log( 'errors', errors ); await browser.close(); process.exit( 1 ); }

// B flies to A (follow), then sees A's lantern where A's camera is
await settle( 3500 );
a = await state( A ); let b = await state( B );
console.log( 'A', JSON.stringify( a ) ); console.log( 'B', JSON.stringify( b ) );
check( 'B sees Alice', b.peers[ 0 ]?.name === 'Alice' && /Alice/.test( b.note ) && /Alice/.test( b.list ) );
check( 'B flew to Alice (< 12 m)', dist( b.cam, a.cam ) < 12, dist( b.cam, a.cam ).toFixed( 1 ) + ' m' );
check( "Alice's lantern under her camera", b.peers[ 0 ]?.at && dist( b.peers[ 0 ].at, [ a.cam[ 0 ], a.cam[ 1 ] - 0.45, a.cam[ 2 ] ] ) < 0.3 );
check( 'the newcomer took the older world (hour)', Math.abs( b.hour - a.hour ) < 0.02, `${ a.hour } / ${ b.hour }` );

// A moves: the lantern follows
await A.evaluate( () => { const a = window.__app; a.freecam.jumpTo( a.camera.position.clone().add( new a.camera.position.constructor( 8, 1, - 5 ) ), a.freecam.pivot ); } );
await settle( 1500 );
a = await state( A ); b = await state( B );
check( 'lantern follows a move', dist( b.peers[ 0 ].at, [ a.cam[ 0 ], a.cam[ 1 ] - 0.45, a.cam[ 2 ] ] ) < 0.3, JSON.stringify( b.peers[ 0 ].at ) + ' vs ' + JSON.stringify( a.cam ) );

// the shared world: A's night preset and rain reach B
await A.click( '#day [data-preset="noite"]' );
await A.evaluate( () => window.__app.hud.setRange( 'r-rain', 0.4 ) );
const world = await waitFor( B, () => Math.abs( window.__app.clock.hour - 23 ) < 0.02 && +document.getElementById( 'r-rain' ).value === 0.4, null, 8000 );
b = await state( B );
check( "B follows A's hour and rain", world, `${ b.hour } h, rain ${ b.rain }` );
// and back the other way: B lets the time pass
await B.click( '#b-play' );
check( 'A follows B playing the time', await waitFor( A, () => window.__app.clock.playing, null, 8000 ) );
await B.click( '#b-play' );
await waitFor( A, () => ! window.__app.clock.playing, null, 8000 );
await A.evaluate( () => window.__app.hud.setRange( 'r-rain', 0 ) );

// a capture from B: Alice's lantern at night, with her name
await B.evaluate( () => { const a = window.__app; const id = [ ...a.mp.peers.keys() ][ 0 ]; a.mp.goTo( id ); } );
await settle( 4500 );
b = await state( B );
check( "Alice's tag shown", b.peers[ 0 ]?.tag );
await B.screenshot( { path: `shots/${ prefix }_night.png` } );
await A.click( '#day [data-preset="tarde"]' );
await settle( 3000 );
await B.screenshot( { path: `shots/${ prefix }_day.png` } );
await B.evaluate( () => { document.getElementById( 'side' ).scrollTop = 0; } );
await settle( 300 );
await B.screenshot( { path: `shots/${ prefix }_panel.png`, clip: { x: 980, y: 50, width: 300, height: 420 } } );

// a new name reaches the other side
await A.evaluate( () => { const i = document.getElementById( 'i-name' ); i.value = 'Alice do Castro'; i.dispatchEvent( new Event( 'change' ) ); } );
check( 'rename reaches B', await waitFor( B, () => [ ...window.__app.mp.peers.values() ].some( ( p ) => p.name === 'Alice do Castro' ), null, 8000 ) );

// B leaves
await B.click( '#b-mpleave' );
check( 'A sees B leave', await waitFor( A, () => window.__app.mp.peers.size === 0, null, 20000 ) );
b = await state( B );
check( 'B: out of the room, address clean', ! b.room && ! b.url.includes( 'sala' ) && ! b.panel );

check( 'no errors', errors.length === 0, errors.join( ' | ' ) );
await browser.close();
console.log( fail.length ? `FAILED: ${ fail.join( '; ' ) }` : 'all ok' );
process.exit( fail.length ? 1 : 0 );
