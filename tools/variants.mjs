// One load, several looks: applies JS snippets one after the other (cumulative) and captures the
// same camera after each, to see what each change does.
//   node tools/variants.mjs <prefix> --cam=x,y,z,tx,ty,tz "name::js" ["name::js" ...] [--reset]
// The snippet runs in the page with `a` = window.__app. --reset reloads nothing but undoes nothing
// either: write the snippets so each one builds on the previous. Frames: shots/<prefix>_<k>_<name>.png
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const prefix = args[ 0 ] || 'var';
const cam = ( args.find( ( x ) => x.startsWith( '--cam=' ) ) || '--cam=-45,68,95,30,52,-45' ).slice( 6 ).split( ',' ).map( Number );
const steps = args.slice( 1 ).filter( ( x ) => ! x.startsWith( '--' ) ).map( ( x ) => { const i = x.indexOf( '::' ); return [ x.slice( 0, i ), x.slice( i + 2 ) ]; } );
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) console.log( '[page]', m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
const out = await page.evaluate( async ( prefix, cam, steps ) => {
	const a = window.__app;
	a.dynamicRes = false;
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	a.views.push( { label: 'var', pos: cam.slice( 0, 3 ), target: cam.slice( 3, 6 ) } ); a.setView( a.views.length - 1 );
	await sleep( 1500 );
	const stat = async () => {
		const bmp = await createImageBitmap( a.lastCaptureBlob );
		const c = new OffscreenCanvas( 320, 180 ), g = c.getContext( '2d' ); g.drawImage( bmp, 0, 0, 320, 180 );
		const d = g.getImageData( 0, 0, 320, 180 ).data;
		let l = 0, clip = 0, sat = 0;
		for ( let p = 0; p < d.length; p += 4 ) { const y = 0.2126 * d[ p ] + 0.7152 * d[ p + 1 ] + 0.0722 * d[ p + 2 ]; l += y; if ( y > 245 ) clip ++; sat += Math.max( d[ p ], d[ p + 1 ], d[ p + 2 ] ) - Math.min( d[ p ], d[ p + 1 ], d[ p + 2 ] ); }
		const n = d.length / 4;
		return { luma: +( l / n ).toFixed( 1 ), clip: +( clip / n ).toFixed( 3 ), chroma: +( sat / n ).toFixed( 1 ) };
	};
	const res = [];
	await a.capture( `${ prefix }_0_base` ); res.push( [ 'base', await stat() ] );
	let k = 1;
	for ( const [ name, js ] of steps ) {
		try { await ( 0, eval )( `(async (a) => { ${ js } })` )( a ); } catch ( e ) { res.push( [ name, 'error: ' + e.message ] ); continue; }
		await sleep( 600 );
		await a.capture( `${ prefix }_${ k ++ }_${ name }` );
		res.push( [ name, await stat() ] );
	}
	return res;
}, prefix, cam, steps );
for ( const [ n, s ] of out ) console.log( n.padEnd( 14 ), JSON.stringify( s ) );
await browser.close();
