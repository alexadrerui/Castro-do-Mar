// Object editor (?edit, tab "Objetos"): select, move, turn, resize, remove and add the village
// objects (houses, market stalls, props), after the decoration editor of the Habitat Creator game:
// a click selects; the object gets a selection box, three's TransformControls gizmo and a small
// floating menu beside it (1 Move, 2 Rotate, 3 Scale, x close, Remove). A catalogue adds new
// objects: pick one, then click on the ground.
//
// The edits go to public/world-edits.json (world/worldEdits.js) with "Salvar e aplicar" (shared with
// the relief editor). The next load builds the whole village from the edited lists: the building
// pads in the relief, the trampled ground, the vegetation around the houses, the smoke.
//
// Mouse: click = select (or place, with a catalogue item armed), drag empty space = look,
// drag the gizmo = transform. Keys with a selection: 1 2 3 modes, Delete remove, Esc deselect.
// Ctrl+Z / Ctrl+Y undo / redo.
import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { objectGroup, doorAngle } from '../world/buildings.js';
import { addProxies } from '../core/proxies.js';
import { emptyWorldEdits } from '../world/worldEdits.js';

const CATALOGUE = [
	{ label: 'Casa redonda', kind: 'building', entry: { type: 'round', r: 5 } },
	{ label: 'Casa longa', kind: 'building', entry: { type: 'long', w: 6.5, l: 10, rot: 0 } },
	{ label: 'Cabana', kind: 'building', entry: { type: 'hut', r: 2.5 } },
	{ label: 'Celeiro', kind: 'building', entry: { type: 'granary', r: 1.6 } },
	{ label: 'Torre de vigia', kind: 'building', entry: { type: 'lookout' } },
	{ label: 'Barraca', kind: 'stall', entry: { red: true } },
	{ label: 'Cercado', kind: 'prop', entry: { type: 'pen', w: 6, d: 5, rot: 0 } },
	{ label: 'Palheiro', kind: 'prop', entry: { type: 'hay', r: 1.2 } },
	{ label: 'Poço', kind: 'prop', entry: { type: 'well' } },
	{ label: 'Carroça', kind: 'prop', entry: { type: 'cart', rot: 0 } },
	{ label: 'Varal', kind: 'prop', entry: { type: 'rack', rot: 0 } },
	{ label: 'Colmeia', kind: 'prop', entry: { type: 'skep' } },
	{ label: 'Lenha', kind: 'prop', entry: { type: 'wood', rot: 0 } }
];
const NAMES = { round: 'Casa redonda', long: 'Casa longa', hut: 'Cabana', granary: 'Celeiro', lookout: 'Torre de vigia', pen: 'Cercado', hay: 'Palheiro', well: 'Poço', cart: 'Carroça', rack: 'Varal', skep: 'Colmeia', wood: 'Lenha' };
const MODES = [ 'translate', 'rotate', 'scale' ];
const UNDO_MAX = 60;

export class ObjectEditor {

