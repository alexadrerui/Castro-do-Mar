// Headless capture for the QA loop: node tools/shoot.mjs <prefix> [views...]
// Uses the installed Edge (Chromium) with WebGPU enabled, waits for the app to
// be ready and saves shots/<prefix>_<view>.png through the dev server endpoint.
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'hq';
const camArg = process.argv.find( ( a ) => a.startsWith( '--cam=' ) );
const extraCam = camArg ? camArg.slice( 6 ).split( ',' ).map( Number ) : null;
const views = process.argv.slice( 3 ).filter( ( a ) => ! a.startsWith( '--' ) ).map( Number );
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await puppeteer.launch( {
	executablePath: EDGE,
	headless: 'new',
	protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( [ 'error', 'warn' ].includes( m.type() ) ) console.log( '[page]', m.type(), m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
const url = 'http://localhost:5190/?auto' + ( process.argv.includes( '--webgl' ) ? '&webgl' : '' );
await page.goto( url, { waitUntil: 'domcontentloaded' } );
const t0 = Date.now();
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 240000, polling: 1000 } );
console.log( 'ready in', ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ), 's; backend:', await page.evaluate( () => window.__app.backendName ) );
const list = extraCam ? [ 6 ] : ( views.length ? views : [ 0, 1, 2, 3, 4, 5 ] );
const stats = await page.evaluate( async ( prefix, list, extra ) => {
	const a = window.__app;
	a.dynamicRes = false;
	if ( extra ) a.views.push( { label: 'extra', pos: extra.slice( 0, 3 ), target: extra.slice( 3, 6 ) } );
	await a.captureViews( prefix + '_warm', [ list[ 0 ] ] );
	const out = [];
	for ( const i of list ) {
		a.setView( i );
		await new Promise( ( r ) => setTimeout( r, 1500 ) );
		await a.capture( prefix + '_' + i );
		out.push( { view: i, tris: a.renderer.info.render.triangles, calls: a.renderer.info.render.drawCalls } );
	}
	// rough frame time at view 0
	a.setView( 0 );
	const t = performance.now();
	for ( let k = 0; k < 20; k ++ ) { a.renderFrame(); await new Promise( ( r ) => requestAnimationFrame( r ) ); }
	out.push( { msPerFrame: ( performance.now() - t ) / 20 } );
	return out;
}, prefix, list, extraCam );
console.log( JSON.stringify( stats ) );
await browser.close();
