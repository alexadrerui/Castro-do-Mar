import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { mulberry32, makeSimplex, smoothstep, clamp } from '../../core/noise.js';
import * as Geo from './geometry.js';
import { SeabedBatch } from './batch.js';
import { createSeabedMaterial, SURFACE, packColor } from './materials.js';
import { createNoiseVolume } from './noise3d.js';

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
// Rendering (see batch.js, adapted from Tidewater's reef): one render object and one pipeline,
// one indirect draw per model and level of detail in use. When the camera moves, the instances
// in range and in the view pick a level of detail by distance relative to their size. Only
// active when the camera is under water or low above it.
const TAU = Math.PI * 2;
const TILE = 16; // m
const CAP = 448; // instance slots per tile
const SLOTS = 64; // loaded tiles
const RANGE = 45; // underwater draw distance (m): beyond ~40 m the water leaves little contrast
const RANGE_ABOVE = 26; // from just above the water (shrinks with height)
const MAX_TOP = - 0.15; // nothing but rocks rises above this depth (m below the surface)
const GEN_PER_FRAME = 3; // tiles generated per frame at most

// Models: procedural geometry at several levels of detail, shared by the types below.
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

// Types: model, surface, flexibility (sway) or warp, scale (m) and stretch ranges, level-of-detail
// switch distances and the draw distance as multiples of the instance radius, alignment to the
// ground normal (0 upright .. 1 normal), sink (share of the height buried), palettes (sRGB).
const TYPES = {
	boulder: { model: [ 'boulder', 'rock' ], surface: SURFACE.rock, warp: 0.08, scale: [ 0.7, 2.6 ], sy: [ 0.55, 1.0 ], sxz: [ 0.8, 1.25 ], lod: [ 4, 12, 70 ], align: 0.4, sink: 0.3, solid: true,
		c1: [ 0x6f6c66, 0x7a766e, 0x65625c, 0x807b72, 0x726a60 ], c2: [ 0xb87a8a, 0xa87088, 0xc08c96, 0x9a6a80 ] },
	outcrop: { model: [ 'slab' ], surface: SURFACE.rock, warp: 0.05, scale: [ 1.6, 3.8 ], sy: [ 0.4, 0.75 ], sxz: [ 0.75, 1.3 ], lod: [ 1.5, 4, 10, 60 ], align: 0.75, sink: 0.25, solid: true,
		c1: [ 0x6a6760, 0x747068, 0x5f5c56 ], c2: [ 0xb07888, 0xa8708a, 0xbc8a94 ] },
	kelpForest: { model: [ 'kelpForest' ], surface: SURFACE.kelp, flex: 0.55, scale: [ 1.0, 2.2 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 6, 16, 60 ], align: 0.15, sink: 0,
		c1: [ 0x6b4e22, 0x7a5a26, 0x5e4620, 0x80602a ], c2: [ 0x8a3a3a, 0x7a3444, 0x96504a ] },
	kelpSugar: { model: [ 'kelpSugar' ], surface: SURFACE.kelp, flex: 0.9, scale: [ 0.8, 1.6 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 6, 16, 60 ], align: 0.2, sink: 0,
		c1: [ 0x7a6428, 0x8a6e2c, 0x6e5a24 ], c2: [ 0x5a4a22 ] },
	ulva: { model: [ 'ulva' ], surface: SURFACE.ulva, flex: 0.5, scale: [ 0.6, 1.3 ], sy: [ 0.8, 1.2 ], sxz: [ 0.85, 1.15 ], lod: [ 5, 15, 70 ], align: 0.6, sink: 0,
		c1: [ 0x4f8a2e, 0x5a9a34, 0x468028 ], c2: [ 0x9ac070 ] },
	algae: { model: [ 'algae' ], surface: SURFACE.algae, flex: 0.9, scale: [ 0.7, 1.5 ], sy: [ 0.8, 1.3 ], sxz: [ 0.85, 1.15 ], lod: [ 5, 16, 70 ], align: 0.2, sink: 0,
		c1: [ 0x6a5a26, 0x7a6428, 0x5e5020, 0x806a2c ], c2: [ 0x4a4020 ] },
	meadow: { model: [ 'meadow' ], surface: SURFACE.grass, flex: 0.8, scale: [ 1.0, 1.4 ], sy: [ 1.3, 2.2 ], sxz: [ 0.9, 1.1 ], lod: [ 2.5, 7, 40 ], align: 0.5, sink: 0,
		c1: [ 0x3e5a26, 0x46622a, 0x3a5222, 0x4a6a2e ], c2: [ 0x6a7a3a ] },
	mussels: { model: [ 'mussels' ], surface: SURFACE.mussel, warp: 0, scale: [ 0.7, 1.5 ], sy: [ 0.9, 1.2 ], sxz: [ 0.85, 1.15 ], lod: [ 6, 18, 80 ], align: 0.8, sink: 0.05,
		c1: [ 0x1e2230, 0x242636, 0x1a1c26 ], c2: [ 0x5a4a32 ] },
	urchin: { model: [ 'urchin' ], surface: SURFACE.urchin, scale: [ 0.8, 1.3 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 15, 180 ], align: 0.9, sink: 0,
		c1: [ 0x2a1e2a ], c2: [ 0x4a2a52, 0x3e3a26, 0x5a3048, 0x3a2e3e ] },
	anemone: { model: [ 'anemone' ], surface: SURFACE.anemone, flex: 0.35, scale: [ 0.6, 1.2 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 10, 120 ], align: 0.8, sink: 0,
		c1: [ 0x6a8a4a, 0x5a7a3e, 0x7a8e56 ], c2: [ 0x9a4a8a, 0x8a5a9a ] },
	star: { model: [ 'star' ], surface: SURFACE.star, scale: [ 0.7, 1.3 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 150 ], align: 1.0, sink: 0,
		c1: [ 0xc0602a, 0xb85a30, 0x8a4a6a, 0xc87a3a ], c2: [ 0xe0c0a0 ] },
	rubble: { model: [ 'rubble' ], surface: SURFACE.rubble, scale: [ 0.7, 1.4 ], sy: [ 0.9, 1.1 ], sxz: [ 0.8, 1.2 ], lod: [ 8, 20, 80 ], align: 1.0, sink: 0.02,
		c1: [ 0x6a665e, 0x77716a, 0x5e5a52 ], c2: [ 0x6a665e ] },
	cucumber: { model: [ 'cucumber' ], surface: SURFACE.cucumber, scale: [ 0.8, 1.3 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 15, 150 ], align: 1.0, sink: 0,
		c1: [ 0x3a2a1e, 0x4a3424, 0x2e2420 ], c2: [ 0x2a1e18 ] },
};

