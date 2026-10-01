// Surfaces of the houses, the fort and the mine baked into textures (CPU, once; then the IndexedDB
// cache). The building materials (world/materials.js) used to evaluate Worley cells and several
// fractal noises per pixel: big shaders (~5 s of the cold compile, tools/shadercost.mjs) and the
// heaviest pixels of the village. Every pattern here is PERIODIC (lattice and cells wrap), so the
// textures repeat without a seam; the materials only colour them.
//   stone   1024², 16 x 16 stone cells (cell space, scaled per variant by len / rowH):
//           R  F2 - F1 of the cells (the joint distance), G per-stone colour id, B fine grain
//   thatch  1024² over 4 x 4.2 m:  R strands, G fine strands, B course (layers of 0.42 m)
//   wood    512² over 1 x 8 m:     R grain, G knots
//   daub    512² over 4 x 4 m:     R clay fbm, G crack noise
//   world   512² over 32 x 32 m:   R moss patches, G thatch weathering, B cloth fading, A dark rock
// All channels 0..1 in 8 bits.
import * as THREE from 'three/webgpu';

// integer hash -> 0..1
const hash2 = ( x, y, s ) => {
	let h = Math.imul( x | 0, 0x27d4eb2d ) ^ Math.imul( y | 0, 0x165667b1 ) ^ Math.imul( s | 0, 0x9e3779b1 );
	h = Math.imul( h ^ ( h >>> 15 ), 0x85ebca6b );
	h = Math.imul( h ^ ( h >>> 13 ), 0xc2b2ae35 );
	return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;
};
const mod = ( a, n ) => ( ( a % n ) + n ) % n;
const GX = new Float32Array( 16 ), GY = new Float32Array( 16 );
for ( let k = 0; k < 16; k ++ ) { GX[ k ] = Math.cos( k / 16 * Math.PI * 2 ); GY[ k ] = Math.sin( k / 16 * Math.PI * 2 ); }
const fade = ( t ) => t * t * t * ( t * ( t * 6 - 15 ) + 10 );

// periodic gradient (Perlin) noise, period px x py lattice cells, about -1..1
function perlin( x, y, px, py, seed ) {
	const x0 = Math.floor( x ), y0 = Math.floor( y ), fx = x - x0, fy = y - y0;
	const g = ( i, j, dx, dy ) => {
		const k = ( hash2( mod( i, px ), mod( j, py ), seed ) * 16 ) | 0; // 16 directions (no trig)
		return GX[ k ] * dx + GY[ k ] * dy;
	};
	const u = fade( fx ), v = fade( fy );
	const n00 = g( x0, y0, fx, fy ), n10 = g( x0 + 1, y0, fx - 1, fy );
	const n01 = g( x0, y0 + 1, fx, fy - 1 ), n11 = g( x0 + 1, y0 + 1, fx - 1, fy - 1 );
	return 1.41 * ( ( n00 + ( n10 - n00 ) * u ) + ( ( n01 + ( n11 - n01 ) * u ) - ( n00 + ( n10 - n00 ) * u ) ) * v );
}

// periodic fbm, 0..1: frequencies double, periods too (stays seamless)
function fbm( x, y, px, py, oct, seed ) {
	let s = 0, a = 1, n = 0, f = 1;
	for ( let o = 0; o < oct; o ++ ) {
		s += a * perlin( x * f, y * f, px * f, py * f, seed + o * 17 );
		n += a; a *= 0.5; f *= 2;
	}
	return s / n * 0.5 + 0.5;
}

// periodic Worley over an n x n cell grid: { f1, f2, id }
function worley( x, y, n, seed ) {
	const cx = Math.floor( x ), cy = Math.floor( y );
	let f1 = 9, f2 = 9, id = 0;
	for ( let j = - 1; j <= 1; j ++ ) for ( let i = - 1; i <= 1; i ++ ) {
		const gx = mod( cx + i, n ), gy = mod( cy + j, n );
		const px = cx + i + 0.15 + 0.7 * hash2( gx, gy, seed ), py = cy + j + 0.15 + 0.7 * hash2( gx, gy, seed + 1 );
		const d = Math.hypot( px - x, py - y );
		if ( d < f1 ) { f2 = f1; f1 = d; id = hash2( gx, gy, seed + 2 ); } else if ( d < f2 ) f2 = d;
	}
	return { f1, f2, id };
}

const clamp01 = ( v ) => Math.max( 0, Math.min( 1, v ) );
const B = ( v ) => Math.round( clamp01( v ) * 255 );

function bake( res, fn ) {
	const data = new Uint8Array( res * res * 4 );
	for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {
		const k = ( j * res + i ) * 4;
		const c = fn( ( i + 0.5 ) / res, ( j + 0.5 ) / res );
		data[ k ] = B( c[ 0 ] ); data[ k + 1 ] = B( c[ 1 ] ); data[ k + 2 ] = B( c[ 2 ] ); data[ k + 3 ] = B( c[ 3 ] ?? 1 );
	}
	return { data, res };
}

