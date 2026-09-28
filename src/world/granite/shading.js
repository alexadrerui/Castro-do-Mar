// Adapted from Tidewater (https://github.com/dgreenheck/tidewater, src/world/terrain/TerrainShading.js
// and the rock material of src/world/Rocks.js, three.js version at d32799f). MIT License,
// Copyright (c) 2026 DRG Software Solutions LLC.
// Changes: the volcanic rock became granite (lighter warm grey, feldspar / quartz speckle,
// sheeting joints instead of lava bedding, grey-green and orange coastal lichens, more moss), a
// cheap variant for distant tiles, and the ground contact reads our terrain height texture.
import * as THREE from 'three/webgpu';
import {
	float, vec2, vec3, normalize, mix, smoothstep, max, min, abs, dot, cross, dFdx, dFdy, sign, fwidth, length,
	positionWorld, normalWorld, texture, attribute, fract, saturate, transformNormalToView, Fn,
} from 'three/tsl';

// sRGB triplet -> linear vec3 constant
export const srgb = ( r, g, b ) => {

	const c = new THREE.Color().setRGB( r, g, b, THREE.SRGBColorSpace );
	return vec3( c.r, c.g, c.b );

};

// 2D rotation of a vec2 node by a constant angle
export const rot2 = ( v, a ) => {

	const c = Math.cos( a ), s = Math.sin( a );
	return vec2( v.x.mul( c ).sub( v.y.mul( s ) ), v.x.mul( s ).add( v.y.mul( c ) ) );

};

// Mikkelsen surface-gradient bump: perturb world normal N by the scalar height field hd
// (screen-space derivatives, so any mix of projections / scales works). The tilt is limited to
// ~55 degrees (at grazing angles the unclamped gradient swings the normal into the tangent plane:
// 'chrome' patches on steep faces) and the bump fades out where the screen-space frame is
// degenerate or where the rendered facet disagrees with N.
export const perturbNormal = ( N, hd, scale = 1 ) => {

	const p = positionWorld;
	const dpdx = dFdx( p ), dpdy = dFdy( p );
	const dhdx = dFdx( hd ).mul( scale ), dhdy = dFdy( hd ).mul( scale );
	const r1 = cross( dpdy, N );
	const r2 = cross( N, dpdx );
	const det = dot( dpdx, r1 );
	const ad = abs( det );
	const grad = r1.mul( dhdx ).add( r2.mul( dhdy ) ).mul( sign( det ) );
	const area = length( cross( dpdx, dpdy ) );
	const frame = area.div( max( length( dpdx ).mul( length( dpdy ) ), 1e-20 ) ); // sin of the footprint angle
	const facet = ad.div( max( area, 1e-20 ) ); // cos between the facet and N
	const k = smoothstep( 0.12, 0.35, frame ).mul( smoothstep( 0.3, 0.6, facet ) );
	const g = grad.mul( min( float( 1 ), ad.mul( 1.4 ).div( max( length( grad ), 1e-20 ) ) ) ).mul( k );
	return normalize( N.mul( max( ad, 1e-20 ) ).sub( g ) );

};

// triplanar blend weights (sharp)
export const triWeights = ( N ) => {

	const a = abs( N );
	const w = a.mul( a ).mul( a.mul( a ) );
	return w.div( w.x.add( w.y ).add( w.z ) );

};

// one channel-set of the detail texture, triplanar
export const triplanar = ( tex, p, w, tile ) => {

	const s = 1 / tile;
	const x = texture( tex, p.zy.mul( s ) );
	const y = texture( tex, p.xz.mul( s ).add( 0.37 ) );
	const z = texture( tex, p.xy.mul( s ).add( 0.71 ) );
	return x.mul( w.x ).add( y.mul( w.y ) ).add( z.mul( w.z ) );

};

