// Adapted from Tidewater (https://github.com/dgreenheck/tidewater, src/world/reef/ReefMaterials.js,
// three.js version at d32799f). MIT License, Copyright (c) 2026 DRG Software Solutions LLC.
// Changes: one opaque batch (no alpha-tested fans), no LOD cross-fade and no motion vectors (no
// TAA here), an analytic swell only (no FFT ocean), translucency as an emissive term (our
// materials have no translucency hook), and the surfaces of a cold Atlantic seabed: granite with
// coralline crusts, kelps, sea lettuce, mussels, rock urchins, snakelocks anemones, starfish.
import * as THREE from 'three/webgpu';
import {
	Fn, If, float, vec2, vec3, uint, attribute, positionLocal, normalLocal, positionView,
	normalView, normalWorldGeometry, faceDirection, varyingProperty, floor, step, texture3D, sin, cos, mix, smoothstep, saturate, dot, cross,
	normalize, length, abs, fract, max, min, pow, fwidth, select, mx_cell_noise_float, time,
} from 'three/tsl';
import { NOISE_SCALE } from './noise3d.js';

// TSL materials of the seabed. All surface detail is procedural; the only texture is a small
// tileable 3D noise volume (noise3d.js) that replaces per-pixel noise evaluation: one fetch
// gives four noise values.
//
// The vertex stage: the instance record (see seabed.js) places, rotates and scales the model,
// massive forms get a per-instance warp, flexible organisms sway with the surge of the swell,
// and everything the fragment stage needs is passed as a few varyings.
//
// Instance record (4 x vec4):
//   r0 = ( position.xyz, scale )    r1 = orientation quaternion
//   r2 = ( colour 1, colour 2 (packed sRGB 8:8:8), draw distance (whole m) + seed, surface type )
//   r3 = ( stretch.xyz, flexibility (> 0) or shape warp (< 0) )
//
// Surfaces are close to water in refractive index, so underwater they show almost no specular
// reflection: specular intensity is kept low except on glossy blades and shells.

export const aData = attribute( 'aData', 'vec4' );

export const SURFACE = {
	rock: 0, urchin: 1, anemone: 2, rubble: 3, grass: 4, kelp: 5, ulva: 6, algae: 7, star: 8, mussel: 9, cucumber: 10,
};

const TAU = Math.PI * 2;

export const srgb = ( hex ) => {

	const c = new THREE.Color( hex );
	return vec3( c.r, c.g, c.b );

};

// packs a colour as 8 bit sRGB into a float (exact: 24 bits)
export const packColor = ( c ) => c.getHex();

const unpackColor = ( f ) => {

	const u = uint( f.add( 0.5 ) ); // the value is exact, but interpolation may leave it a hair below
	const c = vec3( float( u.shiftRight( 16 ).bitAnd( 255 ) ), float( u.shiftRight( 8 ).bitAnd( 255 ) ), float( u.bitAnd( 255 ) ) ).div( 255 );
	return pow( c, vec3( 2.2 ) );

};

export const rotateQ = ( q, v ) => v.add( cross( q.xyz, cross( q.xyz, v ).add( v.mul( q.w ) ) ).mul( 2 ) );

// Horizontal water displacement (m) at xz that sways the seabed back and forth: the
// long-period surge of the ground swell, a coherent analytic wave train travelling with the
// swell (in shallow water its orbits reach the bottom almost undiminished).
export function makeSurge( swell ) {

	const dir = vec2( swell.x, swell.y );
	const side = vec2( - swell.y, swell.x );
	return ( xz ) => {

		const along = dot( xz, dir ), across = dot( xz, side );
		const a = sin( time.mul( TAU / 8.2 ).sub( along.mul( TAU / 70 ) ).add( sin( across.mul( 0.021 ) ).mul( 1.5 ) ) ).mul( 0.3 );
		const b = sin( time.mul( TAU / 5.3 ).sub( along.mul( TAU / 34 ) ).add( across.mul( 0.09 ) ) ).mul( 0.1 );
		const c = sin( time.mul( TAU / 11.7 ).add( across.mul( TAU / 45 ) ) ).mul( 0.07 );
		return dir.mul( a.add( b ) ).add( side.mul( c ) );

	};

}

