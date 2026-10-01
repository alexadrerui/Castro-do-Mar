// Composite castro house (reconstruction of ref/casa_castro, spec ref/casa_castro/spec.json): a
// rectangular dry-stone dwelling with a gabled thatch roof, a round tower on its east end under a
// stepped thatch cone, a timber porch with a plank roof on the front, a door with a stone frame and
// a carved timber gable under a thatch hood, and a detached round kitchen shelter with a bread oven.
// Local frame: metres, +Y up, front (door, porch) = +Z, origin on the ground at the body centre.
// detail: 0 blockout (volumes), 1 structure (openings, members, tiers), 2 form (carving, rafter
// ends, ragged eaves, props). Geometry goes into a GeoBuilder under the project material keys.
import * as THREE from 'three/webgpu';
import { GeoBuilder, box, post, beam, ringWall, gableRoof, gableWall, straightWall, Soup } from '../core/builder.js';
import { mulberry32 } from '../core/noise.js';
import { woodpile, basket, jar, oxCart } from './buildings.js';

const V = ( x, y, z ) => new THREE.Vector3( x, y, z );
const M = ( x, y, z, ry = 0, s = 1 ) => new THREE.Matrix4().compose( V( x, y, z ), new THREE.Quaternion().setFromAxisAngle( V( 0, 1, 0 ), ry ), V( s, s, s ) );

// dimensions (spec componentTree)
export const CASTRO_HOUSE = {
	body: { x0: - 5.2, x1: 2.8, z0: - 2.75, z1: 2.75, h: 2.9, t: 0.6 },
	door: { x: 0.4, w: 1.0, h: 1.9 },
	gateway: { z: 0, w: 2.0, h: 2.0 },          // in the west gable wall
	tower: { x: 3.1, z: - 0.7, r: 3.0, h: 3.6 },   // ref_3: wall height ~0.6 of the diameter
	porch: { x0: - 5.0, x1: - 1.1, depth: 2.0, hFront: 2.15, hBack: 2.5 },
	shelter: { x: 6.3, z: 5.9, r: 1.85, wallH: 0.9, postH: 1.4 },
	centre: [ 1.5, 2.5 ],                       // middle of the compound (house, tower, shelter): the village anchor
	footprintR: 9.5                             // about the centre: pads / clearance of the village (layout r)
};

// its own stone and thatch (world/materials.js castroStone / castroThatch: the reference's grey
// slabs and dark straw); every other key is the village's
export const CASTRO_KEYS = { stone: 'castroStone', stoneDark: 'castroStone', thatch: 'castroThatch', thatchGreen: 'castroThatch' };

