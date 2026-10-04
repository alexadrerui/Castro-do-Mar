// The world's one wind (world/wind.js) and the grass's ring shadow (grass.js receivedShadowPositionNode):
// with the sun's shadows on and the sun low, the meadow by a wood with the ring off and on
// (shots/<prefixo>_ring0.png, _ring.png), then 6 frames 0.35 s apart (shots/<prefixo>_seq.png, a strip)
// to see a gust cross the grass and the trees together.
//   node tools/windring.mjs [prefixo] [--view=n | --at=x,z --look=x,z] [--hour=17]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const args = process.argv.slice( 2 );
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) ) || 'windring';
const opt = ( k, d ) => ( args.find( ( x ) => x.startsWith( `--${ k }=` ) ) || `--${ k }=${ d }` ).split( '=' )[ 1 ];
const view = opt( 'view', '' );
const at = opt( 'at', '-150,40' ).split( ',' ).map( Number ), look = opt( 'look', '-185,10' ).split( ',' ).map( Number ), hour = + opt( 'hour', '17' );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5190/?auto&shadows=1', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
const out = await page.evaluate( async ( at, look, hour, view ) => {
	const a = window.__app, hf = a.hf, sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	a.clock.set( hour ); a.setFocus( false );
	if ( view !== '' ) a.setView( + view ); else a.views.push( { label: 'wr', pos: [ at[ 0 ], hf.heightAt( at[ 0 ], at[ 1 ] ) + 2.2, at[ 1 ] ], target: [ look[ 0 ], hf.heightAt( look[ 0 ], look[ 1 ] ) + 1, look[ 1 ] ] } );
	if ( view === '' ) a.setView( a.views.length - 1 );
	await sleep( 2500 );
	const shot = async ( n ) => { await a.capture( n ); await a.capture( n ); };
	a.grass.shadowRing.value = 0; await shot( 'wr_ring0' );
	a.grass.shadowRing.value = 0.3; await shot( 'wr_ring' );
	for ( let k = 0; k < 6; k ++ ) { await shot( 'wr_seq' + k ); await sleep( 350 ); }
	return { calm: ( await import( '/src/world/wind.js' ) ) && 'ok' };
}, at, look, hour, view );
console.log( out, errors.length ? errors : 'no page errors' );
await browser.close();
for ( const [ from, to ] of [ [ 'wr_ring0', 'ring0' ], [ 'wr_ring', 'ring' ] ] ) fs.renameSync( `shots/${ from }.png`, `shots/${ prefix }_${ to }.png` );
