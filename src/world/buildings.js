import * as THREE from 'three/webgpu';
import { GeoBuilder, box, post, beam, ringWall, coneRoof, gableRoof, gableWall, canopy, bunting, straightWall } from '../core/builder.js';
import { mulberry32 } from '../core/noise.js';
import { BUILDINGS, STALLS, WALLS, FIELDS, VILLAGE, PROPS, PATHS, FORT, footprintR, HAMLETS } from './layout.js';
import { buildCastroHouse, CASTRO_HOUSE } from './castroHouse.js';
import { entranceGate, rusticArch, entranceFootprint } from './gate.js';

const V = ( x, y, z ) => new THREE.Vector3( x, y, z );
const M = ( x, y, z, ry = 0, s = 1 ) => new THREE.Matrix4().compose( V( x, y, z ), new THREE.Quaternion().setFromAxisAngle( V( 0, 1, 0 ), ry ), V( s, s, s ) );

// Door faces the village centre (with a little randomness).
// A moved house keeps the door it was built with (b.door, written by the object editor).
function doorAngle( b ) {
	if ( Number.isFinite( b.door ) ) return b.door;
	return Math.atan2( VILLAGE.z - b.z, VILLAGE.x - b.x ) + ( mulberry32( b.seed )() - 0.5 ) * 0.6;
}

// ------------------------------------------------------------------ props
function woodpile( B, x, y, z, ry, n = 8 ) {
	const L = new GeoBuilder();
	for ( let row = 0; row < 3; row ++ ) for ( let k = 0; k < n - row; k ++ ) {
		const xx = ( k - ( n - row ) / 2 ) * 0.2 + row * 0.1;
		L.add( 'woodPost', beam( V( xx, 0.1 + row * 0.18, - 0.6 ), V( xx, 0.1 + row * 0.18, 0.6 ), 0.09, 5 ) );
	}
	for ( const [ k, g ] of L.build() ) B.add( k, g, M( x, y, z, ry ) );
}

function quern( B, x, y, z ) {
	B.add( 'stoneDark', new THREE.CylinderGeometry( 0.26, 0.28, 0.12, 12 ).translate( 0, 0.06, 0 ), M( x, y, z ) );
	B.add( 'stone', new THREE.CylinderGeometry( 0.24, 0.25, 0.12, 12 ).translate( 0, 0.18, 0 ), M( x, y, z ) );
	B.add( 'woodPost', post( 0.02, 0.18 ), M( x + 0.16, y + 0.22, z ) );
}

function basket( B, x, y, z, s = 1 ) {
	B.add( 'wattle', new THREE.CylinderGeometry( 0.28 * s, 0.2 * s, 0.38 * s, 10, 1, true ).translate( 0, 0.19 * s, 0 ), M( x, y, z ) );
	B.add( 'wattle', new THREE.CylinderGeometry( 0.2 * s, 0.2 * s, 0.02, 10 ).translate( 0, 0.02, 0 ), M( x, y, z ) );
}

function jar( B, x, y, z ) {
	const g = new THREE.LatheGeometry( [ [ 0.001, 0 ], [ 0.14, 0.02 ], [ 0.2, 0.18 ], [ 0.17, 0.36 ], [ 0.09, 0.44 ], [ 0.1, 0.5 ] ].map( ( [ a, b ] ) => new THREE.Vector2( a, b ) ), 12 );
	B.add( 'daub', g, M( x, y, z ) );
}

function haystack( B, x, y, z, r = 1.2 ) {
	B.add( 'thatch', coneRoof( r, y + 0.8, y + 2.6, { seg: 18, rings: 4, sag: - 0.3, thick: 0.8 } ), M( x, 0, z ) );
	B.add( 'thatch', ringWall( r * 0.98, 0.85, 0.2, { seg: 18, batter: - 0.05 } ), M( x, y - 0.05, z ) );
	B.add( 'woodPost', post( 0.05, 3.1 ), M( x, y, z ) );
}

function skep( B, x, y, z ) {
	B.add( 'woodPost', box( 0.6, 0.45, 0.6 ), M( x, y, z ) );
	B.add( 'thatch', coneRoof( 0.3, y + 0.45, y + 0.9, { seg: 12, rings: 3, sag: - 0.6, thick: 0.05 } ), M( x, 0, z ) );
}

function well( B, x, y, z ) {
	B.add( 'stone', ringWall( 0.85, 0.8, 0.32, { seg: 18, batter: 0 } ), M( x, y - 0.1, z ) );
	B.add( 'doorway', new THREE.CircleGeometry( 0.55, 16 ).rotateX( - Math.PI / 2 ), M( x, y + 0.2, z ) );
	for ( const s of [ - 1, 1 ] ) B.add( 'woodPost', post( 0.07, 2.0 ), M( x + s * 0.8, y, z ) );
	B.add( 'woodPost', beam( V( x - 0.9, y + 1.85, z ), V( x + 0.9, y + 1.85, z ), 0.07 ) );
	B.add( 'woodPost', post( 0.01, 1.2 ), M( x, y + 0.65, z ) );
	B.add( 'wood', post( 0.14, 0.26 ), M( x, y + 0.45, z ) );
}

function oxCart( B, x, y, z, ry ) {
	const L = new GeoBuilder();
	L.add( 'wood', box( 1.4, 0.12, 2.4 ), M( 0, 0.75, 0 ) );
	for ( const s of [ - 1, 1 ] ) {
		L.add( 'wood', box( 0.08, 0.35, 2.4 ), M( s * 0.66, 0.85, 0 ) );
		const w = new THREE.CylinderGeometry( 0.52, 0.52, 0.12, 14 ).rotateZ( Math.PI / 2 );
		L.add( 'wood', w, M( s * 0.82, 0.52, 0.1 ) );
		L.add( 'woodPost', beam( V( s * 0.3, 0.72, 1.1 ), V( s * 0.22, 0.45, 3.2 ), 0.06 ) );
	}
	L.add( 'woodPost', beam( V( - 0.9, 0.52, 0.1 ), V( 0.9, 0.52, 0.1 ), 0.06 ) );
	L.add( 'thatch', box( 1.1, 0.5, 1.6 ), M( 0, 0.95, - 0.2 ) );
	for ( const [ k, g ] of L.build() ) B.add( k, g, M( x, y, z, ry ) );
}