export function buildCastroHouse( target, { detail = 2, seed = 7 } = {} ) {
	const B = { add: ( key, geo, m ) => target.add( CASTRO_KEYS[ key ] ?? key, geo, m ) };
	const rnd = mulberry32( seed );
	const H = CASTRO_HOUSE, b = H.body;
	const cx = ( b.x0 + b.x1 ) / 2, L = b.x1 - b.x0, W = b.z1 - b.z0;

	// ---------------------------------------------------------------- body walls
	if ( detail === 0 ) {
		B.add( 'stone', box( L, b.h, W ), M( cx, 0, 0 ) );
	} else {
		const t = b.t, d = H.door;
		const wall = ( ax, az, bx, bz ) => B.add( 'stone', straightWall( V( ax, 0, az ), V( bx, 0, bz ), b.h, t, 0, 0 ) );
		// front wall (+z) split by the door
		wall( b.x0, b.z1 - t / 2, d.x - d.w / 2 - 0.3, b.z1 - t / 2 );
		wall( d.x + d.w / 2 + 0.3, b.z1 - t / 2, b.x1, b.z1 - t / 2 );
		B.add( 'stone', box( d.w + 0.6, b.h - d.h - 0.25, t ), M( d.x, d.h + 0.25, b.z1 - t / 2 ) );
		wall( b.x0, b.z0 + t / 2, b.x1, b.z0 + t / 2 );                    // back
		// west gable wall with the wide gateway
		const g = H.gateway;
		wall( b.x0 + t / 2, b.z0, b.x0 + t / 2, g.z - g.w / 2 - 0.35 );
		wall( b.x0 + t / 2, g.z + g.w / 2 + 0.35, b.x0 + t / 2, b.z1 );
		B.add( 'stone', box( t, b.h - g.h - 0.3, g.w + 0.7 ), M( b.x0 + t / 2, g.h + 0.3, g.z ) );
		// gateway frame: big upright stones and a lintel; the opening walled up with darker stone, set
		// back (ref_2)
		for ( const s of [ - 1, 1 ] ) B.add( 'stoneDark', box( t + 0.12, g.h + 0.05, 0.38 ), M( b.x0 + t / 2, 0, g.z + s * ( g.w / 2 + 0.17 ) ) );
		B.add( 'stoneDark', box( t + 0.14, 0.3, g.w + 0.8 ), M( b.x0 + t / 2, g.h, g.z ) );
		B.add( 'stoneDark', box( 0.2, g.h, g.w ), M( b.x0 + t - 0.2, 0, g.z ) );
		// east gable (inside the tower) and its triangle under the roof
		wall( b.x1 - t / 2, b.z0, b.x1 - t / 2, b.z1 );
		// door: dressed jambs, lintel, threshold, dark leaf
		for ( const s of [ - 1, 1 ] ) B.add( 'stoneDark', box( 0.32, d.h + 0.05, t + 0.14 ), M( d.x + s * ( d.w / 2 + 0.16 ), 0, b.z1 - t / 2 ) );
		B.add( 'stoneDark', box( d.w + 0.75, 0.28, t + 0.18 ), M( d.x, d.h, b.z1 - t / 2 ) );
		B.add( 'stoneDark', box( d.w + 0.8, 0.18, 0.6 ), M( d.x, 0, b.z1 + 0.25 ) );
		B.add( 'doorway', box( d.w, d.h, 0.04 ), M( d.x, 0, b.z1 - t + 0.1 ) );
	}

	// ---------------------------------------------------------------- body roof (ridge along x)
	// gable on the west end, hip on the east end where it runs down into the tower (ref_1). The eave
	// edge sits just below the wall head, so the whole wall shows (ref_1); ridge ~6.3 m
	const over = 0.65, pitch = Math.tan( 46 * Math.PI / 180 );
	const y0 = b.h - 0.15;
	const fullRise = ( W / 2 + over ) * pitch;
	const gableM = new THREE.Matrix4().makeRotationY( Math.PI / 2 );
	if ( detail === 0 ) {
		B.add( 'thatch', hipGableRoof( b.x0, b.x1, W, y0, fullRise, over, 0.4 ) );
		B.add( 'stone', gableWall( W, b.h, y0 + fullRise - b.h - 0.25, b.x0, - 1 ), gableM );
	} else {
		// one shell; at detail 2 laid in 7 courses with lifted lips and a ragged eave
		B.add( 'thatch', hipGableRoof( b.x0, b.x1, W, y0, fullRise, over, 0.3, detail >= 2 ? { courses: 7, lip: 0.11, rag: 0.12 } : {} ) );
		// gable triangle of the west end (stone), closed under the thatch
		B.add( 'stone', gableWall( W - 0.05, b.h, y0 + fullRise - b.h - 0.25, b.x0 + 0.02, - 1 ), gableM );
		// ridge roll, from the west gable to the top of the hip
		const ry = y0 + fullRise - 0.08;
		B.add( 'thatchGreen', beam( V( b.x0 - over * 0.8, ry, 0 ), V( b.x1 - W / 2, ry, 0 ), 0.24, 8 ) );
	}

	// ---------------------------------------------------------------- door porch: hood, carved gable, piers
	// ref_1: a thatch cross gable (~3.2 m wide, eaves ~2.4 m) projects ~0.9 m over the door; the carved
	// timber gable fills its front, standing on two stone piers that frame the doorway
	const d = H.door, hood = { w: 3.2, y0: 2.35, rise: 2.0, front: b.z1 + 0.95 }, gz = b.z1 + 0.6;
	const pierX = 1.18, gBase = 2.45;
	if ( detail === 0 ) {
		B.add( 'thatch', gableRoof( hood.w - 0.4, 2.4, hood.y0, hood.rise, { over: 0.2, thick: 0.3 } ), M( d.x, 0, hood.front - 1.36 ) );
	} else {
		B.add( 'thatch', gableHood( hood.w - 0.4, 2.4, hood.y0, hood.rise, 0.2, 0.32, detail >= 2 ? { courses: 4, lip: 0.1, rag: 0.08 } : {} ), M( d.x, 0, hood.front - 1.36 ) );
		for ( const s of [ - 1, 1 ] ) B.add( 'stoneDark', box( 0.45, gBase, gz - b.z1 + 0.3 ), M( d.x + s * pierX, 0, ( gz + b.z1 - 0.3 ) / 2 ) );
		B.add( 'wood', gableWall( 2 * pierX + 0.4, gBase, 1.6, gz + 0.1, 1 ), M( d.x, 0, 0 ) ); // gableWall is built at x = 0
		B.add( 'woodPost', beam( V( d.x - pierX - 0.2, gBase, gz + 0.16 ), V( d.x + pierX + 0.2, gBase, gz + 0.16 ), 0.08 ) );
		if ( detail >= 2 ) {
			// rakes and a six-petal rosette in relief
			for ( const s of [ - 1, 1 ] ) B.add( 'woodPost', beam( V( d.x + s * ( pierX + 0.15 ), gBase + 0.05, gz + 0.17 ), V( d.x, gBase + 1.55, gz + 0.17 ), 0.05 ) );
			const rc = V( d.x, gBase + 0.6, gz + 0.12 );
			B.add( 'woodPost', new THREE.TorusGeometry( 0.2, 0.025, 6, 24 ), M( rc.x, rc.y, rc.z ) );
			for ( let p = 0; p < 6; p ++ ) {
				const a = p / 6 * Math.PI * 2;
				const petal = new THREE.SphereGeometry( 0.07, 8, 6 ).scale( 1, 0.45, 0.35 );
				B.add( 'woodPost', petal, new THREE.Matrix4().makeRotationZ( a ).premultiply( new THREE.Matrix4().makeTranslation( rc.x + Math.cos( a ) * 0.1, rc.y + Math.sin( a ) * 0.1, rc.z + 0.01 ) ) );
			}
		}
	}

	// ---------------------------------------------------------------- tower
	const T = H.tower;
	if ( detail === 0 ) {
		B.add( 'stone', new THREE.CylinderGeometry( T.r, T.r, T.h, 32 ).translate( 0, T.h / 2, 0 ), M( T.x, 0, T.z ) );
	} else {
		const winA = - 0.75; // the window faces north-east (ref_3)
		B.add( 'stone', ringWall( T.r, T.h, 0.6, { seg: 44, batter: 0.02 } ), M( T.x, 0, T.z ) );
		// crown: irregular stones protruding above the wall head
		const n = detail >= 2 ? 18 : 10;
		for ( let k = 0; k < n; k ++ ) {
			const a = ( k + rnd() * 0.4 ) / n * Math.PI * 2, h = 0.25 + rnd() * 0.4, w = 0.45 + rnd() * 0.4; // irregular merlons (ref_3 / ref_4)
			B.add( 'stoneDark', box( w, h, 0.62 ), M( T.x + Math.cos( a ) * ( T.r - 0.3 ), T.h - 0.05, T.z + Math.sin( a ) * ( T.r - 0.3 ), Math.PI / 2 - a ) );
		}
		// small square window with a dark recess and a sill
		const wx = T.x + Math.cos( winA ) * ( T.r + 0.01 ), wz = T.z + Math.sin( winA ) * ( T.r + 0.01 );
		B.add( 'doorway', box( 0.46, 0.46, 0.04 ), M( wx, 1.45, wz, Math.PI / 2 - winA ) );
		B.add( 'stoneDark', box( 0.7, 0.12, 0.25 ), M( wx, 1.36, wz, Math.PI / 2 - winA ) );
	}
	// stepped cone (ref_3): wide, low tiers, each a shallow cone (42 deg) whose eave stands a step
	// proud of the tier below; it starts inside the crenellated parapet (the ring of stones shows
	// around the thatch in ref_3 / ref_4 / ref_5) and rises ~2.7 m above the wall head, its apex a little over the body ridge
	const slope = Math.tan( 42 * Math.PI / 180 ), base = T.h - 0.45, R0 = T.r - 0.4;
	const radii = detail === 0 ? [ R0 ] : [ 1, 0.75, 0.5, 0.3 ].map( ( f ) => R0 * f );
	let yT = base;
	for ( let k = 0; k < radii.length; k ++ ) {
		const R = radii[ k ];
		if ( k > 0 ) yT += ( radii[ k - 1 ] - R ) * slope + 0.25; // on the tier below, plus the step
		// each tier with a rolled, gently uneven eave (two courses at detail 2)
		B.add( k % 2 ? 'thatchGreen' : 'thatch', coneCourses( R, yT, yT + R * slope, { courses: detail >= 2 ? 2 : 0, lip: 0.08, rag: 0.06, thick: 0.25, phase: k + seed } ), M( T.x, 0, T.z ) );
	}

	// ---------------------------------------------------------------- porch
	const P = H.porch, pz1 = b.z1 + P.depth;
	if ( detail === 0 ) {
		B.add( 'wood', box( P.x1 - P.x0, 0.2, P.depth ), M( ( P.x0 + P.x1 ) / 2, P.hFront, b.z1 + P.depth / 2 ) );
	} else {
		const xs = [ P.x0, P.x0 + ( P.x1 - P.x0 ) / 3, P.x0 + 2 * ( P.x1 - P.x0 ) / 3, P.x1 ];
		for ( const x of xs ) {
			B.add( 'woodPost', box( 0.18, P.hFront, 0.18 ), M( x, 0, pz1 - 0.1 ) );
			// knee braces to the front beam
			if ( x !== P.x0 ) B.add( 'woodPost', beam( V( x, P.hFront - 0.6, pz1 - 0.1 ), V( x - 0.5, P.hFront - 0.05, pz1 - 0.1 ), 0.05 ) );
			if ( x !== P.x1 ) B.add( 'woodPost', beam( V( x, P.hFront - 0.6, pz1 - 0.1 ), V( x + 0.5, P.hFront - 0.05, pz1 - 0.1 ), 0.05 ) );
		}
		B.add( 'woodPost', box( P.x1 - P.x0 + 0.4, 0.22, 0.22 ), M( ( P.x0 + P.x1 ) / 2, P.hFront, pz1 - 0.1 ) );
		// rafters from the wall plate to the beam, their round ends proud of the beam
		const nR = 7;
		for ( let k = 0; k < nR; k ++ ) {
			const x = P.x0 + ( P.x1 - P.x0 ) * k / ( nR - 1 );
			B.add( 'woodPost', beam( V( x, P.hBack + 0.05, b.z1 ), V( x, P.hFront + 0.2, pz1 + ( detail >= 2 ? 0.25 : 0 ) ), 0.075, 8 ) );
			// round rafter ends proud of the front beam (ref_1: a row of seven knobs)
			if ( detail >= 2 ) B.add( 'wood', new THREE.CylinderGeometry( 0.11, 0.11, 0.1, 12 ).rotateX( Math.PI / 2 ), M( x, P.hFront + 0.2, pz1 + 0.27 ) );
		}
		// plank roof: one pitch from the wall to past the beam
		const nB = detail >= 2 ? 16 : 1;
		const len = Math.hypot( P.depth + 0.5, P.hBack - P.hFront );
		const tilt = Math.atan2( P.hBack - P.hFront, P.depth + 0.5 );
		for ( let k = 0; k < nB; k ++ ) {
			const w = ( P.x1 - P.x0 + 0.6 ) / nB;
			const x = P.x0 - 0.3 + w * ( k + 0.5 );
			// tilted down toward the front, resting on the rafters
			const g = box( w * 0.96, 0.05, len ).applyMatrix4( new THREE.Matrix4().makeRotationX( tilt ) );
			B.add( 'wood', g, M( x, ( P.hBack + P.hFront ) / 2 + 0.17, b.z1 + ( P.depth + 0.5 ) / 2 ) );
		}
	}
	// props under the porch
	if ( detail >= 2 ) {
		oxCart( B, P.x0 + 1.4, 0, b.z1 + 1.0, 1.35 );
		for ( const [ x, z ] of [ [ P.x1 - 0.55, b.z1 + 0.55 ], [ P.x1 - 1.1, b.z1 + 0.5 ] ] ) {
			B.add( 'wood', new THREE.CylinderGeometry( 0.32, 0.32, 0.8, 12 ).translate( 0, 0.4, 0 ), M( x, 0, z ) );
			for ( const yy of [ 0.15, 0.65 ] ) B.add( 'woodPost', new THREE.TorusGeometry( 0.33, 0.025, 4, 16 ).rotateX( Math.PI / 2 ), M( x, yy, z ) );
		}
		basket( B, P.x0 - 0.2, 0, b.z1 + 0.5, 1.1 );
		jar( B, P.x0 + 0.3, 0, pz1 + 0.15 );
		woodpile( B, b.x0 - 0.6, 0, b.z0 + 1.2, Math.PI / 2, 8 );
	}

	// ---------------------------------------------------------------- shelter
	const Sh = H.shelter;
	if ( detail === 0 ) {
		B.add( 'stone', new THREE.CylinderGeometry( Sh.r, Sh.r, Sh.wallH, 24 ).translate( 0, Sh.wallH / 2, 0 ), M( Sh.x, 0, Sh.z ) );
	} else {
		// the open side faces south-west, toward the front of the house (ref_1); the oven sits at the back
		const open = Math.PI * 0.75, back = open + Math.PI;
		B.add( 'stone', ringWall( Sh.r, Sh.wallH, 0.45, { door: open, doorW: 2.0, seg: 30, batter: 0.03 } ), M( Sh.x, 0, Sh.z ) );
		for ( let k = 0; k < 6; k ++ ) {
			const a = open + 0.55 + k / 5 * ( Math.PI * 2 - 1.1 );
			B.add( 'woodPost', post( 0.1, Sh.postH + 0.1 ), M( Sh.x + Math.cos( a ) * ( Sh.r - 0.22 ), Sh.wallH - 0.1, Sh.z + Math.sin( a ) * ( Sh.r - 0.22 ) ) );
		}
		// bread oven: a low dome with a dark mouth toward the opening, and a glow
		const ox = Sh.x + Math.cos( back ) * 0.5, oz = Sh.z + Math.sin( back ) * 0.5;
		const mx = ox + Math.cos( open ) * 0.6, mz = oz + Math.sin( open ) * 0.6;
		B.add( 'stoneDark', new THREE.SphereGeometry( 0.7, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2 ).scale( 0.85, 0.75, 0.85 ), M( ox, 0, oz ) );
		B.add( 'doorway', new THREE.CircleGeometry( 0.22, 12, 0, Math.PI ), M( mx, 0.02, mz, Math.PI / 2 - open ) );
		if ( detail >= 2 ) B.add( 'ember', new THREE.SphereGeometry( 0.16, 8, 6 ).scale( 1, 0.5, 1 ), M( mx + Math.cos( open ) * 0.1, 0.05, mz + Math.sin( open ) * 0.1 ) );
	}
	const shTop = Sh.wallH + Sh.postH;
	// the shelter cone in courses (ref_1 / ref_3: 5-6 visible rings)
	B.add( 'thatch', coneCourses( Sh.r + 0.65, shTop - 0.35, shTop + 1.25, { courses: detail >= 2 ? 6 : 0, lip: 0.1, rag: 0.1, thick: 0.3, seg: 36 } ), M( Sh.x, 0, Sh.z ) );
	return target;
}

