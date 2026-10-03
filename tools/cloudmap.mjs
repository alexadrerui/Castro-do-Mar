// The clouds' shadow map (world/cloudShadow.js) read back: statistics of each channel (front, mean
// extinction, optical depth) and an image of the optical depth with the camera's projection marked.
//   node tools/cloudmap.mjs [prefixo] [--params=...]   ->  shots/<prefixo>_map.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const args = process.argv.slice( 2 );
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) ) || 'cloudmap';
const extra = ( args.find( ( x ) => x.startsWith( '--params=' ) ) || '--params=' ).slice( 9 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) console.log( '[page]', m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
const out = await page.evaluate( async () => {
	const a = window.__app;
	const { cloudMap, CLOUD_MAP } = await import( '/src/world/cloudShadow.js' );
	await new Promise( ( r ) => setTimeout( r, 1000 ) );
	const n = CLOUD_MAP.size;
	const px = await a.renderer.readRenderTargetPixelsAsync( cloudMap.rt, 0, 0, n, n );
	const half = ( h ) => { const s = h >> 15, e = ( h >> 10 ) & 31, f = h & 1023; return ( s ? - 1 : 1 ) * ( e === 0 ? f / 1024 * 2 ** - 14 : e === 31 ? Infinity : ( 1 + f / 1024 ) * 2 ** ( e - 15 ) ); };
	const get = px instanceof Uint16Array ? ( i ) => half( px[ i ] ) : ( i ) => px[ i ];
	const st = [ 0, 1, 2 ].map( () => ( { min: Infinity, max: - Infinity, sum: 0 } ) );
	let covered = 0;
	const c = new OffscreenCanvas( n, n ), g = c.getContext( '2d' ), img = g.createImageData( n, n );
	for ( let k = 0; k < n * n; k ++ ) {
		for ( let ch = 0; ch < 3; ch ++ ) { const v = get( k * 4 + ch ); st[ ch ].min = Math.min( st[ ch ].min, v ); st[ ch ].max = Math.max( st[ ch ].max, v ); st[ ch ].sum += v; }
		const od = get( k * 4 + 2 );
		if ( od > 1 ) covered ++;
		const sh = 255 * Math.exp( - od * a.cloudShadow.opacity.value );
		img.data[ k * 4 ] = img.data[ k * 4 + 1 ] = img.data[ k * 4 + 2 ] = sh; img.data[ k * 4 + 3 ] = 255;
	}
	g.putImageData( img, 0, 0 );
	const blob = await c.convertToBlob();
	const u8 = new Uint8Array( await blob.arrayBuffer() ); let bin = '';
	for ( let k = 0; k < u8.length; k += 8192 ) bin += String.fromCharCode( ...u8.subarray( k, k + 8192 ) );
	const b64 = btoa( bin );
	return { type: px.constructor.name, centre: cloudMap.centre.value.toArray(), sun: cloudMap.sun.value.toArray().map( ( v ) => +v.toFixed( 3 ) ), cam: a.camera.position.toArray().map( Math.round ),
		front: st[ 0 ], ext: st[ 1 ], od: st[ 2 ], covered: +( covered / ( n * n ) ).toFixed( 3 ), b64 };
} );
fs.writeFileSync( `shots/${ prefix }_map.png`, Buffer.from( out.b64, 'base64' ) );
delete out.b64;
for ( const k of [ 'front', 'ext', 'od' ] ) { const s = out[ k ]; s.mean = +( s.sum / ( 512 * 512 ) ).toFixed( 4 ); delete s.sum; }
console.log( JSON.stringify( out, null, 1 ) );
await browser.close();
