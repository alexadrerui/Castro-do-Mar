import * as THREE from 'three/webgpu';
import * as THREE_CORE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBuilder, box, post, beam, ringWall, coneRoof, gableRoof, straightWall } from '../core/builder.js';
import { makeSimplex, mulberry32 } from '../core/noise.js';
import { FORT, WALLS, TOWER, MINE } from './layout.js';

const V = ( x, y, z ) => new THREE.Vector3( x, y, z );
const M = ( x, y, z, ry = 0 ) => new THREE.Matrix4().compose( V( x, y, z ), new THREE.Quaternion().setFromAxisAngle( V( 0, 1, 0 ), ry ), V( 1, 1, 1 ) );
const nF = makeSimplex( 5150 );

// Ground for structures on the spine: the carved rock block's top counts as ground.
function topAt( hf, x, z ) {
	const dx = x - MINE.x, dz = z - MINE.z;
	const a = Math.abs( dx * MINE.tx + dz * MINE.tz ), b = Math.abs( dx * MINE.nx + dz * MINE.nz );
	const h = hf.heightAt( x, z );
	return ( a < MINE.width / 2 + 0.5 && b < MINE.depth / 2 + 0.5 ) ? Math.max( h, MINE.top - 0.25 ) : h;
}

// ---------------------------------------------------------------- ring fort
function ringFort( B, hf ) {
	const y = FORT.ground - 0.6;
	const R = FORT.radius, H = FORT.wallHeight, T = 2.6;
	const gate = FORT.gateAngle;
	const jit = ( a ) => 0.3 * nF( Math.cos( a ) * 3, Math.sin( a ) * 3 ) + 0.1 * Math.sin( a * 17 );
	B.add( 'fortStone', ringWall( R, H, T, { door: gate, doorW: 3.0, seg: 96, batter: 0.1, jitter: jit } ), M( FORT.x, y, FORT.z ) );
	// rubble breastwork along the outer edge of the wall walk (ragged, no merlons)
	const pj = ( a ) => 0.35 * nF( Math.cos( a ) * 6 + 4, Math.sin( a ) * 6 ) + 0.12 * nF( a * 9, 2 );
	B.add( 'fortStone', ringWall( R - 0.45, 0.9, 0.6, { door: gate, doorW: 3.4, seg: 96, batter: 0.02, jitter: pj } ), M( FORT.x, y + H - 0.1, FORT.z ) );
	// inner terrace ring (the concentric ledge seen in the aerial reference)
	B.add( 'stoneDark', ringWall( R - 6.5, 1.1, 0.9, { door: gate, doorW: 3.0, seg: 64, batter: 0.02 } ), M( FORT.x, y + 0.3, FORT.z ) );
	for ( let k = 0; k < 10; k ++ ) {
		const a = gate + 0.5 + k * ( Math.PI * 2 - 1.0 ) / 9;
		const r0 = R - 6.4, r1 = R - T + 0.2;
		const A = V( FORT.x + Math.cos( a ) * r0, 0, FORT.z + Math.sin( a ) * r0 ), C = V( FORT.x + Math.cos( a ) * r1, 0, FORT.z + Math.sin( a ) * r1 );
		B.add( 'stoneDark', straightWall( A, C, 1.6, 0.6, y + 0.5, y + 0.5 ) );
	}
	// inturned gate: the wall ends turn inwards to form a 4 m passage
	const gx = Math.cos( gate ), gz = Math.sin( gate );
	const tx = - gz, tz = gx;
	for ( const sd of [ - 1, 1 ] ) {
		const ex = FORT.x + gx * ( R - T / 2 ) + tx * sd * 1.5 * 1.35, ez = FORT.z + gz * ( R - T / 2 ) + tz * sd * 1.5 * 1.35;
		const ix = ex - gx * 4.2, iz = ez - gz * 4.2;
		B.add( 'fortStone', straightWall( V( ex, 0, ez ), V( ix, 0, iz ), H - 0.6, 1.4, y, y ) );
	}
	const gm = new THREE.Matrix4().compose( V( FORT.x + gx * ( R - 0.6 ), 0, FORT.z + gz * ( R - 0.6 ) ), new THREE.Quaternion().setFromAxisAngle( V( 0, 1, 0 ), - gate ), V( 1, 1, 1 ) );
	const G = new GeoBuilder();
	// timber gate frame (2.9 m clear), plank bridge carrying the wall walk
	for ( const sd of [ - 1, 1 ] ) G.add( 'woodPost', post( 0.2, H + 0.4 ), M( 0.3, y, sd * 1.45 ) );
	G.add( 'woodPost', beam( V( 0.3, y + 2.9, - 1.8 ), V( 0.3, y + 2.9, 1.8 ), 0.22 ) );
	G.add( 'woodPost', beam( V( - 1.2, y + H - 0.25, - 1.8 ), V( - 1.2, y + H - 0.25, 1.8 ), 0.18 ) );
	G.add( 'woodPost', beam( V( 1.2, y + H - 0.25, - 1.8 ), V( 1.2, y + H - 0.25, 1.8 ), 0.18 ) );
	G.add( 'wood', box( 2.6, 0.12, 4.8 ), M( 0, y + H - 0.08, 0 ) );
	// half-open double door, 2.8 m high
	G.add( 'wood', box( 0.12, 2.8, 1.45 ), new THREE.Matrix4().compose( V( 1.0, y, - 1.2 ), new THREE.Quaternion().setFromAxisAngle( V( 0, 1, 0 ), 0.9 ), V( 1, 1, 1 ) ) );
	G.add( 'wood', box( 0.12, 2.8, 1.45 ), new THREE.Matrix4().compose( V( 0.35, y, 0.72 ), new THREE.Quaternion().setFromAxisAngle( V( 0, 1, 0 ), - 0.2 ), V( 1, 1, 1 ) ) );
	for ( const [ k, g ] of G.build() ) B.add( k, g, gm );
	// cantilevered slab steps up the inner face to the wall walk
	for ( let k = 0; k < 14; k ++ ) {
		const a = gate + 2.4 + k * 0.034;
		const rr = R - T - 0.35;
		B.add( 'stoneDark', box( 1.0, 0.18, 0.5 ), M( FORT.x + Math.cos( a ) * rr, y + 0.25 + k * 0.25, FORT.z + Math.sin( a ) * rr, Math.PI / 2 - a ) );
	}
	void hf;
}

