import * as THREE from 'three/webgpu';
import { GeoBuilder, box, post, beam, ringWall, coneRoof, gableRoof, gableWall, canopy, bunting, straightWall } from '../core/builder.js';
import { mulberry32 } from '../core/noise.js';
import { BUILDINGS, STALLS, WALLS, FIELDS, VILLAGE, PROPS } from './layout.js';

const V = ( x, y, z ) => new THREE.Vector3( x, y, z );
const M = ( x, y, z, ry = 0, s = 1 ) => new THREE.Matrix4().compose( V( x, y, z ), new THREE.Quaternion().setFromAxisAngle( V( 0, 1, 0 ), ry ), V( s, s, s ) );

// Door faces the village centre (with a little randomness).
function doorAngle( b ) {
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

// ----------------------------------------------------------- round house
function roundHouse( B, b, y, rnd, hf ) {
	const r = b.r, h = 2.2 + r * 0.09, t = 0.55;
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
	// conical thatch resting on the wall head, slightly convex (beehive look)
	const R = r + 1.0;
	const H = R * ( 0.88 + rnd() * 0.14 );
	const y0 = wallTop - H * ( R - r ) / R + 0.05;
	const rj = ( a, t2 ) => ( 0.08 * Math.sin( a * 5 + b.seed ) + 0.05 * Math.sin( a * 11 + 2 ) ) * ( 1 - t2 );
	B.add( b.seed % 3 === 0 ? 'thatchGreen' : 'thatch', coneRoof( R, y0, y0 + H, { seg: 40, rings: 8, sag: - 0.35, thick: 0.55, jitter: rj } ), M( b.x, 0, b.z ) );
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
	B.add( 'daub', ringWall( r - 0.05, 0.9, 0.2, { door: doorAngle( b ), doorW: 0.8, seg: 20, batter: 0 } ), M( b.x, y + 0.8, b.z ) );
	const R = r + 0.6, H = R * 1.15;
	const top = y + 1.7;
	B.add( 'thatch', coneRoof( R, top - H * 0.6 / R + 0.05, top - H * 0.6 / R + 0.05 + H, { seg: 24, rings: 5, sag: - 0.3, thick: 0.4 } ), M( b.x, 0, b.z ) );
}

// ----------------------------------------------------------- long house
function longHouse( B, b, y, rnd, hf ) {
	const { w, l } = b, h = 2.3;
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
	// roof sits on the wall plate: eave drops below the wall head
	const rise = w * 0.66, over = 0.8;
	const y0 = y + h - over * rise / ( w / 2 ) + 0.05;
	const roofKey = rnd() < 0.4 ? 'thatchGreen' : 'thatch';
	local.add( roofKey, gableRoof( w, l, y0, rise + over * rise / ( w / 2 ), { over, thick: 0.6 } ) );
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

export function createBuildings( app, mats, progress ) {
	const { hf } = app;
	const B = new GeoBuilder();
	const rnd = mulberry32( 1890 );
	const smoke = [];

	BUILDINGS.forEach( ( b, i ) => {
		const y = hf.heightAt( b.x, b.z );
		const r = mulberry32( b.seed * 13 );
		let res = null;
		if ( b.type === 'round' ) res = roundHouse( B, b, y, r, hf );
		else if ( b.type === 'long' ) res = longHouse( B, b, y, r, hf );
		else if ( b.type === 'hut' ) hut( B, b, y, r );
		else if ( b.type === 'granary' ) granary( B, b, y, r );
		else if ( b.type === 'lookout' ) lookout( B, b, y, r );
		if ( res && r() < 0.65 ) smoke.push( res.smoke );
		progress?.( i / BUILDINGS.length * 0.6 );
	} );

	const stallPosts = [];
	STALLS.forEach( ( [ x, z, rot ], i ) => {
		const y = hf.heightAt( x, z );
		stall( B, x, z, rot, y, rnd, i % 6 !== 3 );
		stallPosts.push( V( x, y, z ) );
	} );

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

	// wattle fences around the fields
	for ( const f of FIELDS ) {
		const c = Math.cos( f.rot ), s = Math.sin( f.rot );
		const corner = ( u, v ) => [ f.x + u * c + v * s, f.z - u * s + v * c ];
		const hw = f.w / 2 + 0.8, hl = f.l / 2 + 0.8;
		fence( B, hf, [ corner( - hw, - hl ), corner( hw, - hl ), corner( hw, hl ), corner( - hw, hl ), corner( - hw, - hl + 3 ) ] );
	}

	// village props from the layout
	for ( const p of PROPS ) {
		const y = hf.heightAt( p.x, p.z );
		if ( p.type === 'pen' ) pen( B, hf, p.x, p.z, p.w, p.d, p.rot );
		else if ( p.type === 'hay' ) haystack( B, p.x, y, p.z, p.r );
		else if ( p.type === 'well' ) well( B, p.x, y, p.z );
		else if ( p.type === 'cart' ) oxCart( B, p.x, y, p.z, p.rot );
		else if ( p.type === 'rack' ) dryingRack( B, p.x, y, p.z, p.rot );
		else if ( p.type === 'skep' ) skep( B, p.x, y, p.z );
		else if ( p.type === 'wood' ) woodpile( B, p.x, y, p.z, p.rot, 12 );
	}
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
	group.userData.smoke = smoke;
	progress?.( 1 );
	return group;
}

export { woodpile, basket, jar, doorAngle };