function dryingRack( B, x, y, z, ry ) {
	const L = new GeoBuilder();
	for ( const zz of [ - 1.6, 1.6 ] ) {
		L.add( 'woodPost', beam( V( - 0.7, 0, zz ), V( 0, 2.0, zz ), 0.06 ) );
		L.add( 'woodPost', beam( V( 0.7, 0, zz ), V( 0, 2.0, zz ), 0.06 ) );
	}
	L.add( 'woodPost', beam( V( 0, 1.95, - 1.8 ), V( 0, 1.95, 1.8 ), 0.05 ) );
	for ( let k = 0; k < 7; k ++ ) L.add( k % 2 ? 'canvas' : 'daub', box( 0.05, 0.7, 0.35 ), M( 0, 1.2, - 1.3 + k * 0.43 ) );
	for ( const [ k, g ] of L.build() ) B.add( k, g, M( x, y, z, ry ) );
}

// Wattle fence: stakes every 0.45 m with woven panels between them.
function fence( B, hf, pts, h = 1.05 ) {
	for ( let i = 1; i < pts.length; i ++ ) {
		const a = pts[ i - 1 ], b = pts[ i ];
		const L = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		const n = Math.max( 1, Math.round( L / 1.8 ) );
		for ( let k = 0; k < n; k ++ ) {
			const t0 = k / n, t1 = ( k + 1 ) / n;
			const x0 = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t0, z0 = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t0;
			const x1 = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t1, z1 = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t1;
			const y0 = hf.heightAt( x0, z0 ), y1 = hf.heightAt( x1, z1 );
			const len = Math.hypot( x1 - x0, z1 - z0 );
			const ry = - Math.atan2( z1 - z0, x1 - x0 );
			const mx = ( x0 + x1 ) / 2, mz = ( z0 + z1 ) / 2, my = Math.min( y0, y1 ) - 0.1;
			const panel = box( len, h - 0.12, 0.07 );
			panel.rotateZ( Math.atan2( y1 - y0, len ) );
			B.add( 'wattle', panel, M( mx, my + 0.05, mz, ry ) );
			for ( let s = 0; s < 4; s ++ ) {
				const t = s / 4;
				const sx = x0 + ( x1 - x0 ) * t, sz = z0 + ( z1 - z0 ) * t;
				B.add( 'woodPost', post( 0.035, h + 0.2 ), M( sx, hf.heightAt( sx, sz ) - 0.2, sz ) );
			}
		}
	}
}

function pen( B, hf, x, z, w, d, rot ) {
	const c = Math.cos( rot ), s = Math.sin( rot );
	const P = ( u, v ) => [ x + u * c - v * s, z + u * s + v * c ];
	fence( B, hf, [ P( - w / 2, - d / 2 ), P( w / 2, - d / 2 ), P( w / 2, d / 2 ), P( - w / 2 + 1.4, d / 2 ) ] );
	fence( B, hf, [ P( - w / 2, d / 2 ), P( - w / 2, - d / 2 ) ] );
}

// Red cloth lean-to against a house wall (both refs: dyed sheets on poles beside the houses). In its
// own frame the high edge (+z) meets the wall and two poles hold the low front edge; red, or undyed.
function awning( B, hf, x, z, ry, w, d, yBack, yFront, red = true ) {
	const L = new GeoBuilder();
	L.add( red ? 'cloth' : 'canvas', canopy( w, d, yFront, yBack, 0.16 ) );
	const c = Math.cos( ry ), s = Math.sin( ry );
	for ( const k of [ - 1, 1 ] ) {
		const lx = k * ( w / 2 - 0.15 ), lz = - d / 2 + 0.1;
		const g = hf.heightAt( x + lx * c + lz * s, z - lx * s + lz * c );
		L.add( 'woodPost', post( 0.05, yFront - g + 0.45 ), M( lx, g - 0.3, lz ) );
	}
	for ( const [ k, g ] of L.build() ) B.add( k, g, M( x, 0, z, ry ) );
}

// a house's awning (layout: awning: true): on a round house beside the door, on a long house along
// the back wall (the door is on the +x side); heights from the ground at the house
function houseAwning( B, b, y, hf, rnd ) {
	const red = rnd() < 0.8;
	if ( b.type === 'round' ) {
		const a = doorAngle( b ) - 1.25, ca = Math.cos( a ), sa = Math.sin( a );
		const w = 3.0 + rnd() * 0.8, d = 2.4 + rnd() * 0.5, rr = b.r + 0.7 + d / 2;
		// the high edge toward the house: the frame's +z is - ( ca, sa )
		awning( B, hf, b.x + ca * rr, b.z + sa * rr, Math.atan2( - ca, - sa ), w, d, y + 2.0, y + 1.7, red );
	} else if ( b.type === 'long' ) {
		const c = Math.cos( b.rot ), s = Math.sin( b.rot );
		const W = ( u, v ) => [ b.x + u * c + v * s, b.z - u * s + v * c ];
		const w = b.l * ( 0.4 + rnd() * 0.15 ), d = 2.6 + rnd() * 0.5;
		const [ x, z ] = W( - b.w / 2 - 0.7 - d / 2, ( rnd() - 0.5 ) * ( b.l - w ) * 0.6 );
		// the frame's +z is the house's +u (toward the wall)
		awning( B, hf, x, z, b.rot + Math.PI / 2, w, d, y + 2.25, y + 1.85, red );
	}
}

