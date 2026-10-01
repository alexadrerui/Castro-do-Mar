// Hand-painted nature (src/editor/natureEditor.js, the "Natureza" tab of ?edit): where vegetation,
// rocks and grass are added or removed. A grid over the terrain, NATURE.cell m per texel, with
// NATURE.channels signed bytes per texel (value / 127 in -1..1):
//   0 oak  1 pine  2 birch  3 gorse / broom  4 bracken  5 rocks  6 grass  7 rock size (0..1)
// v > 0 paints that kind in (extra plants / rocks, v = density), v < 0 erases it (the procedural
// ones there are kept with probability 1 + v). The rock size channel is written with the rocks:
// a wider brush mixes in bigger boulders (after the Habitat Creator game's nature brush).
// Stored as public/nature-edits.bin; the dev server reads and writes it (vite.config.js,
// /__nature-edits). Read at load by vegetation.js, rocks.js and grass.js.
import { TERRAIN } from './layout.js';

export const NATURE = {
	cell: 4,
	res: Math.round( TERRAIN.size / 4 ),
	x0: TERRAIN.centerX - TERRAIN.size / 2,
	z0: TERRAIN.centerZ - TERRAIN.size / 2,
	channels: 8
};
export const CH = { oak: 0, pine: 1, birch: 2, bush: 3, fern: 4, rocks: 5, grass: 6, rockSize: 7 };
export const NATURE_URL = ( import.meta.env?.BASE_URL ?? '/' ) + 'nature-edits.bin';
export const NATURE_BYTES = NATURE.res * NATURE.res * NATURE.channels;

// the painted grid (Int8Array), or null when nothing is painted
export async function loadNatureEdits() {
	for ( const url of [ '/__nature-edits', NATURE_URL ] ) {
		try {
			const res = await fetch( url, { cache: 'no-store' } );
			if ( ! res.ok || ! /octet-stream/.test( res.headers.get( 'content-type' ) || '' ) ) continue;
			const buf = await res.arrayBuffer();
			if ( buf.byteLength !== NATURE_BYTES ) {
				console.warn( `nature edits: ${ url } has ${ buf.byteLength } bytes, expected ${ NATURE_BYTES }; ignored` );
				return null;
			}
			const d = new Int8Array( buf );
			for ( let k = 0; k < d.length; k ++ ) if ( d[ k ] !== 0 ) return d;
			return null;
		} catch ( e ) { /* try the next */ }
	}
	return null;
}

// value of a channel at a world point, -1..1 (0 without edits or outside the grid)
export function natureAt( data, ch, x, z ) {
	if ( ! data ) return 0;
	const i = Math.floor( ( x - NATURE.x0 ) / NATURE.cell ), j = Math.floor( ( z - NATURE.z0 ) / NATURE.cell );
	if ( i < 0 || j < 0 || i >= NATURE.res || j >= NATURE.res ) return 0;
	return data[ ( j * NATURE.res + i ) * NATURE.channels + ch ] / 127;
}

// position hash in 0..1: the erase decision must not use the scatter's random sequence (skipping
// a draw would change every plant after it)
export function hash01( x, z ) {
	let h = Math.imul( Math.floor( x * 8 ) | 0, 0x27d4eb2d ) ^ Math.imul( Math.floor( z * 8 ) | 0, 0x165667b1 );
	h = Math.imul( h ^ ( h >>> 15 ), 0x85ebca6b );
	h = Math.imul( h ^ ( h >>> 13 ), 0xc2b2ae35 );
	return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;
}

// true when the procedural plant / rock of channel ch at (x, z) is erased
export function erased( data, ch, x, z ) {
	const v = natureAt( data, ch, x, z );
	return v < 0 && hash01( x, z ) < - v;
}

// a sequence of its own for every painted texel and kind: painting somewhere else (or editing the
// relief) never reshuffles what was already painted
export function texelSeed( i, j, ch, salt ) {
	return ( Math.imul( i + 1, 73856093 ) ^ Math.imul( j + 1, 19349663 ) ^ Math.imul( ch + 1, 83492791 ) ^ salt ) >>> 0;
}

// every painted texel of a channel: fn( x0, z0, v ) with the texel's corner and value ( > 0 )
export function forPainted( data, ch, fn ) {
	if ( ! data ) return;
	const { res, channels, cell, x0, z0 } = NATURE;
	for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {
		const v = data[ ( j * res + i ) * channels + ch ];
		if ( v > 0 ) fn( x0 + i * cell, z0 + j * cell, v / 127, i, j );
	}
}
