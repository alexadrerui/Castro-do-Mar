// QA of the editor's tabs (editor/tabs.js): ?edit opens with no tab (no panel, nothing edits, the left
// button looks around); Relevo and Água show the relief tools and the water ones (rivers, lakes, dig,
// fill) of the same panel, each back on its own tool; a click on the open tab closes it; "Salvar e
// aplicar" reloads on the tab it was pressed in. Real clicks on the tab buttons. Captures each state.
//   node tools/editortabs.mjs [prefix]   (exits 1 on a failed check; writes no edits)
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'etabs';
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 300 ) ); } );
const fail = [];
const check = ( what, ok, extra = '' ) => { if ( ! ok ) fail.push( what ); console.log( ok ? 'ok  ' : 'FAIL', what, extra ); };
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const state = () => page.evaluate( () => {
	const a = window.__app, shown = ( id ) => { const e = document.getElementById( id ); return !! e && getComputedStyle( e ).display !== 'none'; };
	const tools = [ ...document.querySelectorAll( '#terrain-editor [data-tool]' ) ].filter( ( b ) => getComputedStyle( b ).display !== 'none' ).map( ( b ) => b.dataset.tool );
	return {
		tab: a.editorTab, on: [ ...document.querySelectorAll( '#editor-tabs button.on' ) ].map( ( b ) => b.dataset.tab ),
		terrain: shown( 'terrain-editor' ), objects: shown( 'object-editor' ), title: document.querySelector( '#terrain-editor .title' )?.textContent,
		tools, tool: a.editor.tool, sculpts: a.editor.active, look: a.freecam.leftLook,
		water: getComputedStyle( document.querySelector( '#terrain-editor fieldset.water' ) ).display !== 'none',
		gen: getComputedStyle( document.querySelector( '#terrain-editor fieldset.gen' ) ).display !== 'none'
	};
} );
const tab = async ( t ) => { await page.click( `#editor-tabs [data-tab=${ t }]` ); await sleep( 250 ); };

await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready && window.__app.setEditorTab, { timeout: 300000, polling: 250 } );
await sleep( 500 );
let s = await state();
check( 'opens with no tab: no panel, nothing edits, the left button looks', s.tab === null && ! s.on.length && ! s.terrain && ! s.objects && ! s.sculpts && s.look, JSON.stringify( s ) );
await page.screenshot( { path: `shots/${ prefix }_0_closed.png` } );

await tab( 'relief' ); s = await state();
check( 'Relevo: relief tools only, the generator, sculpting', s.tab === 'relief' && s.terrain && s.title === 'Editor de relevo' && s.tools.join() === 'raise,lower,smooth,flatten,noise,restore,generate' && s.gen && ! s.water && s.sculpts && ! s.look, JSON.stringify( s ) );
await page.screenshot( { path: `shots/${ prefix }_1_relief.png` } );
await page.click( '#terrain-editor [data-tool=smooth]' );

await tab( 'water' ); s = await state();
check( 'Água: rivers, lakes, dig and fill, its first tool Rio', s.tab === 'water' && s.title === 'Rios e lagos' && s.tools.join() === 'river,riveredit,lake,dig,fill' && s.water && ! s.gen && s.tool === 'river' && s.sculpts, JSON.stringify( s ) );
await page.screenshot( { path: `shots/${ prefix }_2_water.png` } );
await page.click( '#terrain-editor [data-tool=lake]' );

await tab( 'relief' ); s = await state();
check( 'back to Relevo: on the tool it had (Suavizar)', s.tool === 'smooth', s.tool );
await tab( 'water' ); s = await state();
check( 'back to Água: on the tool it had (Encher)', s.tool === 'lake', s.tool );

await tab( 'water' ); s = await state();
check( 'a click on the open tab closes it', s.tab === null && ! s.terrain && ! s.sculpts && s.look, JSON.stringify( s ) );

await tab( 'objects' ); s = await state();
check( 'Objetos: its panel, the relief one hidden', s.tab === 'objects' && s.objects && ! s.terrain && ! s.sculpts, JSON.stringify( s ) );

// "Salvar e aplicar" with nothing changed reloads: back on the tab it was pressed in (Água)
await tab( 'water' );
await Promise.all( [ page.waitForNavigation( { waitUntil: 'domcontentloaded', timeout: 120000 } ), page.click( '#terrain-editor [data-act=save]' ) ] );
await page.waitForFunction( () => window.__app?.ready && window.__app.setEditorTab, { timeout: 300000, polling: 250 } );
await sleep( 500 );
s = await state();
check( 'after "Salvar e aplicar": the page reloads on the same tab', s.tab === 'water' && s.terrain && s.title === 'Rios e lagos', JSON.stringify( s ) );
// and a plain reload (or a new visit) opens closed again
await page.reload( { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready && window.__app.setEditorTab, { timeout: 300000, polling: 250 } );
await sleep( 500 );
s = await state();
check( 'a plain reload opens with no tab again', s.tab === null && ! s.terrain, JSON.stringify( s ) );

check( 'no page errors', ! errors.length, errors.join( ' | ' ) );
await browser.close();
console.log( fail.length ? 'FAILED: ' + fail.join( '; ' ) : 'all ok' );
process.exit( fail.length ? 1 : 0 );
