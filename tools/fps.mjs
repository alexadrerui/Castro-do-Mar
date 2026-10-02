// Real-window FPS check (headed Edge): node tools/fps.mjs [views...] [--params=a&b] (extra URL parameters)
// Opens a visible window, waits for the app, measures frame time per view.
import puppeteer from 'puppeteer-core';

const extra = ( process.argv.find( ( a ) => a.startsWith( '--params=' ) ) || '' ).slice( 9 );
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
	const r = await page.evaluate( async ( v ) => {
		const a = window.__app;
		a.dynamicRes = false;
		a.renderer.setPixelRatio( 1 );
		a.setView( v );
		for ( let k = 0; k < 90; k ++ ) await new Promise( ( r ) => requestAnimationFrame( r ) ); // warm
		const t0 = performance.now(); let worst = 0, prev = t0;
		for ( let k = 0; k < 120; k ++ ) {
			await new Promise( ( r ) => requestAnimationFrame( r ) );
			const now = performance.now(); worst = Math.max( worst, now - prev ); prev = now;
		}
		const ms = ( performance.now() - t0 ) / 120;
		return { view: v, fps: +( 1000 / ms ).toFixed( 1 ), ms: +ms.toFixed( 1 ), worstMs: +worst.toFixed( 1 ), calls: a.renderer.info.render.drawCalls, tris: a.renderer.info.render.triangles };
	}, v );
	console.log( JSON.stringify( r ) );
}
await browser.close();
