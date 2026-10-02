// Terrain editor (?edit): sculpts the relief live and saves the edits into the project.
//
// The brushes follow three's webgpu_sculpt example (addons/misc/Sculptor.js, after SculptGL):
// tool, size, strength, a soft falloff, Shift to invert, and a ring cursor lying on the surface.
// Sculptor itself edits a free mesh; our relief is a heightfield, so the tools are the heightfield
// versions: raise / lower, smooth, flatten, noise and restore (back to the procedural relief).
// The "Gerar" tool stamps procedural relief after void032/shader-studio (MIT): Perlin fbm, or an
// island (the fbm under a radial falloff, sinking below the water at the rim).
//
// What changes is a grid of height differences over the procedural relief (world/terrainEdits.js).
// While editing, the heightfield, the terrain chunks and the height texture follow every stroke;
// the rest (AO, vegetation, rocks, houses, grass) is rebuilt from the edited relief on the next
// load: "Salvar e aplicar" writes public/terrain-edits.bin and reloads.
//
// Encher: pours a lake at its own level into the hollow under the click (world/lakeWater.js).
// Rio: lays a river's course point by point; Enter carves its channel and shows its water (world/rivers.js).
// Water tools (after the shoreline tools of the Habitat Creator game): dig down to a depth below the
// water level, fill up to a height above it; both leave a ramp of the chosen width between the new
// level and the relief as it was before the stroke (natural banks, no step at the rim).
// View from above (button or T): the camera flies over the cursor looking down; WASD then move in
// the plane.
//
// Mouse: left = sculpt, right drag = look, WASD/QE = fly, Alt + left = orbit. Shift: invert.
// [ ] size. T: view from above. Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z): undo / redo.
import * as THREE from 'three/webgpu';
import { makeSimplex, fbm } from '../core/noise.js';
import { WATER_LEVEL } from '../world/layout.js';
import { EDITS_N } from '../world/terrainEdits.js';
import { RiverCourse, sampleCurve } from '../world/riverCourse.js';

const TOOLS = [
	{ id: 'raise', label: 'Elevar', hint: 'Levanta o relevo (Shift: baixa)' },
	{ id: 'lower', label: 'Baixar', hint: 'Afunda o relevo (Shift: levanta)' },
	{ id: 'smooth', label: 'Suavizar', hint: 'Média com os vizinhos: arredonda arestas e degraus' },
	{ id: 'flatten', label: 'Aplanar', hint: 'Leva à altura do ponto onde a pincelada começou' },
	{ id: 'noise', label: 'Ruído', hint: 'Soma ruído fbm: rugosidade natural (Shift: subtrai)' },
	{ id: 'restore', label: 'Restaurar', hint: 'Desfaz as edições sob o pincel: volta ao relevo procedural' },
	{ id: 'dig', label: 'Cavar', hint: 'Cava até a profundidade abaixo do nível da água, com margem em rampa até o relevo de antes' },
	{ id: 'fill', label: 'Aterrar', hint: 'Aterra até a altura acima do nível da água, com margem em rampa até o fundo de antes' },
	{ id: 'generate', label: 'Gerar', hint: 'Clique: carimba relevo procedural (Perlin ou Ilha) no círculo' },
	{ id: 'river', label: 'Rio', hint: 'Clique os pontos do curso, da nascente à foz (Backspace tira o último); Enter conclui: o nível desce com o terreno, o leito é escavado (Ctrl+Z desfaz) e a água corre. Esc cancela. Shift+clique: remove o rio' },
	{ id: 'lake', label: 'Encher', hint: 'Clique numa depressão: a água sobe até a borda mais baixa, menos 20 cm (lago com nível próprio, carpas e lótus ao salvar). Shift+clique: remove o lago' }
];
const UNDO_MAX = 40;
const UNDO_CELLS = 4e6; // ~48 MB of history at most
const HEIGHT_TEX_EVERY = 0.2; // s between height-texture uploads during a stroke (a full upload)

export class TerrainEditor {

	// app: hf, terrain, camera, canvas (renderer.domElement), freecam, sky, terrainEdits
	constructor( app ) {
		this.app = app;
		this.hf = app.hf;
		this.terrain = app.terrain;
		this.camera = app.camera;
		this.dom = app.renderer.domElement;
		const n = this.hf.n;
		if ( n !== EDITS_N ) throw new Error( 'terrain editor: heightfield size does not match the edits grid' );
		this.delta = app.terrainEdits ? app.terrainEdits.slice() : new Float32Array( n * n );
		// the procedural relief under the edits: delta is always data - base, computed, not summed
		// (summing the steps let float32 rounding drift, and a restored area never came back to 0)
		this.base = new Float32Array( n * n );
		for ( let k = 0; k < n * n; k ++ ) this.base[ k ] = this.hf.data[ k ] - this.delta[ k ];
		this._tmp = new Float32Array( 0 ); // scratch for the smooth brush

		this.tool = 'raise';
		this.radius = 24;       // m
		this.strength = 0.5;    // 0..1
		this.hardness = 0.35;   // 0 = all falloff, 1 = hard edge
		this.gen = { kind: 'island', freq: 1.2, octaves: 5, height: 14, depth: 6, seed: 7 };
		this.water = { depth: 4, fill: 1.5, shore: 8 }; // m below / above WATER_LEVEL, ramp width
		this.river = { width: 5, points: [] };          // "Rio": the course being laid

		this.active = true;
		this.down = false;
		this.invert = false;
		this.hit = null;        // THREE.Vector3 under the pointer, or null
		this.pointer = { x: 0, y: 0, inside: false };
		this.stroke = null;     // { touched: Map<k, old>, flattenTo }
		this.undo = []; this.redo = [];
		this.dirty = null;      // [ i0, j0, i1, j1 ] waiting for terrain.refresh
		this.texTimer = 0; this.texDue = false;
		this.changed = false;   // unsaved edits

		this._raycaster = new THREE.Raycaster();
		this._ndc = new THREE.Vector2();
		this._buildCursor();
		this._buildPanel();
		this._bind();
		app.freecam.leftLook = false;
		app.onFrame.push( ( dt ) => this.update( dt ) );
		this._status();
	}

	// ------------------------------------------------------------------ picking

