// QA of the terrain editor (?edit): drives it with the real mouse in headless Edge.
//   node tools/terrainedit.mjs [prefix] [--save]
// Raises, smooths and stamps an island with the pointer, digs a pond and fills a shoal (water tools),
// checks the heights under the brush, the undo / redo and the view from above (T), and captures shots/<prefix>_<step>.png (with the editor panel: page screenshot).
// --save also saves (POST /__terrain-edits), reloads and checks that the edited relief survived
// the reload (heights, cache key) - and then deletes public/terrain-edits.bin again.
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'tedit';
const doSave = process.argv.includes( '--save' );
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FILE = 'public/terrain-edits.bin';
if ( doSave && fs.existsSync( FILE ) ) { console.log( `${ FILE } exists: not touching it (move it away to run --save)` ); process.exit( 1 ); }

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
const ready = () => page.waitForFunction( () => window.__app && window.__app.ready && window.__app.editor, { timeout: 300000, polling: 250 } );
const shot = async ( name ) => { await sleep( 400 ); await page.screenshot( { path: `shots/${ prefix }_${ name }.png` } ); };
const check = ( ok, msg ) => { console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ msg }` ); if ( ! ok ) process.exitCode = 1; };

await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
await ready();
// a camera looking down on open ground west of the village
const P = { x: - 150, z: 40 };
await page.evaluate( ( P ) => {
	const a = window.__app, g = a.hf.heightAt( P.x, P.z );
	a.dynamicRes = false;
	a.views.push( { label: 'edit', pos: [ P.x + 70, g + 75, P.z + 70 ], target: [ P.x, g, P.z ] } ); a.setView( a.views.length - 1 );
}, P );
await sleep( 1500 );
// screen position of a world point
const toScreen = ( x, z ) => page.evaluate( ( x, z ) => {
	const a = window.__app, v = new a.THREE.Vector3( x, a.hf.heightAt( x, z ), z ).project( a.camera );
	const r = a.renderer.domElement.getBoundingClientRect();
	return { x: r.left + ( v.x * 0.5 + 0.5 ) * r.width, y: r.top + ( 0.5 - v.y * 0.5 ) * r.height };
}, x, z );
const heightAt = ( x, z ) => page.evaluate( ( x, z ) => window.__app.hf.heightAt( x, z ), x, z );
const stroke = async ( pts, holdMs = 600 ) => {
	const s0 = await toScreen( pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] );
	await page.mouse.move( s0.x, s0.y ); await sleep( 100 );
	await page.mouse.down();
	for ( const [ x, z ] of pts ) { const s = await toScreen( x, z ); await page.mouse.move( s.x, s.y, { steps: 6 } ); await sleep( holdMs / pts.length ); }
	await page.mouse.up(); await sleep( 300 );
};
const setTool = ( id ) => page.click( `#terrain-editor [data-tool=${ id }]` );

await shot( '0_start' );
const h0 = await heightAt( P.x, P.z );

// 1. raise: a stroke held over the point
await setTool( 'raise' );
await stroke( [ [ P.x - 6, P.z ], [ P.x, P.z ], [ P.x + 6, P.z ] ], 1500 );
const h1 = await heightAt( P.x, P.z );
check( h1 > h0 + 0.5, `elevar: ${ h0.toFixed( 2 ) } -> ${ h1.toFixed( 2 ) } m` );
const geoY = await page.evaluate( ( P ) => {
	// the rendered chunk follows the heightfield: max |vertex y - hf| near the point
	const a = window.__app; let worst = 0;
	for ( const m of a.terrain.mesh.children ) {
		const g = m.geometry, src = g.userData.src, pos = g.attributes.position.array;
		if ( ! g.boundingBox.containsPoint( new a.THREE.Vector3( P.x, g.boundingBox.min.y, P.z ) ) ) continue;
		for ( let v = 0; v < src.length; v ++ ) if ( g.userData.drops[ v ] === 0 ) worst = Math.max( worst, Math.abs( pos[ v * 3 + 1 ] - a.hf.data[ src[ v ] ] ) );
	}
	return worst;
}, P );
check( geoY < 1e-3, `malha do terreno acompanha o relevo (erro máx. ${ geoY.toExponential( 1 ) } m)` );
await shot( '1_raise' );