// Smooth 0..1 wobble of a world position, per course: the same on both sides of a shared edge
// (hip line), so the courses of the two faces meet.
const wob = ( x, z, k ) => 0.5 + 0.25 * Math.sin( x * 1.7 + z * 2.3 + k * 1.3 ) + 0.25 * Math.sin( x * 4.1 - z * 3.7 + k * 2.9 );
const lerp3 = ( a, b, t ) => [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t ];

// One thatch face A-B (eave) to D-C (top; D = C for a hip triangle), counter-clockwise from
// outside, laid in `courses` bands. Each band's lower edge is lifted (vertically, so the bands of
// two faces still meet on a hip) by a wobbling lip, which leaves a small riser facing down the
// slope: the stepped courses of the references. The lowest edge also sags unevenly (ragged eave).
function thatchFace( s, A, B, C, D, { courses = 0, lip = 0.12, rag = 0.1, slant = 1 } = {} ) {
	const n = Math.max( 1, courses ), eaveL = Math.hypot( B[ 0 ] - A[ 0 ], B[ 2 ] - A[ 2 ] );
	const m = Math.max( 1, Math.ceil( eaveL / 0.4 ) );
	const P = ( u, t ) => lerp3( lerp3( A, B, u ), lerp3( D, C, u ), t );
	const lifted = ( u, k ) => {
		const p = P( u, k / n );
		if ( ! courses ) return p;
		const w = wob( p[ 0 ], p[ 2 ], k );
		return [ p[ 0 ], p[ 1 ] + lip * ( 0.6 + 0.8 * w ) - ( k === 0 ? rag * w : 0 ), p[ 2 ] ];
	};
	for ( let k = 0; k < n; k ++ ) {
		for ( let j = 0; j < m; j ++ ) {
			const u0 = j / m, u1 = ( j + 1 ) / m, v0 = k / n * slant, v1 = ( k + 1 ) / n * slant;
			const l0 = lifted( u0, k ), l1 = lifted( u1, k ), h0 = P( u0, ( k + 1 ) / n ), h1 = P( u1, ( k + 1 ) / n );
			s.quad( l0, l1, h1, h0, [ u0 * eaveL, v0 ], [ u1 * eaveL, v0 ], [ u1 * eaveL, v1 ], [ u0 * eaveL, v1 ] );
			if ( courses ) {
				// riser between the flush top of the band below and this band's lifted edge
				const f0 = P( u0, k / n ), f1 = P( u1, k / n );
				s.quad( f0, f1, l1, l0, [ u0 * eaveL, v0 - lip ], [ u1 * eaveL, v0 - lip ], [ u1 * eaveL, v0 ], [ u0 * eaveL, v0 ] );
			}
		}
	}
}