// ------------------------------------------------------------- north wall
function northWalls( B, hf ) {
	for ( const line of [ WALLS[ 0 ], WALLS[ 1 ] ] ) {
		for ( let i = 1; i < line.length; i ++ ) {
			const a = V( line[ i - 1 ][ 0 ], 0, line[ i - 1 ][ 1 ] ), c = V( line[ i ][ 0 ], 0, line[ i ][ 1 ] );
			// split long runs so the wall follows the crest
			const n = Math.max( 1, Math.round( a.distanceTo( c ) / 5 ) );
			for ( let k = 0; k < n; k ++ ) {
				const p0 = a.clone().lerp( c, k / n ), p1 = a.clone().lerp( c, ( k + 1 ) / n );
				const ragged = ( x, z ) => 0.45 * nF( x * 0.35, z * 0.35 ) + 0.15 * nF( x * 1.3, z * 1.3 );
				B.add( 'fortStone', straightWall( p0, p1, 3.0, 2.2, topAt( hf, p0.x, p0.z ), topAt( hf, p1.x, p1.z ), { top: ragged } ) );
				// turf and moss capping on the wall head
				B.add( 'thatchGreen', straightWall( p0, p1, 0.16, 1.75, topAt( hf, p0.x, p0.z ) + 2.97 + ragged( p0.x, p0.z ), topAt( hf, p1.x, p1.z ) + 2.97 + ragged( p1.x, p1.z ) ) );
			}
		}
	}
	// small round bastion at the wall's east end
	const e = WALLS[ 1 ][ WALLS[ 1 ].length - 1 ];
	B.add( 'fortStone', ringWall( 3.2, 5.5, 3.2, { seg: 28 } ), M( e[ 0 ], topAt( hf, e[ 0 ], e[ 1 ] ) - 0.8, e[ 1 ] ) );
}

