// The stars (day and night, phase 3): the 9096 stars of the Yale Bright Star Catalog (5th revised ed.,
// BSC5), as packed by takram's three-geospatial (packages/atmosphere/assets/stars.bin and
// apps/data/src/targets/stars.ts, MIT License, Copyright (c) 2024 Shota Matsuda,
// licenses/LICENSE-takram-atmosphere.md): 10 bytes a star, the J2000 equatorial direction as three
// int16, the visual magnitude as a uint8 over -2..8, the colour from the B-V index (vendian.org's star
// colour table) as three uint8. As in its Stars / StarsNode, each star is a point at infinity whose
// brightness is 10^(-m / 2.5); here a small camera-facing quad (three's PointsNodeMaterial draws a
// non-Points mesh as instanced sprites: WebGPU has no point size) with a soft round profile, drawn
// additively over the sky, behind the mountains and under the clouds (composited later).
// The sky turns with the clock (world/clock.js): the hour angle of the sun plus its right ascension on
// the clock's fixed day gives the sidereal time; the celestial pole stands at this latitude.
// Faint near the horizon (extinction), with a slight scintillation there. app.stars: intensity,
// size, twinkle; visible with the night (sky.night).
import * as THREE from 'three/webgpu';
import { Fn, attribute, cameraPosition, exp, float, hash, instanceIndex, max, positionGeometry, sin, smoothstep, time, uniform, vec4 } from 'three/tsl';
import { LAT_DEG, SUN_RA_DEG } from './clock.js';

const FAR = 30000;            // m: inside the camera's far plane (40 km), past everything else
const MAG_RANGE = [ - 2, 8 ]; // the catalog's packing

export async function loadStars() {
	const r = await fetch( import.meta.env.BASE_URL + 'sky/stars.bin' );
	if ( ! r.ok ) throw new Error( 'stars.bin ' + r.status );
	return r.arrayBuffer();
}

// the rotation from the J2000 equatorial frame to the local one (+x east, +y up, -z north) at a
// given hour of the clock
const _rz = new THREE.Matrix3(), _m = new THREE.Matrix3();
export function skyRotation( hour, target = new THREE.Matrix3() ) {
	const lst = THREE.MathUtils.degToRad( ( hour - 12 ) * 15 + SUN_RA_DEG ); // local sidereal time
	const c = Math.cos( lst ), s = Math.sin( lst );
	// about the pole by -lst: x' = cos(dec) cos(H), y' = -cos(dec) sin(H) (east), z' = sin(dec)
	_rz.set( c, s, 0, - s, c, 0, 0, 0, 1 );
	const phi = THREE.MathUtils.degToRad( LAT_DEG ), cp = Math.cos( phi ), sp = Math.sin( phi );
	// east, up = cos(lat) x' + sin(lat) z', -north = sin(lat) x' - cos(lat) z'
	_m.set( 0, 1, 0, cp, 0, sp, sp, 0, - cp );
	return target.multiplyMatrices( _m, _rz );
}

export class Stars extends THREE.Mesh {

	// data: stars.bin; night: the sky's night factor (uniform, 0 by day)
	constructor( data, night ) {
		const i16 = new Int16Array( data ), u8 = new Uint8Array( data );
		const n = u8.length / 10;
		const star = new Float32Array( n * 4 ), col = new Float32Array( n * 3 );
		for ( let k = 0; k < n; k ++ ) {
			star[ k * 4 ] = i16[ k * 5 ] / 32767; star[ k * 4 + 1 ] = i16[ k * 5 + 1 ] / 32767; star[ k * 4 + 2 ] = i16[ k * 5 + 2 ] / 32767;
			star[ k * 4 + 3 ] = MAG_RANGE[ 0 ] + ( MAG_RANGE[ 1 ] - MAG_RANGE[ 0 ] ) * u8[ k * 10 + 6 ] / 255;
			// linear already (the packing script stores three.js Color components, converted from the table's hex)
			for ( let j = 0; j < 3; j ++ ) col[ k * 3 + j ] = u8[ k * 10 + 7 + j ] / 255;
		}
		const geo = new THREE.InstancedBufferGeometry();
		geo.setAttribute( 'position', new THREE.Float32BufferAttribute( [ - 0.5, - 0.5, 0, 0.5, - 0.5, 0, 0.5, 0.5, 0, - 0.5, 0.5, 0 ], 3 ) );
		geo.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
		geo.setAttribute( 'aStar', new THREE.InstancedBufferAttribute( star, 4 ) );
		geo.setAttribute( 'aStarColor', new THREE.InstancedBufferAttribute( col, 3 ) );
		geo.instanceCount = n;

		const U = {
			intensity: uniform( 20 ),    // the brightness of a magnitude-0 star's core
			size: uniform( 2.2 ),        // px: the quad of a faint star (the bright ones grow a little)
			twinkle: uniform( 0.35 ),    // scintillation near the horizon
			rotation: uniform( new THREE.Matrix3() ),
			night
		};
		// sizeAttenuation off (PointsMaterial's default is on: at 30 km the stars shrank to a thousandth of a pixel)
		const mat = new THREE.PointsNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false } );
		mat.fog = false;
		const s = attribute( 'aStar', 'vec4' );
		const dir = U.rotation.mul( s.xyz ).normalize();
		mat.positionNode = cameraPosition.add( dir.mul( FAR ) );
		const m = s.w;
		// a little larger for the brightest (Sirius, Vega...), 1 px more from magnitude 1.5 down to -1.5
		mat.sizeNode = U.size.add( max( float( 1.5 ).sub( m ), 0 ).mul( 0.35 ) );
		mat.colorNode = Fn( () => {
			const r2 = positionGeometry.xy.mul( 2 ).lengthSq();
			const core = exp( r2.mul( - 4.5 ) );
			const up = dir.y;
			// extinction toward the horizon (thicker air), the scintillation stronger there
			const ext = smoothstep( - 0.02, 0.22, up );
			const tw = sin( time.mul( hash( instanceIndex ).mul( 9 ).add( 6 ) ).add( hash( instanceIndex.add( 7 ) ).mul( 6.28 ) ) );
			const twinkle = tw.mul( U.twinkle ).mul( up.oneMinus().pow( 2 ) ).add( 1 );
			const flux = float( 10 ).pow( m.mul( - 0.4 ) ).min( 4 );
			const vis = smoothstep( 0.35, 0.9, U.night );
			return vec4( attribute( 'aStarColor', 'vec3' ).mul( flux.mul( U.intensity ).mul( core ).mul( ext ).mul( twinkle ).mul( vis ) ), 1 );
		} )();
		super( geo, mat );
		this.name = 'stars';
		this.frustumCulled = false;
		this.renderOrder = - 0.5; // after the sky dome
		this.matrixAutoUpdate = false;
		this.uniforms = U;
	}

	// the sky's turn at this hour of the clock
	setHour( hour ) { skyRotation( hour, this.uniforms.rotation.value ); }

}