// 2. undo / redo
await page.click( '#terrain-editor [data-act=undo]' ); await sleep( 200 );
const hU = await heightAt( P.x, P.z );
check( Math.abs( hU - h0 ) < 1e-3, `desfazer volta a ${ hU.toFixed( 2 ) } m (era ${ h0.toFixed( 2 ) })` );
await page.click( '#terrain-editor [data-act=redo]' ); await sleep( 200 );
const hR = await heightAt( P.x, P.z );
check( Math.abs( hR - h1 ) < 1e-3, `refazer volta a ${ hR.toFixed( 2 ) } m` );

// 3. smooth reduces the bump's peak
await setTool( 'smooth' );
await stroke( [ [ P.x, P.z ], [ P.x + 1, P.z ] ], 1500 );
const hS = await heightAt( P.x, P.z );
check( hS < h1, `suavizar: ${ h1.toFixed( 2 ) } -> ${ hS.toFixed( 2 ) } m` );

// 4. island stamp in the lake (east of the village)
const L = { x: 330, z: - 300 };
const hL0 = await heightAt( L.x, L.z );
await page.evaluate( ( L ) => {
	const a = window.__app, g = 0;
	a.views.push( { label: 'edit', pos: [ L.x - 110, g + 70, L.z + 110 ], target: [ L.x, g, L.z ] } ); a.setView( a.views.length - 1 );
}, L );
await sleep( 1200 );
await setTool( 'generate' );
await page.evaluate( () => { const e = window.__app.editor; e.radius = 45; e.gen.kind = 'island'; e.gen.height = 14; } );
const sL = await toScreen( L.x, L.z );
await page.mouse.move( sL.x, sL.y ); await sleep( 200 ); await page.mouse.down(); await page.mouse.up(); await sleep( 600 );
const hL1 = await heightAt( L.x, L.z );
check( hL0 < 0 && hL1 > 0, `ilha no lago: ${ hL0.toFixed( 1 ) } -> ${ hL1.toFixed( 1 ) } m` );
await shot( '2_island' );

// 5. restore under the island brings the lake back
// from straight above: with a slanted view the point under a still pointer slides away as the
// island sinks (the ray meets the lowered ground further on), as in any sculpting tool
await page.evaluate( ( L ) => { const a = window.__app; a.views.push( { label: 'edit', pos: [ L.x + 0.01, 160, L.z + 0.01 ], target: [ L.x, 0, L.z ] } ); a.setView( a.views.length - 1 ); }, L );
await sleep( 1200 );
await setTool( 'restore' );
await page.evaluate( () => { const e = window.__app.editor; e.radius = 60; e.strength = 1; } );
const df0 = await page.evaluate( () => window.__app.editor.dabFrames || 0 );
await stroke( [ [ L.x, L.z ], [ L.x + 1, L.z ] ], 2500 );
const hL2 = await heightAt( L.x, L.z );
console.log( '     (quadros com o pincel apertado:', ( await page.evaluate( () => window.__app.editor.dabFrames || 0 ) ) - df0, ')' );
check( Math.abs( hL2 - hL0 ) < Math.abs( hL1 - hL0 ) * 0.2, `restaurar: ${ hL1.toFixed( 1 ) } -> ${ hL2.toFixed( 1 ) } m (original ${ hL0.toFixed( 1 ) })` );

// 6. restore leaves the edit layer exactly at zero (no float drift)
const left = await page.evaluate( ( L ) => {
	const a = window.__app, e = a.editor, hf = a.hf, n = hf.n;
	const i = Math.round( ( L.x - hf.x0 ) / hf.cell ), j = Math.round( ( L.z - hf.z0 ) / hf.cell );
	let worst = 0;
	for ( let b = - 8; b <= 8; b ++ ) for ( let c = - 8; c <= 8; c ++ ) worst = Math.max( worst, Math.abs( e.delta[ ( j + b ) * n + i + c ] ) );
	return worst;
}, L );
check( left === 0, `restaurar zera a edição no centro (resto ${ left })` );