	// app: scene, camera, renderer, hf, layers.buildings, buildingMaterials, freecam, worldEdits;
	// terrain: the relief editor (shares the panel slot, the save and the ground picking)
	constructor( app, terrain ) {
		this.app = app;
		this.terrain = terrain;
		this.camera = app.camera;
		this.dom = app.renderer.domElement;
		this.hf = app.hf;
		this.root = app.layers.buildings.object;
		this.edits = app.worldEdits ? JSON.parse( JSON.stringify( app.worldEdits ) ) : emptyWorldEdits();
		this.groups = new Map();
		for ( const g of this.root.userData.objects || [] ) this._register( g );
		// the static village is frozen (main.js): this group must pass the world update on to the
		// object groups, which move
		this.root.matrixWorldAutoUpdate = true;
		this.active = false;
		this.selected = null;
		this.armed = null;       // catalogue item waiting for a click on the ground
		this.changed = false;
		this.undo = []; this.redo = [];
		this.mode = 'translate';
		this._raycaster = new THREE.Raycaster();
		this._ndc = new THREE.Vector2();
		this._v = new THREE.Vector3();

		// gizmo
		this.tc = new TransformControls( this.camera, this.dom );
		this.tc.setSpace( 'world' );
		this.tc.setSize( 0.9 );
		this.gizmo = this.tc.getHelper();
		this.gizmo.visible = false;
		app.scene.add( this.gizmo );
		// the edit is recorded when the drag ends, however it ends
		this.tc.addEventListener( 'dragging-changed', ( e ) => {
			this.dragging = e.value;
			if ( e.value ) this._before = this._snap( this.selected ); else this._commitTransform();
		} );
		this.tc.addEventListener( 'objectChange', () => this._constrain() );
		// a press on the gizmo is not a camera look: test the gizmo under this very press (the hover
		// state needs a pointer move first, and touch / pen have none)
		app.freecam.leftBlocker = ( e ) => {
			if ( ! this.active || ! this.selected ) return false;
			this.tc.pointerHover( this.tc._getPointer( e ) );
			return this.tc.axis !== null;
		};
		// selection box
		this.box = new THREE.BoxHelper( undefined, 0x5fd0e8 );
		this.box.material.depthTest = false;
		this.box.material.transparent = true;
		this.box.renderOrder = 998;
		this.box.visible = false;
		this.box.frustumCulled = false;
		app.scene.add( this.box );

		this._buildUI();
		this._bind();
		app.onFrame.push( () => this.update() );
	}

	_register( g ) {
		g.rotation.order = 'YXZ'; // a full turn about Y reads back as rotation.y
		g.traverse( ( o ) => { o.matrixAutoUpdate = true; o.matrixWorldAutoUpdate = true; } );
		this.groups.set( g.userData.objId, g );
	}

	// ------------------------------------------------------------------ mode switch (tabs)

	setActive( on ) {
		if ( this.dragging || on === this.active ) return;
		if ( on ) this._terrainWasActive = this.terrain.active;
		this.active = on;
		this.panel.style.display = on ? '' : 'none';
		this.terrain.panel.style.display = on ? 'none' : '';
		this.terrain.setActive( on ? false : this._terrainWasActive !== false );
		// with the objects, a drag on empty space looks around (the left button is shared)
		this.app.freecam.leftLook = on || ! this.terrain.active;
		for ( const b of this.tabs.querySelectorAll( 'button' ) ) b.classList.toggle( 'on', ( b.dataset.tab === 'objects' ) === on );
		if ( ! on ) { this.select( null ); this.arm( null ); }
	}

	// ------------------------------------------------------------------ selection

	select( g ) {
		this.selected = g;
		if ( g ) {
			this.tc.attach( g );
			this._setMode( this.mode );
			this.box.setFromObject( g );
		} else {
			this.tc.detach();
		}
		this.gizmo.visible = !! g;
		this.box.visible = !! g;
		this.menu.style.display = g ? '' : 'none';
		if ( g ) {
			const e = g.userData.entry;
			const name = g.userData.kind === 'stall' ? 'Barraca' : NAMES[ e.type ] || e.type;
			this.menu.querySelector( '.name' ).textContent = `${ name } · ${ g.userData.objId }`;
		}
	}

	_setMode( m ) {
		this.mode = m;
		this.tc.setMode( m );
		// move on the ground, turn about the vertical, resize uniformly (one handle)
		this.tc.showX = m !== 'rotate' && m !== 'scale';
		this.tc.showZ = m !== 'rotate' && m !== 'scale';
		this.tc.showY = m !== 'translate';
		for ( const b of this.menu.querySelectorAll( '[data-mode]' ) ) b.classList.toggle( 'on', b.dataset.mode === m );
	}

