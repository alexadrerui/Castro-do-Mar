import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeSimplex, mulberry32 } from '../core/noise.js';

// Procedural plant geometry. Every geometry carries:
//   color  (vec3)  base albedo (bark / leaf tint)
//   leaf   (float) 1 = foliage, 0 = bark
//   sway   (float) wind weight (0 at the base, 1 at the tips)
//   ao     (float) baked occlusion inside the crown

const nz = makeSimplex( 55 );

function finalize( geo, col, leaf, sway, ao, card = 0 ) {
	if ( geo.index ) geo = geo.toNonIndexed();
	const n = geo.attributes.position.count;
	const c = new Float32Array( n * 3 ), l = new Float32Array( n ), s = new Float32Array( n ), a = new Float32Array( n );
	const p = geo.attributes.position;
	for ( let i = 0; i < n; i ++ ) {
		c[ i * 3 ] = col.r; c[ i * 3 + 1 ] = col.g; c[ i * 3 + 2 ] = col.b;
		l[ i ] = leaf;
		s[ i ] = typeof sway === 'function' ? sway( p.getX( i ), p.getY( i ), p.getZ( i ) ) : sway;
		a[ i ] = typeof ao === 'function' ? ao( p.getX( i ), p.getY( i ), p.getZ( i ) ) : ao;
	}
	// packed to stay under WebGPU's 8 vertex-buffer limit: aux = (leaf, sway, ao, card)
	const aux = new Float32Array( n * 4 );
	for ( let i = 0; i < n; i ++ ) { aux[ i * 4 ] = l[ i ]; aux[ i * 4 + 1 ] = s[ i ]; aux[ i * 4 + 2 ] = a[ i ]; aux[ i * 4 + 3 ] = card; }
	geo.setAttribute( 'color', new THREE.BufferAttribute( c, 3 ) );
	geo.setAttribute( 'aux', new THREE.BufferAttribute( aux, 4 ) );
	if ( ! geo.attributes.uv || card === 0 ) geo.setAttribute( 'uv', new THREE.BufferAttribute( new Float32Array( n * 2 ), 2 ) );
	return geo;
}

// Atlas tiles (u0, v0) of core/texgen.js makeFoliageAtlas (flipY).
const TILE = { oak: [ 0, 0.5 ], pine: [ 0.5, 0.5 ], round: [ 0, 0 ], grass: [ 0.5, 0 ] };

