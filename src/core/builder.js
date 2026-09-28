import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Accumulates geometry per material key, in world space, then merges each
// bucket into a single BufferGeometry (one draw call per material).
// Every primitive here writes UVs in metres so TSL materials can build
// masonry / thatch / planks at a consistent real-world scale.
export class GeoBuilder {

	constructor() { this.buckets = new Map(); }

	add( key, geo, matrix = null ) {
		const g = geo.index ? geo.toNonIndexed() : geo;
		if ( matrix ) g.applyMatrix4( matrix );
		if ( ! g.attributes.uv ) g.setAttribute( 'uv', new THREE.BufferAttribute( new Float32Array( g.attributes.position.count * 2 ), 2 ) );
		for ( const name of Object.keys( g.attributes ) ) if ( ! [ 'position', 'normal', 'uv' ].includes( name ) ) g.deleteAttribute( name );
		if ( ! this.buckets.has( key ) ) this.buckets.set( key, [] );
		this.buckets.get( key ).push( g );
	}

	build() {
		const out = new Map();
		for ( const [ k, list ] of this.buckets ) {
			const g = mergeGeometries( list );
			g.computeBoundingSphere();
			out.set( k, g );
		}
		return out;
	}
}

// Raw triangle soup helper.
class Soup {
	constructor() { this.p = []; this.n = []; this.uv = []; }
	tri( a, b, c, ua, ub, uc, flat = true, na, nb, nc ) {
		this.p.push( ...a, ...b, ...c );
		this.uv.push( ...ua, ...ub, ...uc );
		if ( flat || ! na ) {
			const e1 = new THREE.Vector3( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] );
			const e2 = new THREE.Vector3( c[ 0 ] - a[ 0 ], c[ 1 ] - a[ 1 ], c[ 2 ] - a[ 2 ] );
			const n = e1.cross( e2 ).normalize();
			for ( let i = 0; i < 3; i ++ ) this.n.push( n.x, n.y, n.z );
		} else this.n.push( ...na, ...nb, ...nc );
	}
	quad( a, b, c, d, ua, ub, uc, ud, smooth = null ) {
		// a-b-c-d counter-clockwise seen from the front
		if ( smooth ) {
			this.tri( a, b, c, ua, ub, uc, false, smooth[ 0 ], smooth[ 1 ], smooth[ 2 ] );
			this.tri( a, c, d, ua, uc, ud, false, smooth[ 0 ], smooth[ 2 ], smooth[ 3 ] );
		} else {
			this.tri( a, b, c, ua, ub, uc );
			this.tri( a, c, d, ua, uc, ud );
		}
	}
	geometry() {
		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.p, 3 ) );
		g.setAttribute( 'normal', new THREE.Float32BufferAttribute( this.n, 3 ) );
		g.setAttribute( 'uv', new THREE.Float32BufferAttribute( this.uv, 2 ) );
		return g;
	}
}

// Box with metric UVs (u along the face width, v up).
export function box( w, h, d ) {
	const s = new Soup();
	const x = w / 2, z = d / 2;
	// front (+z), back (-z), right (+x), left (-x), top, bottom
	s.quad( [ - x, 0, z ], [ x, 0, z ], [ x, h, z ], [ - x, h, z ], [ 0, 0 ], [ w, 0 ], [ w, h ], [ 0, h ] );
	s.quad( [ x, 0, - z ], [ - x, 0, - z ], [ - x, h, - z ], [ x, h, - z ], [ 0, 0 ], [ w, 0 ], [ w, h ], [ 0, h ] );
	s.quad( [ x, 0, z ], [ x, 0, - z ], [ x, h, - z ], [ x, h, z ], [ 0, 0 ], [ d, 0 ], [ d, h ], [ 0, h ] );
	s.quad( [ - x, 0, - z ], [ - x, 0, z ], [ - x, h, z ], [ - x, h, - z ], [ 0, 0 ], [ d, 0 ], [ d, h ], [ 0, h ] );
	s.quad( [ - x, h, z ], [ x, h, z ], [ x, h, - z ], [ - x, h, - z ], [ 0, 0 ], [ w, 0 ], [ w, d ], [ 0, d ] );
	s.quad( [ - x, 0, - z ], [ x, 0, - z ], [ x, 0, z ], [ - x, 0, z ], [ 0, 0 ], [ w, 0 ], [ w, d ], [ 0, d ] );
	return s.geometry();
}