// dry-stone rubble in cell space: 16 x 16 cells, lightly coursed (warped Worley)
const STONE_N = 16;
function bakeStone() {
	const N = STONE_N;
	return bake( 1024, ( u, v ) => {
		const x = u * N, y = v * N;
		// warp (the material's st * 1.3 noise, here in cell units)
		const wx = ( perlin( x * 0.75, y * 0.5, N * 0.75, N * 0.5, 11 ) ) * 0.18;
		const wy = ( perlin( x * 0.75 + 9.1, y * 0.5, N * 0.75, N * 0.5, 12 ) ) * 0.12;
		const w = worley( x + wx, y + wy, N, 21 );
		// per-stone tone: a slow noise and a hash of the (staggered) course cell
		const row = Math.floor( y + wy ), brick = Math.floor( x + wx + row * 0.5 );
		const cid = fbm( x, y, N, N, 1, 31 ) * 0.6 + hash2( mod( brick, N ), mod( row, N ), 41 ) * 0.4;
		const n = fbm( x * 4, y * 2, N * 4, N * 2, 2, 51 );
		return [ ( w.f2 - w.f1 ), cid, n, 1 ];
	} );
}

// thatch over 4 m (across) x 4.2 m (down the slope): fibres run down the slope; the courses (layers
// of 0.42 m) are broken up by noise so they do not read as corrugated tiles
function bakeThatch() {
	const PX = 4, PY = 4.2;
	return bake( 1024, ( u, v ) => {
		const x = u * PX, y = v * PY;
		// every frequency x period is a whole number of cycles (the tile wraps)
		const strands = fbm( x * 22, y * 7 / PY, 88, 7, 2, 61 );
		const strands2 = fbm( x * 55, y * 13 / PY, 220, 13, 1, 71 );
		const off = ( fbm( x * 1, y * 2 / PY, 4, 2, 2, 81 ) - 0.5 ) * 0.36 + ( fbm( x * 3, y * 4 / PY, 12, 4, 1, 91 ) - 0.5 ) * 0.14;
		const course = ( ( ( y + off ) / 0.42 ) % 1 + 1 ) % 1;
		return [ strands, strands2, course, 1 ];
	} );
}

// planks: grain along the plank (y), period 1 m across x 8 m along
function bakeWood() {
	return bake( 512, ( u, v ) => {
		const x = u, y = v * 8;
		return [ fbm( x * 30, y * 1.5, 30, 12, 2, 101 ), fbm( x * 3, y * 3, 3, 24, 1, 111 ), 0, 1 ];
	} );
}

// clay render over 4 m
function bakeDaub() {
	return bake( 512, ( u, v ) => {
		const x = u * 4, y = v * 4;
		return [ fbm( x * 2.5, y * 2.5, 10, 10, 3, 121 ), fbm( x * 6, y * 6, 24, 24, 1, 131 ), 0, 1 ];
	} );
}

// world-space patches over 32 m (sampled with ( x + y/2, z - y/2 ): walls and roofs both vary)
function bakeWorld() {
	return bake( 512, ( u, v ) => {
		const x = u * 32, y = v * 32;
		// ~0.6, 0.35 and 0.8 cycles per metre, rounded to whole cycles over the 32 m tile
		const f = ( c ) => c / 32;
		return [ fbm( x * f( 19 ), y * f( 19 ), 19, 19, 3, 141 ), fbm( x * f( 11 ), y * f( 11 ), 11, 11, 3, 151 ), fbm( x * f( 26 ), y * f( 26 ), 26, 26, 2, 161 ), fbm( x * f( 26 ), y * f( 26 ), 26, 26, 3, 171 ) ];
	} );
}

export const SURFACE = { stoneCells: STONE_N, thatch: [ 4, 4.2 ], wood: [ 1, 8 ], daub: 4, world: 32 };

// the raw texels of every surface (for the cache)
export function bakeSurfaces() {
	const t0 = performance.now();
	const out = { stone: bakeStone(), thatch: bakeThatch(), wood: bakeWood(), daub: bakeDaub(), world: bakeWorld() };
	out.ms = performance.now() - t0;
	return out;
}

// textures from the raw texels (repeat, mipmapped, data: no colour space)
export function surfaceTextures( raw ) {
	const tex = {};
	for ( const k of [ 'stone', 'thatch', 'wood', 'daub', 'world' ] ) {
		const { data, res } = raw[ k ];
		const t = new THREE.DataTexture( data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType );
		t.name = 'surface_' + k;
		t.colorSpace = THREE.NoColorSpace;
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.magFilter = THREE.LinearFilter;
		t.minFilter = THREE.LinearMipmapLinearFilter;
		t.generateMipmaps = true;
		t.anisotropy = 8;
		t.needsUpdate = true;
		tex[ k ] = t;
	}
	return tex;
}
