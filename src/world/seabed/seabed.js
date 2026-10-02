import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { mulberry32, makeSimplex, smoothstep, clamp } from '../../core/noise.js';
import * as Geo from './geometry.js';
import { SeabedBatch } from './batch.js';
import { createSeabedMaterial, SURFACE, packColor } from './materials.js';
import { createNoiseVolume } from './noise3d.js';
import { SEABED } from './config.js';

// Life on the seabed of the cold Atlantic coast around the castro: granite boulders and outcrops
// crusted with pink coralline algae, kelp forests on the rock (Laminaria hyperborea deeper, sugar
// kelp in the shallows), bushy brown algae, sea lettuce and mussel clumps near the surface, rock
// urchins, snakelocks anemones and starfish on the rock, eelgrass meadows, shells and sea
// cucumbers on the sand.
//
// The coast is kilometres long, so nothing is placed up front: the seabed is generated in
// TILE x TILE m tiles around the camera, deterministically (a tile always gets the same
// content), and tiles far behind are dropped. Each loaded tile owns a fixed slot of CAP
// instance records in the batch's storage buffer. Habitat comes from the heightfield: depth,
// slope and a few noise fields (rock patches, meadows, mussel beds).
//
// WHAT goes WHERE (types, palettes, placement layers, habitat fields, seed) is data in config.js;
// this file only interprets it.
//
// Rendering (see batch.js, adapted from Tidewater's reef): one render object and one pipeline,
// one indirect draw per model and level of detail in use. When the camera moves, the instances
// in range and in the view pick a level of detail by distance relative to their size. Only
// active when the camera is under water or low above it.
const TAU = Math.PI * 2;
const CAP = 448; // instance slots per tile
const SOLID_CELL = 4; // m: grid of the rocks for floorAt()
const SLOTS = 64; // loaded tiles
const GEN_PER_FRAME = 3; // tiles generated per frame at most

// Models: procedural geometry at several levels of detail, shared by the types of config.js.
const MODELS = {
	rock: { gen: ( r, l ) => Geo.createMound( r, l, 'rock' ), variants: 2 },
	boulder: { gen: ( r, l ) => Geo.createMound( r, l, 'boulder' ), variants: 2 },
	slab: { gen: ( r, l ) => Geo.createMound( r, l, 'slab' ), variants: 2, lods: 4 },
	kelpForest: { gen: ( r, l ) => Geo.createKelp( r, l, 'forest' ), variants: 3 },
	kelpSugar: { gen: ( r, l ) => Geo.createKelp( r, l, 'sugar' ), variants: 2 },
	ulva: { gen: Geo.createUlva, variants: 2 },
	algae: { gen: Geo.createSargassum, variants: 2 },
	meadow: { gen: Geo.createMeadow, variants: 2 },
	mussels: { gen: Geo.createMussels, variants: 2 },
	urchin: { gen: Geo.createUrchin, variants: 1, lods: 2 },
	anemone: { gen: Geo.createAnemone, variants: 1, lods: 2 },
	star: { gen: Geo.createStarfish, variants: 1, lods: 1 },
	rubble: { gen: Geo.createRubble, variants: 2 },
	cucumber: { gen: Geo.createCucumber, variants: 1, lods: 2 },
};

// palette colour with per-instance variation
const hexColor = ( hex, rng ) => new THREE.Color( hex ).offsetHSL( ( rng() - 0.5 ) * 0.04, ( rng() - 0.5 ) * 0.1, ( rng() - 0.5 ) * 0.1 );

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _up = new THREE.Vector3( 0, 1, 0 );
const _m = new THREE.Matrix4(), _frustum = new THREE.Frustum(), _box = new THREE.Box3();

export class Seabed {