// ---------------------------------------------------------- watchtower
function watchtower( B, hf ) {
	const y = topAt( hf, TOWER.x, TOWER.z ) - 0.6;
	const x = TOWER.x, z = TOWER.z;
	const PL = 3.2, SH = 11.0, R0 = 3.3, R1 = 3.0;
	// stone plinth
	B.add( 'fortStone', ringWall( 4.0, PL, 4.0, { seg: 24 } ), M( x, y, z ) );
	// chunky octagonal plank shaft
	const shaft = new THREE.CylinderGeometry( R1, R0, SH, 8, 4, true );
	shaft.translate( 0, SH / 2, 0 );
	const uv = shaft.attributes.uv;
	for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, uv.getX( i ) * Math.PI * 2 * R0, uv.getY( i ) * SH );
	const y0 = y + PL - 0.1;
	B.add( 'wood', shaft, M( x, y0, z, 0.2 ) );
	// exposed corner posts, cross bracing and rings
	for ( let k = 0; k < 8; k ++ ) {
		const a = k / 8 * Math.PI * 2 + 0.2, a2 = ( k + 1 ) / 8 * Math.PI * 2 + 0.2;
		B.add( 'woodPost', beam( V( x + Math.cos( a ) * ( R0 + 0.12 ), y0, z + Math.sin( a ) * ( R0 + 0.12 ) ), V( x + Math.cos( a ) * ( R1 + 0.12 ), y0 + SH + 0.2, z + Math.sin( a ) * ( R1 + 0.12 ) ), 0.2 ) );
		B.add( 'woodPost', beam( V( x + Math.cos( a ) * ( R0 + 0.1 ), y0 + 0.4, z + Math.sin( a ) * ( R0 + 0.1 ) ), V( x + Math.cos( a2 ) * ( R0 - 0.05 + 0.1 ), y0 + 4.2, z + Math.sin( a2 ) * ( R0 - 0.05 + 0.1 ) ), 0.09 ) );
	}
	for ( const hh of [ 0.2, 4.2, 8.3 ] ) B.add( 'woodPost', ringWall( R0 + 0.16 - hh * 0.027, 0.3, 0.3, { seg: 8, batter: 0 } ), M( x, y0 + hh, z, 0.2 ) );
	// door at the plinth top with an outside ladder, slits on two levels
	const da = 2.2;
	B.add( 'doorway', box( 1.0, 1.9, 0.05 ), M( x + Math.cos( da ) * ( R0 - 0.05 ), y0 + 0.1, z + Math.sin( da ) * ( R0 - 0.05 ), Math.PI / 2 - da ) );
	for ( const sd of [ - 0.3, 0.3 ] ) {
		const ox = Math.cos( da ), oz = Math.sin( da ), px = - oz * sd, pz = ox * sd;
		B.add( 'woodPost', beam( V( x + ox * 6.2 + px, y - 0.4, z + oz * 6.2 + pz ), V( x + ox * 4.1 + px, y0 + 0.2, z + oz * 4.1 + pz ), 0.05 ) );
	}
	for ( let r = 1; r < 10; r ++ ) {
		const t = r / 10, ox = Math.cos( da ), oz = Math.sin( da );
		const cx = x + ox * ( 6.2 - 2.1 * t ), cz = z + oz * ( 6.2 - 2.1 * t ), cy = y - 0.4 + ( PL + 0.6 ) * t;
		B.add( 'woodPost', beam( V( cx + oz * 0.3, cy, cz - ox * 0.3 ), V( cx - oz * 0.3, cy, cz + ox * 0.3 ), 0.03 ) );
	}
	for ( const lv of [ 5.0, 9.0 ] ) for ( let k = 0; k < 4; k ++ ) {
		const a = k / 4 * Math.PI * 2 + 0.6 + lv * 0.1;
		const rr = R0 - ( lv / SH ) * ( R0 - R1 ) - 0.02;
		B.add( 'doorway', box( 0.45, 1.1, 0.05 ), M( x + Math.cos( a ) * rr, y0 + lv, z + Math.sin( a ) * rr, Math.PI / 2 - a ) );
	}
	// projecting gallery on brackets, parapet boards and roof posts
	const gy = y0 + SH - 2.5, GR = R1 + 1.2;
	for ( let k = 0; k < 8; k ++ ) {
		const a = k / 8 * Math.PI * 2 + 0.2;
		B.add( 'woodPost', beam( V( x + Math.cos( a ) * R1, gy - 1.4, z + Math.sin( a ) * R1 ), V( x + Math.cos( a ) * GR, gy - 0.05, z + Math.sin( a ) * GR ), 0.12 ) );
	}
	B.add( 'wood', new THREE.CylinderGeometry( GR, GR, 0.25, 12 ), M( x, gy, z ) );
	B.add( 'wood', ringWall( GR - 0.05, 1.05, 0.1, { seg: 12, batter: 0 } ), M( x, gy + 0.1, z ) );
	for ( let k = 0; k < 12; k ++ ) {
		const a = k / 12 * Math.PI * 2;
		B.add( 'woodPost', post( 0.12, 3.0 ), M( x + Math.cos( a ) * ( GR - 0.15 ), gy + 0.1, z + Math.sin( a ) * ( GR - 0.15 ) ) );
	}
	// broad conical thatch roof
	const ry = gy + 3.0;
	B.add( 'thatch', coneRoof( 5.0, ry, ry + 4.2, { seg: 40, rings: 8, thick: 0.55, sag: - 0.2 } ), M( x, 0, z ) );
	B.add( 'thatchGreen', coneRoof( 0.7, ry + 3.8, ry + 4.8, { seg: 10, rings: 2, thick: 0.12, sag: - 0.4 } ), M( x, 0, z ) );
	B.add( 'woodPost', post( 0.07, 2.0 ), M( x, ry + 4.4, z ) );
}

