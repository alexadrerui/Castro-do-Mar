// Plants and rocks placed by hand: the object editor's library (editor/catalogue.js, kinds 'plant' and
// 'rock') adds them to world-edits.json with the other added objects:
//   { id: 'a3', kind: 'plant', species: 'oak', s: 1, x, z, yaw, scale, seed }
//   { id: 'a4', kind: 'rock', rock: 'tor0', s: 2.4, x, z, yaw, scale, seed }
// world/worldEdits.js leaves these kinds alone (they are not houses, stalls nor props: no pad, no
// clearing). vegetation.js and rocks.js register here what each one is drawn with (the species' or the
// rock style's ChunkedInstances, its tint from the seed, how deep it stands in the ground) and, on a
// normal load, add the placed ones to those instances (addPlaced): the same draws as the rest. In the
// editor (?edit) they are left out there and objectEditor.js makes each one a group of its own (the
// chunk's single(): same material and pipeline) to move, turn, resize and remove.
import * as THREE from 'three/webgpu';

// 'plant:oak', 'rock:tor0' -> { chunk, tint( seed ) -> extra attribute, lift( size ) -> m above the ground,
// lo: the editor's group draws it with the far material (ChunkedInstances.single) }
export const placeables = {};

export const placeKey = ( e ) => e.kind === 'plant' ? 'plant:' + e.species : 'rock:' + e.rock;

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3( 0, 1, 0 );

// its transform from the point on the ground below it: sunk or lifted, turned by its yaw, sized
export function localMatrix( e, reg, out = new THREE.Matrix4() ) {
	const size = ( e.s || 1 ) * ( e.scale || 1 );
	_p.set( 0, reg.lift( size ), 0 );
	_q.setFromAxisAngle( _up, e.yaw || 0 );
	_s.setScalar( size );
	return out.compose( _p, _q, _s );
}

// a normal load: the placed ones of this kind into their instances (before build())
export function addPlaced( app, kind ) {
	if ( new URLSearchParams( location.search ).has( 'edit' ) ) return; // the editor makes groups of them
	const m = new THREE.Matrix4(), t = new THREE.Matrix4();
	for ( const e of app.worldEdits?.added ?? [] ) {
		if ( e?.kind !== kind || ! Number.isFinite( e.x ) || ! Number.isFinite( e.z ) ) continue;
		const reg = placeables[ placeKey( e ) ];
		if ( ! reg ) { console.warn( 'placed: unknown', placeKey( e ) ); continue; }
		localMatrix( e, reg, m ).premultiply( t.makeTranslation( e.x, app.hf.heightAt( e.x, e.z ), e.z ) );
		reg.chunk.add_( m, [ reg.tint( e.seed ?? 1 ) ] );
	}
}