	// keep the edits physical while dragging
	_constrain() {
		const g = this.selected;
		if ( ! g ) return;
		if ( this.mode === 'translate' ) g.position.y = this.hf.heightAt( g.position.x, g.position.z );
		if ( this.mode === 'scale' ) { const s = THREE.MathUtils.clamp( g.scale.y, 0.3, 4 ); g.scale.set( s, s, s ); }
		if ( this.mode === 'rotate' ) { g.rotation.x = 0; g.rotation.z = 0; }
	}

	// ------------------------------------------------------------------ edit records

	// the edit of an object from its group: position, the turn and the size added to what it was built with
	_record( g ) {
		const e = g.userData.entry, id = g.userData.objId;
		const yaw = ( e.yaw || 0 ) + g.rotation.y, scale = ( e.scale || 1 ) * g.scale.x;
		const r = { x: +g.position.x.toFixed( 3 ), z: +g.position.z.toFixed( 3 ), yaw: +yaw.toFixed( 4 ), scale: +scale.toFixed( 4 ) };
		if ( id.startsWith( 'a' ) ) {
			const a = this.edits.added.find( ( q ) => q.id === id );
			if ( a ) Object.assign( a, r );
		} else {
			// the original position (checked on load, world/worldEdits.js) and, for the houses that
			// turn their door to the village, the door they were built with
			const old = this.edits.objects[ id ] || {};
			const isStall = g.userData.kind === 'stall';
			r.ox = old.ox ?? +( isStall ? e[ 0 ] : e.x ).toFixed( 3 );
			r.oz = old.oz ?? +( isStall ? e[ 1 ] : e.z ).toFixed( 3 );
			if ( e.type === 'round' || e.type === 'hut' ) r.door = old.door ?? +doorAngle( e ).toFixed( 5 );
			this.edits.objects[ id ] = r;
		}
	}

	// state of one object for undo: the whole edits document and the group's transform
	_snap( g ) {
		return { json: JSON.stringify( this.edits ), id: g?.userData.objId, tf: g ? { p: g.position.clone(), r: g.rotation.clone(), s: g.scale.clone(), v: g.visible } : null };
	}

	_restore( st ) {
		this.edits = JSON.parse( st.json );
		const g = st.id && this.groups.get( st.id );
		if ( g && st.tf ) { g.position.copy( st.tf.p ); g.rotation.copy( st.tf.r ); g.scale.copy( st.tf.s ); g.visible = st.tf.v; }
		if ( this.selected && ! this.selected.visible ) this.select( null );
		this.changed = true;
		this._status();
	}

	_push( before, after ) {
		this.undo.push( { before, after } );
		if ( this.undo.length > UNDO_MAX ) this.undo.shift();
		this.redo.length = 0;
		this.changed = true;
		this._status();
	}

	_commitTransform() {
		const g = this.selected, before = this._before;
		this._before = null;
		if ( ! g || ! before ) return;
		const t = before.tf;
		if ( t && t.p.distanceTo( g.position ) < 1e-4 && Math.abs( t.r.y - g.rotation.y ) < 1e-5 && Math.abs( t.s.x - g.scale.x ) < 1e-5 ) return; // a click on the gizmo
		this._record( g );
		this._push( before, this._snap( g ) );
	}

	remove() {
		const g = this.selected;
		if ( ! g || this.dragging ) return;
		const before = this._snap( g ), id = g.userData.objId, e = g.userData.entry, isStall = g.userData.kind === 'stall';
		if ( id.startsWith( 'a' ) ) this.edits.added = this.edits.added.filter( ( q ) => q.id !== id );
		else this.edits.objects[ id ] = { removed: true, ox: this.edits.objects[ id ]?.ox ?? +( isStall ? e[ 0 ] : e.x ).toFixed( 3 ), oz: this.edits.objects[ id ]?.oz ?? +( isStall ? e[ 1 ] : e.z ).toFixed( 3 ) };
		g.visible = false;
		this.select( null );
		this._push( before, this._snap( g ) );
		this._toast( 'Objeto removido (Ctrl+Z desfaz).' );
	}

