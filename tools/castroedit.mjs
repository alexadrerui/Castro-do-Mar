// QA of the castro house in the object editor (?edit, tab "Objetos"): selects it with a real click,
// turns it (rotation about the anchor, recorded as yaw), removes it and undoes. Pivot check: the
// group origin is the compound centre on the ground (CASTRO_HOUSE.centre, layout r).
//   node tools/castroedit.mjs [prefix]   -> shots/<prefix>_select.png, _turned.png
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'castroedit';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + String( e ).slice( 0, 300 ) ) );
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const shot = async ( name ) => { await sleep( 400 ); await page.screenshot( { path: `shots/${ prefix }_${ name }.png` } ); };
const check = ( ok, msg ) => { console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ msg }` ); if ( ! ok ) process.exitCode = 1; };

await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready && window.__app.objectEditor, { timeout: 300000, polling: 250 } );
await page.waitForFunction( () => { const l = document.getElementById( 'loader' ); return ! l || getComputedStyle( l ).visibility === 'hidden'; }, { timeout: 30000, polling: 200 } );
await page.click( '#editor-tabs [data-tab=objects]' ); await sleep( 300 );

const H = await page.evaluate( async () => {
	const a = window.__app, { BUILDINGS } = await import( '/src/world/layout.js' );
	const b = BUILDINGS.find( ( q ) => q.type === 'castro' ), g = a.objectEditor.groups.get( b._id );
	return { id: b._id, x: g.position.x, y: g.position.y, z: g.position.z, bx: b.x, bz: b.z, meshes: g.children.length, ground: a.hf.heightAt( b.x, b.z ) };
} );
check( Math.abs( H.x - H.bx ) < 0.01 && Math.abs( H.z - H.bz ) < 0.01 && Math.abs( H.y - H.ground ) < 0.01, `pivô na âncora do layout, no chão: ${ JSON.stringify( H ) }` );
await page.evaluate( ( H ) => { const a = window.__app; a.dynamicRes = false; a.views.push( { label: 'e', pos: [ H.x + 26, H.y + 18, H.z - 14 ], target: [ H.x, H.y + 2, H.z ] } ); a.setView( a.views.length - 1 ); }, H );
await sleep( 3000 );

// select with a click on the body roof
const p = await page.evaluate( ( H ) => {
	const a = window.__app, v = new a.THREE.Vector3( H.x, H.y + 4, H.z ).project( a.camera ), r = a.renderer.domElement.getBoundingClientRect();
	return { x: r.left + ( v.x * 0.5 + 0.5 ) * r.width, y: r.top + ( 0.5 - v.y * 0.5 ) * r.height };
}, H );
await page.mouse.move( p.x, p.y ); await sleep( 120 ); await page.mouse.down(); await sleep( 60 ); await page.mouse.up(); await sleep( 500 );
const sel = await page.evaluate( () => { const o = window.__app.objectEditor; return { id: o.selected?.userData.objId, box: o.box.visible, gizmo: o.gizmo.visible, name: document.getElementById( 'object-menu' )?.textContent.slice( 0, 40 ) }; } );
check( sel.id === H.id && sel.box && sel.gizmo, `selecionar com clique: ${ JSON.stringify( sel ) }` );
await shot( 'select' );

// turn 90 degrees about the anchor (as the gizmo does) and record
const turned = await page.evaluate( () => {
	const o = window.__app.objectEditor, g = o.selected;
	o._before = o._snap( g ); g.rotation.y += Math.PI / 2; g.updateMatrixWorld( true ); o._commitTransform();
	return { yaw: o.edits.objects[ g.userData.objId ]?.yaw, x: g.position.x, z: g.position.z };
} );
check( Math.abs( turned.yaw - Math.PI / 2 ) < 1e-3 && Math.abs( turned.x - H.x ) < 0.01, `girar em torno do pivô: ${ JSON.stringify( turned ) }` );
await shot( 'turned' );

await page.keyboard.press( 'Delete' ); await sleep( 300 );
const rm = await page.evaluate( ( id ) => { const o = window.__app.objectEditor; return { vis: o.groups.get( id ).visible, rec: o.edits.objects[ id ] }; }, H.id );
check( ! rm.vis && rm.rec?.removed, `remover: ${ JSON.stringify( rm.rec ) }` );
await page.keyboard.down( 'Control' ); await page.keyboard.press( 'KeyZ' ); await page.keyboard.up( 'Control' ); await sleep( 300 );
const un = await page.evaluate( ( id ) => { const o = window.__app.objectEditor; return { vis: o.groups.get( id ).visible, removed: !! o.edits.objects[ id ]?.removed }; }, H.id );
check( un.vis && ! un.removed, `desfazer a remoção: ${ JSON.stringify( un ) }` );
check( errors.length === 0, `sem erros no console${ errors.length ? ': ' + errors.join( ' | ' ) : '' }` );
await browser.close();
