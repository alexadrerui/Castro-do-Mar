// Adapted from Tidewater (https://github.com/dgreenheck/tidewater, src/world/reef/ReefGeometry.js,
// three.js version at d32799f). MIT License, Copyright (c) 2026 DRG Software Solutions LLC.
// Kept: the mesh helpers and the generators that suit a cold Atlantic seabed. Changes: the urchin
// is a short-spined rock urchin (Paracentrotus), the anemone is the snakelocks; new generators
// at the end of the file (kelps, sea lettuce, mussel clumps).
import * as THREE from 'three/webgpu';

// Procedural models of reef organisms, each at several levels of detail (0 = full detail).
//
// Generators take ( rng, lod ) and return an indexed BufferGeometry with `position`,
// `normal` and `aData` (vec4). Models are built around the attachment point at the
// origin with +y up, in meters at scale 1. aData is shared by all models:
//   x: position along the growth axis (0 base .. 1 tip / top)
//   y: baked ambient occlusion (0 enclosed .. 1 open)
//   z: part / flag (model specific: inner wall, spine, tentacle, blade edge ...)
//   w: random value per part (branch, lobe, blade), for colour and motion variation
// Surface detail (corallites, meanders, pores, polyps) is procedural in the materials,
// so the meshes only carry the silhouette.

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _up = new THREE.Vector3( 0, 1, 0 );
const _x = new THREE.Vector3( 1, 0, 0 );
const TAU = Math.PI * 2;

export const rand = ( rng, a, b ) => a + ( b - a ) * rng();
const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );
const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

export function perpendicular( v, out = new THREE.Vector3() ) {

	out.crossVectors( v, Math.abs( v.y ) < 0.9 ? _up : _x );
	return out.normalize();

}

export function randomUnitVector( rng, out = new THREE.Vector3() ) {

	const z = rng() * 2 - 1;
	const a = rng() * TAU;
	const r = Math.sqrt( 1 - z * z );
	return out.set( r * Math.cos( a ), z, r * Math.sin( a ) );

}

// Sum of random plane waves: smooth 3D noise in about [-1, 1] for deforming shapes.
export function waveNoise( rng, count, fMin, fMax ) {

	const w = [];
	let norm = 0;
	for ( let i = 0; i < count; i ++ ) {

		const d = randomUnitVector( rng ).multiplyScalar( rand( rng, fMin, fMax ) );
		const a = 1 / ( 1 + i * 0.5 );
		norm += a * a;
		w.push( d.x, d.y, d.z, rng() * TAU, a );

	}

	norm = 1 / Math.sqrt( norm * 0.5 );
	return ( x, y, z ) => {

		let s = 0;
		for ( let i = 0; i < w.length; i += 5 ) s += Math.sin( x * w[ i ] + y * w[ i + 1 ] + z * w[ i + 2 ] + w[ i + 3 ] ) * w[ i + 4 ];
		return s * norm;

	};

}

export class MeshBuilder {

	constructor() {

		this.position = [];
		this.normal = [];
		this.data = [];
		this.index = [];

	}

	get count() {

		return this.position.length / 3;

	}

	vertex( p, n, d0 = 0, d1 = 1, d2 = 0, d3 = 0 ) {

		this.position.push( p.x, p.y, p.z );
		this.normal.push( n.x, n.y, n.z );
		this.data.push( d0, d1, d2, d3 );
		return this.count - 1;

	}

	tri( a, b, c ) {

		this.index.push( a, b, c );

	}

	quad( a, b, c, d ) {

		this.index.push( a, b, c, a, c, d );

	}

	// Appends a copy of the triangles in [ first, end ) facing the other way (thin sheets).
	backfaces( firstVertex, firstIndex ) {

		const nv = this.count, ni = this.index.length;
		const map = new Map();
		for ( let v = firstVertex; v < nv; v ++ ) {

			map.set( v, this.count );
			_p.fromArray( this.position, v * 3 );
			_n.fromArray( this.normal, v * 3 ).negate();
			const d = this.data;
			this.vertex( _p, _n, d[ v * 4 ], d[ v * 4 + 1 ], d[ v * 4 + 2 ], d[ v * 4 + 3 ] );

		}

		for ( let i = firstIndex; i < ni; i += 3 ) this.tri( map.get( this.index[ i ] ), map.get( this.index[ i + 2 ] ), map.get( this.index[ i + 1 ] ) );

	}

	// ao: { radius, strength } bakes occlusion into aData.y (multiplied with what is there)
	build( { normals = false, ao = null } = {} ) {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( this.position, 3 ) );
		geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( this.normal, 3 ) );
		geometry.setAttribute( 'aData', new THREE.Float32BufferAttribute( this.data, 4 ) );
		geometry.setIndex( this.index );
		if ( normals ) geometry.computeVertexNormals();
		if ( ao ) bakeOcclusion( geometry, ao.radius, ao.strength ?? 1, ao.ground ?? true );
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();
		return geometry;

	}

}