// Thatch roof with the ridge along x: a gable at the west end (x0) and a hip at the east end (x1),
// over a footprint of width w (z) centred on z = 0; eave edge at y0, ridge at y0 + rise (both at
// the outer edge of the overhang). Upper faces (in courses when opts.courses), eave/rake thickness
// strips and an underside.
function hipGableRoof( x0, x1, w, y0, rise, over, thick, opts = {} ) {
	const s = new Soup();
	const hw = w / 2 + over, xW = x0 - over * 0.8, xE = x1 + over, xR = xE - hw, top = y0 + rise;
	const slant = Math.hypot( hw, rise );
	const down = ( p ) => [ p[ 0 ], p[ 1 ] - thick, p[ 2 ] ];
	const faces = [
		[ [ xW, y0, hw ], [ xE, y0, hw ], [ xR, top, 0 ], [ xW, top, 0 ] ],    // south slope
		[ [ xE, y0, - hw ], [ xW, y0, - hw ], [ xW, top, 0 ], [ xR, top, 0 ] ], // north slope
		[ [ xE, y0, hw ], [ xE, y0, - hw ], [ xR, top, 0 ], [ xR, top, 0 ] ]    // east hip (triangle)
	];
	for ( const [ a, b, c, d ] of faces ) {
		thatchFace( s, a, b, c, d, { ...opts, slant } );
		// underside
		s.quad( down( d ), down( c ), down( b ), down( a ), [ 0, slant ], [ 1, slant ], [ 1, 0 ], [ 0, 0 ] );
	}
	// eave strips (south, north, east) and the two west rakes, facing out
	const strip = ( a, b ) => s.quad( down( a ), down( b ), b, a, [ 0, - thick ], [ 1, - thick ], [ 1, 0 ], [ 0, 0 ] );
	strip( [ xW, y0, hw ], [ xE, y0, hw ] );
	strip( [ xE, y0, - hw ], [ xW, y0, - hw ] );
	strip( [ xE, y0, hw ], [ xE, y0, - hw ] );
	strip( [ xW, top, 0 ], [ xW, y0, hw ] );
	strip( [ xW, y0, - hw ], [ xW, top, 0 ] );
	return s.geometry();
}

