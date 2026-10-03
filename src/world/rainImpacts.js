// Raindrops landing: expanding rings on the water and the puddles, and the glints of the impacts.
// Ported from Stylized Premium Scenes by Christian Ortiz (Cortiz),
// https://github.com/CortizLabs/stylized-premium-patreon (src/components/rain/wetSurface.ts),
// MIT License, Copyright (c) 2026 Christian Ortiz (Cortiz). Rewritten in TSL from the GLSL patch.
// Kept from the original: the ripples are ANALYTIC, one drop per cell of a grid on its own clock,
// the GRADIENT of the rings summed over the 3 x 3 neighbouring cells (a ring grows past its cell);
// the drop lands somewhere new every cycle (the cycle is a hash key of its own); not every cell gets
// a drop each cycle (how many vs how big); the sine-free hashes (Dave Hoskins' "hash without sine":
// a sin() hash fed by a growing cycle count degenerates into a smooth lattice after minutes) and the
// clocks folded seamlessly every WET_CYCLES cycles; the glints as a fast attack and an exponential
// decay. Changes: TSL; driven by the rain of world/weather.js (rainFall, rainClock); the masks
// (where water lies, how far) are left to the host materials (terrain.js, water.js).
import * as THREE from 'three/webgpu';
import { Fn, If, vec2, vec3, float, floor, fract, dot, mod, length, abs, exp, cos, smoothstep, uniform } from 'three/tsl';

// the rain now, 0..1, and its clock (s): set every frame by world/weather.js
export const rainFall = uniform( 0 );
export const rainClock = uniform( 0 );

export const rainImpacts = {
	scale: uniform( 2.2 ),        // ripple cells per metre (higher: smaller, denser rings)
	period: uniform( 1.1 ),       // seconds between one cell's impacts
	ringSpeed: uniform( 0.55 ),   // how far a ring travels, in cells per lifetime
	frequency: uniform( 20 ),     // waves per cell: the concentric rings of one impact
	chance: uniform( 0.7 ),       // share of the cells with a drop each cycle (scaled by the rain; 1 read as a grid)
	glintDensity: uniform( 1.6 ), // glint cells per metre
	glintRate: uniform( 1.1 ),    // impacts per second per cell
	glintSize: uniform( 0.09 ),   // dot radius, a fraction of a cell
	glintColor: uniform( new THREE.Color( 0xe8e2f6 ) )
};
const U = rainImpacts;
const WET_CYCLES = 1024;

const hash22 = /*@__PURE__*/ Fn( ( [ p ] ) => {
	const p3 = fract( vec3( p.x, p.y, p.x ).mul( vec3( 0.1031, 0.1030, 0.0973 ) ) ).toVar();
	p3.addAssign( dot( p3, p3.yzx.add( 33.33 ) ) );
	return fract( p3.xx.add( p3.yz ).mul( p3.zy ) );
} ).setLayout( { name: 'rainHash22', type: 'vec2', inputs: [ { name: 'p', type: 'vec2' } ] } );

// the same, keyed by a third number (the cycle, so a cell's drop moves)
const hash32 = /*@__PURE__*/ Fn( ( [ q ] ) => {
	const p = fract( q.mul( vec3( 0.1031, 0.1030, 0.0973 ) ) ).toVar();
	p.addAssign( dot( p, p.yxz.add( 33.33 ) ) );
	return fract( p.xx.add( p.yz ).mul( p.zy ) );
} ).setLayout( { name: 'rainHash32', type: 'vec2', inputs: [ { name: 'q', type: 'vec3' } ] } );

