// Tree builders ported from Tidewater (https://github.com/dgreenheck/tidewater,
// src/world/vegetation/PlantGeometry.js, three.js version at d32799f). MIT License,
// Copyright (c) 2026 DRG Software Solutions LLC.
// Changes: the vertices are written in this project's foliage layout (color, aux = leaf / sway /
// ao / card, uv into the leaf-cluster atlas of leafAtlas.js) instead of Tidewater's aVeg / aMat /
// aLobe; the rainforest tree is reshaped as a Galician oak (short flared trunk, broad crown);
// no per-instance lobe variants (the crowns vary by seed, rotation and scale instead); the shrub
// takes the narrow-leaf tile (gorse / broom) and the fern is reshaped as bracken.
import * as THREE from 'three/webgpu';
import { TreeGenerator } from 'three/addons/generators/TreeGenerator.js';
import { mulberry32 } from '../core/noise.js';
import { tileUV } from './leafAtlas.js';

const _up = new THREE.Vector3( 0, 1, 0 );
const smooth = ( a, b, x ) => {
	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );
};

// Accumulates vertices in the foliage layout (see plants.js finalize).
class Builder {
	constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.aux = []; this.idx = []; }
	get count() { return this.pos.length / 3; }
	vertex( p, n, u, v, col, leaf, sway, ao, card ) {
		this.pos.push( p.x, p.y, p.z ); this.nor.push( n.x, n.y, n.z ); this.uv.push( u, v );
		this.col.push( col.r, col.g, col.b ); this.aux.push( leaf, sway, ao, card );
		return this.count - 1;
	}
	quad( a, b, c, d ) { this.idx.push( a, b, c, a, c, d ); }
	// an indexed geometry (position, normal) as bark: every vertex through fn( p, n ) -> [ sway, ao ]
	wood( geo, bark, fn ) {
		const p = geo.attributes.position, n = geo.attributes.normal, base = this.count;
		const P = new THREE.Vector3(), N = new THREE.Vector3();
		for ( let i = 0; i < p.count; i ++ ) {
			P.fromBufferAttribute( p, i ); N.fromBufferAttribute( n, i );
			const [ sway, ao ] = fn( P );
			this.vertex( P, N, 0, 0, bark, 0, sway, ao, 0 );
		}
		for ( const k of geo.index.array ) this.idx.push( base + k );
	}
	build() {
		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'normal', new THREE.Float32BufferAttribute( this.nor, 3 ) );
		g.setAttribute( 'uv', new THREE.Float32BufferAttribute( this.uv, 2 ) );
		g.setAttribute( 'color', new THREE.Float32BufferAttribute( this.col, 3 ) );
		g.setAttribute( 'aux', new THREE.Float32BufferAttribute( this.aux, 4 ) );
		g.setIndex( this.idx );
		g.computeBoundingSphere();
		return g;
	}
}

// bark: occlusion darker at the foot and inside the crown
const barkAO = ( p, H ) => 0.45 + 0.35 * smooth( 0, H * 0.6, p.y );

// bark: a colour, or fn( p, f, side ) -> colour (f along the tube, side = index around it)
const barkAt = ( bark, p, f, side ) => ( typeof bark === 'function' ? bark( p, f, side ) : bark );

// Straight tapered tube p0 -> p1; radiusFn( f, angle, centre ) overrides the taper.
function addBranch( b, p0, p1, r0, r1, radial, rows, bark, H, flexFn, radiusFn = null ) {
	const dir = new THREE.Vector3().subVectors( p1, p0 );
	const len = dir.length();
	dir.normalize();
	const tmp = Math.abs( dir.y ) < 0.9 ? _up : new THREE.Vector3( 1, 0, 0 );
	const X = new THREE.Vector3().crossVectors( dir, tmp ).normalize();
	const Z = new THREE.Vector3().crossVectors( X, dir ).normalize();
	const start = b.count;
	for ( let j = 0; j <= rows; j ++ ) {
		const f = j / rows;
		const c = new THREE.Vector3().copy( p0 ).addScaledVector( dir, len * f );
		for ( let i = 0; i <= radial; i ++ ) {
			const a = ( i / radial ) * Math.PI * 2;
			const r = radiusFn ? radiusFn( f, a, c ) : r0 + ( r1 - r0 ) * f;
			const n = new THREE.Vector3().copy( X ).multiplyScalar( Math.cos( a ) ).addScaledVector( Z, Math.sin( a ) );
			const p = c.clone().addScaledVector( n, r );
			b.vertex( p, n, 0, 0, barkAt( bark, p, f, i % radial ), 0, flexFn( p ) * 0.5, barkAO( p, H ), 0 );
		}
	}
	for ( let j = 0; j < rows; j ++ ) for ( let i = 0; i < radial; i ++ ) {
		const a = start + j * ( radial + 1 ) + i, c = a + radial + 1;
		b.quad( a, c, c + 1, a + 1 );
	}
}

// Curved limb: tapered tube along a quadratic Bezier p0 -> ctrl -> p1 (rotation-minimised frames).
function addLimb( b, p0, ctrl, p1, r0, r1, radial, rows, bark, H, flexFn ) {
	const start = b.count;
	const pt = ( t ) => new THREE.Vector3().copy( p0 ).multiplyScalar( ( 1 - t ) * ( 1 - t ) ).addScaledVector( ctrl, 2 * ( 1 - t ) * t ).addScaledVector( p1, t * t );
	const tan = ( t ) => new THREE.Vector3().subVectors( ctrl, p0 ).multiplyScalar( 2 * ( 1 - t ) ).addScaledVector( new THREE.Vector3().subVectors( p1, ctrl ), 2 * t ).normalize();
	let T = tan( 0 );
	const X = new THREE.Vector3().crossVectors( T, Math.abs( T.y ) < 0.9 ? _up : new THREE.Vector3( 1, 0, 0 ) ).normalize();
	for ( let j = 0; j <= rows; j ++ ) {
		const f = j / rows;
		const c = pt( f );
		const Tn = tan( f );
		X.addScaledVector( Tn, - X.dot( Tn ) ).normalize();
		T = Tn;
		const Z = new THREE.Vector3().crossVectors( X, T ).normalize();
		const r = r0 + ( r1 - r0 ) * Math.pow( f, 0.8 );
		for ( let i = 0; i <= radial; i ++ ) {
			const a = ( i / radial ) * Math.PI * 2;
			const n = new THREE.Vector3().copy( X ).multiplyScalar( Math.cos( a ) ).addScaledVector( Z, Math.sin( a ) );
			const p = c.clone().addScaledVector( n, r );
			b.vertex( p, n, 0, 0, barkAt( bark, p, f, i % radial ), 0, flexFn( p ) * 0.5, barkAO( p, H ), 0 );
		}
	}
	for ( let j = 0; j < rows; j ++ ) for ( let i = 0; i < radial; i ++ ) {
		const a = start + j * ( radial + 1 ) + i, c = a + radial + 1;
		b.quad( a, c, c + 1, a + 1 );
	}
}

const WHITE = new THREE.Color( 1, 1, 1 );