// ----------------------------------------------------------- village lanes
// The lanes near the village (the third reference, ref/ref_lanes.png: a stepped path between stone
// edges, rope-tied rail fences, a lamp post with a hanging lantern): wattle and rail fences along both
// sides, lamp posts, log steps where the lane climbs and loose stones along its edges. All laid from
// PATHS and kept clear of houses, awnings, stalls, props, walls, the fort and the other lanes.
const LANE_NEAR = 88; // fences and lamps this close to the village centre
const LANE_FAR = 220; // steps and edge stones out to here (the tracks up the hill)
const segD = ( x, z, a, b ) => {
	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
	const t = Math.max( 0, Math.min( 1, ( ( x - a[ 0 ] ) * dx + ( z - a[ 1 ] ) * dz ) / ( dx * dx + dz * dz ) ) );
	return Math.hypot( a[ 0 ] + dx * t - x, a[ 1 ] + dz * t - z );
};
const laneSegs = () => {
	const segs = [];
	PATHS.forEach( ( p, pi ) => { for ( let i = 1; i < p.pts.length; i ++ ) segs.push( { pi, a: p.pts[ i - 1 ], b: p.pts[ i ], w: p.w } ); } );
	return segs;
};
// free ground beside lane pi: near the village and off everything else (extra: [ x, z, r ] to avoid)
// the rivers and lakes of the terrain editor (set by createBuildings): no fence, lamp, step or stone in
// their water (a lane running beside or into a river; the bridges carry a path over one, world/bridges.js)
let inWater = () => false;
function laneFree( x, z, pi, segs, extra = [], near = LANE_NEAR ) {
	if ( inWater( x, z ) ) return false;
	// near the village, or inside a hamlet (layout.js HAMLETS)
	if ( Math.hypot( x - VILLAGE.x, z - VILLAGE.z ) > near && ! HAMLETS.some( ( h ) => Math.hypot( x - h.x, z - h.z ) < h.r ) ) return false;
	for ( const b of BUILDINGS ) if ( Math.hypot( x - b.x, z - b.z ) < footprintR( b, 0.7 ) + ( b.awning ? 4.2 : 1.5 ) ) return false;
	for ( const s of STALLS ) if ( ! s.removed && Math.hypot( x - s[ 0 ], z - s[ 1 ] ) < 4.2 ) return false;
	for ( const p of PROPS ) if ( Math.hypot( x - p.x, z - p.z ) < ( p.type === 'pen' ? 5 : 2.5 ) ) return false;
	for ( const p of PROPS ) if ( ( p.type === 'gate' || p.type === 'arch' ) && ! p.removed && entranceFootprint( p ).some( ( [ gx, gz ] ) => Math.hypot( x - gx, z - gz ) < 2.2 ) ) return false;
	if ( Math.hypot( x - FORT.x, z - FORT.z ) < FORT.radius + 4 ) return false;
	for ( const w of WALLS ) for ( let i = 1; i < w.length; i ++ ) if ( segD( x, z, w[ i - 1 ], w[ i ] ) < 2 ) return false;
	for ( const s of segs ) if ( s.pi !== pi && segD( x, z, s.a, s.b ) < s.w * 0.6 + 1.4 ) return false;
	for ( const [ ex, ez, r ] of extra ) if ( Math.hypot( x - ex, z - ez ) < r ) return false;
	return true;
}
// calls fn( x, z, nx, nz, tx, tz ) every `step` m along lane p (n: the unit normal to its left, t: along)
function walkLane( p, step, fn ) {
	let carry = 0;
	for ( let i = 1; i < p.pts.length; i ++ ) {
		const [ ax, az ] = p.pts[ i - 1 ], [ bx, bz ] = p.pts[ i ];
		const L = Math.hypot( bx - ax, bz - az ), tx = ( bx - ax ) / L, tz = ( bz - az ) / L;
		let t = carry;
		for ( ; t < L; t += step ) fn( ax + tx * t, az + tz * t, - tz, tx, tx, tz );
		carry = t - L;
	}
}

// Rail fence (the third reference): leaning stakes, two rails, red rope lashings at the joints.
function railFence( B, hf, pts, seed ) {
	const rnd = mulberry32( seed );
	const tops = [];
	for ( const [ x, z ] of pts ) {
		const g = hf.heightAt( x, z ), lx = ( rnd() - 0.5 ) * 0.12, lz = ( rnd() - 0.5 ) * 0.12;
		B.add( 'woodPost', beam( V( x, g - 0.3, z ), V( x + lx, g + 1.15 + rnd() * 0.15, z + lz ), 0.055, 6 ) );
		tops.push( [ x + lx * 0.7, g, z + lz * 0.7 ] );
	}
	for ( let i = 1; i < tops.length; i ++ ) {
		const [ x0, g0, z0 ] = tops[ i - 1 ], [ x1, g1, z1 ] = tops[ i ];
		for ( const h of [ 0.45, 0.95 ] ) {
			const j = ( rnd() - 0.5 ) * 0.08;
			B.add( 'woodPost', beam( V( x0, g0 + h + j, z0 ), V( x1, g1 + h - j, z1 ), 0.035, 5 ) );
		}
	}
	for ( const [ x, g, z ] of tops ) for ( const h of [ 0.45, 0.95 ] ) if ( rnd() < 0.7 ) B.add( 'cloth', box( 0.13, 0.1, 0.13 ), M( x, g + h - 0.05, z, rnd() ) );
}

// Lamp post: a squared post, an arm over the lane with a brace and a lantern hanging from it, its
// glass lit with the embers' glow (no light source: the glow and the bloom do it).
function lampPost( B, hf, x, z, ax, az ) {
	const g = hf.heightAt( x, z ), H = 3.2;
	B.add( 'woodPost', box( 0.16, H + 0.45, 0.16 ), M( x, g - 0.45, z, Math.atan2( ax, az ) ) );
	const ex = x + ax * 1.05, ez = z + az * 1.05, top = g + H - 0.12;
	B.add( 'woodPost', beam( V( x - ax * 0.12, top, z - az * 0.12 ), V( ex + ax * 0.08, top, ez + az * 0.08 ), 0.06, 6 ) );
	B.add( 'woodPost', beam( V( x + ax * 0.06, top - 0.75, z + az * 0.06 ), V( x + ax * 0.62, top - 0.04, z + az * 0.62 ), 0.035, 5 ) );
	// hook, then the lantern: cap, four corner bars, glass, base
	const ly = top - 0.78;
	B.add( 'woodPost', beam( V( ex, top, ez ), V( ex, ly + 0.42, ez ), 0.012, 4 ) );
	B.add( 'woodPost', coneRoof( 0.17, ly + 0.36, ly + 0.48, { seg: 4, rings: 1, thick: 0.03 } ), M( ex, 0, ez, Math.PI / 4 ) );
	for ( const [ u, v ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] ) B.add( 'woodPost', box( 0.025, 0.34, 0.025 ), M( ex + u * 0.085, ly + 0.02, ez + v * 0.085 ) );
	B.add( 'ember', box( 0.15, 0.27, 0.15 ), M( ex, ly + 0.05, ez ) );
	B.add( 'woodPost', box( 0.22, 0.04, 0.22 ), M( ex, ly, ez ) );
}

