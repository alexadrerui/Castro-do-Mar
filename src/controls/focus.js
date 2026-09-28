import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

// Auto-focus depth of field: whatever is under the screen centre becomes the
// focal plane. When the camera gets close to something (< NEAR m) the
// background falls out of focus; far away the image stays sharp.
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
			if ( ! o.isMesh || o.isInstancedMesh || ! o.geometry?.attributes.position ) return;
			o.geometry.boundsTree = new MeshBVH( o.geometry );
			o.raycast = acceleratedRaycast;
			this.targets.push( o );
		} );
		this.ray = new THREE.Raycaster();
		this.ray.firstHitOnly = true;
		this.ray.far = MAX_RAY;
		this.hit = MAX_RAY;          // last measured distance
		this.amount = 0;             // 0..1 effect strength (smoothed)
		this._t = 0;
		this._v = new THREE.Vector3();
	}

	// Distance to the first surface under the screen centre.
	measure() {
		const cam = this.camera;
		this.ray.setFromCamera( new THREE.Vector2( 0, 0 ), cam );
		let best = MAX_RAY;
		let hits = this.ray.intersectObjects( this.targets, false );
		if ( hits.length ) best = hits[ 0 ].distance;
		// instanced trees / boulders: only visible tiles close to the camera
		const near = this._near; near.length = 0;
		for ( const root of this.instancedRoots ) root.traverse( ( o ) => {
			if ( ! o.isInstancedMesh || ! o.visible || ! o.boundingSphere ) return;
			if ( /^(grass|gravel)/.test( o.parent?.name || '' ) ) return; // ground clutter never takes focus
			if ( o.boundingSphere.center.distanceTo( cam.position ) - o.boundingSphere.radius < 80 ) near.push( o );
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

	update( dt ) {
		this._t += dt;
		if ( this._t > 0.08 ) { this._t = 0; this.hit = this.measure(); }
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
