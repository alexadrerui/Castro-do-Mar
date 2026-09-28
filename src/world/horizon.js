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
	// higher massifs to the north-west / west, lower across the lake (east)
	const bias = 0.55 + 0.45 * Math.cos( ang + 0.9 );

	// domain warp for natural, non-grid ridgelines
	const wx = x + 1600 * fbm( nJ, x * 0.00025, z * 0.00025, 3 );
	const wz = z + 1600 * fbm( nJ, x * 0.00025 + 7.3, z * 0.00025 - 2.1, 3 );

	// great ranges: 3.5 - 12 km
	const m = ss( 3200, 6200, r ) * ( open + ( 1 - open ) * ss( 9000, 14000, r ) );
	if ( m > 0 ) {
		// broad massif body + rounded crests + a little ridged detail
		const body = Math.pow( ss( - 0.35, 0.75, fbm( nJ, wx * 0.00022, wz * 0.00022, 4 ) ), 1.6 );
		const crest = Math.pow( ridgedSoft( nH, wx * 0.00045, wz * 0.00045, 5 ), 2.2 );
		const env = 0.5 + 0.5 * ss( - 0.3, 0.6, fbm( nJ, x * 0.00012, z * 0.00012, 3 ) );
		const peak = 2200 * env * bias * ( 0.55 * body * ( 0.6 + 0.4 * crest ) + 0.45 * crest * ( 0.4 + 0.6 * body ) );
		h = Math.max( h, - 20 + m * peak );
	}
	// forested foothills & far shore: 1.6 - 5 km, not inside the lake corridor
	const mid = ss( 1500, 2600, r ) * open * ( 1 - ss( 5000, 7000, r ) );
	if ( mid > 0 ) {
		const hills = Math.pow( ridgedSoft( nJ, wx * 0.0011, wz * 0.0011, 4 ), 2.0 ) * 380 * ( 0.4 + 0.6 * fbm( nH, x * 0.0005, z * 0.0005, 3 ) + 0.3 );
		h = Math.max( h, - 25 + mid * hills );
	}
	// receding promontories inside the lake corridor (layered depth)
	const prom = ( 1 - open ) * ss( 1400, 2200, r ) * ss( 0.25, 0.6, fbm( nH, x * 7e-4, z * 7e-4, 3 ) );
	if ( prom > 0 ) h = Math.max( h, - 10 + prom * ( 120 + 60 * ridged( nJ, x * 0.002, z * 0.002, 3 ) ) );
	// the western massif continues past the terrain edge (1.3 - 3.5 km WNW)
	const west = ss( - 2.6, - 2.2, ang ) * ( 1 - ss( - 1.0, - 0.8, ang ) ) * ss( 1100, 1500, r ) * ( 1 - ss( 3200, 4200, r ) );
	if ( west > 0 ) {
		const rw = ridgedSoft( nH, wx * 0.0012, wz * 0.0012, 4 );
		h = Math.max( h, west * ( 500 + 900 * Math.pow( rw, 1.5 ) ) );
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
	const snowLine = float( 420 ).add( n1.mul( 200 ) ).add( slope.mul( 180 ) );
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
