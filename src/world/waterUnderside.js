import * as THREE from 'three/webgpu';
import {
	Fn, uniform, float, vec2, vec3, sin, cos, dot, normalize, refract, length, mix, smoothstep, pow, max, exp,
	positionWorld, cameraPosition, time, fract, floor,
} from 'three/tsl';

// The water surface seen from below (the water mesh is one-sided: from below it shows nothing).
// A plane at the water level drawn from its back side only, so it exists for the camera under
// water and costs nothing above. Its look follows the optics of a flat-ish interface seen from
// the denser side:
//  - Snell's window: rays steeper than the critical angle (~48.6 deg from vertical) leave the water
//    and show the sky, compressed into a bright circle overhead (the refracted view direction picks
//    the sky colour, with the sun's glow);
//  - outside the window the surface is a mirror (total internal reflection) of the dim water below;
//  - the window's edge fades (transmission drops toward the critical angle);
//  - waves: a few analytic wave trains (the swell from the sea side plus shorter ripples) tilt the
//    normal, so the window wobbles and breaks up; the ripples fade with distance (no sparkle).
// The underwater pass (post/underwater.js) then absorbs and fogs it like everything else.
const IOR = 1.333;
const CRIT_COS = Math.sqrt( 1 - 1 / ( IOR * IOR ) ); // cos of the critical angle (~0.661)
// wave trains: direction (travel), wavelength (m), amplitude (m)
const WAVES = [
	[ - 1.0, 0.0, 9.0, 0.12 ],
	[ - 0.8, 0.6, 4.3, 0.05 ],
	[ - 0.6, - 0.8, 2.1, 0.02 ],
	[ 0.3, - 1.0, 1.1, 0.008 ],
	[ - 0.9, 0.4, 0.6, 0.004 ],
];

const hash = ( p ) => fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ).mul( 43758.5453 ) );
const vnoise = ( p ) => {

	const i = floor( p ), f = fract( p );
	const w = f.mul( f ).mul( float( 3 ).sub( f.mul( 2 ) ) );
	return mix( mix( hash( i ), hash( i.add( vec2( 1, 0 ) ) ), w.x ), mix( hash( i.add( vec2( 0, 1 ) ) ), hash( i.add( vec2( 1, 1 ) ) ), w.x ), w.y );

};

export function createWaterUnderside( { waterLevel = 0, size = 36000 } = {} ) {

	const U = {
		sunDir: uniform( new THREE.Vector3( 0, 1, 0 ) ).setName( 'wuSunDir' ),
		sun: uniform( new THREE.Color( 1, 1, 1 ) ).setName( 'wuSun' ), // sun colour x intensity
		horizon: uniform( new THREE.Color( 0.5, 0.6, 0.72 ) ).setName( 'wuHorizon' ),
		zenith: uniform( new THREE.Color( 0.25, 0.42, 0.75 ) ).setName( 'wuZenith' ),
		murk: uniform( new THREE.Color( 0x1d4f52 ) ).setName( 'wuMurk' ),
	};

	const mat = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide } );
	mat.name = 'WaterUnderside';
	mat.fog = false; // the underwater pass fogs it

	mat.colorNode = Fn( () => {

		const p = positionWorld;
		const toSurf = p.sub( cameraPosition );
		const dist = length( toSurf );
		const V = toSurf.div( dist ); // from the eye up to the surface
		// wave slopes (analytic derivatives of sum A sin( k d.x - w t )), ripples fading with distance
		let dx = float( 0 ), dz = float( 0 );
		for ( const [ ux, uz, L, A ] of WAVES ) {

			const l = Math.hypot( ux, uz ), kx = ux / l * 2 * Math.PI / L, kz = uz / l * 2 * Math.PI / L;
			const w = Math.sqrt( 9.81 * 2 * Math.PI / L ); // deep-water dispersion
			const fade = exp( dist.div( - L * 14 ) ); // shorter waves fade sooner (no sparkle far away)
			const c = cos( p.x.mul( kx ).add( p.z.mul( kz ) ).sub( time.mul( w ) ) ).mul( A ).mul( fade );
			dx = dx.add( c.mul( kx ) );
			dz = dz.add( c.mul( kz ) );

		}

		const n = normalize( vec3( dx.negate(), 1, dz.negate() ) ); // surface normal, up
		// looking up through the surface from below: the normal on our side points down
		const cosI = max( dot( V, n ), 0 );
		const T = smoothstep( CRIT_COS, CRIT_COS + 0.08, cosI ); // transmission: 0 outside the window
		const R = refract( V, n.negate(), IOR ); // into the air (zero under total internal reflection)
		const up = max( R.y, 0 );
		// the sky through the window, with soft cloud banks (value noise of the refracted direction
		// projected on a cloud layer)
		const cp = R.xz.div( max( R.y, 0.08 ) ).mul( 1.3 ).add( vec2( time.mul( 0.004 ), 0 ) );
		const cloud = smoothstep( 0.45, 0.85, vnoise( cp ).mul( 0.65 ).add( vnoise( cp.mul( 2.7 ) ).mul( 0.35 ) ) ).mul( smoothstep( 0.05, 0.4, up ) );
		const sky = mix( mix( vec3( U.horizon ), vec3( U.zenith ), pow( up, 0.6 ) ), vec3( U.horizon ).mul( 1.35 ), cloud.mul( 0.7 ) ).mul( 1.7 );
		const s = max( dot( normalize( R.add( vec3( 0, 1e-4, 0 ) ) ), U.sunDir ), 0 );
		const sunGlow = vec3( U.sun ).mul( pow( s, 600 ).mul( 2.5 ).add( pow( s, 24 ).mul( 0.25 ) ) );
		// outside the window: the mirror image of the water below (dim, a little lighter at
		// grazing angles where it reflects the brighter water near the surface)
		const mirror = vec3( U.murk ).mul( mix( float( 0.55 ), float( 0.9 ), float( 1 ).sub( cosI ) ) );
		// a darker rim just outside the window's edge (the grazing rays carry little light)
		const rim = smoothstep( CRIT_COS - 0.12, CRIT_COS, cosI ).mul( float( 1 ).sub( T ) );
		return mix( mirror.mul( float( 1 ).sub( rim.mul( 0.45 ) ) ), sky.add( sunGlow ), T );

	} )();

	const geo = new THREE.PlaneGeometry( size, size, 1, 1 );
	const mesh = new THREE.Mesh( geo, mat );
	mesh.rotation.x = - Math.PI / 2; // front face up: the back side faces down, seen from below
	mesh.position.y = waterLevel;
	mesh.name = 'waterUnderside';
	mesh.frustumCulled = false;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.visible = false;

	return {
		mesh, uniforms: U,
		update( underwater ) {

			mesh.visible = underwater;

		},
		// daylight: haze colour (horizon), the sun's direction and light
		setDaylight( hazeColor, sunDir, sunLight, murk ) {

			U.horizon.value.copy( hazeColor );
			const day = Math.max( hazeColor.r, hazeColor.g, hazeColor.b ) / 0.72;
			U.zenith.value.setRGB( 0.22, 0.4, 0.78 ).multiplyScalar( day );
			U.sunDir.value.copy( sunDir );
			U.sun.value.copy( sunLight.color ).multiplyScalar( sunLight.intensity / 5.4 );
			if ( murk ) U.murk.value.copy( murk );

		},
	};

}