// palette colour with per-instance variation
const hexColor = ( hex, rng ) => new THREE.Color( hex ).offsetHSL( ( rng() - 0.5 ) * 0.04, ( rng() - 0.5 ) * 0.1, ( rng() - 0.5 ) * 0.1 );

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _up = new THREE.Vector3( 0, 1, 0 );
const _m = new THREE.Matrix4(), _frustum = new THREE.Frustum(), _box = new THREE.Box3();

export class Seabed {

	// hf: HeightField (heightAt, normalAt, slopeAt); sun: DirectionalLight; sunDir: Vector3
	constructor( { hf, waterLevel = 0, sun, sunDir, swell = new THREE.Vector2( - 1, 0 ) } ) {

		this.hf = hf;
		this.W = waterLevel;
		this.sunLight = sun;
		this.group = new THREE.Group();
		this.group.name = 'seabed';
		this.nRock = makeSimplex( 811 );
		this.nPatch = makeSimplex( 812 );
		this.nMeadow = makeSimplex( 813 );

		this.buildKinds();
		this.batch = new SeabedBatch( 'seabed', this.kinds, { maxInstances: SLOTS * CAP, dynamic: true } );
		this.noise3D = createNoiseVolume();
		this.view = { position: uniform( new THREE.Vector3() ).setName( 'seaCam' ), range: uniform( RANGE ).setName( 'seaRange' ) };
		this.sun = { dir: uniform( new THREE.Vector3( 0, 1, 0 ) ).setName( 'seaSunDir' ), color: uniform( new THREE.Color( 1, 1, 1 ) ).setName( 'seaSunCol' ) };
		if ( sunDir ) this.sun.dir.value.copy( sunDir );
		this.material = createSeabedMaterial( { batch: this.batch, noise: this.noise3D, view: this.view, sun: this.sun, waterLevel, swell } );
		this.mesh = this.batch.createMesh( this.material );
		this.group.add( this.mesh );

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

	// depth below the surface (m), rock share (0 sand .. 1 rock) and patch fields at x, z
	habitat( x, z, out ) {

		const hf = this.hf;
		const g = hf.heightAt( x, z );
		out.ground = g;
		out.depth = this.W - g;
		const slope = hf.slopeAt( x, z );
		const nr = this.nRock( x * 0.035, z * 0.035 ) * 0.7 + this.nRock( x * 0.11 + 31, z * 0.11 ) * 0.3;
		// rock on steep ground, in rock patches, and along the rocky shallows below cliffs
		out.rock = clamp( Math.max( smoothstep( 0.22, 0.5, slope ), smoothstep( 0.12, 0.42, nr ) ), 0, 1 );
		out.slope = slope;
		out.patch = this.nPatch( x * 0.09, z * 0.09 ); // clumping of kelp / mussels / algae
		out.meadow = this.nMeadow( x * 0.045, z * 0.045 ) + this.nMeadow( x * 0.15 + 7, z * 0.15 ) * 0.35;
		return out;

	}

	// ------------------------------------------------------------------ tiles

	generateTile( ix, iz ) {

		const tile = { ix, iz, slot: - 1, n: 0, ymin: Infinity, ymax: - Infinity };
		const x0 = ix * TILE, z0 = iz * TILE;
		// dry or too shallow everywhere: nothing to place
		let deepest = - Infinity;
		for ( let j = 0; j <= 4; j ++ ) for ( let i = 0; i <= 4; i ++ ) deepest = Math.max( deepest, this.W - this.hf.heightAt( x0 + i * TILE / 4, z0 + j * TILE / 4 ) );
		if ( deepest < 0.3 ) return tile;
		const slot = this.freeSlots.pop();
		if ( slot === undefined ) return null; // no room: try again when tiles are dropped
		tile.slot = slot;
		tile.x = new Float32Array( CAP ); tile.y = new Float32Array( CAP ); tile.z = new Float32Array( CAP );
		tile.r = new Float32Array( CAP ); tile.dmax = new Float32Array( CAP );
		tile.d0 = new Float32Array( CAP ); tile.d1 = new Float32Array( CAP ); tile.d2 = new Float32Array( CAP );
		tile.kind0 = new Uint16Array( CAP ); tile.lods = new Uint8Array( CAP );
		tile.solids = []; // [ x, z, r ] of the rocks, kept clear by the other layers
		const rng = mulberry32( ( Math.imul( ix, 73856093 ) ^ Math.imul( iz, 19349663 ) ^ 0x5eab ) >>> 0 );
		const H = {};

		// jittered grid layers
		const layer = ( spacing, pick ) => {

			const n = Math.round( TILE / spacing );
			for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

				const x = x0 + ( i + rng() ) * spacing, z = z0 + ( j + rng() ) * spacing;
				const r1 = rng(), r2 = rng();
				this.habitat( x, z, H );
				if ( H.depth < 0.25 ) continue;
				const name = pick( H, r1, r2 );
				if ( name ) this.place( tile, name, x, z, rng );

			}

		};

		// granite: boulders and flat outcrops
		layer( 3.2, ( h, a, b ) => {

			if ( a > h.rock * 0.5 ) return null;
			return b < 0.3 && h.slope < 0.35 ? 'outcrop' : 'boulder';

		} );
		// kelp forest on the rock: Laminaria deeper, sugar kelp in the shallows
		layer( 0.8, ( h, a, b ) => {

			const forest = smoothstep( 1.8, 3.5, h.depth ) * smoothstep( 16, 10, h.depth );
			const sugar = smoothstep( 0.7, 1.4, h.depth ) * smoothstep( 9, 5, h.depth );
			const p = Math.min( 1, h.rock * 1.4 ) * Math.max( forest, sugar ) * smoothstep( - 0.7, - 0.1, h.patch ) * 0.9;
			if ( a > p ) return null;
			return b * ( forest + sugar ) < forest ? 'kelpForest' : 'kelpSugar';

		} );
		// eelgrass meadows on the sand
		layer( 1.7, ( h, a ) => {

			const p = ( 1 - h.rock ) * smoothstep( 0.8, 1.5, h.depth ) * smoothstep( 8, 5, h.depth ) * smoothstep( 0.05, 0.3, h.meadow );
			return a < p ? 'meadow' : null;

		} );
		// small life, algae and debris
		layer( 0.75, ( h, a, b ) => {

			const d = h.depth, rock = h.rock, sand = 1 - rock;
			const w = {
				ulva: 0.35 * smoothstep( 0.3, 0.8, d ) * smoothstep( 5, 2.5, d ) * ( 0.4 + rock ),
				algae: 0.45 * rock * smoothstep( 0.4, 1, d ) * smoothstep( 7, 3.5, d ) * smoothstep( - 0.3, 0.3, h.patch ),
				mussels: 0.6 * rock * smoothstep( 0.3, 0.6, d ) * smoothstep( 3.5, 1.5, d ) * smoothstep( 0.2, 0.45, - h.patch ),
				urchin: 0.12 * rock * smoothstep( 0.8, 1.5, d ),
				anemone: 0.07 * rock * smoothstep( 0.5, 1, d ),
				star: 0.03 * smoothstep( 0.6, 1.2, d ),
				rubble: 0.12 * sand * smoothstep( 0.4, 1, d ),
				cucumber: 0.03 * sand * smoothstep( 2.5, 4, d ),
			};
			let sum = 0;
			for ( const k in w ) sum += w[ k ];
			if ( a > Math.min( sum, 0.9 ) ) return null;
			let t = b * sum;
			for ( const k in w ) {

				t -= w[ k ];
				if ( t <= 0 ) return k;

			}

			return null;

		} );

		this.writeTile( tile );
		return tile;

	}