// Round post / log (u around in metres, v along the length).
export function post( r, h, seg = 7 ) {
	const g = new THREE.CylinderGeometry( r * 0.92, r, h, seg, 1, false );
	g.translate( 0, h / 2, 0 );
	const uv = g.attributes.uv;
	for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, uv.getX( i ) * Math.PI * 2 * r, uv.getY( i ) * h );
	return g;
}

// Beam from point a to b.
export function beam( a, b, r, seg = 6 ) {
	const dir = new THREE.Vector3().subVectors( b, a );
	const len = dir.length();
	const g = post( r, len, seg );
	g.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), dir.normalize() ) );
	g.translate( a.x, a.y, a.z );
	return g;
}

// Curved dry-stone wall ring with an optional door gap.
// Walls lean slightly inward (batter) like real castro houses.
export function ringWall( r, h, t, opts = {} ) {
	const { door = null, doorW = 1.2, seg = 40, batter = 0.06, jitter = null } = opts;
	const s = new Soup();
	const gapHalf = door !== null ? doorW / 2 / r : 0;
	const angDiff = ( a, b ) => Math.atan2( Math.sin( a - b ), Math.cos( a - b ) );
	const P = ( a, rad, y ) => [ Math.cos( a ) * rad, y, Math.sin( a ) * rad ];
	const rTop = r - batter * h;
	for ( let i = 0; i < seg; i ++ ) {
		const a0 = i / seg * Math.PI * 2, a1 = ( i + 1 ) / seg * Math.PI * 2;
		const am = ( a0 + a1 ) / 2;
		if ( door !== null && Math.abs( angDiff( am, door ) ) < gapHalf ) continue;
		const j0 = jitter ? jitter( a0 ) : 0, j1 = jitter ? jitter( a1 ) : 0;
		const h0 = h + j0, h1 = h + j1;
		const u0 = a0 * r, u1 = a1 * r;
		// outer
		s.quad( P( a1, r, 0 ), P( a0, r, 0 ), P( a0, rTop, h0 ), P( a1, rTop, h1 ), [ u1, 0 ], [ u0, 0 ], [ u0, h0 ], [ u1, h1 ],
			[ [ Math.cos( a1 ), 0.06, Math.sin( a1 ) ], [ Math.cos( a0 ), 0.06, Math.sin( a0 ) ], [ Math.cos( a0 ), 0.06, Math.sin( a0 ) ], [ Math.cos( a1 ), 0.06, Math.sin( a1 ) ] ] );
		// inner
		s.quad( P( a0, r - t, 0 ), P( a1, r - t, 0 ), P( a1, rTop - t, h1 ), P( a0, rTop - t, h0 ), [ u0, 0 ], [ u1, 0 ], [ u1, h1 ], [ u0, h0 ],
			[ [ - Math.cos( a0 ), 0, - Math.sin( a0 ) ], [ - Math.cos( a1 ), 0, - Math.sin( a1 ) ], [ - Math.cos( a1 ), 0, - Math.sin( a1 ) ], [ - Math.cos( a0 ), 0, - Math.sin( a0 ) ] ] );
		// top cap
		s.quad( P( a0, rTop - t, h0 ), P( a1, rTop - t, h1 ), P( a1, rTop, h1 ), P( a0, rTop, h0 ), [ u0, 0 ], [ u1, 0 ], [ u1, t ], [ u0, t ] );
	}
	if ( door !== null ) {
		// door jambs
		for ( const sgn of [ - 1, 1 ] ) {
			const a = door + sgn * gapHalf;
			const A = P( a, r, 0 ), B = P( a, r - t, 0 ), C = P( a, rTop - t, h ), D = P( a, rTop, h );
			if ( sgn < 0 ) s.quad( A, B, C, D, [ 0, 0 ], [ t, 0 ], [ t, h ], [ 0, h ] );
			else s.quad( B, A, D, C, [ 0, 0 ], [ t, 0 ], [ t, h ], [ 0, h ] );
		}
	}
	return s.geometry();
}

