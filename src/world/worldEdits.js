// Hand edits of the village objects (src/editor/objectEditor.js): houses, market stalls and props
// moved, turned, resized, removed or added. Stored in the project as public/world-edits.json; the
// dev server reads and writes it (vite.config.js, /__world-edits). Applied to the layout lists
// (BUILDINGS, STALLS, PROPS of layout.js) before anything reads them, in the page and in the
// generator worker, so the building pads in the relief, the trampled ground of the mask, the
// vegetation clearance and the bird perches all follow the edited village.
//
//   {
//     "objects": { "b3": { "x": -40, "z": 12, "yaw": 0.4, "scale": 1.2 }, "s5": { "removed": true } },
//     "added": [ { "id": "a0", "kind": "building", "type": "round", "x": 10, "z": 40, "r": 5, "seed": 100, "yaw": 0, "scale": 1 } ],
//     "lakes": [ { "x": -18, "z": -48 } ]
//   }
// lakes: the points where the terrain editor's "Encher" poured water (world/lakeWater.js fills each
// hollow up to its spill height on every load, so editing the relief reshapes the lake).
// Ids: b<i> = BUILDINGS[ i ], s<i> = STALLS[ i ], p<i> = PROPS[ i ] (indices of the original lists),
// a<n> = an added object. yaw is a turn added to the object's own rotation, scale is uniform.
import { BUILDINGS, STALLS, PROPS } from './layout.js';

export const WORLD_EDITS_URL = ( import.meta.env?.BASE_URL ?? '/' ) + 'world-edits.json';

export const emptyWorldEdits = () => ( { objects: {}, added: [], lakes: [] } );

// the edits, or null when there are none
export async function loadWorldEdits() {
	for ( const url of [ '/__world-edits', WORLD_EDITS_URL ] ) {
		try {
			const res = await fetch( url, { cache: 'no-store' } );
			if ( ! res.ok || ! /json/.test( res.headers.get( 'content-type' ) || '' ) ) continue;
			const e = await res.json();
			if ( ! e || typeof e !== 'object' ) return null;
			const lakes = Array.isArray( e.lakes ) ? e.lakes.filter( ( l ) => Number.isFinite( l?.x ) && Number.isFinite( l?.z ) ) : [];
			const out = { objects: e.objects || {}, added: Array.isArray( e.added ) ? e.added : [], lakes };
			return Object.keys( out.objects ).length || out.added.length || lakes.length ? out : null;
		} catch ( err ) { /* try the next */ }
	}
	return null;
}

export function hashWorldEdits( e ) {
	if ( ! e ) return 'none';
	const s = JSON.stringify( e );
	let h = 0x811c9dc5;
	for ( let i = 0; i < s.length; i ++ ) { h ^= s.charCodeAt( i ); h = Math.imul( h, 0x01000193 ); }
	return ( h >>> 0 ).toString( 16 ).padStart( 8, '0' );
}

let applied = false;

// Applies the edits to the layout lists, once per module instance (page and worker each have one).
// Every entry gets an `_id`. BUILDINGS and PROPS lose their removed entries; STALLS keep them with
// `removed` set, because the stalls share one random sequence and a removed stall must still use
// up its numbers (or every later stall would change).
export function applyWorldEdits( edits ) {
	if ( applied ) return;
	applied = true;
	BUILDINGS.forEach( ( b, i ) => { b._id = 'b' + i; } );
	STALLS.forEach( ( s, i ) => { s._id = 's' + i; } );
	PROPS.forEach( ( p, i ) => { p._id = 'p' + i; } );
	if ( ! edits ) return;
	const mod = edits.objects || {};
	// an edit names its object by the index in the original list; the original position it was made
	// on (ox, oz) guards against a layout.js list edited since (the edit would go to another object)
	const matches = ( entry, m, isStall ) => {
		if ( ! Number.isFinite( m.ox ) ) return true;
		const x = isStall ? entry[ 0 ] : entry.x, z = isStall ? entry[ 1 ] : entry.z;
		if ( Math.hypot( x - m.ox, z - m.oz ) < 0.5 ) return true;
		console.warn( `world edits: ${ entry._id } is not at ( ${ m.ox }, ${ m.oz } ) any more (layout.js changed?); edit ignored` );
		return false;
	};
	const set = ( entry, m, isStall ) => {
		if ( ! matches( entry, m, isStall ) ) return;
		if ( Number.isFinite( m.door ) ) entry.door = m.door;
		if ( Number.isFinite( m.x ) ) { if ( isStall ) entry[ 0 ] = m.x; else entry.x = m.x; }
		if ( Number.isFinite( m.z ) ) { if ( isStall ) entry[ 1 ] = m.z; else entry.z = m.z; }
		if ( Number.isFinite( m.yaw ) ) entry.yaw = m.yaw;
		if ( Number.isFinite( m.scale ) && m.scale > 0 ) entry.scale = m.scale;
		if ( m.removed ) entry.removed = true;
	};
	for ( const b of BUILDINGS ) if ( mod[ b._id ] ) set( b, mod[ b._id ], false );
	for ( const s of STALLS ) if ( mod[ s._id ] ) set( s, mod[ s._id ], true );
	for ( const p of PROPS ) if ( mod[ p._id ] ) set( p, mod[ p._id ], false );
	const drop = ( list ) => { for ( let i = list.length - 1; i >= 0; i -- ) if ( list[ i ].removed ) list.splice( i, 1 ); };
	drop( BUILDINGS ); drop( PROPS );
	for ( const a of edits.added || [] ) {
		if ( ! a || ! Number.isFinite( a.x ) || ! Number.isFinite( a.z ) ) continue;
		if ( a.kind === 'building' ) BUILDINGS.push( { ...a, _id: a.id } );
		else if ( a.kind === 'prop' ) PROPS.push( { ...a, _id: a.id } );
		else if ( a.kind === 'stall' ) {
			const s = [ a.x, a.z, a.rot || 0 ];
			Object.assign( s, { _id: a.id, yaw: a.yaw, scale: a.scale, seed: a.seed, red: a.red !== false, added: true } );
			STALLS.push( s );
		}
	}
}
