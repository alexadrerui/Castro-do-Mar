import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, vec4, exp, mix, smoothstep, screenUV, If, max, min, sin, cos, length, mod, normalize, cross, dot, dFdx, dFdy, select, time, fract } from 'three/tsl';

// Underwater look for when the camera dives below WATER_LEVEL. Near the surface the view is cut
// at the waterline (the idea of Ascent, github.com/hapybeing/Ascent): each pixel is under water
// when its point on the near plane (the lens) lies below the surface, which gets a few cm of
// moving waves and a bright meniscus line along the cut. The near plane stays at the scene's 1 m
// within LINE_BAND of the surface, so the cut falls exactly where the water mesh is clipped.
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
const UNDER_NEAR = 0.05; // m: and its near plane (far / near = 1800: depth precision to spare)
// m: the waterline cut is drawn while the camera is within this distance of the surface (the near
// plane's corners reach ~1.4 m from the eye at the 1 m near plane: past it the cut is off screen)
const LINE_BAND = 1.5;
const CAUSTIC_TILE = 3.2; // m: size of the caustic pattern tile
const CAUSTIC_STRENGTH = 1.3;
const CAUSTIC_FADE = 0.08; // 1/m: caustics lost per metre of depth (the net also blurs out)
const TAU = Math.PI * 2;

// Tileable water caustics, ours (07/10/2026; it replaced a port of a Shadertoy pattern that had no
// licence for commercial use): the bright net that the waves focus onto the bottom drawn as the edges
// of Voronoi cells, F2 - F1 (the distance to the second nearest cell point minus the nearest: 0 on the
// border between two cells), turned into thin lines by exp( -edge / width ). Each cell's point orbits
// on its own phase and the domain is warped by sines of whole periods, so the lines bend and drift;
// two layers (3 and 2 cells to the tile, at their own speeds) and their crossings brighter. The cell
// indices wrap at the tile, so the pattern tiles. Calibrated against the old pattern (a numpy
// prototype of both): the same mean (0.128) and peak (~1.2), so the shading below was left as it was.
// uv in tiles, t in seconds; returns ~0 .. 1.2 (bright lines on a dark field).
const CAUSTIC_GAIN = 0.522; // the mean of the old pattern
const hashCell = ( c, k ) => fract( sin( c.x.mul( 127.1 ).add( c.y.mul( 311.7 ) ).add( k ) ).mul( 43758.5453 ) );

const causticLayer = ( uv, t, N, speed, seed, warp ) => {

	// the domain warped by sines of whole periods across the tile (it still tiles)
	const w = vec2(
		uv.x.add( sin( uv.y.mul( 2 * TAU ).add( t.mul( 0.7 * speed ) ) ).mul( warp / N ) ),
		uv.y.add( sin( uv.x.mul( 2 * TAU ).add( t.mul( 0.6 * speed ) ).add( 1.3 ) ).mul( warp / N ) )
	);
	const p = w.mul( N );
	const ip = p.floor().toVar(), fp = p.sub( p.floor() ).toVar();
	const F1 = float( 8 ).toVar(), F2 = float( 8 ).toVar();
	for ( let j = - 1; j <= 1; j ++ ) for ( let i = - 1; i <= 1; i ++ ) {

		const c = mod( ip.add( vec2( i, j ) ), N );
		const a = hashCell( c, seed * 74.7 ), b = hashCell( c, seed * 246.1 + 19.3 );
		// the cell's point on an orbit of its own
		const o = vec2( sin( t.mul( speed ).add( a.mul( TAU ) ) ), cos( t.mul( speed * 0.83 ).add( b.mul( TAU ) ) ) ).mul( 0.38 ).add( 0.5 );
		const d = length( vec2( i, j ).add( o ).sub( fp ) );
		F2.assign( select( d.lessThan( F1 ), F1, min( F2, d ) ) );
		F1.assign( min( F1, d ) );

	}

	return F2.sub( F1 );

};

const caustic = ( uv, t ) => {

	const l1 = exp( causticLayer( uv, t, 3, 0.9, 1, 0.35 ).div( - 0.07 ) );
	const l2 = exp( causticLayer( uv.add( vec2( 0.37, 0.11 ) ), t, 2, 0.7, 2, 0.45 ).div( - 0.098 ) );
	return l1.mul( 0.75 ).add( l2.mul( 0.4 ) ).add( l1.mul( l2 ).mul( 1.2 ) ).mul( CAUSTIC_GAIN );

};

export class Underwater {