// ------------------------------------------------------------- the mines
// Local mine frame: +x along the cliff (tangent), +z out of the face, y up.
function mineFrame() {
	const q = new THREE.Quaternion().setFromUnitVectors( V( 0, 0, 1 ), V( MINE.nx, 0, MINE.nz ) );
	return new THREE.Matrix4().compose( V( MINE.fx, 0, MINE.fz ), q, V( 1, 1, 1 ) );
}

function rockBlockGeometry() {
	const W = MINE.width, D = MINE.depth, y0 = MINE.floor - 3.5, y1 = MINE.top + 0.6;
	const g = new THREE_CORE.BoxGeometry( W, y1 - y0, D, 52, 34, 30 );
	g.translate( 0, ( y0 + y1 ) / 2, - D / 2 );
	g.deleteAttribute( 'uv' );
	const m = mergeVertices( g, 1e-4 );
	m.computeVertexNormals();
	const p = m.attributes.position, n = m.attributes.normal;
	const c = V( 0, ( y0 + y1 ) / 2, - D / 2 );
	for ( let i = 0; i < p.count; i ++ ) {
		const x = p.getX( i ), y = p.getY( i ), z = p.getZ( i );
		// jointed granite: layered horizontal ledges + blocky vertical joints
		const ledge = Math.sin( y * 1.4 + nF( x * 0.15, z * 0.1 ) * 2 ) * 0.25;
		const joint = nF( x * 0.35, y * 0.12 ) * 0.9 + nF( x * 1.1, y * 0.9 + z ) * 0.3;
		const d = ledge + joint;
		const nx = n.getX( i ), ny = n.getY( i ), nz = n.getZ( i );
		let k = 0.9;
		// keep the top roughly level so the wall above can sit on it
		if ( y > y1 - 0.8 ) k = 0.35;
		// round the block's side edges into the terrain
		const side = Math.abs( x ) / ( W / 2 );
		const bulge = side > 0.8 ? ( side - 0.8 ) * 6 : 0;
		p.setXYZ( i, x + nx * d * k - Math.sign( x ) * bulge * 0.5, y + ny * d * k * 0.5, z + nz * d * k + ( z > - 0.5 ? - bulge : 0 ) );
		void c;
	}
	m.computeVertexNormals();
	const uv = new Float32Array( p.count * 2 );
	m.setAttribute( 'uv', new THREE_CORE.BufferAttribute( uv, 2 ) );
	return m;
}