	// the point of the relief under the pointer: march the view ray over the heightfield
	_pick() {
		const { hf } = this;
		const r = this.dom.getBoundingClientRect();
		this._ndc.set( ( this.pointer.x - r.left ) / r.width * 2 - 1, - ( ( this.pointer.y - r.top ) / r.height ) * 2 + 1 );
		this._raycaster.setFromCamera( this._ndc, this.camera );
		const o = this._raycaster.ray.origin, d = this._raycaster.ray.direction;
		const x1 = hf.x0 + hf.size, z1 = hf.z0 + hf.size;
		const above = ( t ) => {
			const x = o.x + d.x * t, z = o.z + d.z * t;
			if ( x < hf.x0 || z < hf.z0 || x > x1 || z > z1 ) return null;
			return o.y + d.y * t - hf.heightAt( x, z );
		};
		let t0 = 0, t = 0.5, prev = above( 0 );
		for ( let s = 0; s < 4000 && t < 6000; s ++ ) {
			const h = above( t );
			if ( h !== null && h < 0 && prev !== null && prev >= 0 ) {
				let a = t0, b = t; // bisection
				for ( let k = 0; k < 18; k ++ ) { const m = ( a + b ) / 2; if ( above( m ) >= 0 ) a = m; else b = m; }
				return new THREE.Vector3( o.x + d.x * b, 0, o.z + d.z * b ).setY( hf.heightAt( o.x + d.x * b, o.z + d.z * b ) );
			}
			prev = h; t0 = t;
			t += h === null ? 2 : Math.min( 25, Math.max( 0.4, h * 0.5 ) );
		}
		return null;
	}

	_pickPlane( y ) {
		const r = this.dom.getBoundingClientRect();
		this._ndc.set( ( this.pointer.x - r.left ) / r.width * 2 - 1, - ( ( this.pointer.y - r.top ) / r.height ) * 2 + 1 );
		this._raycaster.setFromCamera( this._ndc, this.camera );
		const o = this._raycaster.ray.origin, d = this._raycaster.ray.direction;
		if ( Math.abs( d.y ) < 1e-4 ) return null;
		const t = ( y - o.y ) / d.y;
		if ( t <= 0 ) return null;
		return ( this._planeHit ??= new THREE.Vector3() ).set( o.x + d.x * t, y, o.z + d.z * t );
	}

	// ------------------------------------------------------------------ brushes

	// falloff weight at distance d from the centre (1 inside the hard core, 0 at the radius)
	_weight( d ) {
		const t = d / this.radius;
		if ( t >= 1 ) return 0;
		const inner = this.hardness * 0.95;
		if ( t <= inner ) return 1;
		const u = ( t - inner ) / ( 1 - inner );
		return 0.5 + 0.5 * Math.cos( Math.PI * u );
	}

	// cells of the brush around world (cx, cz): calls fn( k, x, z, w ) and grows the dirty box
	_forCells( cx, cz, fn ) {
		const { hf } = this, n = hf.n, R = this.radius;
		const i0 = Math.max( 0, Math.floor( ( cx - R - hf.x0 ) / hf.cell ) ), i1 = Math.min( n - 1, Math.ceil( ( cx + R - hf.x0 ) / hf.cell ) );
		const j0 = Math.max( 0, Math.floor( ( cz - R - hf.z0 ) / hf.cell ) ), j1 = Math.min( n - 1, Math.ceil( ( cz + R - hf.z0 ) / hf.cell ) );
		if ( i0 > i1 || j0 > j1 ) return;
		for ( let j = j0; j <= j1; j ++ ) {
			const z = hf.z0 + j * hf.cell;
			for ( let i = i0; i <= i1; i ++ ) {
				const x = hf.x0 + i * hf.cell;
				const w = this._weight( Math.hypot( x - cx, z - cz ) );
				if ( w > 0 ) fn( j * n + i, x, z, w, i, j );
			}
		}
		this._markDirty( i0, j0, i1, j1 );
	}

	_markDirty( i0, j0, i1, j1 ) {
		const d = this.dirty;
		this.dirty = d ? [ Math.min( d[ 0 ], i0 ), Math.min( d[ 1 ], j0 ), Math.max( d[ 2 ], i1 ), Math.max( d[ 3 ], j1 ) ] : [ i0, j0, i1, j1 ];
		this.texDue = true;
		this.changed = true;
	}

	// the one way heights change: keeps the edit layer and remembers the value for undo
	_set( k, h ) {
		const st = this.stroke;
		if ( st && ! st.touched.has( k ) ) st.touched.set( k, this.delta[ k ] );
		this.hf.data[ k ] = h;
		this.delta[ k ] = this.hf.data[ k ] - this.base[ k ];
	}

