// The touch controls (controls/touch.js, controls/freecam.js) on an emulated phone in landscape, with real
// touch events through the DevTools protocol (several fingers at once): the touch layout on a touch-only
// screen (stick, buttons, no keyboard help, panel folded), the stick flying forward and sideways, one
// finger looking, two fingers pinching forward, the up button, a tap focusing, the mouse bringing the
// desktop layout back; and the dynamic resolution's scale on the scene pass (forced) with a full-size
// capture. Captures shots/<prefixo>_*.png.
//   node tools/touch.mjs [prefixo]
import puppeteer from 'puppeteer-core';

const prefix = process.argv.slice( 2 ).find( ( x ) => ! x.startsWith( '--' ) ) || 'touch';
const W = 844, H = 390;
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', `--window-size=${ W },${ H }` ]
} );
const page = await browser.newPage();
await page.setViewport( { width: W, height: H, isMobile: true, hasTouch: true, isLandscape: true, deviceScaleFactor: 1 } );
const cdp = await page.createCDPSession();
await cdp.send( 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 } );
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
const fail = [];
const check = ( what, ok, extra = '' ) => { if ( ! ok ) fail.push( what ); console.log( ok ? '  ok  ' : '  FAIL', what, extra ); };
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

// touch points: [ [ x, y ], ... ] per finger (ids by index)
const touch = ( type, pts ) => cdp.send( 'Input.dispatchTouchEvent', { type, touchPoints: pts.map( ( [ x, y ], id ) => ( { x, y, id, radiusX: 4, radiusY: 4, force: 1 } ) ) } );
async function drag( from, to, ms = 600, hold = 0 ) {
	// from / to: lists of fingers
	await touch( 'touchStart', from );
	const n = Math.max( 2, Math.round( ms / 30 ) );
	for ( let i = 1; i <= n; i ++ ) { await touch( 'touchMove', from.map( ( f, k ) => [ f[ 0 ] + ( to[ k ][ 0 ] - f[ 0 ] ) * i / n, f[ 1 ] + ( to[ k ][ 1 ] - f[ 1 ] ) * i / n ] ) ); await sleep( 30 ); }
	if ( hold ) await sleep( hold );
	await touch( 'touchEnd', [] );
}
const cam = () => page.evaluate( () => { const a = window.__app, c = a.camera.position; return { p: [ c.x, c.y, c.z ], yaw: a.freecam.yaw, pitch: a.freecam.pitch }; } );
const dist2 = ( a, b ) => Math.hypot( a.p[ 0 ] - b.p[ 0 ], a.p[ 2 ] - b.p[ 2 ] );

await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready && window.__app.touch, { timeout: 300000, polling: 500 } );
await page.waitForFunction( () => getComputedStyle( document.getElementById( 'loader' ) ).visibility === 'hidden', { timeout: 20000 } );
await page.evaluate( () => { const a = window.__app; a.dynamicRes = false; a.goView( 2 ); } );
await sleep( 3000 );

const layout = await page.evaluate( () => ( {
	touch: document.body.classList.contains( 'is-touch' ),
	ui: getComputedStyle( document.getElementById( 'touch-ui' ) ).display,
	keys: getComputedStyle( document.querySelector( '.keys' ) ).display,
	folded: document.getElementById( 'side' ).classList.contains( 'collapsed' )
} ) );
check( 'touch-only screen: touch layout from the start', layout.touch && layout.ui === 'block' && layout.keys === 'none' && layout.folded, JSON.stringify( layout ) );
await page.screenshot( { path: `shots/${ prefix }_layout.png` } );

// the stick: up on the screen flies forward along the view
let a = await cam();
await drag( [ [ 120, 300 ] ], [ [ 120, 250 ] ], 300, 1500 );
await sleep( 300 );
let b = await cam();
const fwd = await page.evaluate( ( p0, p1 ) => {
	const a = window.__app, d = a.camera.getWorldDirection( a.camera.position.clone() );
	return ( ( p1[ 0 ] - p0[ 0 ] ) * d.x + ( p1[ 2 ] - p0[ 2 ] ) * d.z ) / Math.hypot( d.x, d.z );
}, a.p, b.p );
check( 'stick up: flies forward', fwd > 10, `${ fwd.toFixed( 1 ) } m forward` );
await page.screenshot( { path: `shots/${ prefix }_stick.png` } );