// Conical thatch roof: eave radius R at y0 up to apex at y1, slightly
// concave, with a thick rolled eave. u = around (m), v = along the slope (m).
export function coneRoof( R, y0, y1, opts = {} ) {
	const { seg = 36, rings = 8, sag = 0.12, thick = 0.35, jitter = null } = opts;
	const s = new Soup();
	const slant = Math.hypot( R, y1 - y0 );
	const pt = ( a, t, off = 0 ) => {
		// t: 0 at eave, 1 at apex
		const rad = R * ( 1 - t ) + off;
		const y = y0 + ( y1 - y0 ) * t - sag * Math.sin( Math.PI * t ) * ( y1 - y0 ) * 0.25;
		const j = jitter ? jitter( a, t ) : 0;
		return [ Math.cos( a ) * ( rad + j ), y + j * 0.3, Math.sin( a ) * ( rad + j ) ];
	};
	for ( let i = 0; i < seg; i ++ ) {
		const a0 = i / seg * Math.PI * 2, a1 = ( i + 1 ) / seg * Math.PI * 2;
		for ( let k = 0; k < rings; k ++ ) {
			const t0 = k / rings, t1 = ( k + 1 ) / rings;
			const c0 = R * ( 1 - t0 ), c1 = R * ( 1 - t1 );
			const nA = [ Math.cos( a0 ) * ( y1 - y0 ), R, Math.sin( a0 ) * ( y1 - y0 ) ], nB = [ Math.cos( a1 ) * ( y1 - y0 ), R, Math.sin( a1 ) * ( y1 - y0 ) ];
			const nl = ( v ) => { const l = Math.hypot( ...v ); return v.map( ( x ) => x / l ); };
			s.quad( pt( a1, t0 ), pt( a0, t0 ), pt( a0, t1 ), pt( a1, t1 ),
				[ a1 * c0, t0 * slant ], [ a0 * c0, t0 * slant ], [ a0 * c1, t1 * slant ], [ a1 * c1, t1 * slant ],
				[ nl( nB ), nl( nA ), nl( nA ), nl( nB ) ] );
		}
		// underside of the eave (thickness) and the rolled edge
		const e0 = pt( a0, 0 ), e1 = pt( a1, 0 );
		const b0 = [ e0[ 0 ], e0[ 1 ] - thick, e0[ 2 ] ], b1 = [ e1[ 0 ], e1[ 1 ] - thick, e1[ 2 ] ];
		s.quad( e1, b1, b0, e0, [ a1 * R, 0 ], [ a1 * R, - thick ], [ a0 * R, - thick ], [ a0 * R, 0 ],
			[ [ Math.cos( a1 ), - 0.2, Math.sin( a1 ) ], [ Math.cos( a1 ), - 0.5, Math.sin( a1 ) ], [ Math.cos( a0 ), - 0.5, Math.sin( a0 ) ], [ Math.cos( a0 ), - 0.2, Math.sin( a0 ) ] ] );
		const i0 = pt( a0, 0.18, 0 ), i1 = pt( a1, 0.18, 0 );
		s.quad( b1, [ i1[ 0 ], i1[ 1 ] - thick * 1.2, i1[ 2 ] ], [ i0[ 0 ], i0[ 1 ] - thick * 1.2, i0[ 2 ] ], b0, [ 0, 0 ], [ 0, 1 ], [ 1, 1 ], [ 1, 0 ] );
	}
	return s.geometry();
}

// Gable thatch roof over a w (x) by l (z) footprint; ridge along z.
export function gableRoof( w, l, y0, rise, opts = {} ) {
	const { over = 0.7, thick = 0.35, segs = 10 } = opts;
	const s = new Soup();
	const hw = w / 2 + over, hl = l / 2 + over * 0.8;
	const slant = Math.hypot( hw, rise );
	for ( const side of [ - 1, 1 ] ) {
		for ( let k = 0; k < segs; k ++ ) {
			const z0 = - hl + ( 2 * hl ) * k / segs, z1 = - hl + ( 2 * hl ) * ( k + 1 ) / segs;
			const sag = ( z ) => 0.08 * Math.sin( Math.PI * ( z + hl ) / ( 2 * hl ) );
			const E0 = [ side * hw, y0 - sag( z0 ), z0 ], E1 = [ side * hw, y0 - sag( z1 ), z1 ];
			const R0 = [ 0, y0 + rise - sag( z0 ) * 2, z0 ], R1 = [ 0, y0 + rise - sag( z1 ) * 2, z1 ];
			const u0 = z0 + hl, u1 = z1 + hl;
			if ( side > 0 ) s.quad( E0, R0, R1, E1, [ u0, 0 ], [ u0, slant ], [ u1, slant ], [ u1, 0 ] );
			else s.quad( E1, R1, R0, E0, [ u1, 0 ], [ u1, slant ], [ u0, slant ], [ u0, 0 ] );
			// eave thickness
			const B0 = [ E0[ 0 ], E0[ 1 ] - thick, z0 ], B1 = [ E1[ 0 ], E1[ 1 ] - thick, z1 ];
			if ( side > 0 ) s.quad( B0, E0, E1, B1, [ u0, - thick ], [ u0, 0 ], [ u1, 0 ], [ u1, - thick ] );
			else s.quad( B1, E1, E0, B0, [ u1, - thick ], [ u1, 0 ], [ u0, 0 ], [ u0, - thick ] );
		}
		// gable-end thickness strips
		for ( const end of [ - 1, 1 ] ) {
			const z = end * hl;
			const E = [ side * hw, y0, z ], R = [ 0, y0 + rise, z ];
			const Eb = [ side * hw, y0 - thick, z ], Rb = [ 0, y0 + rise - thick, z ];
			if ( side * end > 0 ) s.quad( Eb, E, R, Rb, [ 0, 0 ], [ 0, thick ], [ slant, thick ], [ slant, 0 ] );
			else s.quad( E, Eb, Rb, R, [ 0, thick ], [ 0, 0 ], [ slant, 0 ], [ slant, thick ] );
		}
	}
	return s.geometry();
}

