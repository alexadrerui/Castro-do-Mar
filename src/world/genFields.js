// The generated fields of a cold load (no IndexedDB cache): heightfield, splat mask, macro noise and
// AO, in bands of rows over a pool of workers (gen.worker.js). Phase 1 is independent work (the
// relief, the mask, the macro noise); phase 2 the AO, which reads the whole relief. In one worker,
// one after the other, they took ~7 s; the bands come out identical to a single pass.
import { HeightField, MACRO_RES } from './heightfield.js';
import { MASK } from './layout.js';

// [ j0, j1 ) bands covering 0..n
const bands = ( n, k ) => Array.from( { length: k }, ( _, i ) => [ Math.round( i * n / k ), Math.round( ( i + 1 ) * n / k ) ] );

function createPool( size ) {
	const workers = Array.from( { length: size }, () => new Worker( new URL( './gen.worker.js', import.meta.url ), { type: 'module' } ) );
	const idle = [ ...workers ], queue = [];
	const pump = () => {
		while ( idle.length && queue.length ) {
			const w = idle.pop(), t = queue.shift();
			w.onmessage = ( e ) => {
				if ( e.data.type === 'progress' ) return t.onProgress( e.data.p );
				idle.push( w );
				t.resolve( e.data.data );
				pump();
			};
			w.onerror = ( err ) => t.reject( err );
			w.postMessage( t.msg );
		}
	};
	return {
		run: ( msg, onProgress ) => new Promise( ( resolve, reject ) => { queue.push( { msg, onProgress, resolve, reject } ); pump(); } ),
		terminate: () => workers.forEach( ( w ) => w.terminate() )
	};
}

// loader: the load screen (ui/loader.js; its steps run at the same time); edits: the hand edits of
// the relief, added before the AO; world: the object edits. Returns { height, mask, macro, ao }.
export async function generateFields( { loader, edits, world } ) {
	const size = Math.max( 2, Math.min( 4, ( navigator.hardwareConcurrency || 4 ) - 1 ) );
	const pool = createPool( size );
	const hf = new HeightField();
	const n = hf.n, mres = MASK.res;
	// one step of the load screen over several bands: its progress is their mean
	const split = ( id, list, msg, join ) => loader.run( id, async ( p ) => {
		const ps = list.map( () => 0 );
		const parts = await Promise.all( list.map( ( [ j0, j1 ], k ) => pool.run( { ...msg, j0, j1, world }, ( v ) => {
			ps[ k ] = v;
			p( ps.reduce( ( a, b ) => a + b, 0 ) / ps.length );
		} ) ) );
		return join( parts );
	} );
	const concat = ( Type, length ) => ( parts ) => {
		const out = new Type( length );
		let o = 0;
		for ( const a of parts ) { out.set( a, o ); o += a.length; }
		return out;
	};
	try {
		// phase 1: the relief first in the queue (phase 2 waits for it), then the mask and the macro noise
		const height = split( 'height', bands( n, size ), { cmd: 'height' }, concat( Float32Array, n * n ) );
		const mask = split( 'mask', bands( mres, size ), { cmd: 'mask' }, concat( Uint8Array, mres * mres * 4 ) );
		const macro = split( 'macro', bands( MACRO_RES, 2 ), { cmd: 'macro' }, concat( Uint8Array, MACRO_RES * MACRO_RES * 4 ) );
		const h = await height;
		// hand edits of the relief (world/terrainEdits.js), before the AO reads the heights
		if ( edits && edits.length === h.length ) for ( let k = 0; k < h.length; k ++ ) h[ k ] += edits[ k ];
		// phase 2: the AO over the full relief
		const ao = split( 'ao', bands( n, size ), { cmd: 'ao', height: h }, concat( Float32Array, n * n ) );
		return { height: h, mask: await mask, macro: await macro, ao: await ao };
	} finally {
		pool.terminate();
	}
}