// Leaf-cluster card: a quad facing `normal`, rotated by `yaw` around it. Vertex normals blend the
// clump (or lobe) sphere and the whole crown (volumetric shading); ao = exposure (inner leaves
// and the inside of the crown darker).
function addCard( b, { center, size, normal, yaw, lobeC, lobeR, crownC, crownR, flexFn, tile, clumpC = null, clumpR = 1 } ) {
	const n = normal.clone().normalize();
	const tmp = Math.abs( n.y ) < 0.95 ? _up : new THREE.Vector3( 1, 0, 0 );
	const X = new THREE.Vector3().crossVectors( tmp, n ).normalize();
	const Y = new THREE.Vector3().crossVectors( n, X ).normalize();
	const cy = Math.cos( yaw ), sy = Math.sin( yaw );
	const Xr = X.clone().multiplyScalar( cy ).addScaledVector( Y, sy );
	const Yr = Y.clone().multiplyScalar( cy ).addScaledVector( X, - sy );
	const ids = [];
	for ( const [ x, y, u, v ] of [ [ - 0.5, - 0.5, 0, 0 ], [ 0.5, - 0.5, 1, 0 ], [ 0.5, 0.5, 1, 1 ], [ - 0.5, 0.5, 0, 1 ] ] ) {
		const p = center.clone().addScaledVector( Xr, x * size ).addScaledVector( Yr, y * size );
		const dl = clumpC ? p.clone().sub( clumpC ).divideScalar( clumpR ) : p.clone().sub( lobeC ).divideScalar( lobeR );
		const dc = p.clone().sub( crownC ).divide( crownR );
		const nn = dl.clone().normalize().multiplyScalar( 0.5 ).addScaledVector( dc.clone().normalize(), 0.4 ).addScaledVector( n, 0.2 ).normalize();
		const ext = Math.min( 1, 0.5 * Math.min( 1, dl.length() ) + 0.4 * Math.min( 1, dc.length() ) + 0.25 * Math.max( 0, dc.y ) );
		const [ tu, tv ] = tileUV( tile, u, v );
		ids.push( b.vertex( p, nn, tu, tv, WHITE, 1, flexFn( p ), 0.25 + 0.75 * ext * ext, 1 ) );
	}
	b.quad( ids[ 0 ], ids[ 1 ], ids[ 2 ], ids[ 3 ] );
}

// Leaf clumps at the branch tips of a lobe: a few crossing cards around each clump centre, clumps
// of different sizes and depths with real gaps between them (sky and branches show through).
function clumpCards( lobe, { clumps, clumpR, cardsPer, size, crownC, crownR, rand, flexFn, tile, flatten = 0.7 } ) {
	const lobeC = new THREE.Vector3( lobe[ 0 ], lobe[ 1 ], lobe[ 2 ] );
	const R = lobe[ 3 ];
	const cards = [], tips = [];
	for ( let k = 0; k < clumps; k ++ ) {
		let x, y, z;
		do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; } while ( x * x + y * y + z * z > 1 || y < - 0.55 );
		const l = Math.hypot( x, y, z ) || 1;
		const reach = 0.3 + 0.7 * Math.sqrt( rand() );
		const c = new THREE.Vector3( x / l, y / l * flatten, z / l ).multiplyScalar( reach * R * 0.85 ).add( lobeC );
		const rc = clumpR * ( 0.65 + rand() * 0.7 );
		tips.push( { c, rc } );
		const out = c.clone().sub( lobeC ).normalize();
		for ( let j = 0; j < cardsPer; j ++ ) {
			const dir = new THREE.Vector3( rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1 ).normalize().addScaledVector( out, 0.9 ).addScaledVector( _up, 0.55 ).normalize();
			const center = c.clone().addScaledVector( dir, rc * ( 0.1 + 0.3 * rand() ) )
				.add( new THREE.Vector3( rand() - 0.5, ( rand() - 0.5 ) * 0.6, rand() - 0.5 ).multiplyScalar( rc * 0.5 ) );
			cards.push( { center, size: size * rc / clumpR * ( 0.8 + rand() * 0.4 ), normal: dir, yaw: rand() * 6.283, lobeC, lobeR: R, crownC, crownR, flexFn, tile, clumpC: c, clumpR: rc } );
		}
	}
	return { cards, tips };
}

// outermost cards first: near cards draw first (early depth test)
function emitCards( b, cards, crownC ) {
	cards.sort( ( a, c ) => c.center.distanceToSquared( crownC ) - a.center.distanceToSquared( crownC ) );
	for ( const card of cards ) addCard( b, card );
}

// ---------------------------------------------------------------------------
// Galician oak (carballo): a short trunk flaring at the foot, forking low into limbs that rise
// and spread into a broad crown of leaf lobes; ~9 m tall at scale 1.
// lod 1: the same tree with fewer, larger clumps and no twigs (far tiles and the reflection).
// ---------------------------------------------------------------------------
const OAK_LOBES = [ // [ x, y, z, radius ] (Tidewater's crown, widened)
	[ 0.4, 9.6, - 0.3, 2.9 ], [ - 2.3, 8.2, 1.8, 2.7 ], [ 3.3, 7.6, 1.3, 2.5 ], [ 1.9, 6.9, - 3.3, 2.6 ],
	[ - 3.5, 6.5, - 2.0, 2.4 ], [ 0.4, 5.9, 3.7, 2.3 ], [ - 1.2, 10.8, - 1.8, 1.9 ], [ 4.0, 5.6, - 1.0, 2.0 ]
];
const OAK_FORK = [ 0.15, 3.2, - 0.05 ];
export const OAK_BARK = new THREE.Color( 0x4d4034 );
const OAK_SCALE = 0.72; // built at Tidewater's size (~12.5 m), placed ~9 m tall

