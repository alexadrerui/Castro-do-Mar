// Tracks frame time and renderer cache growth over time (leak hunting).
// node tools/leak.mjs [blocks] [framesPerBlock]
import puppeteer from 'puppeteer-core';

const blocks = Number( process.argv[ 2 ] || 6 );
const per = Number( process.argv[ 3 ] || 20 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 1000 } );
await page.evaluate( () => { window.__app.dynamicRes = false; window.__app.setView( 0 ); } );
for ( let b = 0; b < blocks; b ++ ) {
	const r = await page.evaluate( async ( per ) => {
		const a = window.__app, R = a.renderer;
		const t0 = performance.now();
		for ( let k = 0; k < per; k ++ ) await new Promise( ( r ) => requestAnimationFrame( r ) );
		const p = R._pipelines;
		return {
			ms: ( ( performance.now() - t0 ) / per ).toFixed( 1 ),
			pipelines: p.caches.size, vs: p.programs.vertex.size, fs: p.programs.fragment.size,
			geos: R.info.memory.geometries, tex: R.info.memory.textures,
			calls: R.info.render.drawCalls
		};
	}, per );
	console.log( `block ${b}: ${JSON.stringify( r )}` );
}
await browser.close();