function villageLanes( B, hf ) {
	const segs = laneSegs();
	const rnd = mulberry32( 5150 );
	// lamp posts every ~24 m, sides alternating, the arm over the lane
	const lamps = [];
	PATHS.forEach( ( p, pi ) => {
		let side = 1, next = 6;
		walkLane( p, 2, ( x, z, nx, nz ) => {
			if ( ( next -= 2 ) > 0 ) return;
			const o = p.w * 0.6 + 0.9, lx = x + nx * o * side, lz = z + nz * o * side;
			if ( ! laneFree( lx, lz, pi, segs, lamps ) ) return;
			lampPost( B, hf, lx, lz, - nx * side, - nz * side );
			lamps.push( [ lx, lz, 9 ] );
			side = - side; next = 20 + rnd() * 8;
		} );
	} );
	const nearLamp = lamps.map( ( [ x, z ] ) => [ x, z, 1.3 ] );
	// fences: both sides, runs of 4-12 m with gaps; wattle or rope-tied rails
	PATHS.forEach( ( p, pi ) => {
		for ( const side of [ - 1, 1 ] ) {
			const pts = [];
			walkLane( p, 1.8, ( x, z, nx, nz ) => { const o = p.w * 0.6 + 0.9; pts.push( [ x + nx * o * side, z + nz * o * side ] ); } );
			let run = [], left = 4 + rnd() * 8, gap = 0;
			const flush = () => {
				if ( run.length >= 3 ) { if ( rnd() < 0.5 ) fence( B, hf, run ); else railFence( B, hf, run, Math.floor( rnd() * 1e6 ) ); }
				run = [];
			};
			for ( const q of pts ) {
				if ( gap > 0 ) { gap -= 1.8; flush(); continue; }
				if ( ! laneFree( q[ 0 ], q[ 1 ], pi, segs, nearLamp ) ) { flush(); continue; }
				run.push( q );
				left -= 1.8;
				if ( left <= 0 ) { flush(); gap = 2 + rnd() * 5; left = 4 + rnd() * 8; }
			}
			flush();
		}
	} );
	// log steps where the lane climbs (a riser every ~0.22 m of rise), and loose stones along the edges
	const stone = new THREE.DodecahedronGeometry( 1, 0 );
	PATHS.forEach( ( p, pi ) => {
		const own = segs.filter( ( s ) => s.pi === pi );
		let last = null;
		walkLane( p, 0.5, ( x, z, nx, nz, tx, tz ) => {
			if ( ! laneFree( x, z, pi, own, [], LANE_FAR ) ) { last = null; return; }
			const h = hf.heightAt( x, z );
			const slope = Math.abs( hf.heightAt( x + tx, z + tz ) - hf.heightAt( x - tx, z - tz ) ) / 2;
			if ( last === null ) last = h;
			if ( slope > 0.09 && Math.abs( h - last ) > 0.22 ) {
				const hw = p.w * 0.42;
				B.add( 'woodPost', beam( V( x - nx * hw, hf.heightAt( x - nx * hw, z - nz * hw ) - 0.04, z - nz * hw ), V( x + nx * hw, hf.heightAt( x + nx * hw, z + nz * hw ) - 0.04, z + nz * hw ), 0.085 + rnd() * 0.03, 6 ) );
				last = h;
			}
			// edge stones, both sides, with gaps
			for ( const side of [ - 1, 1 ] ) {
				if ( rnd() < 0.3 ) continue;
				const o = p.w * 0.5 + 0.2 + rnd() * 0.3, sx = x + nx * o * side, sz = z + nz * o * side;
				const s = 0.18 + rnd() * 0.2;
				const g = stone.clone().scale( s * ( 1 + rnd() * 0.6 ), s * ( 0.55 + rnd() * 0.3 ), s * ( 1 + rnd() * 0.4 ) ).rotateY( rnd() * 6.3 );
				B.add( 'stoneDark', g, M( sx, hf.heightAt( sx, sz ) - s * 0.15, sz ) );
			}
		} );
	} );
}

// ----------------------------------------------------------- round house
// Proportions from the castro reconstructions (and tools/houses.mjs): about 1.8 m of stone wall in
// sight under a thick, ragged thatch eave that overhangs ~0.6 m, a ~40-44 degree cone above it.
const ROUND = { visible: 1.8, over: 0.62, thick: 0.5 };

function roundHouse( B, b, y, rnd, hf ) {
	const r = b.r, t = 0.55;
	const pitch = Math.tan( ( 40 + rnd() * 4 ) * Math.PI / 180 );
	// the wall rises behind the eave: its top meets the roof cone inside the thatch
	const h = 0.4 + ROUND.visible + ROUND.thick + ROUND.over * pitch - 0.05 + r * 0.02;
	const base = y - 0.4, wallTop = base + h;
	const door = doorAngle( b );
	const jit = ( a ) => 0.05 * Math.sin( a * 7 + b.seed ) + 0.03 * Math.sin( a * 13 );
	B.add( 'stone', ringWall( r, h, t, { door, doorW: 1.1, seg: Math.round( 24 + r * 4 ), jitter: jit } ), M( b.x, base, b.z ) );
	const dx = Math.cos( door ), dz = Math.sin( door ), rotD = Math.PI / 2 - door;
	const at = ( rr, yy ) => M( b.x + dx * rr, yy, b.z + dz * rr, rotD );
	// 0.95 x 1.7 opening: lintel, stone infill above, projecting jambs, door leaf
	B.add( 'stoneDark', box( 1.6, 0.3, t + 0.12 ), at( r - t / 2, base + 1.72 ) );
	B.add( 'stone', box( 1.12, h - 2.02, t ), at( r - t / 2, base + 2.02 ) );
	for ( const s of [ - 1, 1 ] ) {
		const a = door + s * 0.62 / r;
		B.add( 'stoneDark', box( 0.34, 1.8, 0.72 ), M( b.x + Math.cos( a ) * ( r + 0.05 ), base, b.z + Math.sin( a ) * ( r + 0.05 ), rotD ) );
	}
	B.add( 'wood', box( 0.95, 1.68, 0.08 ), at( r - t + 0.12, base ) );
	B.add( 'doorway', box( 0.96, 1.7, 0.02 ), at( r - t - 0.02, base ) );
	// conical thatch resting on the wall head, slightly convex (beehive look); the eave sits at the
	// visible wall height plus its own thickness
	const R = r + ROUND.over;
	const H = R * pitch;
	const y0 = base + 0.4 + ROUND.visible + ROUND.thick + r * 0.02;
	// a ragged eave: waves of different lengths around it, fading towards the apex
	const rj = ( a, t2 ) => ( 0.13 * Math.sin( a * 5 + b.seed ) + 0.08 * Math.sin( a * 11 + 2 ) + 0.05 * Math.sin( a * 23 + b.seed * 3 ) ) * Math.pow( 1 - t2, 2 );
	B.add( b.seed % 3 === 0 ? 'thatchGreen' : 'thatch', coneRoof( R, y0, y0 + H, { seg: 44, rings: 8, sag: - 0.3, thick: ROUND.thick, jitter: rj } ), M( b.x, 0, b.z ) );
	// finial knot
	B.add( 'thatchGreen', coneRoof( 0.6, y0 + H - 0.5, y0 + H + 0.35, { seg: 10, rings: 2, thick: 0.12, sag: - 0.5 } ), M( b.x, 0, b.z ) );
	// lived-in clutter by the door
	const side = ( s, rr ) => [ b.x + Math.cos( door + s ) * rr, b.z + Math.sin( door + s ) * rr ];
	if ( rnd() < 0.7 ) { const [ wx, wz ] = side( 0.9 + rnd() * 0.5, r + 0.7 ); woodpile( B, wx, hf.heightAt( wx, wz ), wz, - door ); }
	if ( rnd() < 0.5 ) { const [ qx, qz ] = side( - 0.55, r + 1.1 ); quern( B, qx, hf.heightAt( qx, qz ) - 0.02, qz ); }
	if ( rnd() < 0.7 ) { const [ kx, kz ] = side( - 0.35, r + 0.6 ); basket( B, kx, hf.heightAt( kx, kz ), kz, 0.8 + rnd() * 0.4 ); }
	if ( rnd() < 0.5 ) { const [ jx, jz ] = side( 0.35, r + 0.55 ); jar( B, jx, hf.heightAt( jx, jz ), jz ); }
	return { smoke: V( b.x, y0 + H * 0.8, b.z ) };
}

