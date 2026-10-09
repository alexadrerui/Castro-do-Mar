// Entrance gate of the village (ref/ref_portal.jpg, "Entrance pórtico"): a heavy timber frame across
// the main road, two pairs of squared posts tied by rails, double lintels under a cap beam with
// jutting ends, joists and knee braces, iron straps at the joints; a worn red cloth over the top
// and draped down both sides onto outer poles; banners with an algiz rune (ᛉ), a lantern hanging
// from the lintel, two plank gate leaves swung open inwards and dry-stone walls running off to
// either side. Built from the village materials (no new shader): woodPost, wood, cloth, canvas,
// stoneDark, ember.
// Local frame: x across the road, +z into the village; y absolute (the ground under each part).
import * as THREE from 'three/webgpu';
import { GeoBuilder, box, post, beam, canopy, straightWall, coneRoof } from '../core/builder.js';
import { mulberry32 } from '../core/noise.js';

const V = ( x, y, z ) => new THREE.Vector3( x, y, z );
const M = ( x, y, z, ry = 0 ) => new THREE.Matrix4().compose( V( x, y, z ), new THREE.Quaternion().setFromAxisAngle( V( 0, 1, 0 ), ry ), V( 1, 1, 1 ) );

// half the opening between the main posts' centres, and the gate's reach either side (walls)
export const GATE = { half: 2.55, depth: 1.0, wall: 9.5 };

// iron strap round a squared timber: a slightly larger, thin box
const strap = ( L, x, y, z, w, d ) => L.add( 'stoneDark', box( w + 0.05, 0.11, d + 0.05 ), M( x, y, z ) );

// a hanging lantern (as the lane lamps, buildings.js lampPost): hook, cap, four bars, lit glass, base
function lantern( L, x, top, z, drop = 0.75 ) {
	const ly = top - drop;
	L.add( 'woodPost', beam( V( x, top, z ), V( x, ly + 0.42, z ), 0.012, 4 ) );
	L.add( 'woodPost', coneRoof( 0.17, ly + 0.36, ly + 0.48, { seg: 4, rings: 1, thick: 0.03 } ), M( x, 0, z, Math.PI / 4 ) );
	for ( const [ u, v ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] ) L.add( 'woodPost', box( 0.025, 0.34, 0.025 ), M( x + u * 0.085, ly + 0.02, z + v * 0.085 ) );
	L.add( 'ember', box( 0.15, 0.27, 0.15 ), M( x, ly + 0.05, z ) );
	L.add( 'woodPost', box( 0.22, 0.04, 0.22 ), M( x, ly, z ) );
}

// a banner hanging from a rod: red cloth with a forked tail and a pale algiz rune painted on it,
// facing -z (out of the village) and +z alike (the rune on both faces)
function banner( L, x, top, z, w = 0.55, h = 1.35 ) {
	L.add( 'woodPost', beam( V( x - w / 2 - 0.08, top, z ), V( x + w / 2 + 0.08, top, z ), 0.025, 5 ) );
	L.add( 'cloth', box( w, h - 0.25, 0.025 ), M( x, top - h + 0.25, z ) );
	// forked tail: two narrow strips
	for ( const s of [ - 1, 1 ] ) L.add( 'cloth', box( w * 0.42, 0.3, 0.025 ), M( x + s * w * 0.29, top - h, z ) );
	// rune ᛉ: a stem and two arms, a little proud of both faces
	const cy = top - h * 0.52;
	for ( const f of [ - 1, 1 ] ) {
		const zz = z + f * 0.018;
		L.add( 'canvas', beam( V( x, cy - 0.32, zz ), V( x, cy + 0.3, zz ), 0.022, 4 ) );
		L.add( 'canvas', beam( V( x, cy - 0.02, zz ), V( x - 0.17, cy + 0.26, zz ), 0.02, 4 ) );
		L.add( 'canvas', beam( V( x, cy - 0.02, zz ), V( x + 0.17, cy + 0.26, zz ), 0.02, 4 ) );
	}
}

// a gate leaf of vertical planks with two battens and a brace, its hinge edge at the origin,
// running along +x, standing from y = 0
function leaf( w, h, rnd ) {
	const L = new GeoBuilder();
	const n = 7, pw = w / n;
	for ( let i = 0; i < n; i ++ ) L.add( 'wood', box( pw - 0.012, h - rnd() * 0.18, 0.07 ), M( pw * ( i + 0.5 ), 0, 0 ) );
	for ( const y of [ 0.35, h - 0.55 ] ) L.add( 'woodPost', box( w - 0.1, 0.16, 0.06 ), M( w / 2, y, 0.065 ) );
	L.add( 'woodPost', beam( V( 0.15, 0.45, 0.07 ), V( w - 0.15, h - 0.5, 0.07 ), 0.045, 5 ) );
	for ( const y of [ 0.42, h - 0.47 ] ) L.add( 'stoneDark', box( 0.5, 0.06, 0.1 ), M( 0.25, y, 0.03 ) );
	return L;
}

