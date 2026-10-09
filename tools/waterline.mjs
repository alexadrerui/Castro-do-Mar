// QA for the waterline cut (post/underwater.js, LINE_BAND): counts the render pipelines built after
// `ready` while the camera crosses the sea surface (above, in the band above and below the eye, fully
// under, back up) and captures each step. Should print afterReady: 0 (a new pipeline per state fills
// Edge's shader cache, see CLAUDE.md "Pipelines").
//   node tools/waterline.mjs [prefix] [--params=...]   -> shots/<prefix>_{above,lineUp,lineDown,under,back}.png
import puppeteer from 'puppeteer-core';

const prefix = process.argv.slice( 2 ).find( ( a ) => ! a.startsWith( '--' ) ) || 'wline';
const extra = ( process.argv.find( ( a ) => a.startsWith( '--params=' ) ) || '' ).slice( 9 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) console.log( '[page]', m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
await page.evaluateOnNewDocument( () => {
	window.__pipes = [];
	const D = GPUDevice.prototype;
	for ( const name of [ 'createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync' ] ) {
		const f = D[ name ];
		D[ name ] = function ( desc ) {
			window.__pipes.push( { name, step: window.__step || 'load', label: desc.label || '' } );
			return f.call( this, desc );
		};
	}
} );
await page.goto( 'http://localhost:5190/?auto' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 250 } );
const res = await page.evaluate( async ( prefix ) => {
	const a = window.__app;
	a.dynamicRes = false;
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	const loaded = window.__pipes.length;
	window.__step = 'ready';
	await sleep( 3000 ); // settle at the start view
	// open water: east from the village until the bottom is 6+ m deep
	let x = 40;
	for ( ; x < 2000; x += 10 ) if ( a.hf.heightAt( x, 0 ) < - 6 ) break;
	const view = ( y ) => { a.views.push( { label: 'qa', pos: [ x, y, 0 ], target: [ x - 60, y + 1, 0 ] } ); a.setView( a.views.length - 1 ); a.views.pop(); };
	const out = { spot: x, steps: [] };
	for ( const [ step, y ] of [ [ 'above', 3 ], [ 'lineUp', 0.4 ], [ 'lineDown', - 0.4 ], [ 'under', - 3 ], [ 'back', 0.3 ], [ 'above2', 3 ] ] ) {
		window.__step = step;
		view( y );
		await sleep( 2500 );
		await a.capture( prefix + '_' + step );
		out.steps.push( { step, y, on: a.underwater.on.value, line: a.underwater.line.value, eyeUnder: a.underwater.eyeUnder, newPipes: window.__pipes.filter( ( p ) => p.step === step ).length } );
	}
	out.loaded = loaded;
	out.afterReady = window.__pipes.length - loaded;
	out.total = window.__pipes.length;
	return out;
}, prefix );
console.log( JSON.stringify( res, null, 1 ) );
await browser.close();
process.exit( res.afterReady ? 1 : 0 );