export function oakTree( lod = 0, seed = 21 ) {
	const rand = mulberry32( seed );
	const b = new Builder();
	const H = 12.5;
	const crownC = new THREE.Vector3( 0, 7.6, 0 );
	const crownR = new THREE.Vector3( 5.6, 3.6, 5.6 );
	const flex = ( p ) => Math.min( 1, Math.hypot( p.x, p.z ) / 5 ) * smooth( 3.0, 6.5, p.y );
	const fork = new THREE.Vector3( ...OAK_FORK );
	// per seed: lobes nudged and resized, so the crowns differ
	const lobes = OAK_LOBES.map( ( L ) => [ L[ 0 ] + ( rand() - 0.5 ) * 0.8, L[ 1 ] + ( rand() - 0.5 ) * 0.6, L[ 2 ] + ( rand() - 0.5 ) * 0.8, L[ 3 ] * ( 0.85 + rand() * 0.3 ) ] );

	// trunk: a gentle flare at the foot (root buttresses, much smaller than Tidewater's)
	const trunkR = ( f, a, c ) => {
		const r = 0.4 - 0.12 * f;
		const fin = Math.pow( Math.max( 0, Math.cos( 5 * a + 0.4 ) ), 4 ) * Math.exp( - Math.max( c.y, 0 ) / 0.6 );
		return r * ( 1 + 0.3 * fin + 0.3 * Math.exp( - Math.max( c.y + 0.3, 0 ) / 0.5 ) );
	};
	addBranch( b, new THREE.Vector3( 0, - 0.5, 0 ), fork, 0.4, 0.28, lod ? 6 : 10, lod ? 3 : 7, OAK_BARK, H, flex, trunkR );

	// limbs to the lobes (the first five from the fork, the rest from the middle of a limb)
	const mids = [];
	lobes.forEach( ( L, i ) => {
		const lc = new THREE.Vector3( L[ 0 ], L[ 1 ], L[ 2 ] );
		const end = lc.clone().addScaledVector( lc.clone().sub( crownC ).setY( 0 ).normalize(), - L[ 3 ] * 0.2 ).setY( L[ 1 ] - L[ 3 ] * 0.25 );
		const bow = ( a, e, k ) => {
			const mid = a.clone().lerp( e, 0.5 );
			const d = e.clone().sub( a );
			const horiz = new THREE.Vector3( d.x, 0, d.z );
			// oak limbs spread wider and more crooked than the rainforest tree's vase
			return mid.addScaledVector( horiz, - 0.12 * k ).add( new THREE.Vector3( 0, d.length() * 0.1 * k, 0 ) )
				.add( new THREE.Vector3( ( rand() - 0.5 ) * 0.7, ( rand() - 0.5 ) * 0.4, ( rand() - 0.5 ) * 0.7 ).multiplyScalar( d.length() * 0.3 ) );
		};
		if ( i < 5 ) {
			const start = fork.clone().add( new THREE.Vector3( ( rand() - 0.5 ) * 0.25, - 0.2 - rand() * 0.3, ( rand() - 0.5 ) * 0.25 ) );
			const ctrl = bow( start, end, 1 );
			addLimb( b, start, ctrl, end, 0.2, 0.05, lod ? 4 : 6, lod ? 3 : 5, OAK_BARK, H, flex );
			mids.push( start.clone().multiplyScalar( 0.25 ).addScaledVector( ctrl, 0.5 ).addScaledVector( end, 0.25 ) );
		} else {
			let best = mids[ 0 ];
			for ( const m of mids ) if ( m.distanceTo( lc ) < best.distanceTo( lc ) ) best = m;
			addLimb( b, best, bow( best, end, 0.6 ), end, 0.09, 0.03, lod ? 3 : 4, lod ? 2 : 3, OAK_BARK, H, flex );
		}
	} );

	const cards = [];
	lobes.forEach( ( L, i ) => {
		const { cards: cs, tips } = clumpCards( L, {
			clumps: Math.round( ( lod ? 3.2 : 5.5 ) * L[ 3 ] ), clumpR: lod ? 1.1 : 0.85, cardsPer: lod ? 3 : 4, size: lod ? 2.7 : 1.8,
			crownC, crownR, rand, flexFn: flex, tile: 0, flatten: 0.72
		} );
		cards.push( ...cs );
		// short twigs carrying the clumps of the two biggest lobes
		if ( lod === 0 && i < 2 ) {
			const base = new THREE.Vector3( L[ 0 ], L[ 1 ] - L[ 3 ] * 0.3, L[ 2 ] );
			for ( const t of tips ) {
				const from = base.clone().lerp( t.c, 0.4 + rand() * 0.25 ).add( new THREE.Vector3( rand() - 0.5, ( rand() - 0.5 ) * 0.4, rand() - 0.5 ).multiplyScalar( 0.5 ) );
				addBranch( b, from, from.clone().lerp( t.c, 0.7 ), 0.035, 0.014, 3, 1, OAK_BARK, H, flex );
			}
		}
	} );
	emitCards( b, cards, crownC );

	const g = b.build();
	g.scale( OAK_SCALE, OAK_SCALE, OAK_SCALE );
	g.computeBoundingSphere();
	return g;
}

// fills a lobe with leaf cards, biased towards its shell (the lobe reads as a volume, with gaps)
function lobeCards( lobe, { count, size, crownC, crownR, rand, flexFn, tile, flatten = 0.6 } ) {
	const lobeC = new THREE.Vector3( lobe[ 0 ], lobe[ 1 ], lobe[ 2 ] );
	const R = lobe[ 3 ];
	const cards = [];
	for ( let k = 0; k < count; k ++ ) {
		let x, y, z;
		do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; } while ( x * x + y * y + z * z > 1 || y < - 0.75 );
		const l = Math.hypot( x, y, z ) || 1;
		const shell = 0.45 + 0.55 * Math.sqrt( l );
		const c = new THREE.Vector3( x / l * shell * R * 0.85, y / l * shell * R * 0.85 * flatten, z / l * shell * R * 0.85 ).add( lobeC );
		const normal = c.clone().sub( lobeC ).normalize().lerp( _up, 0.35 + rand() * 0.35 ).normalize();
		cards.push( { center: c, size: size * ( 0.8 + rand() * 0.45 ), normal, yaw: rand() * 6.283, lobeC, lobeR: R, crownC, crownR, flexFn, tile } );
	}
	return cards;
}

// ---------------------------------------------------------------------------
// Shrub (gorse / broom, tojo / xesta): a few leafy lobes on short stems, narrow leaves (atlas tile
// 3). Tidewater's buildShrubNear; ~1.6 m tall at scale 1.
// ---------------------------------------------------------------------------
const SHRUB_LOBES = [
	[ 0.0, 0.85, 0.0, 0.8 ], [ 0.75, 0.6, 0.35, 0.6 ], [ - 0.6, 0.55, 0.55, 0.6 ], [ - 0.25, 0.65, - 0.75, 0.62 ], [ 0.35, 1.25, - 0.25, 0.48 ]
];
const STEM = new THREE.Color( 0x4a3f2c );

export function shrubBush( lod = 0, seed = 31 ) {
	const rand = mulberry32( seed );
	const b = new Builder();
	const H = 1.6;
	const crownC = new THREE.Vector3( 0, 0.7, 0 );
	const crownR = new THREE.Vector3( 1.1, 0.75, 1.1 );
	const flex = ( p ) => Math.min( 1, p.y / 1.3 );
	const lobes = SHRUB_LOBES.map( ( L ) => [ L[ 0 ] + ( rand() - 0.5 ) * 0.2, L[ 1 ] + ( rand() - 0.5 ) * 0.15, L[ 2 ] + ( rand() - 0.5 ) * 0.2, L[ 3 ] * ( 0.85 + rand() * 0.3 ) ] );
	// a few bare stems at the foot
	if ( lod === 0 ) for ( let i = 0; i < 3; i ++ ) {
		const L = lobes[ i + 1 ];
		addBranch( b, new THREE.Vector3( 0, - 0.1, 0 ), new THREE.Vector3( L[ 0 ] * 0.6, L[ 1 ] * 0.7, L[ 2 ] * 0.6 ), 0.035, 0.015, 3, 1, STEM, H, flex );
	}
	const cards = [];
	lobes.forEach( ( L ) => cards.push( ...lobeCards( L, {
		count: Math.round( ( lod ? 8 : 15 ) * L[ 3 ] ), size: lod ? 1.05 : 0.85, crownC, crownR, rand, flexFn: flex, tile: 3, flatten: 0.8
	} ) ) );
	emitCards( b, cards, crownC );
	return b.build();
}