	// hf: HeightField (heightAt, normalAt, slopeAt); sun: DirectionalLight; sunDir: Vector3;
	// config: see config.js
	constructor( { hf, waterLevel = 0, sun, sunDir, swell = new THREE.Vector2( - 1, 0 ), config = SEABED } ) {

		this.hf = hf;
		this.config = config;
		this.W = waterLevel;
		this.sunLight = sun;
		this.group = new THREE.Group();
		this.group.name = 'seabed';
		this.seedNoise();

		this.buildKinds();
		this.batch = new SeabedBatch( 'seabed', this.kinds, { maxInstances: SLOTS * CAP, dynamic: true } );
		this.noise3D = createNoiseVolume();
		this.view = { position: uniform( new THREE.Vector3() ).setName( 'seaCam' ), range: uniform( config.range ).setName( 'seaRange' ) };
		this.sun = { dir: uniform( new THREE.Vector3( 0, 1, 0 ) ).setName( 'seaSunDir' ), color: uniform( new THREE.Color( 1, 1, 1 ) ).setName( 'seaSunCol' ) };
		if ( sunDir ) this.sun.dir.value.copy( sunDir );
		this.material = createSeabedMaterial( { batch: this.batch, noise: this.noise3D, view: this.view, sun: this.sun, waterLevel, swell } );
		this.mesh = this.batch.createMesh( this.material );
		this.group.add( this.mesh );

		// the rocks of the loaded tiles on a SOLID_CELL grid (cell key -> [ rock ]), for floorAt()
		this.solidGrid = new Map();
		this.tiles = new Map(); // key -> tile { ix, iz, slot, n, ymin, ymax, cull arrays } (slot -1: empty)
		this.freeSlots = [];
		for ( let s = SLOTS - 1; s >= 0; s -- ) this.freeSlots.push( s );
		this._cullPos = new THREE.Vector3( Infinity, 0, 0 );
		this._cullQuat = new THREE.Quaternion();
		this._dirty = true;
		this.stats = { tiles: 0, generated: 0, instances: 0 };
		this.updateSun();

	}

	updateSun( sunDir ) {

		if ( sunDir ) this.sun.dir.value.copy( sunDir );
		if ( this.sunLight ) this.sun.color.value.copy( this.sunLight.color ).multiplyScalar( this.sunLight.intensity );

	}

	// ------------------------------------------------------------------ models

	buildKinds() {

		this.kinds = [];
		this.models = {}; // model -> [ { kind0, lods, radius, top } per variant ]
		let seed = 1;
		for ( const [ name, M ] of Object.entries( MODELS ) ) {

			const nl = M.lods ?? 3;
			this.models[ name ] = [];
			for ( let v = 0; v < M.variants; v ++ ) {

				const s = seed ++ * 7919;
				const kind0 = this.kinds.length;
				let geo0 = null;
				for ( let l = 0; l < nl; l ++ ) {

					const g = M.gen( mulberry32( s ), l );
					if ( l === 0 ) geo0 = g;
					this.kinds.push( { geometry: g, type: name, lod: l } );

				}

				geo0.computeBoundingBox();
				const bb = geo0.boundingBox;
				const radius = Math.max( bb.max.x, - bb.min.x, bb.max.z, - bb.min.z, bb.max.y );
				this.models[ name ].push( { kind0, lods: nl, radius, top: bb.max.y } );

			}

		}

	}

	// ------------------------------------------------------------------ habitat

	// noise fields of the habitat, from the seed
	seedNoise() {

		const seed = this.config.seed;
		this.nRock = makeSimplex( seed + 811 );
		this.nPatch = makeSimplex( seed + 812 );
		this.nMeadow = makeSimplex( seed + 813 );
		this._seed = seed;

	}

	// depth below the surface (m), rock share (0 sand .. 1 rock) and patch fields at x, z
	habitat( x, z, out ) {

		const hf = this.hf, H = this.config.habitat, rn = H.rockNoise;
		const g = hf.heightAt( x, z );
		out.ground = g;
		// no sea life in a basin closed off from the sea (a lake dug in the terrain editor: world/koi)
		out.depth = this.exclude?.( x, z ) ? - 1 : this.W - g;
		const slope = hf.slopeAt( x, z );
		const nr = this.nRock( x * rn.freq, z * rn.freq ) * ( 1 - rn.detail ) + this.nRock( x * rn.detailFreq + 31, z * rn.detailFreq ) * rn.detail;
		// rock on steep ground and in rock patches; sand elsewhere
		out.rock = clamp( Math.max( smoothstep( H.rockSlope[ 0 ], H.rockSlope[ 1 ], slope ), smoothstep( rn.range[ 0 ], rn.range[ 1 ], nr ) ), 0, 1 );
		out.slope = slope;
		out.patch = this.nPatch( x * H.patchFreq, z * H.patchFreq ); // clumping of kelp / mussels / algae
		out.meadow = this.nMeadow( x * H.meadowFreq, z * H.meadowFreq ) + this.nMeadow( x * H.meadowDetailFreq + 7, z * H.meadowDetailFreq ) * H.meadowDetail;
		return out;

	}

