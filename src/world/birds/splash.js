// Splashes where a diving bird hits the water (the terns, the gannets): drops thrown up and out,
// a white column of spray that rises, slows and falls back, and a ring of foam spreading on the water.
// The amounts and speeds per splash strength are Tidewater's (https://github.com/dgreenheck/tidewater,
// src/world/wildlife/Birds.js splash(), the calls into fx/Spray.js; three.js version at d32799f, MIT,
// Copyright (c) 2026 DRG Software Solutions LLC): drops up at 3.5·sqrt(k) m/s with 1.6 + 1.5k m/s of
// spread, the spray up at 2.2·sqrt(k), foam lasting 3 s. Their Spray is a GPU particle system with
// compute passes and a ring buffer shared with the breaking waves; here only birds splash, so it is one
// instanced mesh of camera-facing quads animated in the vertex shader from each splash's origin, start
// time, strength and seed (no state on the GPU, no compute), like the falls' spray (riverMist.js, whose
// puff texture it shares). EVENTS splashes at a time, the oldest slot reused.
import * as THREE from 'three/webgpu';
import {
	Fn, If, float, int, vec2, vec3, vec4, uniform, uniformArray, instanceIndex, positionGeometry, uv, texture, cameraPosition,
	cameraWorldMatrix, cameraViewMatrix, normalize, cross, length, smoothstep, sqrt, exp, cos, sin, fract, dot,
	select, color, varyingProperty
} from 'three/tsl';
import { sprayPuffTexture } from '../riverMist.js';

const EVENTS = 12;
const DROPS = 48, PUFFS = 14, PER = DROPS + PUFFS + 1; // + one foam ring
const GRAV = 9.81;

// a hash of two floats, 0..1 (small arguments here: the particle and the splash's seed)
const hash = ( a, b ) => fract( sin( dot( vec2( a, b ), vec2( 12.9898, 78.233 ) ) ).mul( 43758.5453 ) );

export class Splashes {

	// light: { sunDir, sunColor, skyColor } uniforms (the rivers' light: main.js keeps it with the sun)
	constructor( light ) {
		this.time = 0;
		this.next = 0;
		this.now = uniform( 0 );
		this.ev = uniformArray( Array.from( { length: EVENTS }, () => new THREE.Vector4( 0, - 1e4, 0, - 100 ) ), 'vec4' ).setName( 'splashEv' );
		this.par = uniformArray( Array.from( { length: EVENTS }, () => new THREE.Vector4() ), 'vec4' ).setName( 'splashPar' );
		this.count = 0;

		const geo = new THREE.InstancedBufferGeometry();
		const quad = new THREE.PlaneGeometry( 1, 1 );
		geo.index = quad.index;
		geo.setAttribute( 'position', quad.attributes.position );
		geo.setAttribute( 'uv', quad.attributes.uv );
		geo.instanceCount = EVENTS * PER;
		this.puffs = sprayPuffTexture( 64, 991 );
		this.mesh = new THREE.Mesh( geo, this._material( light ) );
		this.mesh.name = 'birdSplashes';
		this.mesh.frustumCulled = false; // placed by the positionNode
		this.mesh.renderOrder = 3;       // after the water and its shadow
		this.mesh.layers.set( 1 );       // not in the reflection
	}

	// a splash at (x, y, z) on the water, strength k (a tern 0.35, a gannet 1)
	emit( x, y, z, k ) {
		const i = this.next;
		this.next = ( this.next + 1 ) % EVENTS;
		this.ev.array[ i ].set( x, y, z, this.time );
		this.par.array[ i ].set( k, ( this.count ++ % 97 ) + 0.37, 0, 0 );
	}

	update( dt ) {
		this.time += dt;
		this.now.value = this.time;
	}

