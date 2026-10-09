import * as THREE from 'three/webgpu';
import {
	Fn, Loop, float, vec2, vec3, vec4, uniform, screenUV, screenCoordinate, interleavedGradientNoise, rtt, exp, length, min
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { isSky } from '../core/depth.js';

// Sun shafts (god rays) as screen-space light scattering (Mitchell, "Volumetric Light Scattering
// as a Post-Process", GPU Gems 3, ch. 13). The light source is the sky visible around the sun:
// the sky pixels of the scene pass, weighted by their closeness to the sun on screen, so the
// mountains, the clouds, the tree crowns and the houses in front of it cut the shafts. That source,
// at reduced resolution, is blurred radially towards the sun with a decaying weight and added to
// the HDR scene before tone mapping. Fades out when the sun leaves the screen or sets.
// (three's GodraysNode is a different effect: in-scattering raymarched through the shadow map,
// limited to the shadow camera's box around the village.)

const _v = /*@__PURE__*/ new THREE.Vector3();

export class Godrays {

	// scenePass: the scene pass (colour and depth); sunDir: direction towards the sun (world)
	constructor( { scenePass, sunDir, resolutionScale = 0.33, samples = 48 } ) {
		this.sunDir = sunDir;
		this.strength = uniform( 0.8 );  // 0 = off (3.5 turned the whole frame white facing the sun)
		this.decay = uniform( 0.97 );     // per sample, along the ray
		this.length = uniform( 0.9 );     // fraction of the way to the sun the ray reaches
		this.falloff = uniform( 7 );      // how fast the source fades away from the sun (screen units)
		this.tint = uniform( new THREE.Color( 1.0, 0.86, 0.68 ) );
		this.sunUV = uniform( new THREE.Vector2( 0.5, 0.5 ) );
		this.visible = uniform( 0 );      // view-dependent fade (update)
		this.aspect = uniform( 16 / 9 );

		const color = scenePass.getTextureNode();
		const depth = scenePass.getTextureNode( 'depth' );

		// source: the sky only, brightest at the sun (the disc itself clamped: fp16 and no spikes)
		const source = Fn( () => {
			const sky = isSky( depth.sample( screenUV ).r ).select( float( 1 ), float( 0 ) );
			const d = length( screenUV.sub( this.sunUV ).mul( vec2( this.aspect, 1 ) ) );
			const c = min( color.sample( screenUV ).rgb, vec3( 4 ) );
			return vec4( c.mul( sky ).mul( exp( d.mul( this.falloff ).negate() ) ), 1 );
		} );
		this.source = rtt( source(), null, null, { type: THREE.HalfFloatType, resolutionScale } );

		// radial blur towards the sun (dithered start: fewer samples without banding)
		const rays = Fn( () => {
			const delta = screenUV.sub( this.sunUV ).mul( this.length.div( samples ) );
			const p = screenUV.sub( delta.mul( interleavedGradientNoise( screenCoordinate.xy ) ) ).toVar();
			const w = float( 1 ).toVar();
			const acc = vec3( 0 ).toVar();
			Loop( samples, () => {
				p.subAssign( delta );
				acc.addAssign( this.source.sample( p ).rgb.mul( w ) );
				w.mulAssign( this.decay );
			} );
			return vec4( acc.div( samples ), 1 );
		} );
		this.pass = rtt( rays(), null, null, { type: THREE.HalfFloatType, resolutionScale } );
		// soften the remaining noise (same low resolution: cheap)
		this.smooth = gaussianBlur( this.pass, vec2( 1 ), 2, { resolutionScale } );
	}

	// camera: the main camera. Puts the sun on screen and fades the shafts with the angle between
	// the view and the sun (only when looking towards it) and with the sun's height.
	update( camera, sunUp = 1 ) {
		_v.copy( camera.position ).addScaledVector( this.sunDir, 1000 ).project( camera );
		this.sunUV.value.set( _v.x * 0.5 + 0.5, 0.5 - _v.y * 0.5 );
		this.aspect.value = camera.aspect;
		camera.getWorldDirection( _v );
		const facing = THREE.MathUtils.smoothstep( _v.dot( this.sunDir ), 0.15, 0.6 );
		this.visible.value = facing * sunUp;
	}

	// src: the scene colour (HDR); returns it with the shafts added
	apply( src ) {
		return src.add( this.smooth.rgb.mul( this.tint ).mul( this.strength.mul( this.visible ) ) );
	}

}
