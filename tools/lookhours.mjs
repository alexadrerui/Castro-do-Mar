// The look through the day (world/look.js): one view captured at a list of hours, with the frame's mean
// brightness; to compare two versions (the table against the old curves, a retuned key against the
// one before), run it on each and compare the numbers and shots/<prefixo>_<hora>.png.
//   node tools/lookhours.mjs [prefixo] [--view=2] [--hours=5,6,6.5,...] [--params=...]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const opt = ( k, d ) => ( args.find( ( a ) => a.startsWith( `--${ k }=` ) ) || '' ).split( '=' ).slice( 1 ).join( '=' ) || d;
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) ) || 'look';
const view = +opt( 'view', '2' );
const hours = opt( 'hours', '5,5.75,6.25,6.5,6.75,7,7.5,8,9,12,15.533,16.5,17,17.25,17.5,17.75,18,18.5,19,23' ).split( ',' ).map( Number );
const extra = opt( 'params', '' );

const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1280,720' ],
	defaultViewport: { width: 1280, height: 720 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 500 } );
await new Promise( ( r ) => setTimeout( r, 1500 ) );
// still clouds and sky, as tools/verify.mjs: only the hour changes between shots
await page.evaluate( ( v ) => {
	const a = window.__app;
	a.setView( v );
	a.dynamicRes = false;
	a.sky.sky.cloudSpeed.value = 0;
	if ( a.clouds ) { a.clouds.time.value = 0; a.clouds.update = () => {}; }
}, view );
const out = [];
for ( const h of hours ) {
	const r = await page.evaluate( async ( h, name ) => {
		const a = window.__app;
		a.clock.set( h ); a.sky.buildEnv();
		await new Promise( ( r ) => setTimeout( r, 500 ) );
		await a.capture( name, 960, 540 );
		const bmp = await createImageBitmap( a.lastCaptureBlob );
		const c = new OffscreenCanvas( 240, 135 ), g = c.getContext( '2d' );
		g.drawImage( bmp, 0, 0, 240, 135 );
		const d = g.getImageData( 0, 0, 240, 135 ).data;
		let s = 0, rr = 0, bb = 0;
		for ( let i = 0; i < d.length; i += 4 ) { s += 0.2126 * d[ i ] + 0.7152 * d[ i + 1 ] + 0.0722 * d[ i + 2 ]; rr += d[ i ]; bb += d[ i + 2 ]; }
		const n = d.length / 4;
		return { luma: +( s / n ).toFixed( 1 ), warm: +( ( rr - bb ) / n ).toFixed( 1 ), exposure: +a.renderer.toneMappingExposure.toFixed( 3 ), hemi: +a.sky.hemi.intensity.toFixed( 4 ) };
	}, h, `${ prefix }_${ String( h ).replace( '.', 'h' ) }` );
	out.push( { h, ...r } );
	console.log( String( h ).padEnd( 7 ), `luma ${ String( r.luma ).padStart( 5 ) }  r-b ${ String( r.warm ).padStart( 6 ) }  exposure ${ r.exposure }  ambient ${ r.hemi }` );
}
console.log( errors.length ? 'errors: ' + errors.join( ' | ' ) : 'no errors' );
console.log( JSON.stringify( out ) );
await browser.close();
