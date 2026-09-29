import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

// Auto-focus depth of field: whatever is under the screen centre becomes the
// focal plane. When the camera gets close to something (< NEAR m) the
// background falls out of focus; far away the image stays sharp.
// Click to focus: focusAt( ndc ) casts the same ray through a point of the
// screen and locks the focus on the world point it hits (the lens keeps
// that point sharp while the camera moves); a click on the sky, a point that
// leaves the view or release() go back to the screen centre.
const NEAR = 45;          // start of the effect (m)
const FULL = 22;          // full effect at this distance or closer (m)
const MAX_RAY = 140;

export class AutoFocus {

	constructor( { camera, hf, scenePass, targets, instanced = [] } ) {
		this.instancedRoots = instanced;
		this._near = [];
		this.camera = camera;
		this.hf = hf;
		this.enabled = true;
		this.focusDistance = uniform( 30 );
		this.focalLength = uniform( 8 );
		this.bokeh = uniform( 0 );
		this.node = dof( scenePass, scenePass.getViewZNode(), this.focusDistance, this.focalLength, this.bokeh );

		// BVH-accelerated picking on the big merged meshes (houses, fort, rock)
		this.targets = [];
		for ( const root of targets ) root.traverse( ( o ) => {
			if ( ! o.isMesh || o.isInstancedMesh || o.userData.instances || ! o.geometry?.attributes.position ) return;
			o.geometry.boundsTree = new MeshBVH( o.geometry );
			o.raycast = acceleratedRaycast;
			this.targets.push( o );
		} );
		this.ray = new THREE.Raycaster();
		this.ray.firstHitOnly = true;
		this.ray.layers.enable( 1 ); // the boulders are layer-1 props
		this.ray.far = MAX_RAY;
		this.hit = MAX_RAY;          // last measured distance
		this.amount = 0;             // 0..1 effect strength (smoothed)
		this._t = 0;
		this._v = new THREE.Vector3();
		this.lock = null;            // locked world point (click to focus) or null
		this._ndc = new THREE.Vector2();
	}

	// Distance to the first surface under the screen point ndc (default: the centre).
	measure( ndc = this._ndc.set( 0, 0 ) ) {
		const cam = this.camera;
		this.ray.setFromCamera( ndc, cam );
		let best = MAX_RAY;
		let hits = this.ray.intersectObjects( this.targets, false );
		if ( hits.length ) best = hits[ 0 ].distance;
		// instanced trees / boulders: only visible tiles close to the camera
		const near = this._near; near.length = 0;
		for ( const root of this.instancedRoots ) root.traverse( ( o ) => {
			// chunked tiles (core/chunked.js): meshes with per-instance raycast
			if ( ! o.userData.instances || ! o.visible ) return;
			if ( /^(grass|gravel)/.test( o.parent?.name || '' ) ) return; // ground clutter never takes focus
			const bs = o.geometry.boundingSphere;
			if ( bs.center.distanceTo( cam.position ) - bs.radius < 80 ) near.push( o );
		} );
		this.ray.far = best;
		hits = this.ray.intersectObjects( near, false );
		this.ray.far = MAX_RAY;
		if ( hits.length && hits[ 0 ].distance < best ) best = hits[ 0 ].distance;
		// march the heightfield for the terrain
		const o = this.ray.ray.origin, d = this.ray.ray.direction, p = this._v;
		for ( let t = 0.5; t < best; t += Math.max( 0.35, t * 0.03 ) ) {
			p.copy( o ).addScaledVector( d, t );
			if ( p.y <= this.hf.heightAt( p.x, p.z ) ) { best = t; break; }
		}
		return best;
	}

	// Click to focus: lock on the surface under the screen point ndc (x, y in -1..1).
	// Returns the locked point, or null (nothing within reach: back to the centre).
	focusAt( x, y ) {
		const d = this.measure( this._ndc.set( x, y ) );
		if ( d >= MAX_RAY ) { this.release(); return null; }
		this.lock = this.ray.ray.origin.clone().addScaledVector( this.ray.ray.direction, d );
		this.hit = d;
		return this.lock;
	}

	release() {
		this.lock = null;
		this._t = 1; // measure the centre right away
	}

	// the locked point in normalized device coordinates (null if none or behind the camera)
	lockNDC( out = new THREE.Vector3() ) {
		if ( ! this.lock ) return null;
		out.copy( this.lock ).project( this.camera );
		return out.z < 1 && Math.abs( out.x ) <= 1.05 && Math.abs( out.y ) <= 1.05 ? out : null;
	}

	update( dt ) {
		this._t += dt;
		if ( this.lock ) {
			// the locked point leaves the view: back to the screen centre
			if ( ! this.lockNDC( this._v ) ) this.release();
			else this.hit = Math.min( MAX_RAY, this.camera.position.distanceTo( this.lock ) );
		}
		if ( ! this.lock && this._t > 0.08 ) { this._t = 0; this.hit = this.measure(); }
		const target = this.enabled ? 1 - THREE.MathUtils.smoothstep( this.hit, FULL, NEAR ) : 0;
		this.amount += ( target - this.amount ) * Math.min( 1, dt * 4 );
		// rack focus smoothly, like a lens
		const f = this.focusDistance.value;
		this.focusDistance.value = f + ( this.hit - f ) * Math.min( 1, dt * 7 );
		// depth of the in-focus zone grows with distance
		this.focalLength.value = 1.0 + this.focusDistance.value * 0.2;
		this.bokeh.value = this.amount * 3.4;
	}
}
