import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, vec4, exp, mix, smoothstep, screenUV, If, max, min, sin, cos, length, pow, abs, mod, normalize, cross, dot, dFdx, dFdy, select, time } from 'three/tsl';

// Simple underwater look for when the camera dives below WATER_LEVEL: the whole view switches
// to the water medium (no split at the waterline).
//  - light reaching a point: absorbed along its way down from the surface (per channel, red
//    first), so deeper ground and seabed life get darker and bluer-green whatever the camera
//    depth (the world position is rebuilt from the depth buffer);
//  - the view leg: absorbed with distance and faded into a green-blue murk (Beer-Lambert);
//  - caustics: the waves focus the sunlight into a moving net of bright lines on everything that
//    faces up (the normal comes from the derivatives of the rebuilt position), projected along
//    the refracted sun direction, blurring out and fading with depth;
//  - the murk itself is darker the deeper the camera is. The surface seen from below is its own
//    mesh (world/waterUnderside.js); where nothing is hit, the far murk is lit a little brighter
//    toward the top of the screen.
const ABSORB = [ 0.42, 0.11, 0.08 ]; // 1/m, view leg, per channel (cold, green Atlantic coastal water)
const LIGHT_ABSORB = [ 0.16, 0.055, 0.05 ]; // 1/m, sunlight going down to the point
const SCATTER = 0.07; // 1/m: visibility of roughly 30-40 m
const DEPTH_FALLOFF = 0.06; // 1/m: murk light lost per metre below the surface
const UNDER_FAR = 90; // m: camera far plane while under water
const CAUSTIC_TILE = 3.2; // m: size of the caustic pattern tile
const CAUSTIC_STRENGTH = 1.3;
const CAUSTIC_FADE = 0.08; // 1/m: caustics lost per metre of depth (the net also blurs out)
const TAU = Math.PI * 2;

// Tileable water caustics (after Dave Hoskins' "Tileable Water Caustic", a common shadertoy
// pattern): a few iterations of a warped sine field; returns ~0 .. 1+ (bright lines on a dark
// field). uv in tiles, t in seconds.
const caustic = ( uv, t ) => {

	const p = mod( uv.mul( TAU ), TAU ).sub( 250 ).toVar();
	const i = vec2( p ).toVar();
	const c = float( 1 ).toVar();
	const inten = 0.005;
	for ( let n = 0; n < 4; n ++ ) {

		const tt = t.mul( 1 - 3.5 / ( n + 1 ) );
		i.assign( p.add( vec2( cos( tt.sub( i.x ) ).add( sin( tt.add( i.y ) ) ), sin( tt.sub( i.y ) ).add( cos( tt.add( i.x ) ) ) ) ) );
		c.addAssign( float( 1 ).div( length( vec2( p.x.div( sin( i.x.add( tt ) ).div( inten ) ), p.y.div( cos( i.y.add( tt ) ).div( inten ) ) ) ) ) );

	}

	c.divAssign( 4 );
	const v = float( 1.17 ).sub( pow( c, 1.4 ) );
	return pow( abs( v ), 8 );

};

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
		// sun: direction (toward the sun) and a 0..1 strength (0 at night)
		this.sunDir = uniform( new THREE.Vector3( 0, 1, 0 ) ).setName( 'uwSunDir' );
		this.sunK = uniform( 1 ).setName( 'uwSunK' );
		// QA: 1 shows the caustic light factor, 2 the up-facing mask, 3 the point depth / 10
		this.debug = uniform( 0 ).setName( 'uwDebug' );

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

	// sun for the caustics: direction toward the sun and its intensity relative to full daylight
	setSun( dir, strength ) {

		this.sunDir.value.copy( dir );
		this.sunK.value = Math.max( 0, Math.min( 1, strength ) ) * THREE.MathUtils.smoothstep( dir.y, 0.05, 0.3 );

	}

	// daylight from the haze colour (already dimmed at dusk / night)
	setDaylight( hazeColor ) {

		this.murk.value.copy( hazeColor ).multiply( _tint );

	}

	// rgb: linear scene colour of this pixel -> colour seen through the water
	apply( rgb ) {

		const on = this.on, depth = this.depth, murk = this.murk, viewZ = this.viewZ;
		const camWorld = this.camWorld, projInv = this.projInv, W = this.waterLevel;
		const sunDir = this.sunDir, sunK = this.sunK, debug = this.debug;
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
				const lightDown = exp( vec3( ...LIGHT_ABSORB ).mul( pointDepth ).negate() ).toVar();
				// caustics on up-facing surfaces: the pattern at the point where the refracted sun ray
				// through it crossed the surface; sharp in the shallows, a soft glow deeper down
				const Nr = normalize( cross( dFdy( posW ), dFdx( posW ) ) ).toVar();
				const camPos = camWorld.mul( vec4( 0, 0, 0, 1 ) ).xyz;
				Nr.assign( select( dot( Nr, camPos.sub( posW ) ).lessThan( 0 ), Nr.negate(), Nr ) );
				const up = smoothstep( 0.2, 0.8, Nr.y );
				const sy = max( sunDir.y, 0.2 );
				// refracted sun direction in the water (Snell: sin t = sin i / 1.333)
				const refrXZ = sunDir.xz.div( 1.333 );
				const uv = posW.xz.add( refrXZ.mul( pointDepth.div( sy ) ) ).div( CAUSTIC_TILE );
				// a main net plus a fainter, larger one drifting across it (averaging the two would halve
				// the bright lines)
				const cst = caustic( uv, time.mul( 0.55 ) ).add( caustic( uv.mul( 0.61 ).add( 0.37 ), time.mul( 0.4 ) ).mul( 0.35 ) );
				const sharp = exp( pointDepth.mul( - 0.05 ) ); // the net blurs toward its mean with depth
				const net = mix( float( 0.35 ), min( cst.mul( 3.2 ), 4 ), sharp );
				const k = up.mul( sunK ).mul( exp( pointDepth.mul( - CAUSTIC_FADE ) ) ).mul( CAUSTIC_STRENGTH ).mul( smoothstep( 0.02, 0.4, pointDepth ) );
				lightDown.mulAssign( float( 1 ).add( net.sub( 0.35 ).mul( k ) ) );
				const trans = exp( vec3( ...ABSORB ).mul( dist ).negate() );
				const fogAmt = float( 1 ).sub( exp( dist.mul( - SCATTER ) ) );
				const light = exp( depth.mul( - DEPTH_FALLOFF ) );
				// brighter toward the top of the screen (screenUV.y = 0 at the top)
				const glow = mix( float( 1.35 ), float( 0.55 ), smoothstep( 0.0, 1.0, screenUV.y ) );
				const water = vec3( murk ).mul( light ).mul( glow );
				col.assign( mix( col.mul( lightDown ).mul( trans ), water, fogAmt ) );
				If( debug.greaterThan( 0.5 ), () => {

					col.assign( select( debug.lessThan( 1.5 ), vec3( float( 1 ).add( net.sub( 0.35 ).mul( k ) ).mul( 0.5 ) ), select( debug.lessThan( 2.5 ), vec3( up ), vec3( pointDepth.div( 10 ) ) ) ) );

				} );

			} );
			return col;

		} )();

	}

}

const _tint = new THREE.Color( 0.3, 0.62, 0.6 );
