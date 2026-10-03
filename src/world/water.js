import * as THREE from 'three/webgpu';
import {
	Fn, uniform, texture, positionWorld, cameraPosition, time, reflector,
	vec2, vec3, float, color, mix, smoothstep, clamp, max, pow, dot, normalize, reflect, length, sin,
	mx_noise_float, pmremTexture, vec4
} from 'three/tsl';
import { PlanarReprojection } from './planarReprojection.js';
import { rainRipples } from './rainImpacts.js';
import { WATER_LEVEL } from './layout.js';

// Tileable wave-slope texture: sum of sines with integer wave vectors so it
// wraps perfectly. RG store d(h)/dx, d(h)/dz.
export function createWaveTexture( size = 256, seed = 7 ) {
	let s = seed;
	const rnd = () => ( s = ( s * 16807 ) % 2147483647 ) / 2147483647;
	const waves = [];
	for ( let i = 0; i < 48; i ++ ) {
		const kx = Math.round( ( rnd() * 2 - 1 ) * 14 ), kz = Math.round( ( rnd() * 2 - 1 ) * 14 );
		if ( kx === 0 && kz === 0 ) continue;
		const k = Math.hypot( kx, kz );
		waves.push( { kx, kz, a: 1 / Math.pow( k, 1.4 ), p: rnd() * Math.PI * 2 } );
	}
	const data = new Uint8Array( size * size * 4 );
	let maxD = 0;
	const tmp = new Float32Array( size * size * 2 );
	for ( let j = 0; j < size; j ++ ) for ( let i = 0; i < size; i ++ ) {
		const u = i / size * Math.PI * 2, v = j / size * Math.PI * 2;
		let dx = 0, dz = 0;
		for ( const w of waves ) {
			const c = Math.cos( w.kx * u + w.kz * v + w.p ) * w.a;
			dx += c * w.kx; dz += c * w.kz;
		}
		tmp[ ( j * size + i ) * 2 ] = dx; tmp[ ( j * size + i ) * 2 + 1 ] = dz;
		maxD = Math.max( maxD, Math.abs( dx ), Math.abs( dz ) );
	}
	for ( let k = 0; k < size * size; k ++ ) {
		data[ k * 4 ] = ( tmp[ k * 2 ] / maxD * 0.5 + 0.5 ) * 255;
		data[ k * 4 + 1 ] = ( tmp[ k * 2 + 1 ] / maxD * 0.5 + 0.5 ) * 255;
		data[ k * 4 + 2 ] = 128; data[ k * 4 + 3 ] = 255;
	}
	const tex = new THREE.DataTexture( data, size, size, THREE.RGBAFormat );
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true;
	tex.needsUpdate = true;
	return tex;
}