	// weight of a layer entry (config.js) at a candidate with habitat h
	entryWeight( e, h ) {

		let w = e.weight;
		if ( e.depth ) {

			const [ a, b, c, d ] = e.depth;
			w *= smoothstep( a, b, h.depth ) * ( 1 - smoothstep( c, d, h.depth ) );

		}

		if ( e.rock !== undefined || e.sand !== undefined ) w *= Math.min( 1, h.rock * ( e.rock ?? 0 ) + ( 1 - h.rock ) * ( e.sand ?? 0 ) );
		if ( e.patch ) w *= smoothstep( e.patch[ 0 ], e.patch[ 1 ], h.patch );
		if ( e.meadow ) w *= smoothstep( e.meadow[ 0 ], e.meadow[ 1 ], h.meadow );
		if ( e.slopeMax !== undefined && h.slope > e.slopeMax ) w = 0;
		return w;

	}

	// Rebuilds the seabed around the camera (after a change of this.config: rules, palettes, seed).
	regenerate() {

		if ( this.config.seed !== this._seed ) this.seedNoise();
		for ( const [ key, tile ] of this.tiles ) this.dropTile( key, tile );
		this._dirty = true;

	}

	// ------------------------------------------------------------------ tiles

	generateTile( ix, iz ) {

		const T = this.config.tile;
		const tile = { ix, iz, slot: - 1, n: 0, ymin: Infinity, ymax: - Infinity };
		const x0 = ix * T, z0 = iz * T;
		// dry or too shallow everywhere: nothing to place
		let deepest = - Infinity;
		for ( let j = 0; j <= 4; j ++ ) for ( let i = 0; i <= 4; i ++ ) deepest = Math.max( deepest, this.W - this.hf.heightAt( x0 + i * T / 4, z0 + j * T / 4 ) );
		if ( deepest < 0.3 ) return tile;
		const slot = this.freeSlots.pop();
		if ( slot === undefined ) return null; // no room: try again when tiles are dropped
		tile.slot = slot;
		tile.x = new Float32Array( CAP ); tile.y = new Float32Array( CAP ); tile.z = new Float32Array( CAP );
		tile.r = new Float32Array( CAP ); tile.dmax = new Float32Array( CAP );
		tile.d0 = new Float32Array( CAP ); tile.d1 = new Float32Array( CAP ); tile.d2 = new Float32Array( CAP );
		tile.kind0 = new Uint16Array( CAP ); tile.lods = new Uint8Array( CAP );
		tile.solids = []; // [ x, z, r ] of the rocks, kept clear by the other layers
		const rng = mulberry32( ( Math.imul( ix, 73856093 ) ^ Math.imul( iz, 19349663 ) ^ this.config.seed ) >>> 0 );
		const H = {};

		// the layers of config.js, in order: one candidate per spacing x spacing cell (jittered),
		// which becomes one of the layer's entries in proportion to their weights
		const weights = [];
		for ( const L of this.config.layers ) {

			const n = Math.max( 1, Math.round( T / L.spacing ) ), step = T / n;
			for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

				const x = x0 + ( i + rng() ) * step, z = z0 + ( j + rng() ) * step;
				const r1 = rng(), r2 = rng();
				this.habitat( x, z, H );
				if ( H.depth < 0.25 ) continue;
				let sum = 0;
				for ( let k = 0; k < L.entries.length; k ++ ) sum += weights[ k ] = this.entryWeight( L.entries[ k ], H );
				if ( sum <= 0 || r1 > Math.min( sum, L.cap ?? 1 ) ) continue;
				let t = r2 * sum;
				for ( let k = 0; k < L.entries.length; k ++ ) {

					t -= weights[ k ];
					if ( t <= 0 && weights[ k ] > 0 ) {

						this.place( tile, L.entries[ k ].type, x, z, rng );
						break;

					}

				}

			}

		}

