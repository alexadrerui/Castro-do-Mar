// The debug panel (ui/debug.js): opens with #debug, the backquote key hides and shows it, a few of its
// controls really change the app (a cloud slider, a key frame of the look, the shadows' reach), the
// stats-gl panel is there, no errors; and without #debug nothing of it is loaded. Captures
// shots/<prefixo>_panel.png (the page with the panel open).
//   node tools/debugpanel.mjs [prefixo]
import puppeteer from 'puppeteer-core';

const prefix = process.argv.slice( 2 ).find( ( x ) => ! x.startsWith( '--' ) ) || 'debug';
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const fail = [];
const check = ( what, ok, extra = '' ) => { if ( ! ok ) fail.push( what ); console.log( ok ? '  ok  ' : '  FAIL', what, extra ); };
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const open = async ( url ) => {
	const page = await browser.newPage();
	const errors = [], scripts = [];
	page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
	page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
	page.on( 'request', ( r ) => { if ( /tweakpane|stats-gl|debug\.js/.test( r.url() ) ) scripts.push( r.url() ); } );
	await page.goto( url, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 500 } );
	await page.waitForFunction( () => getComputedStyle( document.getElementById( 'loader' ) ).visibility === 'hidden', { timeout: 20000 } );
	return { page, errors, scripts };
};

// without #debug: nothing loaded
let { page, errors, scripts } = await open( 'http://localhost:5190/?auto' );
await sleep( 1500 );
check( 'without #debug: no panel, nothing of it loaded', ! ( await page.evaluate( () => !! window.__app.debug ) ) && scripts.length === 0, scripts.join( ' ' ) );
await page.close();

( { page, errors, scripts } = await open( 'http://localhost:5190/?auto#debug' ) );
await page.waitForFunction( () => window.__app.debug, { timeout: 20000 } );
await sleep( 1500 );
const st = await page.evaluate( () => {
	const d = window.__app.debug;
	return { folders: d.pane.children.map( ( c ) => c.title ), stats: !! d.stats && !! document.body.contains( d.stats.dom ) };
} );
console.log( '  folders:', JSON.stringify( st.folders ) );
check( 'with #debug: the panel and its folders', st.folders.length >= 10 );
check( 'stats-gl on the page', st.stats );

// the backquote hides and shows it
await page.keyboard.press( 'Backquote' );
const hidden = await page.evaluate( () => window.__app.debug.pane.hidden );
await page.keyboard.press( 'Backquote' );
const shown = await page.evaluate( () => ! window.__app.debug.pane.hidden );
check( 'backquote hides and shows it', hidden && shown );

// controls reach the app: open the cloud folder and drag nothing, set through the bindings instead
const r = await page.evaluate( () => {
	const a = window.__app, d = a.debug.pane;
	const find = ( title ) => d.children.find( ( c ) => c.title === title );
	const out = {};
	// a cloud slider (bound to the uniform itself)
	const clouds = find( 'Céu e nuvens' );
	const b = clouds.children.find( ( c ) => c.label === 'cirros' );
	b.controller.value.setRawValue( 2.2 );
	out.cirrus = a.clouds?.cirrus.value;
	// the shadows' reach
	const sh = find( 'Sombras do sol' );
	sh.children.find( ( c ) => c.label === 'árvores e pedras (m)' ).controller.value.setRawValue( 400 );
	out.reach = a.shadows.reach;
	// a key frame of the look: the 15:32 row's exposure, then back
	const look = find( 'Hora e visual' ), keyF = look.children.find( ( c ) => c.title === 'Quadro-chave' );
	const keys = a.look.keys, i = keys.findIndex( ( k ) => Math.abs( k.h - ( 15 + 32 / 60 ) ) < 1e-6 );
	keyF.children[ 0 ].controller.value.setRawValue( i );
	const exp = keyF.children.find( ( c ) => c.label === 'exposure' );
	exp.controller.value.setRawValue( 1.1 );
	out.keyExposure = keys[ i ].exposure; out.rendererExposure = +a.renderer.toneMappingExposure.toFixed( 3 );
	exp.controller.value.setRawValue( 0.8 );
	out.back = +a.renderer.toneMappingExposure.toFixed( 3 );
	return out;
} );
console.log( '  ', JSON.stringify( r ) );
check( 'a cloud slider changes the clouds', Math.abs( r.cirrus - 2.2 ) < 1e-6 );
check( "the shadows' reach changes", r.reach === 400 );
check( 'a key frame of the look changes the exposure at that hour', r.keyExposure === 1.1 && r.rendererExposure === 1.1 && r.back === 0.8 );
await page.screenshot( { path: `shots/${ prefix }_panel.png` } );
check( 'no errors', errors.length === 0, errors.join( ' | ' ) );
await browser.close();
console.log( fail.length ? 'FAILED: ' + fail.join( '; ' ) : 'all ok' );
process.exit( fail.length ? 1 : 0 );
