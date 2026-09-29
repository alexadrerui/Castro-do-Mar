// Persistent cache of generated data (typed arrays) in IndexedDB.
// Entries are keyed by a hash of the SOURCE CODE that produces them, so any
// edit to the generators invalidates the cache on its own. `?nocache` in the
// URL bypasses it (always regenerates and does not store).

const DB = 'castro-do-mar';
const STORE = 'gen';
const disabled = new URLSearchParams( location.search ).has( 'nocache' );

let dbPromise = null;
function open() {
	if ( ! dbPromise ) dbPromise = new Promise( ( resolve ) => {
		try {
			const req = indexedDB.open( DB, 1 );
			req.onupgradeneeded = () => req.result.createObjectStore( STORE );
			req.onsuccess = () => resolve( req.result );
			req.onerror = () => resolve( null );
			req.onblocked = () => resolve( null );
		} catch ( e ) { resolve( null ); }
	} );
	return dbPromise;
}

function tx( mode, fn ) {
	return open().then( ( db ) => db && new Promise( ( resolve ) => {
		try {
			const t = db.transaction( STORE, mode );
			const req = fn( t.objectStore( STORE ) );
			t.oncomplete = () => resolve( req?.result ?? null );
			t.onerror = t.onabort = () => resolve( null );
		} catch ( e ) { resolve( null ); }
	} ) );
}

// FNV-1a 32 bits over one or more strings, as hex.
export function hashSources( ...sources ) {
	let h = 0x811c9dc5;
	for ( const s of sources ) for ( let i = 0; i < s.length; i ++ ) {
		h ^= s.charCodeAt( i );
		h = Math.imul( h, 0x01000193 );
	}
	return ( h >>> 0 ).toString( 16 ).padStart( 8, '0' );
}

export async function cacheGet( key ) {
	if ( disabled ) return null;
	return tx( 'readonly', ( s ) => s.get( key ) );
}

// Stores `value` under `key` and drops the other entries with the same prefix
// (older versions of the same data).
export async function cachePut( key, value, prefix ) {
	if ( disabled ) return;
	await tx( 'readwrite', ( s ) => {
		if ( prefix ) {
			const cur = s.openCursor();
			cur.onsuccess = () => {
				const c = cur.result;
				if ( ! c ) return;
				if ( typeof c.key === 'string' && c.key.startsWith( prefix ) && c.key !== key ) c.delete();
				c.continue();
			};
		}
		return s.put( value, key );
	} );
}

export async function cacheClear() {
	await tx( 'readwrite', ( s ) => s.clear() );
}