	_material( light ) {
		const vKind = varyingProperty( 'float', 'vSplashKind' );   // 0 drop, 1 spray, 2 foam
		const vFade = varyingProperty( 'float', 'vSplashFade' );
		const vSeed = varyingProperty( 'float', 'vSplashSeed' );
		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, side: THREE.DoubleSide } );
		mat.name = 'BirdSplash';
		mat.forceSinglePass = true; // (double-sided and transparent: three would draw it in two passes, two pipelines)

		mat.positionNode = Fn( () => {
			const id = int( instanceIndex );
			const e = id.div( PER ), l = id.mod( PER );
			const E = this.ev.element( e ), F = this.par.element( e );
			const o = E.xyz, age = this.now.sub( E.w ), k = F.x, seed = F.y;
			const lf = float( l );
			const h1 = hash( lf, seed ), h2 = hash( lf.add( 0.31 ), seed ), h3 = hash( lf.add( 0.67 ), seed ), h4 = hash( lf.add( 0.93 ), seed );
			const corner = positionGeometry.xy;
			const right = cameraWorldMatrix.element( 0 ).xyz, up = cameraWorldMatrix.element( 1 ).xyz;
			const out = vec3( 0 ).toVar(), size = float( 0 ).toVar(), fade = float( 0 ).toVar(), kind = float( 0 ).toVar();
			const az = h1.mul( Math.PI * 2 );

			// drops: ballistic, up and out (fewer for a small splash)
			const isDrop = l.lessThan( DROPS );
			const isPuff = l.greaterThanEqual( DROPS ).and( l.lessThan( DROPS + PUFFS ) );
			const sk = sqrt( k );
			{
				const life = h4.mul( 0.5 ).add( 0.75 ).mul( 1.3 );
				const r = k.mul( 1.5 ).add( 1.6 ).mul( h2 ).mul( 0.8 );
				const v = vec3( cos( az ).mul( r ), sk.mul( 3.5 ).mul( h3.mul( 0.8 ).add( 0.6 ) ), sin( az ).mul( r ) );
				const p = o.add( v.mul( age ) ).sub( vec3( 0, age.mul( age ).mul( GRAV / 2 ), 0 ) );
				const vel = v.sub( vec3( 0, age.mul( GRAV ), 0 ) );
				const shown = select( lf.div( DROPS ).lessThan( k.mul( 0.7 ).add( 0.3 ) ), 1, 0 );
				const alive = select( age.greaterThan( 0 ).and( age.lessThan( life ) ).and( p.y.greaterThan( o.y.sub( 0.05 ) ) ), 1, 0 ).mul( shown );
				// a streak along the motion (a drop moving fast smears over the exposure)
				const toCam = normalize( cameraPosition.sub( p ) );
				const dir = normalize( vel.add( vec3( 0, 1e-4, 0 ) ) );
				const side = normalize( cross( dir, toCam ).add( vec3( 1e-5, 0, 0 ) ) );
				const rad = k.mul( 0.02 ).add( 0.018 ).mul( h4.mul( 0.6 ).add( 0.7 ) );
				const len = rad.add( length( vel ).mul( 0.02 ) );
				If( isDrop, () => {
					out.assign( p.add( side.mul( corner.x.mul( rad ).mul( 2 ).mul( alive ) ) ).add( dir.mul( corner.y.mul( len ).mul( 2 ).mul( alive ) ) ) );
					fade.assign( alive.mul( smoothstep( life.mul( 0.7 ), life, age ).oneMinus() ) );
					kind.assign( 0 );
				} );
			}
			// spray: a white column that rises, slows (drag) and falls back
			{
				const pl = lf.sub( DROPS );
				const life = h4.mul( 0.5 ).add( 0.75 ).mul( 1.1 );
				// (faster than Tidewater's 2.2: their spray was a low cloud; a gannet's plunge throws a plume of
				// about a metre, spread over the height by the spread of the speeds)
				const tau = float( 0.45 );
				const v = vec3( cos( az ).mul( k.add( 0.9 ).mul( h2 ).mul( 0.45 ) ), sk.mul( 3.6 ).mul( h3.mul( 1.1 ).add( 0.4 ) ), sin( az ).mul( k.add( 0.9 ).mul( h2 ).mul( 0.45 ) ) );
				const drag = exp( age.div( tau ).negate() ).oneMinus().mul( tau );
				const p = o.add( v.mul( drag ) ).sub( vec3( 0, age.mul( age ).mul( 1.6 ), 0 ) ).add( vec3( 0, 0.15, 0 ) ).toVar();
				const shown = select( pl.div( PUFFS ).lessThan( k.mul( 0.65 ).add( 0.35 ) ), 1, 0 );
				const alive = select( age.greaterThan( 0 ).and( age.lessThan( life ) ), 1, 0 ).mul( shown );
				const s = k.mul( 0.2 ).add( 0.08 ).mul( age.mul( 0.9 ).add( 1 ) ).mul( h1.mul( 0.5 ).add( 0.75 ) ).mul( alive );
				If( isPuff, () => {
					// never under the surface (the water cut them flat)
					p.y.assign( p.y.max( o.y.add( s.mul( 0.7 ) ) ) );
					out.assign( p.add( right.mul( corner.x.mul( s ).mul( 2 ) ) ).add( up.mul( corner.y.mul( s ).mul( 2 ) ) ) );
					fade.assign( alive.mul( smoothstep( 0, 0.06, age ) ).mul( smoothstep( life.mul( 0.55 ), life, age ).oneMinus() ) );
					kind.assign( 1 );
				} );
			}
			// foam: a ring on the water spreading and fading over 3 s
			If( isDrop.or( isPuff ).not(), () => {
				const alive = select( age.greaterThan( 0 ).and( age.lessThan( 3 ) ), 1, 0 );
				const rr = k.mul( 0.6 ).add( 0.5 ).mul( exp( age.mul( - 1.6 ) ).oneMinus().mul( 0.7 ).add( 0.4 ) ).mul( alive );
				out.assign( o.add( vec3( corner.x.mul( rr ).mul( 2 ), 0.03, corner.y.mul( rr ).mul( 2 ) ) ) );
				fade.assign( alive.mul( smoothstep( 1.2, 3, age ).oneMinus() ) );
				kind.assign( 2 );
			} );
			vKind.assign( kind ); vFade.assign( fade ); vSeed.assign( h1 );
			return out;
		} )();

		// light: the sun and the sky (the rivers' light uniforms, kept with the sun by main.js)
		const L = normalize( light.sunDir );
		const lView = normalize( cameraViewMatrix.mul( vec4( L, 0 ) ).xyz );
		const back = smoothstep( 0.6, 1, lView.z.negate() ); // looking toward the sun: glowing water
		const p = uv().sub( 0.5 ).mul( 2 );
		const r2 = dot( p, p );
		const puff = texture( this.puffs, uv() );
		const variant = vSeed.mul( 4 ).floor();
		const density = variant.lessThan( 1 ).select( puff.r, variant.lessThan( 2 ).select( puff.g, variant.lessThan( 3 ).select( puff.b, puff.a ) ) );
		// drop: a round bead; spray: a ragged puff; foam: a ragged ring
		const dropA = smoothstep( 0.2, 1, r2 ).oneMinus().mul( 0.6 );
		const sprayA = density.mul( 0.75 );
		const ring = smoothstep( 0.35, 0.75, r2.sqrt() ).mul( smoothstep( 0.8, 1.0, r2.sqrt() ).oneMinus() );
		const foamA = ring.mul( density.mul( 1.4 ) ).add( smoothstep( 0, 0.5, r2.sqrt() ).oneMinus().mul( density ).mul( 0.35 ) ).mul( 0.7 );
		mat.opacityNode = vKind.lessThan( 0.5 ).select( dropA, vKind.lessThan( 1.5 ).select( sprayA, foamA ) ).mul( vFade ).min( 1 );
		const white = color( '#e9f1f4' );
		const lit = light.sunColor.mul( 0.75 ).add( light.skyColor.mul( 0.5 ) );
		const dropCol = light.skyColor.mul( 1.25 ).add( light.sunColor.mul( back.mul( 1.4 ).add( 0.15 ) ) );
		mat.colorNode = vKind.lessThan( 0.5 ).select( dropCol, white.mul( lit ).mul( vKind.lessThan( 1.5 ).select( back.mul( 0.5 ).add( 1 ), float( 0.85 ) ) ) );
		return mat;
	}

}