	undoStep() { if ( this.dragging ) return; const u = this.undo.pop(); if ( u ) { this._restore( u.before ); this.redo.push( u ); } this._status(); }
	redoStep() { if ( this.dragging ) return; const u = this.redo.pop(); if ( u ) { this._restore( u.after ); this.undo.push( u ); } this._status(); }

	// ------------------------------------------------------------------ catalogue

	arm( item ) {
		this.armed = item;
		for ( const b of this.panel.querySelectorAll( '[data-cat]' ) ) b.classList.toggle( 'on', item && b.dataset.cat === item.label );
		this.panel.querySelector( '.armed' ).textContent = item ? `Clique no chão para pôr: ${ item.label } (Esc cancela)` : '';
		if ( item ) this.select( null );
	}

	place( p ) {
		const item = this.armed;
		if ( ! item ) return;
		let n = 0;
		while ( this.groups.has( 'a' + n ) || this.edits.added.some( ( q ) => q.id === 'a' + n ) ) n ++;
		const id = 'a' + n, seed = 100 + n;
		const rec = { id, kind: item.kind, ...item.entry, x: +p.x.toFixed( 3 ), z: +p.z.toFixed( 3 ), seed, yaw: 0, scale: 1 };
		// the layout form of the entry, as world/worldEdits.js builds it on the next load
		const entry = item.kind === 'stall'
			? Object.assign( [ rec.x, rec.z, 0 ], { _id: id, seed, red: rec.red !== false, added: true } )
			: { ...rec, _id: id };
		const g = objectGroup( this.app.buildingMaterials, item.kind, entry, this.hf );
		addProxies( g ); // its stand-ins in the reflection and the shadow pass
		g.visible = false;
		this.root.add( g );
		this._register( g );
		const before = this._snap( g );
		this.edits.added.push( rec );
		g.visible = true;
		this._push( before, this._snap( g ) );
		this.arm( null );
		this.select( g );
	}

	// ------------------------------------------------------------------ picking

	_ray( x, y ) {
		const r = this.dom.getBoundingClientRect();
		this._ndc.set( ( x - r.left ) / r.width * 2 - 1, - ( ( y - r.top ) / r.height ) * 2 + 1 );
		this._raycaster.setFromCamera( this._ndc, this.camera );
		return this._raycaster;
	}

	_pickObject( x, y ) {
		const list = [ ...this.groups.values() ].filter( ( g ) => g.visible );
		const hit = this._ray( x, y ).intersectObjects( list, true )[ 0 ];
		let o = hit?.object;
		while ( o && ! o.userData.objId ) o = o.parent;
		return o || null;
	}

	// ------------------------------------------------------------------ frame

	update() {
		if ( ! this.selected ) return;
		this.box.setFromObject( this.selected );
		// the floating menu beside the object (screen space)
		const g = this.selected;
		const r = this.dom.getBoundingClientRect();
		this.box.geometry.computeBoundingSphere();
		const s = this.box.geometry.boundingSphere;
		const p = this._v.copy( s.center ).addScaledVector( new THREE.Vector3( 1, 0, 0 ).applyQuaternion( this.camera.quaternion ), s.radius ).project( this.camera );
		const vis = p.z < 1 && g.visible;
		this.menu.style.display = vis ? '' : 'none';
		if ( vis ) {
			const x = Math.min( r.width - 170, Math.max( 8, ( p.x * 0.5 + 0.5 ) * r.width + 12 ) );
			const y = Math.min( r.height - 150, Math.max( 8, ( 0.5 - p.y * 0.5 ) * r.height - 40 ) );
			this.menu.style.transform = `translate(${ x }px, ${ y }px)`;
		}
	}

	// ------------------------------------------------------------------ input

