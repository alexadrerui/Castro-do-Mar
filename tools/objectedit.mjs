// QA of the object editor (?edit, tab "Objetos"): drives it with the real mouse in headless Edge.
//   node tools/objectedit.mjs [prefix] [--save]
// Selects a house (selection box, gizmo, floating menu), moves it with the gizmo, turns it,
// removes it and undoes, adds a round house from the catalogue, and captures
// shots/<prefix>_<step>.png. --save also saves, reloads (normal mode) and checks that the moved
// house, the removal and the added house survived - then deletes public/world-edits.json again.
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'oedit';
const doSave = process.argv.includes( '--save' );
const FILE = 'public/world-edits.json';
if ( doSave && fs.existsSync( FILE ) ) { console.log( `${ FILE } exists: not touching it (move it away to run --save)` ); process.exit( 1 ); }
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
const toScreen = ( x, y, z ) => page.evaluate( ( x, y, z ) => {
	const a = window.__app, v = new a.THREE.Vector3( x, y, z ).project( a.camera );
	const r = a.renderer.domElement.getBoundingClientRect();
	return { x: r.left + ( v.x * 0.5 + 0.5 ) * r.width, y: r.top + ( 0.5 - v.y * 0.5 ) * r.height };
}, x, y, z );
const click = async ( p ) => { await page.mouse.move( p.x, p.y ); await sleep( 120 ); await page.mouse.down(); await sleep( 60 ); await page.mouse.up(); await sleep( 400 ); };

// render pipelines built, to check that the hand-placed plants and rocks build none (world/placed.js)
await page.evaluateOnNewDocument( () => { window.__pipes = 0; const D = GPUDevice.prototype; for ( const n of [ 'createRenderPipeline', 'createRenderPipelineAsync' ] ) { const f = D[ n ]; D[ n ] = function ( d ) { window.__pipes ++; return f.call( this, d ); }; } } );
await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready && window.__app.objectEditor, { timeout: 300000, polling: 250 } );
// the loading screen fades out over the page first (it would take the clicks)
await page.waitForFunction( () => { const l = document.getElementById( 'loader' ); return ! l || getComputedStyle( l ).visibility === 'hidden'; }, { timeout: 30000, polling: 200 } );
await page.click( '#editor-tabs [data-tab=objects]' ); await sleep( 300 );

// an isolated round house: #10 at (-4, -40)
const H = await page.evaluate( () => { const a = window.__app; const g = a.objectEditor.groups.get( 'b10' ); return { x: g.position.x, y: g.position.y, z: g.position.z }; } );
await page.evaluate( ( H ) => { const a = window.__app; a.dynamicRes = false; a.views.push( { label: 'e', pos: [ H.x + 22, H.y + 16, H.z + 22 ], target: [ H.x, H.y + 2, H.z ] } ); a.setView( a.views.length - 1 ); }, H );
await sleep( 1500 );

// 1. select by clicking the house
await click( await toScreen( H.x, H.y + 3, H.z ) );
const sel = await page.evaluate( () => { const o = window.__app.objectEditor; return { id: o.selected?.userData.objId, box: o.box.visible, gizmo: o.gizmo.visible, menu: getComputedStyle( document.getElementById( 'object-menu' ) ).display !== 'none' }; } );
check( sel.id === 'b10' && sel.box && sel.gizmo && sel.menu, `selecionar: ${ JSON.stringify( sel ) }` );
await shot( '1_select' );