// L: the GeoBuilder (village frame); x, z: the middle of the opening; rot: the gate's yaw (its local
// +z points into the village); hf: heightfield
export function entranceGate( L, hf, x, z, rot, seed = 7 ) {
	const rnd = mulberry32( seed );
	const c = Math.cos( rot ), s = Math.sin( rot );
	const ground = ( lx, lz ) => hf.heightAt( x + lx * c + lz * s, z - lx * s + lz * c );
	const G = new GeoBuilder();
	const y0 = ground( 0, 0.5 );
	const { half: hw, depth: D } = GATE;
	const top = y0 + 4.15; // underside of the lintels

	// ---- posts: the main pair (front, thick) and the back pair, rails between them
	for ( const sx of [ - 1, 1 ] ) {
		const px = sx * hw;
		for ( const [ pz, w, ht ] of [ [ 0, 0.38, 5.45 ], [ D, 0.3, 4.75 ] ] ) {
			const g = ground( px, pz );
			G.add( 'woodPost', box( w, y0 + ht - g + 0.45, w ), M( px, g - 0.45, pz, ( rnd() - 0.5 ) * 0.04 ) );
			// iron straps: low, at mid height and under the lintel
			for ( const hy of [ 0.9, 2.6 ] ) strap( G, px, y0 + hy, pz, w, w );
			strap( G, px, top - 0.14, pz, w, w );
		}
		for ( const hy of [ 1.15, 2.35 ] ) G.add( 'woodPost', box( 0.14, 0.16, D ), M( px, y0 + hy, D / 2 ) );
		// knee braces into the lintels, front and back
		for ( const pz of [ 0, D ] ) G.add( 'woodPost', beam( V( px, y0 + 2.95, pz ), V( sx * ( hw - 1.25 ), top + 0.02, pz ), 0.085, 6 ) );
	}
	// ---- lintels, cap beam with jutting ends, joists across
	for ( const pz of [ 0, D ] ) {
		G.add( 'woodPost', box( 2 * hw + 1.9, 0.34, 0.32 ), M( 0, top, pz ) );
		for ( const sx of [ - 1, 1 ] ) strap( G, sx * hw, top + 0.12, pz, 0.36, 0.36 );
	}
	G.add( 'woodPost', box( 2 * hw + 3.0, 0.3, 0.3 ), M( 0, top + 0.72, - 0.05 ) );
	for ( let i = 0; i < 7; i ++ ) {
		const jx = ( i / 6 - 0.5 ) * ( 2 * hw + 1.2 );
		G.add( 'woodPost', box( 0.18, 0.18, D + 1.1 ), M( jx, top + 0.34, D / 2 + ( rnd() - 0.5 ) * 0.1 ) );
	}

	// ---- the red cloth: over the top (bulging over the joists, the valance hanging outwards) and
	// down both sides to outer poles
	G.add( 'cloth', canopy( 2 * hw + 2.4, D + 2.2, top + 0.05, top + 0.68, - 0.18, 8 ), M( 0, 0, D / 2 - 0.3 ) );
	for ( const sx of [ - 1, 1 ] ) {
		const ox = sx * ( hw + 3.6 ); // the outer poles
		const lowY = y0 + 2.6;
		for ( const pz of [ - 0.45, D + 0.45 ] ) {
			const g = ground( ox, pz );
			G.add( 'woodPost', post( 0.07, lowY - g + 0.55 ), M( ox, g - 0.4, pz ) );
		}
		// a drape from the lintel's end (high, inner edge) to the poles (low, outer edge, valance)
		G.add( 'cloth', canopy( D + 1.2, 3.0, lowY + 0.05, top + 0.3, 0.55 ), M( sx * ( hw + 2.15 ), 0, D / 2, - sx * Math.PI / 2 ) );
	}

	// ---- banners: two under the front lintel, one on the left post's outer side; the lantern
	for ( const sx of [ - 1, 1 ] ) banner( G, sx * 1.45, top - 0.02, - 0.22, 0.5, 1.3 );
	banner( G, - ( hw + 0.75 ), top - 0.02, - 0.22, 0.6, 1.6 );
	lantern( G, 0, top, - 0.05, 0.85 );

	// ---- the gate leaves, swung open into the village against the posts' rails
	const lw = hw - 0.2, lh = 2.6;
	for ( const sx of [ - 1, 1 ] ) {
		const lg = leaf( lw, lh, rnd );
		const hx = sx * ( hw - 0.2 ), hz = D + 0.2;
		// the leaf's +x turned towards +z (opened ~80 degrees), on the inner side of the frame
		// (a turn only: a mirrored leaf would turn its faces inside out)
		const ry = sx < 0 ? - Math.PI / 2 + 0.18 : - Math.PI / 2 - 0.18;
		const m = M( hx, ground( hx - sx * 0.3, hz + 1.2 ) + 0.04, hz, ry );
		for ( const [ k, g ] of lg.build() ) G.add( k, g, m );
	}

	// ---- dry-stone walls from the posts outwards, kinked back a little
	for ( const sx of [ - 1, 1 ] ) {
		const pts = [ [ sx * ( hw + 0.25 ), 0.3 ], [ sx * ( hw + 4.4 ), 0.55 ], [ sx * GATE.wall, 1.6 ] ];
		for ( let i = 1; i < pts.length; i ++ ) {
			const [ ax, az ] = pts[ i - 1 ], [ bx, bz ] = pts[ i ];
			G.add( 'stoneDark', straightWall( V( ax, 0, az ), V( bx, 0, bz ), 1.75 - i * 0.12, 1.0, ground( ax, az ) - 0.15, ground( bx, bz ) - 0.15 ) );
		}
	}

	for ( const [ k, g ] of G.build() ) L.add( k, g, M( x, 0, z, rot ) );
}