	_bind() {
		let down = null;
		this.dom.addEventListener( 'pointerdown', ( e ) => {
			if ( ! this.active || e.button !== 0 ) return;
			down = this.tc.axis !== null ? null : { x: e.clientX, y: e.clientY, t: performance.now() };
		} );
		this.dom.addEventListener( 'pointerup', ( e ) => {
			if ( ! this.active || e.button !== 0 || ! down ) return;
			const moved = Math.hypot( e.clientX - down.x, e.clientY - down.y ), dt = performance.now() - down.t;
			down = null;
			if ( moved > 5 || dt > 400 || this.dragging ) return; // a drag: the camera looked around
			if ( this.armed ) {
				this.terrain.pointer.x = e.clientX; this.terrain.pointer.y = e.clientY;
				const p = this.terrain._pick();
				if ( p ) this.place( p );
				return;
			}
			this.select( this._pickObject( e.clientX, e.clientY ) );
		} );
		// capture phase: with a selection, 1 2 3 are the gizmo modes (not the camera views)
		window.addEventListener( 'keydown', ( e ) => {
			if ( ! this.active || ( e.target.closest && e.target.closest( 'input,select,textarea' ) ) ) return;
			if ( this.dragging ) { e.stopImmediatePropagation(); e.preventDefault(); return; } // finish the drag first
			if ( ( e.ctrlKey || e.metaKey ) && e.code === 'KeyZ' ) { e.preventDefault(); e.shiftKey ? this.redoStep() : this.undoStep(); return; }
			if ( ( e.ctrlKey || e.metaKey ) && e.code === 'KeyY' ) { e.preventDefault(); this.redoStep(); return; }
			if ( e.code === 'Escape' ) { this.arm( null ); this.select( null ); return; }
			if ( ! this.selected ) return;
			const k = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[ e.code ];
			if ( k !== undefined ) { this._setMode( MODES[ k ] ); e.stopImmediatePropagation(); e.preventDefault(); }
			if ( e.code === 'Delete' || e.code === 'Backspace' ) { this.remove(); e.preventDefault(); }
		}, true );
	}

	// ------------------------------------------------------------------ UI