// opts: reflectionInterval (ms between planar captures, planarReprojection.js), waveStrength, foam (the surf; lakes are calmer), level (WATER_LEVEL; a lake's own level, world/lakeFill.js), geometry (a horizontal surface in
// world space; the sea's endless plane when omitted), envMap (lakes: the sky's PMREM reflected instead
// of a planar reflector, one extra scene pass per lake was too dear), reflectionScale.
export function createWater( heightTex, sunDir, opts = {} ) {
	const level = opts.level ?? WATER_LEVEL;
	const planar = ! opts.envMap;

	const waveTex = createWaveTexture();
	const U = {
		sunDir: uniform( sunDir ),
		sunColor: uniform( new THREE.Color( 0xfff0d8 ) ),
		deep: uniform( new THREE.Color( 0x173556 ) ),
		mid: uniform( new THREE.Color( 0x17506b ) ),
		shallow: uniform( new THREE.Color( 0x2f6f74 ) ),
		waveStrength: uniform( opts.waveStrength ?? 0.4 ),
		foam: uniform( opts.foam ?? 1 ), // the surf at the shore (a still lake: a thin wet line)
		reflectivity: uniform( 1.0 )
	};

	const mat = new THREE.MeshBasicNodeMaterial();
	mat.transparent = true;
	mat.depthWrite = true;
	mat.name = 'WaterTSL';

	const geo = opts.geometry ?? new THREE.PlaneGeometry( 36000, 36000, 1, 1 );
	const mesh = new THREE.Mesh( geo, mat );
	if ( ! opts.geometry ) {
		mesh.rotation.x = - Math.PI / 2;
		mesh.position.y = level;
	}
	mesh.name = opts.geometry ? 'lakeWater' : 'water';
	mesh.renderOrder = 1;

	const hd = heightTex.userData;
	const wp = positionWorld;
	const toCam = cameraPosition.sub( wp );
	const dist = length( toCam );
	const V = normalize( toCam );

	// terrain depth under the surface
	// texel-centre correct lookup (vertex k lives at texel centre (k+0.5)/n)
	const huv = wp.xz.sub( vec2( hd.x0, hd.z0 ) ).div( hd.cell ).add( 0.5 ).div( hd.n );
	const insideT = smoothstep( 0.0, 0.004, huv.x ).mul( smoothstep( 0.996, 1.0, huv.x ).oneMinus() ).mul( smoothstep( 0.0, 0.004, huv.y ) ).mul( smoothstep( 0.996, 1.0, huv.y ).oneMinus() );
	const groundH = mix( float( - 40 ), texture( heightTex, huv ).r, insideT );
	// the surface's own height (the sea plane at WATER_LEVEL, a lake at its level): every lake shares
	// the same shader code
	const depth = max( wp.y.sub( groundH ), 0.0 );

	// Large-scale variation (as three's WaterMesh, which mixes samples at scales of hundreds of
	// metres to hide the tiling): wind patches from low-frequency noise (~420 m and ~140 m
	// features): calm slicks (clean mirror) next to rougher, wind-rippled water; they drift slowly
	const windField = Fn( () => {
		const t = time;
		const n = mx_noise_float( vec3( wp.x.div( 420 ), wp.z.div( 420 ), t.mul( 0.004 ) ) ).mul( 0.7 )
			.add( mx_noise_float( vec3( wp.x.div( 140 ).add( 5.3 ), wp.z.div( 140 ), t.mul( 0.011 ) ) ).mul( 0.3 ) ); // ~ -1 .. 1
		return smoothstep( - 0.25, 0.35, n );
	} )();
	const wind = mix( float( 0.35 ), float( 1.3 ), windField );

	// animated wave slopes: a long swell octave plus 3 scrolling octaves, fading with distance
	const slope = Fn( () => {
		const t = time;
		const s0 = texture( waveTex, wp.xz.div( 163 ).add( vec2( t.mul( 0.0045 ), t.mul( 0.0021 ) ) ) ).rg.mul( 2 ).sub( 1 );
		const s1 = texture( waveTex, wp.xz.div( 46 ).add( vec2( t.mul( 0.010 ), t.mul( 0.006 ) ) ) ).rg.mul( 2 ).sub( 1 );
		const s2 = texture( waveTex, wp.xz.div( 15.5 ).add( vec2( t.mul( - 0.018 ), t.mul( 0.013 ) ) ) ).rg.mul( 2 ).sub( 1 );
		const s3 = texture( waveTex, wp.xz.div( 4.3 ).add( vec2( t.mul( 0.035 ), t.mul( - 0.031 ) ) ) ).rg.mul( 2 ).sub( 1 );
		const nearF = smoothstep( 20, 220, dist ).oneMinus();
		// the wind patches scale the short octaves (the long swell is the same everywhere)
		return s0.mul( 0.35 ).add( s1.mul( 0.55 ).add( s2.mul( 0.4 ) ).add( s3.mul( 0.3 ).mul( nearF ) ).mul( wind ) );
	} )();
	const strength = mix( 0.6, 0.05, smoothstep( 40, 2200, dist ) ).mul( U.waveStrength )
		.mul( smoothstep( 0.0, 1.5, depth ).mul( 0.7 ).add( 0.3 ) );
	// raindrops landing (world/rainImpacts.js): their rings added to the wave slopes, near the camera
	const rain = rainRipples( wp.xz, smoothstep( 45, 75, dist ).oneMinus() ).mul( 0.12 );
	const N = normalize( vec3( slope.x.mul( strength ).add( rain.x ).negate(), 1.0, slope.y.mul( strength ).add( rain.y ).negate() ) );

	// planar reflection with wave distortion (the sea); a lake reflects the sky's environment map
	let refl = null, reflNode, reproj = null, reflWeight = float( 1 );
	if ( planar ) {
		refl = reflector( { resolutionScale: opts.reflectionScale ?? 0.45, generateMipmaps: false, bounces: false } );
		// captured on a budget and sampled through the capture's own camera (planarReprojection.js)
		reproj = new PlanarReprojection( refl, { interval: opts.reflectionInterval } );
		const cap = reproj.uvNode();
		refl.uvNode = cap.uv.add( N.xz.mul( 0.012 ).mul( smoothstep( 0, 3000, dist ).oneMinus().mul( 0.8 ).add( 0.2 ) ).mul( mix( 0.4, 1.7, windField ) ) );
		reflWeight = cap.weight;
		mesh.add( refl.target );
		reflNode = refl.rgb;
	} else {
		U.envGain = uniform( opts.envGain ?? 0.55 );
		reflNode = pmremTexture( opts.envMap, reflect( V.negate(), N ), float( 0.04 ) ).rgb.mul( U.envGain );
	}

	mat.colorNode = Fn( () => {
		const L = normalize( U.sunDir );
		const cosT = max( dot( V, N ), 0.0 );
		const fres = float( 0.02 ).add( float( 0.98 ).mul( pow( float( 1 ).sub( cosT ), 5.0 ) ) );

		// body colour by depth (turquoise over sand -> deep teal/navy)
		const body = mix( U.shallow, U.mid, smoothstep( 0.8, 3.5, depth ) ).toVar();
		body.assign( mix( body, U.deep, smoothstep( 12.0, 36.0, depth ) ) );
		const diffuse = max( dot( N, L ), 0.0 ).mul( 0.35 ).add( 0.45 );
		const bodyLit = body.mul( U.sunColor ).mul( diffuse );

		const reflCol = reflNode.min( vec3( 1.1 ) );
		// wind patches read mostly through the reflection: calm slicks are a bright mirror, the
		// rippled patches scatter it and show more of the darker water body
		const kR = clamp( fres.mul( 1.15 ).add( 0.06 ), 0.0, 1.0 ).mul( U.reflectivity ).mul( mix( 1.0, 0.62, windField ) ).mul( reflWeight );
		const col = mix( bodyLit, reflCol, kR ).toVar();

		// sun glitter
		const R = reflect( L.negate(), N );
		const spec = pow( max( dot( R, V ), 0.0 ), 420.0 ).mul( 9.0 ).add( pow( max( dot( R, V ), 0.0 ), 60.0 ).mul( 0.25 ) );
		col.addAssign( U.sunColor.mul( spec ) );

		// shoreline foam: bands travelling towards the shore
		const fn = mx_noise_float( wp.xz.mul( 0.35 ).add( time.mul( 0.08 ) ) ).mul( 0.5 ).add( 0.5 );
		const band = sin( depth.mul( 9.0 ).sub( time.mul( 1.7 ) ).add( fn.mul( 5.0 ) ) ).mul( 0.5 ).add( 0.5 );
		const foam = smoothstep( 0.0, 1.1, depth ).oneMinus().mul( smoothstep( 0.55, 0.95, band ).mul( 0.6 ).add( smoothstep( 0.0, 0.35, depth ).oneMinus() ) ).mul( fn.mul( 0.6 ).add( 0.5 ) );
		col.assign( mix( col, vec3( 0.92, 0.95, 0.95 ), clamp( foam.mul( U.foam ), 0, 0.9 ) ) );
		return col;
	} )();

	// transparency in the shallows lets the seabed show through
	mat.opacityNode = Fn( () => {
		const cosT = max( dot( V, N ), 0.0 );
		const fres = pow( float( 1 ).sub( cosT ), 3.0 );
		const a = mix( 0.18, 1.0, smoothstep( 0.0, 5.5, depth ) );
		return clamp( a.add( fres.mul( 0.5 ) ), 0.0, 1.0 );
	} )();

	// The sun's shadow on the water (hills, fort, houses). The water computes its own shading and
	// receives no light, so the shadow is a thin layer just above it drawn with three's
	// ShadowNodeMaterial: it shows only the shadow the sun casts there (through the same shadow
	// map as the terrain), as a translucent dark tint over the water. Seen only from above (not
	// from under the water, not in the reflection).
	const shadowMat = new THREE.ShadowNodeMaterial( { color: 0x06141c, opacity: 0.42, transparent: true, depthWrite: false } );
	shadowMat.name = 'WaterShadow';
	const shadowMesh = new THREE.Mesh( opts.geometry ?? new THREE.PlaneGeometry( 36000, 36000, 1, 1 ), shadowMat );
	shadowMesh.name = 'waterShadow';
	shadowMesh.receiveShadow = true;
	shadowMesh.renderOrder = 2;
	mesh.add( shadowMesh );
	// 2 cm above the water (the sea's shadow is a child of the rotated plane: its local z is up)
	if ( opts.geometry ) shadowMesh.position.set( 0, 0.02, 0 ); else shadowMesh.position.set( 0, 0, 0.02 );

	return { mesh, material: mat, uniforms: U, reflector: refl, reflection: reproj, shadowMesh };
}