// ---------------------------------------------------------------------------
// Bracken (fento, Pteridium): upright, triangular fronds. Tidewater's addFrond / buildFern: every
// frond is a curved rachis with a strip of leaflets on each side; uv = ( s along the frond,
// t across the leaflet strip ), the pinnae are cut out in the shader (aux.w = 2, see
// vegetation.js createFoliageMaterial). ~1.1 m tall at scale 1.
// ---------------------------------------------------------------------------
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function addFrond( b, o ) {
	const { origin, azimuth, elevation, bend, twist = 0, length, segs = 8, cross = 2, leafLen, leafAngle, droop, curl = 0.2, minWidth = 0.035, bendPow = 1.4, flex } = o;
	// rachis centre line
	const pts = [];
	const p = origin.clone();
	for ( let k = 0; k <= segs; k ++ ) {
		pts.push( p.clone() );
		const sm = ( k + 0.5 ) / segs;
		const el = elevation - bend * Math.pow( sm, bendPow );
		const az = azimuth + twist * sm;
		_v0.set( Math.cos( el ) * Math.cos( az ), Math.sin( el ), Math.cos( el ) * Math.sin( az ) );
		p.addScaledVector( _v0, length / segs );
	}
	const azPerp = new THREE.Vector3( - Math.sin( azimuth ), 0, Math.cos( azimuth ) );
	const T = new THREE.Vector3(), S = new THREE.Vector3(), Nup = new THREE.Vector3(), side = new THREE.Vector3(), ld = new THREE.Vector3();
	for ( const sigma of [ - 1, 1 ] ) {
		const grid = [];
		for ( let k = 0; k <= segs; k ++ ) {
			const s = k / segs;
			T.subVectors( pts[ Math.min( segs, k + 1 ) ], pts[ Math.max( 0, k - 1 ) ] ).normalize();
			S.crossVectors( T, _up );
			if ( S.lengthSq() < 0.04 ) S.copy( azPerp );
			S.normalize();
			Nup.crossVectors( S, T ).normalize();
			const Ll = Math.max( leafLen( s ), minWidth );
			const be = droop( s );
			side.copy( S ).multiplyScalar( sigma * Math.cos( be ) ).addScaledVector( Nup, - Math.sin( be ) );
			ld.copy( T ).multiplyScalar( Math.cos( leafAngle( s ) ) ).addScaledVector( side, Math.sin( leafAngle( s ) ) ).normalize();
			const row = [];
			for ( let j = 0; j <= cross; j ++ ) {
				const t = j / cross;
				row.push( { q: pts[ k ].clone().addScaledVector( ld, Ll * t ).addScaledVector( Nup, - Ll * curl * t * t ), s, t, nup: Nup.clone() } );
			}
			grid.push( row );
		}
		// normals from the grid, oriented to the frond's upper side
		const idx = [];
		for ( let k = 0; k <= segs; k ++ ) {
			const r = [];
			for ( let j = 0; j <= cross; j ++ ) {
				const g = grid[ k ][ j ];
				_v1.subVectors( grid[ Math.min( segs, k + 1 ) ][ j ].q, grid[ Math.max( 0, k - 1 ) ][ j ].q );
				_v2.subVectors( grid[ k ][ Math.min( cross, j + 1 ) ].q, grid[ k ][ Math.max( 0, j - 1 ) ].q );
				_v3.crossVectors( _v1, _v2 );
				if ( _v3.lengthSq() < 1e-12 ) _v3.copy( g.nup );
				_v3.normalize();
				if ( _v3.dot( g.nup ) < 0 ) _v3.negate();
				// soft normals, bent up like the canopy cards: the leaflets drooping away from the sun
				// would otherwise get only the (weak) ambient light and turn black
				_v3.addScaledVector( _up, 1.2 ).normalize();
				// ao: darker at the heart of the plant, lit at the frond tips
				r.push( b.vertex( g.q, _v3, g.s, g.t, WHITE, 1, flex( g.q ), 0.45 + 0.55 * g.s, 2 ) );
			}
			idx.push( r );
		}
		for ( let k = 0; k < segs; k ++ ) for ( let j = 0; j < cross; j ++ ) {
			const a = idx[ k ][ j ], bb = idx[ k + 1 ][ j ], c = idx[ k + 1 ][ j + 1 ], d = idx[ k ][ j + 1 ];
			if ( sigma > 0 ) b.quad( a, d, c, bb ); else b.quad( a, bb, c, d );
		}
	}
}

export function bracken( lod = 0, seed = 3 ) {
	const rand = mulberry32( seed );
	const b = new Builder();
	const n = lod ? 5 : 9;
	const flex = ( p ) => Math.min( 1, p.y / 0.9 ) * 0.8 + 0.2;
	for ( let i = 0; i < n; i ++ ) {
		const a = i / ( n - 1 );
		const Lf = ( 0.9 + 0.5 * a ) * ( 0.85 + 0.3 * rand() );
		addFrond( b, {
			origin: new THREE.Vector3( ( rand() - 0.5 ) * 0.3, 0.02, ( rand() - 0.5 ) * 0.3 ), azimuth: i * 2.39996 + rand() * 0.5,
			// bracken stands up on a bare stalk and spreads its blade near horizontal
			elevation: 1.5 - 0.25 * a + ( rand() - 0.5 ) * 0.1, bend: 1.35 + 0.35 * a, twist: ( rand() - 0.5 ) * 0.5, length: Lf,
			segs: lod ? 4 : 7, cross: 1, bendPow: 2.2,
			// triangular blade: widest at the base of the blade, narrowing to the tip; a bare stalk
			// below (a thin strip: the shader keeps the rachis)
			leafLen: ( s ) => 0.34 * Lf * smooth( 0.3, 0.42, s ) * ( 1 - 0.85 * smooth( 0.4, 1, s ) ) + 0.012 * ( 1 - smooth( 0.3, 0.4, s ) ),
			leafAngle: () => 1.3,
			droop: ( s ) => 0.15 + 0.25 * s,
			curl: 0.12, minWidth: 0.008, flex
		} );
	}
	return b.build();
}

// ---------------------------------------------------------------------------
// Pine (piñeiro): the trunk and branches are grown by three.js' TreeGenerator (a tall straight bole,
// near-horizontal branches that shorten towards the top, twigs), the needles are tufts of cards
// (leaf atlas tile 1) along the twigs. ~12 m tall at scale 1.
// lod 1: trunk and branches only, with fewer, larger cards along the branches.
// ---------------------------------------------------------------------------
export const PINE_BARK = new THREE.Color( 0x5b3f2e );
const _treeGen = new TreeGenerator( new THREE.MeshBasicNodeMaterial() ); // the material is never used