// ----------------------------------------------------------- raised granary
function granary( B, b, y, rnd ) {
	const L = new GeoBuilder();
	for ( const [ px, pz ] of [ [ - 0.9, - 0.55 ], [ 0.9, - 0.55 ], [ - 0.9, 0.55 ], [ 0.9, 0.55 ], [ 0, - 0.55 ], [ 0, 0.55 ] ] ) {
		L.add( 'stoneDark', post( 0.15, 0.75, 6 ), M( px, y - 0.1, pz ) );
		L.add( 'stoneDark', box( 0.45, 0.1, 0.45 ), M( px, y + 0.65, pz ) );
	}
	L.add( 'wood', box( 2.3, 1.5, 1.45 ), M( 0, y + 0.75, 0 ) );
	L.add( 'thatch', gableRoof( 1.45, 2.3, y + 2.05, 1.0, { over: 0.35, thick: 0.3 } ), new THREE.Matrix4().makeRotationY( Math.PI / 2 ) );
	for ( const e of [ - 1, 1 ] ) L.add( 'wood', gableWall( 1.4, y + 2.25, 0.9, e * 1.12, e ), new THREE.Matrix4().makeRotationY( Math.PI / 2 ) );
	for ( const [ k, g ] of L.build() ) B.add( k, g, M( b.x, 0, b.z, rnd() * Math.PI ) );
}

// ----------------------------------------------------------- round store hut
function hut( B, b, y ) {
	const r = b.r;
	B.add( 'stone', ringWall( r, 1.1, 0.4, { seg: 20 } ), M( b.x, y - 0.3, b.z ) );
	// ~1.3 m of wall in sight under a 0.45 m eave
	B.add( 'daub', ringWall( r - 0.05, 1.3, 0.2, { door: doorAngle( b ), doorW: 0.8, seg: 20, batter: 0 } ), M( b.x, y + 0.8, b.z ) );
	const over = 0.45, R = r + over, H = R * 1.11;
	const top = y + 2.1;
	const rj = ( a, t2 ) => ( 0.07 * Math.sin( a * 6 + b.seed ) + 0.04 * Math.sin( a * 13 ) ) * Math.pow( 1 - t2, 2 );
	B.add( 'thatch', coneRoof( R, top - H * over / R + 0.05, top - H * over / R + 0.05 + H, { seg: 24, rings: 5, sag: - 0.3, thick: 0.35, jitter: rj } ), M( b.x, 0, b.z ) );
	// a small window beside the door with the hearth's glow behind it (the third reference)
	if ( b.window ) {
		const a = doorAngle( b ) + 1.1, ca = Math.cos( a ), sa = Math.sin( a ), rr = r + 0.06;
		B.add( 'ember', box( 0.04, 0.38, 0.46 ), M( b.x + ca * rr, y + 1.25, b.z + sa * rr, - a ) );
		B.add( 'woodPost', box( 0.1, 0.06, 0.62 ), M( b.x + ca * ( rr + 0.02 ), y + 1.19, b.z + sa * ( rr + 0.02 ), - a ) );
		B.add( 'woodPost', box( 0.1, 0.06, 0.62 ), M( b.x + ca * ( rr + 0.02 ), y + 1.63, b.z + sa * ( rr + 0.02 ), - a ) );
	}
}

