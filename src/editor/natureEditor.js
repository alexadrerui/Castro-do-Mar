// Nature brush (?edit, tab "Natureza"), after the Habitat Creator game's nature brush: paint or
// erase oaks, pines, birches, gorse, bracken, rocks and grass on the terrain. The painted grid is
// world/natureEdits.js (signed density per kind); while painting it shows as a coloured overlay on
// the terrain, and "Salvar e aplicar" (shared with the other tabs) writes public/nature-edits.bin
// and reloads: the scatter of vegetation.js / rocks.js / grass.js then follows it. A wider rock
// brush mixes in bigger boulders.
//
// Mouse: left = paint, right drag = look, WASD/QE = fly. Shift: the other mode (paint <-> erase).
// [ ] size. T: view from above. Ctrl+Z / Ctrl+Y undo / redo.
import * as THREE from 'three/webgpu';
import { texture, positionWorld, vec2, uniform } from 'three/tsl';
import { NATURE, CH, NATURE_BYTES } from '../world/natureEdits.js';
import { WATER_LEVEL } from '../world/layout.js';

const BRUSHES = [
	{ id: 'oak', label: 'Carvalho', ch: [ CH.oak ], color: 0x3f8f2c },
	{ id: 'pine', label: 'Pinheiro', ch: [ CH.pine ], color: 0x1f6a55 },
	{ id: 'birch', label: 'Bétula', ch: [ CH.birch ], color: 0xd8c23a },
	{ id: 'bush', label: 'Tojo', ch: [ CH.bush ], color: 0x8f9a2a },
	{ id: 'fern', label: 'Fento', ch: [ CH.fern ], color: 0xa6d84a },
	{ id: 'rocks', label: 'Pedras', ch: [ CH.rocks ], color: 0xb4b4b4 },
	{ id: 'grass', label: 'Grama', ch: [ CH.grass ], color: 0x86e886 },
	{ id: 'all', label: 'Tudo (apagar)', ch: [ CH.oak, CH.pine, CH.birch, CH.bush, CH.fern, CH.rocks, CH.grass ], color: 0xe04a36, eraseOnly: true }
];
const KINDS = [ CH.oak, CH.pine, CH.birch, CH.bush, CH.fern, CH.rocks, CH.grass ];
const COLORS = {}; // channel -> [ r, g, b ] 0..255
for ( const b of BRUSHES ) if ( b.ch.length === 1 ) { const c = new THREE.Color( b.color ); COLORS[ b.ch[ 0 ] ] = [ c.r * 255, c.g * 255, c.b * 255 ]; }
const ERASE = [ 224, 74, 54 ];
const UNDO_MAX = 40;

export class NatureEditor {

	// app: hf, terrain, camera, renderer, freecam, scene, natureEdits; relief: the relief editor
	// (ground picking, the view from above, the shared save)
	constructor( app, relief ) {
		this.app = app;
		this.relief = relief;
		this.hf = app.hf;
		this.dom = app.renderer.domElement;
		const { res, channels } = NATURE;
		this.val = new Float32Array( res * res * channels );
		if ( app.natureEdits ) for ( let k = 0; k < this.val.length; k ++ ) this.val[ k ] = app.natureEdits[ k ] / 127;
		this.brush = BRUSHES[ 0 ];
		this.erase = false;
		this.radius = 14;
		this.strength = 0.6;
		this.active = false;
		this.down = false;
		this.invert = false;
		this.hit = null;
		this.stroke = null;
		this.undo = []; this.redo = [];
		this.changed = false;
		this.showOverlay = true;
		this._overlayOn = false;
		this._buildCursor();
		this._buildPanel();
		this._bind();
		app.onFrame.push( ( dt ) => this.update( dt ) );
	}

	setActive( on ) {
		this.active = on;
		this.panel.style.display = on ? '' : 'none';
		if ( on ) this._ensureOverlay();
		if ( this.overlayVis ) this.overlayVis.value = on && this.showOverlay ? 1 : 0;
		if ( ! on ) { this.down = false; this._end(); this.cursor.visible = false; }
	}