// Ring centres of the generator's tubes. Its vertices are ring by ring, position = centre + normal
// × radius, so two neighbours of one ring give the radius exactly (Δp = Δn · r); a pair across two
// rings leaves a residual and is skipped. Returns [ { c, r, t } ] in tube order (t: tangent).
function tubeRings( geo, sectionLength ) {
	const p = geo.attributes.position.array, n = geo.attributes.normal.array;
	const rings = [];
	let last = null;
	for ( let i = 0; i < p.length / 3 - 1; i ++ ) {
		const j = i * 3;
		const dpx = p[ j + 3 ] - p[ j ], dpy = p[ j + 4 ] - p[ j + 1 ], dpz = p[ j + 5 ] - p[ j + 2 ];
		const dnx = n[ j + 3 ] - n[ j ], dny = n[ j + 4 ] - n[ j + 1 ], dnz = n[ j + 5 ] - n[ j + 2 ];
		const dn2 = dnx * dnx + dny * dny + dnz * dnz;
		if ( dn2 < 0.1 ) continue;
		const r = ( dpx * dnx + dpy * dny + dpz * dnz ) / dn2;
		if ( Math.hypot( dpx - dnx * r, dpy - dny * r, dpz - dnz * r ) > 1e-3 ) continue;
		const c = new THREE.Vector3( p[ j ] - n[ j ] * r, p[ j + 1 ] - n[ j + 1 ] * r, p[ j + 2 ] - n[ j + 2 ] * r );
		if ( last && last.c.distanceToSquared( c ) < 1e-6 ) continue;
		last = { c, r, t: null };
		rings.push( last );
	}
	// tangents: towards the next ring of the same tube (the tubes follow each other in the buffer)
	for ( let i = 0; i < rings.length; i ++ ) {
		const a = rings[ i ], b = rings[ i + 1 ], z = rings[ i - 1 ];
		if ( b && b.c.distanceTo( a.c ) < sectionLength * 1.6 && b.r <= a.r + 1e-4 ) a.t = b.c.clone().sub( a.c ).normalize();
		else if ( z && z.t ) a.t = z.t.clone();
		else a.t = _up.clone();
	}
	return rings;
}

export function pineTree( lod = 0, seed = 12 ) {
	const rand = mulberry32( seed );
	const H = 12;
	const sectionLength = 1.2;
	_treeGen.parameters = {
		seed, levels: lod ? 2 : 3, children: lod ? [ 32 ] : [ 34, 7 ], branchAngle: [ 84, 42 ], angleVariance: 10,
		lengthRatio: 0.36, lengthVariance: 0.25, branchLengthFalloff: 0.85, trunkLength: H, trunkRadius: 0.3,
		taper: 0.92, taperCurve: 1, rootFlare: 0.5, flareFrac: 0.08, radiusExponent: 2.3, minRadius: 0.02,
		minLength: 0.6, droop: 0.12, upPull: 0.08, gnarl: [ 0.02, 0.12, 0.2 ], radialSegments: lod ? 4 : 5,
		sectionLength, childStart: 0.15, trunkClear: 0.3
	};
	const wood = _treeGen.build().geometry;
	const rings = tubeRings( wood, sectionLength );

	const b = new Builder();
	const flex = ( p ) => Math.min( 1, Math.hypot( p.x, p.z ) / 4 + Math.max( 0, p.y - H * 0.6 ) / ( H * 0.8 ) );
	b.wood( wood, PINE_BARK, ( p ) => [ flex( p ) * 0.5, barkAO( p, H ) ] );
	wood.dispose();

	// foliage: along the twigs (lod 0) or the branches (lod 1), off the trunk
	const tufts = rings.filter( ( g ) => Math.hypot( g.c.x, g.c.z ) > 0.45 && g.r < ( lod ? 0.07 : 0.05 ) );
	let lo = Infinity, hi = - Infinity, reach = 0;
	for ( const g of tufts ) { lo = Math.min( lo, g.c.y ); hi = Math.max( hi, g.c.y ); reach = Math.max( reach, Math.hypot( g.c.x, g.c.z ) ); }
	const crownC = new THREE.Vector3( 0, ( lo + hi ) / 2, 0 );
	const crownR = new THREE.Vector3( reach + 0.5, ( hi - lo ) / 2 + 0.8, reach + 0.5 );
	const keep = lod ? 1 : 0.45, size = lod ? 2.6 : 1.45;
	const cards = [];
	for ( const g of tufts ) {
		if ( rand() > keep ) continue;
		const out = new THREE.Vector3( g.c.x, 0, g.c.z ).normalize();
		// sprays lie along the shoot, facing mostly up and a little outwards
		const normal = new THREE.Vector3( rand() - 0.5, rand() - 0.5, rand() - 0.5 ).multiplyScalar( 0.7 ).addScaledVector( _up, 1 ).addScaledVector( out, 0.45 ).normalize();
		const center = g.c.clone().addScaledVector( g.t, size * 0.25 ).add( new THREE.Vector3( rand() - 0.5, ( rand() - 0.5 ) * 0.5, rand() - 0.5 ).multiplyScalar( 0.3 ) );
		const yaw = Math.atan2( g.t.z, g.t.x ) + ( rand() - 0.5 ) * 0.8;
		cards.push( { center, size: size * ( 0.8 + rand() * 0.4 ), normal, yaw, lobeC: g.c, lobeR: 1, crownC, crownR, flexFn: flex, tile: 1, clumpC: g.c, clumpR: 0.9 } );
		// a second, crossing card on some tufts (the spray reads from the side too)
		if ( rand() < ( lod ? 0.7 : 0.35 ) ) cards.push( { ...cards[ cards.length - 1 ], normal: normal.clone().addScaledVector( out, 1.2 ).normalize(), yaw: yaw + 1.2 } );
	}
	emitCards( b, cards, crownC );
	const g = b.build();
	g.translate( 0, - 0.4, 0 ); // the flared foot sinks into sloping ground
	g.computeBoundingSphere();
	return g;
}

// ---------------------------------------------------------------------------
// Birch (bidueiro, Betula pubescens / pendula): a slender white bole with dark lenticel dashes and
// a dark, fissured foot, rising almost to the top; limbs leave it at a steep angle and arch over at
// the tips, twigs hang from them and carry small clumps of round leaves (leaf atlas tile 2). A
// narrow, airy oval crown; ~10 m tall at scale 1. Built with the oak's helpers (ours, not
// Tidewater's: Tidewater has no birch).
// lod 1: fewer limbs, no twigs, fewer and larger clumps.
// ---------------------------------------------------------------------------
const BIRCH_WHITE = new THREE.Color( 0xd8d3c7 ), BIRCH_DASH = new THREE.Color( 0x2f2c29 ), BIRCH_FOOT = new THREE.Color( 0x3b3631 );
const BIRCH_LIMB = new THREE.Color( 0xa49b8e ), BIRCH_TWIG = new THREE.Color( 0x4a3a32 );
const hash2 = ( a, b ) => {
	const h = Math.sin( a * 127.1 + b * 311.7 ) * 43758.5453;
	return h - Math.floor( h );
};