// Leaf cards scattered over a crown ellipsoid. Normals point away from the
// crown centre (soft, volumetric lighting); cards face outward with jitter.
function leafCards( count, cx, cy, cz, rx, ry, rz, size, tile, rnd, H, opts = {} ) {
	const { droop = 0.3, inner = 0.55 } = opts;
	const pos = [], nor = [], uv = [];
	const [ u0, v0 ] = TILE[ tile ];
	const q = new THREE.Quaternion(), e = new THREE.Euler();
	const corners = [ [ - 0.5, 0 ], [ 0.5, 0 ], [ 0.5, 1 ], [ - 0.5, 1 ] ];
	const cu = [ [ 0, 0 ], [ 0.5, 0 ], [ 0.5, 0.5 ], [ 0, 0.5 ] ];
	for ( let i = 0; i < count; i ++ ) {
		// point on / inside the ellipsoid shell
		const th = rnd() * Math.PI * 2, ph = Math.acos( 1 - 2 * Math.pow( rnd(), 0.8 ) );
		const rr = inner + ( 1 - inner ) * Math.sqrt( rnd() );
		const dx = Math.sin( ph ) * Math.cos( th ), dy = Math.cos( ph ), dz = Math.sin( ph ) * Math.sin( th );
		const px = cx + dx * rx * rr, py = cy + dy * ry * rr, pz = cz + dz * rz * rr;
		const out = new THREE.Vector3( dx, dy * 0.7 + 0.15, dz ).normalize();
		e.set( - droop - rnd() * 0.6, Math.atan2( out.x, out.z ) + ( rnd() - 0.5 ) * 1.2, ( rnd() - 0.5 ) * 1.4 );
		q.setFromEuler( e );
		const s = size * ( 0.75 + rnd() * 0.5 );
		const vs = corners.map( ( [ a, b ] ) => new THREE.Vector3( a * s, b * s - s * 0.2, 0 ).applyQuaternion( q ).add( new THREE.Vector3( px, py, pz ) ) );
		for ( const k of [ 0, 1, 2, 0, 2, 3 ] ) {
			pos.push( vs[ k ].x, vs[ k ].y, vs[ k ].z );
			const n = vs[ k ].clone().sub( new THREE.Vector3( cx, cy - ry * 0.3, cz ) ).normalize().lerp( out, 0.3 ).normalize();
			nor.push( n.x, n.y, n.z );
			uv.push( u0 + cu[ k ][ 0 ], v0 + cu[ k ][ 1 ] );
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( nor, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	return finalize( g, new THREE.Color( 1, 1, 1 ), 1, ( x, y ) => Math.min( 1, ( y / H ) ** 1.4 ), ( x, y, z ) => {
		const d = Math.hypot( ( x - cx ) / rx, ( y - cy ) / ry, ( z - cz ) / rz );
		return Math.min( 1, 0.35 + 0.65 * d ) * ( 0.65 + 0.35 * Math.min( 1, Math.max( 0, ( y - cy + ry ) / ( 2 * ry ) ) ) );
	}, 1 );
}

// Noisy foliage blob with soft (spherical) normals.
function blob( r, detail, cx, cy, cz, squash = 0.85, seed = 0 ) {
	const g = new THREE.IcosahedronGeometry( r, detail );
	const p = g.attributes.position, nrm = g.attributes.normal;
	for ( let i = 0; i < p.count; i ++ ) {
		let x = p.getX( i ), y = p.getY( i ), z = p.getZ( i );
		const d = 1 + 0.22 * nz( x * 1.7 + seed * 3.1 + y, z * 1.7 - y * 0.7 + seed ) + 0.1 * nz( x * 4 + seed, z * 4 + y * 2 );
		x *= d; y *= d * squash; z *= d;
		p.setXYZ( i, x + cx, y + cy, z + cz );
		const l = Math.hypot( x, y / squash, z ) || 1;
		nrm.setXYZ( i, x / l, ( y / squash ) / l * 0.8 + 0.2, z / l );
	}
	return g;
}

function trunk( r0, r1, h, seg = 7, lean = [ 0, 0 ] ) {
	const g = new THREE.CylinderGeometry( r1, r0, h, seg, 3, true );
	g.translate( 0, h / 2, 0 );
	const p = g.attributes.position;
	for ( let i = 0; i < p.count; i ++ ) {
		const t = p.getY( i ) / h;
		p.setX( i, p.getX( i ) + lean[ 0 ] * t * t );
		p.setZ( i, p.getZ( i ) + lean[ 1 ] * t * t );
	}
	g.computeVertexNormals();
	return g;
}

const BARK_BIRCH = new THREE.Color( 0xb8b0a0 );

// Birch / poplar with a narrow crown (used for the yellow autumn trees).
export function birchGeometry( lod = 0, seed = 3 ) {
	const rnd = mulberry32( seed );
	const H = 10;
	const parts = [];
	parts.push( finalize( trunk( 0.24, 0.1, 7.5, lod ? 5 : 7, [ 0.3, 0.1 ] ), BARK_BIRCH, 0, ( x, y ) => ( y / H ) ** 2 * 0.5, 0.6 ) );
	const clumps = lod ? 3 : 7;
	const leafCol = new THREE.Color( 1, 1, 1 );
	for ( let i = 0; i < clumps; i ++ ) {
		const t = i / clumps;
		const a = rnd() * Math.PI * 2;
		const br = ( 1.5 - t * 0.5 ) * ( lod ? 1.2 : 1 );
		if ( lod === 0 ) parts.push( leafCards( 20, Math.cos( a ) * 0.8, 4.2 + t * 5, Math.sin( a ) * 0.8, br * 1.2, br * 1.35, br * 1.2, 1.0, 'round', rnd, H, { inner: 0.45 } ) );
		const g = blob( br * ( lod ? 1 : 0.65 ), lod ? 0 : 1, Math.cos( a ) * 0.8, 4.2 + t * 5, Math.sin( a ) * 0.8, 1.15, seed * 7 + i );
		parts.push( finalize( g, leafCol, 1, ( x, y ) => Math.min( 1, ( y / H ) ** 1.3 ), ( x, y, z ) => 0.55 + 0.45 * Math.min( 1, Math.hypot( x, z ) / 1.5 ) ) );
	}
	const geo = mergeGeometries( parts.map( stripUV ) );
	geo.computeBoundingSphere();
	return geo;
}

function stripUV( g ) {
	return g;
}
