// Frame time vs. resolution and feature toggles (headless):
// node tools/resprobe.mjs [view]
import puppeteer from 'puppeteer-core';

const view = Number( process.argv[ 2 ] || 0 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 1000 } );
const out = await page.evaluate( async ( view ) => {
	const a = window.__app;
	a.dynamicRes = false; a.setView( view );
	const frames = async ( n ) => { for ( let k = 0; k < n; k ++ ) await new Promise( ( r ) => requestAnimationFrame( r ) ); };
	const measure = async () => { await frames( 20 ); const t = performance.now(); await frames( 40 ); return +( ( performance.now() - t ) / 40 ).toFixed( 1 ); };
	const res = {};
	a.renderer.setPixelRatio( 1 ); res[ 'full 1600x900' ] = await measure();
	a.renderer.setPixelRatio( 0.5 ); res[ 'quarter 800x450' ] = await measure();
	a.renderer.setPixelRatio( 1 );
	a.setFocus( false ); res[ 'no DOF' ] = await measure();
	a.setReflections( false ); res[ 'no DOF, no reflection' ] = await measure();
	a.sky.sun.castShadow = false; res[ '+ no shadows' ] = await measure();
	return res;
}, view );
console.log( JSON.stringify( out, null, 1 ) );
await browser.close();