export function birchTree( lod = 0, seed = 13 ) {
	const rand = mulberry32( seed );
	const b = new Builder();
	const H = 10.4;
	const crownC = new THREE.Vector3( 0, 7.0, 0 );
	const crownR = new THREE.Vector3( 3.0, 3.5, 3.0 );
	// birches are supple: the crown sways more than the oak's
	const flex = ( p ) => Math.min( 1, Math.hypot( p.x, p.z ) / 2.4 + Math.max( 0, p.y - 8 ) / 4 ) * smooth( 2.5, 6.5, p.y );

	// bole: two straight sections with a slight bend, white with dark horizontal lenticel dashes
	// (one vertex row tall, 1-2 columns wide) and a dark rough foot reaching up unevenly
	const radial = lod ? 6 : 12;
	const footTop = 0.9 + rand() * 0.7;
	const bole = ( p, f, side ) => {
		const foot = 1 - smooth( footTop * 0.55, footTop + 0.5 * hash2( side, 3 ), p.y );
		// dashes 2-4 columns wide, offset per row so they don't line up
		const row = Math.round( p.y * ( lod ? 1.8 : 8 ) );
		const dash = p.y > 0.6 && hash2( row, Math.floor( ( side + hash2( row, 9 ) * radial ) / 3 ) % Math.ceil( radial / 3 ) + seed ) < ( lod ? 0.2 : 0.17 ) ? 0.9 : 0;
		const c = BIRCH_WHITE.clone().multiplyScalar( 0.93 + 0.1 * hash2( row, side ) ).lerp( BIRCH_DASH, dash );
		return c.lerp( BIRCH_FOOT, Math.min( 1, foot * ( 0.85 + 0.15 * hash2( row, side + 7 ) ) ) );
	};
	const lean = new THREE.Vector3( ( rand() - 0.5 ) * 0.5, 0, ( rand() - 0.5 ) * 0.5 );
	const mid = new THREE.Vector3( lean.x * 0.5, 4.6, lean.z * 0.5 );
	const top = new THREE.Vector3( lean.x * 0.3 + ( rand() - 0.5 ) * 0.3, H, lean.z * 0.3 + ( rand() - 0.5 ) * 0.3 );
	const footR = ( f, a, c ) => {
		const r = 0.2 - 0.06 * f;
		return r * ( 1 + 0.35 * Math.exp( - Math.max( c.y + 0.4, 0 ) / 0.35 ) + 0.06 * Math.cos( 3 * a + 1.1 ) * Math.exp( - Math.max( c.y, 0 ) ) );
	};
	addBranch( b, new THREE.Vector3( 0, - 0.5, 0 ), mid, 0.2, 0.14, radial, lod ? 9 : 40, bole, H, flex, footR );
	addBranch( b, mid, top, 0.14, 0.025, radial, lod ? 9 : 46, bole, H, flex );
	const boleAt = ( y ) => ( y < mid.y ? new THREE.Vector3( 0, - 0.5, 0 ).lerp( mid, ( y + 0.5 ) / ( mid.y + 0.5 ) ) : mid.clone().lerp( top, ( y - mid.y ) / ( H - mid.y ) ) );

	const cards = [];
	const clump = ( c, rc, n, size ) => {
		const out = c.clone().sub( crownC ).setY( 0 ).normalize();
		for ( let j = 0; j < n; j ++ ) {
			// mostly facing up and out, the clumps hang a little below their twig
			const dir = new THREE.Vector3( rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1 ).normalize().addScaledVector( out, 0.8 ).addScaledVector( _up, 0.7 ).normalize();
			const center = c.clone().add( new THREE.Vector3( rand() - 0.5, ( rand() - 0.5 ) * 0.7 - 0.15, rand() - 0.5 ).multiplyScalar( rc ) );
			cards.push( { center, size: size * ( 0.8 + rand() * 0.4 ), normal: dir, yaw: rand() * 6.283, lobeC: c, lobeR: rc, crownC, crownR, flexFn: flex, tile: 2, clumpC: c, clumpR: rc } );
		}
	};
	const cardsPer = lod ? 3 : 4, size = lod ? 1.9 : 1.1, rc = lod ? 0.75 : 0.5;

	// limbs: steep near the top, wider and longer lower down; the tips arch over
	const N = lod ? 9 : 15;
	for ( let k = 0; k < N; k ++ ) {
		const t = ( k + rand() * 0.6 ) / N;
		const y = 3.4 + t * 6.0;
		const az = k * 2.39996 + ( rand() - 0.5 ) * 0.6;
		const tilt = ( 58 - 30 * t + ( rand() - 0.5 ) * 12 ) * Math.PI / 180; // from the vertical
		const L = ( 1.1 + 2.0 * Math.sin( Math.PI * ( 0.3 + 0.7 * t ) ) ) * ( 0.8 + rand() * 0.4 ); // ovoid: widest a third up the crown
		const dir = new THREE.Vector3( Math.sin( tilt ) * Math.cos( az ), Math.cos( tilt ), Math.sin( tilt ) * Math.sin( az ) );
		const start = boleAt( y );
		const ctrl = start.clone().addScaledVector( dir, L * 0.6 ).add( new THREE.Vector3( 0, L * 0.12, 0 ) );
		const end = start.clone().addScaledVector( dir, L ).add( new THREE.Vector3( 0, - L * ( 0.12 + 0.2 * ( 1 - t ) ), 0 ) );
		const r0 = 0.03 + 0.035 * L / 3.1;
		addLimb( b, start, ctrl, end, r0, 0.012, lod ? 3 : 5, lod ? 3 : 5, BIRCH_LIMB, H, flex );
		const along = ( s ) => start.clone().multiplyScalar( ( 1 - s ) * ( 1 - s ) ).addScaledVector( ctrl, 2 * ( 1 - s ) * s ).addScaledVector( end, s * s );
		const nc = lod ? 4 : 6;
		for ( let j = 0; j < nc; j ++ ) {
			const s = 0.4 + 0.6 * ( j + rand() * 0.5 ) / nc;
			const q = along( Math.min( 1, s ) );
			clump( q, rc, cardsPer, size );
			if ( lod ) continue;
			// a twig hanging from the limb, clumps along it (the weeping curtain of the birch)
			const side = new THREE.Vector3( - dir.z, 0, dir.x ).multiplyScalar( ( rand() - 0.5 ) * 1.2 );
			const tl = 0.6 + rand() * 0.7 * ( 1 - t * 0.5 );
			const tip = q.clone().addScaledVector( dir.clone().setY( 0 ).normalize(), tl * 0.45 ).add( side.multiplyScalar( tl * 0.5 ) ).add( new THREE.Vector3( 0, - tl * 0.8, 0 ) );
			addBranch( b, q, tip, 0.012, 0.005, 3, 1, BIRCH_TWIG, H, flex );
			clump( q.clone().lerp( tip, 0.55 ), rc * 0.85, 2, size * 0.9 );
			clump( tip, rc * 0.8, 2, size * 0.85 );
		}
	}
	// the leader: small clumps up the top of the bole
	for ( let k = 0; k < ( lod ? 2 : 4 ); k ++ ) clump( boleAt( H - 0.3 - k * 0.55 ), rc * 0.9, cardsPer, size * 0.9 );
	emitCards( b, cards, crownC );

	const g = b.build();
	g.computeBoundingSphere();
	return g;
}

