// A/B test of a feature switched by URL parameters: the same views captured with A and B, and the
// frame time of each (1600 x 900, rendering and waiting for the GPU, 20 frames; no vsync cap).
//   node tools/abtest.mjs <prefix> "<paramsA>" "<paramsB>" [views...] [--cam=x,y,z,tx,ty,tz]...
//   e.g. node tools/abtest.mjs scat "scatter=0" "" 0 4 5
// -> shots/<prefix>_<A|B>_<view>.png and shots/<prefix>_cmp_<view>.png (A above B)
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'child_process';

const [ prefix = 'ab', qa = '', qb = '' ] = process.argv.slice( 2 );
const views = process.argv.slice( 5 ).filter( ( a ) => ! a.startsWith( '--' ) ).map( Number );
const cams = process.argv.filter( ( a ) => a.startsWith( '--cam=' ) ).map( ( a ) => a.slice( 6 ).split( ',' ).map( Number ) );
const list = [ ...( views.length || cams.length ? views : [ 0 ] ).map( ( v ) => ( { name: 'v' + v, view: v } ) ), ...cams.map( ( c, i ) => ( { name: 'cam' + i, cam: c } ) ) ];
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) console.log( '[page]', m.text().slice( 0, 400 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 400 ) ) );
const result = {};
for ( const [ tag, q ] of [ [ 'A', qa ], [ 'B', qb ] ] ) {
	await page.goto( 'http://localhost:5190/?auto' + ( q ? '&' + q : '' ), { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
	result[ tag ] = await page.evaluate( async ( tag, prefix, list ) => {
		const a = window.__app;
		a.dynamicRes = false;
		a.setFocus?.( false );
		if ( a.flock ) a.flock.paused = true;
		if ( a.gulls ) a.gulls.paused = true;
		const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
		const dev = a.renderer.backend.device;
		const out = {};
		a.setView( 0 ); await sleep( 600 ); // settle the free camera
		for ( const v of list ) {
			if ( v.cam ) { a.views.push( { label: 'ab', pos: v.cam.slice( 0, 3 ), target: v.cam.slice( 3, 6 ) } ); a.setView( a.views.length - 1 ); a.views.pop(); }
			else a.setView( v.view );
			await sleep( 900 );
			await a.capture( `${ prefix }_${ tag }_${ v.name }` );
			a.renderer.setPixelRatio( 1 ); a.renderer.setSize( 1600, 900, false );
			for ( let k = 0; k < 3; k ++ ) a.renderFrame();
			await dev.queue.onSubmittedWorkDone();
			const t = performance.now();
			for ( let k = 0; k < 20; k ++ ) { a.renderFrame(); await dev.queue.onSubmittedWorkDone(); }
			out[ v.name ] = +( ( performance.now() - t ) / 20 ).toFixed( 2 );
		}
		return out;
	}, tag, prefix, list );
}
await browser.close();
for ( const v of list ) console.log( v.name, 'A', result.A[ v.name ], 'ms  B', result.B[ v.name ], 'ms  (B - A', +( result.B[ v.name ] - result.A[ v.name ] ).toFixed( 2 ), ')' );
// side-by-side images (A above B) when Python + Pillow are available
try {
	execFileSync( 'python', [ '-c', `
from PIL import Image
for n in ${ JSON.stringify( list.map( ( v ) => v.name ) ) }:
    a=Image.open('shots/${ prefix }_A_'+n+'.png').resize((800,450)); b=Image.open('shots/${ prefix }_B_'+n+'.png').resize((800,450))
    W=Image.new('RGB',(800,900)); W.paste(a,(0,0)); W.paste(b,(0,450)); W.save('shots/${ prefix }_cmp_'+n+'.png')
` ] );
} catch ( e ) { /* comparison images are optional */ }
