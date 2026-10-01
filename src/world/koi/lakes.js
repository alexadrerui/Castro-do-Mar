// Lakes: bodies of water closed off from the sea, made with the terrain editor. The water is one plane at WATER_LEVEL over the whole
// map, so a basin dug below it inland (the terrain editor's "Cavar") fills with water; these are the
// connected underwater regions of the height field that do not reach the open sea (the underwater
// cells flood-filled from the edge of the grid). Each lake carries a distance-to-shore field on its
// own window of the grid, for the koi to steer by and for placing the lotus.

const MIN_AREA = 60;      // m²: smaller puddles are left alone
const MAX_AREA = 40000;   // m²: larger is a lagoon / sea arm, not a pond
const MIN_DEPTH = 0.15;   // m: a lake must be at least this deep somewhere

// edits: the hand edits of the relief (world/terrainEdits.js, same grid), or null. Only a lake that
// the edits made counts (one with cells that were dry ground in the procedural relief): the natural
// rock pools of the coast are left as they are.
export function findLakes( hf, waterLevel, edits ) {
	if ( ! edits ) return [];
	const n = hf.n, d = hf.data, cell = hf.cell;
	const wet = new Uint8Array( n * n );
	// any water connects (a lake is closed off by dry land, not by a shoal)
	for ( let k = 0; k < n * n; k ++ ) wet[ k ] = d[ k ] < waterLevel ? 1 : 0;
	// 2 = sea: wet cells reachable from the edge of the grid
	const stack = new Int32Array( n * n );
	let sp = 0;
	const seed = ( k ) => { if ( wet[ k ] === 1 ) { wet[ k ] = 2; stack[ sp ++ ] = k; } };
	for ( let i = 0; i < n; i ++ ) { seed( i ); seed( ( n - 1 ) * n + i ); seed( i * n ); seed( i * n + n - 1 ); }
	const flood = ( mark, out ) => {
		while ( sp ) {
			const k = stack[ -- sp ], i = k % n, j = ( k - i ) / n;
			if ( out ) out.push( k );
			if ( i > 0 && wet[ k - 1 ] === 1 ) { wet[ k - 1 ] = mark; stack[ sp ++ ] = k - 1; }
			if ( i < n - 1 && wet[ k + 1 ] === 1 ) { wet[ k + 1 ] = mark; stack[ sp ++ ] = k + 1; }
			if ( j > 0 && wet[ k - n ] === 1 ) { wet[ k - n ] = mark; stack[ sp ++ ] = k - n; }
			if ( j < n - 1 && wet[ k + n ] === 1 ) { wet[ k + n ] = mark; stack[ sp ++ ] = k + n; }
		}
	};
	flood( 2, null );
	// the rest: one lake per connected region
	const lakes = [];
	for ( let k = 0; k < n * n; k ++ ) {
		if ( wet[ k ] !== 1 ) continue;
		const cells = [];
		wet[ k ] = 3; stack[ sp ++ ] = k;
		flood( 3, cells );
		const area = cells.length * cell * cell;
		// too shallow everywhere (a wet hollow): no pond
		if ( ! cells.some( ( c ) => d[ c ] < waterLevel - MIN_DEPTH ) ) continue;
		// dug by hand: some of it was dry before the edits
		if ( ! cells.some( ( c ) => d[ c ] - edits[ c ] >= waterLevel ) ) continue;
		if ( area < MIN_AREA || area > MAX_AREA ) continue;
		lakes.push( makeLake( hf, cells, waterLevel ) );
	}
	return lakes;
}

