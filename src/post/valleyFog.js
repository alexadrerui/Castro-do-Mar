// Mist lying in the valleys and hollows (brétema): density falls off exponentially with the height above
// the local ground (or the sea's surface), so it pools on valley floors and over the bay below the view
// while the crests stand clear of it; drifting pockets gather it in banks rather than one even sheet. The
// density is marched along the view ray (the ground under it varies too much for a closed form),
// sampling the height texture and the pocket noise in the air, so it reads as volume rather than paint;
// the first metres stay clear. Sunlit mist scatters forward toward a low sun and falls to a cool shade
// away from it.
// Port of rendering/valleyFog.js (and of the gradient noise of world/snowNoiseNodes.js, after Snowflow's
// lib/noise.wgsl) of Drusniel: Gods' End (https://github.com/danielsobrado/drusniel-gods-end, MIT,
// Copyright (c) 2026 Daniel Sobrado, licenses/LICENSE-Drusniel.md; Snowflow by Maksymilian Dendura,
// MIT). Changes: everywhere instead of snow country only; the ground is our relief's height texture and
// the sea's surface; and a post pass (like post/mist.js) instead of the materials' fog node: there the
// march ran for every fragment of every material, leaf cards' overdraw included (+4..7 ms in the
// headless profile); here once per pixel at RES of the resolution, blurred, then lit per pixel.
import * as THREE from 'three/webgpu';
import {
	Fn, If, Loop, dot, exp, float, fract, mix, smoothstep, texture, uniform, vec2, vec3, vec4, max, screenUV,
	getViewPosition, interleavedGradientNoise, screenCoordinate, rtt
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { isSky } from '../core/depth.js';

const TAU = Math.PI * 2;
const SAMPLES = 6, RES = 0.35;

const hash21 = Fn( ( [ p ] ) => {
	const p3 = fract( vec3( p.x, p.y, p.x ).mul( 0.1031 ) ).toVar();
	p3.addAssign( dot( p3, p3.yzx.add( 33.33 ) ) );
	return fract( p3.x.add( p3.y ).mul( p3.z ) );
} ).setLayout( { name: 'valleyHash21', type: 'float', inputs: [ { name: 'p', type: 'vec2' } ] } );

// gradient noise with a quintic fade, roughly -0.7..0.7
const noise2 = Fn( ( [ p ] ) => {
	const cell = p.floor(), f = p.sub( cell );
	const u = f.mul( f ).mul( f ).mul( f.mul( f.mul( 6 ).sub( 15 ) ).add( 10 ) );
	const corner = ( x, y ) => { const a = hash21( cell.add( vec2( x, y ) ) ).mul( TAU ); return dot( vec2( a.cos(), a.sin() ), f.sub( vec2( x, y ) ) ); };
	const va = corner( 0, 0 ), vb = corner( 1, 0 ), vc = corner( 0, 1 ), vd = corner( 1, 1 );
	return va.add( vb.sub( va ).mul( u.x ) ).add( vc.sub( va ).mul( u.y ) ).add( va.sub( vb ).sub( vc ).add( vd ).mul( u.x ).mul( u.y ) );
} ).setLayout( { name: 'valleyNoise2', type: 'float', inputs: [ { name: 'p', type: 'vec2' } ] } );

export class ValleyFog {

	// scenePass (its depth), camera, heightTex (terrain.js), waterLevel, fogColor (uniform: the haze's),
	// sunDir (vector, followed by reference)
	constructor( { scenePass, camera, heightTex, waterLevel = 0, fogColor, sunDir } ) {
		this.strength = uniform( 1 );          // 0: off (under the water, ?valley=0)
		this.density = uniform( 0.0028 );
		this.height = uniform( 7 );            // m: the e-folding height above the ground
		this.ceiling = uniform( 30 );          // m: no mist above this
		this.pocketScale = uniform( 0.011 );   // 1 / bank size (~90 m)
		this.pocketStrength = uniform( 0.75 );
		this.nearStart = uniform( 6 ); this.nearEnd = uniform( 40 );
		this.maxDistance = uniform( 600 );
		this.scatter = uniform( 0.4 ); this.sunScatter = uniform( 0.3 );
		this.shade = uniform( new THREE.Color( 0x9fb2c8 ) );
		this.sunColor = uniform( new THREE.Color( 1, 0.95, 0.85 ) );
		this.time = uniform( 0 );
		this.fogColor = fogColor;
		const sun = uniform( sunDir );
		const camWorld = uniform( camera.matrixWorld ), camProjInv = uniform( camera.projectionMatrixInverse ), camPos = uniform( camera.position );
		this.camWorld = camWorld; this.camProjInv = camProjInv; this.camPos = camPos; this.sun = sun;
		const depthTex = scenePass.getTextureNode( 'depth' );
		const hd = heightTex.userData;
		// explicit level: the march runs inside a loop (no implicit derivatives there)
		const groundAt = ( xz ) => max( texture( heightTex, xz.sub( vec2( hd.x0, hd.z0 ) ).div( hd.cell ).add( 0.5 ).div( hd.n ) ).level( 0 ).r, waterLevel );
		// from the south-west (the grass's wind), ~1.6 m/s
		const drift = vec2( 0.7071, - 0.7071 ).mul( 1.6 ).mul( this.time ).mul( this.pocketScale );

		const march = Fn( () => {
			const depth = depthTex.sample( screenUV ).r;
			const vp = getViewPosition( screenUV, depth, camProjInv );
			const target = camWorld.mul( vec4( vp, 1 ) ).xyz;
			const ray = target.sub( camPos );
			// the sky: as far as the march reaches
			const len = isSky( depth ).select( this.maxDistance, ray.length().min( this.maxDistance ) );
			const dir = ray.normalize();
			const step = len.div( SAMPLES );
			const jitter = interleavedGradientNoise( screenCoordinate.xy );
			const acc = float( 0 ).toVar();
			Loop( SAMPLES, ( { i } ) => {
				const along = float( i ).add( jitter ).mul( step );
				If( along.greaterThan( this.nearStart ), () => {
					const p = camPos.add( dir.mul( along ) );
					const above = p.y.sub( groundAt( p.xz ) ).max( 0 ).toVar();
					If( above.lessThan( this.ceiling ), () => {
						// ragged tops: the height folded into the pocket coordinates
						const cell = p.xz.mul( this.pocketScale ).add( drift ).add( vec2( p.y.mul( 0.004 ), 0 ) );
						const pocket = noise2( cell ).add( noise2( cell.mul( 2.3 ).sub( drift.mul( 0.6 ) ) ).mul( 0.5 ) );
						const banks = mix( this.pocketStrength.oneMinus(), this.pocketStrength.add( 1 ), smoothstep( - 0.45, 0.45, pocket ) );
						const clear = smoothstep( this.nearStart, this.nearEnd, along );
						const ceil = smoothstep( this.ceiling.mul( 0.6 ), this.ceiling, above ).oneMinus();
						acc.addAssign( exp( above.div( this.height ).negate() ).mul( banks ).mul( clear ).mul( ceil ).mul( step ) );
					} );
				} );
			} );
			return exp( acc.mul( this.density ).negate() ).oneMinus();
		} );

		this.pass = rtt( march(), null, null, { type: THREE.HalfFloatType, format: THREE.RedFormat, resolutionScale: RES } );
		this.smooth = gaussianBlur( this.pass, vec2( 1.5 ), 3, { resolutionScale: RES } );
	}

	update( dt ) { this.time.value += dt; }

	// src: the scene colour (HDR); returns it with the valley mist over it, lit per pixel: the
	// Henyey-Greenstein forward lobe toward the sun (normalised to 1 at 90 degrees)
	apply( src ) {
		const vp = getViewPosition( screenUV, float( 1 ), this.camProjInv );
		const view = this.camWorld.mul( vec4( vp, 1 ) ).xyz.sub( this.camPos ).normalize();
		const g = this.scatter, g2 = g.mul( g );
		const phase = g2.add( 1 ).pow( 1.5 ).div( g2.add( 1 ).sub( dot( view, this.sun ).mul( g.mul( 2 ) ) ).pow( 1.5 ) );
		const lit = mix( this.shade.mul( this.fogColor ), this.fogColor, 0.5 ).add( this.sunColor.mul( phase.mul( this.sunScatter ) ) );
		const f = this.smooth.r.mul( this.strength ).clamp( 0, 1 );
		return mix( src, lit, f );
	}
}
