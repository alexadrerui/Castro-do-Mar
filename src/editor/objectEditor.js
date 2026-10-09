// Object editor (?edit, tab "Objetos"): select, move, turn, resize, remove and add the village
// objects (houses, market stalls, props), after the decoration editor of the Habitat Creator game:
// a click selects; the object gets a selection box, three's TransformControls gizmo and a small
// floating menu beside it (1 Move, 2 Rotate, 3 Scale, x close, Remove). The library (the Habitat
// Creator's decoration catalogue; items in editor/catalogue.js) adds new objects: a search, the
// category and size filters with their counts, cards with a picture of the object, its size and how
// many the village has; drag a card onto the village, or pick it and click on the ground. While one
// is picked a cyan box of its footprint follows the pointer on the ground.
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
import { CATALOGUE, CATEGORIES, itemOf } from './catalogue.js';
import { placeables, placeKey, localMatrix } from '../world/placed.js';

// sizes for the filter, by the larger side of the footprint (public/editor/thumbs.json)
const SIZES = [ { id: 'p', label: 'Pequenos (até 4 m)', max: 4 }, { id: 'm', label: 'Médios (4 a 12 m)', max: 12 }, { id: 'g', label: 'Grandes (mais de 12 m)', max: Infinity } ];
const fmt = ( v ) => v < 10 ? v.toFixed( 1 ).replace( '.', ',' ) : String( Math.round( v ) );
const plain = ( s ) => s.normalize( 'NFD' ).replace( /\p{M}/gu, '' ).toLowerCase();
const NAMES = { round: 'Casa redonda', long: 'Casa longa', hut: 'Cabana', granary: 'Celeiro', lookout: 'Torre de vigia', castro: 'Casa do castro', pen: 'Cercado', hay: 'Palheiro', well: 'Poço', cart: 'Carroça', rack: 'Varal', skep: 'Colmeia', wood: 'Lenha', gate: 'Pórtico', arch: 'Arco rústico' };
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
		// the plants and rocks placed before: groups of their own here (a normal load draws them in the
		// scatter's instances, world/placed.js)
		for ( const a of this.edits.added ) {
			const g = ( a.kind === 'plant' || a.kind === 'rock' ) && this._natureGroup( a );
			if ( g ) { this.root.add( g ); this._register( g ); }
		}
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
		// where a picked library item would go: its footprint's box on the ground under the pointer
		this.ghost = new THREE.LineSegments( new THREE.EdgesGeometry( new THREE.BoxGeometry( 1, 1, 1 ).translate( 0, 0.5, 0 ) ), new THREE.LineBasicMaterial( { color: 0x5fd0e8, depthTest: false, transparent: true } ) );
		this.ghost.renderOrder = 998;
		this.ghost.visible = false;
		this.ghost.frustumCulled = false;
		app.scene.add( this.ghost );
		this.sizes = {};         // item id -> { w, d, h } (m), from public/editor/thumbs.json
		this.filter = { q: '', cat: '', size: '' };

		this._buildUI();
		this._loadSizes();
		this._bind();
		app.onFrame.push( () => this.update() );
	}

	_register( g ) {
		g.rotation.order = 'YXZ'; // a full turn about Y reads back as rotation.y
		g.traverse( ( o ) => { o.matrixAutoUpdate = true; o.matrixWorldAutoUpdate = true; } );
		this.groups.set( g.userData.objId, g );
	}

	// ------------------------------------------------------------------ mode switch (tabs)

	// the tab switch (editor/tabs.js) shows one editor at a time
	setActive( on ) {
		if ( this.dragging || on === this.active ) return;
		this.active = on;
		this.panel.style.display = on ? '' : 'none';
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
			const k = g.userData.kind;
			const name = k === 'plant' || k === 'rock' ? CATALOGUE.find( ( c ) => c.id === itemOf( k, e ) )?.label ?? k : k === 'stall' ? 'Barraca' : NAMES[ e.type ] || e.type;
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
		// the objects' snapshot back; the paths, lakes and rivers are edited by the other tabs and stay
		const keep = { paths: this.edits.paths, lakes: this.edits.lakes, rivers: this.edits.rivers };
		this.edits = JSON.parse( st.json );
		Object.assign( this.edits, keep );
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
		for ( const b of this.panel.querySelectorAll( '[data-item]' ) ) b.classList.toggle( 'on', !! item && b.dataset.item === item.id );
		this.panel.querySelector( '.armed' ).textContent = item ? `Clique no chão para pôr: ${ item.label } (Esc cancela)` : '';
		if ( item ) {
			this.select( null );
			const s = this.sizes[ item.id ] || { w: 4, d: 4, h: 3 };
			this.ghost.scale.set( s.w, s.h, s.d );
		} else this.ghost.visible = false;
	}

	// the ghost box under the pointer while an item is picked (or dragged over the village)
	_ghostAt( x, y ) {
		if ( ! this.armed ) { this.ghost.visible = false; return null; }
		this.terrain.pointer.x = x; this.terrain.pointer.y = y;
		const p = this.terrain._pick();
		this.ghost.visible = !! p;
		if ( p ) this.ghost.position.set( p.x, this.hf.heightAt( p.x, p.z ), p.z );
		return p;
	}

	place( p ) {
		const item = this.armed;
		if ( ! item ) return;
		let n = 0;
		while ( this.groups.has( 'a' + n ) || this.edits.added.some( ( q ) => q.id === 'a' + n ) ) n ++;
		const id = 'a' + n, seed = 100 + n;
		const rec = { id, kind: item.kind, ...item.entry, x: +p.x.toFixed( 3 ), z: +p.z.toFixed( 3 ), seed, yaw: 0, scale: 1 };
		let g;
		if ( item.kind === 'plant' || item.kind === 'rock' ) {
			g = this._natureGroup( rec );
			if ( ! g ) { this._toast( 'Este item não está disponível nesta carga.' ); this.arm( null ); return; }
		} else {
			// the layout form of the entry, as world/worldEdits.js builds it on the next load
			const entry = item.kind === 'stall'
				? Object.assign( [ rec.x, rec.z, 0 ], { _id: id, seed, red: rec.red !== false, added: true } )
				: { ...rec, _id: id };
			g = objectGroup( this.app.buildingMaterials, item.kind, entry, this.hf );
			addProxies( g ); // its stand-ins in the reflection and the shadow pass
		}
		g.visible = false;
		this.root.add( g );
		this._register( g );
		const before = this._snap( g );
		this.edits.added.push( rec );
		g.visible = true;
		this._push( before, this._snap( g ) );
		this.arm( null );
		this.select( g );
		this._toast( `${ item.label } posto. Salvar e aplicar grava na vila.` );
	}

	// a hand-placed plant or rock (world/placed.js): a one-instance mesh of the scatter's own (same
	// material and pipeline), turned and sized as it was saved, in a group standing on the ground
	_natureGroup( rec ) {
		const reg = placeables[ placeKey( rec ) ];
		if ( ! reg ) return null;
		const mesh = reg.chunk.single( [ reg.tint( rec.seed ?? 1 ) ], !! reg.lo );
		localMatrix( rec, reg ).decompose( mesh.position, mesh.quaternion, mesh.scale );
		const g = new THREE.Group();
		g.add( mesh );
		g.position.set( rec.x, this.hf.heightAt( rec.x, rec.z ), rec.z );
		g.userData = { objId: rec.id, kind: rec.kind, entry: rec };
		return g;
	}

	// ------------------------------------------------------------------ picking

	_ray( x, y ) {
		const r = this.dom.getBoundingClientRect();
		this._ndc.set( ( x - r.left ) / r.width * 2 - 1, - ( ( y - r.top ) / r.height ) * 2 + 1 );
		this._raycaster.setFromCamera( this._ndc, this.camera );
		this._raycaster.layers.enableAll(); // the rocks and the small props are on layer 1
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
				const p = this._ghostAt( e.clientX, e.clientY );
				if ( p ) this.place( p );
				return;
			}
			this.select( this._pickObject( e.clientX, e.clientY ) );
		} );
		this.dom.addEventListener( 'pointermove', ( e ) => { if ( this.active && this.armed ) this._ghostAt( e.clientX, e.clientY ); } );
		this.dom.addEventListener( 'pointerleave', () => { this.ghost.visible = false; } );
		// a library card dropped on the village (HTML drag and drop: the card's dragstart picked it)
		this.dom.addEventListener( 'dragover', ( e ) => {
			if ( ! this.active || ! this._dragItem ) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy';
			this._ghostAt( e.clientX, e.clientY );
		} );
		this.dom.addEventListener( 'dragleave', () => { this.ghost.visible = false; } );
		this.dom.addEventListener( 'drop', ( e ) => {
			if ( ! this.active || ! this._dragItem ) return;
			e.preventDefault();
			const p = this._ghostAt( e.clientX, e.clientY );
			this._dragItem = null;
			if ( p ) this.place( p ); else this.arm( null );
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
		const el = document.createElement( 'div' );
		el.id = 'object-editor';
		el.className = 'panel';
		el.style.display = 'none';
		el.innerHTML = `
			<header><b>Biblioteca da vila</b></header>
			<input type="search" class="q" placeholder="Buscar no catálogo" spellcheck="false" />
			<div class="filters"><select class="f-cat" title="Categoria"></select><select class="f-size" title="Tamanho"></select></div>
			<div class="count"><span></span><button data-act="reset" class="link">Limpar filtros</button></div>
			<p class="hint">Arraste para a vila, ou escolha e clique no chão.</p>
			<div class="lib"></div>
			<p class="armed"></p>
			<div class="row"><button data-act="undo">Desfazer</button><button data-act="redo">Refazer</button></div>
			<div class="row"><button data-act="save" class="primary">Salvar e aplicar</button></div>
			<p class="keys">1 mover · 2 girar · 3 escalar · Delete: remover · Esc: soltar · Ctrl+Z/Y</p>`;
		document.body.appendChild( el );
		this.panel = el;
		this.lib = el.querySelector( '.lib' );
		const thumbs = `${ import.meta.env.BASE_URL }editor/thumbs/`;
		this.lib.innerHTML = CATALOGUE.map( ( c ) => `
			<button class="card" data-item="${ c.id }" draggable="true" title="${ c.label }: ${ c.desc }">
				<span class="pic"><img src="${ thumbs }${ c.id }.webp" alt="" draggable="false" loading="lazy" onerror="this.remove()" /></span>
				<b>${ c.label }</b>
				<small class="size"></small>
				<small class="have"></small>
			</button>` ).join( '' );
		for ( const b of this.lib.querySelectorAll( '[data-item]' ) ) {
			const item = CATALOGUE.find( ( c ) => c.id === b.dataset.item );
			b.onclick = () => this.arm( this.armed?.id === item.id ? null : item );
			b.addEventListener( 'dragstart', ( e ) => {
				this._dragItem = item;
				this.arm( item );
				e.dataTransfer.setData( 'text/plain', item.id );
				e.dataTransfer.effectAllowed = 'copy';
				const img = b.querySelector( 'img' );
				if ( img ) e.dataTransfer.setDragImage( img, 40, 40 );
			} );
			// dropped elsewhere (or cancelled): nothing picked
			b.addEventListener( 'dragend', () => { if ( this._dragItem ) { this._dragItem = null; this.arm( null ); } } );
		}
		const q = el.querySelector( '.q' ), fc = el.querySelector( '.f-cat' ), fs = el.querySelector( '.f-size' );
		q.oninput = () => { this.filter.q = q.value; this._filter(); };
		fc.onchange = () => { this.filter.cat = fc.value; this._filter(); };
		fs.onchange = () => { this.filter.size = fs.value; this._filter(); };
		el.querySelector( '[data-act=reset]' ).onclick = () => { this.filter = { q: '', cat: '', size: '' }; q.value = ''; this._filter(); };
		this.ui = { q, fc, fs };
		this._filter();
		el.querySelector( '[data-act=undo]' ).onclick = () => this.undoStep();
		el.querySelector( '[data-act=redo]' ).onclick = () => this.redoStep();
		el.querySelector( '[data-act=save]' ).onclick = () => this.terrain.save();
		Object.assign( this.ui, { undo: el.querySelector( '[data-act=undo]' ), redo: el.querySelector( '[data-act=redo]' ) } );

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
			#object-editor { position: fixed; top: 122px; left: 12px; bottom: 12px; width: 304px; max-width: calc(100vw - 24px); padding: 10px 12px; z-index: 12; font-size: 12px; color: var(--ink); display: flex; flex-direction: column; box-sizing: border-box; }
			#object-editor header { color: var(--gold-2); font-size: 13px; margin-bottom: 6px; }
			#object-editor .q { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 7px; border: 1px solid var(--panel-edge); background: rgba(0,0,0,.35); color: var(--ink); font: 12px Inter, system-ui, sans-serif; margin-bottom: 6px; }
			#object-editor .filters { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 4px; }
			#object-editor select { min-width: 0; padding: 5px 7px; border-radius: 6px; border: 1px solid var(--panel-edge); background: rgba(0,0,0,.35); color: var(--ink); font: 12px Inter, system-ui, sans-serif; }
			#object-editor .count { display: flex; justify-content: space-between; align-items: center; color: var(--ink-dim); margin: 2px 0; }
			#object-editor button.link { background: none; border: none; color: var(--gold-2); text-decoration: underline; padding: 0; }
			#object-editor .lib { flex: 1; min-height: 120px; overflow-y: auto; display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; align-content: start; padding-right: 2px; }
			#object-editor .card { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 6px; border-radius: 8px; background: rgba(0,0,0,.28); }
			#object-editor .card[hidden] { display: none; }
			#object-editor .card .pic { display: block; aspect-ratio: 1; border-radius: 6px; overflow: hidden; background: radial-gradient(circle at 50% 40%, rgba(201,164,92,.18), rgba(0,0,0,.2)); margin-bottom: 3px; }
			#object-editor .card img { width: 100%; height: 100%; object-fit: cover; display: block; }
			#object-editor .card b { font-weight: 600; font-size: 11.5px; line-height: 1.2; }
			#object-editor .card small { color: var(--ink-dim); font-size: 10.5px; line-height: 1.25; }
			#object-editor .card .have { color: var(--gold-2); }
			#object-editor .card.on { outline: 2px solid var(--gold-2); }
			#object-editor .armed { color: var(--gold-2); min-height: 16px; margin: 6px 0; }
			#object-editor .row { display: flex; gap: 4px; margin-top: 5px; } #object-editor .row button { flex: 1; }
			#object-editor .hint, #object-editor .keys { color: var(--ink-dim); margin: 6px 0; line-height: 1.35; }
			#object-editor button, #object-menu button { background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 6px; padding: 5px 6px; cursor: pointer; font: 12px Inter, system-ui, sans-serif; }
			#object-editor button:hover, #object-menu button:hover { border-color: var(--gold); }
			#object-editor button.on, #object-menu button.on { background: rgba(201,164,92,.35); border-color: var(--gold-2); color: #fff; }
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
		this._counts();
	}

	// ------------------------------------------------------------------ library

	// the footprints and heights measured by tools/thumbs.mjs (absent: no sizes, the size filter waits)
	async _loadSizes() {
		try {
			const res = await fetch( `${ import.meta.env.BASE_URL }editor/thumbs.json` );
			if ( res.ok ) this.sizes = await res.json();
		} catch ( e ) { /* no file: the cards go without sizes */ }
		for ( const b of this.lib.querySelectorAll( '[data-item]' ) ) {
			const s = this.sizes[ b.dataset.item ];
			b.querySelector( '.size' ).textContent = s ? `${ fmt( s.w ) } × ${ fmt( s.d ) } m · ${ fmt( s.h ) } m alt.` : '';
		}
		this._filter();
	}

	// what the search and the filters leave, and the counts of each choice under the others
	_filter() {
		const { q, cat, size } = this.filter;
		const words = plain( q ).split( /\s+/ ).filter( Boolean );
		const sizeOf = ( c ) => { const s = this.sizes[ c.id ]; if ( ! s ) return ''; const m = Math.max( s.w, s.d ); return SIZES.find( ( z ) => m <= z.max ).id; };
		const match = ( c, use ) => ( ! words.length || words.every( ( w ) => plain( `${ c.label } ${ c.desc } ${ CATEGORIES.find( ( k ) => k.id === c.cat ).label }` ).includes( w ) ) )
			&& ( ! use.cat || c.cat === use.cat ) && ( ! use.size || sizeOf( c ) === use.size );
		let n = 0;
		for ( const b of this.lib.querySelectorAll( '[data-item]' ) ) {
			const ok = match( CATALOGUE.find( ( c ) => c.id === b.dataset.item ), this.filter );
			b.hidden = ! ok; if ( ok ) n ++;
		}
		const count = ( use ) => CATALOGUE.filter( ( c ) => match( c, use ) ).length;
		this.ui.fc.innerHTML = `<option value="">Todas · ${ count( { cat: '', size } ) }</option>` + CATEGORIES.map( ( k ) => `<option value="${ k.id }">${ k.label } · ${ count( { cat: k.id, size } ) }</option>` ).join( '' );
		this.ui.fc.value = cat;
		const sized = Object.keys( this.sizes ).length > 0;
		this.ui.fs.disabled = ! sized;
		this.ui.fs.innerHTML = `<option value="">Tamanhos · ${ count( { cat, size: '' } ) }</option>` + ( sized ? SIZES.map( ( z ) => `<option value="${ z.id }">${ z.label } · ${ count( { cat, size: z.id } ) }</option>` ).join( '' ) : '' );
		this.ui.fs.value = size;
		this.panel.querySelector( '.count span' ).textContent = `${ n } ${ n === 1 ? 'item' : 'itens' }`;
		this.panel.querySelector( '[data-act=reset]' ).style.visibility = q || cat || size ? '' : 'hidden';
	}

	// how many of each the village has now (the objects still standing, added ones included)
	_counts() {
		if ( ! this.lib ) return;
		const n = {};
		for ( const g of this.groups.values() ) {
			if ( ! g.visible ) continue;
			const t = itemOf( g.userData.kind, g.userData.entry );
			n[ t ] = ( n[ t ] || 0 ) + 1;
		}
		for ( const b of this.lib.querySelectorAll( '[data-item]' ) ) {
			const item = CATALOGUE.find( ( c ) => c.id === b.dataset.item );
			let k = n[ item.id ] || 0;
			if ( item.kind === 'plant' || item.kind === 'rock' ) {
				// the map's whole scatter of that species or style (the placed ones are groups here); the
				// variants that share their instances with another item count only the hand-placed ones
				const reg = placeables[ placeKey( { kind: item.kind, ...item.entry } ) ];
				const shared = item.id === 'rock-tor-large' || item.id === 'birch-gold';
				if ( reg && ! shared ) k += reg.chunk.count;
				b.querySelector( '.have' ).textContent = shared ? ( k ? `${ k } posta${ k > 1 ? 's' : '' } à mão` : 'Nenhuma posta à mão' ) : `${ k.toLocaleString( 'pt-BR' ) } no mapa`;
			} else b.querySelector( '.have' ).textContent = k ? `${ k } na vila` : 'Nenhum na vila';
		}
	}

	exportFile() {
		const a = document.createElement( 'a' );
		a.href = URL.createObjectURL( new Blob( [ JSON.stringify( this.edits, null, '\t' ) ], { type: 'application/json' } ) );
		a.download = 'world-edits.json';
		a.click();
		setTimeout( () => URL.revokeObjectURL( a.href ), 1000 );
	}

	async saveFile() {
		const res = await fetch( '/__world-edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( this.edits ) } );
		if ( ! res.ok ) throw new Error( res.status );
		this.changed = false;
	}

	_toast( msg ) { if ( this.app.hud?.toast ) this.app.hud.toast( msg ); else console.info( msg ); }

}