// world points (x, z) the gate stands on, for the clearances (vegetation, rocks, lane fences): the
// frame, the side drapes' poles and the walls
export function gateFootprint( p ) {
	const c = Math.cos( p.rot || 0 ), s = Math.sin( p.rot || 0 );
	const out = [];
	for ( let lx = - GATE.wall; lx <= GATE.wall; lx += 1.5 ) for ( const lz of [ - 0.4, 0.6, 1.6 ] ) out.push( [ p.x + lx * c + lz * s, p.z - lx * s + lz * c ] );
	return out;
}

// ---------------------------------------------------------------------------
// Rustic archway (ref/ref_entrada.jpg, "Rustic village archway"): unhewn oak logs, a pair on each
// side, a main beam and a secondary upper beam across, raking struts down to log footings behind,
// rope lashings at the joints and a horned skull on the right post. ~4 m wide, 3.5 m high. The ivy
// hanging from the beam and climbing the right post is vegetation (trees.js ivyGeometry, placed by
// vegetation.js on the same frame: ARCH_IVY_Y above the ground at the middle).
// Local frame as the gate's: x across the path, +z into the hamlet.
// ---------------------------------------------------------------------------
export const ARCH = { half: 2.0, beamY: 3.15 };

// rope lashing: a few turns of a thin ring round a log (axis along `dir`), straw-coloured (the thatch)
function lashing( L, at, dir, r, turns = 3 ) {
	const q = new THREE.Quaternion().setFromUnitVectors( V( 0, 0, 1 ), dir.clone().normalize() );
	for ( let k = 0; k < turns; k ++ ) {
		const g = new THREE.TorusGeometry( r + 0.02, 0.016, 4, 12 );
		const off = dir.clone().normalize().multiplyScalar( ( k - ( turns - 1 ) / 2 ) * 0.05 );
		L.add( 'thatch', g, new THREE.Matrix4().compose( at.clone().add( off ), q, V( 1, 1, 1 ) ) );
	}
}

