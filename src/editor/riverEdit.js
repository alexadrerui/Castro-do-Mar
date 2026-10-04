// The river tool's two floating boxes and the editing of a river already laid (terrain editor, "Rio").
//
// - While a course is being laid: a box beside its last point (as the object editor's menu beside a
//   selection) with Concluir (Enter), Tirar último (Backspace) and Cancelar (Esc).
// - "Selecionar rio" then a click on a river: its control points become handles, the way three's curve
//   modifier examples edit a curve (examples/webgpu_modifier_curve.html, webgl_modifier_curve_instanced
//   .html: a CatmullRomCurve3 through handle meshes, a TransformControls attached to the handle clicked,
//   the curve redrawn as it moves, things carried along it). Here the course is drawn with its two
//   banks at the river's width, and a row of chevrons runs down it with three's GPU curve modifier
//   (CurveModifierGPU.js Flow: the instanced flow of the second example has no WebGPU version, so one
//   mesh of chevrons spaced along +X is bent along the curve and moved by its path offset). A box beside
//   it holds the width (all the points, or the one picked), Aplicar (Enter), Cancelar (Esc) and
//   Remover. Shift+click on a handle takes the point out; Ctrl+click on the ground adds one there.
// - Aplicar takes the old river out, puts the relief under it back (the carve saved with the river,
//   record.carve: cells and their change; a river laid before that has its corridor restored to the
//   procedural relief instead), then lays the edited course as the tool does: a new carve, levels, water.
import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Flow } from 'three/addons/modifiers/CurveModifierGPU.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleCurve, BANK_BLEND } from '../world/riverCourse.js';
import { WATER_LEVEL } from '../world/layout.js';

const LIFT = 1.2;       // m: handles, lines and chevrons over the ground (or the water)
const CHEVRON = 9;      // m between the chevrons running down the course

export class RiverEdit {