	// ------------------------------------------------------------------ overlay on the terrain

	// the painted grid as a tint over the terrain material (editor only; compiled once, on the
	// first visit of the tab)
	_ensureOverlay() {
		if ( this._overlayOn ) return;
		this._overlayOn = true;
		const { res } = NATURE;
		this.ovData = new Uint8Array( res * res * 4 );
		this.ovTex = new THREE.DataTexture( this.ovData, res, res, THREE.RGBAFormat, THREE.UnsignedByteType );
		this.ovTex.magFilter = THREE.LinearFilter; this.ovTex.minFilter = THREE.LinearFilter;
		this.ovTex.needsUpdate = true;
		this._refreshOverlay( 0, 0, res - 1, res - 1 );
		const mat = this.app.terrain.material;
		const size = NATURE.res * NATURE.cell;
		const uvN = positionWorld.xz.sub( vec2( NATURE.x0, NATURE.z0 ) ).div( size );
		const ov = texture( this.ovTex, uvN );
		this.overlayVis = uniform( 1 );
		const a = ov.a.mul( this.overlayVis );
		mat.colorNode = mat.colorNode.mul( a.oneMinus() ).add( ov.rgb.mul( this.overlayVis ) ); // premultiplied
		mat.needsUpdate = true;
	}

	_refreshOverlay( i0, j0, i1, j1 ) {
		if ( ! this.ovData ) return;
		const { res, channels } = NATURE, v = this.val, o = this.ovData;
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {
			const t = j * res + i, base = t * channels;
			let best = 0, bc = - 1;
			for ( const c of KINDS ) { const a = Math.abs( v[ base + c ] ); if ( a > best ) { best = a; bc = c; } }
			const k = t * 4;
			if ( bc < 0 || best < 0.01 ) { o[ k ] = o[ k + 1 ] = o[ k + 2 ] = o[ k + 3 ] = 0; continue; }
			const col = v[ base + bc ] > 0 ? COLORS[ bc ] : ERASE;
			// premultiplied: the linear filter blends towards transparent, not towards black
			const al = 0.15 + 0.5 * best;
			o[ k ] = col[ 0 ] * al; o[ k + 1 ] = col[ 1 ] * al; o[ k + 2 ] = col[ 2 ] * al; o[ k + 3 ] = Math.round( 255 * al );
		}
		this.ovTex.needsUpdate = true;
	}

	// ------------------------------------------------------------------ painting

	_dab( cx, cz, dt ) {
		const { res, channels, cell, x0, z0 } = NATURE, R = this.radius;
		const erase = this.brush.eraseOnly || ( this.erase !== this.invert );
		// "Tudo (apagar)" clears completely; the other brushes go to the chosen density
		const target = this.brush.eraseOnly ? - 1 : erase ? - this.strength : this.strength;
		const f = Math.min( 1, 5 * dt );
		// a wider rock brush means bigger boulders (0..1 over 4..60 m)
		const size = Math.min( 1, Math.max( 0.05, ( R - 4 ) / 56 ) );
		const i0 = Math.max( 0, Math.floor( ( cx - R - x0 ) / cell ) ), i1 = Math.min( res - 1, Math.floor( ( cx + R - x0 ) / cell ) );
		const j0 = Math.max( 0, Math.floor( ( cz - R - z0 ) / cell ) ), j1 = Math.min( res - 1, Math.floor( ( cz + R - z0 ) / cell ) );
		if ( i0 > i1 || j0 > j1 ) return;
		const st = this.stroke;
		const set = ( k, x ) => { if ( ! st.touched.has( k ) ) st.touched.set( k, this.val[ k ] ); this.val[ k ] = x; };
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {
			const d = Math.hypot( x0 + ( i + 0.5 ) * cell - cx, z0 + ( j + 0.5 ) * cell - cz ) / R;
			if ( d >= 1 ) continue;
			const w = d < 0.5 ? 1 : 0.5 + 0.5 * Math.cos( Math.PI * ( d - 0.5 ) / 0.5 );
			const base = ( j * res + i ) * channels;
			for ( const c of this.brush.ch ) {
				const k = base + c, v = this.val[ k ];
				let nv = v + ( target - v ) * f * w;
				if ( Math.abs( nv - target ) < 0.01 ) nv = target;
				if ( Math.abs( nv ) < 0.004 ) nv = 0;
				set( k, nv );
			}
			if ( ! erase && this.brush.id === 'rocks' ) {
				const k = base + CH.rockSize;
				set( k, this.val[ k ] + ( size - this.val[ k ] ) * Math.min( 1, f * 2 * w ) );
			}
		}
		this._refreshOverlay( i0, j0, i1, j1 );
		this.changed = true;
	}