export function rusticArch( L, hf, x, z, rot, seed = 11 ) {
	const rnd = mulberry32( seed );
	const c = Math.cos( rot ), s = Math.sin( rot );
	const ground = ( lx, lz ) => hf.heightAt( x + lx * c + lz * s, z - lx * s + lz * c );
	const G = new GeoBuilder();
	const y0 = ground( 0, 0 );
	const { half: hw, beamY } = ARCH;
	const log = ( a, b, r ) => G.add( 'woodPost', beam( a, b, r, 7 ) );

	// posts: two logs side by side on each side, leaning a touch
	for ( const sx of [ - 1, 1 ] ) {
		for ( const [ dx, r, h ] of [ [ - 0.14, 0.14, 3.75 ], [ 0.14, 0.12, 3.45 ] ] ) {
			const px = sx * hw + dx * sx, g = ground( px, 0 );
			log( V( px, g - 0.4, 0 ), V( px + ( rnd() - 0.5 ) * 0.08, y0 + h, ( rnd() - 0.5 ) * 0.08 ), r );
		}
		// round both logs of the pair (the rings' axis up the posts)
		lashing( G, V( sx * hw, y0 + 1.1, 0 ), V( 0, 1, 0 ), 0.27, 3 );
		lashing( G, V( sx * hw, y0 + 2.2, 0 ), V( 0, 1, 0 ), 0.27, 2 );
		// raking strut from high on the posts down to a footing log behind
		const fz = 1.7 + rnd() * 0.3, fx = sx * ( hw + 0.15 );
		const gf = ground( fx, fz );
		log( V( sx * hw, y0 + 2.75, 0.12 ), V( fx, gf + 0.12, fz ), 0.1 );
		log( V( fx - 0.35, gf + 0.05, fz + 0.1 ), V( fx + 0.35, gf + 0.05, fz - 0.1 ), 0.09 );
		lashing( G, V( sx * hw, y0 + 2.72, 0.12 ), V( 0, 1, 0 ), 0.2, 2 );
	}
	// beams: the main one, the secondary upper one a little behind, and a cross brace between them
	log( V( - hw - 0.75, y0 + beamY, - 0.05 ), V( hw + 0.75, y0 + beamY + ( rnd() - 0.5 ) * 0.1, - 0.05 ), 0.15 );
	log( V( - hw - 0.4, y0 + beamY + 0.42, 0.22 ), V( hw + 0.55, y0 + beamY + 0.36, 0.22 ), 0.12 );
	log( V( - hw - 0.1, y0 + beamY - 0.55, 0.05 ), V( 0.4, y0 + beamY + 0.4, 0.12 ), 0.08 );
	log( V( hw + 0.1, y0 + beamY - 0.6, 0.05 ), V( 0.9, y0 + beamY + 0.05, 0.05 ), 0.08 );
	for ( const sx of [ - 1, 1 ] ) {
		lashing( G, V( sx * hw, y0 + beamY, - 0.05 ), V( 1, 0, 0 ), 0.2, 3 );
		lashing( G, V( sx * hw, y0 + beamY + 0.4, 0.2 ), V( 1, 0, 0 ), 0.17, 2 );
	}
	lashing( G, V( 0.4, y0 + beamY + 0.4, 0.15 ), V( 1, 0, 0 ), 0.15, 2 );

	// horned skull on the right post's top as one comes in (local -x: facing +z, +x is on the left;
	// bone: the undyed canvas), the horns sweeping back
	{
		const sx = - hw - 0.14, sy = y0 + 3.1, sz = - 0.2;
		const skull = new THREE.SphereGeometry( 0.15, 8, 6 ).scale( 0.9, 0.85, 1.1 );
		G.add( 'canvas', skull, M( sx, sy + 0.12, sz ) );
		G.add( 'canvas', box( 0.12, 0.24, 0.12 ), M( sx, sy - 0.2, sz - 0.07 ) );
		G.add( 'doorway', box( 0.04, 0.04, 0.02 ), M( sx - 0.05, sy + 0.12, sz - 0.16 ) );
		G.add( 'doorway', box( 0.04, 0.04, 0.02 ), M( sx + 0.05, sy + 0.12, sz - 0.16 ) );
		for ( const k of [ - 1, 1 ] ) {
			let p = V( sx + k * 0.08, sy + 0.24, sz + 0.02 ), r = 0.045;
			for ( let i = 0; i < 4; i ++ ) {
				const q = p.clone().add( V( k * 0.06, 0.12 - i * 0.02, 0.05 + i * 0.03 ) );
				G.add( 'woodPost', beam( p, q, r, 5 ) );
				p = q; r *= 0.75;
			}
		}
		// a few feathers hanging beside it
		for ( let i = 0; i < 3; i ++ ) G.add( 'woodPost', box( 0.035, 0.32, 0.01 ), M( sx - 0.16 - i * 0.03, sy - 0.25 - i * 0.05, sz + 0.05, 0.3 * i ) );
	}

	for ( const [ k, g ] of G.build() ) L.add( k, g, M( x, 0, z, rot ) );
	return y0;
}

// world points an entrance (layout PROPS 'gate' / 'arch') stands on, for the clearances
export function entranceFootprint( p ) {
	if ( p.type === 'gate' ) return gateFootprint( p );
	const c = Math.cos( p.rot || 0 ), s = Math.sin( p.rot || 0 );
	const out = [];
	for ( let lx = - 4.4; lx <= 4.4; lx += 1.1 ) for ( const lz of [ - 1, 0.4, 1.8 ] ) out.push( [ p.x + lx * c + lz * s, p.z - lx * s + lz * c ] );
	return out;
}