		this.writeTile( tile );
		return tile;

	}

	// settle one instance of type `name` at x, z (false if it doesn't fit)
	place( tile, name, x, z, rng ) {

		if ( tile.n >= CAP ) return false;
		const t = this.config.types[ name ];
		const models = t.model.flatMap( ( m ) => this.models[ m ] );
		const model = models[ Math.floor( rng() * models.length ) ];
		const s0 = t.scale[ 0 ] + ( t.scale[ 1 ] - t.scale[ 0 ] ) * Math.pow( rng(), 1.3 );
		const sxz = t.sxz[ 0 ] + ( t.sxz[ 1 ] - t.sxz[ 0 ] ) * rng();
		const sy = t.sy[ 0 ] + ( t.sy[ 1 ] - t.sy[ 0 ] ) * rng();
		let s = s0;
		const foot = model.radius * s * 0.8;
		// the rocks keep their footprint clear (of other rocks, and of everything else)
		for ( const [ sx, sz, sr ] of tile.solids ) {

			const dx = x - sx, dz = z - sz;
			if ( dx * dx + dz * dz < ( sr + ( t.solid ? foot * 0.6 : 0.1 ) ) ** 2 ) return false;

		}

		const hf = this.hf;
		let base = hf.heightAt( x, z );
		// lowest point of (part of) the footprint so nothing floats on slopes
		const reach = foot * ( 0.6 - 0.45 * t.align );
		for ( let k = 0; k < 5; k ++ ) {

			const a = k * TAU / 5 + 0.3;
			base = Math.min( base, hf.heightAt( x + Math.cos( a ) * reach, z + Math.sin( a ) * reach ) );

		}

		hf.normalAt( x, z, _n );
		_v.copy( _up ).lerp( _n, t.align ).normalize();
		_q.setFromUnitVectors( _up, _v );
		_q2.setFromAxisAngle( _up, rng() * TAU );
		_q.multiply( _q2 );

		// plants and animals stay below the surface: shrink if needed (rocks may break it)
		const top = () => base + model.top * s * sy * _v.y - t.sink * model.top * s * sy;
		const maxTop = this.W + this.config.maxTop;
		if ( ! t.solid && top() > maxTop ) {

			s = Math.min( s, ( maxTop - base ) / Math.max( model.top * sy * ( _v.y - t.sink ), 1e-3 ) );
			if ( s < s0 * 0.45 ) return false;

		}

		const y = base - t.sink * model.top * s * sy;
		const c1 = hexColor( t.c1[ Math.floor( rng() * t.c1.length ) ], rng );
		const c2 = hexColor( t.c2[ Math.floor( rng() * t.c2.length ) ], rng );
		const flex = t.flex ? t.flex * ( 0.8 + rng() * 0.4 ) : - ( t.warp ?? 0 ) * ( 0.6 + rng() * 0.8 );
		const radius = model.radius * s * Math.max( sxz, 1 / sxz, sy );
		const range = Math.max( 1, Math.floor( Math.min( this.config.range + 15, t.lod[ t.lod.length - 1 ] * radius ) ) );
		const seed = Math.min( rng(), 0.999 );

		const i = tile.n ++;
		const d = this.batch.data, o = ( tile.slot * CAP + i ) * 16;
		d[ o ] = x; d[ o + 1 ] = y; d[ o + 2 ] = z; d[ o + 3 ] = s;
		d[ o + 4 ] = _q.x; d[ o + 5 ] = _q.y; d[ o + 6 ] = _q.z; d[ o + 7 ] = _q.w;
		d[ o + 8 ] = packColor( c1 ); d[ o + 9 ] = packColor( c2 ); d[ o + 10 ] = range + seed; d[ o + 11 ] = SURFACE[ t.surface ];
		d[ o + 12 ] = sxz; d[ o + 13 ] = sy; d[ o + 14 ] = 1 / sxz; d[ o + 15 ] = flex;

		const lods = model.lods;
		tile.x[ i ] = x; tile.y[ i ] = y + radius * 0.4; tile.z[ i ] = z; tile.r[ i ] = radius;
		tile.d0[ i ] = lods > 1 ? t.lod[ 0 ] * radius : Infinity;
		tile.d1[ i ] = lods > 2 ? t.lod[ 1 ] * radius : Infinity;
		tile.d2[ i ] = lods > 3 ? t.lod[ 2 ] * radius : Infinity;
		tile.dmax[ i ] = range;
		tile.kind0[ i ] = model.kind0;
		tile.lods[ i ] = lods;
		tile.ymin = Math.min( tile.ymin, y );
		tile.ymax = Math.max( tile.ymax, y + radius * 2 );
		if ( t.solid ) {

			tile.solids.push( [ x, z, foot ] );
			// a dome over the footprint: base y, top at the model's height (tilted by the alignment)
			this.addSolid( tile, { x, z, r: model.radius * s * Math.max( sxz, 1 / sxz ) * 0.92, y0: y, top: y + model.top * s * sy * _v.y } );

		}
		return true;

	}

	writeTile( tile ) {

		if ( tile.slot < 0 ) return;
		// clear the unused records of the slot (a previous tile's instances are never listed, but
		// keep the buffer tidy) and upload the slot
		const d = this.batch.data;
		d.fill( 0, ( tile.slot * CAP + tile.n ) * 16, ( tile.slot + 1 ) * CAP * 16 );
		this.batch.uploadRange( tile.slot * CAP, CAP );
		this.stats.generated ++;

	}

	addSolid( tile, rock ) {

		const c0x = Math.floor( ( rock.x - rock.r ) / SOLID_CELL ), c1x = Math.floor( ( rock.x + rock.r ) / SOLID_CELL );
		const c0z = Math.floor( ( rock.z - rock.r ) / SOLID_CELL ), c1z = Math.floor( ( rock.z + rock.r ) / SOLID_CELL );
		tile.solidCells = tile.solidCells || new Set();
		for ( let cz = c0z; cz <= c1z; cz ++ ) for ( let cx = c0x; cx <= c1x; cx ++ ) {

			const key = cx * 131072 + cz;
			let list = this.solidGrid.get( key );
			if ( ! list ) this.solidGrid.set( key, list = [] );
			list.push( rock );
			tile.solidCells.add( key );

		}

		( tile.rocks = tile.rocks || new Set() ).add( rock );

	}

	// Highest solid surface at x, z: the terrain or the top of a seabed rock of the loaded tiles
	// (each rock is a dome over its footprint). The fish use it to swim over the rocks.
	floorAt( x, z ) {

		let h = this.hf.heightAt( x, z );
		const list = this.solidGrid.get( Math.floor( x / SOLID_CELL ) * 131072 + Math.floor( z / SOLID_CELL ) );
		if ( list ) for ( let i = 0; i < list.length; i ++ ) {

			const r = list[ i ];
			const dx = x - r.x, dz = z - r.z, q = 1 - ( dx * dx + dz * dz ) / ( r.r * r.r );
			if ( q > 0 ) h = Math.max( h, r.y0 + ( r.top - r.y0 ) * Math.sqrt( q ) );

		}

		return h;

	}

	dropTile( key, tile ) {

		if ( tile.solidCells ) for ( const k of tile.solidCells ) {

			const list = this.solidGrid.get( k ).filter( ( r ) => ! tile.rocks.has( r ) );
			if ( list.length ) this.solidGrid.set( k, list ); else this.solidGrid.delete( k );

		}

		if ( tile.slot >= 0 ) this.freeSlots.push( tile.slot );
		this.tiles.delete( key );

	}

	// ------------------------------------------------------------------ runtime

	// Per frame: stream tiles around the camera, cull and pick levels of detail.
	update( camera ) {

		const p = camera.position;
		const above = p.y - this.W;
		const C = this.config, T = C.tile;
		const range = above < 0 ? C.range : C.rangeAbove - above * 1.0;
		if ( range < 4 ) {

			this.mesh.visible = false;
			return;

		}

		// ---- streaming: load the missing tiles in range (nearest first), drop far ones
		const load = range + T;
		const cx = Math.floor( p.x / T ), cz = Math.floor( p.z / T ), R = Math.ceil( load / T );
		for ( const [ key, tile ] of this.tiles ) {

			const dx = Math.max( 0, Math.abs( ( tile.ix + 0.5 ) * T - p.x ) - T / 2 ), dz = Math.max( 0, Math.abs( ( tile.iz + 0.5 ) * T - p.z ) - T / 2 );
			if ( dx * dx + dz * dz > ( load + T * 1.5 ) ** 2 ) {

				this.dropTile( key, tile );
				this._dirty = true;

			}

		}

		const want = [];
		for ( let j = - R; j <= R; j ++ ) for ( let i = - R; i <= R; i ++ ) {

			const ix = cx + i, iz = cz + j, key = ix * 65536 + iz;
			if ( this.tiles.has( key ) ) continue;
			const dx = Math.max( 0, Math.abs( ( ix + 0.5 ) * T - p.x ) - T / 2 ), dz = Math.max( 0, Math.abs( ( iz + 0.5 ) * T - p.z ) - T / 2 );
			const d2 = dx * dx + dz * dz;
			if ( d2 < load * load ) want.push( [ d2, ix, iz, key ] );

		}

		want.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
		for ( let k = 0; k < Math.min( GEN_PER_FRAME, want.length ); k ++ ) {

			const [ , ix, iz, key ] = want[ k ];
			const tile = this.generateTile( ix, iz );
			if ( ! tile ) break;
			this.tiles.set( key, tile );
			this._dirty = true;

		}

		// ---- culling (only when the camera moved or the tiles changed)
		if ( ! this._dirty && p.distanceToSquared( this._cullPos ) < 0.0025 && camera.quaternion.angleTo( this._cullQuat ) < 0.002 && this.view.range.value === range ) {

			this.mesh.visible = this.batch.visibleInstances > 0;
			return;

		}

		this._dirty = false;
		this._cullPos.copy( p );
		this._cullQuat.copy( camera.quaternion );
		camera.updateMatrixWorld();
		_m.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		_frustum.setFromProjectionMatrix( _m, camera.coordinateSystem, camera.reversedDepth );
		this.view.position.value.copy( p );
		this.view.range.value = range;
		const batch = this.batch;
		batch.begin();
		let tiles = 0;
		for ( const tile of this.tiles.values() ) {

			if ( tile.slot < 0 || tile.n === 0 ) continue;
			tiles ++;
			const x0 = tile.ix * T, z0 = tile.iz * T;
			const dx = Math.max( 0, Math.abs( x0 + T / 2 - p.x ) - T / 2 ), dz = Math.max( 0, Math.abs( z0 + T / 2 - p.z ) - T / 2 );
			if ( dx * dx + dz * dz > range * range ) continue;
			_box.min.set( x0 - 3, tile.ymin - 0.5, z0 - 3 );
			_box.max.set( x0 + T + 3, tile.ymax + 0.5, z0 + T + 3 );
			if ( ! _frustum.intersectsBox( _box ) ) continue;
			const base = tile.slot * CAP;
			for ( let i = 0; i < tile.n; i ++ ) {

				const ex = tile.x[ i ] - p.x, ey = tile.y[ i ] - p.y, ez = tile.z[ i ] - p.z;
				const d = Math.sqrt( ex * ex + ey * ey + ez * ez );
				if ( d > Math.min( tile.dmax[ i ], range ) ) continue;
				const lod = Math.min( d < tile.d0[ i ] ? 0 : d < tile.d1[ i ] ? 1 : d < tile.d2[ i ] ? 2 : 3, tile.lods[ i ] - 1 );
				batch.add( tile.kind0[ i ] + lod, base + i );

			}

		}

		batch.commit();
		this.mesh.visible = batch.visibleInstances > 0;
		this.stats.tiles = tiles;
		this.stats.instances = batch.visibleInstances;
		this.stats.triangles = batch.visibleTriangles;
		this.stats.subDraws = batch.mainOffsets.length;

	}

	dispose() {

		this.batch.dispose();
		this.material.dispose();
		this.noise3D.dispose();
		this.group.removeFromParent();

	}

}