// Gradient of the ripple height field at p (cell space), t the clock. No setLayout here nor in
// glints: a function with a layout is emitted as its own WGSL function, which cannot reach the
// uniforms ("struct member nodeUniform0 not found"); these are inlined where they are used.
const rippleGrad = /*@__PURE__*/ Fn( ( [ p, t ] ) => {
	const grad = vec2( 0 ).toVar();
	const ip = floor( p );
	const period = U.period.max( 1e-3 );
	const wrapped = mod( t, period.mul( WET_CYCLES ) );
	// fewer drops in a light rain: the share of the cells that get one
	const chance = U.chance.mul( rainFall.mul( 0.8 ).add( 0.2 ) );
	for ( let y = - 1; y <= 1; y ++ ) for ( let x = - 1; x <= 1; x ++ ) {
		const cell = ip.add( vec2( x, y ) );
		const rnd = hash22( cell );
		// one drop per cell on its own clock (else every ring in frame starts at once)
		const clock = wrapped.div( period ).add( rnd.x );
		const life = fract( clock );
		const cycle = mod( floor( clock ), WET_CYCLES );
		// where it lands, new every cycle
		const jitter = hash32( vec3( cell, cycle ) );
		const roll = fract( jitter.x.mul( 137.13 ).add( jitter.y.mul( 61.7 ) ) );
		const on = chance.greaterThanEqual( roll ).select( 1, 0 );
		const c = cell.add( 0.15 ).add( jitter.mul( 0.7 ) );
		const d = p.sub( c );
		const r = length( d ).add( 1e-4 );
		// the wavefront and this fragment's distance behind it
		const ring = r.sub( life.mul( U.ringSpeed ) );
		const env = life.oneMinus().mul( exp( abs( ring ).mul( - 3.5 ) ) ).mul( exp( r.mul( - 1.6 ) ) ).mul( jitter.x.mul( 0.45 ).add( 0.55 ) ).mul( on );
		grad.addAssign( d.div( r ).mul( cos( ring.mul( U.frequency ) ).mul( U.frequency ).mul( env ) ) );
	}
	return grad;
} );

// Impact glints at p (metres): a point of light per drop, snapping on and dying away.
const glints = /*@__PURE__*/ Fn( ( [ p, t ] ) => {
	const g = p.mul( U.glintDensity );
	const ip = floor( g );
	const sum = float( 0 ).toVar();
	const rate = U.glintRate.max( 1e-3 );
	const wrapped = mod( t, float( WET_CYCLES ).div( rate ) );
	for ( let y = - 1; y <= 1; y ++ ) for ( let x = - 1; x <= 1; x ++ ) {
		const cell = ip.add( vec2( x, y ) );
		const rnd = hash22( cell );
		const clock = wrapped.mul( rate ).add( rnd.x );
		const life = fract( clock );
		const cycle = mod( floor( clock ), WET_CYCLES );
		const jitter = hash32( vec3( cell, cycle ) );
		const c = cell.add( 0.15 ).add( jitter.mul( 0.7 ) );
		const point = smoothstep( 0, U.glintSize.max( 1e-3 ), length( g.sub( c ) ) ).oneMinus();
		const flash = smoothstep( 0, 0.05, life ).mul( exp( life.mul( - 9 ) ) );
		sum.addAssign( point.mul( flash ) );
	}
	return sum.min( 1.5 );
} );

// The ripple slope at world xz (d height / d x, d height / d z, per metre of height), weighted by
// mask (0..1: where water lies, how near; the host's). Nothing is evaluated where the mask or the
// rain is zero: the rest of the time the 3 x 3 loop costs nothing.
export const rainRipples = /*@__PURE__*/ Fn( ( [ xz, mask ] ) => {
	const g = vec2( 0 ).toVar();
	const m = mask.mul( rainFall );
	If( m.greaterThan( 0.001 ), () => {
		g.assign( rippleGrad( xz.mul( U.scale ), rainClock ).mul( m ) );
	} );
	return g;
} );

// The glints at world xz, weighted by mask, as an emissive amount (times glintColor).
export const rainGlints = /*@__PURE__*/ Fn( ( [ xz, mask ] ) => {
	const s = float( 0 ).toVar();
	const m = mask.mul( rainFall );
	If( m.greaterThan( 0.001 ), () => {
		s.assign( glints( xz, rainClock ).mul( m ) );
	} );
	return U.glintColor.mul( s );
} );
