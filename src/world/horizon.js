import * as THREE from 'three/webgpu';
import {
	positionWorld, normalWorld, vec2, vec3, float, color, mix, smoothstep, clamp, mx_fractal_noise_float
} from 'three/tsl';
import { makeSimplex, fbm, ridged, ridgedSoft, smoothstep as ss } from '../core/noise.js';
import { rawHeight } from './heightfield.js';
import { TERRAIN, VILLAGE } from './layout.js';

const nH = makeSimplex( 1789 );
const nJ = makeSimplex( 915 );

// Distant ranges: snowy granite massifs ringing the lake (both references
// show a continuous wall of peaks on the horizon, higher to the north-west).
export function farHeight( x, z ) {
	const dx = x - VILLAGE.x, dz = z - VILLAGE.z;
	const r = Math.hypot( dx, dz );
	let h = rawHeight( x, z );
	const ang = Math.atan2( dx, - dz ); // 0 = north, +pi/2 = east
	// the lake runs away to the north-north-east: keep that corridor open
	const corridor = Math.abs( Math.atan2( Math.sin( ang - 0.35 ), Math.cos( ang - 0.35 ) ) );
	const open = ss( 0.18, 0.55, corridor );
	// the whole horizon is alpine in the reference; a bit lower to the south
	const bias = 0.78 + 0.22 * Math.cos( ang + 0.4 );

	// domain warp for natural, non-grid ridgelines
	const wx = x + 1600 * fbm( nJ, x * 0.00025, z * 0.00025, 3 );
	const wz = z + 1600 * fbm( nJ, x * 0.00025 + 7.3, z * 0.00025 - 2.1, 3 );

	// great snowy ranges: 2.8 - 12 km (the lake corridor opens them from 7 km)
	const m = ss( 2800, 5200, r ) * ( open + ( 1 - open ) * ss( 6500, 9500, r ) );
	if ( m > 0 ) {
		// massif bodies with sharp, jagged alpine crests (ridged) on top
		const body = Math.pow( ss( - 0.4, 0.7, fbm( nJ, wx * 0.0002, wz * 0.0002, 4 ) ), 1.3 );
		const sharp = ridged( nH, wx * 0.00026, wz * 0.00026, 4 );
		const env = 0.7 + 0.3 * ss( - 0.3, 0.6, fbm( nJ, x * 0.00012, z * 0.00012, 3 ) );
		const peak = 2100 * env * bias * ( 0.2 + 0.35 * body + 0.6 * sharp * ( 0.5 + 0.5 * body ) );
		h = Math.max( h, - 20 + m * peak );
	}
	// forested mountains across the lake, descending to the water (right of
	// the reference): 1.8 - 5 km, outside the corridor
	// the far end of the lake: forested foothills so the great ranges rise
	// from land, not straight out of the water
	const shore = ( 1 - open ) * ss( 5200, 6800, r );
	if ( shore > 0 ) h = Math.max( h, - 15 + shore * ( 140 + 180 * ( 0.5 + 0.5 * fbm( nH, x * 0.0007, z * 0.0007, 3 ) ) ) );
	const mid = ss( 1700, 2800, r ) * open * ( 1 - ss( 5500, 7500, r ) );
	if ( mid > 0 ) {
		const hills = Math.pow( ridgedSoft( nJ, wx * 0.0009, wz * 0.0009, 4 ), 1.8 ) * 650 * ( 0.45 + 0.55 * fbm( nH, x * 0.0005, z * 0.0005, 3 ) + 0.25 );
		// a forested base under every range so none rises straight from water
		h = Math.max( h, - 25 + mid * ( 70 + hills ) );
	}
	return h;
}

export async function createHorizon( onProgress ) {
	const cx = TERRAIN.centerX, cz = TERRAIN.centerZ;
	const half = TERRAIN.size / 2;
	const A = 1200, R = 300;
	const r0 = 950, r1 = 19000;
	const verts = new Float32Array( A * R * 3 );
	for ( let j = 0; j < R; j ++ ) {
		const r = r0 * Math.pow( r1 / r0, j / ( R - 1 ) );
		for ( let i = 0; i < A; i ++ ) {
			const a = i / A * Math.PI * 2;
			const x = cx + Math.cos( a ) * r, z = cz + Math.sin( a ) * r;
			let h = farHeight( x, z );
			// sink under the high-res terrain so they never fight
			const inside = Math.min( half - Math.abs( x - cx ), half - Math.abs( z - cz ) );
			if ( inside > 0 ) h -= Math.min( 80, 6 + inside * 0.6 );
			const k = ( j * A + i ) * 3;
			verts[ k ] = x; verts[ k + 1 ] = h; verts[ k + 2 ] = z;
		}
		if ( j % 20 === 0 ) { onProgress?.( j / R ); await new Promise( ( r ) => setTimeout( r, 0 ) ); }
	}
	const idx = [];
	for ( let j = 0; j < R - 1; j ++ ) for ( let i = 0; i < A; i ++ ) {
		const a = j * A + i, b = j * A + ( i + 1 ) % A, c = ( j + 1 ) * A + i, d = ( j + 1 ) * A + ( i + 1 ) % A;
		idx.push( a, c, b, b, c, d );
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.BufferAttribute( verts, 3 ) );
	geo.setIndex( idx );
	geo.computeVertexNormals();
	geo.computeBoundingSphere();

	const mat = new THREE.MeshStandardNodeMaterial();
	const wp = positionWorld;
	const slope = float( 1 ).sub( normalWorld.y.clamp( 0, 1 ) );
	const n1 = mx_fractal_noise_float( wp.xz.mul( 0.0012 ), 4 ).mul( 0.5 ).add( 0.5 );
	const n2 = mx_fractal_noise_float( wp.mul( 0.006 ), 3 ).mul( 0.5 ).add( 0.5 );
	const forest = mix( color( 0x223619 ), color( 0x3b5226 ), n1 );
	const rock = mix( color( 0x4c4d52 ), color( 0x7f7f84 ), n2 );
	const snowLine = float( 1150 ).add( n1.mul( 350 ) ).add( slope.mul( 250 ) );
	let col = mix( forest, rock, smoothstep( 0.3, 0.6, slope.add( n2.mul( 0.2 ) ) ).max( smoothstep( 550, 1000, wp.y.add( n1.mul( 200 ) ) ) ) );
	col = mix( col, color( 0xf4f6fa ), smoothstep( snowLine, snowLine.add( 160 ), wp.y ).mul( smoothstep( 0.7, 0.95, slope ).oneMinus() ) );
	// aerial perspective planes: far ranges fade into blue haze
	const dist = wp.xz.sub( vec2( VILLAGE.x, VILLAGE.z ) ).length();
	col = mix( col, color( 0x9fb4d0 ), smoothstep( 3000, 15000, dist ).mul( 0.75 ) );
	col = mix( col, color( 0x7a735f ), smoothstep( 0, 4, wp.y ).oneMinus() );
	mat.colorNode = col;
	mat.roughnessNode = float( 0.93 );
	const mesh = new THREE.Mesh( geo, mat );
	mesh.name = 'horizon';
	mesh.receiveShadow = false;
	mesh.frustumCulled = false;
	onProgress?.( 1 );
	return mesh;
}

export { clamp, vec3 };