// Ambient occlusion from the model itself: every triangle is a small disc occluder
// (Bunnell, GPU Gems 2), accumulated for each vertex over its upper hemisphere within
// `radius`. With `ground`, the plane y = 0 occludes too (the seabed the model sits on).
export function bakeOcclusion( geometry, radius, strength = 1, ground = true ) {

	const pos = geometry.attributes.position.array, nrm = geometry.attributes.normal.array;
	const idx = geometry.index.array, dat = geometry.attributes.aData.array;
	const nt = idx.length / 3, nv = pos.length / 3;
	const cx = new Float32Array( nt ), cy = new Float32Array( nt ), cz = new Float32Array( nt );
	const ex = new Float32Array( nt ), ey = new Float32Array( nt ), ez = new Float32Array( nt ), ea = new Float32Array( nt );
	const cell = radius;
	const grid = new Map();
	const key = ( i, j, k ) => ( i + 512 ) * 1048576 + ( j + 512 ) * 1024 + ( k + 512 );
	for ( let t = 0; t < nt; t ++ ) {

		const a = idx[ t * 3 ] * 3, b = idx[ t * 3 + 1 ] * 3, c = idx[ t * 3 + 2 ] * 3;
		const ux = pos[ b ] - pos[ a ], uy = pos[ b + 1 ] - pos[ a + 1 ], uz = pos[ b + 2 ] - pos[ a + 2 ];
		const vx = pos[ c ] - pos[ a ], vy = pos[ c + 1 ] - pos[ a + 1 ], vz = pos[ c + 2 ] - pos[ a + 2 ];
		let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const l = Math.hypot( nx, ny, nz ) || 1e-9;
		ea[ t ] = l * 0.5;
		nx /= l; ny /= l; nz /= l;
		ex[ t ] = nx; ey[ t ] = ny; ez[ t ] = nz;
		cx[ t ] = ( pos[ a ] + pos[ b ] + pos[ c ] ) / 3;
		cy[ t ] = ( pos[ a + 1 ] + pos[ b + 1 ] + pos[ c + 1 ] ) / 3;
		cz[ t ] = ( pos[ a + 2 ] + pos[ b + 2 ] + pos[ c + 2 ] ) / 3;
		const k = key( Math.floor( cx[ t ] / cell ), Math.floor( cy[ t ] / cell ), Math.floor( cz[ t ] / cell ) );
		let list = grid.get( k );
		if ( ! list ) grid.set( k, list = [] );
		list.push( t );

	}

	const r2 = radius * radius;
	for ( let v = 0; v < nv; v ++ ) {

		const px = pos[ v * 3 ], py = pos[ v * 3 + 1 ], pz = pos[ v * 3 + 2 ];
		const nx = nrm[ v * 3 ], ny = nrm[ v * 3 + 1 ], nz = nrm[ v * 3 + 2 ];
		const qx = px + nx * radius * 0.02, qy = py + ny * radius * 0.02, qz = pz + nz * radius * 0.02;
		const gi = Math.floor( qx / cell ), gj = Math.floor( qy / cell ), gk = Math.floor( qz / cell );
		let occ = 0;
		for ( let i = gi - 1; i <= gi + 1; i ++ ) for ( let j = gj - 1; j <= gj + 1; j ++ ) for ( let k = gk - 1; k <= gk + 1; k ++ ) {

			const list = grid.get( key( i, j, k ) );
			if ( ! list ) continue;
			for ( let m = 0; m < list.length; m ++ ) {

				const t = list[ m ];
				const dx = cx[ t ] - qx, dy = cy[ t ] - qy, dz = cz[ t ] - qz;
				const d2 = dx * dx + dy * dy + dz * dz;
				if ( d2 > r2 || d2 < 1e-10 ) continue;
				const d = Math.sqrt( d2 );
				const cr = ( dx * nx + dy * ny + dz * nz ) / d; // receiver cosine
				if ( cr <= 0.05 ) continue;
				const ce = Math.abs( dx * ex[ t ] + dy * ey[ t ] + dz * ez[ t ] ) / d; // emitter cosine
				const A = ea[ t ];
				occ += cr * Math.min( 1, 4 * ce + 0.25 ) * A / ( Math.PI * d2 + A ) * ( 1 - d2 / r2 );

			}

		}

		// the seabed below the model
		if ( ground && ny < 0.9 ) {

			const h = Math.max( py, 0.002 );
			occ += Math.max( 0, - ny * 0.8 + 0.35 ) * Math.exp( - h / ( radius * 0.6 ) ) * 0.6;

		}

		dat[ v * 4 + 1 ] *= clamp( 1 - occ * strength, 0.05, 1 );

	}

}