function carveAdits( blockGeo ) {
	const ev = new Evaluator();
	ev.attributes = [ 'position', 'normal', 'uv' ];
	ev.useGroups = true;
	const rockMat = new THREE_CORE.MeshBasicMaterial(), tunnelMat = new THREE_CORE.MeshBasicMaterial();
	let result = new Brush( blockGeo, rockMat );
	result.updateMatrixWorld();
	for ( const off of MINE.adits ) {
		// slightly arched profile: box + a flattened cylinder crown
		const tg = new THREE_CORE.BoxGeometry( MINE.aditW, MINE.aditH, MINE.aditLen + 4, 2, 2, 6 );
		tg.translate( off, MINE.floor + MINE.aditH / 2, - MINE.aditLen / 2 + 2 );
		const tb = new Brush( tg, tunnelMat );
		tb.updateMatrixWorld();
		result = ev.evaluate( result, tb, SUBTRACTION );
		result.updateMatrixWorld();
	}
	// convert to three/webgpu geometry with two groups (0 rock, 1 tunnel)
	const src = result.geometry;
	const out = new THREE.BufferGeometry();
	for ( const k of [ 'position', 'normal', 'uv' ] ) out.setAttribute( k, new THREE.BufferAttribute( src.attributes[ k ].array, src.attributes[ k ].itemSize ) );
	if ( src.index ) out.setIndex( new THREE.BufferAttribute( src.index.array, 1 ) );
	const mats = Array.isArray( result.material ) ? result.material : [ result.material ];
	for ( const gr of src.groups ) out.addGroup( gr.start, gr.count, mats[ gr.materialIndex ] === tunnelMat ? 1 : 0 );
	return out;
}