// varyings shared by the fragment stage (kept small)
const vColors = varyingProperty( 'vec2', 'vSeaColors' ); // two packed sRGB colours
export const V = {
	local: varyingProperty( 'vec3', 'vSeaLocal' ), // object-space position (m)
	data: varyingProperty( 'vec4', 'vSeaData' ), // aData
	info: varyingProperty( 'vec3', 'vSeaInfo' ), // seed, surface type, scale
};

// Fragment stage: the two instance colours (linear).
export const seaColors = () => [ unpackColor( vColors.x ), unpackColor( vColors.y ) ];

// Vertex stage: returns the world position (the batch mesh has an identity transform) and
// writes the normal and the varyings. view = { position, range } uniforms: the main camera and
// the draw distance; instances shrink away over the last fifth of their draw distance so that
// nothing pops when the culling adds or drops them.
export function seabedVertex( batch, surge, view, waterLevel, swell ) {

	const swellDir = vec2( swell.x, swell.y );
	return Fn( () => {

		const index = batch.recordIndex();
		const rec = batch.record( index );
		const r0 = rec[ 0 ], q = rec[ 1 ], r2 = rec[ 2 ], r3 = rec[ 3 ];
		const seed = fract( r2.z ); // integer part: the instance's draw distance (m)
		const fadeEnd = min( floor( r2.z ), view.range );
		const grow = float( 1 ).sub( smoothstep( fadeEnd.mul( 0.75 ), fadeEnd.mul( 0.95 ), length( r0.xyz.sub( view.position ) ) ) );
		const scale = r3.xyz.mul( r0.w );
		const p = positionLocal.mul( scale ).toVar();
		V.local.assign( p );
		V.data.assign( aData );
		vColors.assign( r2.xy );
		V.info.assign( vec3( seed, r2.w, r0.w ) );
		normalLocal.assign( normalize( rotateQ( q, normalLocal.div( scale ) ) ) );
		const flex = r3.w;
		If( flex.lessThan( 0 ), () => {

			// massive forms: a smooth per-instance warp so no two look cloned (the base stays put)
			const w = positionLocal.mul( 3.1 ).add( seed.mul( 17 ) );
			const off = vec3( sin( w.y.mul( 1.7 ).add( w.z ) ), sin( w.z.mul( 1.3 ).add( w.x.mul( 1.1 ) ) ).mul( 0.6 ), sin( w.x.mul( 1.9 ).add( w.y.mul( 0.7 ) ) ) );
			p.addAssign( off.mul( flex.negate().mul( r0.w ).mul( aData.x.mul( 0.8 ).add( 0.2 ) ) ) );

		} );
		const world = rotateQ( q, p.mul( grow ) ).add( r0.xyz ).toVar();
		If( flex.greaterThan( 0 ), () => {

			// bend grows with the square of the position along the organism; tips lag behind
			const t = aData.x;
			const h = max( world.y.sub( r0.y ), 0 );
			const s = surge( r0.xz.sub( swellDir.mul( h.mul( 4 ) ) ) );
			const ph = time.mul( 1.7 ).add( seed.mul( 40 ) ).add( aData.w.mul( 12 ) );
			const bend = flex.mul( t ).mul( t ).mul( grow );
			const d = s.add( vec2( sin( ph ), cos( ph.mul( 0.77 ) ) ).mul( 0.06 ) ).mul( bend );
			world.addAssign( vec3( d.x, dot( d, d ).div( max( h, 0.1 ).mul( 2 ) ).negate(), d.y ) );
			// never above the surface
			world.y.assign( min( world.y, float( waterLevel - 0.05 ) ) );

		} );
		return world;

	} )();

}

// ---------------------------------------------------------------------------
// fragment helpers

// pixel footprint in meters, and a 1 -> 0 fade for patterns of the given spacing
const pixel = () => length( fwidth( positionView ) ).mul( 0.7 );
const fade = ( spacing, px ) => float( 1 ).sub( smoothstep( 0.25, 0.6, px.div( spacing ) ) );

