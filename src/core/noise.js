// CPU-side noise used to build the heightfield and to scatter props.
// The same heightfield is uploaded to the GPU as a texture, so CPU placement
// and GPU shading always agree.

export function mulberry32( seed ) {
	let a = seed >>> 0;
	return function () {
		a |= 0; a = ( a + 0x6D2B79F5 ) | 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}

// A random sequence of its own for cell ( i, j ) of a scatter grid: a cell skipped (cleared around a
// moved house, under a lake, an edited relief) no longer shifts the draws of every cell after it.
// `cell` marks it as the procedural scatter's (the nature brush may erase what it places).
export function cellRand( i, j, salt ) {
	const r = mulberry32( ( Math.imul( i + 1, 73856093 ) ^ Math.imul( j + 1, 19349663 ) ^ salt ) >>> 0 );
	r.cell = true;
	return r;
}

const F2 = 0.5 * ( Math.sqrt( 3 ) - 1 );
const G2 = ( 3 - Math.sqrt( 3 ) ) / 6;
const GRAD = [ [ 1, 1 ], [ - 1, 1 ], [ 1, - 1 ], [ - 1, - 1 ], [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ];

export function makeSimplex( seed = 1 ) {
	const rnd = mulberry32( seed );
	const p = new Uint8Array( 256 );
	for ( let i = 0; i < 256; i ++ ) p[ i ] = i;
	for ( let i = 255; i > 0; i -- ) {
		const j = Math.floor( rnd() * ( i + 1 ) );
		const t = p[ i ]; p[ i ] = p[ j ]; p[ j ] = t;
	}
	const perm = new Uint8Array( 512 );
	for ( let i = 0; i < 512; i ++ ) perm[ i ] = p[ i & 255 ];

	return function noise2( xin, yin ) {
		const s = ( xin + yin ) * F2;
		const i = Math.floor( xin + s ), j = Math.floor( yin + s );
		const t = ( i + j ) * G2;
		const x0 = xin - ( i - t ), y0 = yin - ( j - t );
		const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
		const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
		const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
		const ii = i & 255, jj = j & 255;
		let n = 0;
		let t0 = 0.5 - x0 * x0 - y0 * y0;
		if ( t0 > 0 ) { const g = GRAD[ perm[ ii + perm[ jj ] ] & 7 ]; t0 *= t0; n += t0 * t0 * ( g[ 0 ] * x0 + g[ 1 ] * y0 ); }
		let t1 = 0.5 - x1 * x1 - y1 * y1;
		if ( t1 > 0 ) { const g = GRAD[ perm[ ii + i1 + perm[ jj + j1 ] ] & 7 ]; t1 *= t1; n += t1 * t1 * ( g[ 0 ] * x1 + g[ 1 ] * y1 ); }
		let t2 = 0.5 - x2 * x2 - y2 * y2;
		if ( t2 > 0 ) { const g = GRAD[ perm[ ii + 1 + perm[ jj + 1 ] ] & 7 ]; t2 *= t2; n += t2 * t2 * ( g[ 0 ] * x2 + g[ 1 ] * y2 ); }
		return 70 * n; // ~[-1,1]
	};
}

export function fbm( n2, x, y, oct = 5, lac = 2.0, gain = 0.5 ) {
	let a = 1, f = 1, s = 0, norm = 0;
	for ( let o = 0; o < oct; o ++ ) {
		s += a * n2( x * f, y * f );
		norm += a; a *= gain; f *= lac;
	}
	return s / norm;
}

// Ridged multifractal: sharp crests, good for granite ridges and peaks.
export function ridged( n2, x, y, oct = 6, lac = 2.0, gain = 0.5 ) {
	let a = 0.5, f = 1, s = 0, w = 1;
	for ( let o = 0; o < oct; o ++ ) {
		let n = 1 - Math.abs( n2( x * f, y * f ) );
		n *= n; n *= w;
		w = Math.min( 1, Math.max( 0, n * 2 ) );
		s += n * a; a *= gain; f *= lac;
	}
	return s; // ~[0,1]
}

// Ridged without the squaring: rounded crests (reads better at distance).
export function ridgedSoft( n2, x, y, oct = 5, lac = 2.0, gain = 0.5 ) {
	let a = 0.5, f = 1, s = 0, norm = 0;
	for ( let o = 0; o < oct; o ++ ) {
		s += ( 1 - Math.abs( n2( x * f, y * f ) ) ) * a;
		norm += a; a *= gain; f *= lac;
	}
	return s / norm; // ~[0,1]
}

export const smoothstep = ( a, b, x ) => {
	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );
};
export const lerp = ( a, b, t ) => a + ( b - a ) * t;
export const clamp = ( x, a, b ) => Math.min( b, Math.max( a, x ) );
