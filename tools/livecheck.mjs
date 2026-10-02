import puppeteer from 'puppeteer-core';
const url = process.argv[ 2 ];
const browser = await puppeteer.launch( { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new',
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist' ], defaultViewport: { width: 1280, height: 720 } } );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) console.log( '[error]', m.text().slice( 0, 300 ) ); } );
page.on( 'requestfailed', ( r ) => console.log( '[failed]', r.url() ) );
page.on( 'response', ( r ) => { if ( r.status() >= 400 ) console.log( '[http ' + r.status() + ']', r.url() ); } );
const t0 = Date.now();
await page.goto( url, { waitUntil: 'domcontentloaded' } );
try {
	await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 240000, polling: 500 } );
	console.log( 'ready in', ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ), 's; backend', await page.evaluate( () => window.__app.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL' ) );
	await new Promise( ( r ) => setTimeout( r, 2000 ) );
	await page.screenshot( { path: process.argv[ 3 ] } );
} catch ( e ) { console.log( 'NOT READY', e.message ); }
await browser.close();