// view-space bump mapping from a scalar height field (Mikkelsen's surface gradient)
export const bumpNormal = ( height ) => {

	const dpdx = positionView.dFdx(), dpdy = positionView.dFdy();
	const dhdx = height.dFdx(), dhdy = height.dFdy();
	const n = normalView.mul( faceDirection );
	const r1 = cross( dpdy, n ), r2 = cross( n, dpdx );
	const det = dot( dpdx, r1 );
	const grad = det.sign().mul( dhdx.mul( r1 ).add( dhdy.mul( r2 ) ) );
	return normalize( det.abs().mul( n ).sub( grad ) );

};

const hue = ( c, n, amount ) => c.mul( vec3( 1 ).add( vec3( n, n.mul( 0.5 ), n.mul( - 0.5 ) ).mul( amount ) ) );

// Round features on a jittered 3D grid of `size` meters (one hash per pixel): distance from
// the cell's feature point (0 .. ~0.9) and a random value per cell.
const cells = ( p, size ) => {

	const q = p.div( size );
	const h = mx_cell_noise_float( floor( q ) );
	const c = vec3( h, fract( h.mul( 7.13 ) ), fract( h.mul( 3.71 ) ) ).mul( 0.3 ).add( 0.35 );
	return { d: length( fract( q ).sub( c ) ), h };

};

// ---------------------------------------------------------------------------