// Triangular gable wall (planks / wattle) closing a gable roof end.
export function gableWall( w, y0, rise, z, facing ) {
	const s = new Soup();
	const a = [ - w / 2, y0, z ], b = [ w / 2, y0, z ], c = [ 0, y0 + rise, z ];
	if ( facing > 0 ) s.tri( a, b, c, [ 0, 0 ], [ w, 0 ], [ w / 2, rise ] );
	else s.tri( b, a, c, [ w, 0 ], [ 0, 0 ], [ w / 2, rise ] );
	return s.geometry();
}

// Sloped cloth canopy (market stall), sagging in the middle.
export function canopy( w, d, hFront, hBack, sag = 0.18, seg = 6 ) {
	const s = new Soup();
	for ( let i = 0; i < seg; i ++ ) for ( let j = 0; j < seg; j ++ ) {
		const P = ( u, v ) => {
			const x = ( u - 0.5 ) * w, z = ( v - 0.5 ) * d;
			const y = hFront + ( hBack - hFront ) * v - sag * Math.sin( Math.PI * u ) * Math.sin( Math.PI * v );
			return [ x, y, z ];
		};
		const u0 = i / seg, u1 = ( i + 1 ) / seg, v0 = j / seg, v1 = ( j + 1 ) / seg;
		s.quad( P( u0, v1 ), P( u1, v1 ), P( u1, v0 ), P( u0, v0 ), [ u0 * w, v1 * d ], [ u1 * w, v1 * d ], [ u1 * w, v0 * d ], [ u0 * w, v0 * d ] );
		s.quad( P( u0, v0 ), P( u1, v0 ), P( u1, v1 ), P( u0, v1 ), [ u0 * w, v0 * d ], [ u1 * w, v0 * d ], [ u1 * w, v1 * d ], [ u0 * w, v1 * d ] );
	}
	// scalloped valance at the front
	for ( let i = 0; i < seg; i ++ ) {
		const x0 = ( i / seg - 0.5 ) * w, x1 = ( ( i + 1 ) / seg - 0.5 ) * w, xm = ( x0 + x1 ) / 2;
		const y = hFront, z = - d / 2;
		s.tri( [ x0, y, z ], [ x1, y, z ], [ xm, y - 0.35, z - 0.02 ], [ 0, 0 ], [ 1, 0 ], [ 0.5, 0.35 ] );
		s.tri( [ x1, y, z ], [ x0, y, z ], [ xm, y - 0.35, z - 0.02 ], [ 1, 0 ], [ 0, 0 ], [ 0.5, 0.35 ] );
	}
	return s.geometry();
}

// Pennant string: triangular flags hanging along a catenary from a to b.
export function bunting( a, b, n = 12, sag = 0.6, size = 0.35 ) {
	const s = new Soup();
	for ( let i = 0; i < n; i ++ ) {
		const t0 = ( i + 0.1 ) / n, t1 = ( i + 0.9 ) / n, tm = ( i + 0.5 ) / n;
		const P = ( t ) => [ a.x + ( b.x - a.x ) * t, a.y + ( b.y - a.y ) * t - sag * 4 * t * ( 1 - t ), a.z + ( b.z - a.z ) * t ];
		const p0 = P( t0 ), p1 = P( t1 ), pm = P( tm );
		const tip = [ pm[ 0 ], pm[ 1 ] - size * 1.4, pm[ 2 ] ];
		s.tri( p0, p1, tip, [ 0, 0 ], [ 1, 0 ], [ 0.5, 1 ] );
		s.tri( p1, p0, tip, [ 1, 0 ], [ 0, 0 ], [ 0.5, 1 ] );
	}
	return s.geometry();
}

