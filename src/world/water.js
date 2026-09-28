import * as THREE from 'three/webgpu';
import {
	Fn, uniform, texture, positionWorld, cameraPosition, time, reflector,
	vec2, vec3, float, color, mix, smoothstep, clamp, max, pow, dot, normalize, reflect, length, sin,
	mx_noise_float
} from 'three/tsl';
import { WATER_LEVEL } from './layout.js';

// Tileable wave-slope texture: sum of sines with integer wave vectors so it
// wraps perfectly. RG store d(h)/dx, d(h)/dz.
function createWaveTexture( size = 256, seed = 7 ) {
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

export function createWater( heightTex, sunDir, opts = {} ) {

	const waveTex = createWaveTexture();
	const U = {
		sunDir: uniform( sunDir ),
		sunColor: uniform( new THREE.Color( 0xfff0d8 ) ),
		deep: uniform( new THREE.Color( 0x173556 ) ),
		mid: uniform( new THREE.Color( 0x17506b ) ),
		shallow: uniform( new THREE.Color( 0x2f6f74 ) ),
		waveStrength: uniform( 0.4 ),
		reflectivity: uniform( 1.0 )
	};

	const mat = new THREE.MeshBasicNodeMaterial();
	mat.transparent = true;
	mat.depthWrite = true;
	mat.name = 'WaterTSL';

	const mesh = new THREE.Mesh( new THREE.PlaneGeometry( 36000, 36000, 1, 1 ), mat );
	mesh.rotation.x = - Math.PI / 2;
	mesh.position.y = WATER_LEVEL;
	mesh.name = 'water';
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
	const depth = max( float( WATER_LEVEL ).sub( groundH ), 0.0 );

	// animated wave slopes: 3 scrolling octaves, fading with distance
	const slope = Fn( () => {
		const t = time;
		const s1 = texture( waveTex, wp.xz.div( 46 ).add( vec2( t.mul( 0.010 ), t.mul( 0.006 ) ) ) ).rg.mul( 2 ).sub( 1 );
		const s2 = texture( waveTex, wp.xz.div( 15.5 ).add( vec2( t.mul( - 0.018 ), t.mul( 0.013 ) ) ) ).rg.mul( 2 ).sub( 1 );
		const s3 = texture( waveTex, wp.xz.div( 4.3 ).add( vec2( t.mul( 0.035 ), t.mul( - 0.031 ) ) ) ).rg.mul( 2 ).sub( 1 );
		const nearF = smoothstep( 20, 220, dist ).oneMinus();
		return s1.mul( 0.55 ).add( s2.mul( 0.4 ) ).add( s3.mul( 0.3 ).mul( nearF ) );
	} )();
	const strength = mix( 0.6, 0.05, smoothstep( 40, 2200, dist ) ).mul( U.waveStrength )
		.mul( smoothstep( 0.0, 1.5, depth ).mul( 0.7 ).add( 0.3 ) );
	const N = normalize( vec3( slope.x.mul( strength ).negate(), 1.0, slope.y.mul( strength ).negate() ) );

	// planar reflection with wave distortion
	const refl = reflector( { resolutionScale: opts.reflectionScale ?? 0.45, generateMipmaps: false, bounces: false } );
	refl.uvNode = refl.uvNode.add( N.xz.mul( 0.012 ).mul( smoothstep( 0, 3000, dist ).oneMinus().mul( 0.8 ).add( 0.2 ) ) );
	mesh.add( refl.target );

	mat.colorNode = Fn( () => {
		const L = normalize( U.sunDir );
		const cosT = max( dot( V, N ), 0.0 );
		const fres = float( 0.02 ).add( float( 0.98 ).mul( pow( float( 1 ).sub( cosT ), 5.0 ) ) );

		// body colour by depth (turquoise over sand -> deep teal/navy)
		const body = mix( U.shallow, U.mid, smoothstep( 0.8, 3.5, depth ) ).toVar();
		body.assign( mix( body, U.deep, smoothstep( 12.0, 36.0, depth ) ) );
		const diffuse = max( dot( N, L ), 0.0 ).mul( 0.35 ).add( 0.45 );
		const bodyLit = body.mul( U.sunColor ).mul( diffuse );

		const reflCol = refl.rgb.min( vec3( 1.1 ) );
		const kR = clamp( fres.mul( 1.15 ).add( 0.06 ), 0.0, 1.0 ).mul( U.reflectivity );
		const col = mix( bodyLit, reflCol, kR ).toVar();

		// sun glitter
		const R = reflect( L.negate(), N );
		const spec = pow( max( dot( R, V ), 0.0 ), 420.0 ).mul( 9.0 ).add( pow( max( dot( R, V ), 0.0 ), 60.0 ).mul( 0.25 ) );
		col.addAssign( U.sunColor.mul( spec ) );

		// shoreline foam: bands travelling towards the shore
		const fn = mx_noise_float( wp.xz.mul( 0.35 ).add( time.mul( 0.08 ) ) ).mul( 0.5 ).add( 0.5 );
		const band = sin( depth.mul( 9.0 ).sub( time.mul( 1.7 ) ).add( fn.mul( 5.0 ) ) ).mul( 0.5 ).add( 0.5 );
		const foam = smoothstep( 0.0, 1.1, depth ).oneMinus().mul( smoothstep( 0.55, 0.95, band ).mul( 0.6 ).add( smoothstep( 0.0, 0.35, depth ).oneMinus() ) ).mul( fn.mul( 0.6 ).add( 0.5 ) );
		col.assign( mix( col, vec3( 0.92, 0.95, 0.95 ), clamp( foam, 0, 0.9 ) ) );
		return col;
	} )();

	// transparency in the shallows lets the seabed show through
	mat.opacityNode = Fn( () => {
		const cosT = max( dot( V, N ), 0.0 );
		const fres = pow( float( 1 ).sub( cosT ), 3.0 );
		const a = mix( 0.18, 1.0, smoothstep( 0.0, 5.5, depth ) );
		return clamp( a.add( fres.mul( 0.5 ) ), 0.0, 1.0 );
	} )();

	return { mesh, material: mat, uniforms: U, reflector: refl };
}