// 2. move with the gizmo: drag the X arrow
const axis = await page.evaluate( () => {
	// screen points along the gizmo's X arrow (from the object's anchor)
	const a = window.__app, g = a.objectEditor.selected, r = a.renderer.domElement.getBoundingClientRect();
	const P = ( v ) => { const q = v.clone().project( a.camera ); return { x: r.left + ( q.x * 0.5 + 0.5 ) * r.width, y: r.top + ( 0.5 - q.y * 0.5 ) * r.height }; };
	const d = g.position.distanceTo( a.camera.position ) * 0.9 / 7; // TransformControls' screen-constant size
	return { a: P( g.position.clone().add( new a.THREE.Vector3( d * 0.6, 0, 0 ) ) ), b: P( g.position.clone().add( new a.THREE.Vector3( d * 0.6 + 6, 0, 0 ) ) ) };
} );
await page.mouse.move( axis.a.x, axis.a.y ); await sleep( 300 );
const hovered = await page.evaluate( () => window.__app.objectEditor.tc.axis );
await page.mouse.down(); await sleep( 100 );
await page.mouse.move( axis.b.x, axis.b.y, { steps: 12 } ); await sleep( 100 );
await page.mouse.up(); await sleep( 400 );
const mv = await page.evaluate( () => { const o = window.__app.objectEditor, g = o.groups.get( 'b10' ); return { x: g.position.x, y: g.position.y, z: g.position.z, rec: o.edits.objects.b10, ground: window.__app.hf.heightAt( g.position.x, g.position.z ), camMoved: false }; } );
check( hovered === 'X', `gizmo sob o cursor: eixo ${ hovered }` );
check( mv.x > H.x + 2 && Math.abs( mv.z - H.z ) < 0.2 && Math.abs( mv.y - mv.ground ) < 0.01, `mover pelo eixo X: x ${ H.x.toFixed( 1 ) } -> ${ mv.x.toFixed( 1 ) }, z igual, assentada no chão` );
check( mv.rec && Math.abs( mv.rec.x - mv.x ) < 0.01, `registro da edição: ${ JSON.stringify( mv.rec ) }` );
await shot( '2_moved' );

// 3. rotate mode with the key 2, turn by script (dragging the ring is the gizmo's own code)
const cam0 = await page.evaluate( () => window.__app.camera.position.toArray() );
await page.keyboard.press( 'Digit2' ); await sleep( 2600 ); // a camera view would fly for 2.4 s
const rot = await page.evaluate( () => { const o = window.__app.objectEditor; return { mode: o.tc.mode, view: window.__app.camera.position.toArray() }; } );
const camMove = Math.hypot( ...rot.view.map( ( v, i ) => v - cam0[ i ] ) );
check( rot.mode === 'rotate' && camMove < 0.5, `tecla 2: modo ${ rot.mode }, câmera parada (moveu ${ camMove.toFixed( 2 ) } m: não foi para a vista 2)` );
await shot( '3_rotate' );

// 4. remove (Delete) and undo
await page.keyboard.press( 'Delete' ); await sleep( 300 );
const rm = await page.evaluate( () => { const o = window.__app.objectEditor; return { vis: o.groups.get( 'b10' ).visible, rec: o.edits.objects.b10 }; } );
check( ! rm.vis && rm.rec?.removed, `remover: invisível e registrado (${ JSON.stringify( rm.rec ) })` );
await page.keyboard.down( 'Control' ); await page.keyboard.press( 'KeyZ' ); await page.keyboard.up( 'Control' ); await sleep( 300 );
const un = await page.evaluate( () => { const o = window.__app.objectEditor, g = o.groups.get( 'b10' ); return { vis: g.visible, x: g.position.x, rec: o.edits.objects.b10 }; } );
check( un.vis && Math.abs( un.x - mv.x ) < 0.01 && ! un.rec?.removed, `desfazer a remoção: de volta na posição movida (x ${ un.x.toFixed( 1 ) })` );

