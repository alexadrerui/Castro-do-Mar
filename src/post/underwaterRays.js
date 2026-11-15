import * as THREE from 'three/webgpu';
import {
	Fn, If, Loop, float, int, vec2, vec3, vec4, uniform, texture, screenUV, screenCoordinate, interleavedGradientNoise,
	rtt, exp, max, min, sqrt, dot, normalize, smoothstep, time, select
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

// Light shafts under water: the sunlight that the waves focus into moving bands, scattered toward
// the eye by the water between the camera and what it sees. After the W_RAYS / W_RBLUR passes of
// Abyssal Garden (github.com/Noniv/abyssal-garden, MIT, (c) 2026 Maksymilian Dendura), rewritten in
// TSL: at reduced resolution each view ray is marched from the eye to the first surface it hits (the
// scene depth), to the water surface when it looks up, or to MAX_DIST; at each step the light that
// reached that point comes down along the refracted sun direction through the surface pattern at the
// point where it crossed the surface (a blob of light, as the wave lenses, drifting), absorbed on
// its way down and on its way to the eye, weighted by a forward-scattering phase. The steps start at
// a per-pixel dither and a blur at the same resolution hides it. The original also tests the sun's
// shadow map at each step (the kelp cuts the shafts); here the rays stop at the geometry only.
// Added after the underwater medium (post/underwater.js apply), only with the view fully under water.

const MAX_DIST = 45;        // m: the murk leaves ~4% past it
const STEPS = 20;
const VIEW_EXT = 0.16;      // 1/m: extinction toward the eye (scatter 0.07 + green absorption ~0.09)
const LIGHT_EXT = 0.07;     // 1/m: sunlight lost going down (green-blue, post/underwater.js LIGHT_ABSORB)
const NOISE = 128;          // texels of the tileable pattern texture

// tileable value-noise fbm in R and G (two unrelated fields), baked once on the CPU
function patternTexture() {

	const N = NOISE, data = new Uint8Array( N * N * 4 );
	const lattice = ( P, seed ) => {
		const g = new Float32Array( P * P );
		let s = seed;
		for ( let i = 0; i < g.length; i ++ ) { s = ( s * 1664525 + 1013904223 ) >>> 0; g[ i ] = s / 4294967296; }
		return g;
	};
	const layer = ( P, g, x, y ) => {
		const fx = x / N * P, fy = y / N * P;
		const ix = Math.floor( fx ), iy = Math.floor( fy ), tx = fx - ix, ty = fy - iy;
		const sx = tx * tx * ( 3 - 2 * tx ), sy = ty * ty * ( 3 - 2 * ty );
		const at = ( i, j ) => g[ ( ( j % P ) * P ) + ( i % P ) ];
		const a = at( ix, iy ), b = at( ix + 1, iy ), c = at( ix, iy + 1 ), d = at( ix + 1, iy + 1 );
		return a + ( b - a ) * sx + ( c - a ) * sy + ( a - b - c + d ) * sx * sy;
	};
	const octaves = [ [ 4, 0.55 ], [ 8, 0.28 ], [ 16, 0.17 ] ];
	const fields = [ 1, 2 ].map( ( k ) => octaves.map( ( [ P ], o ) => lattice( P, 977 * k + 31 * o ) ) );
	for ( let y = 0; y < N; y ++ ) for ( let x = 0; x < N; x ++ ) {

		const i = ( y * N + x ) * 4;
		for ( let c = 0; c < 2; c ++ ) {

			let v = 0;
			octaves.forEach( ( [ P, w ], o ) => { v += layer( P, fields[ c ][ o ], x, y ) * w; } );
			data[ i + c ] = Math.round( v * 255 );

		}
		data[ i + 3 ] = 255;

	}
	const tex = new THREE.DataTexture( data, N, N, THREE.RGBAFormat );
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;

}

export class UnderwaterRays {

	// scenePass: the scene pass (its depth); underwater: post/underwater.js (camera uniforms, sun, level)
	constructor( { scenePass, underwater, resolutionScale = 0.5 } ) {

		this.strength = uniform( 1 ).setName( 'uwrStrength' ); // 0 = off
		this.scale = uniform( 7 ).setName( 'uwrScale' );       // m: size of the light blobs on the surface
		this.speed = uniform( 0.35 ).setName( 'uwrSpeed' );    // m/s: drift of the pattern
		this.tint = uniform( new THREE.Color( 0.42, 0.9, 0.85 ) ).setName( 'uwrTint' );
		const U = underwater;
		const viewZ = scenePass.getViewZNode();
		const pat = texture( patternTexture() );

		const march = Fn( () => {

			const out = vec3( 0 ).toVar();
			If( U.on.greaterThan( 0.5 ).and( U.sunK.greaterThan( 0.001 ) ).and( this.strength.greaterThan( 0 ) ), () => {

				// the view ray of this pixel in the world (as in underwater.js)
				const ndc = vec2( screenUV.x.mul( 2 ).sub( 1 ), screenUV.y.mul( - 2 ).add( 1 ) );
				const ray = U.projInv.mul( vec4( ndc, 1, 1 ) );
				const dirV = ray.xyz.div( ray.w );
				const camPos = U.camWorld.mul( vec4( 0, 0, 0, 1 ) ).xyz;
				const rd = normalize( U.camWorld.mul( vec4( dirV, 0 ) ).xyz ).toVar();
				// distance to what this pixel shows (the view z over the ray's z)
				const vz = viewZ.min( - 1e-3 );
				const hit = vz.div( normalize( dirV ).z ); // > 0
				const tEnd = min( hit, float( MAX_DIST ) ).toVar();
				// looking up: no further than the surface
				If( rd.y.greaterThan( 1e-3 ), () => { tEnd.assign( min( tEnd, U.level.sub( camPos.y ).div( rd.y ) ) ); } );
				// the sun in the water (toward the sun, refracted: sin t = sin i / 1.333)
				const lxz = U.sunDir.xz.div( 1.333 );
				const ly = sqrt( max( float( 1 ).sub( dot( lxz, lxz ) ), 0.05 ) );
				const drift = vec2( 0.8, 0.6 ).mul( time.mul( this.speed ) );
				const dt = tEnd.div( STEPS );
				const j = interleavedGradientNoise( screenCoordinate.xy );
				const acc = float( 0 ).toVar();
				Loop( { start: int( 0 ), end: int( STEPS ) }, ( { i } ) => {

					const t = float( i ).add( j ).mul( dt );
					const p = camPos.add( rd.mul( t ) );
					const depth = max( U.level.sub( p.y ), 0 );
					// where the sunlight reaching p crossed the surface
					const q = p.xz.add( lxz.mul( depth.div( ly ) ) );
					const a = pat.sample( q.div( this.scale ).add( drift.div( this.scale ) ) ).level( 0 ).r;
					const b = pat.sample( vec2( q.y, q.x ).div( this.scale.mul( 0.43 ) ).sub( drift.div( this.scale.mul( 0.6 ) ) ).add( 0.37 ) ).level( 0 ).g;
					const band = smoothstep( 0.42, 0.68, a ).mul( smoothstep( 0.3, 0.62, b ) );
					// a faint even glow plus the bands, absorbed down to p and back to the eye
					const light = exp( depth.div( ly ).mul( - LIGHT_EXT ).sub( t.mul( VIEW_EXT ) ) );
					acc.addAssign( light.mul( band.mul( 1.8 ).add( 0.02 ) ) );

				} );
				// forward scattering: strongest looking toward the sun
				const mu = max( dot( rd, vec3( lxz.x, ly, lxz.y ) ), 0 );
				const phase = mu.mul( mu ).mul( mu ).mul( 1.3 ).add( 0.3 );
				out.assign( vec3( this.tint ).mul( acc.mul( dt ).mul( phase ).mul( 0.045 ).mul( U.sunK ) ) );

			} );
			return vec4( out, 1 );

		} );
		this.pass = rtt( march(), null, null, { type: THREE.HalfFloatType, resolutionScale } );
		this.smooth = gaussianBlur( this.pass, vec2( 1 ), 2, { resolutionScale } );
		this.debug = uniform( 0 ).setName( 'uwrDebug' ); // 1: the shafts alone

	}

	// rgb: the colour after the underwater medium; returns it with the shafts added
	apply( rgb ) {

		const s = this.smooth.rgb.mul( this.strength );
		return select( this.debug.greaterThan( 0.5 ), s.mul( 4 ), vec3( rgb ).add( s ) );

	}

}