// Straight dry-stone wall segment from a to b (on possibly sloped ground).
export function straightWall( a, b, h, t, ya, yb, opts = {} ) {
	const { crenel = 0, top = null } = opts;
	const s = new Soup();
	const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot( dx, dz );
	const nx = - dz / L * t / 2, nz = dx / L * t / 2;
	const segs = Math.max( 1, Math.ceil( L / 1.5 ) );
	for ( let i = 0; i < segs; i ++ ) {
		const t0 = i / segs, t1 = ( i + 1 ) / segs;
		const x0 = a.x + dx * t0, z0 = a.z + dz * t0, x1 = a.x + dx * t1, z1 = a.z + dz * t1;
		const g0 = ya + ( yb - ya ) * t0 - 0.6, g1 = ya + ( yb - ya ) * t1 - 0.6;
		const tj0 = top ? top( x0, z0 ) : 0, tj1 = top ? top( x1, z1 ) : 0;
		const top0 = ya + ( yb - ya ) * t0 + h + tj0 + ( crenel && i % 2 ? crenel : 0 ), top1 = ya + ( yb - ya ) * t1 + h + tj1 + ( crenel && i % 2 ? crenel : 0 );
		const u0 = t0 * L, u1 = t1 * L;
		// side A (+n), side B (-n), top
		s.quad( [ x0 + nx, g0, z0 + nz ], [ x1 + nx, g1, z1 + nz ], [ x1 + nx * 0.85, top1, z1 + nz * 0.85 ], [ x0 + nx * 0.85, top0, z0 + nz * 0.85 ], [ u0, g0 ], [ u1, g1 ], [ u1, top1 ], [ u0, top0 ] );
		s.quad( [ x1 - nx, g1, z1 - nz ], [ x0 - nx, g0, z0 - nz ], [ x0 - nx * 0.85, top0, z0 - nz * 0.85 ], [ x1 - nx * 0.85, top1, z1 - nz * 0.85 ], [ u1, g1 ], [ u0, g0 ], [ u0, top0 ], [ u1, top1 ] );
		s.quad( [ x0 + nx * 0.85, top0, z0 + nz * 0.85 ], [ x1 + nx * 0.85, top1, z1 + nz * 0.85 ], [ x1 - nx * 0.85, top1, z1 - nz * 0.85 ], [ x0 - nx * 0.85, top0, z0 - nz * 0.85 ], [ u0, 0 ], [ u1, 0 ], [ u1, t ], [ u0, t ] );
		if ( crenel && i % 2 ) {
			// merlon side faces
			for ( const [ xx, zz, tt, sg ] of [ [ x0, z0, top0, - 1 ], [ x1, z1, top1, 1 ] ] ) {
				const lo = tt - crenel;
				const A = [ xx + nx * 0.85, lo, zz + nz * 0.85 ], B = [ xx - nx * 0.85, lo, zz - nz * 0.85 ], C = [ xx - nx * 0.85, tt, zz - nz * 0.85 ], D = [ xx + nx * 0.85, tt, zz + nz * 0.85 ];
				if ( sg > 0 ) s.quad( A, B, C, D, [ 0, 0 ], [ t, 0 ], [ t, crenel ], [ 0, crenel ] );
				else s.quad( B, A, D, C, [ 0, 0 ], [ t, 0 ], [ t, crenel ], [ 0, crenel ] );
			}
		}
	}
	// end caps
	for ( const [ p, y, sg ] of [ [ a, ya, - 1 ], [ b, yb, 1 ] ] ) {
		const A = [ p.x + nx, y - 0.6, p.z + nz ], B = [ p.x - nx, y - 0.6, p.z - nz ], C = [ p.x - nx * 0.85, y + h, p.z - nz * 0.85 ], D = [ p.x + nx * 0.85, y + h, p.z + nz * 0.85 ];
		if ( sg > 0 ) s.quad( A, B, C, D, [ 0, 0 ], [ t, 0 ], [ t, h ], [ 0, h ] );
		else s.quad( B, A, D, C, [ 0, 0 ], [ t, 0 ], [ t, h ], [ 0, h ] );
	}
	return s.geometry();
}

export { Soup };