	_begin() {
		if ( ! this.hit ) return false;
		this.stroke = { touched: new Map(), last: this.hit.clone() };
		return true;
	}

	_end() {
		const st = this.stroke;
		this.stroke = null;
		if ( ! st || ! st.touched.size ) return;
		const keys = Int32Array.from( st.touched.keys() ), before = Float32Array.from( st.touched.values() );
		const after = new Float32Array( keys.length );
		for ( let q = 0; q < keys.length; q ++ ) after[ q ] = this.val[ keys[ q ] ];
		this.undo.push( { keys, before, after } );
		if ( this.undo.length > UNDO_MAX ) this.undo.shift();
		this.redo.length = 0;
		this._status();
	}

	_apply( step, values ) {
		const { res, channels } = NATURE;
		let i0 = res, j0 = res, i1 = 0, j1 = 0;
		for ( let q = 0; q < step.keys.length; q ++ ) {
			const k = step.keys[ q ];
			this.val[ k ] = values[ q ];
			const t = Math.floor( k / channels ), i = t % res, j = ( t - i ) / res;
			if ( i < i0 ) i0 = i; if ( i > i1 ) i1 = i; if ( j < j0 ) j0 = j; if ( j > j1 ) j1 = j;
		}
		if ( step.keys.length ) this._refreshOverlay( i0, j0, i1, j1 );
		this.changed = true;
		this._status();
	}

	undoStep() { if ( this.down ) return; const s = this.undo.pop(); if ( s ) { this._apply( s, s.before ); this.redo.push( s ); } this._status(); }
	redoStep() { if ( this.down ) return; const s = this.redo.pop(); if ( s ) { this._apply( s, s.after ); this.undo.push( s ); } this._status(); }

	// ------------------------------------------------------------------ frame

	update( dt ) {
		if ( ! this.active ) return;
		const r = this.relief;
		if ( r.pointer.inside ) this.hit = r._pick();
		if ( this.down && this.stroke && this.hit ) {
			const h = this.hit, last = this.stroke.last, dist = Math.hypot( h.x - last.x, h.z - last.z );
			const steps = Math.max( 1, Math.min( 32, Math.ceil( dist / ( this.radius * 0.3 ) ) ) );
			const step = Math.min( dt, 0.05 ) / steps;
			for ( let q = 1; q <= steps; q ++ ) this._dab( last.x + ( h.x - last.x ) * q / steps, last.z + ( h.z - last.z ) * q / steps, step );
			last.copy( h );
		}
		this._updateCursor();
		this._info();
	}

	// ------------------------------------------------------------------ cursor

