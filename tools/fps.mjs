// Real-window FPS check (headed Edge): node tools/fps.mjs [views...] [--params=a&b] (extra URL parameters) [--hour=23] (the clock, world/clock.js)
//   [--js="code"] (run in the page with `a` = window.__app after the view is set, e.g. a.setShadows(false))
// Opens a visible window, waits for the app, measures frame time per view.
import puppeteer from 'puppeteer-core';

const extra = ( process.argv.find( ( a ) => a.startsWith( '--params=' ) ) || '' ).slice( 9 );
const hourArg = process.argv.find( ( a ) => a.startsWith( '--hour=' ) );
const hour = hourArg ? Number( hourArg.slice( 7 ) ) : null;
const jsArg = process.argv.find( ( a ) => a.startsWith( '--js=' ) );
const js = jsArg ? jsArg.slice( 5 ) : null;
const views = process.argv.slice( 2 ).filter( ( a ) => ! a.startsWith( '--' ) ).map( Number );
const list = views.length ? views : [ 0, 2, 4 ];
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	headless: false, protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--window-size=1600,940', '--window-position=40,40' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5190/?auto' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 1000 } );
for ( const v of list ) {
	const r = await page.evaluate( async ( v, hour, js ) => {
		const a = window.__app;
		a.dynamicRes = false;
		if ( hour !== null ) a.clock.set( hour );
		a.renderer.setPixelRatio( 1 );
		a.setView( v );
		if ( js ) await ( 0, eval )( `(async (a) => { ${ js } })` )( a );
		for ( let k = 0; k < 90; k ++ ) await new Promise( ( r ) => requestAnimationFrame( r ) ); // warm
		const t0 = performance.now(); let worst = 0, prev = t0;
		for ( let k = 0; k < 120; k ++ ) {
			await new Promise( ( r ) => requestAnimationFrame( r ) );
			const now = performance.now(); worst = Math.max( worst, now - prev ); prev = now;
		}
		const ms = ( performance.now() - t0 ) / 120;
		return { view: v, fps: +( 1000 / ms ).toFixed( 1 ), ms: +ms.toFixed( 1 ), worstMs: +worst.toFixed( 1 ), calls: a.renderer.info.render.drawCalls, tris: a.renderer.info.render.triangles };
	}, v, hour, js );
	console.log( JSON.stringify( r ) );
}
await browser.close();
