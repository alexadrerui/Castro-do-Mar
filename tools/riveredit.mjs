// QA of the river tool's boxes and of editing a laid river (editor/riverEdit.js), with real clicks:
// lays part of a course and checks the box beside it (Concluir / Tirar último / Cancelar), finishes it
// from the box, "Selecionar rio" + a click on it (handles, the course with its banks, the chevrons, the
// edit box), moves a point and the width, Enter (the old bed put back, the new one carved), then removes
// it from the box (the relief back). Nothing is saved. shots/<prefixo>_{draw,edit,applied}.png
//   node tools/riveredit.mjs [prefixo] [--x=-95 --z=40]
import puppeteer from 'puppeteer-core';

const arg = ( k, d ) => Number( ( process.argv.find( ( a ) => a.startsWith( `--${ k }=` ) ) || `=${ d }` ).split( '=' )[ 1 ] );
const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'riveredit';
const X = arg( 'x', - 95 ), Z = arg( 'z', 40 );
const browser = await puppeteer.launch( { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ], defaultViewport: { width: 1600, height: 900 } } );
const page = await browser.newPage();
const errors = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + String( e ).slice( 0, 300 ) ) );
let fails = 0;
const check = ( ok, msg ) => { console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ msg }` ); if ( ! ok ) fails ++; };
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const screen = ( x, z, lift = 0 ) => page.evaluate( ( x, z, lift ) => {
	const a = window.__app, v = new a.THREE.Vector3( x, Math.max( a.hf.heightAt( x, z ), 0 ) + lift, z ).project( a.camera ), rc = a.renderer.domElement.getBoundingClientRect();
	return { x: rc.left + ( v.x * 0.5 + 0.5 ) * rc.width, y: rc.top + ( 0.5 - v.y * 0.5 ) * rc.height, inside: Math.abs( v.x ) < 0.98 && Math.abs( v.y ) < 0.98 };
}, x, z, lift );
const click = async ( p, mods = [] ) => { await page.mouse.move( p.x, p.y ); await sleep( 120 ); for ( const k of mods ) await page.keyboard.down( k ); await page.mouse.down(); await sleep( 60 ); await page.mouse.up(); for ( const k of mods ) await page.keyboard.up( k ); await sleep( 250 ); };
// the whole page (the boxes are HTML over the canvas)
const shot = async ( n ) => { await sleep( 300 ); await page.screenshot( { path: `shots/${ prefix }_${ n }.png` } ); };

await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready && window.__app.editor && window.__app.objectEditor, { timeout: 300000, polling: 250 } );
await page.waitForFunction( () => getComputedStyle( document.getElementById( 'loader' ) ).visibility === 'hidden', { timeout: 20000 } );
// a course downhill (as tools/river.mjs)
const plan = await page.evaluate( ( X, Z ) => {
	const hf = window.__app.hf, pts = [ [ X, Z ] ];
	for ( let k = 0; k < 7; k ++ ) {
		const [ x, z ] = pts.at( - 1 ), h = hf.heightAt( x, z );
		if ( h < 0.3 ) break;
		let best = null;
		for ( let q = 0; q < 16; q ++ ) {
			const ang = q / 16 * Math.PI * 2, nx = x + Math.cos( ang ) * 25, nz = z + Math.sin( ang ) * 25;
			if ( pts.length > 1 ) { const [ px, pz ] = pts.at( - 2 ); if ( ( nx - x ) * ( x - px ) + ( nz - z ) * ( z - pz ) < 0 ) continue; }
			const nh = hf.heightAt( nx, nz );
			if ( ! best || nh < best.h ) best = { x: nx, z: nz, h: nh };
		}
		if ( ! best || best.h > h + 1 ) break;
		pts.push( [ best.x, best.z ] );
	}
	return pts;
}, X, Z );
await page.click( '#terrain-editor [data-tool=river]' );
await page.evaluate( ( pts ) => {
	const a = window.__app, ed = a.editor, m = pts[ Math.floor( pts.length / 2 ) ];
	ed.hit = new a.THREE.Vector3( m[ 0 ], a.hf.heightAt( m[ 0 ], m[ 1 ] ), m[ 1 ] );
	ed.toggleOverhead( 60 );
}, plan );
await sleep( 2500 );

// 1) laying: the box beside the last point
for ( const [ x, z ] of plan.slice( 0, 3 ) ) await click( await screen( x, z ) );
let s = await page.evaluate( () => { const m = document.querySelector( '.river-menu' ); return { shown: m.style.display !== 'none', text: m.querySelector( '.name' ).textContent, done: ! m.querySelector( '[data-act=done]' ).disabled, pts: window.__app.editor.river.points.length }; } );
check( s.shown && s.pts === 3 && /3 pontos/.test( s.text ) && s.done, `caixa ao traçar: "${ s.text }", Concluir ativo` );
await shot( 'draw' );
for ( const [ x, z ] of plan.slice( 3 ) ) await click( await screen( x, z ) );
const before = await page.evaluate( () => window.__app.rivers.list.length );
const done = await page.$( '.river-menu [data-act=done]' );
await done.click(); await sleep( 1200 );
s = await page.evaluate( () => { const a = window.__app, r = a.rivers.list.at( - 1 ); return { n: a.rivers.list.length, carve: r?.record.carve?.k.length ?? 0, pts: r?.record.points.length, menu: document.querySelector( '.river-menu' ).style.display }; } );
check( s.n === before + 1 && s.carve > 0 && s.menu === 'none', `Concluir pela caixa: rio criado (${ s.pts } pontos), escavação guardada no rio (${ s.carve } células), caixa fechada` );

// 2) selecting it: "Selecionar rio" and a click on the river
await page.click( '#terrain-editor [data-act=riverSelect]' ); await sleep( 300 );
const mid = await page.evaluate( () => { const S = window.__app.rivers.list.at( - 1 ).course.samples, p = S[ Math.floor( S.length * 0.45 ) ]; return [ p.x, p.z ]; } );
await click( await screen( mid[ 0 ], mid[ 1 ] ) );
s = await page.evaluate( () => { const R = window.__app.editor.riverEdit; return { editing: R.editing, handles: R.handles.length, flow: !! R.flow, menu: document.querySelectorAll( '.river-menu' )[ 1 ].style.display !== 'none', banks: R.bankL.visible && R.bankR.visible }; } );
check( s.editing && s.handles >= 2 && s.flow && s.menu && s.banks, `selecionado: ${ s.handles } alças, margens, setas correndo (Flow), caixa de edição` );
await sleep( 800 );
await shot( 'edit' );

// 3) a handle picked by a click, moved; the width of all the points; Enter
const k = await page.evaluate( () => Math.floor( window.__app.editor.riverEdit.handles.length / 2 ) );
const hp = await page.evaluate( ( k ) => { const h = window.__app.editor.riverEdit.handles[ k ].position; return [ h.x, h.y, h.z ]; }, k );
const hs = await page.evaluate( ( p ) => { const a = window.__app, v = new a.THREE.Vector3( ...p ).project( a.camera ), rc = a.renderer.domElement.getBoundingClientRect(); return { x: rc.left + ( v.x * 0.5 + 0.5 ) * rc.width, y: rc.top + ( 0.5 - v.y * 0.5 ) * rc.height }; }, hp );
await click( hs );
s = await page.evaluate( () => window.__app.editor.riverEdit.picked );
check( s === k, `clique na alça ${ k }: escolhida (gizmo preso nela)` );
const oldCarve = await page.evaluate( ( k ) => {
	const R = window.__app.editor.riverEdit, h = R.handles[ k ];
	h.position.x += 14; R._handleMoved(); // (the gizmo drag itself: TransformControls)
	const all = document.querySelectorAll( '.river-menu' )[ 1 ].querySelector( '[data-k=all]' );
	all.value = 9; all.dispatchEvent( new Event( 'input' ) );
	return R.river.record.carve.k.slice();
}, k );
await page.keyboard.press( 'Enter' ); await sleep( 1500 );
s = await page.evaluate( ( oldK, k ) => {
	const a = window.__app, ed = a.editor, r = a.rivers.list.at( - 1 ), rec = r.record, newK = new Set( rec.carve.k );
	let left = 0;
	for ( const c of oldK ) if ( ! newK.has( c ) && Math.abs( ed.delta[ c ] ) > 0.01 ) left ++;
	return { n: a.rivers.list.length, widths: rec.points.every( ( p ) => p[ 2 ] === 9 ), editing: ed.riverEdit.editing, left, newCells: rec.carve.k.length, saved: a.objectEditor.edits.rivers.length };
}, oldCarve, k );
check( s.n === before + 1 && s.widths && ! s.editing && s.left === 0 && s.newCells > 0 && s.saved === s.n, `Enter aplicou: um rio só, largura 9 m em todos os pontos, leito antigo desfeito (${ s.left } células antigas sobrando), novo leito (${ s.newCells } células)` );
await sleep( 800 );
await shot( 'applied' );

// 4) select again, remove from the box: the relief back
await page.click( '#terrain-editor [data-act=riverSelect]' ); await sleep( 300 );
const mid2 = await page.evaluate( () => { const S = window.__app.rivers.list.at( - 1 ).course.samples, p = S[ Math.floor( S.length * 0.5 ) ]; return [ p.x, p.z ]; } );
await click( await screen( mid2[ 0 ], mid2[ 1 ] ) );
const cells = await page.evaluate( () => window.__app.editor.riverEdit.river?.record.carve.k.slice() ?? [] );
await ( await page.$$( '.river-menu [data-act=remove]' ) )[ 0 ].click(); await sleep( 1200 );
s = await page.evaluate( ( cells ) => { const a = window.__app; let left = 0; for ( const c of cells ) if ( Math.abs( a.editor.delta[ c ] ) > 0.01 ) left ++; return { n: a.rivers.list.length, left, saved: a.objectEditor.edits.rivers.length }; }, cells );
check( s.n === before && s.left === 0 && s.saved === before, `Remover pela caixa: rio tirado e relevo de volta (${ s.left } de ${ cells.length } células ainda alteradas)` );

console.log( errors.length ? 'page errors:\n' + errors.join( '\n' ) : 'no page errors' );
console.log( fails ? `FAILED: ${ fails }` : 'ALL OK' );
await page.evaluate( () => { const a = window.__app; a.editor.changed = false; a.objectEditor.changed = false; } );
await browser.close();
process.exit( fails || errors.length ? 1 : 0 );