// Small gabled thatch roof with the ridge along z (the door hood): footprint w (x) by l (z) centred on
// the origin, eave edge at y0, ridge at y0 + rise; faces in courses when opts.courses.
function gableHood( w, l, y0, rise, over, thick, opts = {} ) {
	const s = new Soup();
	const hw = w / 2 + over, hl = l / 2 + over * 0.8, top = y0 + rise, slant = Math.hypot( hw, rise );
	const down = ( p ) => [ p[ 0 ], p[ 1 ] - thick, p[ 2 ] ];
	const faces = [
		[ [ hw, y0, hl ], [ hw, y0, - hl ], [ 0, top, - hl ], [ 0, top, hl ] ],   // east slope
		[ [ - hw, y0, - hl ], [ - hw, y0, hl ], [ 0, top, hl ], [ 0, top, - hl ] ] // west slope
	];
	for ( const [ a, b, c, d ] of faces ) {
		thatchFace( s, a, b, c, d, { ...opts, slant } );
		s.quad( down( d ), down( c ), down( b ), down( a ), [ 0, slant ], [ 1, slant ], [ 1, 0 ], [ 0, 0 ] );
	}
	const strip = ( a, b ) => s.quad( down( a ), down( b ), b, a, [ 0, - thick ], [ 1, - thick ], [ 1, 0 ], [ 0, 0 ] );
	strip( [ hw, y0, - hl ], [ hw, y0, hl ] );
	strip( [ - hw, y0, hl ], [ - hw, y0, - hl ] );
	strip( [ - hw, y0, hl ], [ 0, top, hl ] );  // front rakes
	strip( [ 0, top, hl ], [ hw, y0, hl ] );
	return s.geometry();
}

