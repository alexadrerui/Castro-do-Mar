// The panel's "Opções" (core/settings.js) with real clicks: the quality presets (and what they set),
// kept after a reload; the sound (button, M, volume); the editor opened and left on the same view;
// the renderer switched to WebGL 2 and back on the same view. Captures shots/<prefixo>_*.png.
//   node tools/options.mjs [prefixo] [--no-webgl]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) ) || 'options';
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
const ready = () => page.waitForFunction( () => window.__app && window.__app.ready && window.__app.settings, { timeout: 300000, polling: 500 } );
const state = () => page.evaluate( () => {
	const a = window.__app, c = a.camera.position;
	return { url: location.search, quality: a.settings.quality, pixelRatio: a.pixelRatio, shadows: a.shadowsOn, focus: a.focus.enabled, ao: a.ao.level, msaa: a.msaa, aoSeg: document.querySelector( '#o-ao button.on' )?.dataset.ao,
		muted: a.settings.muted, volume: a.settings.volume, thunder: a.lightning.sound, backend: a.backendName, editor: !! a.editor,
		cam: [ c.x, c.y, c.z ].map( ( v ) => Math.round( v ) ), seg: document.querySelector( '#o-quality button.on' )?.dataset.q,
		audioBtn: document.getElementById( 'b-audio' ).textContent, editorBtn: document.getElementById( 'b-editor' ).textContent,
		renderer: document.getElementById( 'o-renderer' ).textContent, tip: document.getElementById( 't-renderer' ).textContent };
} );
const log = ( step, s ) => console.log( step.padEnd( 18 ), JSON.stringify( s ) );
const fail = [];
const check = ( what, ok ) => { if ( ! ok ) fail.push( what ); console.log( ok ? '  ok  ' : '  FAIL', what ); };
const settle = ( ms = 1200 ) => new Promise( ( r ) => setTimeout( r, ms ) );

await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await ready();
// the loader fades out over 1.2 s and takes the clicks until then
await page.waitForFunction( () => getComputedStyle( document.getElementById( 'loader' ) ).visibility === 'hidden', { timeout: 20000 } );
await page.evaluate( () => localStorage.removeItem( 'castroDoMar:settings' ) );
let s = await state(); log( 'start', s );
check( 'first visit: Média, look untouched (shadows on)', s.quality === 'media' && s.seg === 'media' && s.pixelRatio === 1 && s.shadows && s.ao === 'low' && s.aoSeg === 'low' && s.msaa === 4 );

await page.click( '#o-quality button[data-q="baixa"]' ); await settle();
s = await state(); log( 'Baixa', s );
check( 'Baixa: 0.75x, no focus, no AO', s.quality === 'baixa' && s.pixelRatio === 0.75 && ! s.focus && s.seg === 'baixa' && s.ao === 'off' && s.aoSeg === 'off' );
// the ambient occlusion by hand: the preset goes custom
await page.click( '#o-ao button[data-ao="high"]' ); await settle( 600 );
s = await state(); check( 'AO by hand: high, preset custom', s.ao === 'high' && s.aoSeg === 'high' && await page.evaluate( () => document.getElementById( 'o-quality' ).classList.contains( 'custom' ) ) );
await page.click( '#o-ao button[data-ao="off"]' ); await settle( 600 );
await page.screenshot( { path: `shots/${ prefix }_panel.png`, clip: { x: 1300, y: 60, width: 300, height: 780 } } );

await page.click( '#b-audio' ); await settle( 300 );
s = await state(); check( 'audio button mutes', s.muted && ! s.thunder && s.audioBtn.includes( 'Mudo' ) );

// a view of our own, to see it kept across the reloads
await page.evaluate( () => window.__app.goView( 4 ) ); await settle( 2500 );
const view = ( await state() ).cam;

await page.reload( { waitUntil: 'domcontentloaded' } ); await ready(); await settle( 2000 );
s = await state(); log( 'reloaded', s );
check( 'kept after reload: Baixa, muted, no MSAA (FXAA)', s.quality === 'baixa' && s.pixelRatio === 0.75 && s.muted && ! s.thunder && s.msaa === 0 );
await page.screenshot( { path: `shots/${ prefix }_baixa.png` } );

await page.click( '#o-quality button[data-q="alta"]' ); await settle();
await page.keyboard.press( 'm' ); await settle( 300 );
s = await state(); log( 'Alta + M', s );
check( 'Alta: shadows on, AO high; M unmutes', s.quality === 'alta' && s.shadows && s.focus && s.ao === 'high' && ! s.muted && s.thunder );

// the editor, on the same view
await page.evaluate( () => window.__app.goView( 4 ) ); await settle( 2500 );
await Promise.all( [ page.waitForNavigation( { waitUntil: 'domcontentloaded' } ), page.click( '#b-editor' ) ] );
await ready(); await settle( 1500 );
s = await state(); log( 'editor', s );
check( 'editor opened (?edit&auto)', s.editor && /edit/.test( s.url ) && s.editorBtn === 'Sair do editor' );
check( 'editor: same view', s.cam.every( ( v, i ) => Math.abs( v - view[ i ] ) < 2 ) );
check( 'editor: quality kept', s.quality === 'alta' && s.shadows );
await page.screenshot( { path: `shots/${ prefix }_editor.png` } );
await Promise.all( [ page.waitForNavigation( { waitUntil: 'domcontentloaded' } ), page.click( '#b-editor' ) ] );
await ready(); await settle( 1500 );
s = await state(); log( 'left editor', s );
check( 'editor left, same view', ! s.editor && ! /edit/.test( s.url ) && s.cam.every( ( v, i ) => Math.abs( v - view[ i ] ) < 2 ) );

if ( ! args.includes( '--no-webgl' ) ) {
	await Promise.all( [ page.waitForNavigation( { waitUntil: 'domcontentloaded' } ), page.click( '#b-renderer' ) ] );
	await ready(); await settle( 1500 );
	s = await state(); log( 'WebGL', s );
	check( 'renderer: WebGL 2, same view', s.backend === 'WebGL 2' && s.renderer === 'WebGL 2' && /webgl/.test( s.url ) && s.tip.length > 0 && s.cam.every( ( v, i ) => Math.abs( v - view[ i ] ) < 2 ) );
	await page.screenshot( { path: `shots/${ prefix }_webgl.png` } );
	await Promise.all( [ page.waitForNavigation( { waitUntil: 'domcontentloaded' } ), page.click( '#b-renderer' ) ] );
	await ready(); await settle( 1500 );
	s = await state(); log( 'WebGPU', s );
	check( 'renderer: back to WebGPU', s.backend === 'WebGPU' && ! /webgl/.test( s.url ) );
}

await page.evaluate( () => localStorage.removeItem( 'castroDoMar:settings' ) );
console.log( errors.length ? 'page errors:\n' + errors.join( '\n' ) : 'no page errors' );
console.log( fail.length ? 'FAILED: ' + fail.join( '; ' ) : 'ALL OK' );
await browser.close();
process.exit( fail.length || errors.length ? 1 : 0 );