	_buildUI() {
		// tabs above the two panels
		const tabs = document.createElement( 'div' );
		tabs.id = 'editor-tabs';
		tabs.className = 'panel';
		tabs.innerHTML = '<button data-tab="relief" class="on">Relevo</button><button data-tab="objects">Objetos</button>';
		document.body.appendChild( tabs );
		this.tabs = tabs;
		for ( const b of tabs.querySelectorAll( 'button' ) ) b.onclick = () => this.setActive( b.dataset.tab === 'objects' );

		const el = document.createElement( 'div' );
		el.id = 'object-editor';
		el.className = 'panel';
		el.style.display = 'none';
		el.innerHTML = `
			<header><b>Objetos da vila</b></header>
			<p class="hint">Clique num objeto para selecionar: aparecem a caixa, as alças e o menu ao lado. Arraste o espaço vazio para olhar.</p>
			<div class="cat">${ CATALOGUE.map( ( c ) => `<button data-cat="${ c.label }">${ c.label }</button>` ).join( '' ) }</div>
			<p class="armed"></p>
			<div class="row"><button data-act="undo">Desfazer</button><button data-act="redo">Refazer</button></div>
			<div class="row"><button data-act="save" class="primary">Salvar e aplicar</button></div>
			<p class="keys">Clique: selecionar · 1 mover · 2 girar · 3 escalar · Delete: remover · Esc: soltar · Ctrl+Z/Y</p>`;
		document.body.appendChild( el );
		this.panel = el;
		for ( const b of el.querySelectorAll( '[data-cat]' ) ) b.onclick = () => this.arm( this.armed?.label === b.dataset.cat ? null : CATALOGUE.find( ( c ) => c.label === b.dataset.cat ) );
		el.querySelector( '[data-act=undo]' ).onclick = () => this.undoStep();
		el.querySelector( '[data-act=redo]' ).onclick = () => this.redoStep();
		el.querySelector( '[data-act=save]' ).onclick = () => this.terrain.save();
		this.ui = { undo: el.querySelector( '[data-act=undo]' ), redo: el.querySelector( '[data-act=redo]' ) };

		// the floating menu beside the selection
		const menu = document.createElement( 'div' );
		menu.id = 'object-menu';
		menu.className = 'panel';
		menu.style.display = 'none';
		menu.innerHTML = `
			<div class="top"><span class="name"></span><button data-act="close" title="Esc">×</button></div>
			<button data-mode="translate"><kbd>1</kbd> Mover</button>
			<button data-mode="rotate"><kbd>2</kbd> Girar</button>
			<button data-mode="scale"><kbd>3</kbd> Escalar</button>
			<button data-act="remove" class="danger">Remover</button>`;
		document.body.appendChild( menu );
		this.menu = menu;
		for ( const b of menu.querySelectorAll( '[data-mode]' ) ) b.onclick = () => this._setMode( b.dataset.mode );
		menu.querySelector( '[data-act=close]' ).onclick = () => this.select( null );
		menu.querySelector( '[data-act=remove]' ).onclick = () => this.remove();

		const style = document.createElement( 'style' );
		style.textContent = `
			#editor-tabs { position: fixed; top: 78px; left: 12px; width: 288px; padding: 4px; z-index: 12; display: flex; gap: 4px; }
			#editor-tabs button { flex: 1; }
			#terrain-editor { top: 122px !important; max-height: calc(100vh - 184px) !important; }
			#object-editor { position: fixed; top: 122px; left: 12px; width: 288px; padding: 10px 12px; z-index: 12; font-size: 12px; color: var(--ink); }
			#object-editor header { color: var(--gold-2); font-size: 13px; margin-bottom: 6px; }
			#object-editor .cat { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
			#object-editor .armed { color: var(--gold-2); min-height: 16px; margin: 6px 0; }
			#object-editor .row { display: flex; gap: 4px; margin-top: 5px; } #object-editor .row button { flex: 1; }
			#object-editor .hint, #object-editor .keys { color: var(--ink-dim); margin: 6px 0; line-height: 1.35; }
			#editor-tabs button, #object-editor button, #object-menu button { background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 6px; padding: 5px 6px; cursor: pointer; font: 12px Inter, system-ui, sans-serif; }
			#editor-tabs button:hover, #object-editor button:hover, #object-menu button:hover { border-color: var(--gold); }
			#editor-tabs button.on, #object-editor button.on, #object-menu button.on { background: rgba(201,164,92,.35); border-color: var(--gold-2); color: #fff; }
			#object-editor button.primary { background: rgba(60,90,42,.6); border-color: #7fae5a; }
			#object-editor button:disabled { opacity: .4; cursor: default; }
			#object-menu { position: fixed; left: 0; top: 0; z-index: 13; width: 158px; padding: 6px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink); }
			#object-menu .top { display: flex; justify-content: space-between; align-items: center; gap: 4px; color: var(--gold-2); }
			#object-menu .top .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			#object-menu .top button { padding: 0 7px; }
			#object-menu button { text-align: left; }
			#object-menu kbd { display: inline-block; min-width: 16px; text-align: center; border: 1px solid var(--panel-edge); border-radius: 3px; margin-right: 4px; font-size: 10px; }
			#object-menu button.danger { background: rgba(140,40,30,.55); border-color: #c0614f; text-align: center; }`;
		document.head.appendChild( style );
		this._status();
	}

	_status() {
		if ( ! this.ui ) return;
		this.ui.undo.disabled = ! this.undo.length;
		this.ui.redo.disabled = ! this.redo.length;
	}

	async saveFile() {
		const res = await fetch( '/__world-edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( this.edits ) } );
		if ( ! res.ok ) throw new Error( res.status );
		this.changed = false;
	}

	_toast( msg ) { if ( this.app.hud?.toast ) this.app.hud.toast( msg ); else console.info( msg ); }

}