// ----------------------------------------------------------- long house
function longHouse( B, b, y, rnd, hf ) {
	// ~1.8 m of wall in sight under the eave (see ROUND)
	const { w, l } = b, h = 3.15;
	const m = M( b.x, 0, b.z, b.rot );
	const local = new GeoBuilder();
	const hw = w / 2, hl = l / 2, t = 0.5, sb = 0.85;
	// 0.85 m dry-stone footing, wattle-and-daub above
	const wall = ( a, c ) => {
		local.add( 'stone', straightWall( a, c, sb, t + 0.1, y, y ) );
		local.add( 'daub', straightWall( a, c, h - sb, t - 0.1, y + sb, y + sb ) );
	};
	wall( V( hw - t / 2, 0, - hl ), V( hw - t / 2, 0, - 0.65 ) );
	wall( V( hw - t / 2, 0, 0.65 ), V( hw - t / 2, 0, hl ) );
	wall( V( - hw + t / 2, 0, - hl ), V( - hw + t / 2, 0, hl ) );
	wall( V( - hw, 0, - hl + t / 2 ), V( hw, 0, - hl + t / 2 ) );
	wall( V( - hw, 0, hl - t / 2 ), V( hw, 0, hl - t / 2 ) );
	// timber frame posts at the corners
	for ( const [ px, pz ] of [ [ - hw, - hl ], [ hw, - hl ], [ hw, hl ], [ - hw, hl ] ] ) local.add( 'woodPost', post( 0.16, h + 0.2 ), M( px * 0.98, y - 0.2, pz * 0.98 ) );
	// door (1.3 wide, 1.9 high) with lintel
	local.add( 'wood', box( 0.08, 1.9, 1.25 ), M( hw - t + 0.08, y - 0.2, 0 ) );
	local.add( 'doorway', box( 0.02, 1.95, 1.3 ), M( hw - t - 0.02, y - 0.2, 0 ) );
	local.add( 'woodPost', beam( V( hw + 0.02, y + 1.8, - 0.95 ), V( hw + 0.02, y + 1.8, 0.95 ), 0.13 ) );
	local.add( 'daub', box( t - 0.1, h - 1.9, 1.3 ), M( hw - t / 2, y + 1.9, 0 ) );
	// small windows either side of the door, most with the hearth's glow behind them (the third
	// reference); lit or dark from the seed, so the house's own random sequence is unchanged
	if ( hl > 3.2 ) for ( const e of [ - 1, 1 ] ) {
		const v = e * hl * 0.55, lit = ( ( b.seed * 7 + e + 3 ) % 5 ) < 3;
		local.add( lit ? 'ember' : 'doorway', box( 0.02, 0.42, 0.52 ), M( hw - 0.04, y + 1.2, v ) );
		local.add( 'woodPost', box( 0.1, 0.07, 0.68 ), M( hw - 0.02, y + 1.13, v ) );
		local.add( 'woodPost', box( 0.1, 0.07, 0.68 ), M( hw - 0.02, y + 1.62, v ) );
		for ( const s of [ - 1, 1 ] ) local.add( 'woodPost', box( 0.1, 0.56, 0.07 ), M( hw - 0.02, y + 1.13, v + s * 0.3 ) );
		local.add( 'woodPost', box( 0.03, 0.02, 0.52 ), M( hw - 0.035, y + 1.4, v ) ); // transom bar
	}
	// roof sits on the wall plate: eave drops below the wall head
	const rise = w * 0.55, over = 0.6; // ~48 degrees
	const y0 = y + h - over * rise / ( w / 2 ) + 0.05;
	const roofKey = rnd() < 0.4 ? 'thatchGreen' : 'thatch';
	local.add( roofKey, gableRoof( w, l, y0, rise + over * rise / ( w / 2 ), { over, thick: 0.55 } ) );
	for ( const e of [ - 1, 1 ] ) local.add( 'wood', gableWall( w - 0.2, y + h, rise * 0.95, e * ( hl - 0.1 ), e ) );
	// thatched ridge roll
	const ry = y0 + rise + over * rise / ( w / 2 );
	local.add( 'thatchGreen', beam( V( 0, ry - 0.05, - hl - 0.8 ), V( 0, ry - 0.05, hl + 0.8 ), 0.28, 8 ) );
	for ( const [ k, g ] of local.build() ) B.add( k, g, m );
	// clutter along the long wall
	const c = Math.cos( b.rot ), s = Math.sin( b.rot );
	const W = ( u, v ) => [ b.x + u * c + v * s, b.z - u * s + v * c ];
	if ( rnd() < 0.8 ) { const [ px, pz ] = W( hw + 0.9, - hl * 0.55 ); woodpile( B, px, hf.heightAt( px, pz ), pz, b.rot, 10 ); }
	if ( rnd() < 0.6 ) { const [ px, pz ] = W( hw + 0.8, hl * 0.5 ); basket( B, px, hf.heightAt( px, pz ), pz ); jar( B, px + 0.6, hf.heightAt( px, pz ), pz + 0.3 ); }
	return { smoke: V( b.x, ry - 0.3, b.z ) };
}

// ----------------------------------------------------------- lookout tower
function lookout( B, b, y, rnd ) {
	const H = 5.2, s = 1.4;
	const m = M( b.x, 0, b.z, rnd() * Math.PI );
	const L = new GeoBuilder();
	for ( const [ px, pz ] of [ [ - s, - s ], [ s, - s ], [ s, s ], [ - s, s ] ] ) {
		L.add( 'woodPost', beam( V( px * 1.12, y - 0.3, pz * 1.12 ), V( px, y + H + 1.3, pz ), 0.14 ) );
	}
	for ( const [ a, c ] of [ [ [ - s, - s ], [ s, - s ] ], [ [ s, - s ], [ s, s ] ], [ [ s, s ], [ - s, s ] ], [ [ - s, s ], [ - s, - s ] ] ] ) {
		L.add( 'woodPost', beam( V( a[ 0 ] * 1.08, y + 0.6, a[ 1 ] * 1.08 ), V( c[ 0 ], y + H - 0.6, c[ 1 ] ), 0.07 ) );
	}
	L.add( 'wood', box( s * 2.4, 0.18, s * 2.4 ), M( 0, y + H, 0 ) );
	for ( const e of [ - 1, 1 ] ) {
		L.add( 'wood', box( s * 2.3, 0.9, 0.06 ), M( 0, y + H + 0.15, e * s * 1.15 ) );
		L.add( 'wood', box( 0.06, 0.9, s * 2.3 ), M( e * s * 1.15, y + H + 0.15, 0 ) );
	}
	L.add( 'thatch', coneRoof( s * 1.9, y + H + 1.3, y + H + 3.6, { seg: 16, rings: 4, thick: 0.3 } ) );
	for ( const sx of [ - 0.3, 0.3 ] ) L.add( 'woodPost', beam( V( sx, y, s + 0.9 ), V( sx, y + H, s + 0.05 ), 0.05 ) );
	for ( let k = 1; k < 12; k ++ ) {
		const t = k / 12;
		L.add( 'woodPost', beam( V( - 0.3, y + H * t, s + 0.9 - 0.85 * t ), V( 0.3, y + H * t, s + 0.9 - 0.85 * t ), 0.03 ) );
	}
	for ( const [ k, g ] of L.build() ) B.add( k, g, m );
}

// ----------------------------------------------------------- castro house
// The composite castro house (world/castroHouse.js, ref/casa_castro), built on flat ground in its own
// frame, centred on the compound (CASTRO_HOUSE.centre) and turned by b.rot (its front, the door,
// faces local +Z). It sits at the lowest ground
// under its walls, so no wall foot floats on the slope the pad leaves (the floor sinks a little on
// the high side instead).
function castroHouse( B, b ) {
	const L = new GeoBuilder();
	buildCastroHouse( L, { seed: b.seed } );
	const c = Math.cos( b.rot || 0 ), s = Math.sin( b.rot || 0 );
	const H = CASTRO_HOUSE, hb = H.body, [ ox, oz ] = H.centre;
	// a point of the house frame in the world (the anchor b.x, b.z is the centre of the compound)
	const at = ( u, v ) => [ b.x + ( u - ox ) * c + ( v - oz ) * s, b.z - ( u - ox ) * s + ( v - oz ) * c ];
	let y = Infinity;
	for ( const [ u, v ] of [ [ hb.x0, hb.z0 ], [ hb.x0, hb.z1 ], [ hb.x1, hb.z0 ], [ hb.x1, hb.z1 ], [ H.tower.x + H.tower.r, H.tower.z ], [ H.shelter.x, H.shelter.z ], [ H.shelter.x + H.shelter.r, H.shelter.z ] ] ) {
		y = Math.min( y, B.hf.heightAt( ...at( u, v ) ) );
	}
	const m = M( b.x, y - 0.12, b.z, b.rot || 0 ).multiply( new THREE.Matrix4().makeTranslation( - ox, 0, - oz ) );
	for ( const [ k, g ] of L.build() ) B.add( k, g, m );
	// the oven fire of the shelter
	const sh = H.shelter, [ sx, sz ] = at( sh.x, sh.z );
	return { smoke: V( sx, y + sh.wallH + sh.postH + 1.6, sz ) };
}