// Conical thatch in courses (shelter, tower tiers): eave radius R at y0 to the apex at y1, the same
// banding as thatchFace around the cone, a thick eave and an underside.
function coneCourses( R, y0, y1, { courses = 0, lip = 0.1, rag = 0.08, thick = 0.28, seg = 40, phase = 0 } = {} ) {
	const s = new Soup();
	const n = Math.max( 1, courses ), slant = Math.hypot( R, y1 - y0 );
	const P = ( a, t ) => [ Math.cos( a ) * R * ( 1 - t ), y0 + ( y1 - y0 ) * t, Math.sin( a ) * R * ( 1 - t ) ];
	const wa = ( a, k ) => 0.5 + 0.25 * Math.sin( a * 5 + k * 1.3 + phase ) + 0.25 * Math.sin( a * 11 - k * 2.1 + phase * 2 );
	const lifted = ( a, k ) => {
		const p = P( a, k / n );
		if ( ! courses ) return p;
		const w = wa( a, k );
		return [ p[ 0 ], p[ 1 ] + lip * ( 0.6 + 0.8 * w ) - ( k === 0 ? rag * w : 0 ), p[ 2 ] ];
	};
	for ( let i = 0; i < seg; i ++ ) {
		const a0 = i / seg * Math.PI * 2, a1 = ( i + 1 ) / seg * Math.PI * 2;
		for ( let k = 0; k < n; k ++ ) {
			const v0 = k / n * slant, v1 = ( k + 1 ) / n * slant;
			const l0 = lifted( a0, k ), l1 = lifted( a1, k ), h0 = P( a0, ( k + 1 ) / n ), h1 = P( a1, ( k + 1 ) / n );
			s.quad( l1, l0, h0, h1, [ a1 * R, v0 ], [ a0 * R, v0 ], [ a0 * R, v1 ], [ a1 * R, v1 ] );
			if ( courses ) {
				const f0 = P( a0, k / n ), f1 = P( a1, k / n );
				s.quad( f1, f0, l0, l1, [ a1 * R, v0 - lip ], [ a0 * R, v0 - lip ], [ a0 * R, v0 ], [ a1 * R, v0 ] );
			}
		}
		// eave thickness and the underside
		const e0 = lifted( a0, 0 ), e1 = lifted( a1, 0 );
		const b0 = [ e0[ 0 ], e0[ 1 ] - thick, e0[ 2 ] ], b1 = [ e1[ 0 ], e1[ 1 ] - thick, e1[ 2 ] ];
		s.quad( e1, b1, b0, e0, [ a1 * R, 0 ], [ a1 * R, - thick ], [ a0 * R, - thick ], [ a0 * R, 0 ] );
		const t0 = P( a0, 1 ), u0 = [ t0[ 0 ], t0[ 1 ] - thick, t0[ 2 ] ];
		s.tri( b1, u0, b0, [ 0, 0 ], [ 0.5, 1 ], [ 1, 0 ] );
	}
	return s.geometry();
}

// helper: everything as one GeoBuilder (review page, village)
export function castroHouseGeometry( opts ) {
	return buildCastroHouse( new GeoBuilder(), opts );
}
