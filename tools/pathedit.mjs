// QA of the "Caminhos" tab (editor/pathEditor.js, world/worldEdits.js paths), with real clicks: lays a
// new track (the box beside it, Concluir), edits a village path (hover lit, click, a handle, the width,
// Enter), lays a second track and removes it, saves, reloads in the normal mode and checks that PATHS
// and the terrain mask's dirt follow (the moved stretch painted, the old one not). Deletes the test
// public/world-edits.json (does not run if one exists). shots/<prefixo>_{draw,edit}.png
//   node tools/pathedit.mjs [prefixo]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'pathedit';
const FILE = 'public/world-edits.json';
if ( fs.existsSync( FILE ) ) { console.log( `${ FILE } exists: not touching it` ); process.exit( 1 ); }
const browser = await puppeteer.launch( { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ], defaultViewport: { width: 1600, height: 900 } } );
const page = await browser.newPage();
const errors = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + String( e ).slice( 0, 300 ) ) );
let fails = 0;
const check = ( ok, msg ) => { console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ msg }` ); if ( ! ok ) fails ++; };
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const screen = ( x, z ) => page.evaluate( ( x, z ) => {
	const a = window.__app, v = new a.THREE.Vector3( x, Math.max( a.hf.heightAt( x, z ), 0 ), z ).project( a.camera ), rc = a.renderer.domElement.getBoundingClientRect();
	return { x: rc.left + ( v.x * 0.5 + 0.5 ) * rc.width, y: rc.top + ( 0.5 - v.y * 0.5 ) * rc.height };
}, x, z );
const click = async ( p, mods = [] ) => { await page.mouse.move( p.x, p.y ); await sleep( 150 ); for ( const k of mods ) await page.keyboard.down( k ); await page.mouse.down(); await sleep( 60 ); await page.mouse.up(); for ( const k of mods ) await page.keyboard.up( k ); await sleep( 250 ); };
const shot = async ( n ) => { await sleep( 300 ); await page.screenshot( { path: `shots/${ prefix }_${ n }.png` } ); };
// the terrain mask's path channel (R) at a point
const dirt = ( x, z ) => page.evaluate( ( x, z ) => {
	const a = window.__app, M = a.MASK ?? null;
	const m = a.mask, res = Math.round( Math.sqrt( m.length / 4 ) );
	const L = a.maskInfo;
	const i = Math.floor( ( x - L.x0 ) / L.size * res ), j = Math.floor( ( z - L.z0 ) / L.size * res );
	return m[ ( j * res + i ) * 4 ] / 255;
}, x, z );

try {
	await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready && window.__app.pathEditor, { timeout: 300000, polling: 250 } );
	await page.waitForFunction( () => getComputedStyle( document.getElementById( 'loader' ) ).visibility === 'hidden', { timeout: 20000 } );
	await page.click( '#editor-tabs [data-tab=paths]' ); await sleep( 300 );
	let s = await page.evaluate( () => ( { shown: document.getElementById( 'path-editor' ).style.display !== 'none', relief: document.getElementById( 'terrain-editor' ).style.display } ) );
	check( s.shown && s.relief === 'none', 'aba Caminhos: o painel dela aparece, o do Relevo some' );
	// over a meadow south-west of the village, seen from above
	const plan = [ [ - 150, 40 ], [ - 135, 55 ], [ - 118, 62 ], [ - 100, 75 ] ];
	await page.evaluate( () => { const a = window.__app, ed = a.editor; ed.hit = new a.THREE.Vector3( - 110, a.hf.heightAt( - 110, 50 ), 50 ); ed.toggleOverhead( 45 ); } );
	await sleep( 2500 );
	for ( const [ x, z ] of plan ) await click( await screen( x, z ) );
	s = await page.evaluate( () => { const b = window.__app.pathEditor.drawBox; return { shown: b.style.display !== 'none', text: b.querySelector( '.name' ).textContent, pts: window.__app.pathEditor.points.length }; } );
	check( s.shown && s.pts === 4 && /4 pontos/.test( s.text ), `traçar: ${ s.pts } pontos, caixa "${ s.text }"` );
	await shot( 'draw' );
	await ( await page.$( '.river-menu [data-act=done]:not([disabled])' ) ? page.evaluate( () => window.__app.pathEditor.drawBox.querySelector( '[data-act=done]' ).click() ) : null );
	await sleep( 400 );
	s = await page.evaluate( () => ( { added: window.__app.objectEditor.edits.paths.added.length, changed: window.__app.objectEditor.changed } ) );
	check( s.added === 1 && s.changed, 'Concluir pela caixa: caminho novo nas edições do mundo' );

	// edit the main road (PATHS c0): hover, click, a handle, the width, Enter
	await page.click( '#path-editor [data-mode=edit]' ); await sleep( 300 );
	const road = await page.evaluate( () => { const p = window.__app.pathEditor.list.find( ( q ) => q.id === 'c0' ); return p.pts; } );
	await page.evaluate( ( p ) => { const a = window.__app; a.editor.hit = new a.THREE.Vector3( p[ 0 ], a.hf.heightAt( p[ 0 ], p[ 1 ] ), p[ 1 ] ); a.editor.toggleOverhead( 45 ); a.editor.toggleOverhead( 45 ); }, road[ 3 ] );
	await sleep( 2500 );
	const mid = road[ 3 ];
	const ms = await screen( mid[ 0 ], mid[ 1 ] );
	await page.mouse.move( ms.x, ms.y ); await sleep( 500 );
	s = await page.evaluate( () => ( { lit: window.__app.pathEditor.hoverLine.visible, cursor: window.__app.renderer.domElement.style.cursor } ) );
	check( s.lit && s.cursor === 'pointer', 'editar: o caminho sob o cursor fica destacado, cursor de mão' );
	await click( ms );
	s = await page.evaluate( () => { const P = window.__app.pathEditor; return { sel: P.sel?.id, handles: P.handles.length, box: P.editBox.style.display !== 'none' }; } );
	check( s.sel === 'c0' && s.handles === road.length && s.box, `clique: estrada selecionada (${ s.handles } alças, caixa de edição)` );
	await shot( 'edit' );
	const hp = await page.evaluate( () => { const a = window.__app, h = a.pathEditor.handles[ 3 ].position, v = h.clone().project( a.camera ), rc = a.renderer.domElement.getBoundingClientRect(); return { x: rc.left + ( v.x * 0.5 + 0.5 ) * rc.width, y: rc.top + ( 0.5 - v.y * 0.5 ) * rc.height }; } );
	await click( hp );
	const moved = await page.evaluate( () => {
		const P = window.__app.pathEditor, h = P.handles[ 3 ];
		const was = [ h.position.x, h.position.z ];
		h.position.z += 22; P._handleMoved(); // (the drag itself: TransformControls)
		const w = P.editBox.querySelector( '[data-k=w]' ); w.value = 5; w.dispatchEvent( new Event( 'input' ) );
		return { picked: P.picked, was, now: [ h.position.x, h.position.z ] };
	} );
	check( moved.picked === 3, 'clique na alça 3: escolhida' );
	await page.keyboard.press( 'Enter' ); await sleep( 400 );
	s = await page.evaluate( () => window.__app.objectEditor.edits.paths.changed.c0 );
	check( s && s.w === 5 && Math.abs( s.pts[ 3 ][ 1 ] - moved.now[ 1 ] ) < 0.05 && Array.isArray( s.o ), `Enter: estrada alterada nas edições (ponto 3 movido, largura ${ s?.w } m, guarda do 1º ponto)` );

	// a second new track, removed from the box
	await page.click( '#path-editor [data-mode=draw]' );
	for ( const [ x, z ] of [ [ - 160, 90 ], [ - 140, 110 ] ] ) await click( await screen( x, z ) );
	await page.keyboard.press( 'Enter' ); await sleep( 300 );
	await page.click( '#path-editor [data-mode=edit]' ); await sleep( 300 );
	await click( await screen( - 150, 100 ) );
	await page.evaluate( () => window.__app.pathEditor.editBox.querySelector( '[data-act=remove]' ).click() ); await sleep( 300 );
	s = await page.evaluate( () => ( { added: window.__app.objectEditor.edits.paths.added.length, list: window.__app.pathEditor.list.length } ) );
	check( s.added === 1, 'segundo caminho traçado e removido pela caixa: sobra um caminho novo' );

	// save, reload in the normal mode
	await page.evaluate( () => window.__app.editor.save() ).catch( () => {} );
	await sleep( 3000 );
	check( fs.existsSync( FILE ), 'salvo: world-edits.json' );
	await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
	s = await page.evaluate( ( mv ) => {
		const a = window.__app;
		return { n: a.paths?.length, road: a.paths?.find( ( p ) => p._id === 'c0' ), added: a.paths?.filter( ( p ) => p.added ).length };
	}, moved );
	check( s.road && s.road.w === 5 && Math.abs( s.road.pts[ 3 ][ 1 ] - moved.now[ 1 ] ) < 0.05 && s.added === 1, `depois de recarregar: PATHS com a estrada alterada (largura ${ s.road?.w }) e 1 caminho novo` );
	const dNew = await dirt( moved.now[ 0 ], moved.now[ 1 ] ), dOld = await dirt( moved.was[ 0 ], moved.was[ 1 ] ), dTrack = await dirt( ( plan[ 1 ][ 0 ] + plan[ 2 ][ 0 ] ) / 2, ( plan[ 1 ][ 1 ] + plan[ 2 ][ 1 ] ) / 2 );
	check( dNew > 0.5 && dOld < dNew && dTrack > 0.4, `terra pintada: no trecho movido ${ dNew.toFixed( 2 ) }, onde a estrada passava ${ dOld.toFixed( 2 ) }, no caminho novo ${ dTrack.toFixed( 2 ) }` );
} finally {
	if ( fs.existsSync( FILE ) ) { fs.unlinkSync( FILE ); console.log( 'test world-edits.json deleted' ); }
	console.log( errors.length ? 'page errors:\n' + errors.join( '\n' ) : 'no page errors' );
	console.log( fails ? `FAILED: ${ fails }` : 'ALL OK' );
	await browser.close();
}
process.exit( fails || errors.length ? 1 : 0 );