// ---- palette (sRGB, stored linear): Galician granite, its lichens and the shore zones
export const PALETTE = {
	rockDark: srgb( 0.24, 0.225, 0.2 ),
	rockMid: srgb( 0.45, 0.425, 0.385 ),
	rockLight: srgb( 0.68, 0.645, 0.585 ),
	rockWarm: srgb( 0.58, 0.49, 0.38 ),
	lichenGrey: srgb( 0.62, 0.66, 0.58 ),
	lichenOrange: srgb( 0.8, 0.52, 0.16 ),
	blackZone: srgb( 0.075, 0.075, 0.07 ),
	barnacle: srgb( 0.78, 0.76, 0.70 ),
	algae: srgb( 0.2, 0.25, 0.1 ),
	coralline: srgb( 0.62, 0.44, 0.46 ),
	moss: srgb( 0.2, 0.28, 0.09 ),
	mossDry: srgb( 0.34, 0.36, 0.16 ),
};

// Weathered granite: tors on the hills, boulders on the shore, talus under the cliffs.
//   tex: detail texture (detail.js: R fractured plates, G soil, B grains, A fbm)
//   p world position, N world normal (geometric), h height above the sea surface (m)
//   macro: 0..1 large scale variation, seed: per object variation (0..1)
//   lo: cheap variant for distant rocks (no grain, streaks or sheeting)
// Returns { albedo, rough, hd (bump height, m), moss, wet, height }
export function graniteSurface( { tex, p, N, h, macro, seed = float( 0.5 ), mossAmount = float( 1 ), lo = false } ) {

	const w = triWeights( N );
	// big blocks (4 m cells), plates (0.9 m) and grain / chips
	const big = triplanar( tex, p, w, 27 );
	const mid = triplanar( tex, p, w, 6.1 );
	const fine = lo ? vec3( 0.5 ).xyzz : triplanar( tex, p, w, 1.3 );
	// pixel footprint (m): features smaller than a few pixels fade out instead of sparkling
	const px = length( fwidth( p ) );
	const fineK = lo ? float( 0 ) : float( 1 ).sub( smoothstep( 0.006, 0.02, px ) ).toVar();
	const midK = float( 1 ).sub( smoothstep( 0.03, 0.1, px ) );
	const hr = big.x.mul( 0.45 ).add( mid.x.mul( 0.35 ) ).add( fine.x.sub( 0.5 ).mul( fineK ).add( 0.5 ).mul( 0.2 ) ).toVar();

	// sheeting joints on steep faces: granite peels in gently curved sheets (irregular bands along
	// the height, warped), faded out once a band gets thinner than a few pixels
	const steep = float( 1 ).sub( smoothstep( 0.55, 0.85, N.y ) );
	let strata = float( 0.5 ), strataAA = float( 0 );
	if ( ! lo ) {

		const bandY = p.y.add( mid.w.mul( 2.5 ) ).add( macro.mul( 6 ) );
		strata = texture( tex, vec2( bandY.div( 9 ), seed.mul( 0.37 ).add( 0.13 ) ) ).w;
		strataAA = float( 1 ).sub( smoothstep( 0.15, 0.6, fwidth( bandY ) ) );

	}

	const tone = hr.mul( 0.9 ).add( macro.sub( 0.5 ).mul( 0.6 ) ).add( strata.sub( 0.5 ).mul( 0.45 ).mul( steep ).mul( strataAA ) ).add( seed.sub( 0.5 ).mul( 0.3 ) );
	let col = mix( PALETTE.rockDark, PALETTE.rockMid, smoothstep( 0.05, 0.45, tone ) );
	col = mix( col, PALETTE.rockLight, smoothstep( 0.45, 0.85, tone ) );
	// iron staining / warm weathering in patches (granite weathers to a warm, sandy crust)
	col = mix( col, PALETTE.rockWarm, smoothstep( 0.6, 0.8, mid.w.add( macro.mul( 0.3 ) ) ).mul( 0.25 ) );
	// crystals: a fine speckle of pale feldspar / quartz and darker grains (the grain channel,
	// capped: its sparse pebbles would show as rows of dots), only where resolved
	if ( ! lo ) col = col.mul( mix( float( 1 ), min( fine.z, 0.62 ).mul( 0.5 ).add( 0.76 ), fineK ) );

	// joints between the big blocks, fainter between plates
	col = col.mul( smoothstep( 0.05, 0.25, big.x ).mul( 0.4 ).add( 0.6 ) ).mul( smoothstep( 0.05, 0.25, mid.x ).mul( 0.15 ).add( 0.85 ) );
	// rain streaks: dark stains running down steep faces (the fbm channel stretched vertically on
	// the two vertical projection planes)
	if ( ! lo ) {

		const sa = texture( tex, vec2( p.z.div( 3.1 ), p.y.div( 41 ) ) ), sb = texture( tex, vec2( p.x.div( 3.1 ).add( 0.5 ), p.y.div( 41 ).add( 0.3 ) ) );
		const sw4 = N.xz.abs().pow( vec2( 4 ) );
		const stainS = sa.w.mul( sw4.x ).add( sb.w.mul( sw4.y ) ).div( sw4.x.add( sw4.y ).add( 1e-5 ) );
		const stain = smoothstep( 0.52, 0.72, stainS ).mul( steep );
		col = col.mul( float( 1 ).sub( stain.mul( 0.35 ) ) );

	}

	// lichens: grey-green crusts almost everywhere above the spray, orange ones on the sunny tops
	// near the sea
	const dry = smoothstep( 2.6, 4.0, h );
	const lichen = smoothstep( 0.52, 0.72, mid.y ).mul( smoothstep( - 0.2, 0.6, N.y ) ).mul( dry ).mul( smoothstep( 0.3, 0.55, macro ) );
	col = mix( col, PALETTE.lichenGrey, lichen.mul( 0.5 ) );
	const coast = smoothstep( 40, 8, h );
	col = mix( col, PALETTE.lichenOrange, smoothstep( 0.78, 0.86, mid.y ).mul( dry ).mul( smoothstep( 0.4, 0.8, N.y ) ).mul( coast.mul( 0.5 ).add( 0.1 ) ) );

	// moss on the tops and ledges (a wet Atlantic climate)
	const ledge = smoothstep( 0.55, 0.7, strata ).mul( steep ).mul( strataAA ).mul( smoothstep( 0.4, 0.6, mid.w.add( macro.sub( 0.5 ).mul( 0.4 ) ) ) );
	const moss = max( smoothstep( 0.55, 0.85, N.y.add( big.x.sub( 0.5 ).mul( 0.5 ) ).add( macro.sub( 0.5 ).mul( 0.35 ) ) ), ledge.mul( 0.8 ) )
		.mul( smoothstep( 2.5, 5.0, h ) ).mul( mossAmount ).toVar();
	col = mix( col, mix( PALETTE.moss, PALETTE.mossDry, mid.w ), moss.mul( 0.85 ) );

	// shoreline zonation: black lichen band (splash zone), barnacles and algae in the intertidal
	const splash = smoothstep( 0.5, 1.0, h ).mul( smoothstep( 2.8, 1.8, h.add( mid.w.mul( 1.2 ) ) ) ).mul( smoothstep( 0.35, 0.6, macro.add( mid.w.mul( 0.3 ) ) ) );
	col = mix( col, PALETTE.blackZone, splash.mul( 0.55 ) );
	// sun-bleached upper faces
	col = mix( col, PALETTE.rockLight, smoothstep( 0.35, 0.95, N.y ).mul( smoothstep( 1.5, 3.0, h ) ).mul( 0.2 ) );
	const inter = smoothstep( - 0.7, - 0.2, h ).mul( smoothstep( 0.7, 0.2, h ) );
	const barn = smoothstep( 0.62, 0.72, fine.z ).mul( inter ).mul( fineK );
	col = mix( col, PALETTE.algae, inter.mul( smoothstep( 0.4, 0.6, mid.y ) ).mul( 0.6 ) );
	col = mix( col, PALETTE.barnacle, barn.mul( 0.8 ) );
	// below the water: algae films and pink coralline crusts
	const sub = smoothstep( - 0.3, - 1.2, h );
	col = mix( col, mix( PALETTE.algae, PALETTE.coralline, smoothstep( 0.45, 0.7, mid.w ) ), sub.mul( 0.55 ) );

	// wet below the swash line (dark, glossy)
	const wet = smoothstep( 1.0, 0.25, h.add( mid.w.mul( 0.3 ) ) ).toVar();
	col = col.mul( mix( float( 1 ), float( 0.55 ), wet ) );

	const rough = mix( mix( float( 0.9 ), float( 0.84 ), steep ), float( 0.45 ), wet ).add( moss.mul( 0.05 ) );
	// relief (m): tilted blocks and plates with bevelled joints, then grain
	const hd = big.x.mul( 0.25 ).add( mid.x.mul( 0.07 ).mul( midK.mul( 0.6 ).add( 0.4 ) ) ).add( fine.x.mul( 0.012 ).mul( fineK ).mul( float( 1 ).sub( wet.mul( 0.6 ) ) ) ).add( barn.mul( 0.005 ) );
	return { albedo: col, rough, hd, moss, wet, height: hr };

}

