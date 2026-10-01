// The baked building surfaces (world/surfaceBake.js): from the IndexedDB cache (key: the hash of the
// bake code), or baked in a worker and stored. main.js starts this at the beginning of the load, so
// the ~3 s of a first bake run alongside the relief generation.
import { cacheGet, cachePut, hashSources } from '../core/cache.js';
import srcBake from './surfaceBake.js?raw';

export async function loadSurfaces() {
	const key = 'surfaces:' + hashSources( srcBake );
	const cached = await cacheGet( key );
	if ( cached?.stone?.data ) { console.info( 'surfaces: from cache', key ); return cached; }
	const raw = await new Promise( ( resolve, reject ) => {
		const w = new Worker( new URL( './surface.worker.js', import.meta.url ), { type: 'module' } );
		w.onmessage = ( e ) => { resolve( e.data ); w.terminate(); };
		w.onerror = reject;
		w.postMessage( 0 );
	} );
	console.info( 'surfaces: baked in', Math.round( raw.ms ), 'ms' );
	cachePut( key, raw, 'surfaces:' ).then( () => console.info( 'surfaces: cached', key ) );
	return raw;
}
