// Lakes at their own level (the terrain editor's "Encher"): water poured at a point of a hollow rises
// until it would spill over the lowest point of the rim; the lake's level is that spill height less a
// margin, and the lake is every cell below it connected to the point. The idea of a lake with its own
// level and surface, apart from the sea, is Drusniel: Gods' End's (world/LakeShape.js,
// water/waterGeometry.js; https://github.com/danielsobrado/drusniel-gods-end, MIT, Copyright (c) 2026
// Daniel Sobrado, licenses/LICENSE-Drusniel.md); there the lake is an authored outline carved into the
// relief, here it fills whatever hollow the relief has, so sculpting the relief reshapes it.
//
// The spill height is a minimax path: of all the paths from the point out of the basin (to the sea or
// the edge of the grid), the one whose highest cell is lowest. A priority flood (Dijkstra on the max
// height along the path) finds it; it stops at MAX_CELLS (the basin is too big for a pond).

import { WATER_LEVEL } from './layout.js';

const MAX_CELLS = 120000;   // ~0.75 km² at 2.5 m cells
export const LAKE_MARGIN = 0.2; // m below the spill height

// binary min-heap of ( cost, cell ) entries (the cost is stored with the entry: a cell's best cost can
// improve after it was pushed, and stale entries are skipped when popped)
class Heap {
	constructor() { this.k = []; this.v = []; }
	push( key, val ) {
		const K = this.k, Vv = this.v;
		let i = K.length;
		K.push( key ); Vv.push( val );
		while ( i > 0 ) {
			const p = ( i - 1 ) >> 1;
			if ( Vv[ p ] <= val ) break;
			K[ i ] = K[ p ]; Vv[ i ] = Vv[ p ]; i = p;
		}
		K[ i ] = key; Vv[ i ] = val;
	}
	// pops the cheapest entry into this.topKey / this.topVal
	pop() {
		const K = this.k, Vv = this.v;
		this.topKey = K[ 0 ]; this.topVal = Vv[ 0 ];
		const lk = K.pop(), lv = Vv.pop();
		if ( K.length ) {
			let i = 0;
			for ( ;; ) {
				const l = 2 * i + 1, r = l + 1;
				let m = i, mv = lv;
				if ( l < K.length && Vv[ l ] < mv ) { m = l; mv = Vv[ l ]; }
				if ( r < K.length && Vv[ r ] < mv ) m = r;
				if ( m === i ) break;
				K[ i ] = K[ m ]; Vv[ i ] = Vv[ m ]; i = m;
			}
			K[ i ] = lk; Vv[ i ] = lv;
		}
	}
	get size() { return this.k.length; }
}

// The lake that fills the hollow at (x, z): { level, cells (Int32Array of grid indices), area, spill }
// or { error } ('fora' outside the grid, 'mar' in the sea, 'grande' basin too big, 'raso' not a hollow).
export function fillLake( hf, x, z, { margin = LAKE_MARGIN, sea = WATER_LEVEL } = {} ) {
	const n = hf.n, d = hf.data;
	const i = Math.round( ( x - hf.x0 ) / hf.cell ), j = Math.round( ( z - hf.z0 ) / hf.cell );
	if ( i < 1 || j < 1 || i >= n - 1 || j >= n - 1 ) return { error: 'fora' };
	const seed = j * n + i;
	if ( d[ seed ] < sea ) return { error: 'mar' };
	// best cost per cell (the max height on the cheapest path from the point); the whole grid is 5 MB,
	// fine for one click
	const c = new Float32Array( n * n ).fill( Infinity );
	const done = new Uint8Array( n * n );
	const heap = new Heap();
	c[ seed ] = d[ seed ]; heap.push( seed, d[ seed ] );
	let spill = null, seen = 0;
	while ( heap.size ) {
		heap.pop();
		const k = heap.topKey, ck = heap.topVal;
		if ( done[ k ] || ck > c[ k ] ) continue; // stale entry
		done[ k ] = 1;
		const ki = k % n, kj = ( k - ki ) / n;
		// out of the basin: the sea, or the edge of the grid
		if ( d[ k ] < sea || ki === 0 || kj === 0 || ki === n - 1 || kj === n - 1 ) { spill = ck; break; }
		if ( ++ seen > MAX_CELLS ) return { error: 'grande' };
		for ( const nk of [ k - 1, k + 1, k - n, k + n ] ) {
			if ( done[ nk ] ) continue;
			const nc = Math.max( ck, d[ nk ] );
			if ( nc < c[ nk ] ) { c[ nk ] = nc; heap.push( nk, nc ); }
		}
	}
	if ( spill === null ) return { error: 'grande' };
	const level = spill - margin;
	if ( d[ seed ] >= level ) return { error: 'raso', spill };
	// the lake: cells below the level connected to the point
	const cells = [], stack = [ seed ], mark = new Uint8Array( n * n );
	mark[ seed ] = 1;
	while ( stack.length ) {
		const k = stack.pop();
		cells.push( k );
		for ( const nk of [ k - 1, k + 1, k - n, k + n ] ) {
			if ( mark[ nk ] || d[ nk ] >= level ) continue;
			mark[ nk ] = 1; stack.push( nk );
		}
	}
	return { level, spill, cells: Int32Array.from( cells ), area: cells.length * hf.cell * hf.cell };
}