// 5. the library: search, category filter, counts, then a round house picked and placed with a click
// on open ground nearby (the ghost box under the pointer first)
await page.keyboard.press( 'Escape' ); await sleep( 200 );
const lib = await page.evaluate( async () => {
	const el = document.getElementById( 'object-editor' ), q = el.querySelector( '.q' ), fc = el.querySelector( '.f-cat' );
	const shown = () => [ ...el.querySelectorAll( '.card' ) ].filter( ( b ) => ! b.hidden ).map( ( b ) => b.dataset.item );
	const all = shown().length;
	q.value = 'colmeia'; q.dispatchEvent( new Event( 'input' ) );
	const search = shown();
	q.value = ''; q.dispatchEvent( new Event( 'input' ) );
	fc.value = 'entradas'; fc.dispatchEvent( new Event( 'change' ) );
	const cat = shown(), catLabel = fc.selectedOptions[ 0 ].textContent;
	el.querySelector( '[data-act=reset]' ).click();
	const round = el.querySelector( '[data-item=round] .have' ).textContent, size = el.querySelector( '[data-item=round] .size' ).textContent;
	const pic = el.querySelector( '[data-item=round] img' );
	return { all, search, cat, catLabel, reset: shown().length, round, size, pic: !! pic && pic.complete && pic.naturalWidth > 0 };
} );
check( lib.all === 35 && lib.search.join() === 'skep' && lib.cat.join() === 'lookout,gate,arch' && lib.reset === 35, `biblioteca: busca e categoria (${ JSON.stringify( lib ) })` );
check( /na vila/.test( lib.round ) && / × .* m · .* m alt./.test( lib.size ) && lib.pic, `cartão: contagem, tamanho e miniatura (${ lib.round }; ${ lib.size })` );
await page.click( '#object-editor [data-item=round]' ); await sleep( 200 );
const spot = { x: H.x - 18, z: H.z + 6 };
const gy = await page.evaluate( ( s ) => window.__app.hf.heightAt( s.x, s.z ), spot );
const sp = await toScreen( spot.x, gy, spot.z );
await page.mouse.move( sp.x, sp.y ); await sleep( 200 );
const gh = await page.evaluate( () => { const g = window.__app.objectEditor.ghost; return { vis: g.visible, x: g.position.x, z: g.position.z, w: g.scale.x }; } );
check( gh.vis && Math.hypot( gh.x - spot.x, gh.z - spot.z ) < 1.5 && gh.w > 5, `caixa-fantasma sob o cursor (${ JSON.stringify( gh ) })` );
await click( sp );
const ad = await page.evaluate( () => { const o = window.__app.objectEditor; return { sel: o.selected?.userData.objId, added: o.edits.added.map( ( a ) => ( { id: a.id, type: a.type, x: +a.x.toFixed( 1 ), z: +a.z.toFixed( 1 ) } ) ), meshes: o.selected?.children.length }; } );
check( ad.sel === 'a0' && ad.added.length === 1 && ad.added[ 0 ].type === 'round' && ad.meshes > 2, `catálogo: casa redonda adicionada ${ JSON.stringify( ad ) }` );
await shot( '4_added' );
// 6. drag and drop: a well card dropped on the ground (the HTML drag events, as the browser sends them)
await page.keyboard.press( 'Escape' ); await sleep( 200 );
const spot2 = { x: H.x - 26, z: H.z - 4 };
const sp2 = await toScreen( spot2.x, await page.evaluate( ( s ) => window.__app.hf.heightAt( s.x, s.z ), spot2 ), spot2.z );
const dnd = await page.evaluate( ( p ) => {
	const card = document.querySelector( '#object-editor [data-item=well]' ), cv = window.__app.renderer.domElement, dt = new DataTransfer();
	card.dispatchEvent( new DragEvent( 'dragstart', { bubbles: true, dataTransfer: dt } ) );
	cv.dispatchEvent( new DragEvent( 'dragover', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, dataTransfer: dt } ) );
	const ghost = window.__app.objectEditor.ghost.visible;
	cv.dispatchEvent( new DragEvent( 'drop', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, dataTransfer: dt } ) );
	card.dispatchEvent( new DragEvent( 'dragend', { bubbles: true, dataTransfer: dt } ) );
	const o = window.__app.objectEditor, a = o.edits.added.at( -1 );
	return { ghost, sel: o.selected?.userData.objId, type: a?.type, x: +a?.x.toFixed( 1 ), z: +a?.z.toFixed( 1 ), armed: !! o.armed, have: document.querySelector( '#object-editor [data-item=well] .have' ).textContent };
}, sp2 );
check( dnd.ghost && dnd.type === 'well' && Math.hypot( dnd.x - spot2.x, dnd.z - spot2.z ) < 1.5 && ! dnd.armed && dnd.sel === 'a1' && /2 na vila/.test( dnd.have ), `arrastar e soltar: poço onde caiu (${ JSON.stringify( dnd ) })` );
await page.keyboard.down( 'Control' ); await page.keyboard.press( 'KeyZ' ); await page.keyboard.up( 'Control' ); await sleep( 200 );
await page.screenshot( { path: `shots/${ prefix }_6_library.png`, clip: { x: 0, y: 100, width: 340, height: 800 } } );
// 7. nature: an oak put with a click and a boulder dragged in (one-instance meshes of the scatter's own),
// the oak moved by its record; the map's count on the card
await page.keyboard.press( 'Escape' ); await sleep( 200 );
// ground points seen on screen right of the library panel (a click there would land on the panel),
// with no object under them
const [ oakSpot, rockSpot ] = await page.evaluate( () => {
	const a = window.__app, o = a.objectEditor, out = [];
	for ( const [ sx, sy ] of [ [ 0.62, 0.62 ], [ 0.72, 0.7 ], [ 0.55, 0.75 ], [ 0.8, 0.6 ], [ 0.66, 0.8 ] ] ) {
		const r = a.renderer.domElement.getBoundingClientRect(), x = r.left + sx * r.width, y = r.top + sy * r.height;
		if ( o._pickObject( x, y ) ) continue;
		o.terrain.pointer.x = x; o.terrain.pointer.y = y;
		const p = o.terrain._pick();
		if ( p ) out.push( { x: p.x, z: p.z } );
	}
	return out;
} );
const pipes0 = await page.evaluate( () => window.__pipes );
await page.evaluate( () => { const q = document.querySelector( '#object-editor .q' ); q.value = 'carvalho'; q.dispatchEvent( new Event( 'input' ) ); } );
await page.click( '#object-editor [data-item=oak]' ); await sleep( 200 );
await click( await toScreen( oakSpot.x, await page.evaluate( ( s ) => window.__app.hf.heightAt( s.x, s.z ), oakSpot ), oakSpot.z ) );
const rp = await toScreen( rockSpot.x, await page.evaluate( ( s ) => window.__app.hf.heightAt( s.x, s.z ), rockSpot ), rockSpot.z );
const nat = await page.evaluate( ( p ) => {
	const o = window.__app.objectEditor, oak = o.selected;
	const card = document.querySelector( '#object-editor [data-item=rock-boulder]' ), cv = window.__app.renderer.domElement, dt = new DataTransfer();
	card.dispatchEvent( new DragEvent( 'dragstart', { bubbles: true, dataTransfer: dt } ) );
	cv.dispatchEvent( new DragEvent( 'dragover', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, dataTransfer: dt } ) );
	cv.dispatchEvent( new DragEvent( 'drop', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, dataTransfer: dt } ) );
	card.dispatchEvent( new DragEvent( 'dragend', { bubbles: true, dataTransfer: dt } ) );
	const rock = o.selected, mesh = rock?.children[ 0 ];
	const recs = o.edits.added.filter( ( a ) => a.kind === 'plant' || a.kind === 'rock' ).map( ( a ) => ( { id: a.id, kind: a.kind, sp: a.species || a.rock, x: +a.x.toFixed( 1 ), z: +a.z.toFixed( 1 ) } ) );
	return { oak: oak?.userData.kind, oakName: document.querySelector( '#object-menu .name' ).textContent, rock: rock?.userData.kind, inst: mesh?.geometry.instanceCount, sameMat: mesh?.material === window.__app.layers.rocks.object.children.find( ( c ) => c.name === 'tor1' ).materialLo, recs, have: document.querySelector( '#object-editor [data-item=oak] .have' ).textContent };
}, rp );
check( nat.oak === 'plant' && nat.rock === 'rock' && nat.inst === 1 && nat.sameMat && nat.recs.length === 2 && /no mapa/.test( nat.have ), `natureza: carvalho e matacão postos (${ JSON.stringify( nat ) })` );
await shot( '7_nature' );
await sleep( 1500 );
const newPipes = await page.evaluate( ( p0 ) => window.__pipes - p0, pipes0 );
check( newPipes === 0, `natureza: nenhum pipeline novo ao pôr o carvalho e o matacão (${ newPipes })` );