	// settle one instance of type `name` at x, z (false if it doesn't fit)
	place( tile, name, x, z, rng ) {

		if ( tile.n >= CAP ) return false;
		const t = TYPES[ name ];
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
		if ( ! t.solid && top() > this.W + MAX_TOP ) {

			s = Math.min( s, ( this.W + MAX_TOP - base ) / Math.max( model.top * sy * ( _v.y - t.sink ), 1e-3 ) );
			if ( s < s0 * 0.45 ) return false;

		}

		const y = base - t.sink * model.top * s * sy;
		const c1 = hexColor( t.c1[ Math.floor( rng() * t.c1.length ) ], rng );
		const c2 = hexColor( t.c2[ Math.floor( rng() * t.c2.length ) ], rng );
		const flex = t.flex ? t.flex * ( 0.8 + rng() * 0.4 ) : - ( t.warp ?? 0 ) * ( 0.6 + rng() * 0.8 );
		const radius = model.radius * s * Math.max( sxz, 1 / sxz, sy );
		const range = Math.max( 1, Math.floor( Math.min( RANGE + 15, t.lod[ t.lod.length - 1 ] * radius ) ) );
		const seed = Math.min( rng(), 0.999 );

		const i = tile.n ++;
		const d = this.batch.data, o = ( tile.slot * CAP + i ) * 16;
		d[ o ] = x; d[ o + 1 ] = y; d[ o + 2 ] = z; d[ o + 3 ] = s;
		d[ o + 4 ] = _q.x; d[ o + 5 ] = _q.y; d[ o + 6 ] = _q.z; d[ o + 7 ] = _q.w;
		d[ o + 8 ] = packColor( c1 ); d[ o + 9 ] = packColor( c2 ); d[ o + 10 ] = range + seed; d[ o + 11 ] = t.surface;
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
		if ( t.solid ) tile.solids.push( [ x, z, foot ] );
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

	dropTile( key, tile ) {

		if ( tile.slot >= 0 ) this.freeSlots.push( tile.slot );
		this.tiles.delete( key );

	}

	// ------------------------------------------------------------------ runtime

	// Per frame: stream tiles around the camera, cull and pick levels of detail.
	update( camera ) {

		const p = camera.position;
		const above = p.y - this.W;
		const range = above < 0 ? RANGE : RANGE_ABOVE - above * 1.0;
		if ( range < 4 ) {

			this.mesh.visible = false;
			return;

		}

		// ---- streaming: load the missing tiles in range (nearest first), drop far ones
		const load = range + TILE;
		const cx = Math.floor( p.x / TILE ), cz = Math.floor( p.z / TILE ), R = Math.ceil( load / TILE );
		for ( const [ key, tile ] of this.tiles ) {

			const dx = Math.max( 0, Math.abs( ( tile.ix + 0.5 ) * TILE - p.x ) - TILE / 2 ), dz = Math.max( 0, Math.abs( ( tile.iz + 0.5 ) * TILE - p.z ) - TILE / 2 );
			if ( dx * dx + dz * dz > ( load + TILE * 1.5 ) ** 2 ) {

				this.dropTile( key, tile );
				this._dirty = true;

			}

		}

		const want = [];
		for ( let j = - R; j <= R; j ++ ) for ( let i = - R; i <= R; i ++ ) {

			const ix = cx + i, iz = cz + j, key = ix * 65536 + iz;
			if ( this.tiles.has( key ) ) continue;
			const dx = Math.max( 0, Math.abs( ( ix + 0.5 ) * TILE - p.x ) - TILE / 2 ), dz = Math.max( 0, Math.abs( ( iz + 0.5 ) * TILE - p.z ) - TILE / 2 );
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
			const x0 = tile.ix * TILE, z0 = tile.iz * TILE;
			const dx = Math.max( 0, Math.abs( x0 + TILE / 2 - p.x ) - TILE / 2 ), dz = Math.max( 0, Math.abs( z0 + TILE / 2 - p.z ) - TILE / 2 );
			if ( dx * dx + dz * dz > range * range ) continue;
			_box.min.set( x0 - 3, tile.ymin - 0.5, z0 - 3 );
			_box.max.set( x0 + TILE + 3, tile.ymax + 0.5, z0 + TILE + 3 );
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