function mineTimber( B ) {
	const L = new GeoBuilder();
	const f = MINE.floor, H = MINE.aditH, W = MINE.aditW;
	for ( const off of MINE.adits ) {
		// portal: heavy squared posts and cap projecting 1.2 m from the face
		for ( const sd of [ - 1, 1 ] ) {
			L.add( 'woodPost', box( 0.34, H + 0.35, 0.34 ), M( off + sd * ( W / 2 + 0.17 ), f - 0.2, 0.9 ) );
			L.add( 'woodPost', box( 0.3, H + 0.2, 0.3 ), M( off + sd * ( W / 2 + 0.15 ), f - 0.2, 0.05 ) );
		}
		L.add( 'woodPost', box( W + 1.1, 0.36, 0.38 ), M( off, f + H + 0.1, 0.9 ) );
		L.add( 'woodPost', box( W + 0.9, 0.3, 0.32 ), M( off, f + H, 0.05 ) );
		L.add( 'wood', box( W + 1.1, 0.08, 1.0 ), M( off, f + H + 0.46, 0.45 ) );
		// interior sets every 1.4 m; upright lagging on the first two
		for ( let k = 1; k < 7; k ++ ) {
			const z = 0.2 - k * 1.4;
			for ( const sd of [ - 1, 1 ] ) L.add( 'woodPost', beam( V( off + sd * ( W / 2 - 0.15 ), f - 0.1, z ), V( off + sd * ( W / 2 - 0.22 ), f + H - 0.1, z ), 0.12 ) );
			L.add( 'woodPost', beam( V( off - W / 2, f + H - 0.12, z ), V( off + W / 2, f + H - 0.12, z ), 0.13 ) );
			L.add( 'wood', box( W - 0.2, 0.07, 1.4 ), M( off, f + H - 0.3, z - 0.7 ) );
			if ( k <= 2 ) for ( const sd of [ - 1, 1 ] ) L.add( 'wood', box( 0.06, H - 0.3, 1.4 ), M( off + sd * ( W / 2 - 0.05 ), f - 0.05, z - 0.7 ) );
		}
		// darkness: the gallery swallows the light a few metres in
		L.add( 'doorway', box( W, H, 0.05 ), M( off, f - 0.1, - 4.2 ) );
		// plank runway out of the adit
		L.add( 'wood', box( 0.9, 0.06, 12 ), M( off, f - 0.02, 3.0 ) );
		// lantern on the portal
		L.add( 'ember', box( 0.16, 0.24, 0.16 ), M( off + W / 2 + 0.45, f + H - 0.6, 1.15 ) );
		L.add( 'woodPost', box( 0.24, 0.05, 0.24 ), M( off + W / 2 + 0.45, f + H - 0.36, 1.15 ) );
		// ore baskets by the portal
		for ( let k = 0; k < 3; k ++ ) L.add( 'wattle', new THREE.CylinderGeometry( 0.3, 0.22, 0.42, 10, 1, true ).translate( 0, 0.21, 0 ), M( off - W / 2 - 0.7 - k * 0.55, f, 1.6 + ( k % 2 ) * 0.4 ) );
	}
	// timber staging tied into the cliff face (the stacked frames of the reference)
	const x0 = MINE.adits[ 0 ] + 2.2, x1 = MINE.adits[ 1 ] - 2.2;
	const levels = [ f, f + 3.2, f + 6.4, f + 9.6, MINE.top - 0.3 ];
	for ( const x of [ x0, ( x0 + x1 ) / 2, x1 ] ) {
		L.add( 'woodPost', box( 0.3, MINE.top - f + 1.2, 0.3 ), M( x, f - 0.4, 1.9 ) );
		L.add( 'woodPost', box( 0.26, MINE.top - f + 1.0, 0.26 ), M( x, f - 0.4, 0.25 ) );
	}
	for ( const yl of levels.slice( 1 ) ) {
		L.add( 'woodPost', box( x1 - x0 + 0.8, 0.26, 0.26 ), M( ( x0 + x1 ) / 2, yl - 0.26, 1.9 ) );
		L.add( 'woodPost', box( x1 - x0 + 0.8, 0.22, 0.22 ), M( ( x0 + x1 ) / 2, yl - 0.22, 0.25 ) );
		for ( const x of [ x0, ( x0 + x1 ) / 2, x1 ] ) L.add( 'woodPost', box( 0.22, 0.22, 2.4 ), M( x, yl - 0.22, 1.0 ) ); // ties into the face
		L.add( 'wood', box( x1 - x0 + 0.6, 0.1, 1.8 ), M( ( x0 + x1 ) / 2, yl, 1.05 ) );
		L.add( 'woodPost', beam( V( x0, yl + 1.0, 2.0 ), V( x1, yl + 1.0, 2.0 ), 0.05 ) );
	}
	for ( let i = 0; i < levels.length - 1; i ++ ) {
		L.add( 'woodPost', beam( V( x0, levels[ i ], 2.05 ), V( ( x0 + x1 ) / 2, levels[ i + 1 ] - 0.3, 2.05 ), 0.09 ) );
		L.add( 'woodPost', beam( V( x1, levels[ i ], 2.05 ), V( ( x0 + x1 ) / 2, levels[ i + 1 ] - 0.3, 2.05 ), 0.09 ) );
		const lx = x0 + 0.7 + ( i % 2 ) * ( x1 - x0 - 1.4 );
		for ( const sd of [ - 0.25, 0.25 ] ) L.add( 'woodPost', beam( V( lx + sd, levels[ i ], 2.7 ), V( lx + sd, levels[ i + 1 ] + 0.9, 2.0 ), 0.045 ) );
		for ( let r = 1; r < 10; r ++ ) {
			const t = r / 10, yy = levels[ i ] + ( levels[ i + 1 ] + 0.9 - levels[ i ] ) * t;
			L.add( 'woodPost', beam( V( lx - 0.25, yy, 2.7 - 0.7 * t ), V( lx + 0.25, yy, 2.7 - 0.7 * t ), 0.03 ) );
		}
	}
	// windlass on A-frames at the top of the staging, rope and bucket
	const wx = ( x0 + x1 ) / 2, wy = MINE.top + 0.1;
	for ( const sd of [ - 0.8, 0.8 ] ) {
		L.add( 'woodPost', beam( V( wx + sd, wy, 1.2 ), V( wx + sd, wy + 1.4, 2.0 ), 0.08 ) );
		L.add( 'woodPost', beam( V( wx + sd, wy, 2.8 ), V( wx + sd, wy + 1.4, 2.0 ), 0.08 ) );
	}
	L.add( 'woodPost', new THREE.CylinderGeometry( 0.2, 0.2, 1.5, 10 ).rotateZ( Math.PI / 2 ), M( wx, wy + 1.3, 2.0 ) );
	L.add( 'woodPost', beam( V( wx + 0.8, wy + 1.3, 2.0 ), V( wx + 1.2, wy + 1.0, 2.0 ), 0.04 ) );
	L.add( 'woodPost', beam( V( wx, wy + 1.15, 2.2 ), V( wx, f + 1.4, 3.0 ), 0.018 ) );
	L.add( 'wood', post( 0.28, 0.45 ), M( wx, f + 0.95, 3.0 ) );
	// wheelbarrow (single wheel, two handles)
	{
		const bx = MINE.adits[ 0 ], bz = 5.2;
		L.add( 'wood', box( 0.7, 0.35, 0.9 ), M( bx, f + 0.35, bz ) );
		L.add( 'wood', new THREE.CylinderGeometry( 0.25, 0.25, 0.08, 10 ).rotateZ( Math.PI / 2 ), M( bx, f + 0.25, bz - 0.65 ) );
		for ( const sd of [ - 0.25, 0.25 ] ) L.add( 'woodPost', beam( V( bx + sd, f + 0.45, bz - 0.5 ), V( bx + sd * 1.4, f + 0.55, bz + 1.1 ), 0.03 ) );
		L.add( 'darkRock', new THREE.IcosahedronGeometry( 0.35, 1 ).scale( 0.9, 0.4, 1.1 ), M( bx, f + 0.6, bz ) );
	}
	// ore washing trough on trestles, sorting bench with hammer-stones
	L.add( 'wood', box( 6.0, 0.35, 0.55 ), M( MINE.adits[ 1 ] + 3.5, f + 0.75, 6.0 ) );
	for ( const t of [ - 2.6, 0, 2.6 ] ) for ( const sd of [ - 0.3, 0.3 ] ) L.add( 'woodPost', beam( V( MINE.adits[ 1 ] + 3.5 + t, f, 6.0 + sd * 1.3 ), V( MINE.adits[ 1 ] + 3.5 + t, f + 0.8, 6.0 ), 0.05 ) );
	L.add( 'stoneDark', box( 2.2, 0.7, 1.0 ), M( MINE.adits[ 0 ] - 3.5, f, 7.0 ) );
	for ( let k = 0; k < 4; k ++ ) L.add( 'stone', new THREE.IcosahedronGeometry( 0.14, 0 ), M( MINE.adits[ 0 ] - 4.2 + k * 0.45, f + 0.78, 7.0 ) );
	// bloomery furnace (clay) with a slag heap
	const fx = MINE.adits[ 1 ] + 7.5, fz = 9.5;
	L.add( 'daub', coneRoof( 0.75, f - 0.1, f + 1.5, { seg: 14, rings: 3, sag: - 0.4, thick: 0.1 } ), M( fx, 0, fz ) );
	L.add( 'ember', box( 0.3, 0.25, 0.1 ), M( fx, f + 0.1, fz + 0.66 ) );
	L.add( 'darkRock', new THREE.ConeGeometry( 1.6, 0.8, 12, 2 ).translate( 0, 0.3, 0 ), M( fx + 2.2, f, fz + 1.0 ) );
	// spoil heap and timber pile in the yard
	L.add( 'darkRock', new THREE.ConeGeometry( 3.2, 1.7, 14, 2 ), M( MINE.adits[ 1 ] + 4.5, f + 0.6, 10.5 ) );
	for ( let k = 0; k < 9; k ++ ) {
		const yy = f + 0.2 + Math.floor( k / 3 ) * 0.36, xx = MINE.adits[ 0 ] - 5 + ( k % 3 ) * 0.38 + Math.floor( k / 3 ) * 0.19;
		L.add( 'woodPost', beam( V( xx, yy, 3 ), V( xx, yy, 7.5 ), 0.17 ) );
	}
	const frame = mineFrame();
	for ( const [ k, g ] of L.build() ) B.add( k, g, frame );
}

export function createFort( app, mats, rockMat ) {
	const { hf } = app;
	const B = new GeoBuilder();
	ringFort( B, hf );
	northWalls( B, hf );
	watchtower( B, hf );
	mineTimber( B );

	const group = new THREE.Group();
	group.name = 'fort';
	for ( const [ k, g ] of B.build() ) {
		const mesh = new THREE.Mesh( g, mats[ k ] );
		mesh.castShadow = k !== 'doorway' && k !== 'ember';
		mesh.receiveShadow = true;
		mesh.layers.enable( 2 );
		group.add( mesh );
	}

	// carved rock block with the two adits
	const geo = carveAdits( rockBlockGeometry() );
	geo.applyMatrix4( mineFrame() );
	geo.computeBoundingSphere();
	const block = new THREE.Mesh( geo, [ rockMat, mats.darkRock ] );
	block.castShadow = true; block.receiveShadow = true;
	block.name = 'mineBlock';
	block.layers.enable( 2 );
	group.add( block );
	void mulberry32;
	return group;
}
