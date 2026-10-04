// The panel's wind (hud.js _bindWind, world/wind.js, world/windField.js) with real clicks: opens the
// settings, moves the five sliders and checks the uniforms, switches the breakdown "Campo de vento"
// on (shots/<prefixo>_field.png, and with the wind from the east: _field_east.png), restores.
//   node tools/windpanel.mjs [prefixo]
import puppeteer from 'puppeteer-core';

const prefix = process.argv.slice( 2 ).find( ( x ) => ! x.startsWith( '--' ) ) || 'windpanel';
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
await page.waitForFunction( () => getComputedStyle( document.getElementById( 'loader' ) ).visibility === 'hidden', { timeout: 20000 } );
const fail = [];
const check = ( what, ok ) => { if ( ! ok ) fail.push( what ); console.log( ok ? '  ok  ' : '  FAIL', what ); };
const state = () => page.evaluate( async () => {
	const v = ( id ) => document.getElementById( id ).value;
	return { panel: ! document.getElementById( 'wind-panel' ).hidden, field: !! window.__app.windField?.visible,
		strength: v( 'r-wstrength' ), speed: v( 'r-wspeed' ), freq: v( 'r-wfreq' ), dir: v( 'r-wdir' ), turb: v( 'r-wturb' ),
		outDir: document.getElementById( 'o-wdir' ).textContent };
} );
const slide = ( id, value ) => page.evaluate( ( id, value ) => { const r = document.getElementById( id ); r.value = value; r.dispatchEvent( new Event( 'input' ) ); }, id, value );
const shot = ( name ) => page.evaluate( async ( n ) => { await window.__app.capture( n ); await window.__app.capture( n ); }, `${ prefix }_${ name }` );

await page.click( '#b-wind' );
let s = await state(); console.log( JSON.stringify( s ) );
check( 'button opens the settings', s.panel );
check( 'defaults: 1 / 5.5 / 1 / 218 SO / 1', s.strength === '1' && s.speed === '5.5' && s.freq === '1' && s.dir === '218' && /SO/.test( s.outDir ) && s.turb === '1' );
await slide( 'r-wstrength', 2 ); await slide( 'r-wspeed', 12 ); await slide( 'r-wfreq', 2 ); await slide( 'r-wturb', 0.5 );
// the uniforms the materials read, through the app's own module (window.__app.windUniforms)
const u = await page.evaluate( () => { const w = window.__app.wind; return w && { strength: w.strength.value, speed: w.speed.value, freq: w.freq.value, turb: w.turb.value }; } );
console.log( 'uniforms', JSON.stringify( u ) );
check( 'sliders drive the wind', u && u.strength === 2 && u.speed === 12 && u.freq === 2 && u.turb === 0.5 );
await page.evaluate( () => window.__app.setView( 2 ) );
await page.click( '#c-windfield' );
await page.waitForFunction( () => window.__app.windField?.visible, { timeout: 20000 } );
await new Promise( ( r ) => setTimeout( r, 1500 ) );
await shot( 'field' );
s = await state(); check( 'breakdown on', s.field );
await slide( 'r-wdir', 90 );
const d = await page.evaluate( () => window.__app.wind.dir.value.toArray().map( ( v ) => + v.toFixed( 3 ) ) );
console.log( 'dir from east ->', d );
check( 'from the east blows west (-x)', d[ 0 ] < - 0.99 && Math.abs( d[ 1 ] ) < 0.01 );
await shot( 'field_east' );
await page.click( '#b-windfield' );
s = await state(); check( 'breakdown off from the button', ! s.field );
await page.click( '#b-wreset' );
s = await state(); const u2 = await page.evaluate( () => { const w = window.__app.wind; return { strength: w.strength.value, speed: w.speed.value, freq: w.freq.value, turb: w.turb.value }; } );
check( 'restored', s.strength === '1' && s.dir === '218' && u2.strength === 1 && u2.speed === 5.5 && u2.freq === 1 && u2.turb === 1 );
await page.click( '#b-wind' );
s = await state(); check( 'button closes the settings', ! s.panel );
console.log( errors.length ? 'page errors:\n' + errors.join( '\n' ) : 'no page errors' );
console.log( fail.length ? 'FAILED: ' + fail.join( '; ' ) : 'ALL OK' );
await browser.close();
process.exit( fail.length || errors.length ? 1 : 0 );
