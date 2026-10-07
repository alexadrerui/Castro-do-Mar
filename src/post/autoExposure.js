// Automatic exposure (the eye's adaptation), after offroad's render/pipeline.js
// (https://github.com/alexadrerui/offroad, MIT, Copyright (c) 2026 Arz-Gev, licenses/LICENSE-offroad.md):
// the log-average luminance of the scene measured on the GPU with no read-back, an exposure that moves
// towards key / average over time in log space, clamped to a range, and a 0..1 `auto` that cross-fades
// in log space between the fixed exposure and the adaptive one, so nothing jumps where the adaptation
// takes over. Rewritten in TSL; here it is a multiplier on the fixed exposure that main.js already sets
// (0.8 by day, rising with the dusk and the night), so `auto` = 0 multiplies by exactly 1.
//
// Two tiny passes after each frame, read by the next one (one frame late, invisible at these speeds):
//  - lum: 32 x 32 texels, each the mean of 4 x 4 samples of the scene pass (128 x 128 in all), storing
//    w * log2(luminance) and the weight w (centre-weighted: the middle of the view counts more);
//  - adapt: one pixel, the weighted mean of the 1024 texels (a loop, no mipmaps), the target, the clamp
//    and the step towards it from last frame's value (written into B from A, then copied back into A).
// Output texel: r = the multiplier, g = log2 of the adapted multiplier (the state), b = log2 of the mean
// luminance (QA), a = 1.
// The lum pass only runs while `auto` > 0 and the adapt pass stops once it has written 1 by day, so a
// day frame costs nothing. Both are drawn once in the compile stage (warm()), so no pipeline is born later.

import * as THREE from 'three/webgpu';
import { Fn, Loop, float, vec2, vec3, vec4, uniform, texture, uv, dot, log2, exp2, max, mix, clamp, exp, ivec2, int } from 'three/tsl';

const LUM = 32;   // texels per side of the luminance target
const TAPS = 4;   // samples per side per texel

export class AutoExposure {

