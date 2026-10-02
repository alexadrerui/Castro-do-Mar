// The sea's planar reflection on a budget: captured every `interval` ms (and at once when the camera
// moves more than TRAVEL m since the last capture), sampled in between through the camera the capture
// was taken with. Port of water/PlanarReprojection.js and water/ReflectionBudget.js of Drusniel: Gods'
// End (https://github.com/danielsobrado/drusniel-gods-end, MIT, Copyright (c) 2026 Daniel Sobrado,
// licenses/LICENSE-Drusniel.md). Changes: one surface, so no capture gate between surfaces; the
// budget lives in the reflector's own updateBefore; the travel trigger replaces their travel interval.
//
// Their explanation: budgeted planar captures go stale between refreshes. Sampling them by screen
// position makes the reflection swim as soon as the view turns, so the water instead projects the
// direction of its reflected ray through the rotation of the virtual camera the capture was taken
// with, treating what the ray sees as distant. A fresh capture samples exactly as before, rotation
// stays exact, and moving leaves a parallax error of about the distance moved over the reflected
// object's distance until the next capture. The capture is taken with a wider field of view so
// turning does not immediately run off its edge; outside it the weight falls to 0 (the water shows
// its own body colour there).
import * as THREE from 'three/webgpu';
import { cameraPosition, float, max, positionWorld, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';

const OVERSCAN = [ 1.35, 1.15 ]; // wide screens run out of capture sideways long before vertically
const TRAVEL = 2;                // m: a camera this far from the last capture takes a new one
const _saved = new THREE.Matrix4();

export class PlanarReprojection {
	// reflectorNode: TSL reflector(); interval: ms between captures (0: every frame)
	constructor( reflectorNode, { interval = 100 } = {} ) {
		this.reflector = reflectorNode.reflector ?? reflectorNode;
		this.viewProjection = uniform( new THREE.Matrix4() );
		this.valid = uniform( 0 );
		this.interval = interval;
		this.last = - Infinity;
		this.lastPos = new THREE.Vector3( Infinity, 0, 0 );
		this.captures = 0; this.skipped = 0;
		const R = this.reflector, update = R.updateBefore.bind( R );
		this._update = update;
		R.updateBefore = ( frame ) => {
			// captured before the scene pass this frame (captureBefore): nothing to do inside it
			if ( this.external ) { this.external = false; return; }
			const now = performance.now(), cam = frame.camera;
			const fresh = now - this.last < this.interval && cam.position.distanceTo( this.lastPos ) < TRAVEL;
			if ( fresh && R.hasOutput ) { this.skipped ++; return; }
			this.capture( cam, () => update( frame ) );
			this.last = now; this.lastPos.copy( cam.position );
			this.captures ++;
		};
	}

	// the budgeted capture outside the scene pass, right before it (main.js app.renderFrame): a capture
	// nested in the scene pass wrote the mirrored camera into the "render" uniform buffer that three
	// shares between materials, after the scene pass had written its own for that render. frame:
	// { renderer, scene, camera, material } (the water's material, hidden during the capture)
	captureBefore( frame ) {
		const R = this.reflector, now = performance.now(), cam = frame.camera;
		const fresh = now - this.last < this.interval && cam.position.distanceTo( this.lastPos ) < TRAVEL;
		this.external = true;
		if ( fresh && R.hasOutput ) { this.skipped ++; return; }
		this.capture( cam, () => this._update( frame ) );
		this.last = now; this.lastPos.copy( cam.position );
		this.captures ++;
	}

	// the next frame captures again (a cut, a screenshot)
	invalidate() { this.last = - Infinity; }

	// one capture with a widened frustum; records the virtual camera it was taken with
	capture( camera, render ) {
		const projection = camera.projectionMatrix;
		_saved.copy( projection );
		const e = projection.elements;
		for ( const i of [ 0, 4, 8, 12 ] ) e[ i ] /= OVERSCAN[ 0 ];
		for ( const i of [ 1, 5, 9, 13 ] ) e[ i ] /= OVERSCAN[ 1 ];
		try {
			render();
		} finally {
			projection.copy( _saved );
		}
		if ( ! this.reflector.hasOutput ) { this.valid.value = 0; return; }
		const virtual = this.reflector.getVirtualCamera( camera );
		this.viewProjection.value.multiplyMatrices( virtual.projectionMatrix, virtual.matrixWorldInverse );
		this.valid.value = 1;
	}

	// capture uv of the fragment and a 0..1 weight that falls to 0 well outside the capture
	uvNode() {
		// mirrored ray from the mirrored camera through the mirrored surface point; w = 0 keeps only
		// the capture camera's rotation
		const ray = positionWorld.sub( cameraPosition ).mul( vec3( 1, - 1, 1 ) );
		const clip = this.viewProjection.mul( vec4( ray, 0 ) );
		const ndc = clip.xy.div( clip.w.max( 1e-4 ) );
		const uv = vec2( ndc.x.mul( 0.5 ).add( 0.5 ), ndc.y.mul( - 0.5 ).add( 0.5 ) );
		const outside = uv.sub( 1 ).max( uv.negate() ).max( 0 );
		const weight = float( 1 ).sub( smoothstep( 0.04, 0.3, max( outside.x, outside.y ) ) )
			.mul( clip.w.greaterThan( 0 ).select( float( 1 ), float( 0 ) ) )
			.mul( this.valid );
		return { uv, weight };
	}
}
