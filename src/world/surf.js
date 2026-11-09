// The swell's travel time over the sea bed: where the waves breaking on the coast are.
// After NeuralSpecOcean's Bathymetry.js (https://github.com/bgbg108555/NeuralSpecOcean, MIT,
// Copyright (c) 2026 bgbg108555, licenses/LICENSE-NeuralSpecOcean.md), which marches the refracted
// travel time tau(x, z) of the waves shoreward over the bathymetry and runs every coastal wave at the
// phase omega (t - tau): the crests slow down over the shallows, bend round the headlands and islands
// and come in square to the shore. There it is a one-dimensional march across a straight beach; here
// the coast is irregular and has islands, so tau solves the eikonal equation |grad tau| = 1 / c over the
// whole grid (fast sweeping, Zhao 2005): the swell comes in from the open sea to the east as a plane wave
// (tau fixed in water deeper than DEEP), slows with depth (linear dispersion at the swell's period) and
// cannot cross land.
// The texture (RGBA half float, the heightfield's grid): R = tau minus the deep-water plane wave's
// (X0 - x) / C0 (small, so half float keeps it precise; water.js adds the plane back), GB = grad tau
// (s/m: the direction the crests travel over their speed), A = 1 where the swell reaches.
import * as THREE from 'three/webgpu';

export const SURF = {
	period: 7.0, // s (the swell's peak period: its speed over each depth)
	deep: 22, // m (deeper than this the swell is the open sea's plane wave)
	minDepth: 0.15 // m (the speed at the waterline)
};

const G = 9.81;

// phase speed at depth d for angular frequency w (Eckart's explicit approximation of w^2 = g k tanh k d)
function celerity( d, w ) {
	const k = w * w / ( G * Math.sqrt( Math.tanh( w * w * d / G ) ) );
	return w / k;
}

// hf: the heightfield (data, n, x0, z0, cell); level: the sea level
export function computeSurf( hf, level = 0 ) {
	const n = hf.n, h = hf.cell, d = hf.data, N = n * n;
	const w = 2 * Math.PI / SURF.period;
	const c0 = G / w; // deep water
	const X0 = hf.x0 + ( n - 1 ) * h; // the plane wave's reference line (the grid's east edge)
	const INF = 1e9;
	const tau = new Float32Array( N ).fill( INF );
	const slow = new Float32Array( N ); // h / c (0: land)
	const fixed = new Uint8Array( N );
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {
		const k = j * n + i, depth = level - d[ k ];
		if ( depth <= 0 ) continue;
		slow[ k ] = h / celerity( Math.max( depth, SURF.minDepth ), w );
		if ( depth >= SURF.deep ) { fixed[ k ] = 1; tau[ k ] = ( X0 - ( hf.x0 + i * h ) ) / c0; }
	}
	// Godunov upwind update, swept in the four diagonal orders (twice: islands and bays need the
	// waves to turn corners)
	const update = ( i, j ) => {
		const k = j * n + i;
		if ( fixed[ k ] || slow[ k ] === 0 ) return;
		const a = Math.min( i > 0 ? tau[ k - 1 ] : INF, i < n - 1 ? tau[ k + 1 ] : INF );
		const b = Math.min( j > 0 ? tau[ k - n ] : INF, j < n - 1 ? tau[ k + n ] : INF );
		const f = slow[ k ];
		let t;
		if ( Math.min( a, b ) >= INF ) return;
		if ( Math.abs( a - b ) >= f ) t = Math.min( a, b ) + f;
		else t = ( a + b + Math.sqrt( 2 * f * f - ( a - b ) * ( a - b ) ) ) / 2;
		if ( t < tau[ k ] ) tau[ k ] = t;
	};
	for ( let it = 0; it < 2; it ++ ) {
		for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) update( i, j );
		for ( let j = 0; j < n; j ++ ) for ( let i = n - 1; i >= 0; i -- ) update( i, j );
		for ( let j = n - 1; j >= 0; j -- ) for ( let i = 0; i < n; i ++ ) update( i, j );
		for ( let j = n - 1; j >= 0; j -- ) for ( let i = n - 1; i >= 0; i -- ) update( i, j );
	}
	const toHalf = THREE.DataUtils.toHalfFloat;
	const buf = new Uint16Array( N * 4 );
	const reached = ( k ) => tau[ k ] < INF;
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {
		const k = j * n + i, o = k * 4;
		const plane = ( X0 - ( hf.x0 + i * h ) ) / c0;
		if ( ! reached( k ) ) {
			// dry or out of the swell's reach: the plane wave's values (the shader fades it out by A; the
			// bilinear blend at the waterline then stays smooth)
			buf[ o ] = toHalf( 0 ); buf[ o + 1 ] = toHalf( - 1 / c0 ); buf[ o + 2 ] = 0; buf[ o + 3 ] = 0;
			continue;
		}
		// gradient: central differences over the reached neighbours (one-sided at the shore)
		const xl = i > 0 && reached( k - 1 ), xr = i < n - 1 && reached( k + 1 );
		const zl = j > 0 && reached( k - n ), zr = j < n - 1 && reached( k + n );
		const gx = xl && xr ? ( tau[ k + 1 ] - tau[ k - 1 ] ) / ( 2 * h ) : xr ? ( tau[ k + 1 ] - tau[ k ] ) / h : xl ? ( tau[ k ] - tau[ k - 1 ] ) / h : - 1 / c0;
		const gz = zl && zr ? ( tau[ k + n ] - tau[ k - n ] ) / ( 2 * h ) : zr ? ( tau[ k + n ] - tau[ k ] ) / h : zl ? ( tau[ k ] - tau[ k - n ] ) / h : 0;
		buf[ o ] = toHalf( tau[ k ] - plane );
		buf[ o + 1 ] = toHalf( gx ); buf[ o + 2 ] = toHalf( gz );
		buf[ o + 3 ] = toHalf( 1 );
	}
	const tex = new THREE.DataTexture( buf, n, n, THREE.RGBAFormat, THREE.HalfFloatType );
	tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
	tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.needsUpdate = true;
	tex.userData = { X0, c0, w };
	return tex;
}
