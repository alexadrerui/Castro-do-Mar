// Hand edits of the relief (src/editor/terrainEditor.js): a grid of height differences, one per
// heightfield vertex (TERRAIN.segments + 1 squared, metres), added to the procedural relief before
// anything else reads it (the AO, the vegetation, the houses, the water depth). Stored in the
// project as public/terrain-edits.bin (raw little-endian float32); the dev server writes it
// (vite.config.js, POST /__terrain-edits). No file: no edits.
import { TERRAIN } from './layout.js';

export const EDITS_URL = ( import.meta.env?.BASE_URL ?? '/' ) + 'terrain-edits.bin'; // honours Vite's base (a site in a sub-path)
export const EDITS_N = TERRAIN.segments + 1;

// the edits, or null when there are none (or the file does not match the grid). In development
// the dev server reads the file itself (GET /__terrain-edits); a built site serves EDITS_URL.
export async function loadTerrainEdits() {
	for ( const url of [ '/__terrain-edits', EDITS_URL ] ) {
		try {
			const res = await fetch( url, { cache: 'no-store' } );
			// a missing file can come back as the index page (SPA fallback): binary only
			if ( ! res.ok || ! /octet-stream/.test( res.headers.get( 'content-type' ) || '' ) ) continue;
			const buf = await res.arrayBuffer();
			if ( buf.byteLength !== EDITS_N * EDITS_N * 4 ) {
				console.warn( `terrain edits: ${ url } has ${ buf.byteLength } bytes, expected ${ EDITS_N * EDITS_N * 4 }; ignored` );
				return null;
			}
			const d = new Float32Array( buf );
			for ( let k = 0; k < d.length; k ++ ) if ( d[ k ] !== 0 ) return d;
			return null; // all zero
		} catch ( e ) { /* try the next */ }
	}
	return null;
}

// FNV-1a over the bytes (part of the cache key of the generated fields)
export function hashEdits( d ) {
	if ( ! d ) return 'none';
	const b = new Uint8Array( d.buffer, d.byteOffset, d.byteLength );
	let h = 0x811c9dc5;
	for ( let i = 0; i < b.length; i ++ ) { h ^= b[ i ]; h = Math.imul( h, 0x01000193 ); }
	return ( h >>> 0 ).toString( 16 ).padStart( 8, '0' );
}
