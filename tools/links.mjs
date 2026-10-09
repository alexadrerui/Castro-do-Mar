// QA of the links that open at a place (main.js linkView / linkHour / app.shareLink) and of reduced
// motion (core/motion.js): ?cam= and ?hora= put the camera and the clock there, the share link
// round-trips, ?view=minas (a label) works, ?motion=reduce makes the views jump (no flight) and stops
// the page's CSS animations. Also counts the pipelines built after `ready` (the hour set at the load).
//   node tools/links.mjs   (exits 1 on a failed check)
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const fail = [];
const check = ( what, ok, extra = '' ) => { if ( ! ok ) fail.push( what ); console.log( ok ? '  ok  ' : '  FAIL', what, extra ); };
const open = async ( query ) => {
	const page = await browser.newPage();
	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 200 ) ) );
	await page.evaluateOnNewDocument( () => {
		window.__pipes = 0;
		const D = GPUDevice.prototype;
		for ( const n of [ 'createRenderPipeline', 'createRenderPipelineAsync' ] ) { const f = D[ n ]; D[ n ] = function ( d ) { window.__pipes ++; return f.call( this, d ); }; }
	} );
	await page.goto( 'http://localhost:5190/?auto&' + query, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
	return { page, errors };
};

{
	const { page, errors } = await open( 'cam=-20,60,40,10,20,0&hora=18:30&motion=reduce' );
	const r = await page.evaluate( async () => {
		const a = window.__app, sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
		const p0 = window.__pipes;
		await sleep( 3000 );
		const out = { pos: a.camera.position.toArray().map( ( v ) => +v.toFixed( 1 ) ), hour: a.clock.hour, late: window.__pipes - p0 };
		out.share = a.shareLink();
		out.reduced = a.motion.reduced && document.documentElement.classList.contains( 'reduce-motion' );
		out.spin = getComputedStyle( document.querySelector( '.triskele .arms' ) ).animationName;
		a.goView( 3 ); // with reduced motion: there at once
		out.jumped = a.camera.position.distanceTo( new a.camera.position.constructor( ...a.views[ 3 ].pos ) ) < 0.01;
		return out;
	} );
	check( '?cam= places the camera', r.pos.join() === '-20,60,40', r.pos.join() );
	check( '?hora=18:30 sets the clock', Math.abs( r.hour - 18.5 ) < 1e-6, String( r.hour ) );
	check( 'share link carries cam and hora', /\?cam=-20,60,40,[-\d.,]+&hora=18:30$/.test( r.share ), r.share );
	check( '?motion=reduce: on, CSS animations off', r.reduced && r.spin === 'none', r.spin );
	check( 'reduced motion: a view is a jump', r.jumped );
	check( 'no pipelines after ready (hour set at the load)', r.late === 0, `${ r.late }` );
	check( 'no page errors', ! errors.length, errors.join( ' | ' ) );
	// the share link opens the same place
	const q = r.share.split( '?' )[ 1 ];
	await page.close();
	const b = await open( q );
	const r2 = await b.page.evaluate( () => ( { pos: window.__app.camera.position.toArray().map( ( v ) => +v.toFixed( 1 ) ), hour: window.__app.clock.hour, reduced: window.__app.motion.reduced } ) );
	check( 'the share link opens there', r2.pos.join() === '-20,60,40' && Math.abs( r2.hour - 18.5 ) < 1e-6, JSON.stringify( r2 ) );
	await b.page.close();
}
{
	const { page } = await open( 'view=minas' );
	const r = await page.evaluate( () => { const a = window.__app; return a.camera.position.distanceTo( new a.camera.position.constructor( ...a.views[ 3 ].pos ) ); } );
	check( '?view=minas opens the Minas view', r < 0.01, r.toFixed( 3 ) );
	const fly = await page.evaluate( async () => { const a = window.__app; if ( a.motion.reduced ) return 'reduced'; a.goView( 0 ); await new Promise( ( r ) => setTimeout( r, 300 ) ); return !! a.freecam.tween; } );
	check( 'without reduced motion a view still flies', fly === true, String( fly ) );
	await page.close();
}
await browser.close();
console.log( fail.length ? 'FAILED: ' + fail.join( '; ' ) : 'all ok' );
process.exit( fail.length ? 1 : 0 );