	// one application of the brush at (cx, cz) over dt seconds
	_dab( cx, cz, dt ) {
		const d = this.hf.data, s = this.strength;
		const sign = ( this.tool === 'lower' ? - 1 : 1 ) * ( this.invert ? - 1 : 1 );
		switch ( this.tool ) {
			case 'raise':
			case 'lower': {
				const rate = 10 * s * s * sign * dt; // m per second at the centre
				this._forCells( cx, cz, ( k, x, z, w ) => this._set( k, d[ k ] + rate * w ) );
				break;
			}
			case 'smooth': {
				// 5 x 5 averages computed first (the result does not depend on the scan order), into a
				// reused scratch array: [ k, average, weight ] per cell
				const n = this.hf.n, cells = Math.ceil( 2 * this.radius / this.hf.cell + 3 ) ** 2 * 3;
				if ( this._tmp.length < cells ) this._tmp = new Float32Array( cells );
				const tmp = this._tmp;
				let m = 0;
				this._forCells( cx, cz, ( k, x, z, w, i, j ) => {
					let sum = 0, c = 0;
					for ( let b = - 2; b <= 2; b ++ ) for ( let a = - 2; a <= 2; a ++ ) {
						const ii = i + a, jj = j + b;
						if ( ii < 0 || jj < 0 || ii >= n || jj >= n ) continue;
						sum += d[ jj * n + ii ]; c ++;
					}
					tmp[ m ++ ] = k; tmp[ m ++ ] = sum / c; tmp[ m ++ ] = w;
				} );
				const f = Math.min( 1, 12 * s * dt );
				for ( let q = 0; q < m; q += 3 ) { const k = tmp[ q ], avg = tmp[ q + 1 ]; this._set( k, d[ k ] + ( avg - d[ k ] ) * f * tmp[ q + 2 ] ); }
				break;
			}
			case 'flatten': {
				const target = this.stroke.flattenTo, f = Math.min( 1, 10 * s * dt );
				this._forCells( cx, cz, ( k, x, z, w ) => this._set( k, d[ k ] + ( target - d[ k ] ) * f * w ) );
				break;
			}
			case 'noise': {
				const n2 = this.stroke.noise ??= makeSimplex( this.gen.seed );
				const fr = this.gen.freq / 100, rate = 8 * s * sign * dt;
				this._forCells( cx, cz, ( k, x, z, w ) => this._set( k, d[ k ] + fbm( n2, x * fr, z * fr, this.gen.octaves ) * rate * w ) );
				break;
			}
			case 'dig':
			case 'fill': {
				// a fixed profile, not a rate: the level inside, then a ramp of width `shore` up (dig) or
				// down (fill) to the relief as it was before this stroke, so holding the brush does not
				// eat the bank away. Only lowers (dig) / only raises (fill).
				const dig = this.tool === 'dig', st = this.stroke, R = this.radius;
				const level = dig ? WATER_LEVEL - this.water.depth : WATER_LEVEL + this.water.fill;
				const S = Math.min( this.water.shore, R ), inner = R - S;
				const f = Math.min( 1, 6 * s * dt );
				this._forCells( cx, cz, ( k, x, z ) => {
					const r = Math.hypot( x - cx, z - cz );
					const u = S > 0 ? Math.min( 1, Math.max( 0, ( r - inner ) / S ) ) : ( r < R ? 0 : 1 );
					const b = u * u * ( 3 - 2 * u );
					const orig = st.touched.has( k ) ? this.base[ k ] + st.touched.get( k ) : d[ k ];
					const target = level + ( orig - level ) * b;
					if ( dig ? target >= d[ k ] : target <= d[ k ] ) return;
					this._set( k, d[ k ] + ( target - d[ k ] ) * f );
				} );
				break;
			}
			case 'restore': {
				const f = Math.min( 1, 8 * s * dt );
				// lands exactly on the procedural relief once the remaining edit is negligible
				this._forCells( cx, cz, ( k, x, z, w ) => {
					const r = this.delta[ k ] * ( 1 - f * w );
					this._set( k, this.base[ k ] + ( Math.abs( r ) < 1e-3 ? 0 : r ) );
				} );
				break;
			}
		}
	}

	// the "Gerar" stamp (shader-studio's terrain): Perlin fbm, or an island (fbm under a radial
	// falloff, below the water at the rim), blended into the relief by the brush falloff
	_stamp( cx, cz ) {
		const g = this.gen, d = this.hf.data, R = this.radius;
		const n2 = makeSimplex( g.seed );
		const fr = g.freq / 100;
		const sign = this.invert ? - 1 : 1;
		this._forCells( cx, cz, ( k, x, z, w ) => {
			const f = fbm( n2, ( x - cx ) * fr, ( z - cz ) * fr, g.octaves ); // about -1..1
			if ( g.kind === 'perlin' ) {
				this._set( k, d[ k ] + f * g.height * sign * w * this.strength * 2 );
			} else {
				// shader-studio's island: fbm under a radial falloff, below the water at the rim. Here
				// the coastline is made irregular (the distance warped by a low-frequency fbm) and
				// the fbm only modulates the height, so it reads as an island rather than a dome
				const coast = fbm( n2, ( x - cx ) * fr * 0.35 + 31.7, ( z - cz ) * fr * 0.35 - 12.3, 3 );
				const t = Math.hypot( x - cx, z - cz ) / R * ( 1 + 0.35 * coast );
				const fall = Math.max( 0, 1 - t * t );
				const island = WATER_LEVEL + ( 0.15 + 0.85 * ( f * 0.5 + 0.5 ) ) * g.height * Math.pow( fall, 1.4 ) - ( 1 - fall ) * g.depth;
				this._set( k, d[ k ] + ( island - d[ k ] ) * w );
			}
		} );
	}

	// "Encher": a lake at its own level in the hollow under the point (world/lakeWater.js), kept as a
	// point in the world edits (saved with "Salvar e aplicar"; the koi and lotus come on the reload).
	// Shift: removes the lake under the point.
	_pour( p ) {
		const lakes = this.app.lakes, obj = this.app.objectEditor;
		if ( ! lakes || ! obj ) { this._toast( 'Encher precisa do editor de objetos (?edit).' ); return; }
		const list = obj.edits.lakes ??= [];
		if ( this.invert ) {
			const lake = lakes.at( p.x, p.z );
			if ( ! lake ) { this._toast( 'Nenhum lago aqui.' ); return; }
			lakes.remove( lake );
			obj.edits.lakes = list.filter( ( s ) => ! lake.cellSet.has( this._cellOf( s.x, s.z ) ) );
			obj.changed = true;
			this._toast( 'Lago removido (salve para aplicar).' );
			return;
		}
		const res = lakes.add( { x: p.x, z: p.z } );
		if ( res.error ) {
			const msg = { fora: 'fora do mapa', mar: 'isto é mar', grande: 'a bacia é grande demais (a água escaparia longe daqui)', raso: 'não é uma depressão: a água escorreria daqui', repetido: 'já há um lago nesta depressão' }[ res.error ];
			this._toast( `Não dá para encher aqui: ${ msg }.` );
			return;
		}
		list.push( res.seed );
		obj.changed = true;
		this._toast( `Lago: nível ${ res.level.toFixed( 1 ) } m, ${ Math.round( res.area ) } m², até ${ res.deepest.toFixed( 1 ) } m de fundo. Salve para as carpas e o lótus.` );
	}

