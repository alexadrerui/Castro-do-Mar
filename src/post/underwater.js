import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, vec4, exp, mix, smoothstep, screenUV, If, max } from 'three/tsl';

// Simple underwater look for when the camera dives below WATER_LEVEL: the whole view switches
// to the water medium (no split at the waterline).
//  - light reaching a point: absorbed along its way down from the surface (per channel, red
//    first), so deeper ground and seabed life get darker and bluer-green whatever the camera
//    depth (the world position is rebuilt from the depth buffer);
//  - the view leg: absorbed with distance and faded into a green-blue murk (Beer-Lambert);
//  - the murk itself is darker the deeper the camera is. The water plane is one-sided, so from
//    below the "sky" is the far murk, lit a little brighter toward the top of the screen.
const ABSORB = [ 0.42, 0.11, 0.08 ]; // 1/m, view leg, per channel (cold, green Atlantic coastal water)
const LIGHT_ABSORB = [ 0.16, 0.055, 0.05 ]; // 1/m, sunlight going down to the point
const SCATTER = 0.07; // 1/m: visibility of roughly 30-40 m
const DEPTH_FALLOFF = 0.06; // 1/m: murk light lost per metre below the surface
const UNDER_FAR = 90; // m: camera far plane while under water

export class Underwater {

	constructor( scenePass, waterLevel = 0 ) {

		this.on = uniform( 0 ).setName( 'uwOn' );
		this.depth = uniform( 0 ).setName( 'uwDepth' ); // camera depth below the surface (m)
		this.murk = uniform( new THREE.Color( 0x1d4f52 ) ).setName( 'uwMurk' ); // lit water colour
		this.viewZ = scenePass.getViewZNode();
		this.waterLevel = waterLevel;
		// explicit scene-camera uniforms: inside the post pass the built-in camera nodes refer to
		// the full-screen quad camera
		this.camWorld = uniform( new THREE.Matrix4() ).setName( 'uwCamWorld' );
		this.projInv = uniform( new THREE.Matrix4() ).setName( 'uwProjInv' );

	}

	update( camera, waterLevel = this.waterLevel ) {

		const d = waterLevel - camera.position.y;
		// under water nothing shows beyond ~80 m (the murk leaves < 0.5 %): a near far plane culls
		// the village, the mountains and the horizon (the depth buffer's far value reads as murk)
		const under = d > 0;
		if ( under !== this._under ) {

			if ( under ) {

				this._far = camera.far;
				camera.far = UNDER_FAR;

			} else if ( this._far ) camera.far = this._far;
			camera.updateProjectionMatrix();
			this._under = under;

		}

		this.on.value = under ? 1 : 0;
		this.depth.value = Math.max( d, 0 );
		this.waterLevel = waterLevel;
		if ( d > 0 ) {

			camera.updateMatrixWorld();
			this.camWorld.value.copy( camera.matrixWorld );
			this.projInv.value.copy( camera.projectionMatrixInverse );

		}

	}

	// daylight from the haze colour (already dimmed at dusk / night)
	setDaylight( hazeColor ) {

		this.murk.value.copy( hazeColor ).multiply( _tint );

	}

	// rgb: linear scene colour of this pixel -> colour seen through the water
	apply( rgb ) {

		const on = this.on, depth = this.depth, murk = this.murk, viewZ = this.viewZ;
		const camWorld = this.camWorld, projInv = this.projInv, W = this.waterLevel;
		return Fn( () => {

			const col = vec3( rgb ).toVar();
			If( on.greaterThan( 0.5 ), () => {

				const vz = viewZ.min( - 1e-3 );
				const dist = vz.negate().min( 400 );
				// world position of this pixel: the view ray through it, scaled to its depth
				const ndc = vec2( screenUV.x.mul( 2 ).sub( 1 ), screenUV.y.mul( - 2 ).add( 1 ) );
				const ray = projInv.mul( vec4( ndc, 1, 1 ) );
				const dirV = ray.xyz.div( ray.w );
				const posV = dirV.mul( vz.div( dirV.z ) );
				const posW = camWorld.mul( vec4( posV, 1 ) ).xyz;
				const pointDepth = max( float( W ).sub( posW.y ), 0 ).min( 60 );
				const lightDown = exp( vec3( ...LIGHT_ABSORB ).mul( pointDepth ).negate() );
				const trans = exp( vec3( ...ABSORB ).mul( dist ).negate() );
				const fogAmt = float( 1 ).sub( exp( dist.mul( - SCATTER ) ) );
				const light = exp( depth.mul( - DEPTH_FALLOFF ) );
				// brighter toward the top of the screen (screenUV.y = 0 at the top)
				const glow = mix( float( 1.35 ), float( 0.55 ), smoothstep( 0.0, 1.0, screenUV.y ) );
				const water = vec3( murk ).mul( light ).mul( glow );
				col.assign( mix( col.mul( lightDown ).mul( trans ), water, fogAmt ) );

			} );
			return col;

		} )();

	}

}

const _tint = new THREE.Color( 0.3, 0.62, 0.6 );