// ---------------------------------------------------------------------------
// Woodland floor after the offroad forest (https://github.com/alexadrerui/offroad,
// src/world/foliage.js buildDead / buildPlant('bush') and trees.js fallen logs; MIT License,
// Copyright (c) 2026 Arz-Gev). Rewritten for this project's foliage layout: real bark geometry
// instead of the bare-twig card, moss and end grain in the vertex colour, the bush as a holly of
// round-leaf clumps (leaf atlas tile 2).
// ---------------------------------------------------------------------------

// Dead tree (snag, árbore seca): a grey, weathered bole with a broken top and a few bare, crooked
// limbs; grown by TreeGenerator like the pine, no leaves. ~8 m tall at scale 1.
const SNAG_BARK = new THREE.Color( 0x5b554c ), SNAG_DARK = new THREE.Color( 0x332d27 );

export function deadTree( lod = 0, seed = 41 ) {
	const H = 7.5;
	_treeGen.parameters = {
		seed, levels: lod ? 2 : 3, children: lod ? [ 10 ] : [ 11, 4 ], branchAngle: [ 58, 42 ], angleVariance: 20,
		lengthRatio: 0.5, lengthVariance: 0.5, branchLengthFalloff: 0.55, trunkLength: H, trunkRadius: 0.4,
		taper: 0.72, taperCurve: 0.75, rootFlare: 0.8, flareFrac: 0.12, radiusExponent: 2.0, minRadius: 0.03,
		minLength: 0.6, droop: 0.06, upPull: 0.3, gnarl: [ 0.1, 0.22, 0.3 ], radialSegments: lod ? 4 : 7,
		sectionLength: 0.9, childStart: 0.15, trunkClear: 0.3
	};
	const wood = _treeGen.build().geometry;
	const b = new Builder();
	// stiff dead wood: only the thin limbs move a little
	const flex = ( p ) => Math.min( 1, Math.hypot( p.x, p.z ) / 5 ) * smooth( 3, 7, p.y ) * 0.5;
	// weathered: silver-grey up the bole, darker and damp at the foot
	const P = wood.attributes.position, N = wood.attributes.normal, base = b.count;
	const p = new THREE.Vector3(), n = new THREE.Vector3();
	for ( let i = 0; i < P.count; i ++ ) {
		p.fromBufferAttribute( P, i ); n.fromBufferAttribute( N, i );
		const col = SNAG_DARK.clone().lerp( SNAG_BARK, smooth( 0, 1.6, p.y ) * ( 0.85 + 0.15 * hash2( Math.round( p.y * 3 ), i % 7 ) ) );
		b.vertex( p, n, 0, 0, col, 0, flex( p ), barkAO( p, H ), 0 );
	}
	for ( const k of wood.index.array ) b.idx.push( base + k );
	wood.dispose();
	const g = b.build();
	g.translate( 0, - 0.35, 0 );
	g.computeBoundingSphere();
	return g;
}

// Fallen log (tronco caído): along +x, length L, centred on the origin, lying with its axis at
// y = 0 (the placement lifts it by its radius). Irregular bark tube with a couple of branch stubs,
// moss on the upper side and pale end grain with growth rings at both broken ends.
const LOG_BARK = new THREE.Color( 0x4a3d31 ), LOG_MOSS = new THREE.Color( 0x4d5a23 ), LOG_WOOD = new THREE.Color( 0x9c8466 ), LOG_RING = new THREE.Color( 0x6e5a43 );

export function fallenLog( lod = 0, seed = 51, L = 6 ) {
	const rand = mulberry32( seed );
	const b = new Builder();
	const radial = lod ? 7 : 12, rows = lod ? 4 : Math.round( L * 2.5 );
	const r0 = 0.34, r1 = 0.25;
	const bumps = [ 0, 1, 2 ].map( () => [ rand() * 6.28, 0.04 + rand() * 0.05, 2 + Math.floor( rand() * 3 ) ] );
	const radiusAt = ( f, a ) => ( r0 + ( r1 - r0 ) * f ) * ( 1 + bumps.reduce( ( s, [ ph, amp, k ] ) => s + amp * Math.sin( k * a + ph + f * 3 ), 0 ) );
	const bend = ( rand() - 0.5 ) * 0.25;
	const centre = ( f ) => new THREE.Vector3( ( f - 0.5 ) * L, 0, bend * Math.sin( f * Math.PI ) );
	const bark = ( q, n, a ) => {
		const moss = smooth( 0.5, 0.95, n.y ) * ( 0.35 + 0.45 * hash2( Math.round( q.x * 2 ), Math.round( a * 3 ) ) );
		return LOG_BARK.clone().multiplyScalar( 0.85 + 0.25 * hash2( Math.round( q.x * 6 ), Math.round( a * 5 ) ) ).lerp( LOG_MOSS, moss );
	};
	const ring = [];
	for ( let j = 0; j <= rows; j ++ ) {
		const f = j / rows, c = centre( f );
		const row = [];
		for ( let i = 0; i <= radial; i ++ ) {
			const a = ( i / radial ) * Math.PI * 2;
			const n = new THREE.Vector3( 0, Math.cos( a ), Math.sin( a ) );
			const q = c.clone().addScaledVector( n, radiusAt( f, a ) );
			// ao: the underside lies on the ground
			row.push( b.vertex( q, n, 0, 0, bark( q, n, a ), 0, 0, 0.35 + 0.65 * smooth( - 0.9, 0.6, n.y ), 0 ) );
		}
		ring.push( row );
	}
	for ( let j = 0; j < rows; j ++ ) for ( let i = 0; i < radial; i ++ ) b.quad( ring[ j ][ i ], ring[ j ][ i + 1 ], ring[ j + 1 ][ i + 1 ], ring[ j + 1 ][ i ] );
	// broken ends: a fan of pale wood with rings, the rim a little inset (splintered)
	for ( const [ f, s ] of [ [ 0, - 1 ], [ 1, 1 ] ] ) {
		const c = centre( f ), n = new THREE.Vector3( s, 0, 0 );
		const mid = b.vertex( c, n, 0, 0, LOG_RING, 0, 0, 0.8, 0 );
		const rim = [];
		for ( let i = 0; i <= radial; i ++ ) {
			const a = ( i / radial ) * Math.PI * 2, r = radiusAt( f, a );
			const inner = [];
			for ( const k of [ 0.45, 0.8, 0.97 ] ) {
				const q = c.clone().add( new THREE.Vector3( s * 0.02 * ( 1 - k ) * hash2( i, k * 10 ), Math.cos( a ) * r * k, Math.sin( a ) * r * k ) );
				inner.push( b.vertex( q, n, 0, 0, k === 0.8 ? LOG_RING : LOG_WOOD, 0, 0, 0.8, 0 ) );
			}
			rim.push( inner );
		}
		for ( let i = 0; i < radial; i ++ ) {
			const A = rim[ i ], B = rim[ i + 1 ];
			if ( s > 0 ) { b.idx.push( mid, A[ 0 ], B[ 0 ] ); b.quad( A[ 0 ], A[ 1 ], B[ 1 ], B[ 0 ] ); b.quad( A[ 1 ], A[ 2 ], B[ 2 ], B[ 1 ] ); }
			else { b.idx.push( mid, B[ 0 ], A[ 0 ] ); b.quad( A[ 0 ], B[ 0 ], B[ 1 ], A[ 1 ] ); b.quad( A[ 1 ], B[ 1 ], B[ 2 ], A[ 2 ] ); }
		}
	}
	// branch stubs, pointing up and sideways
	if ( lod === 0 ) for ( let k = 0, n = 1 + Math.floor( rand() * 2 ); k < n; k ++ ) {
		const f = 0.25 + rand() * 0.5, a = ( rand() - 0.5 ) * 1.6;
		const n0 = new THREE.Vector3( 0, Math.cos( a ), Math.sin( a ) );
		const from = centre( f ).addScaledVector( n0, radiusAt( f, a ) * 0.6 );
		const to = from.clone().addScaledVector( n0.clone().add( new THREE.Vector3( ( rand() - 0.5 ) * 0.8, 0, 0 ) ).normalize(), 0.35 + rand() * 0.45 );
		addBranch( b, from, to, 0.07, 0.035, 5, 1, LOG_BARK, 1, () => 0 );
	}
	const g = b.build();
	g.computeBoundingSphere();
	return g;
}

