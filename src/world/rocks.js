import * as THREE from 'three/webgpu';
import {
	positionWorld, normalWorld, attribute, vec2, vec3, float, color, mix, smoothstep, fract, texture
} from 'three/tsl';
import { SURFACE } from './surfaceBake.js';
import { ChunkedInstances } from '../core/chunked.js';
import { makeSimplex, fbm, mulberry32, smoothstep as ss } from '../core/noise.js';
import { clearance, sampleMask } from './vegetation.js';
import { pathDistance } from './heightfield.js';
import { NATURE, CH, erased, forPainted, natureAt, texelSeed } from './natureEdits.js';
import { VILLAGE, WATER_LEVEL, SPINE, MINE } from './layout.js';
import { proceduralBump } from './terrain.js';
import { buildRockGeometry, ROCK_STYLES } from './granite/geometry.js';
import { getDetailTexture } from './granite/detail.js';
import { createGraniteMaterial } from './granite/shading.js';

const nR = makeSimplex( 3131 );

// Pebble: tiny, low poly.
function pebbleGeometry( seed ) {
	const g = graniteGeometry( 'boulder', seed, 0 );
	g.scale( 1, 0.7, 1 );
	return g;
}

// Granite rock of a style (granite/geometry.js: fracture planes, rounded edges, baked cavity
// 'ao'), with its flat base moved to y = -0.35 like the old boulders, so the placement below keeps
// burying the rocks the same way.
const STYLE = Object.fromEntries( ROCK_STYLES.map( ( s, i ) => [ s.name, i ] ) );
function graniteGeometry( style, seed, subdiv ) {
	const g = buildRockGeometry( STYLE[ style ], seed, subdiv );
	g.computeBoundingBox();
	g.translate( 0, - 0.35 - g.boundingBox.min.y, 0 );
	g.computeBoundingSphere();
	return g;
}

// Jointed granite for plain meshes (the fort's carved rock block). T: the baked surface textures
// (world/surfaceBake.js): the joints come from the stone cells, the noises from the clay and the
// world-patch tiles, all sampled in world space (along the wall: x + z; up: y).
export function createRockMaterial( lichen = 1, useTint = true, { tintScale = 1, jointScale = 0.9 } = {}, T ) {
	const mat = new THREE.MeshStandardNodeMaterial();
	const wp = positionWorld;
	const tint = ( useTint ? attribute( 'aTint', 'vec3' ) : vec3( 1 ) ).mul( tintScale );
	const along = wp.x.add( wp.z );
	const patch = texture( T.world, vec2( along, wp.y ).div( SURFACE.world ) );
	const n3 = patch.r;                                                         // ~2 m blotches
	const nFine = texture( T.daub, vec2( along, wp.y ).mul( 1.4 ).div( SURFACE.daub ) ).r; // grain
	// jointed granite: tall vertical joint blocks + gently wavy horizontal sheeting
	const cells = texture( T.stone, vec2( along.mul( jointScale ), wp.y.mul( jointScale * 0.3 ) ).div( SURFACE.stoneCells ) );
	const sheetN = patch.g.sub( 0.5 ).mul( 2.8 );
	const sheet = fract( wp.y.mul( jointScale * 1.2 ).add( sheetN ) );
	const crackV = smoothstep( 0.0, 0.035, cells.r );
	const crackH = smoothstep( 0.0, 0.05, sheet ).mul( smoothstep( 0.95, 1.0, sheet ).oneMinus() );
	const crack = crackV.mul( crackH ).mul( 0.15 ).add( 0.85 ).mul( mix( 0.9, 1.0, n3 ) );
	// vertical weathering streaks (the world tile stretched along y)
	const streak = texture( T.world, vec2( along.mul( 1.1 ), wp.y.mul( 0.1 ) ).div( SURFACE.world ) ).b;
	// granite: warm grey with feldspar speckle, darker in joints
	let col = mix( color( 0x6e675c ), color( 0xb8ae9b ), smoothstep( 0.3, 0.75, n3 ) );
	col = col.mul( mix( 0.85, 1.12, nFine ) ).mul( crack ).mul( mix( 0.78, 1.08, streak ) );
	// lichen / moss on the upward faces
	const up = normalWorld.y.clamp( 0, 1 );
	const lich = smoothstep( 0.55, 0.9, up.add( n3.sub( 0.5 ).mul( 0.6 ) ) ).mul( lichen );
	col = mix( col, mix( color( 0x5e6a33 ), color( 0x8f8f58 ), nFine ), lich.mul( 0.55 ) );
	// dark wet band near the waterline
	col = col.mul( mix( 0.55, 1.0, smoothstep( WATER_LEVEL - 0.2, WATER_LEVEL + 0.9, wp.y ) ) );
	mat.colorNode = col.mul( tint );
	mat.roughnessNode = mix( float( 0.9 ), float( 0.55 ), smoothstep( WATER_LEVEL - 0.2, WATER_LEVEL + 0.8, wp.y ).oneMinus() );
	const h = crack.mul( 0.5 ).add( n3.mul( 0.4 ) ).add( nFine.mul( 0.15 ) );
	mat.normalNode = proceduralBump( h, float( 0.9 ) );
	// plain meshes (the fort's rock block): mean tone of the stand-in in the reflection and the
	// shadow pass (core/proxies.js)
	if ( ! useTint ) mat.userData.proxyColor = new THREE.Color( 0x6e675c ).lerp( new THREE.Color( 0xb8ae9b ), 0.5 ).multiplyScalar( tintScale * 0.85 );
	return mat;
}

