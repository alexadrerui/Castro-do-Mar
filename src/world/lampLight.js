import * as THREE from 'three/webgpu';
import { texture, uniform, vec2, smoothstep, positionWorld, diffuseColor } from 'three/tsl';
import { MASK } from './layout.js';

// The light the lanterns and the lit windows cast on the ground at night (idea from Nightscape's
// baked "lamps" texture, WeebLabs; no code taken). No light source: the pool of light under every
// lantern is baked once on the CPU into a half-float texture over the mask area (MASK, 640 m at
// 1024 = 0.625 m a texel), and the terrain and the grass add albedo × that light to their emissive.
// One texture fetch, no new pipeline (the terrain and grass shaders just gain the term).
//
// The lamps are found from the scene itself: every mesh drawn with the ember material (lane lamps,
// the gate's lanterns, the mine's lantern, the windows with the hearth's glow behind them), its
// vertices clustered into glowing pieces. A wide piece is a window (weak, short reach), a small cube
// a lantern; a glow less than half a metre above the ground (the castro house's hearth, the
// furnace's mouth) is left out.
//
// app.lampLight: on (with the night; main.js), gain, color, lamps (the found list), bake( root ).

const RES = 1024;
const data = new Uint16Array( RES * RES );
const tex = new THREE.DataTexture( data, RES, RES, THREE.RedFormat, THREE.HalfFloatType );
tex.magFilter = tex.minFilter = THREE.LinearFilter;
tex.generateMipmaps = false;
tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
tex.needsUpdate = true;

export const lampLight = {
	on: uniform( 0 ),        // 0 by day, 1 at night (main.js, from the look's night)
	gain: uniform( 1.6 ),    // the light right under a lantern, as an irradiance on the albedo
	color: uniform( new THREE.Color().setRGB( 1.0, 0.55, 0.22 ) ), // the embers' warm glow (linear)
	tex,
	lamps: [],
	bake: bakeLamps
};

// The lamps' light at a world point, already × the surface's albedo (diffuseColor): an emissive term.
export function lampGlow( xz = positionWorld.xz ) {
	const uv = xz.sub( vec2( MASK.centerX - MASK.size / 2, MASK.centerZ - MASK.size / 2 ) ).div( MASK.size );
	const inside = smoothstep( 0.0, 0.002, uv.x ).mul( smoothstep( 0.998, 1.0, uv.x ).oneMinus() )
		.mul( smoothstep( 0.0, 0.002, uv.y ) ).mul( smoothstep( 0.998, 1.0, uv.y ).oneMinus() );
	return diffuseColor.rgb.mul( lampLight.color ).mul( texture( tex, uv ).r.mul( inside ).mul( lampLight.gain ).mul( lampLight.on ) );
}

const LANTERN = { strength: 1, reach: 11 };
const WINDOW = { strength: 0.3, reach: 4.5 };