	constructor( scenePass, waterLevel = 0 ) {

		this.on = uniform( 0 ).setName( 'uwOn' ); // 1: the whole view is under water
		this.line = uniform( 0 ).setName( 'uwLine' ); // 1: near the surface, cut per pixel
		this.level = uniform( waterLevel ).setName( 'uwLevel' );
		this.near = uniform( 1 ).setName( 'uwNear' );
		this.eyeUnder = false; // the eye itself is below the surface (lens drops, surface from below)
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
		// fully under water only past the waterline band: inside it the cut shows both worlds, with the
		// scene's own near / far planes
		const under = d > LINE_BAND;
		const line = ! under && d > - LINE_BAND;
		if ( under !== this._under ) {

			if ( under ) {

				this._far = camera.far;
				camera.far = UNDER_FAR;
				// and a near plane of a few cm: just under the surface (a river, a shallow lake) the rays
				// looking up meet the surface closer than the 1 m near plane, and the clipped surface left a
				// band of the world above showing through at the top of the view
				this._near = camera.near;
				camera.near = UNDER_NEAR;

			} else if ( this._far ) { camera.far = this._far; camera.near = this._near; }
			camera.updateProjectionMatrix();
			this._under = under;

		}

		this.on.value = under ? 1 : 0;
		this.line.value = line ? 1 : 0;
		this.eyeUnder = d > 0;
		this.depth.value = Math.max( d, 0 );
		this.waterLevel = waterLevel;
		this.level.value = waterLevel;
		this.near.value = camera.near;
		if ( under || line ) {

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
		const camWorld = this.camWorld, projInv = this.projInv, W = this.level;
		const line = this.line, near = this.near;
		const sunDir = this.sunDir, sunK = this.sunK, debug = this.debug;
		return Fn( () => {

			const col = vec3( rgb ).toVar();
			If( on.greaterThan( 0.5 ).or( line.greaterThan( 0.5 ) ), () => {

				const above = vec3( rgb );
				const vz = viewZ.min( - 1e-3 );
				const dist = vz.negate().min( 400 );
				// world position of this pixel: the view ray through it, scaled to its depth
				const ndc = vec2( screenUV.x.mul( 2 ).sub( 1 ), screenUV.y.mul( - 2 ).add( 1 ) );
				const ray = projInv.mul( vec4( ndc, 1, 1 ) );
				const dirV = ray.xyz.div( ray.w );
				// waterline: height of this pixel's point on the near plane over the (waving) surface
				const lensW = camWorld.mul( vec4( dirV.mul( near.div( dirV.z.negate() ) ), 1 ) ).xyz;
				const p = lensW.xz;
				const wave = sin( p.x.mul( 1.7 ).add( p.y.mul( 0.8 ) ).add( time.mul( 1.6 ) ) ).mul( 0.022 )
					.add( sin( p.x.mul( - 0.9 ).add( p.y.mul( 2.6 ) ).add( time.mul( 2.3 ) ) ).mul( 0.012 ) )
					.add( sin( p.x.mul( 4.1 ).sub( p.y.mul( 1.3 ) ).add( time.mul( 3.7 ) ) ).mul( 0.005 ) );
				const s = W.add( wave ).sub( lensW.y ); // > 0: under water
				const m = select( on.greaterThan( 0.5 ), float( 1 ), smoothstep( - 0.003, 0.003, s ) );
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
				// the cut: under water below the line; along it a thin film of water on the lens, bright
				// where the light runs along the meniscus and darker just under it
				// (squares as products: pow of a negative base is NaN)
				const sm = s.div( 0.012 ), sf = s.sub( 0.03 ).div( 0.025 );
				const meniscus = exp( sm.mul( sm ).negate() ).mul( line );
				const film = exp( sf.mul( sf ).negate() ).mul( line );
				col.assign( mix( above, col, m ) );
				col.assign( col.mul( film.mul( - 0.25 ).add( 1 ) ).add( vec3( 0.75, 0.85, 0.85 ).mul( meniscus ).mul( float( 0.25 ).add( sunK.mul( 0.6 ) ) ) ) );
				If( debug.greaterThan( 0.5 ), () => {

					col.assign( select( debug.lessThan( 1.5 ), vec3( float( 1 ).add( net.sub( 0.35 ).mul( k ) ).mul( 0.5 ) ), select( debug.lessThan( 2.5 ), vec3( up ), vec3( pointDepth.div( 10 ) ) ) ) );

				} );

			} );
			return col;

		} )();

	}

}

const _tint = new THREE.Color( 0.3, 0.62, 0.6 );