export function createRocks( app, progress ) {
	const { hf } = app;
	const group = new THREE.Group();
	group.name = 'rocks';
	// granite surface from a pre-generated detail texture (no per-pixel noise); distant tiles use
	// the cheap variant
	const tex = getDetailTexture();
	const heightTex = app.terrain.heightTex;
	const mat = createGraniteMaterial( { tex, heightTex, waterLevel: WATER_LEVEL } );
	const matLo = createGraniteMaterial( { tex, heightTex, waterLevel: WATER_LEVEL, lo: true } );
	app.rockMaterial = mat;

	// one style per setting: rounded tor blocks on the hills, boulders on the shore, angular
	// blocks in the talus under the cliff
	const chunked = ( name, style, seed ) => {
		const s = new ChunkedInstances( { name, hi: graniteGeometry( style, seed, 2 ), lo: graniteGeometry( style, seed, 1 ), material: mat, materialLo: matLo, tile: 260, lodDistance: 100, shadowDistance: 110, layer: 1, reflect: false } );
		s.addAttribute( 'aTint', 3 );
		return s;
	};
	const tors = [ chunked( 'tor0', 'tor', 101 ), chunked( 'tor1', 'boulder', 102 ) ];
	const shore = [ chunked( 'shore0', 'boulder', 111 ), chunked( 'shore1', 'tor', 112 ) ];
	const talus = [ chunked( 'talus0', 'block', 121 ), chunked( 'talus1', 'slab', 122 ) ];
	const variants = [ ...tors, ...shore, ...talus ];
	const gravel = [];
	for ( let v = 0; v < 2; v ++ ) {
		const s = new ChunkedInstances( { name: 'gravel' + v, hi: pebbleGeometry( 200 + v ), material: matLo, tile: 120, castShadow: false, layer: 1, maxDistance: 110, reflect: false } );
		s.addAttribute( 'aTint', 3 );
		gravel.push( s );
	}

	const rnd = mulberry32( 77 );
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
	const tint = ( R = rnd ) => { const t = 0.85 + R() * 0.3; return [ t * ( 0.98 + R() * 0.04 ), t, t * ( 0.96 + R() * 0.06 ) ]; };
	const nature = app.natureEdits;
	const put = ( list, x, z, s, sink = 0.25, squash = 1, R = rnd ) => {
		const y = hf.heightAt( x, z );
		e.set( ( R() - 0.5 ) * 0.5, R() * Math.PI * 2, ( R() - 0.5 ) * 0.5 );
		q.setFromEuler( e );
		const sx = s * ( 0.8 + R() * 0.5 ), sz = s * ( 0.8 + R() * 0.5 ), sy = s * ( 0.6 + R() * 0.5 ) * squash;
		pos.set( x, y - sink * sy, z );
		sc.set( sx, sy, sz );
		m.compose( pos, q, sc );
		const item = list[ Math.floor( R() * list.length ) ], ex = [ tint( R ) ];
		// erased by the nature brush: the draws above are used up all the same
		if ( R === rnd && nature && erased( nature, CH.rocks, x, z ) ) return false;
		item.add_( m, ex );
		return true;
	};
	const counts = { boulders: 0, gravel: 0 };

	// 1) Granite tors on the hills and around the village: clusters.
	const step = 12;
	for ( let z = hf.z0 + 20; z < hf.z0 + hf.size - 20; z += step ) {
		for ( let x = hf.x0 + 20; x < hf.x0 + hf.size - 20; x += step ) {
			const px = x + ( rnd() - 0.5 ) * step, pz = z + ( rnd() - 0.5 ) * step;
			const h = hf.heightAt( px, pz );
			if ( h < 2 || h > 700 ) continue;
			const slope = hf.slopeAt( px, pz );
			const outcrop = ss( 0.05, 0.4, fbm( nR, px * 0.012, pz * 0.012, 3 ) );
			const hill = ss( 30, 60, h );
			const distV = Math.hypot( px - VILLAGE.x, pz - VILLAGE.z );
			let p = Math.min( 1, 2 * outcrop * ( 0.25 + 0.75 * hill ) * ( 0.4 + ss( 0.25, 0.7, slope ) ) );
			if ( distV < 130 ) p = Math.max( p * 0.8, 0.12 * outcrop + 0.04 );
			if ( rnd() > p * 0.9 ) continue;
			if ( distV < 380 && clearance( px, pz, app.mask, 2 ) <= 0 ) continue;
			const k = 1 + Math.floor( rnd() * 5 );
			const big = 1.5 + rnd() * 5.0 * ( 0.4 + 0.6 * hill );
			for ( let i = 0; i < k; i ++ ) {
				const a = rnd() * Math.PI * 2, r = i ? big * ( 0.8 + rnd() * 1.4 ) : 0;
				const bx = px + Math.cos( a ) * r, bz = pz + Math.sin( a ) * r;
				if ( distV < 380 && clearance( bx, bz, app.mask, 1 ) <= 0 ) continue;
				if ( put( tors, bx, bz, big * ( i ? 0.35 + rnd() * 0.5 : 1 ) ) ) counts.boulders ++;
			}
		}
		progress?.( 0.6 * ( z - hf.z0 ) / hf.size );
	}

	// 2) Rocky shore: boulders along the waterline (both references).
	for ( let z = hf.z0 + 20; z < hf.z0 + hf.size - 20; z += 3 ) {
		for ( let x = hf.x0 + 20; x < hf.x0 + hf.size - 20; x += 3 ) {
			const px = x + ( rnd() - 0.5 ) * 3, pz = z + ( rnd() - 0.5 ) * 3;
			const h = hf.heightAt( px, pz );
			if ( h < - 2.2 || h > 5 ) continue;
			const band = 1 - ss( 1.5, 5, Math.abs( h - 0.8 ) );
			const n = 0.5 + 0.5 * nR( px * 0.05, pz * 0.05 );
			if ( rnd() > band * ( 0.12 + 0.35 * n ) ) continue;
			if ( pathDistance( px, pz ).d < 3 ) continue;
			if ( put( shore, px, pz, 0.5 + Math.pow( rnd(), 2.2 ) * 3.2, 0.35 ) ) counts.boulders ++;
		}
		progress?.( 0.6 + 0.25 * ( z - hf.z0 ) / hf.size );
	}

	// 2b) Talus of granite blocks along the spine's village-side cliff.
	for ( let i = 1; i < SPINE.pts.length; i ++ ) {
		const [ ax, az ] = SPINE.pts[ i - 1 ], [ bx, bz ] = SPINE.pts[ i ];
		const L = Math.hypot( bx - ax, bz - az ), tx = ( bx - ax ) / L, tz = ( bz - az ) / L;
		const nx = - tz, nz = tx; // village side
		for ( let d = 0; d < L; d += 2.2 ) {
			for ( const off of [ 2 + rnd() * 3, 6 + rnd() * 5 ] ) {
				const px = ax + tx * d + nx * off + ( rnd() - 0.5 ) * 2, pz = az + tz * d + nz * off + ( rnd() - 0.5 ) * 2;
				const dx = px - MINE.x, dz = pz - MINE.z;
				if ( Math.abs( dx * MINE.tx + dz * MINE.tz ) < MINE.width / 2 + 1 && Math.abs( dx * MINE.nx + dz * MINE.nz ) < MINE.depth / 2 + 11 ) continue;
				if ( pathDistance( px, pz ).d < 3 ) continue;
				if ( put( talus, px, pz, ( off < 5 ? 2.2 : 1.3 ) + rnd() * 1.8, 0.3 ) ) counts.boulders ++;
			}
		}
	}

	// 3) Gravel: along path edges, at house pads and on the shore near the village.
	for ( let z = - 260; z < 300; z += 1.3 ) {
		for ( let x = - 320; x < 260; x += 1.3 ) {
			const px = x + ( rnd() - 0.5 ) * 1.3, pz = z + ( rnd() - 0.5 ) * 1.3;
			const h = hf.heightAt( px, pz );
			if ( h < - 0.5 ) continue;
			const [ path, dirt ] = sampleMask( app.mask, px, pz );
			const edge = path > 0.05 && path < 0.85 ? 0.5 : path >= 0.85 ? 0.12 : 0;
			const shore = h < 3 ? 0.3 : 0;
			const p = edge + dirt * 0.05 + shore;
			if ( p <= 0 || rnd() > p ) continue;
			if ( put( gravel, px, pz, 0.06 + Math.pow( rnd(), 2 ) * 0.28, 0.3 ) ) counts.gravel ++;
		}
	}

	// painted rocks (world/natureEdits.js): the size channel, written from the brush radius, sets how
	// big the boulders get (a wide brush mixes in big ones)
	if ( nature ) {
		forPainted( nature, CH.rocks, ( tx, tz, v, i, j ) => {
			const prnd = mulberry32( texelSeed( i, j, CH.rocks, 4343 ) );
			const big = 0.4 + 5.5 * Math.max( 0, natureAt( nature, CH.rockSize, tx + 1, tz + 1 ) );
			for ( let n = v * 0.35; n > 0; n -= 1 ) {
				if ( prnd() >= Math.min( 1, n ) ) continue;
				const x = tx + prnd() * NATURE.cell, z = tz + prnd() * NATURE.cell;
				if ( hf.heightAt( x, z ) < - 30 ) continue;
				if ( Math.hypot( x - VILLAGE.x, z - VILLAGE.z ) < 380 && clearance( x, z, app.mask, 1 ) <= 0 ) continue;
				// many small ones, a few of the full size
				if ( put( tors, x, z, big * ( 0.25 + 0.75 * Math.pow( prnd(), 2.5 ) ), 0.25, 1, prnd ) ) counts.boulders ++;
			}
		} );
	}

	for ( const s of [ ...variants, ...gravel ] ) { s.build(); group.add( s ); }
	app.onFrame.push( () => { for ( const s of [ ...variants, ...gravel ] ) s.update( app.camera ); } );
	group.userData.counts = counts;
	progress?.( 1 );
	return group;
}