// sun: { dir (uniform vec3, toward the sun), color (uniform colour x intensity) } for the light
// shining through thin tissue (blades, sheets)
export function createSeabedMaterial( { batch, noise, view, sun, waterLevel = 0, swell = new THREE.Vector2( - 1, 0 ) } ) {

	const surge = makeSurge( swell );
	// four noise values per fetch; the tile holds 8 noise cells, so sampling at p * k gives
	// features of 1 / ( 8 k ) m
	const volNode = texture3D( noise );
	const vol = ( p ) => volNode.sample( p ).sub( 0.5 ).mul( NOISE_SCALE );

	const mat = new THREE.MeshPhysicalNodeMaterial( { roughness: 0.8, metalness: 0 } );
	mat.name = 'Seabed';
	mat.positionNode = seabedVertex( batch, surge, view, waterLevel, swell );

	const albedo = vec3( 0 ).toVar( 'seaAlbedo' );
	const height = float( 0 ).toVar( 'seaHeight' );
	const rough = float( 0.8 ).toVar( 'seaRough' );
	const occl = float( 1 ).toVar( 'seaOcc' );
	const spec = float( 0.3 ).toVar( 'seaSpec' );
	const thin = float( 0 ).toVar( 'seaThin' ); // light passing through thin tissue (blades, sheets)

	mat.colorNode = Fn( () => {

		// everything shared by the branches is computed up front (a node first built inside a
		// branch would only be assigned there)
		const [ uc1, uc2 ] = seaColors();
		const L = V.local.toVar(), D = V.data.toVar(), c1 = uc1.toVar(), c2 = uc2.toVar();
		const seed = V.info.x.toVar(), type = V.info.y.add( 0.5 ).floor().toVar();
		const t = D.x.toVar(), ao = D.y.toVar(), part = D.z.toVar(), rnd = D.w.toVar();
		const px = pixel().toVar();
		const P = L.add( seed.mul( 17.0 ) ).toVar();
		const A = vol( P.mul( 0.4 ) ).toVar(); // ~30 cm features
		const B = vol( P.mul( 1.25 ).add( 0.37 ) ).toVar(); // ~10 cm features
		const n1 = A.x, n2 = B.x; // mottling, blotches
		const base = hue( c1, n1, 0.18 ).mul( float( 1 ).add( n2.mul( 0.12 ) ) ).toVar();
		albedo.assign( base );
		occl.assign( ao );
		height.assign( 0 );
		rough.assign( 0.8 );
		spec.assign( 0.3 );
		thin.assign( select( type.equal( SURFACE.grass ).or( type.equal( SURFACE.algae ) ), 0.55,
			select( type.equal( SURFACE.ulva ), 0.7, select( type.equal( SURFACE.kelp ).and( part.greaterThan( 0.5 ) ), 0.4, 0 ) ) ) );
		const up = saturate( normalWorldGeometry.y ).toVar();

		If( type.equal( SURFACE.rock ), () => {

			// granite under water: grey stone with feldspar speckle, olive-brown algal turf and a
			// sediment veneer on the tops, pink crustose coralline algae spreading over sides and
			// edges, small encrusting sponges (orange / yellow) in the shade, pits and cracks
			const n3 = A.y, n4 = B.y;
			// fine speckle and grain, fetched only where they are resolved
			const speck = float( 0 ).toVar(), grainF = float( 0 ).toVar();
			const fs = fade( 0.04, px );
			If( fs.greaterThan( 0.001 ), () => {

				speck.assign( vol( P.mul( 3.2 ).add( 0.71 ) ).x.mul( fs ) );
				const fg = fade( 0.012, px );
				If( fg.greaterThan( 0.001 ), () => {

					const gv = vol( P.mul( 12 ).add( 1.7 ) );
					grainF.assign( gv.x.add( gv.y.mul( 0.5 ) ).mul( fg ) );

				} );

			} );
			// granite: feldspar / quartz speckle (pale) and dark mica
			let c = base.mul( float( 0.9 ).add( grainF.mul( 0.25 ) ) );
			const turfC = mix( srgb( 0x4e4a30 ), srgb( 0x6a6238 ), smoothstep( - 0.4, 0.4, n2.add( speck.mul( 0.6 ) ) ) );
			c = mix( c, turfC, smoothstep( - 0.2, 0.35, n1.add( up.mul( 0.45 ) ) ).mul( 0.75 ) );
			// sediment veneer on flat tops
			c = mix( c, srgb( 0x8e8672 ), smoothstep( 0.82, 0.97, up ).mul( smoothstep( - 0.1, 0.3, A.z ) ).mul( 0.5 ) );
			// coralline crusts
			const cca = smoothstep( 0.0, 0.3, n3.mul( 0.7 ).add( n4.mul( 0.5 ) ) ).mul( float( 1 ).sub( up.mul( 0.4 ) ) );
			c = mix( c, c2.mul( float( 0.88 ).add( speck.mul( 0.2 ) ).add( grainF.mul( 0.25 ) ) ), cca.mul( 0.85 ) );
			// encrusting sponges on the shaded sides
			const sp = smoothstep( 0.32, 0.4, B.w.add( A.z.mul( 0.3 ) ) ).mul( float( 1 ).sub( up.mul( 0.8 ) ) );
			const spC = mix( srgb( 0xc0662c ), srgb( 0xc8a02c ), smoothstep( - 0.2, 0.2, A.y ) );
			c = mix( c, spC, sp.mul( 0.85 ) );
			// pits of varied size
			const pc = cells( P, 0.03 );
			const pitR = pc.h.mul( 0.16 ).add( 0.06 );
			const pit = float( 1 ).sub( smoothstep( pitR, pitR.add( 0.08 ), pc.d ) ).mul( step( 0.6, fract( pc.h.mul( 5.3 ) ) ) ).mul( smoothstep( 0.0, 0.3, A.w.negate() ) ).mul( fade( 0.045, px ) );
			// rugged relief: ridged creases at two scales, rough grain; crevices stay dark
			const r3 = float( 1 ).sub( abs( n3 ) ).mul( 2 ).sub( 1 );
			const r4 = float( 1 ).sub( abs( n4 ) ).mul( 2 ).sub( 1 );
			const grain = speck.mul( 1.4 );
			const cav = smoothstep( - 0.9, 0.2, r4.add( grain.mul( 0.4 ) ).add( grainF.mul( 0.3 ) ) );
			c = c.mul( float( 0.9 ).add( speck.mul( 0.2 ) ) ).mul( float( 1 ).sub( pit.mul( mix( 0.35, 0.7, pc.h ) ) ) ).mul( mix( 0.72, 1.0, cav ) );
			albedo.assign( c );
			height.assign( n1.mul( 0.04 ).add( r3.mul( 0.012 ) ).add( r4.mul( 0.006 ) ).add( grain.mul( 0.003 ) ).add( grainF.mul( 0.0018 ) )
				.add( sp.mul( 0.002 ) ).add( cca.mul( 0.0015 ) ).sub( pit.mul( 0.008 ) ) );
			occl.assign( occl.mul( float( 1 ).sub( pit.mul( 0.5 ) ) ).mul( mix( 0.65, 1.0, cav ) ) );
			rough.assign( 0.95 );

		} ).ElseIf( type.equal( SURFACE.kelp ), () => {

			// kelps: glossy golden-brown fronds, darker toward the base of each blade, worn, paler
			// and tattered at the tips; the stipe and holdfast are rough and dark, the upper stipe
			// of Laminaria hyperborea carries red algal epiphytes (colour 2)
			const frond = part.greaterThan( 0.5 );
			const along = saturate( part.sub( 1 ).div( 0.9 ) );
			const streak = vol( vec3( P.x.mul( 0.4 ), along.mul( 3 ), P.z.mul( 0.4 ) ) ).x;
			const blade = base.mul( mix( 0.62, 1.08, smoothstep( 0.0, 0.45, along ) ) ).mul( float( 0.92 ).add( streak.mul( 0.12 ) ) ).mul( mix( 0.85, 1.12, rnd ) );
			const worn = mix( blade, blade.mul( vec3( 1.25, 1.18, 0.9 ) ), smoothstep( 0.78, 1.0, along ).mul( 0.7 ) );
			const epi = smoothstep( 0.05, 0.35, B.y.add( t.mul( 0.8 ) ).sub( 0.3 ) ).mul( smoothstep( 0.15, 0.4, t ) );
			const stipe = mix( base.mul( 0.45 ), c2, epi.mul( 0.85 ) );
			albedo.assign( select( frond, worn, stipe ) );
			height.assign( select( frond, streak.mul( 0.0015 ), B.z.mul( 0.004 ).add( epi.mul( 0.004 ) ) ) );
			rough.assign( select( frond, 0.42, 0.9 ) );
			spec.assign( select( frond, 0.55, 0.2 ) );

		} ).ElseIf( type.equal( SURFACE.ulva ), () => {

			// sea lettuce: bright, translucent green sheets, paler along the thin margins
			albedo.assign( mix( base, c2, part.mul( 0.5 ) ).mul( mix( 0.85, 1.1, rnd ) ).mul( float( 0.94 ).add( n2.mul( 0.1 ) ) ) );
			rough.assign( 0.5 );
			spec.assign( 0.45 );

		} ).ElseIf( type.equal( SURFACE.mussel ), () => {

			// mussels: blue-black shells, brown periostracum worn through at the umbo, fine
			// growth lines, glossy when wet; some barnacle-crusted
			const lines = sin( P.y.mul( 420 ).add( n2.mul( 6 ) ) ).mul( fade( 0.004, px ) );
			const umbo = float( 1 ).sub( smoothstep( 0.0, 0.35, t ) );
			const crust = smoothstep( 0.25, 0.45, B.w.add( rnd.mul( 0.3 ) ) );
			const shell = mix( base, c2, umbo.mul( 0.6 ) ).mul( float( 0.9 ).add( lines.mul( 0.1 ) ) );
			albedo.assign( mix( shell, srgb( 0x9a9486 ), crust.mul( 0.7 ) ) );
			height.assign( lines.mul( 0.0003 ).add( crust.mul( 0.002 ) ) );
			rough.assign( mix( 0.3, 0.85, crust ) );
			spec.assign( mix( 0.9, 0.2, crust ) );

		} ).ElseIf( type.equal( SURFACE.urchin ), () => {

			// rock urchin: dense short spines (violet / olive / brown), a dark test
			const band = sin( t.mul( 40 ) ).mul( 0.5 ).add( 0.5 ).mul( part ).mul( 0.15 );
			albedo.assign( mix( c2, c1, part ).add( band.mul( 0.02 ) ) );
			rough.assign( 0.45 );
			spec.assign( 0.8 );

		} ).ElseIf( type.equal( SURFACE.anemone ), () => {

			// snakelocks anemone: green tentacles with violet tips
			albedo.assign( mix( c1, c2, smoothstep( 0.55, 1.0, t ).mul( part ) ) );
			rough.assign( 0.55 );
			spec.assign( 0.6 );

		} ).ElseIf( type.equal( SURFACE.star ), () => {

			// starfish: orange / violet with pale spines in rows
			const sc = cells( P, 0.006 );
			const spine = float( 1 ).sub( smoothstep( 0.15, 0.3, sc.d ) ).mul( fade( 0.006, px ) );
			albedo.assign( mix( base, c2, spine.mul( 0.8 ) ) );
			height.assign( spine.mul( 0.0008 ) );
			rough.assign( 0.8 );

		} ).ElseIf( type.equal( SURFACE.rubble ), () => {

			// rubble: pale shell fragments and granite pebbles with turf
			const shellC = mix( srgb( 0xcfc6b4 ), srgb( 0xa89c88 ), n2.mul( 0.5 ).add( 0.5 ) );
			const pebble = mix( base, srgb( 0x5a563a ), smoothstep( 0.1, 0.5, n1 ).mul( 0.5 ) );
			albedo.assign( mix( pebble, shellC, part ) );
			rough.assign( 0.85 );

		} ).ElseIf( type.equal( SURFACE.cucumber ), () => {

			// sea cucumber: dark brown, warty
			const wc = cells( P, 0.012 );
			const wart = float( 1 ).sub( smoothstep( 0.1, 0.3, wc.d ) ).mul( fade( 0.012, px ) );
			albedo.assign( base.mul( float( 0.85 ).add( wart.mul( 0.3 ) ) ) );
			height.assign( wart.mul( 0.002 ) );
			rough.assign( 0.7 );

		} ).ElseIf( type.equal( SURFACE.algae ), () => {

			// bushy brown algae: olive-golden fronds, darker wiry axes, amber bladders
			const leaf = select( part.greaterThan( 0.5 ).and( part.lessThan( 1.5 ) ), 1, 0 );
			const bladder = select( part.greaterThan( 1.5 ), 1, 0 );
			const tone = base.mul( mix( 0.8, 1.15, rnd ) ).mul( mix( 0.75, 1.05, t ) );
			albedo.assign( mix( mix( tone.mul( 0.6 ), tone, leaf ), srgb( 0xa87a30 ), bladder.mul( 0.7 ) ) );
			rough.assign( 0.55 );
			spec.assign( 0.45 );

		} ).Else( () => {

			// eelgrass (Zostera): dark bases, epiphyte-covered older tips
			const aged = mix( base, srgb( 0x7a7442 ), 0.6 );
			const tip = smoothstep( 0.5, 1.0, t ).mul( fract( rnd.mul( 13.7 ) ).mul( 0.7 ).add( 0.3 ) );
			albedo.assign( mix( base.mul( mix( 0.55, 1.0, smoothstep( 0.0, 0.4, t ) ) ), aged, tip ) );
			rough.assign( 0.6 );

		} );

		// crevices also receive less direct light
		return albedo.mul( mix( 0.6, 1.0, occl ) );

	} )();
	mat.normalNode = Fn( () => bumpNormal( height ) )();
	mat.roughnessNode = rough;
	mat.aoNode = occl;
	mat.specularIntensityNode = spec;
	// light shining through thin tissue (lit from behind), as an emissive term
	mat.emissiveNode = Fn( () => {

		const back = saturate( dot( normalWorldGeometry.mul( faceDirection ).negate(), sun.dir ) ).mul( 0.8 ).add( 0.2 );
		return vec3( sun.color ).mul( albedo ).mul( thin.mul( back ) ).mul( 1 / Math.PI );

	} )();

	return mat;

}