	// "Rio": a click adds a point to the course (Shift removes the river under it); Enter carves it
	_riverClick( p ) {
		const rivers = this.app.rivers, obj = this.app.objectEditor;
		if ( ! rivers || ! obj ) { this._toast( 'O Rio precisa do editor de objetos (?edit).' ); return; }
		if ( this.invert ) {
			const r = rivers.at( p.x, p.z, 2 );
			if ( ! r ) { this._toast( 'Nenhum rio aqui.' ); return; }
			rivers.remove( r );
			const first = r.record.points[ 0 ];
			obj.edits.rivers = ( obj.edits.rivers ?? [] ).filter( ( q ) => ! ( q.points[ 0 ][ 0 ] === first[ 0 ] && q.points[ 0 ][ 1 ] === first[ 1 ] ) );
			obj.changed = true;
			this._toast( 'Rio removido (o leito escavado fica: use Restaurar para fechar). Salve para aplicar.' );
			return;
		}
		this.river.points.push( [ +p.x.toFixed( 2 ), +p.z.toFixed( 2 ), this.river.width ] );
		this._riverPreview();
		this._toast( `Rio: ${ this.river.points.length } ponto(s). Enter conclui, Backspace tira o último, Esc cancela.` );
	}

	_riverFinish() {
		const pts = this.river.points, rivers = this.app.rivers, obj = this.app.objectEditor;
		if ( pts.length < 2 ) { this._toast( 'Marque pelo menos dois pontos do curso.' ); return; }
		const record = { points: pts.map( ( q ) => q.slice() ) };
		// the levels on the relief as it is now, saved with the course
		const course = new RiverCourse( record, ( x, z ) => this.hf.heightAt( x, z ), WATER_LEVEL );
		record.levels = course.levels();
		// the channel carved into the edits, as one undoable stroke
		const { hf } = this, n = hf.n, [ bx0, bz0, bx1, bz1 ] = course.box;
		const i0 = Math.max( 0, Math.floor( ( bx0 - hf.x0 ) / hf.cell ) ), i1 = Math.min( n - 1, Math.ceil( ( bx1 - hf.x0 ) / hf.cell ) );
		const j0 = Math.max( 0, Math.floor( ( bz0 - hf.z0 ) / hf.cell ) ), j1 = Math.min( n - 1, Math.ceil( ( bz1 - hf.z0 ) / hf.cell ) );
		this.stroke = { touched: new Map(), flattenTo: 0, noise: null, last: new THREE.Vector3() };
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {
			const k = j * n + i, h0 = hf.data[ k ];
			const h1 = course.carve( hf.x0 + i * hf.cell, hf.z0 + j * hf.cell, h0 );
			if ( Math.abs( h1 - h0 ) > 1e-3 ) this._set( k, h1 );
		}
		this._markDirty( i0, j0, i1, j1 );
		this._end();
		rivers.add( record );
		( obj.edits.rivers ??= [] ).push( record );
		obj.changed = true;
		const S = course.samples;
		this._toast( `Rio de ${ Math.round( course.length ) } m, descendo ${ ( S[ 0 ].y - S.at( - 1 ).y ).toFixed( 1 ) } m. Leito escavado (Ctrl+Z desfaz a escavação). Salve para aplicar.` );
		this.river.points = [];
		this._riverPreview();
		return record;
	}

	_riverCancel() { this.river.points = []; this._riverPreview(); }