// Holly (acivro, Ilex aquifolium): a dense dome of dark, round-leaved clumps on short stems;
// offroad's broad-leaf bush, with this project's lobed cards. ~1.9 m tall at scale 1.
const HOLLY_LOBES = [
	[ 0.0, 1.15, 0.0, 0.85 ], [ 0.7, 0.75, 0.3, 0.7 ], [ - 0.65, 0.7, 0.45, 0.7 ], [ - 0.2, 0.75, - 0.7, 0.72 ],
	[ 0.45, 0.65, - 0.55, 0.6 ], [ 0.15, 1.6, 0.1, 0.55 ]
];

export function hollyBush( lod = 0, seed = 61 ) {
	const rand = mulberry32( seed );
	const b = new Builder();
	const H = 1.9;
	const crownC = new THREE.Vector3( 0, 0.95, 0 );
	const crownR = new THREE.Vector3( 1.2, 0.95, 1.2 );
	const flex = ( p ) => Math.min( 1, p.y / 1.6 ) * 0.7;
	const lobes = HOLLY_LOBES.map( ( L ) => [ L[ 0 ] + ( rand() - 0.5 ) * 0.25, L[ 1 ] + ( rand() - 0.5 ) * 0.2, L[ 2 ] + ( rand() - 0.5 ) * 0.25, L[ 3 ] * ( 0.85 + rand() * 0.3 ) ] );
	if ( lod === 0 ) for ( let i = 1; i < 5; i ++ ) {
		const L = lobes[ i ];
		addBranch( b, new THREE.Vector3( 0, - 0.1, 0 ), new THREE.Vector3( L[ 0 ] * 0.7, L[ 1 ] * 0.8, L[ 2 ] * 0.7 ), 0.045, 0.02, 3, 1, STEM, H, flex );
	}
	const cards = [];
	lobes.forEach( ( L ) => cards.push( ...lobeCards( L, {
		count: Math.round( ( lod ? 9 : 17 ) * L[ 3 ] ), size: lod ? 1.0 : 0.8, crownC, crownR, rand, flexFn: flex, tile: 2, flatten: 0.85
	} ) ) );
	emitCards( b, cards, crownC );
	return b.build();
}

// Ivy (hedra, Hedera helix) on the rustic archway (world/gate.js rusticArch; ref/ref_entrada.jpg):
// curtains of broad-leaf cards hanging from the main beam, thicker on the right (as one comes in:
// local -x), a mat on top of the beams and a climber up the right post. In the arch's frame (x across, y up from the ground
// at its middle, +z into the hamlet); leaf atlas tile 0, the canopy material (no new shader).
export function ivyGeometry( lod = 0, seed = 71, half = 2.0, beamY = 3.15 ) {
	const rand = mulberry32( seed );
	const b = new Builder();
	const crownC = new THREE.Vector3( 0.4, beamY - 0.4, 0 );
	const crownR = new THREE.Vector3( 2.8, 1.6, 0.8 );
	const flex = ( p ) => Math.min( 1, Math.max( 0, beamY - p.y ) / 1.5 ) * 0.6;
	const cards = [];
	const size = lod ? 0.75 : 0.55;
	const card = ( c, n ) => cards.push( { center: c, size: size * ( 0.8 + rand() * 0.4 ), normal: n.normalize(), yaw: rand() * 6.283, lobeC: c, lobeR: 0.5, crownC, crownR, flexFn: flex, tile: 0, clumpC: c, clumpR: 0.5 } );
	const step = lod ? 0.26 : 0.14;
	// hanging strands along the main beam (front and back faces), longer and denser to the right
	for ( let x = - half - 0.6; x <= half + 0.6; x += step * ( 0.7 + rand() * 0.6 ) ) {
		const right = Math.min( 1, Math.max( 0, ( half - x ) / ( 2 * half ) ) );
		if ( rand() > 0.6 + 0.4 * right ) continue;
		const len = 0.25 + rand() * ( 0.5 + 1.15 * right * right );
		for ( const side of [ - 1, 1 ] ) {
			if ( side > 0 && rand() < 0.4 ) continue;
			for ( let y = beamY + 0.05; y > beamY - len; y -= lod ? 0.34 : 0.2 ) {
				const c = new THREE.Vector3( x + ( rand() - 0.5 ) * 0.12, y, side * ( 0.2 + rand() * 0.08 ) );
				card( c, new THREE.Vector3( ( rand() - 0.5 ) * 0.6, 0.25 + rand() * 0.3, side ) );
			}
		}
		// the mat over the beams
		if ( rand() < 0.8 ) card( new THREE.Vector3( x, beamY + 0.2 + rand() * 0.25, 0.08 + ( rand() - 0.5 ) * 0.3 ), new THREE.Vector3( ( rand() - 0.5 ) * 0.5, 1, ( rand() - 0.5 ) * 0.6 ) );
	}
	// the climber up the right post: clumps all round it, sparser low down
	for ( let y = 0.15; y < beamY; y += lod ? 0.3 : 0.16 ) {
		if ( rand() > 0.45 + 0.55 * y / beamY ) continue;
		for ( let k = 0; k < ( lod ? 2 : 3 ); k ++ ) {
			const a = rand() * 6.283;
			const n = new THREE.Vector3( Math.cos( a ), 0.3, Math.sin( a ) );
			card( new THREE.Vector3( - half - 0.05 + Math.cos( a ) * 0.32, y, Math.sin( a ) * 0.32 ), n );
		}
	}
	emitCards( b, cards, crownC );
	const g = b.build();
	g.computeBoundingSphere();
	return g;
}