// sideways
a = await cam();
await drag( [ [ 120, 300 ] ], [ [ 175, 300 ] ], 300, 1000 );
await sleep( 300 );
b = await cam();
check( 'stick right: flies sideways', dist2( a, b ) > 5 && Math.abs( a.yaw - b.yaw ) < 1e-6, `${ dist2( a, b ).toFixed( 1 ) } m` );

// one finger on the view looks
a = await cam();
await drag( [ [ 560, 200 ] ], [ [ 460, 180 ] ], 500 );
b = await cam();
check( 'one finger: looks', b.yaw - a.yaw > 0.2 && dist2( a, b ) < 1, `yaw +${ ( b.yaw - a.yaw ).toFixed( 2 ) } rad` );

// two fingers spreading fly forward
a = await cam();
await drag( [ [ 470, 200 ], [ 560, 200 ] ], [ [ 400, 200 ], [ 630, 200 ] ], 600 );
b = await cam();
check( 'pinch out: flies forward', dist2( a, b ) > 5, `${ dist2( a, b ).toFixed( 1 ) } m` );

// the up button, held
a = await cam();
const up = await page.evaluate( () => { const r = document.querySelector( '.t-btn[data-act="up"]' ).getBoundingClientRect(); return [ r.x + r.width / 2, r.y + r.height / 2 ]; } );
await touch( 'touchStart', [ up ] ); await sleep( 1200 ); await touch( 'touchEnd', [] );
await sleep( 300 );
b = await cam();
check( '▲ held: rises', b.p[ 1 ] - a.p[ 1 ] > 5, `+${ ( b.p[ 1 ] - a.p[ 1 ] ).toFixed( 1 ) } m` );

// a tap on the view focuses there (the toast says where)
await touch( 'touchStart', [ [ 422, 260 ] ] ); await sleep( 80 ); await touch( 'touchEnd', [] );
await sleep( 400 );
const toast = await page.evaluate( () => document.getElementById( 'toast' ).textContent );
check( 'tap: focus', /Foco/.test( toast ), toast );

// dynamic resolution: the scene pass at 62.5%, the HUD readout, a capture at full size
const res = await page.evaluate( async () => {
	const a = window.__app;
	a.dynamicRes = true; // (off above: the loop would undo a forced scale)
	a.dynRes.set( 0.625 );
	await new Promise( ( r ) => setTimeout( r, 600 ) );
	const st = document.getElementById( 'st-res' );
	const out = { scale: a.scenePass.getResolutionScale(), rt: [ a.scenePass.renderTarget.width, a.scenePass.renderTarget.height ], canvas: [ a.renderer.domElement.width, a.renderer.domElement.height ], readout: st.hidden ? '' : st.textContent };
	await a.capture( '_touch_tmp', 960, 540 );
	out.afterCapture = a.scenePass.getResolutionScale();
	return out;
} );
check( 'dynamic resolution: the scene pass only, readout shown', res.scale === 0.625 && res.rt[ 0 ] < res.canvas[ 0 ] && res.readout === '63% res', JSON.stringify( res ) );
check( 'capture at full size, the scale back after it', res.afterCapture === 0.625 );
await page.screenshot( { path: `shots/${ prefix }_res62.png` } );
await page.evaluate( () => { const a = window.__app; a.dynRes.set( 1 ); a.dynamicRes = false; } );

// the mouse brings the desktop layout back
await page.mouse.click( 300, 120 );
await sleep( 300 );
const back = await page.evaluate( () => document.body.classList.contains( 'is-touch' ) );
check( 'a mouse click: desktop layout', ! back );

check( 'no errors', errors.length === 0, errors.join( ' | ' ) );
await browser.close();
console.log( fail.length ? 'FAILED: ' + fail.join( '; ' ) : 'all ok' );
process.exit( fail.length ? 1 : 0 );
