// From Tidewater (https://github.com/dgreenheck/tidewater, src/world/terrain/TerrainNoise.js,
// three.js version at d32799f). MIT License, Copyright (c) 2026 DRG Software Solutions LLC.

// integer lattice hash -> [0, 1)
export function hash2( i, j, s ) {

	let h = Math.imul( i, 374761393 ) + Math.imul( j, 668265263 ) + Math.imul( s, 1274126177 );
	h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
	h ^= h >>> 16;
	return ( h >>> 0 ) / 4294967296;

}