	_buildCursor() {
		const SEG = 96;
		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( ( SEG + 1 ) * 3 ), 3 ) );
		this.cursor = new THREE.Line( g, new THREE.LineBasicNodeMaterial( { color: 0x9fd04a, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 } ) );
		this.cursor.frustumCulled = false; this.cursor.renderOrder = 999; this.cursor.visible = false;
		this.cursor.name = 'natureCursor';
		this.app.scene.add( this.cursor );
		this._seg = SEG;
	}

	_updateCursor() {
		const h = this.hit;
		this.cursor.visible = !! ( this.active && h && this.relief.pointer.inside );
		if ( ! this.cursor.visible ) return;
		const a = this.cursor.geometry.attributes.position;
		for ( let q = 0; q <= this._seg; q ++ ) {
			const t = q / this._seg * Math.PI * 2, x = h.x + Math.cos( t ) * this.radius, z = h.z + Math.sin( t ) * this.radius;
			a.setXYZ( q, x, Math.max( this.hf.heightAt( x, z ), WATER_LEVEL ) + 0.35, z );
		}
		a.needsUpdate = true;
		const erase = this.brush.eraseOnly || ( this.erase !== this.invert );
		this.cursor.material.color.setHex( erase ? 0xe04a36 : this.brush.color );
	}

	// ------------------------------------------------------------------ input

	_bind() {
		const dom = this.dom;
		dom.addEventListener( 'pointermove', ( e ) => { this.invert = e.shiftKey; } );
		dom.addEventListener( 'pointerdown', ( e ) => {
			if ( ! this.active || e.button !== 0 || e.altKey ) return;
			this.invert = e.shiftKey;
			this.hit = this.relief._pick();
			if ( this._begin() ) { this.down = true; dom.setPointerCapture?.( e.pointerId ); }
		} );
		const release = () => { if ( this.down ) { this.down = false; this._end(); } };
		window.addEventListener( 'pointerup', ( e ) => { if ( ( e.buttons & 1 ) === 0 ) release(); } );
		window.addEventListener( 'pointermove', ( e ) => { if ( this.down && ( e.buttons & 1 ) === 0 ) release(); } );
		dom.addEventListener( 'pointercancel', release );
		dom.addEventListener( 'lostpointercapture', release );
		window.addEventListener( 'blur', release );
		window.addEventListener( 'keydown', ( e ) => {
			if ( ! this.active || ( e.target.closest && e.target.closest( 'input,select,textarea' ) ) ) return;
			if ( e.key === 'Shift' ) this.invert = true;
			if ( e.code === 'BracketLeft' ) this._setRadius( this.radius / 1.15 );
			if ( e.code === 'BracketRight' ) this._setRadius( this.radius * 1.15 );
			if ( e.code === 'KeyT' && ! e.ctrlKey && ! e.metaKey ) this._overhead();
			if ( ( e.ctrlKey || e.metaKey ) && e.code === 'KeyZ' ) { e.preventDefault(); e.shiftKey ? this.redoStep() : this.undoStep(); }
			if ( ( e.ctrlKey || e.metaKey ) && e.code === 'KeyY' ) { e.preventDefault(); this.redoStep(); }
		} );
		window.addEventListener( 'keyup', ( e ) => { if ( e.key === 'Shift' ) this.invert = false; } );
	}

	_overhead() {
		this.relief.hit = this.hit;
		this.relief.toggleOverhead( this.radius );
		this.panel.querySelector( '[data-act=overhead]' ).classList.toggle( 'on', !! this.relief.overhead );
	}

	exportFile() {
		const out = new Int8Array( NATURE_BYTES );
		for ( let k = 0; k < out.length; k ++ ) out[ k ] = Math.max( - 127, Math.min( 127, Math.round( this.val[ k ] * 127 ) ) );
		const a = document.createElement( 'a' );
		a.href = URL.createObjectURL( new Blob( [ out ], { type: 'application/octet-stream' } ) );
		a.download = 'nature-edits.bin';
		a.click();
		setTimeout( () => URL.revokeObjectURL( a.href ), 1000 );
	}

	_setRadius( r ) {
		this.radius = Math.min( 120, Math.max( 3, r ) );
		this.ui.size.value = this.radius; this.ui.sizeOut.textContent = this.radius.toFixed( 0 ) + ' m';
	}

	// ------------------------------------------------------------------ save

	async saveFile() {
		const out = new Int8Array( NATURE_BYTES );
		for ( let k = 0; k < out.length; k ++ ) out[ k ] = Math.max( - 127, Math.min( 127, Math.round( this.val[ k ] * 127 ) ) );
		const res = await fetch( '/__nature-edits', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: out.buffer } );
		if ( ! res.ok ) throw new Error( res.status );
		this.changed = false;
	}

	// ------------------------------------------------------------------ panel

	_buildPanel() {
		const el = document.createElement( 'div' );
		el.id = 'nature-editor';
		el.className = 'panel';
		el.style.display = 'none';
		el.innerHTML = `
			<header><b>Pincel de natureza</b></header>
			<div class="brushes">${ BRUSHES.map( ( b ) => `<button data-brush="${ b.id }"><i style="background:#${ b.color.toString( 16 ).padStart( 6, '0' ) }"></i>${ b.label }</button>` ).join( '' ) }</div>
			<div class="row mode"><button data-mode="paint" class="on">Pintar</button><button data-mode="erase">Apagar</button></div>
			<p class="hint"></p>
			<label>Tamanho <input data-k="size" type="range" min="3" max="120" step="1"><output></output></label>
			<label title="Pintar: densidade das plantas. Apagar: quanto some (Tudo apaga 100%)">Densidade <input data-k="strength" type="range" min="0.05" max="1" step="0.05"><output></output></label>
			<label class="chk"><input data-k="show" type="checkbox" checked> Mostrar a pintura no terreno</label>
			<p class="info"></p>
			<div class="row"><button data-act="undo">Desfazer</button><button data-act="redo">Refazer</button></div>
			<div class="row"><button data-act="overhead" title="T">Vista de cima</button></div>
			<div class="row"><button data-act="save" class="primary">Salvar e aplicar</button></div>
			<p class="keys">Esq.: pintar · Dir. arrastar: olhar · Shift: inverte pintar/apagar · [ ]: tamanho · T: vista de cima · Ctrl+Z/Y. As plantas e pedras aparecem ao salvar (a página recarrega).</p>`;
		document.body.appendChild( el );
		this.panel = el;
		const q = ( s ) => el.querySelector( s );
		this.ui = { size: q( '[data-k=size]' ), sizeOut: q( '[data-k=size]' ).nextElementSibling, undo: q( '[data-act=undo]' ), redo: q( '[data-act=redo]' ), info: q( '.info' ), hint: q( '.hint' ) };
		const style = document.createElement( 'style' );
		style.textContent = `
			#nature-editor { position: fixed; top: 122px; left: 12px; width: 288px; padding: 10px 12px; z-index: 12; font-size: 12px; color: var(--ink); max-height: calc(100vh - 184px); overflow: auto; }
			#nature-editor header { color: var(--gold-2); font-size: 13px; margin-bottom: 6px; }
			#nature-editor .brushes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
			#nature-editor .brushes i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
			#nature-editor button { background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 6px; padding: 5px 6px; cursor: pointer; font: 12px Inter, system-ui, sans-serif; text-align: left; }
			#nature-editor button:hover { border-color: var(--gold); }
			#nature-editor button.on { background: rgba(201,164,92,.35); border-color: var(--gold-2); color: #fff; }
			#nature-editor button.primary { background: rgba(60,90,42,.6); border-color: #7fae5a; text-align: center; }
			#nature-editor button:disabled { opacity: .4; cursor: default; }
			#nature-editor .row { display: flex; gap: 4px; margin-top: 5px; } #nature-editor .row button { flex: 1; text-align: center; }
			#nature-editor label { display: grid; grid-template-columns: 78px 1fr 46px; align-items: center; gap: 6px; margin: 5px 0; }
			#nature-editor label.chk { display: flex; gap: 6px; }
			#nature-editor input[type=range] { width: 100%; accent-color: var(--gold); }
			#nature-editor output { text-align: right; color: var(--ink-dim); }
			#nature-editor .hint, #nature-editor .keys { color: var(--ink-dim); margin: 6px 0; line-height: 1.35; }
			#nature-editor .info { font-family: ui-monospace, monospace; white-space: pre; min-height: 30px; margin: 6px 0; }`;
		document.head.appendChild( style );

		const hint = () => {
			const b = this.brush;
			this.ui.hint.textContent = b.eraseOnly ? 'Apaga toda a vegetação, as pedras e a grama sob o pincel.'
				: b.id === 'rocks' ? 'Pedras de granito; um pincel maior mistura blocos maiores.'
					: `${ this.erase ? 'Apaga' : 'Planta' } ${ b.label.toLowerCase() }; a densidade controla quantos.`;
		};
		const setBrush = ( id ) => {
			this.brush = BRUSHES.find( ( b ) => b.id === id );
			for ( const b of el.querySelectorAll( '[data-brush]' ) ) b.classList.toggle( 'on', b.dataset.brush === id );
			hint();
		};
		for ( const b of el.querySelectorAll( '[data-brush]' ) ) b.onclick = () => setBrush( b.dataset.brush );
		for ( const b of el.querySelectorAll( '[data-mode]' ) ) b.onclick = () => {
			this.erase = b.dataset.mode === 'erase';
			for ( const c of el.querySelectorAll( '[data-mode]' ) ) c.classList.toggle( 'on', c === b );
			hint();
		};
		setBrush( this.brush.id );
		const bind = ( k, get, set, fmt ) => {
			const input = q( `[data-k=${ k }]` ), out = input.nextElementSibling;
			input.value = get();
			const show = () => { if ( out?.tagName === 'OUTPUT' ) out.textContent = fmt( get() ); };
			input.oninput = () => { set( Number( input.value ) ); show(); };
			show();
		};
		bind( 'size', () => this.radius, ( v ) => { this.radius = v; }, ( v ) => v.toFixed( 0 ) + ' m' );
		bind( 'strength', () => this.strength, ( v ) => { this.strength = v; }, ( v ) => Math.round( v * 100 ) + '%' );
		q( '[data-k=show]' ).onchange = ( e ) => { this.showOverlay = e.target.checked; if ( this.overlayVis ) this.overlayVis.value = this.showOverlay ? 1 : 0; };
		q( '[data-act=undo]' ).onclick = () => this.undoStep();
		q( '[data-act=redo]' ).onclick = () => this.redoStep();
		q( '[data-act=overhead]' ).onclick = () => this._overhead();
		q( '[data-act=save]' ).onclick = () => this.relief.save();
		this._status();
	}

	_status() {
		if ( ! this.ui ) return;
		this.ui.undo.disabled = ! this.undo.length;
		this.ui.redo.disabled = ! this.redo.length;
	}

	_info() {
		const h = this.hit;
		if ( ! h ) { this.ui.info.textContent = this.changed ? 'pintura não salva' : ''; return; }
		const { res, channels, cell, x0, z0 } = NATURE;
		const i = Math.floor( ( h.x - x0 ) / cell ), j = Math.floor( ( h.z - z0 ) / cell );
		const parts = [];
		if ( i >= 0 && j >= 0 && i < res && j < res ) {
			const base = ( j * res + i ) * channels;
			for ( const b of BRUSHES ) if ( b.ch.length === 1 ) { const v = this.val[ base + b.ch[ 0 ] ]; if ( Math.abs( v ) >= 0.01 ) parts.push( `${ b.label } ${ v > 0 ? '+' : '' }${ Math.round( v * 100 ) }%` ); }
		}
		this.ui.info.textContent = `x ${ h.x.toFixed( 0 ) }  z ${ h.z.toFixed( 0 ) }\n${ parts.join( ' · ' ) || 'sem pintura' }${ this.changed ? '  · não salvo' : '' }`;
	}

}