	// the course being laid, as a line over the relief (to the cursor while the tool is on)
	_riverPreview() {
		if ( ! this.riverLine ) {
			const g = new THREE.BufferGeometry();
			g.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 3 * 4096 ), 3 ) );
			this.riverLine = new THREE.Line( g, new THREE.LineBasicNodeMaterial( { color: 0x5fc8e8, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 } ) );
			this.riverLine.frustumCulled = false; this.riverLine.renderOrder = 999;
			this.app.scene.add( this.riverLine );
		}
		const pts = this.river.points.slice();
		if ( this.tool === 'river' && this.hit && pts.length ) pts.push( [ this.hit.x, this.hit.z, this.river.width ] );
		const S = pts.length >= 2 ? sampleCurve( pts ) : [];
		const a = this.riverLine.geometry.attributes.position, m = Math.min( S.length, 4096 );
		for ( let q = 0; q < m; q ++ ) a.setXYZ( q, S[ q ].x, Math.max( this.hf.heightAt( S[ q ].x, S[ q ].z ), WATER_LEVEL ) + 0.4, S[ q ].z );
		a.needsUpdate = true;
		this.riverLine.geometry.setDrawRange( 0, m );
		this.riverLine.visible = m > 1;
	}

	_cellOf( x, z ) {
		const hf = this.hf;
		return Math.round( ( z - hf.z0 ) / hf.cell ) * hf.n + Math.round( ( x - hf.x0 ) / hf.cell );
	}

	// ------------------------------------------------------------------ strokes, undo

	_begin() {
		if ( ! this.hit ) return false;
		this.stroke = { touched: new Map(), flattenTo: this.hit.y, noise: null, last: this.hit.clone() };
		if ( this.tool === 'generate' ) { this._stamp( this.hit.x, this.hit.z ); this._end(); return false; }
		if ( this.tool === 'lake' ) { this.stroke = null; this._pour( this.hit ); return false; }
		if ( this.tool === 'river' ) { this.stroke = null; this._riverClick( this.hit ); return false; }
		return true;
	}

	_end() {
		const st = this.stroke;
		this.stroke = null;
		if ( ! st || ! st.touched.size ) return;
		const keys = Int32Array.from( st.touched.keys() );
		const before = Float32Array.from( st.touched.values() );
		const after = new Float32Array( keys.length );
		for ( let q = 0; q < keys.length; q ++ ) after[ q ] = this.delta[ keys[ q ] ];
		this._pushUndo( { keys, before, after } );
		this.texDue = true; this.texTimer = HEIGHT_TEX_EVERY; // upload now
		this._status();
	}

	// put the edit layer of a step back (undo: before, redo: after)
	_applyStep( step, values ) {
		const { hf } = this, n = hf.n;
		let i0 = n, j0 = n, i1 = 0, j1 = 0;
		for ( let q = 0; q < step.keys.length; q ++ ) {
			const k = step.keys[ q ];
			hf.data[ k ] = this.base[ k ] + values[ q ];
			this.delta[ k ] = hf.data[ k ] - this.base[ k ];
			const i = k % n, j = ( k - i ) / n;
			if ( i < i0 ) i0 = i; if ( i > i1 ) i1 = i; if ( j < j0 ) j0 = j; if ( j > j1 ) j1 = j;
		}
		if ( step.keys.length ) this._markDirty( i0, j0, i1, j1 );
		this.texTimer = HEIGHT_TEX_EVERY;
	}

	// at most UNDO_MAX steps and ~UNDO_CELLS edited cells kept (an import / clear can be the whole grid)
	_pushUndo( step ) {
		this.undo.push( step );
		this.redo.length = 0;
		let cells = 0;
		for ( const u of this.undo ) cells += u.keys.length;
		while ( this.undo.length > 1 && ( this.undo.length > UNDO_MAX || cells > UNDO_CELLS ) ) cells -= this.undo.shift().keys.length;
	}

	undoStep() { if ( this.down || this.stroke ) return; const s = this.undo.pop(); if ( s ) { this._applyStep( s, s.before ); this.redo.push( s ); } this._status(); }
	redoStep() { if ( this.down || this.stroke ) return; const s = this.redo.pop(); if ( s ) { this._applyStep( s, s.after ); this.undo.push( s ); } this._status(); }

	// replace the whole edit layer (import / clear), undoable
	_replaceAll( next ) {
		const keys = [], before = [], after = [];
		for ( let k = 0; k < next.length; k ++ ) if ( next[ k ] !== this.delta[ k ] ) { keys.push( k ); before.push( this.delta[ k ] ); after.push( next[ k ] ); }
		if ( ! keys.length ) return;
		const step = { keys: Int32Array.from( keys ), before: Float32Array.from( before ), after: Float32Array.from( after ) };
		this._applyStep( step, step.after );
		this._pushUndo( step );
		this._status();
	}

	// ------------------------------------------------------------------ frame

	update( dt ) {
		this.frames = ( this.frames || 0 ) + 1;
		if ( this.down ) this.dabFrames = ( this.dabFrames || 0 ) + 1;
		if ( this.active && this.pointer.inside && ! this.down ) this.hit = this._pick();
		if ( this.down && this.stroke ) {
			// on the horizontal plane at the stroke's start height: picking the relief being edited
			// made the brush crawl towards the camera as the slope rose under a still pointer
			const h = this._pickPlane( this.stroke.flattenTo );
			if ( h ) {
				// dabs along the path (spacing ~ a quarter of the radius) so fast strokes stay smooth
				const last = this.stroke.last, dist = Math.hypot( h.x - last.x, h.z - last.z );
				const steps = Math.max( 1, Math.min( 32, Math.ceil( dist / ( this.radius * 0.25 ) ) ) );
				const step = Math.min( dt, 0.05 ) / steps;
				for ( let q = 1; q <= steps; q ++ ) this._dab( last.x + ( h.x - last.x ) * q / steps, last.z + ( h.z - last.z ) * q / steps, step );
				this.stroke.last.copy( h );
				this.hit = h;
			}
		}
		this.texTimer += dt;
		if ( this.dirty ) {
			const [ i0, j0, i1, j1 ] = this.dirty;
			this.dirty = null;
			this.terrain.refresh( i0, j0, i1, j1, false );
			const t = this.texRect;
			this.texRect = t ? [ Math.min( t[ 0 ], i0 ), Math.min( t[ 1 ], j0 ), Math.max( t[ 2 ], i1 ), Math.max( t[ 3 ], j1 ) ] : [ i0, j0, i1, j1 ];
			if ( this.texDue && this.texTimer >= HEIGHT_TEX_EVERY ) this._uploadTex();
			this.app.sky.sun.shadow.needsUpdate = true;
		} else if ( this.texDue && this.texTimer >= HEIGHT_TEX_EVERY && ! this.down ) {
			this._uploadTex();
		}
		this._updateCursor();
		this._info();
	}

	// the height texture: only the rectangle edited since the last upload is converted
	_uploadTex() {
		const t = this.texRect;
		this.texRect = null;
		this.texDue = false; this.texTimer = 0;
		if ( t ) this.terrain.refreshHeightTex( t[ 0 ], t[ 1 ], t[ 2 ], t[ 3 ] );
	}

	// ------------------------------------------------------------------ cursor

	_buildCursor() {
		const SEG = 96;
		const mat = new THREE.LineBasicNodeMaterial( { color: 0xe6c987, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 } );
		const inner = new THREE.LineBasicNodeMaterial( { color: 0xe6c987, depthTest: false, depthWrite: false, transparent: true, opacity: 0.45 } );
		const ring = ( m ) => {
			const g = new THREE.BufferGeometry();
			// closed by repeating the first point (WebGPU has no LineLoop)
			g.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( ( SEG + 1 ) * 3 ), 3 ) );
			const l = new THREE.Line( g, m );
			l.frustumCulled = false; l.renderOrder = 999;
			return l;
		};
		this.cursor = new THREE.Group();
		this.cursor.name = 'terrainEditorCursor';
		this.ringOuter = ring( mat );
		this.ringInner = ring( inner );
		this.cursor.add( this.ringOuter, this.ringInner );
		this.cursor.visible = false;
		this.app.scene.add( this.cursor );
		this._seg = SEG;
	}

	_updateCursor() {
		const h = this.hit;
		this.cursor.visible = !! ( this.active && h && this.pointer.inside );
		if ( ! this.cursor.visible ) return;
		const fill = ( line, r ) => {
			const a = line.geometry.attributes.position;
			for ( let q = 0; q <= this._seg; q ++ ) {
				const t = q / this._seg * Math.PI * 2;
				const x = h.x + Math.cos( t ) * r, z = h.z + Math.sin( t ) * r;
				a.setXYZ( q, x, Math.max( this.hf.heightAt( x, z ), WATER_LEVEL ) + 0.35, z ); // on the water over the lake
			}
			a.needsUpdate = true;
		};
		const river = this.tool === 'river';
		fill( this.ringOuter, river ? this.river.width / 2 : this.radius );
		if ( river && this.river.points.length ) this._riverPreview();
		const water = this.tool === 'dig' || this.tool === 'fill';
		fill( this.ringInner, river ? 0.4 : Math.max( 0.5, water ? this.radius - Math.min( this.water.shore, this.radius ) : this.radius * this.hardness * 0.95 ) );
		const neg = ( this.tool === 'lower' ) !== this.invert;
		const c = this.tool === 'restore' ? 0x9fd0ff : this.tool === 'generate' ? 0xb7e08a : this.tool === 'dig' || this.tool === 'lake' || this.tool === 'river' ? 0x5fc8e8 : this.tool === 'fill' ? 0xd8b56a : neg ? 0xff9a6a : 0xe6c987;
		this.ringOuter.material.color.setHex( c );
		this.ringInner.material.color.setHex( c );
	}

	// ------------------------------------------------------------------ input

	_bind() {
		const dom = this.dom;
		dom.addEventListener( 'pointermove', ( e ) => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.inside = true; this.invert = e.shiftKey; } );
		dom.addEventListener( 'pointerleave', () => { this.pointer.inside = false; } );
		dom.addEventListener( 'pointerdown', ( e ) => {
			if ( ! this.active || e.button !== 0 || e.altKey ) return;
			this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.inside = true;
			this.invert = e.shiftKey;
			this.hit = this._pick();
			if ( this._begin() ) { this.down = true; dom.setPointerCapture?.( e.pointerId ); }
		} );
		// the stroke ends whenever the left button is no longer held: a chord with the right
		// button releases the left one in a pointermove, not a pointerup; also cancel / lost capture
		// / leaving the window
		const release = () => { if ( this.down ) { this.down = false; this._end(); } };
		window.addEventListener( 'pointerup', ( e ) => { if ( ( e.buttons & 1 ) === 0 ) release(); } );
		window.addEventListener( 'pointermove', ( e ) => { if ( this.down && ( e.buttons & 1 ) === 0 ) release(); } );
		dom.addEventListener( 'pointercancel', release );
		dom.addEventListener( 'lostpointercapture', release );
		window.addEventListener( 'blur', release );
		window.addEventListener( 'keydown', ( e ) => {
			if ( e.target.closest && e.target.closest( 'input,select,textarea' ) ) return;
			if ( e.key === 'Shift' ) this.invert = true;
			if ( ! this.active ) return;
			if ( e.code === 'KeyT' && ! e.ctrlKey && ! e.metaKey ) this.toggleOverhead();
			if ( this.tool === 'river' && this.river.points.length ) {
				if ( e.code === 'Enter' ) { e.preventDefault(); this._riverFinish(); }
				if ( e.code === 'Escape' ) { e.preventDefault(); this._riverCancel(); }
				if ( e.code === 'Backspace' ) { e.preventDefault(); this.river.points.pop(); this._riverPreview(); }
			}
			if ( e.code === 'BracketLeft' ) this._setRadius( this.radius / 1.15 );
			if ( e.code === 'BracketRight' ) this._setRadius( this.radius * 1.15 );
			if ( ( e.ctrlKey || e.metaKey ) && e.code === 'KeyZ' ) { e.preventDefault(); e.shiftKey ? this.redoStep() : this.undoStep(); }
			if ( ( e.ctrlKey || e.metaKey ) && e.code === 'KeyY' ) { e.preventDefault(); this.redoStep(); }
		} );
		window.addEventListener( 'keyup', ( e ) => { if ( e.key === 'Shift' ) this.invert = false; } );
		window.addEventListener( 'beforeunload', ( e ) => { if ( ( this.changed || this.app.objectEditor?.changed || this.app.natureEditor?.changed ) && ! this._saving ) { e.preventDefault(); e.returnValue = ''; } } );
	}

	setActive( on ) {
		this.active = on;
		this.app.freecam.leftLook = ! on;
		if ( ! on ) { this.down = false; this._end(); }
		this.panel.classList.toggle( 'paused', ! on );
		this.ui.toggle.textContent = on ? 'Pausar edição' : 'Retomar edição';
	}

	// View from above over the cursor (or the point the camera looks at), and back
	toggleOverhead( radius = this.radius ) {
		const fc = this.app.freecam, cam = this.camera;
		if ( this.overhead ) {
			const o = this.overhead;
			this.overhead = null;
			fc.planar = false;
			fc.flyTo( o.pos, o.target, 1.2 );
		} else {
			const fwd = cam.getWorldDirection( new THREE.Vector3() );
			const target = this.hit ? this.hit.clone() : cam.position.clone().addScaledVector( fwd, 120 );
			target.y = this.hf.heightAt( target.x, target.z );
			this.overhead = { pos: cam.position.clone(), target: cam.position.clone().addScaledVector( fwd, 60 ) };
			const H = Math.max( 120, radius * 7 );
			// almost straight down (an exact vertical has no heading); the top of the screen keeps the
			// current heading
			const h = new THREE.Vector3( fwd.x, 0, fwd.z ).normalize();
			if ( ! Number.isFinite( h.x ) || h.lengthSq() < 0.5 ) h.set( 0, 0, - 1 );
			fc.flyTo( target.clone().add( new THREE.Vector3( 0, H, 0 ) ).addScaledVector( h, - H * 0.03 ), target, 1.2 );
			fc.planar = true;
		}
		this.ui.overhead.classList.toggle( 'on', !! this.overhead );
	}

	_setRadius( r ) {
		this.radius = Math.min( 300, Math.max( 3, r ) );
		this.ui.size.value = this.radius; this.ui.sizeOut.textContent = this.radius.toFixed( 0 ) + ' m';
	}

	// ------------------------------------------------------------------ save / load

	async save() {
		this._saving = true;
		try {
			// the village objects too (editor/objectEditor.js)
			const obj = this.app.objectEditor;
			if ( obj?.changed ) await obj.saveFile();
			// and the painted nature (editor/natureEditor.js)
			if ( this.app.natureEditor?.changed ) await this.app.natureEditor.saveFile();
			// the relief only when edited (or already saved once): no empty 5 MB file
			if ( this.changed || this.app.terrainEdits ) {
				const res = await fetch( '/__terrain-edits', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: this.delta.buffer.slice( 0 ) } );
				if ( ! res.ok ) throw new Error( res.status );
			}
			this.changed = false;
			this._toast( 'Edições salvas em public/. Recarregando…' );
			// a fresh load builds everything (AO, vegetation, houses) on the edited relief
			setTimeout( () => location.reload(), 400 );
		} catch ( e ) {
			this._saving = false;
			// every edited file is downloaded instead: terrain-edits.bin, world-edits.json, nature-edits.bin
			this._toast( 'Não foi possível gravar no servidor de desenvolvimento: baixando os arquivos editados (coloque-os em public/).' );
			if ( this.changed ) this.exportFile();
			if ( this.app.objectEditor?.changed ) this.app.objectEditor.exportFile();
			if ( this.app.natureEditor?.changed ) this.app.natureEditor.exportFile();
		}
	}

	exportFile() {
		const a = document.createElement( 'a' );
		a.href = URL.createObjectURL( new Blob( [ this.delta ], { type: 'application/octet-stream' } ) );
		a.download = 'terrain-edits.bin';
		a.click();
		setTimeout( () => URL.revokeObjectURL( a.href ), 1000 );
	}

	async importFile( file ) {
		const buf = await file.arrayBuffer();
		if ( buf.byteLength !== this.delta.byteLength ) { this._toast( `Arquivo inválido: ${ buf.byteLength } bytes (esperado ${ this.delta.byteLength })` ); return; }
		const next = new Float32Array( buf );
		for ( let k = 0; k < next.length; k ++ ) if ( ! Number.isFinite( next[ k ] ) ) { this._toast( 'Arquivo inválido: contém valores não numéricos.' ); return; }
		this._replaceAll( next );
		this._toast( 'Edições importadas (Ctrl+Z desfaz).' );
	}

	clearAll() { this._replaceAll( new Float32Array( this.delta.length ) ); this._toast( 'Todas as edições removidas (Ctrl+Z desfaz).' ); }

	// ------------------------------------------------------------------ panel

	_buildPanel() {
		const el = document.createElement( 'div' );
		el.id = 'terrain-editor';
		el.className = 'panel';
		el.innerHTML = `
			<header><b>Editor de relevo</b><button data-act="toggle" class="small"></button></header>
			<div class="tools">${ TOOLS.map( ( t ) => `<button data-tool="${ t.id }" title="${ t.hint }">${ t.label }</button>` ).join( '' ) }</div>
			<p class="hint"></p>
			<label>Tamanho <input data-k="size" type="range" min="3" max="300" step="1"><output></output></label>
			<label>Força <input data-k="strength" type="range" min="0.02" max="1" step="0.01"><output></output></label>
			<label>Dureza <input data-k="hardness" type="range" min="0" max="1" step="0.01"><output></output></label>
			<fieldset class="water">
				<legend>Água (Cavar e Aterrar) · nível ${ WATER_LEVEL } m</legend>
				<label>Profundidade <input data-k="wdepth" type="range" min="0.5" max="30" step="0.5"><output></output></label>
				<label>Aterro <input data-k="wfill" type="range" min="0.2" max="20" step="0.1"><output></output></label>
				<label>Margem <input data-k="wshore" type="range" min="0" max="60" step="0.5"><output></output></label>
			</fieldset>
			<fieldset class="river">
				<legend>Rio</legend>
				<label>Largura <input data-k="rwidth" type="range" min="2" max="24" step="0.5"><output></output></label>
				<div class="row"><button data-act="riverDone">Concluir (Enter)</button><button data-act="riverCancel">Cancelar (Esc)</button></div>
			</fieldset>
			<fieldset class="gen">
				<legend>Procedural (Gerar e Ruído)</legend>
				<label>Tipo <select data-k="kind"><option value="island">Ilha</option><option value="perlin">Perlin</option></select></label>
				<label>Frequência <input data-k="freq" type="range" min="0.1" max="8" step="0.05"><output></output></label>
				<label>Oitavas <input data-k="octaves" type="range" min="1" max="8" step="1"><output></output></label>
				<label>Altura <input data-k="height" type="range" min="1" max="160" step="1"><output></output></label>
				<label>Profundidade <input data-k="depth" type="range" min="0" max="40" step="0.5"><output></output></label>
				<label>Semente <input data-k="seed" type="number" min="1" max="99999" step="1"><button data-act="dice" class="small" title="Semente aleatória">🎲</button></label>
			</fieldset>
			<p class="info"></p>
			<div class="row"><button data-act="overhead" title="T">Vista de cima</button></div>
			<div class="row"><button data-act="undo">Desfazer</button><button data-act="redo">Refazer</button></div>
			<div class="row"><button data-act="save" class="primary">Salvar e aplicar</button></div>
			<div class="row"><button data-act="export">Exportar</button><button data-act="import">Importar</button><button data-act="clear">Limpar tudo</button></div>
			<p class="keys">Esq.: esculpir · Dir. arrastar: olhar · WASD/QE: voar · Shift: inverter · [ ]: tamanho · T: vista de cima · Ctrl+Z/Y</p>
			<input type="file" accept=".bin" hidden>`;
		document.body.appendChild( el );
		this.panel = el;
		const q = ( s ) => el.querySelector( s );
		this.ui = { overhead: q( '[data-act=overhead]' ), toggle: q( '[data-act=toggle]' ), hint: q( '.hint' ), info: q( '.info' ), size: q( '[data-k=size]' ), sizeOut: q( '[data-k=size]' ).nextElementSibling, undo: q( '[data-act=undo]' ), redo: q( '[data-act=redo]' ) };
		const style = document.createElement( 'style' );
		style.textContent = `
			#terrain-editor { position: fixed; top: 78px; left: 12px; width: 288px; padding: 10px 12px; z-index: 12; font-size: 12px; color: var(--ink); max-height: calc(100vh - 140px); overflow: auto; }
			#terrain-editor header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: var(--gold-2); font-size: 13px; }
			#terrain-editor .tools { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
			#terrain-editor button { background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 6px; padding: 5px 4px; cursor: pointer; font: inherit; }
			#terrain-editor button:hover { border-color: var(--gold); }
			#terrain-editor button.on { background: rgba(201,164,92,.35); border-color: var(--gold-2); color: #fff; }
			#terrain-editor button.primary { background: rgba(60,90,42,.6); border-color: #7fae5a; width: 100%; }
			#terrain-editor button.small { padding: 2px 8px; }
			#terrain-editor button:disabled { opacity: .4; cursor: default; }
			#terrain-editor label { display: grid; grid-template-columns: 78px 1fr 46px; align-items: center; gap: 6px; margin: 5px 0; }
			#terrain-editor input[type=range] { width: 100%; accent-color: var(--gold); }
			#terrain-editor input[type=number], #terrain-editor select { background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 4px; padding: 2px 4px; font: inherit; }
			#terrain-editor output { text-align: right; color: var(--ink-dim); }
			#terrain-editor fieldset { border: 1px solid var(--panel-edge); border-radius: 8px; margin: 8px 0; padding: 4px 8px; }
			#terrain-editor legend { color: var(--ink-dim); padding: 0 4px; }
			#terrain-editor .row { display: flex; gap: 4px; margin-top: 5px; } #terrain-editor .row button { flex: 1; }
			#terrain-editor .hint, #terrain-editor .keys { color: var(--ink-dim); margin: 6px 0; line-height: 1.35; }
			#terrain-editor .info { font-family: ui-monospace, monospace; margin: 6px 0; min-height: 30px; }
			#terrain-editor.paused .tools, #terrain-editor.paused label, #terrain-editor.paused fieldset { opacity: .45; pointer-events: none; }
			#terrain-editor .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); }`;
		document.head.appendChild( style );

		// tools
		const setTool = ( id ) => {
			this.tool = id;
			for ( const b of el.querySelectorAll( '[data-tool]' ) ) b.classList.toggle( 'on', b.dataset.tool === id );
			this.ui.hint.textContent = TOOLS.find( ( t ) => t.id === id ).hint;
		};
		for ( const b of el.querySelectorAll( '[data-tool]' ) ) b.onclick = () => setTool( b.dataset.tool );
		setTool( this.tool );
		// sliders
		const bind = ( k, get, set, fmt ) => {
			const input = el.querySelector( `[data-k=${ k }]` ), out = input.nextElementSibling;
			input.value = get();
			const show = () => { if ( out?.tagName === 'OUTPUT' ) out.textContent = fmt( get() ); };
			input.oninput = () => { set( input.type === 'range' || input.type === 'number' ? Number( input.value ) : input.value ); show(); };
			show();
			return input;
		};
		bind( 'size', () => this.radius, ( v ) => { this.radius = v; }, ( v ) => v.toFixed( 0 ) + ' m' );
		bind( 'strength', () => this.strength, ( v ) => { this.strength = v; }, ( v ) => Math.round( v * 100 ) + '%' );
		bind( 'hardness', () => this.hardness, ( v ) => { this.hardness = v; }, ( v ) => Math.round( v * 100 ) + '%' );
		bind( 'wdepth', () => this.water.depth, ( v ) => { this.water.depth = v; }, ( v ) => v.toFixed( 1 ) + ' m' );
		bind( 'wfill', () => this.water.fill, ( v ) => { this.water.fill = v; }, ( v ) => v.toFixed( 1 ) + ' m' );
		bind( 'wshore', () => this.water.shore, ( v ) => { this.water.shore = v; }, ( v ) => v.toFixed( 1 ) + ' m' );
		bind( 'rwidth', () => this.river.width, ( v ) => { this.river.width = v; }, ( v ) => v.toFixed( 1 ) + ' m' );
		bind( 'kind', () => this.gen.kind, ( v ) => { this.gen.kind = v; }, String );
		bind( 'freq', () => this.gen.freq, ( v ) => { this.gen.freq = v; }, ( v ) => v.toFixed( 2 ) );
		bind( 'octaves', () => this.gen.octaves, ( v ) => { this.gen.octaves = v; }, String );
		bind( 'height', () => this.gen.height, ( v ) => { this.gen.height = v; }, ( v ) => v.toFixed( 0 ) + ' m' );
		bind( 'depth', () => this.gen.depth, ( v ) => { this.gen.depth = v; }, ( v ) => v.toFixed( 1 ) + ' m' );
		const seed = bind( 'seed', () => this.gen.seed, ( v ) => { this.gen.seed = Math.max( 1, Math.floor( v ) || 1 ); }, String );
		// actions
		const file = el.querySelector( 'input[type=file]' );
		file.onchange = () => { if ( file.files[ 0 ] ) this.importFile( file.files[ 0 ] ); file.value = ''; };
		let clearArmed = 0;
		const acts = {
			toggle: () => this.setActive( ! this.active ),
			overhead: () => this.toggleOverhead(),
			dice: () => { this.gen.seed = 1 + Math.floor( Math.random() * 99998 ); seed.value = this.gen.seed; },
			undo: () => this.undoStep(), redo: () => this.redoStep(),
			riverDone: () => this._riverFinish(), riverCancel: () => this._riverCancel(),
			save: () => this.save(), export: () => this.exportFile(), import: () => file.click(),
			// two clicks within 3 s (no browser dialog)
			clear: ( b ) => {
				if ( performance.now() - clearArmed < 3000 ) { clearArmed = 0; b.textContent = 'Limpar tudo'; this.clearAll(); return; }
				clearArmed = performance.now(); b.textContent = 'Confirmar?';
				setTimeout( () => { b.textContent = 'Limpar tudo'; }, 3000 );
			}
		};
		for ( const b of el.querySelectorAll( '[data-act]' ) ) b.onclick = () => acts[ b.dataset.act ]( b );
		this.ui.toggle.textContent = 'Pausar edição';
	}

	_status() {
		if ( ! this.ui ) return;
		this.ui.undo.disabled = ! this.undo.length;
		this.ui.redo.disabled = ! this.redo.length;
	}

	_info() {
		if ( ! this.ui ) return;
		const h = this.hit;
		if ( ! h ) { this.ui.info.textContent = this.changed ? 'edições não salvas' : ''; return; }
		const { hf } = this, n = hf.n;
		const i = Math.round( ( h.x - hf.x0 ) / hf.cell ), j = Math.round( ( h.z - hf.z0 ) / hf.cell );
		const dl = this.delta[ Math.min( n - 1, Math.max( 0, j ) ) * n + Math.min( n - 1, Math.max( 0, i ) ) ];
		this.ui.info.textContent = `x ${ h.x.toFixed( 0 ) }  z ${ h.z.toFixed( 0 ) }  altura ${ h.y.toFixed( 1 ) } m\nedição ${ dl >= 0 ? '+' : '' }${ dl.toFixed( 2 ) } m${ this.changed ? '  · não salvo' : '' }`;
		this.ui.info.style.whiteSpace = 'pre';
	}

	_toast( msg ) {
		if ( this.app.hud?.toast ) return this.app.hud.toast( msg );
		console.info( msg );
	}

}