// Tapered (optionally elliptical) tube along a polyline with an optional rounded end cap.
// o.sides, o.cap (true: rounded tip), o.capLength (tip length / radius, default 0.95: lower is
// blunter), o.ellipse (minor / major radius), o.axis (Vector3 or ( i ) => Vector3, hint for the
// major axis), o.data( i, t ) => [ d0, d2, d3 ] (aData x, z, w)
export function tube( b, points, radii, o = {} ) {

	const sides = o.sides ?? 6;
	const n = points.length;
	const ellipse = o.ellipse ?? 1;
	const s = [ 0 ];
	for ( let i = 1; i < n; i ++ ) s.push( s[ i - 1 ] + points[ i ].distanceTo( points[ i - 1 ] ) );
	const L = s[ n - 1 ] || 1;

	const T = [], N = [], B = [];
	for ( let i = 0; i < n; i ++ ) {

		const a = points[ Math.max( 0, i - 1 ) ], c = points[ Math.min( n - 1, i + 1 ) ];
		T.push( new THREE.Vector3().subVectors( c, a ).normalize() );

	}

	let prev = null;
	for ( let i = 0; i < n; i ++ ) {

		let hint;
		if ( o.axis ) hint = typeof o.axis === 'function' ? o.axis( i ) : o.axis;
		else hint = prev ?? perpendicular( T[ i ] );
		const nn = hint.clone().addScaledVector( T[ i ], - hint.dot( T[ i ] ) );
		if ( nn.lengthSq() < 1e-8 ) perpendicular( T[ i ], nn );
		nn.normalize();
		N.push( nn );
		B.push( new THREE.Vector3().crossVectors( T[ i ], nn ) );
		prev = nn;

	}

	const base = b.count;
	const tw = o.twist ?? 0;
	for ( let i = 0; i < n; i ++ ) {

		const r = radii[ i ];
		const i0 = Math.max( 0, i - 1 ), i1 = Math.min( n - 1, i + 1 );
		const slope = ( radii[ i0 ] - radii[ i1 ] ) / Math.max( 1e-5, s[ i1 ] - s[ i0 ] );
		const d = o.data ? o.data( i, s[ i ] / L ) : [ s[ i ] / L, 0, 0 ];
		for ( let j = 0; j < sides; j ++ ) {

			const a = ( j / sides ) * TAU + tw * i;
			const ca = Math.cos( a ), sa = Math.sin( a );
			_p.copy( points[ i ] ).addScaledVector( N[ i ], ca * r ).addScaledVector( B[ i ], sa * r * ellipse );
			_n.copy( N[ i ] ).multiplyScalar( ca * ellipse ).addScaledVector( B[ i ], sa ).normalize().addScaledVector( T[ i ], slope ).normalize();
			b.vertex( _p, _n, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

		}

	}

	for ( let i = 0; i < n - 1; i ++ ) {

		for ( let j = 0; j < sides; j ++ ) {

			const a = base + i * sides + j, a1 = base + i * sides + ( j + 1 ) % sides;
			b.tri( a, a1, a + sides );
			b.tri( a1, a1 + sides, a + sides );

		}

	}

	if ( o.cap ) {

		const i = n - 1, r = radii[ i ];
		const d = o.data ? o.data( i, 1 ) : [ 1, 0, 0 ];
		const ring = base + i * sides;
		const mid = b.count;
		const capLength = o.capLength ?? 0.95;
		for ( let j = 0; j < sides; j ++ ) {

			const a = ( j / sides ) * TAU + tw * i;
			const ca = Math.cos( a ), sa = Math.sin( a );
			_p.copy( points[ i ] ).addScaledVector( T[ i ], r * capLength * 0.63 ).addScaledVector( N[ i ], ca * r * 0.75 ).addScaledVector( B[ i ], sa * r * 0.75 * ellipse );
			_n.copy( N[ i ] ).multiplyScalar( ca * ellipse ).addScaledVector( B[ i ], sa ).normalize().multiplyScalar( 0.7 ).addScaledVector( T[ i ], 0.72 ).normalize();
			b.vertex( _p, _n, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

		}

		for ( let j = 0; j < sides; j ++ ) {

			const j1 = ( j + 1 ) % sides;
			b.tri( ring + j, ring + j1, mid + j );
			b.tri( ring + j1, mid + j1, mid + j );

		}

		_p.copy( points[ i ] ).addScaledVector( T[ i ], r * capLength );
		const tip = b.vertex( _p, T[ i ], d[ 0 ], 1, d[ 1 ], d[ 2 ] );
		for ( let j = 0; j < sides; j ++ ) b.tri( mid + j, mid + ( j + 1 ) % sides, tip );

	}

	return { T, N, B, length: L };

}

// Surface of revolution around +y. profile: [ { r, y, d } ] from the bottom of the outer
// wall up and over the rim down the inner wall (visible side to the right of the walk).
// radial( phi, i ) returns a radius multiplier; d = [ aData.x, aData.z, aData.w ].
export function lathe( b, profile, segments, radial = null, ox = 0, oz = 0 ) {

	const base = b.count;
	for ( let i = 0; i < profile.length; i ++ ) {

		const { r, y, d = [ 0, 0, 0 ] } = profile[ i ];
		for ( let j = 0; j < segments; j ++ ) {

			const phi = ( j / segments ) * TAU;
			const k = radial ? radial( phi, i ) : 1;
			_p.set( ox + r * k * Math.cos( phi ), y, oz - r * k * Math.sin( phi ) );
			b.vertex( _p, _up, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

		}

	}

	for ( let i = 0; i < profile.length - 1; i ++ ) {

		for ( let j = 0; j < segments; j ++ ) {

			const a = base + i * segments + j, a1 = base + i * segments + ( j + 1 ) % segments;
			b.tri( a, a1, a + segments );
			b.tri( a1, a1 + segments, a + segments );

		}

	}

}

// Indexed icosphere (unit radius) with outward winding.
const _ico = new Map();
export function icosphere( detail ) {

	if ( _ico.has( detail ) ) return _ico.get( detail );
	const t = ( 1 + Math.sqrt( 5 ) ) / 2;
	const verts = [
		[ - 1, t, 0 ], [ 1, t, 0 ], [ - 1, - t, 0 ], [ 1, - t, 0 ], [ 0, - 1, t ], [ 0, 1, t ],
		[ 0, - 1, - t ], [ 0, 1, - t ], [ t, 0, - 1 ], [ t, 0, 1 ], [ - t, 0, - 1 ], [ - t, 0, 1 ],
	].map( ( v ) => new THREE.Vector3( v[ 0 ], v[ 1 ], v[ 2 ] ).normalize() );
	let faces = [
		[ 0, 11, 5 ], [ 0, 5, 1 ], [ 0, 1, 7 ], [ 0, 7, 10 ], [ 0, 10, 11 ], [ 1, 5, 9 ], [ 5, 11, 4 ], [ 11, 10, 2 ], [ 10, 7, 6 ], [ 7, 1, 8 ],
		[ 3, 9, 4 ], [ 3, 4, 2 ], [ 3, 2, 6 ], [ 3, 6, 8 ], [ 3, 8, 9 ], [ 4, 9, 5 ], [ 2, 4, 11 ], [ 6, 2, 10 ], [ 8, 6, 7 ], [ 9, 8, 1 ],
	];
	for ( let d = 0; d < detail; d ++ ) {

		const cache = new Map();
		const mid = ( a, b ) => {

			const key = a < b ? a * 100000 + b : b * 100000 + a;
			let m = cache.get( key );
			if ( m === undefined ) {

				m = verts.length;
				verts.push( verts[ a ].clone().add( verts[ b ] ).normalize() );
				cache.set( key, m );

			}

			return m;

		};

		const next = [];
		for ( const [ a, b, c ] of faces ) {

			const ab = mid( a, b ), bc = mid( b, c ), ca = mid( c, a );
			next.push( [ a, ab, ca ], [ b, bc, ab ], [ c, ca, bc ], [ ab, bc, ca ] );

		}

		faces = next;

	}

	const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
	for ( const f of faces ) {

		e1.subVectors( verts[ f[ 1 ] ], verts[ f[ 0 ] ] );
		e2.subVectors( verts[ f[ 2 ] ], verts[ f[ 0 ] ] );
		fn.crossVectors( e1, e2 );
		if ( fn.dot( verts[ f[ 0 ] ] ) < 0 ) {

			const tmp = f[ 1 ];
			f[ 1 ] = f[ 2 ];
			f[ 2 ] = tmp;

		}

	}

	const r = { verts, faces };
	_ico.set( detail, r );
	return r;

}

// Deformed icosphere. fn( dir, out ) writes the position and returns [ d0, d2, d3 ].
export function blob( b, detail, fn ) {

	const { verts, faces } = icosphere( detail );
	const base = b.count;
	const out = new THREE.Vector3();
	for ( const v of verts ) {

		const d = fn( v, out ) ?? [ 0, 0, 0 ];
		b.vertex( out, v, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

	}

	for ( const f of faces ) b.tri( base + f[ 0 ], base + f[ 1 ], base + f[ 2 ] );

}

// Grid sheet over ( u, v ) in [0,1]^2: fn( u, v, out ) writes the position, returns [ d0, d2, d3 ].
export function sheet( b, nu, nv, fn, twoSided = true ) {

	const first = b.count, firstIndex = b.index.length;
	const out = new THREE.Vector3();
	for ( let j = 0; j <= nv; j ++ ) for ( let i = 0; i <= nu; i ++ ) {

		const d = fn( i / nu, j / nv, out ) ?? [ 0, 0, 0 ];
		b.vertex( out, _up, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

	}

	for ( let j = 0; j < nv; j ++ ) for ( let i = 0; i < nu; i ++ ) {

		const a = first + j * ( nu + 1 ) + i;
		b.quad( a, a + 1, a + nu + 2, a + nu + 1 );

	}

	// flat-ish normals from the grid (the front side faces +cross( du, dv ))
	const P = b.position, N = b.normal;
	const at = ( i, j ) => first + clamp( j, 0, nv ) * ( nu + 1 ) + clamp( i, 0, nu );
	for ( let j = 0; j <= nv; j ++ ) for ( let i = 0; i <= nu; i ++ ) {

		const a = at( i - 1, j ), c = at( i + 1, j ), d = at( i, j - 1 ), e = at( i, j + 1 );
		_t.set( P[ c * 3 ] - P[ a * 3 ], P[ c * 3 + 1 ] - P[ a * 3 + 1 ], P[ c * 3 + 2 ] - P[ a * 3 + 2 ] );
		_p.set( P[ e * 3 ] - P[ d * 3 ], P[ e * 3 + 1 ] - P[ d * 3 + 1 ], P[ e * 3 + 2 ] - P[ d * 3 + 2 ] );
		_n.crossVectors( _t, _p ).normalize();
		const v = at( i, j );
		N[ v * 3 ] = _n.x;
		N[ v * 3 + 1 ] = _n.y;
		N[ v * 3 + 2 ] = _n.z;

	}

	if ( twoSided ) b.backfaces( first, firstIndex );

}

// Recomputes smooth normals of the vertices from `first` on, from the triangles from `firstIndex` on.
export function smoothNormals( b, first = 0, firstIndex = 0 ) {

	const P = b.position, N = b.normal, I = b.index;
	for ( let v = first; v < b.count; v ++ ) N[ v * 3 ] = N[ v * 3 + 1 ] = N[ v * 3 + 2 ] = 0;
	const a = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
	for ( let i = firstIndex; i < I.length; i += 3 ) {

		const i0 = I[ i ], i1 = I[ i + 1 ], i2 = I[ i + 2 ];
		a.fromArray( P, i0 * 3 );
		c.fromArray( P, i1 * 3 ).sub( a );
		d.fromArray( P, i2 * 3 ).sub( a );
		c.cross( d );
		for ( const k of [ i0, i1, i2 ] ) {

			N[ k * 3 ] += c.x;
			N[ k * 3 + 1 ] += c.y;
			N[ k * 3 + 2 ] += c.z;

		}

	}

	for ( let v = first; v < b.count; v ++ ) {

		a.fromArray( N, v * 3 ).normalize();
		N[ v * 3 ] = a.x;
		N[ v * 3 + 1 ] = a.y;
		N[ v * 3 + 2 ] = a.z;

	}

}

// Breadth-first branching: specs are { p, dir, r, len, depth, ... }; grow( spec ) returns children.
export function branch( roots, budget, grow ) {

	const queue = roots.slice();
	let made = 0;
	while ( queue.length > 0 && made < budget ) {

		const spec = queue.shift();
		made ++;
		const children = grow( spec );
		if ( children ) for ( const c of children ) queue.push( c );

	}

}

// Points of a gently curving path from p along dir; bend( i, dir ) may modify dir per step.
export function path( p, dir, length, steps, bend ) {

	const pts = [ p.clone() ];
	const d = dir.clone().normalize();
	const step = length / steps;
	for ( let i = 1; i <= steps; i ++ ) {

		if ( bend ) bend( i, d );
		d.normalize();
		pts.push( pts[ i - 1 ].clone().addScaledVector( d, step ) );

	}

	return pts;

}

// ---------------------------------------------------------------------------
// Massive forms
// ---------------------------------------------------------------------------

const ICO = [ 3, 2, 1 ]; // icosphere subdivisions per level of detail

// Distance along the ray from the origin in direction d to the far side of the union of
// ellipsoidal lumps [ cx, cy, cz, ax, ay, az ] (the model is star-shaped around the origin).
function lumpRadius( d, lumps, fallback ) {

	let best = fallback;
	for ( let i = 0; i < lumps.length; i += 6 ) {

		const cx = lumps[ i ], cy = lumps[ i + 1 ], cz = lumps[ i + 2 ];
		const ax = lumps[ i + 3 ], ay = lumps[ i + 4 ], az = lumps[ i + 5 ];
		const dx = d.x / ax, dy = d.y / ay, dz = d.z / az;
		const ox = cx / ax, oy = cy / ay, oz = cz / az;
		const A = dx * dx + dy * dy + dz * dz;
		const B = - 2 * ( dx * ox + dy * oy + dz * oz );
		const C = ox * ox + oy * oy + oz * oz - 1;
		const disc = B * B - 4 * A * C;
		if ( disc < 0 ) continue;
		const t = ( - B + Math.sqrt( disc ) ) / ( 2 * A );
		if ( t > best ) best = t;

	}

	return best;

}

// Massive forms on the seabed, built as a union of ellipsoidal lumps (creases where lumps
// meet) with bumps on top. About 1 m wide at scale 1.
//  'rock':    dead coral head: a few big lumps, undercut, pitted (framework, bommie bases)
//  'slab':    low, broad, lumpy framework outcrop that carpets the reef platform
//  'boulder': living star coral mound: smooth big lobes, spreading margin
//  'knobby':  mustard hill coral: many small knobs
//  'smooth':  starlet coral: an almost smooth hemisphere
// aData = ( height 0..1, ao, 0, noise )
export function createMound( rng, lod, style = 'boulder' ) {

	const S = {
		rock: { n: [ 4, 7 ], spread: 0.24, size: [ 0.18, 0.32 ], flat: [ 0.55, 0.85 ], lift: 0.12, bumps: 0.1, bumpF: [ 5, 11 ], fine: 0.04, undercut: 0.35, ridged: true },
		slab: { n: [ 10, 16 ], spread: 0.4, size: [ 0.12, 0.22 ], flat: [ 0.3, 0.55 ], lift: 0.02, bumps: 0.06, bumpF: [ 5, 11 ], fine: 0.03, undercut: 0.1, ico: [ 4, 3, 2, 1 ] },
		boulder: { n: [ 3, 6 ], spread: 0.18, size: [ 0.24, 0.38 ], flat: [ 0.6, 0.9 ], lift: 0.08, bumps: 0.06, bumpF: [ 3, 7 ], fine: 0.012, undercut: 0.25 },
		knobby: { n: [ 7, 12 ], spread: 0.26, size: [ 0.12, 0.2 ], flat: [ 0.8, 1.0 ], lift: 0.1, bumps: 0.03, bumpF: [ 8, 14 ], fine: 0.01, undercut: 0.1 },
		smooth: { n: [ 1, 2 ], spread: 0.05, size: [ 0.45, 0.5 ], flat: [ 0.7, 0.95 ], lift: 0.04, bumps: 0.02, bumpF: [ 3, 5 ], fine: 0.004, undercut: 0.05 },
	}[ style ];
	const lumps = [];
	const n = S.n[ 0 ] + Math.floor( rng() * ( S.n[ 1 ] - S.n[ 0 ] + 1 ) );
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, r = Math.sqrt( rng() ) * S.spread * ( i === 0 ? 0.3 : 1 );
		const size = rand( rng, S.size[ 0 ], S.size[ 1 ] ) * ( i === 0 ? 1.15 : 1 );
		const fl = rand( rng, S.flat[ 0 ], S.flat[ 1 ] );
		lumps.push( Math.cos( a ) * r, S.lift + rand( rng, - 0.05, 0.06 ), Math.sin( a ) * r, size * rand( rng, 0.85, 1.2 ), size * fl * 1.6, size * rand( rng, 0.85, 1.2 ) );

	}

	const bump = waveNoise( rng, 7, S.bumpF[ 0 ], S.bumpF[ 1 ] );
	const fine = waveNoise( rng, 8, 14, 26 );
	const tmp = new THREE.Vector3();
	const b = new MeshBuilder();
	let H = 0;
	blob( b, ( S.ico ?? ICO )[ lod ], ( d, out ) => {

		// the lower hemisphere maps onto the buried base (squashed below the ground)
		tmp.set( d.x, d.y >= 0 ? d.y : d.y * 0.3, d.z ).normalize();
		let r = lumpRadius( tmp, lumps, 0.12 );
		const bv = bump( d.x, d.y, d.z );
		// ridged: sharp crevices between rounded knobs (eroded framework)
		r *= 1 + S.bumps * ( S.ridged ? 0.6 - 1.6 * bv * bv : bv ) + ( lod === 0 ? S.fine * fine( d.x, d.y, d.z ) : 0 );
		out.copy( tmp ).multiplyScalar( r );
		// undercut: the base is narrower than the bulging sides
		const nearBase = 1 - smooth( 0.0, 0.14, out.y );
		out.x *= 1 - S.undercut * nearBase * 0.5;
		out.z *= 1 - S.undercut * nearBase * 0.5;
		if ( d.y < 0 ) out.y = Math.max( out.y, - 0.05 );
		H = Math.max( H, out.y );
		return [ 0, 0, bump( d.x * 0.5, d.y * 0.5, d.z * 0.5 ) * 0.5 + 0.5 ];

	} );
	for ( let v = 0; v < b.count; v ++ ) b.data[ v * 4 ] = clamp( b.position[ v * 3 + 1 ] / H, 0, 1 );
	smoothNormals( b );
	return b.build( { ao: { radius: 0.16, strength: 0.55 } } );

}

// Lobed / columnar star coral (Orbicella annularis): a clump of columns with swollen,
// rounded tops, fused near the base. About 0.9 m wide, 0.5 m tall at scale 1.
// aData = ( height 0..1, ao, 0, lobe random )

// Rock urchin (Paracentrotus lividus): a flattened test densely covered in short spines. About
// 0.12 m across the spines at scale 1 (Tidewater's long-spined Diadema, with short spines).
// aData = ( spine t, ao, spine flag, spine random )
export function createUrchin( rng, lod ) {

	const b = new MeshBuilder();
	blob( b, lod === 0 ? 2 : 1, ( d, out ) => {

		out.set( d.x * 0.045, 0.035 + d.y * ( d.y > 0 ? 0.035 : 0.02 ), d.z * 0.045 );
		return [ 0, 0, 0 ];

	} );
	smoothNormals( b );
	const n = lod === 0 ? 110 : 34;
	const dir = new THREE.Vector3(), side = new THREE.Vector3(), side2 = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) {

		// spines radiate mostly upward and sideways
		randomUnitVector( rng, dir );
		dir.y = Math.abs( dir.y ) * 0.9 + 0.1;
		dir.normalize();
		const len = rand( rng, 0.018, 0.03 ) * ( 0.7 + 0.3 * dir.y );
		const r = 0.0022;
		const base = new THREE.Vector3( 0, 0.035, 0 ).addScaledVector( dir, 0.04 );
		perpendicular( dir, side );
		side2.crossVectors( dir, side );
		const w = rng();
		const ids = [];
		for ( let k = 0; k < 3; k ++ ) {

			const a = ( k / 3 ) * TAU;
			_n.copy( side ).multiplyScalar( Math.cos( a ) ).addScaledVector( side2, Math.sin( a ) );
			_p.copy( base ).addScaledVector( _n, r );
			ids.push( b.vertex( _p, _n, 0, 1, 1, w ) );

		}

		_p.copy( base ).addScaledVector( dir, len );
		const tip = b.vertex( _p, dir, 1, 1, 1, w );
		for ( let k = 0; k < 3; k ++ ) b.tri( ids[ k ], ids[ ( k + 1 ) % 3 ], tip );

	}

	return b.build();

}

// Snakelocks anemone (Anemonia viridis): a short column crowned by long, thin, wavy tentacles
// (Tidewater's giant anemone with thinner, longer, more numerous tentacles). About 0.3 m across.
// aData = ( tentacle t, ao, tentacle flag, tentacle random )
export function createAnemone( rng, lod ) {

	const b = new MeshBuilder();
	const segs = lod === 0 ? 12 : 7;
	lathe( b, [ { r: 0.045, y: - 0.01 }, { r: 0.04, y: 0.03 }, { r: 0.05, y: 0.05 }, { r: 0.03, y: 0.058 }, { r: 0.002, y: 0.06 } ], segs );
	smoothNormals( b );
	const n = lod === 0 ? 64 : 22;
	const sides = lod === 0 ? 4 : 3, rings = lod === 0 ? 4 : 2;
	for ( let i = 0; i < n; i ++ ) {

		const a = ( i / n ) * TAU * 3.1 + rng() * 0.3; // three whorls
		const ring = ( i % 3 ) / 3;
		const r0 = 0.018 + ring * 0.025;
		const el = rand( rng, 0.5, 1.2 ) - ring * 0.4;
		const dir = new THREE.Vector3( Math.cos( a ) * Math.cos( el ), Math.sin( el ), Math.sin( a ) * Math.cos( el ) );
		const p = new THREE.Vector3( Math.cos( a ) * r0, 0.055, Math.sin( a ) * r0 );
		const len = rand( rng, 0.1, 0.17 );
		const wav = rand( rng, - 0.25, 0.25 );
		const pts = path( p, dir, len, rings, ( k, d ) => {

			d.y -= 0.12; // droop outward
			d.x += Math.sin( a + k * 1.7 ) * wav; // wavy
			d.z += Math.cos( a + k * 1.7 ) * wav;
			d.x += Math.cos( a ) * 0.1;
			d.z += Math.sin( a ) * 0.1;

		} );
		const w = rng();
		tube( b, pts, pts.map( ( q, k ) => 0.0042 * ( 1 - 0.45 * k / rings ) ), { sides, cap: true, data: ( k, t ) => [ t, 1, w ] } );

	}

	return b.build( { ao: { radius: 0.04, strength: 0.8 } } );

}

// Rubble: shell fragments (the 'bleached' pieces), twigs and pebbles lying on the seabed
// (Tidewater's coral rubble; the material colours it as shells and granite pebbles).
// About 0.6 m across at scale 1. aData = ( 0, ao, bleached fragment flag, piece random )
export function createRubble( rng, lod ) {

	const b = new MeshBuilder();
	const n = [ 12, 6, 3 ][ lod ];
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, r = Math.sqrt( rng() ) * 0.28;
		const x = Math.cos( a ) * r, z = Math.sin( a ) * r;
		const w = rng();
		const bleached = rng() < 0.4 ? 1 : 0;
		if ( rng() < 0.55 ) {

			// branch fragment lying on the ground
			const ya = rng() * TAU, len = rand( rng, 0.05, 0.14 ), rad = rand( rng, 0.008, 0.014 );
			const d = new THREE.Vector3( Math.cos( ya ), rand( rng, - 0.1, 0.25 ), Math.sin( ya ) );
			const p0 = new THREE.Vector3( x, rad * 0.7, z );
			const pts = [ p0, p0.clone().addScaledVector( d.normalize(), len ) ];
			tube( b, pts, [ rad, rad * 0.8 ], { sides: lod === 0 ? 5 : 3, cap: true, data: () => [ 0, bleached, w ] } );

		} else {

			const s = rand( rng, 0.025, 0.07 );
			const nz = waveNoise( rng, 3, 2, 4 );
			const first = b.count, fi = b.index.length;
			blob( b, lod === 0 ? 1 : 0, ( d, out ) => {

				const k = 1 + 0.3 * nz( d.x, d.y, d.z );
				out.set( x + d.x * s * k, Math.max( 0.3 * s + d.y * s * 0.6 * k, - 0.01 ), z + d.z * s * k );
				return [ 0, bleached * 0.5, w ];

			} );
			smoothNormals( b, first, fi );

		}

	}

	return b.build( { ao: { radius: 0.05, strength: 1 } } );

}

// ---------------------------------------------------------------------------
// Seagrass meadows and macroalgae (flexible: they sway with the surge in the shader)
// ---------------------------------------------------------------------------

// Ribbon blade from p along dir with `segs` segments, tapering to the tip and curving over by
// `lean` (m of horizontal offset at the tip, along `out`); both faces.
function blade( b, p, dir, out, len, w, lean, segs, d2, d3, ao0 = 0.45 ) {

	const first = b.count, fi = b.index.length;
	const side = new THREE.Vector3().crossVectors( dir, out ).normalize();
	const pts = [];
	for ( let k = 0; k <= segs; k ++ ) {

		const t = k / segs;
		pts.push( p.clone().addScaledVector( dir, t * len ).addScaledVector( out, lean * t * t ) );

	}

	for ( let k = 0; k <= segs; k ++ ) {

		const t = k / segs;
		const T = pts[ Math.min( segs, k + 1 ) ].clone().sub( pts[ Math.max( 0, k - 1 ) ] ).normalize();
		_n.crossVectors( side, T ).normalize();
		const ww = w * ( k === segs ? 0.35 : 1 - 0.25 * t );
		for ( const s of [ - 1, 1 ] ) {

			_p.copy( pts[ k ] ).addScaledVector( side, s * ww * 0.5 );
			b.vertex( _p, _n, t, ao0 + ( 1 - ao0 ) * t, s, d3 );

		}

	}

	for ( let k = 0; k < segs; k ++ ) b.quad( first + k * 2, first + k * 2 + 1, first + k * 2 + 3, first + k * 2 + 2 );
	b.backfaces( first, fi );

}

// A patch of seagrass meadow over a disc of radius 1 m at scale 1: turtle grass shoots
// (Thalassia testudinum, 2-5 strap blades each) mixed with manatee grass (Syringodium
// filiforme: thin, taller blades). All random values are drawn for every shoot whatever the
// level of detail, so the lower levels keep a subset of the same shoots (with wider blades)
// and the meadow thins out in place instead of shifting. The terrain's meadow texture fills in
// between. aData = ( t along the blade, ao, across -1..1, blade random )
export function createMeadow( rng, lod ) {

	const b = new MeshBuilder();
	const N = 140;
	const shoots = [];
	for ( let i = 0; i < N; i ++ ) {

		const a = rng() * TAU, r = Math.sqrt( rng() ) * 0.97;
		const manatee = rng() < 0.2;
		const nb = 2 + Math.floor( rng() * 3 );
		const yaw = rng() * Math.PI;
		const blades = [];
		for ( let k = 0; k < 4; k ++ ) blades.push( [ rng(), rng(), rng(), rng() ] );
		shoots.push( { x: Math.cos( a ) * r, z: Math.sin( a ) * r, manatee, nb, yaw, blades } );

	}

	const keep = [ N, 46, 16 ][ lod ];
	const segs = [ 2, 1, 1 ][ lod ];
	const widen = [ 1, 1.45, 2.3 ][ lod ];
	const maxBlades = [ 4, 2, 1 ][ lod ];
	const up = new THREE.Vector3( 0, 1, 0 ), out = new THREE.Vector3(), dir = new THREE.Vector3(), base = new THREE.Vector3();
	for ( let i = 0; i < keep; i ++ ) {

		const s = shoots[ i ];
		const nb = Math.min( s.nb, maxBlades );
		for ( let k = 0; k < nb; k ++ ) {

			const [ r1, r2, r3, r4 ] = s.blades[ k ];
			const len = s.manatee ? 0.22 + r1 * 0.26 : 0.1 + r1 * 0.26;
			const w = ( s.manatee ? 0.0035 : 0.008 + r2 * 0.005 ) * widen;
			// blades of a shoot fan out in one plane and lean outward
			const spread = ( k - ( nb - 1 ) / 2 );
			out.set( Math.cos( s.yaw ), 0, Math.sin( s.yaw ) );
			dir.copy( up ).addScaledVector( out, spread * 0.14 + ( r3 - 0.5 ) * 0.1 ).normalize();
			const lean = ( r4 - 0.3 ) * 0.35 * len * Math.sign( spread || 1 );
			base.set( s.x + out.x * 0.003 * spread, - 0.01, s.z + out.z * 0.003 * spread );
			blade( b, base, dir, out, len, w, lean, segs, 0, r3 );

		}

	}

	return b.build();

}


// Sargassum (Caribbean brown alga): wiry, branching axes bearing serrated lance-shaped leaves
// and small round gas bladders, in bushy tufts on the shallow reef flat; very flexible. About
// 0.45 m tall at scale 1. aData = ( height t, ao, part (0 axis, 1 leaf, 2 bladder), random )
export function createSargassum( rng, lod ) {

	const b = new MeshBuilder();
	const axes = 2 + Math.floor( rng() * 3 );
	const H = 0.45;
	const segs = [ 7, 4, 2 ][ lod ];
	const leafKeep = [ 1, 0.4, 0.15 ][ lod ];
	const widen = [ 1, 1.5, 2.2 ][ lod ];
	const up = new THREE.Vector3( 0, 1, 0 );
	for ( let i = 0; i < axes; i ++ ) {

		const a = rng() * TAU, lean = rand( rng, 0.1, 0.4 );
		const dir = new THREE.Vector3( Math.cos( a ) * lean, 1, Math.sin( a ) * lean );
		const len = rand( rng, 0.3, 0.5 );
		const wig = rand( rng, 0.1, 0.25 );
		const pts = path( new THREE.Vector3( rand( rng, - 0.02, 0.02 ), - 0.01, rand( rng, - 0.02, 0.02 ) ), dir, len, segs, ( k, d ) => {

			d.x += ( rng() - 0.5 ) * wig;
			d.z += ( rng() - 0.5 ) * wig;

		} );
		const w = rng();
		tube( b, pts, pts.map( ( p, k ) => 0.0028 * widen * ( 1 - 0.3 * k / segs ) ), { sides: 3, cap: false, data: ( k ) => [ clamp( pts[ k ].y / H, 0, 1 ), 0, w ] } );
		// leaves and bladders along the axis (all random values drawn whatever the lod)
		const nl = 14;
		for ( let k = 0; k < nl; k ++ ) {

			const t = 0.15 + 0.85 * ( k + rng() ) / nl;
			const f = t * segs, i0 = Math.min( segs - 1, Math.floor( f ) );
			const p = pts[ i0 ].clone().lerp( pts[ i0 + 1 ], f - i0 );
			const ya = rng() * TAU, el = rand( rng, 0.3, 1.1 ), ll = rand( rng, 0.025, 0.045 ), lw = rand( rng, 0.005, 0.009 );
			const bladder = rng() < 0.35;
			const keep = rng() < leafKeep;
			if ( ! keep ) continue;
			const ld = new THREE.Vector3( Math.cos( ya ) * Math.cos( el ), Math.sin( el ), Math.sin( ya ) * Math.cos( el ) );
			const face = new THREE.Vector3().crossVectors( ld, up ).normalize();
			if ( face.lengthSq() < 0.1 ) face.set( 1, 0, 0 );
			const tt = clamp( p.y / H, 0, 1 );
			blade( b, p, ld, face, ll, lw * widen, ll * 0.3, 1, 1, rng(), 0.7 );
			for ( let v = b.count - 8; v < b.count; v ++ ) {

				b.data[ v * 4 ] = tt;
				b.data[ v * 4 + 2 ] = 1;

			}

			if ( bladder && lod === 0 ) {

				const first = b.count, fi = b.index.length;
				const c = p.clone().addScaledVector( ld, - 0.004 ).addScaledVector( face, 0.006 );
				blob( b, 0, ( d, o ) => {

					o.copy( c ).addScaledVector( d, 0.0035 );
					return [ tt, 2, w ];

				} );
				smoothNormals( b, first, fi );

			}

		}

	}

	return b.build();

}


// Common starfish (Asterias / Marthasterias): five slender arms, 0.12 m in radius (Tidewater's
// cushion star with narrower arms).
export function createStarfish( rng, lod ) {

	const b = new MeshBuilder();
	const tips = [], top = new THREE.Vector3( 0, 0.03, 0 ), bottom = new THREE.Vector3( 0, 0.002, 0 );
	const w = rng();
	const ct = b.vertex( top, _up, 0, 1, 0, w );
	for ( let i = 0; i < 10; i ++ ) {

		const a = i / 10 * TAU + rng() * 0.08;
		const r = i % 2 ? 0.026 : 0.12 * rand( rng, 0.85, 1.05 );
		const y = i % 2 ? 0.022 : 0.008;
		tips.push( b.vertex( new THREE.Vector3( Math.cos( a ) * r, y, Math.sin( a ) * r ), _up, 1, 1, 0, w ) );

	}

	const cb = b.vertex( bottom, new THREE.Vector3( 0, - 1, 0 ), 0, 1, 0, w );
	for ( let i = 0; i < 10; i ++ ) {

		b.tri( ct, tips[ ( i + 1 ) % 10 ], tips[ i ] );
		b.tri( cb, tips[ i ], tips[ ( i + 1 ) % 10 ] );

	}

	smoothNormals( b );
	return b.build();

}

// Sea cucumber: a warty sausage lying on the sand, 0.26 m long.
export function createCucumber( rng, lod ) {

	const b = new MeshBuilder();
	const nz = waveNoise( rng, 3, 3, 6 );
	const bend = rand( rng, - 0.3, 0.3 );
	blob( b, lod === 0 ? 2 : 1, ( d, out ) => {

		const k = 1 + 0.12 * nz( d.x, d.y, d.z );
		out.set( d.x * 0.13, 0.028 + d.y * 0.026 * k, d.z * 0.034 * k + bend * d.x * d.x * 0.1 );
		return [ 0, 0, rng() * 0.2 ];

	} );
	smoothNormals( b );
	return b.build();

}

// Queen conch: a pale, knobbed spire with a flared lip, 0.2 m long.

// ---------------------------------------------------------------------------
// Cold-water macroalgae and shellfish (new for Castro do Mar)
// ---------------------------------------------------------------------------

// Kelp, about 1 m tall at scale 1 (instances are scaled to 0.8 - 2.2 m).
//  'forest': Laminaria hyperborea: a claw-like holdfast, a stiff upright stipe (~55 % of the
//            height) and a palmate frond split into 5 - 9 straps that fan out and droop.
//  'sugar':  Saccharina latissima: a short stipe and one long, broad, ruffled ribbon blade.
// aData = ( height fraction 0..1 (sway), ao, part (0 holdfast / stipe, 1 + 0.9 x position along
// the blade on the fronds), part random ).
// The whole plant sways; the stipe barely bends (the bend grows with the square of t).
export function createKelp( rng, lod, style = 'forest' ) {

	const b = new MeshBuilder();
	const sugar = style === 'sugar';
	const H = 1;
	const stipeH = sugar ? rand( rng, 0.08, 0.14 ) : rand( rng, 0.48, 0.6 );
	const lean = new THREE.Vector3( rand( rng, - 0.08, 0.08 ), 1, rand( rng, - 0.08, 0.08 ) ).normalize();
	const up = new THREE.Vector3( 0, 1, 0 );
	// holdfast: a squat, knobbly dome of claws
	const hold = waveNoise( rng, 4, 5, 9 );
	blob( b, lod === 0 ? 1 : 0, ( d, out ) => {

		const k = 1 + 0.35 * hold( d.x, d.y, d.z );
		out.set( d.x * 0.045 * k, Math.max( 0.012 + d.y * 0.02 * k, - 0.01 ), d.z * 0.045 * k );
		return [ 0, 0, 0.5 ];

	} );
	smoothNormals( b );
	// stipe
	const segs = [ 5, 3, 2 ][ lod ];
	const bend = rand( rng, - 0.06, 0.06 );
	const stipe = path( new THREE.Vector3( 0, 0.01, 0 ), lean, stipeH, segs, ( k, d ) => {

		d.x += bend;

	} );
	const w0 = rng();
	tube( b, stipe, stipe.map( ( q, k ) => ( sugar ? 0.006 : 0.011 ) * ( 1 - 0.45 * k / segs ) ), { sides: lod === 0 ? 6 : 4, cap: false, data: () => [ 0, 0, w0 ] } );
	const top = stipe[ stipe.length - 1 ];
	const dir = new THREE.Vector3(), out = new THREE.Vector3();
	if ( sugar ) {

		// one long ribbon, curving over and hanging down-current
		const len = rand( rng, 0.8, 1.0 ), w = rand( rng, 0.09, 0.14 );
		const ya = rng() * TAU;
		const r = rng(), ruffle = rng();
		out.set( Math.cos( ya ), 0, Math.sin( ya ) );
		dir.copy( up ).addScaledVector( out, 0.25 ).normalize();
		ribbon( b, top, dir, out, len, w, len * 0.45, [ 10, 5, 3 ][ lod ], r, lod === 0 ? 0.012 : 0, ruffle );

	} else {

		// palmate frond: straps fanning out from the top of the stipe (all random values drawn
		// whatever the level of detail, so the lower levels keep a subset of the same straps)
		const n = 5 + Math.floor( rng() * 5 );
		const keep = [ n, Math.max( 3, Math.ceil( n * 0.6 ) ), 3 ][ lod ];
		const ya = rng() * TAU;
		for ( let i = 0; i < n; i ++ ) {

			const f = ( i + 0.5 ) / n - 0.5; // -0.5 .. 0.5 across the fan
			const len = rand( rng, 0.32, 0.46 ) * ( 1 - Math.abs( f ) * 0.5 );
			const w = rand( rng, 0.028, 0.045 ) * ( lod === 2 ? 1.8 : lod === 1 ? 1.3 : 1 );
			const r = rng(), droop = rand( rng, 0.35, 0.6 ), ph = rng();
			if ( lod > 0 && ( i % Math.ceil( n / keep ) ) !== 0 ) continue;
			const a = ya + f * 1.6;
			out.set( Math.cos( a ), 0, Math.sin( a ) );
			dir.copy( up ).multiplyScalar( 0.9 ).addScaledVector( out, 0.35 + Math.abs( f ) * 0.6 ).normalize();
			ribbon( b, top, dir, out, len, w, len * droop, [ 5, 3, 2 ][ lod ], r, 0, ph );

		}

	}

	for ( let v = 0; v < b.count; v ++ ) b.data[ v * 4 ] = clamp( b.position[ v * 3 + 1 ] / H, 0, 1 );
	return b.build( { ao: { radius: 0.08, strength: 0.6 } } );

}

// Strap / ribbon blade for the kelps: like blade(), plus a ruffled edge (Saccharina) and a
// part flag of 1 (frond). Both faces.
function ribbon( b, p, dir, out, len, w, lean, segs, r, ruffle, phase01 ) {

	const first = b.count, fi = b.index.length;
	const side = new THREE.Vector3().crossVectors( dir, out ).normalize();
	const pts = [];
	for ( let k = 0; k <= segs; k ++ ) {

		const t = k / segs;
		pts.push( p.clone().addScaledVector( dir, t * len ).addScaledVector( out, lean * t * t ) );

	}

	const phase = phase01 * TAU;
	const nrm = new THREE.Vector3(), T = new THREE.Vector3();
	for ( let k = 0; k <= segs; k ++ ) {

		const t = k / segs;
		T.copy( pts[ Math.min( segs, k + 1 ) ] ).sub( pts[ Math.max( 0, k - 1 ) ] ).normalize();
		nrm.crossVectors( side, T ).normalize();
		// widest a third of the way up, narrowing to a worn tip
		const ww = w * ( k === segs ? 0.3 : Math.min( 1, 0.45 + t * 2.2 ) * ( 1 - 0.45 * t * t ) );
		for ( const s of [ - 1, 1 ] ) {

			_p.copy( pts[ k ] ).addScaledVector( side, s * ww * 0.5 );
			// ruffled edges: the margins wave out of the blade plane
			if ( ruffle ) _p.addScaledVector( nrm, Math.sin( t * 38 + phase + s ) * ruffle * ( 0.3 + t ) );
			b.vertex( _p, nrm, t, 0.55 + 0.45 * t, 1 + 0.9 * t, r ); // part: 1 + position along the blade

		}

	}

	for ( let k = 0; k < segs; k ++ ) b.quad( first + k * 2, first + k * 2 + 1, first + k * 2 + 3, first + k * 2 + 2 );
	b.backfaces( first, fi );

}

// Sea lettuce (Ulva): a clump of thin, bright green, ruffled sheets from a tiny holdfast, lying
// in loose folds. About 0.35 m across at scale 1 (after Tidewater's lettuce coral blades).
// aData = ( height fraction, ao, edge flag (1 near the margin), sheet random )
export function createUlva( rng, lod ) {

	const b = new MeshBuilder();
	const n = [ 7, 4, 3 ][ lod ];
	const nu = [ 6, 3, 2 ][ lod ], nv = [ 4, 2, 1 ][ lod ];
	for ( let k = 0; k < n; k ++ ) {

		const yaw = rng() * TAU;
		const w = rand( rng, 0.12, 0.2 ), h = rand( rng, 0.1, 0.2 ), th = 0.002;
		const lobe = waveNoise( rng, 4, 14, 30 );
		const tilt = rand( rng, 0.4, 1.1 ); // sheets lean over, some almost flat
		const r = rng();
		const at = ( u, v, s, out ) => {

			const x = ( u - 0.5 ) * w;
			const e = Math.abs( u - 0.5 ) * 2;
			const len = h * ( 0.75 + 0.25 * lobe( x, 0, 0 ) ) * Math.sqrt( Math.max( 0.05, 1 - e * e ) );
			const along = v * len;
			// strongly ruffled margins
			const ruff = ( 0.012 + 0.02 * e ) * lobe( x * 3, along * 3, r * 5 ) * v;
			const yy = along * Math.cos( tilt ), fwd = along * Math.sin( tilt );
			const ca = Math.cos( yaw ), sa = Math.sin( yaw );
			const zz = fwd + s * th + ruff;
			out.set( x * ca - zz * sa, yy + 0.005, x * sa + zz * ca );
			return [ v, e > 0.75 || v > 0.85 ? 1 : 0, r ];

		};

		const first = b.count, fi = b.index.length;
		sheet( b, nu, nv, ( u, v, out ) => at( u, v, 1, out ), false );
		sheet( b, nu, nv, ( u, v, out ) => at( 1 - u, v, - 1, out ), false );
		smoothNormals( b, first, fi );

	}

	for ( let v = 0; v < b.count; v ++ ) b.data[ v * 4 ] = clamp( b.position[ v * 3 + 1 ] / 0.2, 0, 1 );
	return b.build( { ao: { radius: 0.05, strength: 0.7 } } );

}

// Mussel clump (Mytilus): elongated, slightly bent shells packed together, standing on end on
// the rock. About 0.3 m across at scale 1.
// aData = ( height fraction, ao, 0, shell random )
export function createMussels( rng, lod ) {

	const b = new MeshBuilder();
	const n = [ 26, 12, 5 ][ lod ];
	const size = [ 1, 1.25, 1.7 ][ lod ];
	const q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, rr = Math.sqrt( rng() ) * 0.12;
		c.set( Math.cos( a ) * rr, 0, Math.sin( a ) * rr );
		const L = rand( rng, 0.045, 0.075 ) * size, W = L * 0.42, T = L * 0.3;
		// mostly upright, leaning out from the clump centre
		e.set( rand( rng, - 0.5, 0.5 ) + Math.sin( a ) * 0.4, rng() * TAU, rand( rng, - 0.5, 0.5 ) - Math.cos( a ) * 0.4 );
		q.setFromEuler( e );
		const r = rng();
		const first = b.count, fi = b.index.length;
		blob( b, lod === 0 ? 1 : 0, ( d, out ) => {

			// pointed umbo at the bottom, rounded at the top, flattened sides, a slight curve
			const t = d.y * 0.5 + 0.5;
			const taper = 0.35 + 0.65 * Math.sin( Math.min( 1, t * 1.1 ) * Math.PI * 0.5 );
			out.set( d.x * W * 0.5 * taper + ( t * t ) * L * 0.08, d.y * L * 0.5 + L * 0.45, d.z * T * 0.5 * taper );
			out.applyQuaternion( q ).add( c );
			return [ 0, 0, r ];

		} );
		smoothNormals( b, first, fi );

	}

	let H = 0;
	for ( let v = 0; v < b.count; v ++ ) H = Math.max( H, b.position[ v * 3 + 1 ] );
	for ( let v = 0; v < b.count; v ++ ) {

		b.data[ v * 4 ] = clamp( b.position[ v * 3 + 1 ] / H, 0, 1 );
		b.position[ v * 3 + 1 ] = Math.max( b.position[ v * 3 + 1 ], - 0.01 );

	}

	return b.build( { ao: { radius: 0.05, strength: 1 } } );

}