// Material of the scattered granite (instanced): per-instance tint (aTint) and seed, the cavity
// term baked into the geometry ('ao'), the ground contact (soil / sand drifted against the base,
// a darker crevice) from the terrain height texture. lo: the cheap variant for distant tiles.
export function createGraniteMaterial( { tex, heightTex, waterLevel = 0, lo = false, mossAmount = 1 } ) {

	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.85, metalness: 0 } );
	mat.name = lo ? 'GraniteLo' : 'Granite';
	const p = positionWorld;
	const N = normalWorld.toVar();
	const tint = attribute( 'aTint', 'vec3' );
	const seed = fract( tint.x.mul( 37.1 ).add( tint.z.mul( 11.7 ) ) );
	const macro = texture( tex, rot2( p.xz, 0.9 ).div( 61 ) ).w.mul( 0.6 ).add( texture( tex, rot2( p.xz, 2.3 ).div( 17 ) ).w.mul( 0.4 ) );
	const R = graniteSurface( { tex, p, N, h: p.y.sub( waterLevel ), macro, seed, mossAmount: float( mossAmount ), lo } );
	// contact with the ground: soil (or sand near the sea) drifted against the base
	const hd = heightTex.userData;
	const huv = p.xz.sub( vec2( hd.x0, hd.z0 ) ).div( hd.cell ).add( 0.5 ).div( hd.n );
	const ground = texture( heightTex, huv ).r;
	const above = p.y.sub( ground );
	const contact = float( 1 ).sub( smoothstep( 0.0, 0.3, above.add( R.height.sub( 0.5 ).mul( 0.2 ) ) ) ).mul( smoothstep( waterLevel - 0.5, waterLevel + 0.3, ground ) );
	const drift = mix( srgb( 0.37, 0.3, 0.23 ), srgb( 0.64, 0.59, 0.48 ), smoothstep( waterLevel + 3.0, waterLevel + 1.0, ground ) );
	const albedo = mix( R.albedo.mul( tint ), drift, contact.mul( 0.75 ) );
	mat.colorNode = albedo;
	mat.roughnessNode = mix( R.rough, float( 0.92 ), contact );
	mat.normalNode = Fn( () => transformNormalToView( perturbNormal( N, R.hd, 1.0 ) ) )();
	const cav = attribute( 'ao', 'float' );
	mat.aoNode = saturate( cav.mul( float( 1 ).sub( contact.mul( 0.35 ) ) ).mul( smoothstep( 0.0, 0.35, R.height ).mul( 0.35 ).add( 0.65 ) ) );
	return mat;

}