if ( doSave ) {
	const nav = page.waitForNavigation( { waitUntil: 'domcontentloaded', timeout: 120000 } );
	await page.click( '#object-editor [data-act=save]' );
	await nav;
	check( fs.existsSync( FILE ), `${ FILE } gravado` );
	check( ! fs.existsSync( 'public/terrain-edits.bin' ), 'sem relevo editado: nenhum terrain-edits.bin criado' );
	// normal mode (no ?edit): the merged village must reflect the edits
	await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
	await sleep( 1500 );
	const after = await page.evaluate( async ( mv ) => {
		const a = window.__app, { BUILDINGS } = await import( '/src/world/layout.js' );
		const b = BUILDINGS.find( ( q ) => q._id === 'b10' ), n = BUILDINGS.find( ( q ) => q._id === 'a0' );
		// something at the moved spot (raycast down onto the merged houses)
		const ray = new a.THREE.Raycaster( new a.THREE.Vector3( mv.x, 300, mv.z ), new a.THREE.Vector3( 0, - 1, 0 ) );
		const hit = ray.intersectObject( a.layers.buildings.object, true )[ 0 ];
		const { doorAngle } = await import( '/src/world/buildings.js' );
		return { door: b && doorAngle( b ), b: b && { x: b.x, z: b.z }, n: n && { x: n.x, z: n.z, type: n.type }, roofAt: hit ? hit.point.y - a.hf.heightAt( mv.x, mv.z ) : null };
	}, mv );
	check( after.b && Math.abs( after.b.x - mv.x ) < 0.01, `após recarregar: casa b10 em x ${ after.b?.x.toFixed( 1 ) }` );
	check( Math.abs( after.door - mv.rec.door ) < 1e-4, `porta mantida após mover e recarregar (${ after.door?.toFixed( 3 ) } / ${ mv.rec.door } rad)` );
	check( after.roofAt > 3, `telhado sobre a posição nova (${ after.roofAt?.toFixed( 1 ) } m acima do chão)` );
	check( after.n && after.n.type === 'round', `casa adicionada presente: ${ JSON.stringify( after.n ) }` );
	// the oak and the boulder in the scatter's instances, where they were put
	const inst = await page.evaluate( () => {
		const a = window.__app, found = {};
		for ( const e of a.worldEdits.added.filter( ( q ) => q.kind === 'plant' || q.kind === 'rock' ) ) {
			const name = e.kind === 'plant' ? e.species : e.rock;
			let best = 1e9;
			for ( const L of [ a.layers.vegetation.object, a.layers.rocks.object ] ) L.traverse( ( o ) => {
				if ( o.parent?.name !== name || ! o.userData.instances ) return;
				const { matrices, count } = o.userData.instances;
				for ( let i = 0; i < count; i ++ ) best = Math.min( best, Math.hypot( matrices[ i * 16 + 12 ] - e.x, matrices[ i * 16 + 14 ] - e.z ) );
			} );
			found[ name ] = +best.toFixed( 2 );
		}
		return found;
	} );
	check( inst.oak < 0.05 && inst.tor1 < 0.05, `após recarregar: carvalho e matacão nas instâncias, no lugar (${ JSON.stringify( inst ) })` );
	await page.evaluate( ( H ) => { const a = window.__app; a.dynamicRes = false; a.views.push( { label: 'e', pos: [ H.x + 10, H.y + 30, H.z + 34 ], target: [ H.x - 6, H.y + 2, H.z ] } ); a.setView( a.views.length - 1 ); }, H );
	await sleep( 1500 );
	await shot( '5_reloaded' );
	fs.unlinkSync( FILE );
	console.log( `${ FILE } removido (era só teste)` );
}
check( errors.length === 0, `console sem erros${ errors.length ? ': ' + [ ...new Set( errors ) ].join( ' | ' ) : '' }` );
await browser.close();
