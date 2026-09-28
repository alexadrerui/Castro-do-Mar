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
export const TILE = { oak: [ 0, 0.5 ], pine: [ 0.5, 0.5 ], round: [ 0, 0 ], grass: [ 0.5, 0 ] };

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

function branch( from, to, r0, r1 ) {
	const dir = new THREE.Vector3().subVectors( to, from );
	const len = dir.length();
	const g = new THREE.CylinderGeometry( r1, r0, len, 5, 1, true );
	g.translate( 0, len / 2, 0 );
	g.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), dir.normalize() ) );
	g.translate( from.x, from.y, from.z );
	return g;
}

const BARK = new THREE.Color( 0x4a3a2b );
const BARK_PINE = new THREE.Color( 0x5a4232 );
const BARK_BIRCH = new THREE.Color( 0xb8b0a0 );

// Broadleaf (oak / chestnut): rounded, lumpy crown. Height ~ 1 unit * scale 8.
export function oakGeometry( lod = 0, seed = 1 ) {
	const rnd = mulberry32( seed );
	const H = 8;
	const parts = [];
	const tr = trunk( 0.42, 0.26, 4.2, lod ? 5 : 8, [ ( rnd() - 0.5 ) * 0.6, ( rnd() - 0.5 ) * 0.6 ] );
	parts.push( finalize( tr, BARK, 0, ( x, y ) => Math.max( 0, y / H ) ** 2 * 0.3, 0.55 ) );
	if ( lod === 0 ) {
		for ( let b = 0; b < 4; b ++ ) {
			const a = b / 4 * Math.PI * 2 + rnd();
			const from = new THREE.Vector3( 0, 2.8 + rnd() * 1.2, 0 );
			const to = new THREE.Vector3( Math.cos( a ) * 2.0, 4.8 + rnd(), Math.sin( a ) * 2.0 );
			parts.push( finalize( branch( from, to, 0.18, 0.08 ), BARK, 0, ( x, y ) => ( y / H ) ** 2 * 0.5, 0.5 ) );
		}
	}
	const clumps = lod ? 4 : 7;
	const leafCol = new THREE.Color( 1, 1, 1 );
	for ( let i = 0; i < clumps; i ++ ) {
		const a = i / clumps * Math.PI * 2 + rnd() * 0.8;
		const rr = i === 0 ? 0 : 1.2 + rnd() * 1.3;
		const cy = i === 0 ? 6.0 : 4.6 + rnd() * 2.2;
		const r = ( i === 0 ? 2.4 : 1.5 + rnd() * 0.9 ) * ( lod ? 1.25 : 1 );
		const cx = Math.cos( a ) * rr, cz = Math.sin( a ) * rr;
		if ( lod === 0 ) parts.push( leafCards( i === 0 ? 46 : 26, cx, cy, cz, r * 1.15, r * 1.0, r * 1.15, 1.35, 'oak', rnd, H, { inner: 0.45 } ) );
		const g = blob( r * ( lod ? 1 : 0.66 ), lod ? 0 : 1, cx, cy, cz, 0.82, seed * 10 + i );
		parts.push( finalize( g, leafCol, 1, ( x, y ) => Math.min( 1, ( y / H ) ** 1.5 ), ( x, y, z ) => {
			// darker toward the crown core and underside
			const dc = Math.hypot( x, ( y - 5.6 ) * 1.3, z ) / 3.4;
			return Math.min( 1, 0.35 + 0.65 * dc ) * ( 0.6 + 0.4 * Math.min( 1, ( y - 3.5 ) / 3.5 ) );
		} ) );
	}
	const geo = mergeGeometries( parts.map( stripUV ) );
	geo.computeBoundingSphere();
	return geo;
}