// root: the groups holding the lamps (after they are in the scene); ember: the ember material;
// hf: the heightfield (ground height under each glow).
function bakeLamps( roots, ember, hf ) {
	const pts = [];
	const v = new THREE.Vector3();
	for ( const root of roots ) {
		root.updateMatrixWorld( true );
		root.traverse( ( o ) => {
			if ( ! o.isMesh || o.material !== ember || ! o.geometry?.attributes.position ) return;
			const p = o.geometry.attributes.position;
			for ( let i = 0; i < p.count; i ++ ) {
				v.fromBufferAttribute( p, i ).applyMatrix4( o.matrixWorld );
				pts.push( v.x, v.y, v.z );
			}
		} );
	}
	// cluster the vertices into glowing pieces: a point joins the piece whose first point lies within
	// 0.7 m (the largest piece, a window's glass, is 0.52 m across); 1 m cells to find it
	const cells = new Map(), pieces = [];
	const key = ( i, j, k ) => i + ',' + j + ',' + k;
	for ( let n = 0; n < pts.length; n += 3 ) {
		const x = pts[ n ], y = pts[ n + 1 ], z = pts[ n + 2 ];
		const ci = Math.floor( x ), cj = Math.floor( y ), ck = Math.floor( z );
		let found = null;
		for ( let a = - 1; a <= 1 && ! found; a ++ ) for ( let b = - 1; b <= 1 && ! found; b ++ ) for ( let c = - 1; c <= 1 && ! found; c ++ ) {
			for ( const q of cells.get( key( ci + a, cj + b, ck + c ) ) ?? [] ) {
				if ( ( q.x - x ) ** 2 + ( q.y - y ) ** 2 + ( q.z - z ) ** 2 < 0.49 ) { found = q; break; }
			}
		}
		if ( ! found ) {
			found = { x, y, z, min: [ x, y, z ], max: [ x, y, z ] };
			pieces.push( found );
			const kk = key( ci, cj, ck );
			if ( ! cells.has( kk ) ) cells.set( kk, [] );
			cells.get( kk ).push( found );
		}
		found.min[ 0 ] = Math.min( found.min[ 0 ], x ); found.max[ 0 ] = Math.max( found.max[ 0 ], x );
		found.min[ 1 ] = Math.min( found.min[ 1 ], y ); found.max[ 1 ] = Math.max( found.max[ 1 ], y );
		found.min[ 2 ] = Math.min( found.min[ 2 ], z ); found.max[ 2 ] = Math.max( found.max[ 2 ], z );
	}
	const lamps = [];
	for ( const q of pieces ) {
		const cx = ( q.min[ 0 ] + q.max[ 0 ] ) / 2, cy = ( q.min[ 1 ] + q.max[ 1 ] ) / 2, cz = ( q.min[ 2 ] + q.max[ 2 ] ) / 2;
		const h = cy - hf.heightAt( cx, cz );
		if ( h < 0.5 ) continue; // a hearth on the floor, the furnace's mouth
		// a window's glass is ~0.5 m wide (≥ 0.33 m along x or z however it is turned), a lantern 0.15 m
		const wide = Math.max( q.max[ 0 ] - q.min[ 0 ], q.max[ 2 ] - q.min[ 2 ] ) > 0.3;
		lamps.push( { x: cx, y: cy, z: cz, h, window: wide } );
	}
	// the pool of light: the illuminance on flat ground from a point at height h, relative to the spot
	// right under it, h³ / (d² + h²)^1.5, eased to 0 at the reach
	const acc = new Float32Array( RES * RES );
	const texel = MASK.size / RES, x0 = MASK.centerX - MASK.size / 2, z0 = MASK.centerZ - MASK.size / 2;
	for ( const l of lamps ) {
		const K = l.window ? WINDOW : LANTERN;
		const h = Math.max( l.h, 0.6 ), h3 = h * h * h, R = K.reach, R2 = R * R;
		const i0 = Math.max( 0, Math.floor( ( l.x - R - x0 ) / texel ) ), i1 = Math.min( RES - 1, Math.ceil( ( l.x + R - x0 ) / texel ) );
		const j0 = Math.max( 0, Math.floor( ( l.z - R - z0 ) / texel ) ), j1 = Math.min( RES - 1, Math.ceil( ( l.z + R - z0 ) / texel ) );
		for ( let j = j0; j <= j1; j ++ ) {
			const dz = z0 + ( j + 0.5 ) * texel - l.z;
			for ( let i = i0; i <= i1; i ++ ) {
				const dx = x0 + ( i + 0.5 ) * texel - l.x, d2 = dx * dx + dz * dz;
				if ( d2 >= R2 ) continue;
				const ease = ( 1 - d2 / R2 ) ** 2;
				acc[ j * RES + i ] += K.strength * h3 / Math.pow( d2 + h * h, 1.5 ) * ease;
			}
		}
	}
	for ( let n = 0; n < acc.length; n ++ ) data[ n ] = THREE.DataUtils.toHalfFloat( Math.min( acc[ n ], 4 ) );
	tex.needsUpdate = true;
	lampLight.lamps = lamps;
	return lamps;
}
