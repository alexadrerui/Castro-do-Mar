// "Oil paint": an anisotropic Kuwahara filter over the scene, an option of the panel (off by default;
// its shader is only built when switched on). Ported from Stylized Premium Scenes by Christian Ortiz
// (Cortiz), https://github.com/CortizLabs/stylized-premium-patreon (src/components/kuwahara,
// AnisotropicKuwaharaPass.ts and glsl/), MIT License, Copyright (c) 2026 Christian Ortiz; theirs is
// adapted from Maxime Heckel's anisotropic Kuwahara. Rewritten in TSL.
//
// Kuwahara: split the disc around a pixel into 8 sectors and take the average colour of the one with
// the lowest variance, so the smoothing never crosses an edge (flat patches meeting at hard
// boundaries, what a loaded brush leaves). Anisotropic: a structure tensor (Sobel gradients squared
// and cross-multiplied: direction without a sign) gives the local flow and how strongly the image
// flows that way; the kernel is rotated onto the flow and squeezed by that strength, so the strokes
// run along an edge instead of the round blobs of a naive Kuwahara. The kernel transform is
// rotation x scale applied as M * v (scale-after-rotate would always stretch screen-vertically).
// Changes: one pass (the tensor is read at the pixel itself, so it is computed inline from 9
// samples instead of a texture of its own); the radius is fixed at build (the loops are unrolled; a
// new radius builds a new shader); no debug views.
import { Fn, vec2, vec3, vec4, float, uniform, screenUV, screenSize, sqrt, abs, max, normalize, dot } from 'three/tsl';

const SECTORS = 8;
const ANGLE_STEPS = 5, ANGLE_START = - 0.392699, ANGLE_STEP = 0.196349; // +-22.5 degrees per sector

export class Kuwahara {

	constructor( { radius = 3 } = {} ) {
		this.radius = radius;          // brush size in pixels, and the cost: 8 x radius x 5 samples
		this.alpha = uniform( 2 );     // eccentricity limit: lower stretches the strokes sooner
		this.eta = uniform( 0.36 );    // sector weight polynomial
		this.lambda = uniform( 0.85 );
	}

	// The painted colour of tex (a texture node, e.g. the scene pass) at this pixel, as vec4.
	node( tex ) {
		const R = this.radius, U = this;
		return Fn( () => {
			const px = vec2( 1 ).div( screenSize );
			// HDR in: the sun disc, thousands of times white, would own every variance; capped first
			const at = ( o ) => tex.sample( screenUV.add( o.mul( px ) ) ).rgb.min( vec3( 4 ) );
			// structure tensor at the pixel: 3 x 3 Sobel per channel
			const s = {};
			for ( let y = - 1; y <= 1; y ++ ) for ( let x = - 1; x <= 1; x ++ ) s[ x + ',' + y ] = at( vec2( x, y ) );
			const Sx = s[ '1,-1' ].add( s[ '1,0' ].mul( 2 ) ).add( s[ '1,1' ] ).sub( s[ '-1,-1' ] ).sub( s[ '-1,0' ].mul( 2 ) ).sub( s[ '-1,1' ] );
			const Sy = s[ '-1,1' ].add( s[ '0,1' ].mul( 2 ) ).add( s[ '1,1' ] ).sub( s[ '-1,-1' ] ).sub( s[ '0,-1' ].mul( 2 ) ).sub( s[ '1,-1' ] );
			const Jxx = dot( Sx, Sx ), Jyy = dot( Sy, Sy ), Jxy = dot( Sx, Sy );
			// its eigen-decomposition: the flow direction and how anisotropic it is
			const tr = Jxx.add( Jyy ), det = Jxx.mul( Jyy ).sub( Jxy.mul( Jxy ) );
			const disc = sqrt( max( tr.mul( tr ).mul( 0.25 ).sub( det ), 0 ) );
			const l1 = tr.mul( 0.5 ).add( disc ), l2 = tr.mul( 0.5 ).sub( disc );
			const v = vec2( Jxy.negate(), Jxx.sub( l1 ) );
			const o = abs( Jxy ).greaterThan( 1e-9 ).select( normalize( v ), vec2( 0, 1 ) );
			const aniso = l1.sub( l2 ).div( l1.add( l2 ).add( 1e-6 ) );
			const alpha = U.alpha.max( 1e-3 );
			const sx = alpha.div( aniso.add( alpha ) ), sy = aniso.add( alpha ).div( alpha );
			// M = rotation(o) x scale(sx, sy), applied as M * v
			const xf = ( w ) => vec2( o.x.mul( w.x.mul( sx ) ).sub( o.y.mul( w.y.mul( sy ) ) ), o.y.mul( w.x.mul( sx ) ).add( o.x.mul( w.y.mul( sy ) ) ) );
			// the 8 sectors: weighted mean and variance, the calmest one wins
			let best = null, bestVar = null;
			for ( let i = 0; i < SECTORS; i ++ ) {
				const angle = i * Math.PI * 2 / SECTORS;
				let sum = vec3( 0 ), sum2 = vec3( 0 ), wsum = float( 0 );
				for ( let r = 1; r <= R; r ++ ) for ( let k = 0; k < ANGLE_STEPS; k ++ ) {
					const a = angle + ANGLE_START + k * ANGLE_STEP;
					const off = xf( vec2( r * Math.cos( a ), r * Math.sin( a ) ) );
					const c = at( off );
					// falls off toward the sector's rim (its straight edge would print the fan)
					const p = off.x.add( U.eta ).sub( U.lambda.mul( off.y.mul( off.y ) ) );
					const w = p.mul( p ); // p squared, as the original (max( p, 0 ) squared left the sectors behind
					                       // the pixel weightless: black, zero variance, and they won)
					sum = sum.add( c.mul( w ) ); sum2 = sum2.add( c.mul( c ).mul( w ) ); wsum = wsum.add( w );
				}
				const sw = wsum.max( 1e-6 );
				const avg = sum.div( sw );
				const variance = dot( sum2.div( sw ).sub( avg.mul( avg ) ), vec3( 0.299, 0.587, 0.114 ) );
				if ( best === null ) { best = avg.toVar(); bestVar = variance.toVar(); } else {
					const lower = variance.lessThan( bestVar );
					best.assign( lower.select( avg, best ) );
					bestVar.assign( lower.select( variance, bestVar ) );
				}
			}
			return vec4( best, 1 );
		} )();
	}
}