// 7. a chord: left held, right pressed, left released -> the stroke must end (no pointerup for it)
await setTool( 'raise' );
const sC = await toScreen( L.x, L.z );
await page.mouse.move( sC.x, sC.y ); await page.mouse.down( { button: 'left' } ); await sleep( 200 );
await page.mouse.down( { button: 'right' } ); await sleep( 100 );
await page.mouse.up( { button: 'left' } ); await sleep( 100 );
await page.mouse.move( sC.x + 5, sC.y + 5 ); await sleep( 200 );
const stuck = await page.evaluate( () => window.__app.editor.down );
await page.mouse.up( { button: 'right' } ); await sleep( 200 );
check( stuck === false, 'pincelada encerra ao soltar o esquerdo com o direito apertado' );
await page.click( '#terrain-editor [data-act=undo]' ); await sleep( 200 );

// 8. water tools, from straight above: dig a pond on land, fill a shoal in the lake
const top = async ( p, h = 160 ) => { await page.evaluate( ( p, h ) => { const a = window.__app; const g = a.hf.heightAt( p.x, p.z ); a.views.push( { label: 'edit', pos: [ p.x + 0.01, g + h, p.z + 0.01 ], target: [ p.x, g, p.z ] } ); a.setView( a.views.length - 1 ); }, p, h ); await sleep( 1200 ); };
const D = { x: - 190, z: 70 };
await top( D );
const ring = await page.evaluate( ( D ) => { const hf = window.__app.hf; return { c: hf.heightAt( D.x, D.z ), rim: hf.heightAt( D.x + 29, D.z ), bank: hf.heightAt( D.x + 26, D.z ) }; }, D );
await setTool( 'dig' );
await page.evaluate( () => { const e = window.__app.editor; e.radius = 30; e.strength = 1; e.water.depth = 4; e.water.shore = 8; } );
await stroke( [ [ D.x, D.z ], [ D.x + 0.5, D.z ] ], 2500 );
const dug = await page.evaluate( ( D ) => { const hf = window.__app.hf; return { c: hf.heightAt( D.x, D.z ), mid: hf.heightAt( D.x + 15, D.z ), bank: hf.heightAt( D.x + 26, D.z ), rim: hf.heightAt( D.x + 29, D.z ) }; }, D );
check( Math.abs( dug.c + 4 ) < 0.3 && Math.abs( dug.mid + 4 ) < 0.3, `cavar: centro ${ ring.c.toFixed( 1 ) } -> ${ dug.c.toFixed( 2 ) } m, meio ${ dug.mid.toFixed( 2 ) } m (alvo -4)` );
check( dug.bank > dug.c + 1 && dug.bank < ring.bank && Math.abs( dug.rim - ring.rim ) < Math.max( 1.5, ( ring.rim + 4 ) * 0.15 ), `cavar: margem em rampa (26 m: ${ ring.bank.toFixed( 1 ) } -> ${ dug.bank.toFixed( 1 ) } m; borda 29 m: ${ ring.rim.toFixed( 1 ) } -> ${ dug.rim.toFixed( 1 ) } m)` );
await shot( '4_dig' );
const F = { x: 360, z: - 200 };
await top( F );
const f0 = await heightAt( F.x, F.z );
await setTool( 'fill' );
await page.evaluate( () => { const e = window.__app.editor; e.radius = 30; e.water.fill = 1.5; e.water.shore = 10; } );
await stroke( [ [ F.x, F.z ], [ F.x + 0.5, F.z ] ], 2500 );
const f1 = await heightAt( F.x, F.z );
check( f0 < 0 && Math.abs( f1 - 1.5 ) < 0.3, `aterrar: ${ f0.toFixed( 1 ) } -> ${ f1.toFixed( 2 ) } m (alvo +1,5)` );
await shot( '5_fill' );

