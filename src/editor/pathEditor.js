// Paths (?edit, tab "Caminhos"): lay new tracks and edit or remove the village's own (layout.js
// PATHS), later streets and pavements (each path carries a `type`; for now only 'trilha', a dirt
// track). The edits go to world-edits.json (`paths`, world/worldEdits.js), applied to PATHS before the
// relief, the mask, the vegetation and the lanes read them: the dirt, the ruts, the clearings, the
// grass on the track and the fences follow on "Salvar e aplicar" (the page reloads). Here the courses
// are drawn over the ground as they will be: the centre line and both edges at the path's width.
//
// - Traçar: a click per point, Enter (or the box beside the last point) concludes, Backspace takes
//   the last back, Esc cancels.
// - Editar: every path drawn over the ground; the one under the pointer lit; a click picks it: its
//   points become handles moved by a TransformControls on the ground plane (as the river's, three's
//   curve examples), a box holds the width, Aplicar (Enter), Cancelar (Esc), Remover. Shift+click on a
//   handle takes the point out, Ctrl+click on the ground adds one.
import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PATHS, WATER_LEVEL } from '../world/layout.js';
import { pathCurve } from '../world/heightfield.js';

const LIFT = 0.6;  // m over the ground: the lines
const TYPES = [ { id: 'trilha', label: 'Trilha de terra' }, { id: 'rua', label: 'Rua (em breve)', off: true }, { id: 'calcada', label: 'Calçada (em breve)', off: true } ];
const MAX_LINE = 8192;

export class PathEditor {

	// app: hf, camera, renderer, scene, freecam, objectEditor (its edits are saved as world-edits.json);
	// relief: the relief editor (picking the ground, the view from above, the shared save, the boxes' style)
	constructor( app, relief ) {
		this.app = app;
		this.relief = relief;
		this.hf = app.hf;
		this.camera = app.camera;
		this.dom = app.renderer.domElement;
		this.active = false;
		this.mode = 'draw';
		this.width = 2.4;
		this.type = 'trilha';
		this.points = [];      // the path being laid
		this.sel = null;       // the path being edited: an entry of this.list
		this.edit = null;      // its points [ x, z ] while edited, and its width
		this.picked = - 1;
		this.changed = false;
		const ed = app.objectEditor.edits;
		ed.paths ??= { changed: {}, added: [] };
		ed.paths.changed ??= {}; ed.paths.added ??= [];
		// the working list: every path as it stands (PATHS already holds the saved edits)
		this.list = PATHS.map( ( p ) => ( { id: p._id, pts: p.pts.map( ( q ) => q.slice() ), w: p.w, type: p.type || 'trilha', o: p._id.startsWith( 'c' ) ? this._origin( p ) : null } ) );
		this.group = new THREE.Group();
		this.group.name = 'path-editor';
		this.group.visible = false;
		app.scene.add( this.group );
		this._ray = new THREE.Raycaster();
		this._ndc = new THREE.Vector2();
		this._v = new THREE.Vector3();
		this._lines();
		this.handleGeo = new THREE.SphereGeometry( 1, 14, 10 );
		this.handleMat = new THREE.MeshBasicNodeMaterial( { color: 0xe6c987, depthTest: false, transparent: true } );
		this.handlePicked = new THREE.MeshBasicNodeMaterial( { color: 0x5fd0e8, depthTest: false, transparent: true } );
		this.handles = [];
		this.tc = new TransformControls( this.camera, this.dom );
		this.tc.setSpace( 'world' );
		this.tc.showY = false;
		this.tc.setSize( 0.8 );
		this.gizmo = this.tc.getHelper();
		this.gizmo.visible = false;
		app.scene.add( this.gizmo );
		this.tc.addEventListener( 'objectChange', () => this._handleMoved() );
		this.tc.addEventListener( 'dragging-changed', ( e ) => { this.dragging = e.value; } );
		this._buildPanel();
		this._buildBoxes();
		this._bind();
		this._redrawAll();
		app.onFrame.push( () => this.update() );
	}