// window of the grid around the lake (+2 cells), its water mask and the distance to the shore in
// metres (two-pass chamfer, 0 on dry cells)
export function makeLake( hf, cells, waterLevel ) {
	const n = hf.n, cell = hf.cell;
	let i0 = n, i1 = 0, j0 = n, j1 = 0, sx = 0, sz = 0, deepest = 0;
	for ( const k of cells ) {
		const i = k % n, j = ( k - i ) / n;
		i0 = Math.min( i0, i ); i1 = Math.max( i1, i ); j0 = Math.min( j0, j ); j1 = Math.max( j1, j );
		sx += i; sz += j; deepest = Math.max( deepest, waterLevel - hf.data[ k ] );
	}
	i0 = Math.max( 0, i0 - 2 ); j0 = Math.max( 0, j0 - 2 ); i1 = Math.min( n - 1, i1 + 2 ); j1 = Math.min( n - 1, j1 + 2 );
	const w = i1 - i0 + 1, h = j1 - j0 + 1;
	const dist = new Float32Array( w * h );
	for ( const k of cells ) { const i = k % n, j = ( k - i ) / n; dist[ ( j - j0 ) * w + ( i - i0 ) ] = 1e9; }
	const D = cell, Dd = cell * Math.SQRT2;
	for ( let j = 0; j < h; j ++ ) for ( let i = 0; i < w; i ++ ) {
		const k = j * w + i;
		if ( ! dist[ k ] ) continue;
		let v = dist[ k ];
		if ( i > 0 ) v = Math.min( v, dist[ k - 1 ] + D );
		if ( j > 0 ) v = Math.min( v, dist[ k - w ] + D );
		if ( i > 0 && j > 0 ) v = Math.min( v, dist[ k - w - 1 ] + Dd );
		if ( i < w - 1 && j > 0 ) v = Math.min( v, dist[ k - w + 1 ] + Dd );
		dist[ k ] = v;
	}
	for ( let j = h - 1; j >= 0; j -- ) for ( let i = w - 1; i >= 0; i -- ) {
		const k = j * w + i;
		if ( ! dist[ k ] ) continue;
		let v = dist[ k ];
		if ( i < w - 1 ) v = Math.min( v, dist[ k + 1 ] + D );
		if ( j < h - 1 ) v = Math.min( v, dist[ k + w ] + D );
		if ( i < w - 1 && j < h - 1 ) v = Math.min( v, dist[ k + w + 1 ] + Dd );
		if ( i > 0 && j < h - 1 ) v = Math.min( v, dist[ k + w - 1 ] + Dd );
		dist[ k ] = v;
	}
	const x0 = hf.x0 + i0 * cell, z0 = hf.z0 + j0 * cell;
	// bilinear distance to the shore at a world point (0 outside the window)
	const shore = ( x, z ) => {
		const fx = ( x - x0 ) / cell, fz = ( z - z0 ) / cell;
		if ( fx < 0 || fz < 0 || fx >= w - 1 || fz >= h - 1 ) return 0;
		const i = Math.floor( fx ), j = Math.floor( fz ), u = fx - i, v = fz - j, k = j * w + i;
		return ( dist[ k ] * ( 1 - u ) + dist[ k + 1 ] * u ) * ( 1 - v ) + ( dist[ k + w ] * ( 1 - u ) + dist[ k + w + 1 ] * u ) * v;
	};
	// unit direction away from the shore (the gradient of the distance)
	const inward = ( x, z, out ) => {
		const e = cell * 0.5, gx = shore( x + e, z ) - shore( x - e, z ), gz = shore( x, z + e ) - shore( x, z - e );
		const l = Math.hypot( gx, gz ) || 1;
		out.x = gx / l; out.z = gz / l;
		return out;
	};
	let maxShore = 0, cx = 0, cz = 0;
	for ( let k = 0; k < w * h; k ++ ) if ( dist[ k ] > maxShore ) { maxShore = dist[ k ]; cx = x0 + ( k % w ) * cell; cz = z0 + Math.floor( k / w ) * cell; }
	return {
		level: waterLevel, area: cells.length * cell * cell, deepest, maxShore,
		// the point farthest from the shore (the fish start around it)
		cx, cz,
		box: [ x0, z0, x0 + ( w - 1 ) * cell, z0 + ( h - 1 ) * cell ],
		shore, inward
	};
}