// 9. view from above (T): looks down, W moves in the plane, T again goes back
await page.evaluate( ( P ) => { const a = window.__app, g = a.hf.heightAt( P.x, P.z ); a.views.push( { label: 'edit', pos: [ P.x + 70, g + 75, P.z + 70 ], target: [ P.x, g, P.z ] } ); a.setView( a.views.length - 1 ); }, P );
await sleep( 800 );
const before = await page.evaluate( () => window.__app.camera.position.toArray() );
const sP = await toScreen( P.x, P.z ); await page.mouse.move( sP.x, sP.y ); await sleep( 300 );
await page.keyboard.press( 'KeyT' ); await sleep( 2000 );
const o1 = await page.evaluate( () => { const c = window.__app.camera; return { pos: c.position.toArray(), dirY: c.getWorldDirection( new c.position.constructor() ).y }; } );
check( o1.dirY < - 0.95, `vista de cima: câmera olhando para baixo (direção y ${ o1.dirY.toFixed( 3 ) })` );
await shot( '6_overhead' );
await page.keyboard.down( 'KeyW' ); await sleep( 700 ); await page.keyboard.up( 'KeyW' ); await sleep( 600 );
const o2 = await page.evaluate( () => window.__app.camera.position.toArray() );
check( Math.abs( o2[ 1 ] - o1.pos[ 1 ] ) < 0.5 && Math.hypot( o2[ 0 ] - o1.pos[ 0 ], o2[ 2 ] - o1.pos[ 2 ] ) > 3, `W anda no plano (altura ${ o1.pos[ 1 ].toFixed( 1 ) } -> ${ o2[ 1 ].toFixed( 1 ) }, deslocou ${ Math.hypot( o2[ 0 ] - o1.pos[ 0 ], o2[ 2 ] - o1.pos[ 2 ] ).toFixed( 1 ) } m)` );
await page.keyboard.press( 'KeyT' ); await sleep( 2000 );
const back = await page.evaluate( () => window.__app.camera.position.toArray() );
check( Math.hypot( back[ 0 ] - before[ 0 ], back[ 1 ] - before[ 1 ], back[ 2 ] - before[ 2 ] ) < 1, 'T de novo volta à câmera de antes' );

if ( doSave ) {
	// put the island back, save, and check it after the reload
	await page.click( '#terrain-editor [data-act=undo]' ); await sleep( 300 );
	const before = await heightAt( L.x, L.z );
	const nav = page.waitForNavigation( { waitUntil: 'domcontentloaded', timeout: 120000 } );
	await page.click( '#terrain-editor [data-act=save]' );
	await nav;
	check( fs.existsSync( FILE ) && fs.statSync( FILE ).size === 1121 * 1121 * 4, `${ FILE } gravado (${ fs.existsSync( FILE ) ? fs.statSync( FILE ).size : 0 } bytes)` );
	await ready();
	const after = await heightAt( L.x, L.z );
	check( Math.abs( after - before ) < 0.05, `após recarregar, a ilha continua: ${ before.toFixed( 2 ) } / ${ after.toFixed( 2 ) } m` );
	const ed = await page.evaluate( () => !! window.__app.terrainEdits );
	check( ed, 'edições carregadas na carga (app.terrainEdits)' );
	await page.evaluate( ( L ) => { const a = window.__app; a.views.push( { label: 'edit', pos: [ L.x - 110, 70, L.z + 110 ], target: [ L.x, 0, L.z ] } ); a.setView( a.views.length - 1 ); }, L );
	await sleep( 1500 );
	await shot( '3_reloaded' );
	fs.unlinkSync( FILE );
	console.log( `${ FILE } removido (era só teste)` );
}

check( errors.length === 0, `console sem erros${ errors.length ? ': ' + errors.join( ' | ' ) : '' }` );
await browser.close();
