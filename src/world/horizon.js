import * as THREE from 'three/webgpu';
import {
	positionWorld, normalWorld, vec2, vec3, float, color, mix, smoothstep, clamp, texture
} from 'three/tsl';
import { makeSimplex, fbm, ridgedSoft, smoothstep as ss } from '../core/noise.js';
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

	// snowy ranges: a band from 2.8 to ~10 km (the lake corridor opens them from 7 km), fading out
	// beyond (08/10/2026, the user: they were too big, bare grey walls that did not fit the view)
	const m = ss( 2800, 5200, r ) * ( open + ( 1 - open ) * ss( 6500, 9500, r ) ) * ( 1 - 0.6 * ss( 9000, 13000, r ) );
	if ( m > 0 ) {
		// massif bodies with alpine crests on top: rounded ridges (ridgedSoft) raised to a power, so
		// the summits stay peaked but broad; the squared ridged noise of before rose in needles, thin
		// spires 1 km tall all along the horizon
		const body = Math.pow( ss( - 0.4, 0.7, fbm( nJ, wx * 0.0002, wz * 0.0002, 4 ) ), 1.3 );
		const sharp = Math.pow( ridgedSoft( nH, wx * 0.00026, wz * 0.00026, 3 ), 2.6 );
		const env = 0.7 + 0.3 * ss( - 0.3, 0.6, fbm( nJ, x * 0.00012, z * 0.00012, 3 ) );
		const peak = 1200 * env * bias * ( 0.2 + 0.35 * body + 0.6 * sharp * ( 0.5 + 0.5 * body ) );
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
		const hills = Math.pow( ridgedSoft( nJ, wx * 0.0009, wz * 0.0009, 4 ), 1.8 ) * 420 * ( 0.45 + 0.55 * fbm( nH, x * 0.0005, z * 0.0005, 3 ) + 0.25 );
		// a forested base under every range so none rises straight from water
		h = Math.max( h, - 25 + mid * ( 70 + hills ) );
	}
	return h;
}

// cached: { position, normal, index } of an earlier load (main.js keeps them in the IndexedDB cache,
// keyed by the hash of this code and of the height function); without it the ring is computed
// (~1 s) and its arrays are left in mesh.userData.bake for the cache.
// detailTex: the terrain's tileable detail texture (terrain.js; R fine fbm, B mid fbm), read for the
// colour's noise instead of two fractal noises computed per pixel (~0.3 s of cold compile)
export async function createHorizon( onProgress, cached = null, detailTex = null ) {
	const geo = new THREE.BufferGeometry();
	if ( cached ) {
		geo.setAttribute( 'position', new THREE.BufferAttribute( cached.position, 3 ) );
		geo.setAttribute( 'normal', new THREE.BufferAttribute( cached.normal, 3 ) );
		geo.setIndex( new THREE.BufferAttribute( cached.index, 1 ) );
	} else await buildRing( geo, onProgress );
	geo.computeBoundingSphere();
	return horizonMesh( geo, onProgress, detailTex );
}

async function buildRing( geo, onProgress ) {
	const cx = TERRAIN.centerX, cz = TERRAIN.centerZ;
	const half = TERRAIN.size / 2;
	const A = 1200, R = 300;
	const r0 = 950, r1 = 15000;
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
	const idx = new Uint32Array( ( R - 1 ) * A * 6 );
	let n = 0;
	for ( let j = 0; j < R - 1; j ++ ) for ( let i = 0; i < A; i ++ ) {
		const a = j * A + i, b = j * A + ( i + 1 ) % A, c = ( j + 1 ) * A + i, d = ( j + 1 ) * A + ( i + 1 ) % A;
		// counter-clockwise seen from above (normals up): the reversed order culled the slopes
		// facing the camera and showed the far sides of the ranges, lit from below
		idx[ n ++ ] = a; idx[ n ++ ] = b; idx[ n ++ ] = c; idx[ n ++ ] = b; idx[ n ++ ] = d; idx[ n ++ ] = c;
	}
	geo.setAttribute( 'position', new THREE.BufferAttribute( verts, 3 ) );
	geo.setIndex( new THREE.BufferAttribute( idx, 1 ) );
	geo.computeVertexNormals();
	geo.userData.bake = { position: verts, normal: geo.attributes.normal.array, index: idx };
}

function horizonMesh( geo, onProgress, detailTex ) {
	const mat = new THREE.MeshStandardNodeMaterial();
	const wp = positionWorld;
	const slope = float( 1 ).sub( normalWorld.y.clamp( 0, 1 ) );
	// value-noise fbm, stretched to the contrast of the fractal noises it replaces; n2 drifts with
	// the height so a cliff face is not streaked straight down
	const n1 = texture( detailTex, wp.xz.div( 3300 ) ).b.sub( 0.5 ).mul( 1.6 ).add( 0.5 ).clamp( 0, 1 );
	const n2 = texture( detailTex, wp.xz.add( wp.y.mul( 0.7 ) ).div( 2700 ) ).r.sub( 0.5 ).mul( 1.6 ).add( 0.5 ).clamp( 0, 1 );
	const forest = mix( color( 0x223619 ), color( 0x3b5226 ), n1 );
	const rock = mix( color( 0x4c4d52 ), color( 0x7f7f84 ), n2 );
	const snowLine = float( 470 ).add( n1.mul( 210 ) ).add( slope.mul( 150 ) );
	let col = mix( forest, rock, smoothstep( 0.3, 0.6, slope.add( n2.mul( 0.2 ) ) ).max( smoothstep( 330, 600, wp.y.add( n1.mul( 120 ) ) ) ) );
	col = mix( col, color( 0xf4f6fa ), smoothstep( snowLine, snowLine.add( 100 ), wp.y ).mul( smoothstep( 0.7, 0.95, slope ).oneMinus() ) );
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
	if ( geo.userData.bake ) { mesh.userData.bake = geo.userData.bake; delete geo.userData.bake; }
	onProgress?.( 1 );
	return mesh;
}

export { clamp, vec3 };
