import * as THREE from 'three/webgpu';
import {
	Fn, Loop, float, mix, vec2, vec3, vec4, uniform, texture3D, screenUV, screenCoordinate, getViewPosition, interleavedGradientNoise, rtt
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

// Low-lying mist (brétema) over the water and the low valleys. After three's
// webgpu_postprocessing_fog: a slab of fog between the water level and `top`, raymarched in a few
// steps at reduced resolution from the scene depth, its density a 3D noise drifting with the
// wind (Beer-Lambert). The low-resolution result is blurred (the steps are dithered) and laid over
// the scene colour.

// Seamless 3D tri-noise (turbulent, wispy), as in the example
function noiseTexture( size = 64 ) {
	const data = new Uint8Array( size * size * size );
	const tri = ( x ) => Math.abs( ( ( x % 1 ) + 1 ) % 1 - 0.5 );
	const triNoise = ( x, y, z ) => {
		let px = x, py = y, pz = z, bx = x, by = y, bz = z, zf = 1.4, rz = 0;
		for ( let i = 0; i < 4; i ++ ) {
			px += tri( bz * 2 + tri( by * 2 ) ); py += tri( bz * 2 + tri( bx * 2 ) ); pz += tri( by * 2 + tri( bx * 2 ) );
			bx = bx * 1.8 + 0.14; by = by * 1.8 + 0.14; bz = bz * 1.8 + 0.14;
			zf *= 1.5; px *= 1.2; py *= 1.2; pz *= 1.2;
			rz += tri( pz + tri( px + tri( py ) ) ) / zf;
		}
		return rz;
	};
	let k = 0;
	for ( let z = 0; z < size; z ++ ) for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {
		const u = x / size, v = y / size, w = z / size;
		const n = triNoise( u * 4, v * 4, w * 4 ) + 0.45 * triNoise( u * 8 + 1.7, v * 8 + 0.9, w * 8 + 2.5 );
		data[ k ++ ] = Math.min( 255, Math.max( 0, Math.floor( n * 1.15 * 255 ) ) );
	}
	const tex = new THREE.Data3DTexture( data, size, size, size );
	tex.format = THREE.RedFormat;
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
	tex.unpackAlignment = 1;
	tex.needsUpdate = true;
	return tex;
}

export class Mist {

	// scenePass: the scene pass (its depth), camera, waterLevel (m)
	constructor( { scenePass, camera, waterLevel = 0, resolutionScale = 0.35 } ) {
		const noise = noiseTexture( 64 );
		this.strength = uniform( 1 ); // 0 = off
		this.top = uniform( waterLevel + 14 ); // top of the slab (m)
		this.density = uniform( 0.035 ); // per metre inside the thickest wisps
		this.scale = uniform( 1 / 70 ); // noise cells ~70 m
		this.threshold = uniform( 0.55 );
		this.time = uniform( 0 );
		this.color = uniform( new THREE.Color( 0xc8d4de ) );
		const bottom = float( waterLevel - 2 );
		const steps = 12, maxDist = 900;
		const camWorld = uniform( camera.matrixWorld ), camProjInv = uniform( camera.projectionMatrixInverse ), camPos = uniform( camera.position );
		const depthTex = scenePass.getTextureNode( 'depth' );

		const density = Fn( ( [ p ] ) => {
			const t = this.time;
			const q = p.mul( this.scale );
			// drifting inland with the south-west breeze, a second octave warped by the first
			const n1 = texture3D( noise, q.add( vec3( t.mul( 0.3 ), t.mul( 0.02 ), t.mul( - 0.38 ) ) ) ).r;
			const n2 = texture3D( noise, q.mul( 2.3 ).add( vec3( 1.7, 0.9, 2.5 ) ).add( vec3( t.mul( - 0.2 ), 0, t.mul( 0.1 ) ) ).add( n1.mul( 0.5 ) ) ).r.mul( 0.5 );
			// thinning towards the top of the slab
			const h = p.y.sub( bottom ).div( this.top.sub( bottom ).max( 0.1 ) ).clamp( 0, 1 );
			return n1.add( n2 ).sub( this.threshold ).max( 0 ).mul( h.oneMinus().pow( 1.3 ) );
		} );

		const march = Fn( () => {
			const depth = depthTex.sample( screenUV ).r;
			const vp = getViewPosition( screenUV, depth, camProjInv );
			const target = camWorld.mul( vec4( vp, 1 ) ).xyz;
			const ray = target.sub( camPos );
			const surf = depth.greaterThanEqual( 0.99999 ).select( float( 1e6 ), ray.length() );
			const dir = ray.normalize();
			// the ray inside the slab [ bottom, top ]
			const dy = dir.y.greaterThanEqual( 0 ).select( dir.y.max( 1e-5 ), dir.y.min( - 1e-5 ) );
			const t0 = bottom.sub( camPos.y ).div( dy ), t1 = this.top.sub( camPos.y ).div( dy );
			const tStart = t0.min( t1 ).max( 0 );
			const tEnd = t0.max( t1 ).min( surf ).min( tStart.add( maxDist ) );
			const len = tEnd.sub( tStart ).max( 0 );
			const stepLen = len.div( steps );
			const pos = camPos.add( dir.mul( tStart ) ).add( dir.mul( stepLen ).mul( interleavedGradientNoise( screenCoordinate.xy ) ) ).toVar();
			const acc = float( 0 ).toVar();
			Loop( steps, () => {
				acc.addAssign( density( pos ).mul( stepLen ) );
				pos.addAssign( dir.mul( stepLen ) );
			} );
			return float( 1 ).sub( acc.mul( this.density ).negate().exp() );
		} );

		this.pass = rtt( march(), null, null, { type: THREE.HalfFloatType, format: THREE.RedFormat, resolutionScale } );
		// smooth out the dithered steps (at the same low resolution: cheap)
		this.smooth = gaussianBlur( this.pass, vec2( 1.5 ), 3, { resolutionScale } );
	}

	update( dt ) {
		this.time.value += dt * 0.01;
	}

	// src: the scene colour (HDR); returns it with the mist laid over
	apply( src ) {
		const m = this.smooth.r.mul( this.strength ).clamp( 0, 1 );
		return mix( src, this.color, m );
	}

}