	// the original's first point as layout.js has it (the guard of its edit)
	_origin( p ) {
		const m = this.app.objectEditor.edits.paths?.changed?.[ p._id ];
		return m?.o ?? [ + p.pts[ 0 ][ 0 ].toFixed( 3 ), + p.pts[ 0 ][ 1 ].toFixed( 3 ) ];
	}

	setActive( on ) {
		this.active = on;
		this.panel.style.display = on ? '' : 'none';
		this.group.visible = on;
		if ( ! on ) { this._cancelDraw(); this._deselect(); }
		this.dom.style.cursor = '';
	}

	// ------------------------------------------------------------------ drawing

	_line( color, opacity = 0.95 ) {
		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 3 * MAX_LINE ), 3 ) );
		g.setDrawRange( 0, 0 );
		const l = new THREE.LineSegments( g, new THREE.LineBasicNodeMaterial( { color, depthTest: false, transparent: true, opacity } ) );
		l.frustumCulled = false; l.renderOrder = 997;
		this.group.add( l );
		return l;
	}

	_lines() {
		this.allLine = this._line( 0xe6c987, 0.55 );   // every path (Editar)
		this.hoverLine = this._line( 0xffe7a0, 1 );    // the one under the pointer
		this.workLine = this._line( 0x7fe0a0, 1 );     // being laid / edited: centre and edges
	}

	_ground( x, z ) { return Math.max( this.hf.heightAt( x, z ), WATER_LEVEL ) + LIFT; }

	// a path's centre and both edges as line segments (into an array of xyz)
	_pathSegments( pts, w, out, withEdges ) {
		if ( pts.length < 2 ) return;
		const c = pathCurve( pts );
		const put = ( a, b ) => { out.push( a[ 0 ], this._ground( a[ 0 ], a[ 1 ] ), a[ 1 ], b[ 0 ], this._ground( b[ 0 ], b[ 1 ] ), b[ 1 ] ); };
		for ( let i = 1; i < c.length; i ++ ) put( c[ i - 1 ], c[ i ] );
		if ( ! withEdges ) return;
		const edge = ( s ) => c.map( ( p, i ) => {
			const a = c[ Math.max( 0, i - 1 ) ], b = c[ Math.min( c.length - 1, i + 1 ) ], l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) || 1;
			return [ p[ 0 ] - ( b[ 1 ] - a[ 1 ] ) / l * w / 2 * s, p[ 1 ] + ( b[ 0 ] - a[ 0 ] ) / l * w / 2 * s ];
		} );
		for ( const e of [ edge( 1 ), edge( - 1 ) ] ) for ( let i = 1; i < e.length; i ++ ) put( e[ i - 1 ], e[ i ] );
	}

	_fill( line, arr ) {
		const a = line.geometry.attributes.position, n = Math.min( arr.length / 3, MAX_LINE - ( MAX_LINE % 2 ) );
		a.array.set( arr.slice( 0, n * 3 ) );
		a.needsUpdate = true;
		line.geometry.setDrawRange( 0, n );
	}

	_redrawAll() {
		const out = [];
		for ( const p of this.list ) if ( p !== this.sel ) this._pathSegments( p.pts, p.w, out, false );
		this._fill( this.allLine, out );
	}

	_redrawWork() {
		const out = [];
		if ( this.mode === 'draw' ) {
			const pts = this.points.slice();
			const h = this.relief.hit;
			if ( h && pts.length && this.active ) pts.push( [ h.x, h.z ] );
			this._pathSegments( pts, this.width, out, true );
		} else if ( this.edit ) this._pathSegments( this.edit.pts, this.edit.w, out, true );
		this._fill( this.workLine, out );
	}

	// ------------------------------------------------------------------ input

	_bind() {
		this.dom.addEventListener( 'pointerdown', ( e ) => {
			if ( ! this.active || e.button !== 0 || e.altKey ) return;
			this.relief.pointer.x = e.clientX; this.relief.pointer.y = e.clientY; this.relief.pointer.inside = true;
			const hit = this.relief._pick();
			if ( this.mode === 'draw' ) {
				if ( ! hit ) return;
				this.points.push( [ + hit.x.toFixed( 2 ), + hit.z.toFixed( 2 ) ] );
				this._redrawWork();
				return;
			}
			this._editClick( hit, e );
		} );
		window.addEventListener( 'keydown', ( e ) => {
			if ( ! this.active || ( e.target.closest && e.target.closest( 'input,select,textarea' ) ) ) return;
			if ( this.mode === 'draw' && this.points.length ) {
				if ( e.code === 'Enter' ) { e.preventDefault(); this._finishDraw(); }
				if ( e.code === 'Escape' ) { e.preventDefault(); this._cancelDraw(); }
				if ( e.code === 'Backspace' ) { e.preventDefault(); this.points.pop(); this._redrawWork(); }
			}
			if ( this.mode === 'edit' && this.sel ) {
				if ( e.code === 'Enter' ) { e.preventDefault(); this.applyEdit(); }
				if ( e.code === 'Escape' ) { e.preventDefault(); this._deselect(); }
			}
			if ( e.code === 'KeyT' && ! e.ctrlKey && ! e.metaKey ) this.relief.toggleOverhead();
		} );
	}

	_setMode( m ) {
		this._cancelDraw(); this._deselect();
		this.mode = m;
		for ( const b of this.panel.querySelectorAll( '[data-mode]' ) ) b.classList.toggle( 'on', b.dataset.mode === m );
		this.ui.hint.textContent = m === 'draw'
			? 'Clique os pontos do caminho; Enter (ou Concluir na caixa) termina, Backspace tira o último, Esc cancela.'
			: 'Os caminhos aparecem por cima do chão; o que está sob o cursor fica destacado. Clique num para editá-lo: arraste os pontos, mude a largura, Aplicar (Enter). Shift+clique num ponto tira, Ctrl+clique no chão põe um ponto.';
		this.allLine.visible = m === 'edit';
		this._redrawWork();
	}

	// ------------------------------------------------------------------ laying a path

	_finishDraw() {
		if ( this.points.length < 2 ) { this.relief._toast( 'Marque pelo menos dois pontos do caminho.' ); return; }
		const pe = this.app.objectEditor.edits.paths;
		let n = 0;
		while ( pe.added.some( ( q ) => q.id === 'n' + n ) || this.list.some( ( q ) => q.id === 'n' + n ) ) n ++;
		const rec = { id: 'n' + n, pts: this.points.map( ( q ) => q.slice() ), w: this.width, type: this.type };
		pe.added.push( rec );
		this.list.push( { id: rec.id, pts: rec.pts.map( ( q ) => q.slice() ), w: rec.w, type: rec.type, o: null } );
		this._dirty();
		this.points = [];
		this._redrawWork(); this._redrawAll();
		this.relief._toast( `Caminho de ${ Math.round( this._length( rec.pts ) ) } m traçado. "Salvar e aplicar" pinta a trilha e abre a clareira.` );
	}

	_cancelDraw() { this.points = []; this._redrawWork(); }

	_length( pts ) {
		const c = pathCurve( pts );
		let L = 0;
		for ( let i = 1; i < c.length; i ++ ) L += Math.hypot( c[ i ][ 0 ] - c[ i - 1 ][ 0 ], c[ i ][ 1 ] - c[ i - 1 ][ 1 ] );
		return L;
	}

	// a change to the paths: unsaved, and the bridges over the rivers follow (world/bridges.js)
	_dirty() { this.changed = true; this.app.objectEditor.changed = true; this._status(); this.app.rebuildBridges?.(); }

	// ------------------------------------------------------------------ editing a path

	// the path whose track passes nearest (x, z), within its half width + 3 m
	_pathAt( x, z ) {
		let best = null, bd = Infinity;
		for ( const p of this.list ) {
			const c = pathCurve( p.pts );
			for ( let i = 1; i < c.length; i ++ ) {
				const ax = c[ i - 1 ][ 0 ], az = c[ i - 1 ][ 1 ], bx = c[ i ][ 0 ], bz = c[ i ][ 1 ];
				const l2 = ( bx - ax ) ** 2 + ( bz - az ) ** 2 || 1, t = Math.max( 0, Math.min( 1, ( ( x - ax ) * ( bx - ax ) + ( z - az ) * ( bz - az ) ) / l2 ) );
				const d = Math.hypot( ax + ( bx - ax ) * t - x, az + ( bz - az ) * t - z ) - p.w / 2;
				if ( d < bd ) { bd = d; best = p; }
			}
		}
		return bd < 3 ? best : null;
	}

	_editClick( hit, e ) {
		if ( ! this.sel ) {
			const p = hit && this._pathAt( hit.x, hit.z );
			if ( ! p ) { this.relief._toast( 'Nenhum caminho aqui: clique sobre um caminho (ele fica destacado sob o cursor).' ); return; }
			this._select( p );
			return;
		}
		this.tc.pointerHover( this.tc._getPointer( e ) );
		if ( this.tc.axis !== null ) return;
		const k = this._handleAt( e );
		if ( k >= 0 ) {
			if ( e.shiftKey ) {
				if ( this.edit.pts.length <= 2 ) { this.relief._toast( 'O caminho precisa de pelo menos dois pontos.' ); return; }
				this.edit.pts.splice( k, 1 );
				this._handles();
				this._pick( - 1 );
				return;
			}
			this._pick( k );
			return;
		}
		if ( ( e.ctrlKey || e.metaKey ) && hit ) { this._insert( hit.x, hit.z ); return; }
		this._pick( - 1 );
	}

	_select( p ) {
		this.sel = p;
		this.edit = { pts: p.pts.map( ( q ) => q.slice() ), w: p.w, type: p.type };
		this._handles();
		this._pick( - 1 );
		const w = this.editBox.querySelector( '[data-k=w]' );
		w.value = p.w;
		this._redrawAll(); this._redrawWork(); this._boxText();
		this.hoverLine.visible = false;
		this.relief._toast( 'Caminho selecionado: arraste os pontos, mude a largura e Aplique (Enter).' );
	}

	_deselect() {
		if ( ! this.sel ) return;
		this.sel = null; this.edit = null; this.picked = - 1;
		this.tc.detach(); this.gizmo.visible = false;
		for ( const h of this.handles ) this.group.remove( h );
		this.handles = [];
		this._redrawAll(); this._redrawWork();
	}

	_handles() {
		for ( const h of this.handles ) this.group.remove( h );
		this.handles = this.edit.pts.map( ( q ) => {
			const h = new THREE.Mesh( this.handleGeo, this.handleMat );
			h.position.set( q[ 0 ], this._ground( q[ 0 ], q[ 1 ] ) + 0.4, q[ 1 ] );
			h.renderOrder = 999;
			this.group.add( h );
			return h;
		} );
		this._redrawWork(); this._boxText();
	}

	_pick( k ) {
		this.picked = k;
		this.handles.forEach( ( h, i ) => { h.material = i === k ? this.handlePicked : this.handleMat; } );
		if ( k >= 0 ) { this.tc.attach( this.handles[ k ] ); this.gizmo.visible = true; } else { this.tc.detach(); this.gizmo.visible = false; }
	}

	_handleAt( e ) {
		const r = this.dom.getBoundingClientRect();
		this._ndc.set( ( ( e.clientX - r.left ) / r.width ) * 2 - 1, - ( ( e.clientY - r.top ) / r.height ) * 2 + 1 );
		this._ray.setFromCamera( this._ndc, this.camera );
		const hits = this._ray.intersectObjects( this.handles, false );
		return hits.length ? this.handles.indexOf( hits[ 0 ].object ) : - 1;
	}

	_handleMoved() {
		const k = this.picked, h = this.handles[ k ];
		if ( k < 0 || ! h ) return;
		h.position.y = this._ground( h.position.x, h.position.z ) + 0.4;
		this.edit.pts[ k ] = [ + h.position.x.toFixed( 2 ), + h.position.z.toFixed( 2 ) ];
		this._redrawWork(); this._boxText();
	}

	_insert( x, z ) {
		const P = this.edit.pts;
		let best = 0, bd = Infinity;
		for ( let i = 0; i < P.length - 1; i ++ ) {
			const [ ax, az ] = P[ i ], [ bx, bz ] = P[ i + 1 ];
			const l2 = ( bx - ax ) ** 2 + ( bz - az ) ** 2 || 1, t = Math.max( 0, Math.min( 1, ( ( x - ax ) * ( bx - ax ) + ( z - az ) * ( bz - az ) ) / l2 ) );
			const d = Math.hypot( ax + ( bx - ax ) * t - x, az + ( bz - az ) * t - z );
			if ( d < bd ) { bd = d; best = i; }
		}
		P.splice( best + 1, 0, [ + x.toFixed( 2 ), + z.toFixed( 2 ) ] );
		this._handles();
		this._pick( best + 1 );
	}

	applyEdit() {
		if ( ! this.sel ) return;
		const p = this.sel, pe = this.app.objectEditor.edits.paths;
		p.pts = this.edit.pts.map( ( q ) => q.slice() ); p.w = this.edit.w; p.type = this.edit.type;
		if ( p.o ) pe.changed[ p.id ] = { o: p.o, pts: p.pts.map( ( q ) => q.slice() ), w: p.w, type: p.type };
		else { const a = pe.added.find( ( q ) => q.id === p.id ); if ( a ) { a.pts = p.pts.map( ( q ) => q.slice() ); a.w = p.w; a.type = p.type; } }
		this._dirty();
		this._deselect();
		this.relief._toast( 'Caminho alterado. "Salvar e aplicar" repinta a trilha.' );
	}

	removePath() {
		if ( ! this.sel ) return;
		const p = this.sel, pe = this.app.objectEditor.edits.paths;
		if ( p.o ) pe.changed[ p.id ] = { o: p.o, removed: true };
		else pe.added = pe.added.filter( ( q ) => q.id !== p.id );
		this.list = this.list.filter( ( q ) => q !== p );
		this._dirty();
		this._deselect();
		this.relief._toast( 'Caminho removido. "Salvar e aplicar" devolve o chão e a vegetação.' );
	}

	// ------------------------------------------------------------------ frame

	update() {
		if ( ! this.active ) { this.drawBox.style.display = 'none'; this.editBox.style.display = 'none'; return; }
		const pr = this.relief.pointer;
		if ( pr.inside && ! this.dragging ) this.relief.hit = this.relief._pick();
		const hit = this.relief.hit;
		if ( this.mode === 'draw' && this.points.length ) this._redrawWork();
		// the path under the pointer, while picking one
		const hov = this.mode === 'edit' && ! this.sel && pr.inside && hit ? this._pathAt( hit.x, hit.z ) : null;
		if ( hov !== this._hov ) {
			this._hov = hov;
			const out = [];
			if ( hov ) this._pathSegments( hov.pts, hov.w, out, true );
			this._fill( this.hoverLine, out );
			this.hoverLine.visible = !! hov;
			this.dom.style.cursor = hov ? 'pointer' : '';
		}
		const drawing = this.mode === 'draw' && this.points.length > 0;
		this.drawBox.style.display = drawing ? '' : 'none';
		if ( drawing ) {
			const last = this.points.at( - 1 );
			this.drawBox.querySelector( '.name' ).textContent = `Caminho · ${ this.points.length } ponto${ this.points.length > 1 ? 's' : '' }`;
			this.drawBox.querySelector( '[data-act=done]' ).disabled = this.points.length < 2;
			this._place( this.drawBox, last[ 0 ], last[ 1 ] );
		}
		this.editBox.style.display = this.sel ? '' : 'none';
		if ( this.sel ) {
			const q = this.edit.pts[ this.picked >= 0 ? this.picked : Math.floor( this.edit.pts.length / 2 ) ];
			this._place( this.editBox, q[ 0 ], q[ 1 ] );
			const cam = this.camera.position;
			for ( const h of this.handles ) h.scale.setScalar( Math.max( 0.6, h.position.distanceTo( cam ) * 0.011 ) );
		}
	}

	// beside the point, on the side away from the pointer (the next click lands where the pointer is)
	_place( box, x, z ) {
		const r = this.dom.getBoundingClientRect();
		const p = this._v.set( x, this._ground( x, z ), z ).project( this.camera );
		const w = box.offsetWidth || 190, h = box.offsetHeight || 150;
		if ( ! ( p.z < 1 && Math.abs( p.x ) < 1.2 && Math.abs( p.y ) < 1.2 ) ) { box.style.transform = `translate(${ r.width - w - 300 }px, 90px)`; return; }
		const px = ( p.x * 0.5 + 0.5 ) * r.width, py = ( 0.5 - p.y * 0.5 ) * r.height;
		const ptr = this.relief.pointer, cx = ptr.inside ? ptr.x - r.left : px + 1, cy = ptr.inside ? ptr.y - r.top : py;
		let dx = px - cx, dy = py - cy;
		const l = Math.hypot( dx, dy );
		if ( l < 1 ) { dx = 1; dy = 0; } else { dx /= l; dy /= l; }
		const reach = Math.max( w, h ) * 0.5 + 36;
		const sx = Math.min( r.width - w - 8, Math.max( 8, px + dx * reach - w / 2 ) ), sy = Math.min( r.height - h - 8, Math.max( 8, py + dy * reach - h / 2 ) );
		box.style.transform = `translate(${ sx }px, ${ sy }px)`;
	}

	// ------------------------------------------------------------------ panel and boxes

	_status() {
		const pe = this.app.objectEditor.edits.paths;
		const n = Object.keys( pe.changed ).length + pe.added.length;
		this.ui.info.textContent = n ? `${ n } mudança${ n > 1 ? 's' : '' } nos caminhos${ this.changed ? ' · não salvo' : '' }` : 'nenhuma mudança nos caminhos';
	}

	_buildPanel() {
		const el = document.createElement( 'div' );
		el.id = 'path-editor';
		el.className = 'panel';
		el.style.display = 'none';
		el.innerHTML = `
			<header><b>Caminhos</b></header>
			<div class="row"><button data-mode="draw" class="on">Traçar caminho</button><button data-mode="edit">Editar caminho</button></div>
			<p class="hint"></p>
			<label>Largura <input data-k="width" type="range" min="1" max="8" step="0.1"><output></output></label>
			<label>Tipo <select data-k="type">${ TYPES.map( ( t ) => `<option value="${ t.id }"${ t.off ? ' disabled' : '' }>${ t.label }</option>` ).join( '' ) }</select><span></span></label>
			<p class="info"></p>
			<div class="row"><button data-act="overhead" title="T">Vista de cima</button></div>
			<div class="row"><button data-act="save" class="primary">Salvar e aplicar</button></div>
			<p class="keys">Esq.: pontos e seleção · Dir. arrastar: olhar · T: vista de cima. O traçado aparece na hora; a trilha pintada, o chão rebaixado, a clareira na vegetação e as cercas das vielas aparecem ao salvar (a página recarrega). Rua e calçada virão depois: cada caminho já guarda o tipo.</p>`;
		document.body.appendChild( el );
		this.panel = el;
		const q = ( s ) => el.querySelector( s );
		this.ui = { hint: q( '.hint' ), info: q( '.info' ) };
		const style = document.createElement( 'style' );
		style.textContent = `
			#path-editor { position: fixed; top: 122px; left: 12px; width: 288px; padding: 10px 12px; z-index: 12; font-size: 12px; color: var(--ink); max-height: calc(100vh - 184px); overflow: auto; }
			#path-editor header { color: var(--gold-2); font-size: 13px; margin-bottom: 6px; }
			#path-editor button { background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 6px; padding: 5px 6px; cursor: pointer; font: 12px Inter, system-ui, sans-serif; }
			#path-editor button:hover { border-color: var(--gold); }
			#path-editor button.on { background: rgba(201,164,92,.35); border-color: var(--gold-2); color: #fff; }
			#path-editor button.primary { background: rgba(60,90,42,.6); border-color: #7fae5a; }
			#path-editor .row { display: flex; gap: 4px; margin-top: 5px; } #path-editor .row button { flex: 1; text-align: center; }
			#path-editor label { display: grid; grid-template-columns: 62px 1fr 46px; align-items: center; gap: 6px; margin: 6px 0; }
			#path-editor select { background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 5px; padding: 3px; }
			#path-editor input[type=range] { width: 100%; accent-color: var(--gold); }
			#path-editor output { text-align: right; color: var(--ink-dim); }
			#path-editor .hint, #path-editor .keys { color: var(--ink-dim); margin: 6px 0; line-height: 1.35; }
			#path-editor .info { color: var(--gold-2); margin: 6px 0; }`;
		document.head.appendChild( style );
		for ( const b of el.querySelectorAll( '[data-mode]' ) ) b.onclick = () => this._setMode( b.dataset.mode );
		const wi = q( '[data-k=width]' ), wo = wi.nextElementSibling;
		wi.value = this.width; wo.textContent = this.width.toFixed( 1 ) + ' m';
		wi.oninput = () => { this.width = + wi.value; wo.textContent = this.width.toFixed( 1 ) + ' m'; this._redrawWork(); };
		q( '[data-k=type]' ).onchange = ( e ) => { this.type = e.target.value; };
		q( '[data-act=overhead]' ).onclick = () => this.relief.toggleOverhead();
		q( '[data-act=save]' ).onclick = () => this.relief.save();
		this._status();
		this._setMode( 'draw' );
	}

	_buildBoxes() {
		const make = ( html ) => {
			const m = document.createElement( 'div' );
			m.className = 'river-menu panel'; // the river boxes' style (editor/riverEdit.js)
			m.style.display = 'none';
			m.innerHTML = html;
			document.body.appendChild( m );
			return m;
		};
		this.drawBox = make( `
			<div class="top"><span class="name">Caminho</span></div>
			<button data-act="done" class="ok"><kbd>Enter</kbd> Concluir</button>
			<button data-act="pop"><kbd>⌫</kbd> Tirar o último ponto</button>
			<button data-act="cancel"><kbd>Esc</kbd> Cancelar</button>` );
		this.drawBox.querySelector( '[data-act=done]' ).onclick = () => this._finishDraw();
		this.drawBox.querySelector( '[data-act=pop]' ).onclick = () => { this.points.pop(); this._redrawWork(); };
		this.drawBox.querySelector( '[data-act=cancel]' ).onclick = () => this._cancelDraw();
		this.editBox = make( `
			<div class="top"><span class="name">Caminho</span><button data-act="close" title="Cancelar (Esc)">×</button></div>
			<label>Largura <output data-o="w"></output><input data-k="w" type="range" min="1" max="8" step="0.1"></label>
			<div class="tip">Arraste os pontos dourados · Shift+clique num ponto tira · Ctrl+clique no chão põe um ponto</div>
			<button data-act="apply" class="ok"><kbd>Enter</kbd> Aplicar</button>
			<button data-act="cancel"><kbd>Esc</kbd> Cancelar</button>
			<button data-act="remove" class="danger">Remover o caminho</button>` );
		const q = ( s ) => this.editBox.querySelector( s );
		q( '[data-act=close]' ).onclick = () => this._deselect();
		q( '[data-act=cancel]' ).onclick = () => this._deselect();
		q( '[data-act=apply]' ).onclick = () => this.applyEdit();
		q( '[data-act=remove]' ).onclick = () => this.removePath();
		q( '[data-k=w]' ).oninput = ( e ) => { this.edit.w = + e.target.value; this._redrawWork(); this._boxText(); };
	}

	_boxText() {
		if ( ! this.edit ) return;
		const q = ( s ) => this.editBox.querySelector( s );
		q( '[data-o=w]' ).textContent = this.edit.w.toFixed( 1 ) + ' m';
		const label = this.sel.o ? 'da vila' : 'novo';
		q( '.name' ).textContent = `Caminho ${ label } · ${ Math.round( this._length( this.edit.pts ) ) } m · ${ this.edit.pts.length } pontos`;
	}

}
