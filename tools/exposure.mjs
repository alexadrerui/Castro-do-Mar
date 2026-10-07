// The automatic exposure (post/autoExposure.js): for each hour and view, the multiplier the eye settles
// on, the scene's mean log2 luminance and the frame's brightness, with the adaptation off (the fixed
// exposure) and on; then the adaptation in time (a jump from a bright view to a dark one, sampled
// over a few seconds). Captures shots/<prefixo>_<hora>_<vista>_<off|on>.png.
//   node tools/exposure.mjs [prefixo] [--hours=23,17.75] [--views=0,1,2,3,4,5] [--key=] [--params=webgl] [--no-shots]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const opt = ( k, d ) => ( args.find( ( a ) => a.startsWith( `--${ k }=` ) ) || '' ).split( '=' )[ 1 ] ?? d;
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) ) || 'exposure';
const hours = opt( 'hours', '23,17.75' ).split( ',' ).map( Number );
const views = opt( 'views', '0,1,2,3,4,5' ).split( ',' ).map( Number );
const key = opt( 'key' );
const shots = ! args.includes( '--no-shots' );
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
if ( key ) await page.evaluate( ( k ) => { window.__app.exposure.key.value = k; }, +key );

// capture (settled), then the multiplier and the frame's mean brightness (0-255, Rec. 709)
const measure = ( name ) => page.evaluate( async ( name ) => {
	const a = window.__app;
	await a.capture( name, 960, 540 );
	const [ mul, logM, logL ] = await a.exposure.read( a.renderer );
	const bmp = await createImageBitmap( a.lastCaptureBlob );
	const c = new OffscreenCanvas( 240, 135 ), g = c.getContext( '2d' );
	g.drawImage( bmp, 0, 0, 240, 135 );
	const d = g.getImageData( 0, 0, 240, 135 ).data;
	let s = 0;
	for ( let i = 0; i < d.length; i += 4 ) s += 0.2126 * d[ i ] + 0.7152 * d[ i + 1 ] + 0.0722 * d[ i + 2 ];
	return { mul: +mul.toFixed( 3 ), logL: +logL.toFixed( 2 ), luma: +( s / ( d.length / 4 ) ).toFixed( 1 ), auto: +a.exposure.auto.value.toFixed( 2 ), fixed: +a.renderer.toneMappingExposure.toFixed( 2 ) };
}, shots ? name : '_exposure_tmp' );

const rows = [];
for ( const h of hours ) {
	await page.evaluate( ( h ) => { window.__app.clock.set( h ); }, h );
	await new Promise( ( r ) => setTimeout( r, 1200 ) );
	for ( const v of views ) {
		await page.evaluate( ( v ) => window.__app.setView( v ), v );
		await new Promise( ( r ) => setTimeout( r, 600 ) );
		const row = { hour: h, view: v };
		for ( const mode of [ 'off', 'on' ] ) {
			await page.evaluate( ( on ) => { const a = window.__app; a.autoExposure = on ? 1 : 0; a.onSunChanged(); }, mode === 'on' );
			row[ mode ] = await measure( `${ prefix }_${ String( h ).replace( '.', 'h' ) }_${ v }_${ mode }` );
		}
		rows.push( row );
		console.log( `${ String( h ).padEnd( 6 ) } view ${ v }  off: luma ${ String( row.off.luma ).padStart( 5 ) }   on: x${ row.on.mul.toFixed( 2 ) } luma ${ String( row.on.luma ).padStart( 5 ) }  (log2 L ${ row.on.logL }, auto ${ row.on.auto }, fixed ${ row.on.fixed })` );
	}
}

// in time: settle on the brightest view, jump to the darkest, sample the multiplier for 4 s
const night = rows.filter( ( r ) => r.hour === hours[ 0 ] );
if ( night.length > 1 ) {
	const bright = night.reduce( ( a, b ) => ( b.on.logL > a.on.logL ? b : a ) ), dark = night.reduce( ( a, b ) => ( b.on.logL < a.on.logL ? b : a ) );
	await page.evaluate( ( h ) => { const a = window.__app; a.clock.set( h ); a.autoExposure = 1; a.onSunChanged(); }, hours[ 0 ] );
	const trace = await page.evaluate( async ( from, to ) => {
		const a = window.__app, out = [];
		a.setView( from ); a.exposure.settle();
		await new Promise( ( r ) => setTimeout( r, 1500 ) );
		a.freecam.tween = null; a.setView( to );
		if ( a.freecam.tween ) { a.freecam.jumpTo( a.freecam.tween.p1, a.freecam.pivot.clone() ); }
		const t0 = performance.now();
		while ( performance.now() - t0 < 4000 ) {
			out.push( [ +( ( performance.now() - t0 ) / 1000 ).toFixed( 2 ), +( await a.exposure.read( a.renderer ) )[ 0 ].toFixed( 3 ) ] );
			await new Promise( ( r ) => setTimeout( r, 400 ) );
		}
		return out;
	}, bright.view, dark.view );
	console.log( `adaptation, view ${ bright.view } (x${ bright.on.mul }) -> view ${ dark.view } (x${ dark.on.mul }):`, trace.map( ( [ t, m ] ) => `${ t }s x${ m }` ).join( '  ' ) );
}
// by day the multiplier must be exactly 1
await page.evaluate( () => { const a = window.__app; a.autoExposure = 1; a.clock.set( 15.53 ); } );
await new Promise( ( r ) => setTimeout( r, 1200 ) );
const day = await measure( '_exposure_tmp' );
console.log( 'day 15:32:', JSON.stringify( day ) );
console.log( day.mul === 1 && day.auto === 0 ? '  ok   day untouched' : '  FAIL day multiplier is not 1' );
console.log( errors.length ? 'errors: ' + errors.join( ' | ' ) : 'no errors' );
await browser.close();
process.exit( errors.length || day.mul !== 1 ? 1 : 0 );
