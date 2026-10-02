// Adapted from Tidewater (https://github.com/dgreenheck/tidewater, src/fx/MarineSnow.js,
// three.js version at d32799f). MIT License, Copyright (c) 2026 DRG Software Solutions LLC.
// Changes: the FFT swell is replaced by an analytic swell (one long wave from the sea side), the
// light comes from our haze colour, no flashlight, no motion-vector MRT.
import * as THREE from 'three/webgpu';
import {
	Fn, uniform, float, vec3, vec4, instanceIndex, positionGeometry, cameraViewMatrix, cameraProjectionMatrix,
	fract, sin, cos, exp, smoothstep, length, max, mix, varyingProperty, uv, If, Discard, time,
} from 'three/tsl';

const hash3 = ( n ) => fract( sin( vec3( n, n.add( 17.13 ), n.add( 43.71 ) ) ).mul( vec3( 43758.5453, 22578.1459, 19642.3490 ) ) );

// swell: arrives from the open sea to the east (+X), travelling west
const SWELL_LEN = 60; // m
const SWELL_PERIOD = 8; // s
const SWELL_AMP = 0.35; // m: orbital radius at the surface

// Suspended particles in the water around the camera (marine snow, plankton, sand grains).
// Positions are procedural (hash of the instance) inside a box that wraps around the camera, so
// there is no simulation and no CPU work. The particles drift with a slow current and sway back
// and forth with the orbital motion of the passing swell (decaying with depth). Only drawn while
// the camera is under water. The specks are tiny depth-writing discs in the opaque pass, so the
// underwater fog (post/underwater.js) treats each one at its own distance.
export class MarineSnow {

	constructor( { count = 12000, box = 8, waterLevel = 0 } = {} ) {

		this.box = box;
		this.camPos = uniform( new THREE.Vector3() ).setName( 'snowCam' );
		this.light = uniform( new THREE.Color( 0.6, 0.7, 0.8 ) ).setName( 'snowLight' ); // daylight at the surface
		this.opacity = uniform( 1 ).setName( 'snowOpacity' );
		this.level = uniform( waterLevel ).setName( 'snowLevel' ); // the water level over the camera (sea, lake or river)

		const geo = new THREE.PlaneGeometry( 1, 1 );
		const inst = new THREE.InstancedBufferGeometry();
		inst.index = geo.index;
		inst.setAttribute( 'position', geo.getAttribute( 'position' ) );
		inst.setAttribute( 'uv', geo.getAttribute( 'uv' ) );
		inst.instanceCount = count;

		const mat = new THREE.MeshBasicNodeMaterial();
		mat.name = 'MarineSnow';
		mat.fog = false; // the underwater post pass does the water fog

		const vFade = varyingProperty( 'float', 'vSnowFade' );
		
		mat.vertexNode = Fn( () => {

			const id = float( instanceIndex );
			const h = hash3( id.mul( 0.7131 ) );
			const h2 = hash3( id.mul( 1.3917 ).add( 5.1 ) );
			const B = float( box );
			// slow current + sinking, wrapped into the camera box
			const drift = vec3( 0.05, - 0.012, 0.03 ).mul( time ).add( h2.sub( 0.5 ).mul( time.mul( 0.02 ) ) );
			const local = fract( h.add( drift.div( B ) ).sub( this.camPos.div( B ) ) ).sub( 0.5 ).mul( B );
			const p = this.camPos.add( local ).toVar();
			// orbital sway from the passing swell (decays ~exp(-k z) with depth)
			const depth = max( this.level.sub( p.y ), 0 );
			const k = 2 * Math.PI / SWELL_LEN;
			const phase = p.x.mul( k ).add( time.mul( 2 * Math.PI / SWELL_PERIOD ) );
			const orbit = exp( depth.mul( - k ) ).mul( SWELL_AMP );
			p.addAssign( vec3( cos( phase ), sin( phase ).mul( 0.5 ), 0 ).mul( orbit ) );

			// camera-facing quad, 3-8 mm (a few flecks larger)
			const size = mix( 0.003, 0.008, h2.x.mul( h2.x ) ).add( h2.y.greaterThan( 0.98 ).select( 0.008, 0 ) );
			const pv0 = cameraViewMatrix.mul( vec4( p, 1 ) );
			// fade in the box edges and right in front of the lens (by shrinking), and above the surface
			const dist = length( local );
			const fade = smoothstep( B.mul( 0.5 ), B.mul( 0.3 ), dist ).mul( smoothstep( 0.08, 0.3, pv0.z.negate() ) )
				.mul( smoothstep( 0.0, 0.04, this.level.sub( p.y ) ) );
			const pv = vec4( pv0.xy.add( positionGeometry.xy.mul( size ).mul( fade ) ), pv0.z, pv0.w );
			vFade.assign( fade );
			return cameraProjectionMatrix.mul( pv );

		} )();

		mat.colorNode = Fn( () => {

			const r = length( uv().sub( 0.5 ) ).mul( 2 );
			If( r.greaterThan( 1 ).or( vFade.lessThan( 0.02 ) ), () => {

				Discard();

			} );
			// lit by daylight, slightly greenish-white (organic matter); the underwater pass absorbs
			// the light on its way down to the speck and on to the camera
			const lit = vec3( this.light ).mul( 0.9 );
			const col = lit.mul( vec3( 0.9, 1.0, 0.95 ) ).mul( mix( 1.3, 0.8, r ) ).mul( this.opacity );
			return vec4( col, 1 );

		} )();

		this.mesh = new THREE.Mesh( inst, mat );
		this.mesh.name = 'marineSnow';
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;

	}

	update( camera, underwater, level = this.level.value ) {

		this.mesh.visible = underwater;
		this.level.value = level;
		if ( underwater ) this.camPos.value.copy( camera.position );

	}

}