	constructor( ed ) {
		this.ed = ed;
		this.app = ed.app;
		this.selecting = false; // the next click picks a river
		this.river = null;      // the river being edited (app.rivers entry)
		this.points = null;     // its control points [ x, z, width ] while edited
		this.picked = - 1;      // the handle the gizmo is on
		this._ndc = new THREE.Vector2();
		this._ray = new THREE.Raycaster();
		this._v = new THREE.Vector3();
		this.group = new THREE.Group();
		this.group.name = 'river-edit';
		this.app.scene.add( this.group );
		this.handleGeo = new THREE.SphereGeometry( 1, 16, 12 );
		this.handleMat = new THREE.MeshBasicNodeMaterial( { color: 0xe6c987, depthTest: false, transparent: true } );
		this.handlePicked = new THREE.MeshBasicNodeMaterial( { color: 0x5fd0e8, depthTest: false, transparent: true } );
		this.handles = [];
		const line = ( color, n ) => {
			const g = new THREE.BufferGeometry();
			g.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 3 * n ), 3 ) );
			const l = new THREE.Line( g, new THREE.LineBasicNodeMaterial( { color, depthTest: false, transparent: true, opacity: 0.95 } ) );
			l.frustumCulled = false; l.renderOrder = 998; l.visible = false;
			this.group.add( l );
			return l;
		};
		this.center = line( 0x5fc8e8, 4096 );
		this.bankL = line( 0xb7e3f0, 4096 );
		this.bankR = line( 0xb7e3f0, 4096 );
		// the gizmo, on the ground plane only
		this.tc = new TransformControls( this.ed.camera, this.ed.dom );
		this.tc.setSpace( 'world' );
		this.tc.showY = false;
		this.tc.setSize( 0.8 );
		this.gizmo = this.tc.getHelper();
		this.gizmo.visible = false;
		this.app.scene.add( this.gizmo );
		this.tc.addEventListener( 'objectChange', () => this._handleMoved() );
		this.tc.addEventListener( 'dragging-changed', ( e ) => { this.dragging = e.value; if ( ! e.value ) this._flowCurve(); } );
		this._buildMenus();
		this.app.onFrame.push( ( dt ) => this.update( dt ) );
	}

	get editing() { return !! this.river; }

	// ------------------------------------------------------------------ boxes

	_buildMenus() {
		const style = document.createElement( 'style' );
		style.textContent = `
			.river-menu { position: fixed; left: 0; top: 0; z-index: 13; width: 190px; padding: 7px; display: flex; flex-direction: column; gap: 5px; font: 12px Inter, system-ui, sans-serif; color: var(--ink); }
			.river-menu .top { display: flex; justify-content: space-between; align-items: center; gap: 4px; color: var(--gold-2); }
			.river-menu .top button { padding: 0 7px; text-align: center; }
			.river-menu button { background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 6px; padding: 5px 6px; cursor: pointer; font: 12px Inter, system-ui, sans-serif; text-align: left; }
			.river-menu button:hover { border-color: var(--gold); }
			.river-menu button.ok { background: rgba(60,110,140,.55); border-color: #5fc8e8; color: #fff; }
			.river-menu button.danger { background: rgba(140,40,30,.55); border-color: #c0614f; text-align: center; }
			.river-menu button:disabled { opacity: .45; cursor: default; }
			.river-menu kbd { display: inline-block; min-width: 16px; text-align: center; border: 1px solid var(--panel-edge); border-radius: 3px; margin-right: 4px; font-size: 10px; }
			.river-menu label { display: block; color: var(--ink-dim); }
			.river-menu label output { float: right; color: var(--ink); }
			.river-menu input[type=range] { width: 100%; accent-color: var(--gold); }
			.river-menu .tip { color: var(--ink-dim); font-size: 11px; line-height: 1.35; }`;
		document.head.appendChild( style );
		const make = ( html ) => {
			const m = document.createElement( 'div' );
			m.className = 'river-menu panel';
			m.style.display = 'none';
			m.innerHTML = html;
			document.body.appendChild( m );
			return m;
		};
		// laying a course
		this.drawMenu = make( `
			<div class="top"><span class="name">Rio</span></div>
			<button data-act="done" class="ok"><kbd>Enter</kbd> Concluir</button>
			<button data-act="pop"><kbd>⌫</kbd> Tirar o último ponto</button>
			<button data-act="cancel"><kbd>Esc</kbd> Cancelar</button>` );
		this.drawMenu.querySelector( '[data-act=done]' ).onclick = () => this.ed._riverFinish();
		this.drawMenu.querySelector( '[data-act=pop]' ).onclick = () => { this.ed.river.points.pop(); this.ed._riverPreview(); };
		this.drawMenu.querySelector( '[data-act=cancel]' ).onclick = () => this.ed._riverCancel();
		// editing a river
		this.editMenu = make( `
			<div class="top"><span class="name">Rio</span><button data-act="close" title="Cancelar (Esc)">×</button></div>
			<label>Largura (todos) <output data-o="all"></output><input data-k="all" type="range" min="2" max="24" step="0.5"></label>
			<label data-row="one">Largura deste ponto <output data-o="one"></output><input data-k="one" type="range" min="2" max="24" step="0.5"></label>
			<div class="tip">Arraste os pontos dourados · Shift+clique num ponto tira · Ctrl+clique no chão põe um ponto</div>
			<button data-act="apply" class="ok"><kbd>Enter</kbd> Aplicar</button>
			<button data-act="cancel"><kbd>Esc</kbd> Cancelar</button>
			<button data-act="remove" class="danger">Remover o rio</button>` );
		const q = ( s ) => this.editMenu.querySelector( s );
		q( '[data-act=close]' ).onclick = () => this.cancel();
		q( '[data-act=cancel]' ).onclick = () => this.cancel();
		q( '[data-act=apply]' ).onclick = () => this.apply();
		q( '[data-act=remove]' ).onclick = () => this.removeRiver();
		q( '[data-k=all]' ).oninput = ( e ) => { for ( const p of this.points ) p[ 2 ] = + e.target.value; this._refresh(); };
		q( '[data-k=one]' ).oninput = ( e ) => { if ( this.picked >= 0 ) this.points[ this.picked ][ 2 ] = + e.target.value; this._refresh(); };
	}

	// beside the point, on the side away from the pointer: the next click (a new point, a drag) lands
	// where the pointer is, and a box there swallowed it
	_place( menu, x, y, z ) {
		const r = this.ed.dom.getBoundingClientRect();
		const p = this._v.set( x, y, z ).project( this.ed.camera );
		const vis = p.z < 1 && Math.abs( p.x ) < 1.2 && Math.abs( p.y ) < 1.2;
		const w = menu.offsetWidth || 190, h = menu.offsetHeight || 150;
		if ( ! vis ) { menu.style.transform = `translate(${ r.width - w - 300 }px, 90px)`; return; }
		const px = ( p.x * 0.5 + 0.5 ) * r.width, py = ( 0.5 - p.y * 0.5 ) * r.height;
		const ptr = this.ed.pointer, cx = ptr.inside ? ptr.x - r.left : px + 1, cy = ptr.inside ? ptr.y - r.top : py;
		let dx = px - cx, dy = py - cy;
		const l = Math.hypot( dx, dy );
		if ( l < 1 ) { dx = 1; dy = 0; } else { dx /= l; dy /= l; }
		// the box's centre ~ its half size plus a gap away from the point, opposite the pointer
		const reach = Math.max( w, h ) * 0.5 + 36;
		let sx = px + dx * reach - w / 2, sy = py + dy * reach - h / 2;
		sx = Math.min( r.width - w - 8, Math.max( 8, sx ) );
		sy = Math.min( r.height - h - 8, Math.max( 8, sy ) );
		menu.style.transform = `translate(${ sx }px, ${ sy }px)`;
	}

	update() {
		const ed = this.ed, drawing = ed.active && ed.tool === 'river' && ! this.editing && ed.river.points.length > 0;
		this.drawMenu.style.display = drawing ? '' : 'none';
		if ( drawing ) {
			const pts = ed.river.points, last = pts.at( - 1 );
			this.drawMenu.querySelector( '.name' ).textContent = `Rio · ${ pts.length } ponto${ pts.length > 1 ? 's' : '' }`;
			this.drawMenu.querySelector( '[data-act=done]' ).disabled = pts.length < 2;
			this._place( this.drawMenu, last[ 0 ], this._ground( last[ 0 ], last[ 1 ] ), last[ 1 ] );
		}
		this.editMenu.style.display = this.editing ? '' : 'none';
		if ( this.editing ) {
			// the handles keep about the same size on screen, from the ground or from high above
			const cam = this.ed.camera.position;
			for ( let i = 0; i < this.handles.length; i ++ ) {
				const h = this.handles[ i ];
				h.scale.setScalar( Math.max( Math.max( 0.8, this.points[ i ][ 2 ] * 0.18 ), h.position.distanceTo( cam ) * 0.012 ) );
			}
			const k = this.picked >= 0 ? this.picked : Math.floor( this.points.length / 2 ), p = this.points[ k ];
			this._place( this.editMenu, p[ 0 ], this._ground( p[ 0 ], p[ 1 ] ), p[ 1 ] );
			if ( this.flow ) this.flow.moveAlongCurve( 0.0015 );
		}
	}

	_ground( x, z ) { return Math.max( this.ed.hf.heightAt( x, z ), WATER_LEVEL ) + LIFT; }

	// ------------------------------------------------------------------ selection

	// "Selecionar rio": the next click on a river picks it
	startSelect() {
		if ( ! this.app.rivers?.list.length ) { this.ed._toast( 'Ainda não há rio para editar.' ); return; }
		if ( this.editing ) this.cancel();
		this.ed._riverCancel();
		this.selecting = true;
		this.ed._toast( 'Clique num rio para editá-lo (Esc desiste).' );
	}

	// a click of the river tool while selecting or editing (e: the pointer event); true if taken
	click( hit, e ) {
		if ( this.selecting ) {
			this.selecting = false;
			const r = hit && this.app.rivers.at( hit.x, hit.z, 4 );
			if ( ! r ) { this.ed._toast( 'Nenhum rio aqui.' ); return true; }
			this.select( r );
			return true;
		}
		if ( ! this.editing ) return false;
		// on the gizmo: TransformControls takes it
		this.tc.pointerHover( this.tc._getPointer( e ) );
		if ( this.tc.axis !== null ) return true;
		const k = this._handleAt( e );
		if ( k >= 0 ) {
			if ( e.shiftKey ) {
				if ( this.points.length <= 2 ) { this.ed._toast( 'O rio precisa de pelo menos dois pontos.' ); return true; }
				this.points.splice( k, 1 );
				this.picked = - 1;
				this._rebuildHandles();
				return true;
			}
			this._pick( k );
			return true;
		}
		if ( ( e.ctrlKey || e.metaKey ) && hit ) { this._insert( hit.x, hit.z ); return true; }
		this._pick( - 1 );
		return true;
	}

	select( river ) {
		this.river = river;
		this.points = river.record.points.map( ( p ) => p.slice() );
		this._rebuildHandles();
		this._pick( - 1 ); // no point picked yet: the per-point width hidden
		const all = this.editMenu.querySelector( '[data-k=all]' );
		all.value = this.points[ 0 ][ 2 ];
		this.editMenu.querySelector( '[data-o=all]' ).textContent = ( + all.value ).toFixed( 1 ) + ' m';
		this.ed._toast( 'Rio selecionado: arraste os pontos, mude a largura e Aplique (Enter).' );
	}

	cancel() {
		this.selecting = false;
		if ( ! this.river ) return;
		this.river = null; this.points = null; this.picked = - 1;
		this.tc.detach(); this.gizmo.visible = false;
		for ( const h of this.handles ) this.group.remove( h );
		this.handles = [];
		for ( const l of [ this.center, this.bankL, this.bankR ] ) l.visible = false;
		if ( this.flow ) { this.group.remove( this.flow.object3D ); this.flow = null; }
	}

	_pick( k ) {
		this.picked = k;
		for ( let i = 0; i < this.handles.length; i ++ ) this.handles[ i ].material = i === k ? this.handlePicked : this.handleMat;
		if ( k >= 0 ) { this.tc.attach( this.handles[ k ] ); this.gizmo.visible = true; } else { this.tc.detach(); this.gizmo.visible = false; }
		const row = this.editMenu.querySelector( '[data-row=one]' );
		row.style.display = k >= 0 ? '' : 'none';
		if ( k >= 0 ) {
			row.querySelector( 'input' ).value = this.points[ k ][ 2 ];
			row.querySelector( 'output' ).textContent = this.points[ k ][ 2 ].toFixed( 1 ) + ' m';
		}
	}

	_handleAt( e ) {
		const r = this.ed.dom.getBoundingClientRect();
		this._ndc.set( ( ( e.clientX - r.left ) / r.width ) * 2 - 1, - ( ( e.clientY - r.top ) / r.height ) * 2 + 1 );
		this._ray.setFromCamera( this._ndc, this.ed.camera );
		const hits = this._ray.intersectObjects( this.handles, false );
		return hits.length ? this.handles.indexOf( hits[ 0 ].object ) : - 1;
	}

	// a new point where the course passes nearest: between the two control points around it
	_insert( x, z ) {
		const P = this.points;
		let best = 0, bd = Infinity;
		for ( let i = 0; i < P.length - 1; i ++ ) {
			const ax = P[ i ][ 0 ], az = P[ i ][ 1 ], bx = P[ i + 1 ][ 0 ], bz = P[ i + 1 ][ 1 ];
			const l2 = ( bx - ax ) ** 2 + ( bz - az ) ** 2 || 1, t = Math.max( 0, Math.min( 1, ( ( x - ax ) * ( bx - ax ) + ( z - az ) * ( bz - az ) ) / l2 ) );
			const d = Math.hypot( ax + ( bx - ax ) * t - x, az + ( bz - az ) * t - z );
			if ( d < bd ) { bd = d; best = i; }
		}
		const w = ( P[ best ][ 2 ] + P[ best + 1 ][ 2 ] ) / 2;
		P.splice( best + 1, 0, [ + x.toFixed( 2 ), + z.toFixed( 2 ), w ] );
		this._rebuildHandles();
		this._pick( best + 1 );
	}

	// ------------------------------------------------------------------ drawing the course

	_rebuildHandles() {
		for ( const h of this.handles ) this.group.remove( h );
		this.handles = this.points.map( ( p ) => {
			const h = new THREE.Mesh( this.handleGeo, this.handleMat );
			h.position.set( p[ 0 ], this._ground( p[ 0 ], p[ 1 ] ), p[ 1 ] );
			h.scale.setScalar( Math.max( 0.8, p[ 2 ] * 0.18 ) );
			h.renderOrder = 999;
			this.group.add( h );
			return h;
		} );
		this._refresh();
		this._flowCurve();
	}

	_handleMoved() {
		const k = this.picked, h = this.handles[ k ];
		if ( k < 0 || ! h ) return;
		h.position.y = this._ground( h.position.x, h.position.z );
		this.points[ k ][ 0 ] = + h.position.x.toFixed( 2 );
		this.points[ k ][ 1 ] = + h.position.z.toFixed( 2 );
		this._refresh();
	}

	// the course and its banks, as the river will be laid (the same curve as riverCourse.js)
	_refresh() {
		const S = sampleCurve( this.points );
		const m = Math.min( S.length, 4096 );
		const c = this.center.geometry.attributes.position, L = this.bankL.geometry.attributes.position, R = this.bankR.geometry.attributes.position;
		for ( let q = 0; q < m; q ++ ) {
			const s = S[ q ], hw = s.width / 2, nx = - s.dz, nz = s.dx;
			c.setXYZ( q, s.x, this._ground( s.x, s.z ), s.z );
			L.setXYZ( q, s.x + nx * hw, this._ground( s.x + nx * hw, s.z + nz * hw ), s.z + nz * hw );
			R.setXYZ( q, s.x - nx * hw, this._ground( s.x - nx * hw, s.z - nz * hw ), s.z - nz * hw );
		}
		for ( const l of [ this.center, this.bankL, this.bankR ] ) {
			l.geometry.attributes.position.needsUpdate = true;
			l.geometry.setDrawRange( 0, m );
			l.visible = m > 1;
		}
		for ( let i = 0; i < this.handles.length; i ++ ) this.handles[ i ].scale.setScalar( Math.max( 0.8, this.points[ i ][ 2 ] * 0.18 ) );
		const all = this.editMenu.querySelector( '[data-o=all]' );
		all.textContent = ( + this.editMenu.querySelector( '[data-k=all]' ).value ).toFixed( 1 ) + ' m';
		if ( this.picked >= 0 ) this.editMenu.querySelector( '[data-o=one]' ).textContent = this.points[ this.picked ][ 2 ].toFixed( 1 ) + ' m';
		let len = 0;
		for ( let q = 1; q < S.length; q ++ ) len += Math.hypot( S[ q ].x - S[ q - 1 ].x, S[ q ].z - S[ q - 1 ].z );
		this.editMenu.querySelector( '.name' ).textContent = `Rio · ${ Math.round( len ) } m · ${ this.points.length } pontos`;
	}

	// the chevrons running down the course: three's GPU curve modifier (Flow) on a CatmullRomCurve3
	// through the handles, rebuilt when a drag ends (as in the example)
	_flowCurve() {
		if ( ! this.points ) return;
		const curve = new THREE.CatmullRomCurve3( this.handles.map( ( h ) => h.position.clone() ), false, 'centripetal' );
		const len = curve.getLength();
		if ( this.flow ) this.group.remove( this.flow.object3D );
		const n = Math.max( 2, Math.min( 120, Math.floor( len / CHEVRON ) ) ), parts = [];
		for ( let i = 0; i < n; i ++ ) parts.push( new THREE.ConeGeometry( 0.7, 2.2, 10 ).rotateZ( - Math.PI / 2 ).translate( i * ( len / n ), 0.4, 0 ) );
		const mesh = new THREE.Mesh( mergeGeometries( parts ), new THREE.MeshBasicNodeMaterial( { color: 0x5fd0e8, depthTest: false, transparent: true, opacity: 0.9 } ) );
		this.flow = new Flow( mesh );
		this.flow.updateCurve( 0, curve );
		this.flow.object3D.traverse( ( o ) => { o.frustumCulled = false; o.renderOrder = 997; } );
		this.group.add( this.flow.object3D );
	}

	// ------------------------------------------------------------------ apply / remove

	// the relief under a river put back: its saved carve undone, or (a river laid before the carve was
	// saved) its corridor restored to the procedural relief. One undoable stroke.
	_unCarve( river ) {
		const ed = this.ed, hf = ed.hf, n = hf.n, rec = river.record;
		ed.stroke = { touched: new Map(), flattenTo: 0, noise: null, last: new THREE.Vector3() };
		let i0 = n, j0 = n, i1 = - 1, j1 = - 1;
		const touch = ( k ) => { const i = k % n, j = ( k - i ) / n; i0 = Math.min( i0, i ); i1 = Math.max( i1, i ); j0 = Math.min( j0, j ); j1 = Math.max( j1, j ); };
		if ( rec.carve?.k?.length ) {
			const { k, d } = rec.carve;
			for ( let q = 0; q < k.length; q ++ ) { ed._set( k[ q ], hf.data[ k[ q ] ] - d[ q ] ); touch( k[ q ] ); }
		} else {
			const S = river.course.samples;
			let x0 = Infinity, z0 = Infinity, x1 = - Infinity, z1 = - Infinity, wmax = 0;
			for ( const s of S ) { x0 = Math.min( x0, s.x ); x1 = Math.max( x1, s.x ); z0 = Math.min( z0, s.z ); z1 = Math.max( z1, s.z ); wmax = Math.max( wmax, s.width ); }
			const pad = wmax / 2 + BANK_BLEND + 2;
			const a0 = Math.max( 0, Math.floor( ( x0 - pad - hf.x0 ) / hf.cell ) ), a1 = Math.min( n - 1, Math.ceil( ( x1 + pad - hf.x0 ) / hf.cell ) );
			const b0 = Math.max( 0, Math.floor( ( z0 - pad - hf.z0 ) / hf.cell ) ), b1 = Math.min( n - 1, Math.ceil( ( z1 + pad - hf.z0 ) / hf.cell ) );
			for ( let j = b0; j <= b1; j ++ ) for ( let i = a0; i <= a1; i ++ ) {
				const x = hf.x0 + i * hf.cell, z = hf.z0 + j * hf.cell;
				let near = false;
				for ( const s of S ) if ( Math.hypot( s.x - x, s.z - z ) < s.width / 2 + BANK_BLEND + 1 ) { near = true; break; }
				if ( ! near ) continue;
				const k = j * n + i;
				if ( ed.delta[ k ] !== 0 ) { ed._set( k, ed.base[ k ] ); touch( k ); }
			}
		}
		if ( i1 >= 0 ) ed._markDirty( i0, j0, i1, j1 );
		ed._end();
	}

	_takeOut( river ) {
		const rivers = this.app.rivers, obj = this.app.objectEditor;
		rivers.remove( river );
		const first = river.record.points[ 0 ];
		obj.edits.rivers = ( obj.edits.rivers ?? [] ).filter( ( q ) => q !== river.record && ! ( q.points[ 0 ][ 0 ] === first[ 0 ] && q.points[ 0 ][ 1 ] === first[ 1 ] ) );
		obj.changed = true;
		this._unCarve( river );
	}

	apply() {
		if ( ! this.editing ) return;
		const river = this.river, points = this.points.map( ( p ) => p.slice() );
		this.cancel();
		this._takeOut( river );
		this.ed.river.points = points;
		this.ed._riverFinish();
		this.app.refreshWaterLevels?.();
	}

	removeRiver() {
		if ( ! this.editing ) return;
		const river = this.river;
		this.cancel();
		this._takeOut( river );
		this.app.refreshWaterLevels?.();
		this.ed._toast( 'Rio removido e o relevo sob ele refeito (Ctrl+Z desfaz o relevo). Salve para aplicar.' );
	}

}