// ----------------------------------------------------------- market stall
function stall( B, x, z, rot, y, rnd, red = true ) {
	const w = 4.0 + rnd() * 1.5, d = 2.4 + rnd() * 0.8;
	const m = M( x, 0, z, rot );
	const L = new GeoBuilder();
	const hf = 2.1, hb = 2.7;
	for ( const [ px, pz, ph ] of [ [ - w / 2, - d / 2, hf ], [ w / 2, - d / 2, hf ], [ w / 2, d / 2, hb ], [ - w / 2, d / 2, hb ], [ 0, d / 2, hb + 0.3 ] ] ) {
		L.add( 'woodPost', post( 0.07, ph + 0.15 ), M( px, y - 0.1, pz ) );
	}
	L.add( red ? 'cloth' : 'canvas', canopy( w + 0.5, d + 0.5, y + hf, y + hb, 0.22 ) );
	L.add( 'wood', box( w * 0.85, 0.85, 0.7 ), M( 0, y - 0.05, - d / 2 + 0.45 ) );
	for ( let k = 0; k < 6; k ++ ) {
		const gx = ( rnd() - 0.5 ) * w * 0.75;
		const kind = rnd();
		if ( kind < 0.35 ) basket( L, gx, y + 0.8, - d / 2 + 0.45, 0.6 );
		else if ( kind < 0.6 ) jar( L, gx, y + 0.8, - d / 2 + 0.45 );
		else L.add( rnd() < 0.5 ? 'canvas' : 'wood', box( 0.35 + rnd() * 0.3, 0.25 + rnd() * 0.25, 0.35 ), M( gx, y + 0.8, - d / 2 + 0.45, rnd() ) );
	}
	// sacks and crates behind
	for ( let k = 0; k < 3; k ++ ) L.add( k % 2 ? 'canvas' : 'wood', box( 0.5, 0.5, 0.5 ), M( ( rnd() - 0.5 ) * w * 0.6, y - 0.05, d / 2 - 0.4, rnd() ) );
	for ( const [ k, g ] of L.build() ) B.add( k, g, m );
}

// The village objects of the layout, one at a time. Each one is built into its own GeoBuilder and
// moved by its edit (world/worldEdits.js: yaw and uniform scale about its anchor on the ground).
// kind: 'building' (BUILDINGS), 'stall' (STALLS), 'prop' (PROPS). Returns { L, anchor, smoke }.
function buildObject( kind, entry0, hf, stallRnd = null, stallIndex = 0 ) {
	const L = new GeoBuilder();
	let x, z, smoke = null;
	// objects laid along the ground (fences, long houses, carts...) take the turn in their own angle
	// and the size in their dimensions, so they are rebuilt sitting on the relief; a matrix about
	// the anchor would leave posts floating or buried on a slope
	let yaw = entry0.yaw || 0, sc = entry0.scale || 1, entry = entry0;
	if ( yaw || sc !== 1 ) {
		if ( kind === 'stall' ) {
			entry = Object.assign( [ entry0[ 0 ], entry0[ 1 ], entry0[ 2 ] + yaw ], entry0 );
			entry[ 2 ] = entry0[ 2 ] + yaw; yaw = 0;
		} else if ( kind === 'building' && entry0.type === 'long' ) {
			entry = { ...entry0, rot: ( entry0.rot || 0 ) + yaw, w: entry0.w * sc, l: entry0.l * sc }; yaw = 0; sc = 1;
		} else if ( kind === 'prop' && entry0.type === 'pen' ) {
			// pen() turns the other way round (u cos - v sin)
			entry = { ...entry0, rot: ( entry0.rot || 0 ) - yaw, w: entry0.w * sc, d: entry0.d * sc }; yaw = 0; sc = 1;
		} else if ( kind === 'prop' && ( entry0.type === 'cart' || entry0.type === 'rack' || entry0.type === 'wood' || entry0.type === 'gate' || entry0.type === 'arch' ) ) {
			entry = { ...entry0, rot: ( entry0.rot || 0 ) + yaw }; yaw = 0;
		}
	}
	if ( kind === 'stall' ) {
		x = entry[ 0 ]; z = entry[ 1 ];
		const rnd = entry.added ? mulberry32( ( entry.seed || 1 ) * 7919 ) : stallRnd;
		stall( L, x, z, entry[ 2 ], hf.heightAt( x, z ), rnd, entry.added ? entry.red !== false : stallIndex % 6 !== 3 );
	} else if ( kind === 'building' ) {
		x = entry.x; z = entry.z;
		const y = hf.heightAt( x, z );
		const r = mulberry32( entry.seed * 13 );
		let res = null;
		if ( entry.type === 'round' ) res = roundHouse( L, entry, y, r, hf );
		else if ( entry.type === 'long' ) res = longHouse( L, entry, y, r, hf );
		// its own random sequence, so the houses without one are unchanged
		if ( entry.awning ) houseAwning( L, entry, y, hf, mulberry32( entry.seed * 31 + 7 ) );
		else if ( entry.type === 'hut' ) hut( L, entry, y, r );
		else if ( entry.type === 'granary' ) granary( L, entry, y, r );
		else if ( entry.type === 'lookout' ) lookout( L, entry, y, r );
		else if ( entry.type === 'castro' ) res = castroHouse( { add: ( k, g, m ) => L.add( k, g, m ), hf }, entry );
		if ( res && r() < 0.65 ) smoke = res.smoke;
	} else {
		x = entry.x; z = entry.z;
		const p = entry, y = hf.heightAt( x, z );
		if ( p.type === 'pen' ) pen( L, hf, x, z, p.w, p.d, p.rot );
		else if ( p.type === 'hay' ) haystack( L, x, y, z, p.r );
		else if ( p.type === 'well' ) well( L, x, y, z );
		else if ( p.type === 'cart' ) oxCart( L, x, y, z, p.rot );
		else if ( p.type === 'rack' ) dryingRack( L, x, y, z, p.rot );
		else if ( p.type === 'skep' ) skep( L, x, y, z );
		else if ( p.type === 'wood' ) woodpile( L, x, y, z, p.rot, 12 );
		else if ( p.type === 'gate' ) entranceGate( L, hf, x, z, p.rot || 0 );
		else if ( p.type === 'arch' ) rusticArch( L, hf, x, z, p.rot || 0 );
	}
	const anchor = V( x, hf.heightAt( x, z ), z );
	let T = null;
	if ( yaw || sc !== 1 ) {
		T = new THREE.Matrix4().makeTranslation( anchor.x, anchor.y, anchor.z )
			.multiply( new THREE.Matrix4().makeRotationY( yaw ) )
			.multiply( new THREE.Matrix4().makeScale( sc, sc, sc ) )
			.multiply( new THREE.Matrix4().makeTranslation( - anchor.x, - anchor.y, - anchor.z ) );
		if ( smoke ) smoke.applyMatrix4( T );
	}
	return { L, anchor, smoke, T };
}