	// sceneTexture: the HDR scene (the scene pass's output texture), sampled after the frame
	constructor( sceneTexture ) {
		this.auto = uniform( 0 );        // 0 = the fixed exposure, 1 = adaptive (main.js: the dusk and the night)
		// the exposure aims at key / mean luminance; key = the mean exposed luminance of the night views
		// at the fixed exposure (log2 of the scene's mean -7.5 at 23:00, x 2), so on average the night
		// keeps its tuned brightness and each view moves around it
		this.key = uniform( 0.011 );
		this.amount = uniform( 0.75 );   // how much of the difference the eye makes up (1 = all of it)
		this.min = uniform( 0.55 );      // the multiplier's range around the fixed exposure
		this.max = uniform( 2.2 );
		this.fixed = uniform( 0.8 );     // the fixed exposure (renderer.toneMappingExposure), set every frame
		this.speedUp = uniform( 0.8 );   // 1/s in log space: getting used to the dark is slower ...
		this.speedDown = uniform( 2.0 ); // ... than to the light
		this.dt = uniform( 0 );
		this.reset = uniform( 1 );
		this._wasOn = false;
		this._idle = false;              // the adapt pass wrote 1 with auto = 0: nothing to do until it changes

		const lumOpts = { depthBuffer: false, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
		this.lumRT = new THREE.RenderTarget( LUM, LUM, lumOpts );
		this.lumRT.texture.name = 'exposure.lum';
		const aOpts = { depthBuffer: false, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
		this._rtA = new THREE.RenderTarget( 1, 1, aOpts ); this._rtA.texture.name = 'exposure.A';
		this._rtB = new THREE.RenderTarget( 1, 1, aOpts ); this._rtB.texture.name = 'exposure.B';
		this._old = texture( this._rtA.texture );
		// what the grade reads: the latest adapted value
		this.texture = texture( this._rtA.texture );

		// ---- lum
		const scene = texture( sceneTexture );
		const lumMat = new THREE.NodeMaterial();
		lumMat.name = 'exposureLum';
		lumMat.fragmentNode = Fn( () => {
			const st = uv();
			const sum = float( 0 ).toVar();
			for ( let j = 0; j < TAPS; j ++ ) for ( let i = 0; i < TAPS; i ++ ) {
				const o = vec2( ( i + 0.5 ) / TAPS - 0.5, ( j + 0.5 ) / TAPS - 0.5 ).div( LUM );
				const c = scene.sample( st.add( o ) ).rgb;
				const l = clamp( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4, 64 );
				sum.addAssign( log2( l ) );
			}
			// centre-weighted: 1 in the middle, 0.25 at the corners
			const d = st.sub( 0.5 ).mul( vec2( 2, 2 ) ).length().div( 1.4142 );
			const w = float( 1 ).sub( d.mul( d ).mul( 0.75 ) );
			return vec4( sum.div( TAPS * TAPS ).mul( w ), w, 0, 1 );
		} )();
		this._lumQuad = new THREE.QuadMesh( lumMat );

		// ---- adapt
		const lumTex = texture( this.lumRT.texture );
		const adaptMat = new THREE.NodeMaterial();
		adaptMat.name = 'exposureAdapt';
		adaptMat.fragmentNode = Fn( () => {
			const acc = vec2( 0 ).toVar();
			Loop( LUM * LUM, ( { i } ) => {
				const t = lumTex.load( ivec2( int( i ).mod( LUM ), int( i ).div( LUM ) ) );
				acc.addAssign( t.xy );
			} );
			const avgLog = acc.x.div( max( acc.y, 1e-4 ) );
			// target exposure key / mean, as a multiplier on the fixed one, clamped (all in log2)
			const target = clamp( log2( this.key ).sub( avgLog ).sub( log2( this.fixed ) ).mul( this.amount ), log2( this.min ), log2( this.max ) );
			const prev = this._old.load( ivec2( 0, 0 ) ).y;
			const speed = target.greaterThan( prev ).select( this.speedUp, this.speedDown );
			const k = float( 1 ).sub( exp( speed.mul( this.dt ).negate() ) );
			const m = this.reset.greaterThan( 0.5 ).select( target, mix( prev, target, k ) );
			return vec4( exp2( m.mul( this.auto ) ), m, avgLog, 1 );
		} )();
		this._adaptQuad = new THREE.QuadMesh( adaptMat );
	}

	// after the frame: measure it and adapt for the next one
	update( renderer, dt, force = false ) {
		const on = this.auto.value > 0.001;
		if ( ! on && this._idle && ! force ) return;
		this.dt.value = dt;
		if ( on && ! this._wasOn ) this.reset.value = 1;   // waking up: start from where the eye should be
		const prev = renderer.getRenderTarget();
		if ( on || force ) {
			renderer.setRenderTarget( this.lumRT );
			this._lumQuad.render( renderer );
		}
		// B from A, then copied back into A: the grade and this pass always read A (swapping the texture
		// of a texture node between frames did not reach the grade's bindings: it read a stale target)
		renderer.setRenderTarget( this._rtB );
		this._adaptQuad.render( renderer );
		renderer.setRenderTarget( prev );
		renderer.copyTextureToTexture( this._rtB.texture, this._rtA.texture );
		this.reset.value = 0;
		this._wasOn = on;
		this._idle = ! on;
	}

	// jump to the adapted value at once (a new view, a capture)
	settle() { this.reset.value = 1; }

	// both passes once, for the precompile (by day they write 1)
	warm( renderer ) { this.reset.value = 1; this.update( renderer, 0, true ); }

	// QA: [ multiplier, log2 multiplier, log2 mean luminance ]
	async read( renderer ) {
		const px = await renderer.readRenderTargetPixelsAsync( this._rtA, 0, 0, 1, 1 );
		return [ px[ 0 ], px[ 1 ], px[ 2 ] ];
	}

}