// Conifer (pine / fir): stacked drooping cones.
export function pineGeometry( lod = 0, seed = 2 ) {
	const rnd = mulberry32( seed );
	const H = 11;
	const parts = [];
	parts.push( finalize( trunk( 0.3, 0.1, H * 0.92, lod ? 5 : 7 ), BARK_PINE, 0, ( x, y ) => ( y / H ) ** 2 * 0.4, 0.5 ) );
	const tiers = lod ? 3 : 6;
	const leafCol = new THREE.Color( 1, 1, 1 );
	for ( let i = 0; i < tiers; i ++ ) {
		const t = i / ( tiers - 1 );
		const y0 = 2.2 + t * ( H - 4.2 );
		const r = ( 2.6 * ( 1 - t ) + 0.7 ) * ( 0.9 + rnd() * 0.2 );
		const h = 2.8 - t * 0.6 + ( lod ? 1.0 : 0 );
		const g = new THREE.ConeGeometry( r, h, lod ? 6 : 9, lod ? 1 : 3, false );
		g.translate( 0, y0 + h / 2, 0 );
		// droop & jag the cone rims
		const p = g.attributes.position;
		for ( let k = 0; k < p.count; k ++ ) {
			const x = p.getX( k ), y = p.getY( k ), z = p.getZ( k );
			const rad = Math.hypot( x, z );
			const jag = 1 + 0.18 * nz( Math.atan2( z, x ) * 2.2 + i * 5 + seed, y * 0.8 );
			p.setXYZ( k, x * jag, y - rad * rad * 0.06, z * jag );
		}
		g.computeVertexNormals();
		// soften normals outward
		const nr = g.attributes.normal;
		for ( let k = 0; k < nr.count; k ++ ) {
			const x = p.getX( k ), z = p.getZ( k ), l = Math.hypot( x, z ) || 1;
			nr.setXYZ( k, nr.getX( k ) * 0.5 + x / l * 0.5, nr.getY( k ) * 0.6 + 0.4, nr.getZ( k ) * 0.5 + z / l * 0.5 );
		}
		if ( lod === 0 ) parts.push( leafCards( Math.round( 10 + r * 8 ), 0, y0 + h * 0.35, 0, r * 1.05, h * 0.35, r * 1.05, 1.1, 'pine', rnd, H, { droop: 0.9, inner: 0.7 } ) );
		if ( lod === 0 ) g.scale( 0.82, 1, 0.82 );
		parts.push( finalize( g, leafCol, 1, ( x, y ) => Math.min( 1, ( y / H ) ** 1.4 ), ( x, y, z ) => {
			const rad = Math.hypot( x, z ) / ( r + 0.01 );
			return 0.45 + 0.55 * Math.min( 1, rad ) * ( 0.7 + 0.3 * t );
		} ) );
	}
	const geo = mergeGeometries( parts.map( stripUV ) );
	geo.computeBoundingSphere();
	return geo;
}

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

// Low shrub / gorse / broom clump.
export function bushGeometry( lod = 0, seed = 4 ) {
	const rnd = mulberry32( seed );
	const parts = [];
	const n = lod ? 2 : 3;
	const leafCol = new THREE.Color( 1, 1, 1 );
	for ( let i = 0; i < n; i ++ ) {
		const a = rnd() * Math.PI * 2, rr = i ? 0.5 + rnd() * 0.4 : 0;
		const r = 0.75 + rnd() * 0.35;
		const cx = Math.cos( a ) * rr, cz = Math.sin( a ) * rr;
		if ( lod === 0 ) parts.push( leafCards( 10, cx, r * 0.55, cz, r * 1.1, r * 0.8, r * 1.1, 0.7, 'round', rnd, 1.6, { inner: 0.5 } ) );
		parts.push( finalize( blob( r * ( lod ? 1 : 0.85 ), lod ? 0 : 1, cx, r * 0.55, cz, 0.7, seed * 3 + i ), leafCol, 1, ( x, y ) => Math.min( 1, y / 1.6 ) * 0.5, ( x, y ) => 0.45 + 0.55 * Math.min( 1, y / 1.3 ) ) );
	}
	const geo = mergeGeometries( parts.map( stripUV ) );
	geo.computeBoundingSphere();
	return geo;
}

// Grass tuft: three crossed blade cards.
export function grassTuftGeometry() {
	const pos = [], nor = [], uv = [];
	const [ u0, v0 ] = TILE.grass;
	for ( let k = 0; k < 3; k ++ ) {
		const a = k / 3 * Math.PI;
		const cx = Math.cos( a ) * 0.5, cz = Math.sin( a ) * 0.5;
		const P = [ [ - cx, 0, - cz ], [ cx, 0, cz ], [ cx, 1, cz ], [ - cx, 1, - cz ] ];
		const U = [ [ 0, 0 ], [ 0.5, 0 ], [ 0.5, 0.5 ], [ 0, 0.5 ] ];
		for ( const i of [ 0, 1, 2, 0, 2, 3 ] ) {
			pos.push( ...P[ i ] );
			nor.push( 0, 1, 0 );
			uv.push( u0 + U[ i ][ 0 ], v0 + U[ i ][ 1 ] );
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( nor, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	return finalize( g, new THREE.Color( 1, 1, 1 ), 1, ( x, y ) => y * y, ( x, y ) => 0.55 + 0.45 * y, 1 );
}

function stripUV( g ) {
	return g;
}