// one object as a group of meshes (one per material) with its origin at the anchor: the object
// editor moves, turns and scales the group (separate mode and objects added in the editor)
export function objectGroup( mats, kind, entry, hf, stallRnd = null, stallIndex = 0 ) {
	const { L, anchor, T, smoke } = buildObject( kind, entry, hf, stallRnd, stallIndex );
	const group = new THREE.Group();
	group.name = entry._id;
	group.userData = { objId: entry._id, kind, entry, anchor: anchor.clone(), smoke };
	group.position.copy( anchor );
	for ( const [ k, g ] of L.build() ) {
		if ( T ) g.applyMatrix4( T );
		g.translate( - anchor.x, - anchor.y, - anchor.z );
		g.computeBoundingSphere();
		const mesh = new THREE.Mesh( g, mats[ k ] );
		mesh.castShadow = k !== 'doorway';
		mesh.receiveShadow = true;
		mesh.name = 'bld_' + k;
		mesh.layers.enable( 2 );
		group.add( mesh );
	}
	return group;
}

// separate: every object its own group (the object editor, ?edit); otherwise all merged by material
export function createBuildings( app, mats, progress, { separate = false } = {} ) {
	const { hf } = app;
	inWater = ( x, z ) => !! ( app.rivers?.at( x, z, 1.5 ) || app.lakes?.at?.( x, z ) );
	const B = new GeoBuilder();
	const rnd = mulberry32( 1890 );
	const smoke = [];
	const objects = [];
	const add = ( kind, entry, i ) => {
		if ( separate ) {
			if ( kind === 'stall' && entry.removed ) { buildObject( kind, entry, hf, rnd, i ); return; } // use up its numbers
			objects.push( objectGroup( mats, kind, entry, hf, rnd, i ) );
			return;
		}
		const { L, smoke: sm, T } = buildObject( kind, entry, hf, rnd, i );
		if ( kind === 'stall' && entry.removed ) return;
		if ( sm ) smoke.push( sm );
		for ( const [ k, g ] of L.build() ) B.add( k, g, T );
	};

	BUILDINGS.forEach( ( b, i ) => {
		add( 'building', b, i );
		progress?.( i / BUILDINGS.length * 0.6 );
	} );
	STALLS.forEach( ( s, i ) => add( 'stall', s, i ) );
	// smoke above the chimneys of the separate houses too
	for ( const o of objects ) if ( o.userData.smoke ) smoke.push( o.userData.smoke );

	// bunting poles + pennant strings criss-crossing the market (both refs)
	const poles = [
		[ - 20, - 12 ], [ - 6, - 6 ], [ 8, - 14 ], [ 18, 2 ], [ - 10, 10 ], [ - 26, - 4 ], [ 4, 22 ], [ - 14, 28 ], [ 24, - 10 ], [ - 12, - 24 ], [ - 2, - 18 ]
	].map( ( [ x, z ] ) => {
		const y = hf.heightAt( x, z );
		B.add( 'woodPost', post( 0.08, 5.2 ), M( x, y - 0.3, z ) );
		return V( x, y + 4.8, z );
	} );
	const links = [ [ 0, 1 ], [ 1, 2 ], [ 1, 3 ], [ 0, 5 ], [ 1, 4 ], [ 4, 6 ], [ 4, 7 ], [ 2, 8 ], [ 3, 8 ], [ 5, 4 ], [ 0, 9 ], [ 9, 10 ], [ 10, 2 ], [ 10, 1 ] ];
	for ( const [ a, b ] of links ) {
		const L = poles[ a ].distanceTo( poles[ b ] );
		B.add( 'cloth', bunting( poles[ a ], poles[ b ], Math.round( L / 0.9 ), 0.25 + L * 0.03, 0.28 ) );
	}

	// low dry-stone enclosure wall around the market (WALLS[2])
	const mw = WALLS[ 2 ];
	for ( let i = 1; i < mw.length; i ++ ) {
		const a = V( mw[ i - 1 ][ 0 ], 0, mw[ i - 1 ][ 1 ] ), c = V( mw[ i ][ 0 ], 0, mw[ i ][ 1 ] );
		B.add( 'stoneDark', straightWall( a, c, 1.3, 0.9, hf.heightAt( a.x, a.z ), hf.heightAt( c.x, c.z ) ) );
	}

	villageLanes( B, hf );

	// wattle fences around the fields
	for ( const f of FIELDS ) {
		const c = Math.cos( f.rot ), s = Math.sin( f.rot );
		const corner = ( u, v ) => [ f.x + u * c + v * s, f.z - u * s + v * c ];
		const hw = f.w / 2 + 0.8, hl = f.l / 2 + 0.8;
		fence( B, hf, [ corner( - hw, - hl ), corner( hw, - hl ), corner( hw, hl ), corner( - hw, hl ), corner( - hw, - hl + 3 ) ] );
	}

	// village props from the layout
	PROPS.forEach( ( p, i ) => add( 'prop', p, i ) );
	progress?.( 0.9 );

	const group = new THREE.Group();
	group.name = 'buildings';
	for ( const [ k, g ] of B.build() ) {
		const mesh = new THREE.Mesh( g, mats[ k ] );
		mesh.castShadow = k !== 'doorway';
		mesh.receiveShadow = true;
		mesh.name = 'bld_' + k;
		mesh.layers.enable( 2 );
		group.add( mesh );
	}
	for ( const o of objects ) group.add( o );
	group.userData.smoke = smoke;
	group.userData.objects = objects;
	progress?.( 1 );
	return group;
}

export { woodpile, basket, jar, quern, oxCart, doorAngle };
