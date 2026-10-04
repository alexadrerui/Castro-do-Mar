// Raindrops landing: expanding rings on the water and the puddles, and the glints of the impacts.
// Ported from Stylized Premium Scenes by Christian Ortiz (Cortiz),
// https://github.com/CortizLabs/stylized-premium-patreon (src/components/rain/wetSurface.ts),
// MIT License, Copyright (c) 2026 Christian Ortiz (Cortiz). Rewritten in TSL from the GLSL patch.
// Kept from the original: the ripples are ANALYTIC, one drop per cell of a grid on its own clock,
// the GRADIENT of the rings summed over the 3 x 3 neighbouring cells (a ring grows past its cell);
// the drop lands somewhere new every cycle (the cycle is a hash key of its own); not every cell gets
// a drop each cycle (how many vs how big); the sine-free hashes (Dave Hoskins' "hash without sine",
// MIT License, Copyright (c) 2014 David Hoskins:
// a sin() hash fed by a growing cycle count degenerates into a smooth lattice after minutes) and the
// clocks folded seamlessly every WET_CYCLES cycles; the glints as a fast attack and an exponential
// decay. Changes: TSL; driven by the rain of world/weather.js (rainFall, rainClock); the masks
// (where water lies, how far) are left to the host materials (terrain.js, water.js).
import * as THREE from 'three/webgpu';
import { Fn, If, vec2, vec3, float, floor, fract, dot, mod, length, abs, exp, cos, smoothstep, uniform, mix, cameraPosition } from 'three/tsl';

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

// ------------------------------------------------------------------ on stone: marks and trickles
// The dark wet mark a drop leaves where it hits (wet on impact, holds, dries off), and drops running
// DOWN the steep faces with a wet trail above them. Ported from the same scenes' rainyScene/
// rainSplatter.ts (Cortiz, MIT, as above). Kept: one drop per cell per cycle, re-hashed every cycle,
// MAX not sum; the cell grid on the plane most face-on to the surface, stretched up the side faces (a
// drop glancing off a wall smears down it); undersides dry, side faces a share, tops all; lanes of
// beads with an exponential trail on the steep faces only. Changes: TSL; the amount follows our rain.
export const rainSplatter = {
	strength: uniform( 0.7 ),  // the marks (0 off)
	density: uniform( 5 ),     // cells per metre
	rate: uniform( 0.9 ),      // impacts per second per cell
	size: uniform( 0.3 ),      // mark radius, a fraction of a cell
	dry: uniform( 0.45 ),      // share of a mark's life it holds before drying
	darken: uniform( 0.5 ),   // how much darker a wet mark is
	dim: uniform( 0.4 ),      // how much of the sky's (indirect) light a wet mark loses (see materials.js wetStone)
	rough: uniform( 0.32 ),    // the roughness a wet mark is pulled to (0.12 there: under our bright rain sky the
	                           // sharper reflection brightened the mark as much as the darkening darkened it)
	fade: uniform( 60 ),       // metres: no marks or trickles beyond
	side: uniform( 0.35 ),     // share a vertical face receives
	stretch: uniform( 2.2 ),   // marks stretched up the side faces
	trickle: uniform( 0.7 ),   // share of the lanes with a drop running down (0.35 there: a statue's scale)
	trickleDensity: uniform( 3 ),
	trickleSpeed: uniform( 0.55 ), // m/s
	trickleTrail: uniform( 0.7 ),  // the wet trail behind a bead (lane units: ~2 m up a wall each)
	trickleWidth: uniform( 0.1 ),  // lane units
	debug: uniform( 0 )            // 1: the stone shows how wet the drops make it (white)
};
const SP = rainSplatter;

const splatMarks = /*@__PURE__*/ Fn( ( [ uv, t ] ) => {
	const ip = floor( uv );
	const best = float( 0 ).toVar();
	const rate = SP.rate.max( 1e-3 );
	const wrapped = mod( t, float( WET_CYCLES ).div( rate ) );
	for ( let y = - 1; y <= 1; y ++ ) for ( let x = - 1; x <= 1; x ++ ) {
		const cell = ip.add( vec2( x, y ) );
		const rnd = hash22( cell );
		const clock = wrapped.mul( rate ).add( rnd.x );
		const life = fract( clock );
		const cycle = mod( floor( clock ), WET_CYCLES );
		const jitter = hash32( vec3( cell, cycle ) );
		const c = cell.add( 0.15 ).add( jitter.mul( 0.7 ) );
		const radius = SP.size.mul( jitter.x.mul( 0.9 ).add( 0.55 ) );
		const disc = smoothstep( radius.mul( 0.45 ), radius, length( uv.sub( c ) ) ).oneMinus();
		// hits at once, holds, then dries: the asymmetry is what reads as an impact
		const env = smoothstep( 0, 0.04, life ).mul( smoothstep( SP.dry, 1, life ).oneMinus() );
		best.assign( best.max( disc.mul( env ) ) );
	}
	return best;
} );

const splatTrickles = /*@__PURE__*/ Fn( ( [ uv, t ] ) => {
	const laneW = float( 1 ).div( SP.trickleDensity.max( 1e-3 ) );
	const lane = floor( uv.x.div( laneW ) );
	const span = SP.trickleTrail.max( 1e-3 ).mul( 3 ); // a lane is one bead running through, not a dotted line (x 5 there: rarer at our scale)
	const best = float( 0 ).toVar();
	for ( let i = - 1; i <= 1; i ++ ) {
		const li = lane.add( i );
		const rnd = hash22( vec2( li, 7.3 ) );
		const runs = SP.trickle.greaterThan( rnd.x ).select( 1, 0 ); // not every lane runs
		const cx = li.add( 0.2 ).add( rnd.y.mul( 0.6 ) ).mul( laneW );
		const across = smoothstep( SP.trickleWidth.mul( 0.4 ), SP.trickleWidth, abs( uv.x.sub( cx ) ) ).oneMinus();
		const speed = SP.trickleSpeed.mul( rnd.y.mul( 0.9 ).add( 0.55 ) );
		const head = rnd.x.mul( span ).sub( mod( t.mul( speed ), span ) );
		const behind = mod( uv.y.sub( head ), span ); // the trail lies above the bead
		const trail = exp( behind.negate().div( SP.trickleTrail.max( 1e-3 ) ) );
		const bead = smoothstep( 0, SP.trickleWidth.mul( 1.6 ), behind ).oneMinus();
		best.assign( best.max( across.mul( trail.mul( 0.85 ).max( bead ) ).mul( runs ) ) );
	}
	// the trail's fall-off lifted (a square root; else most of a trail sat at 0.2-0.4 and barely showed,
	// and a hard threshold cut the trails into bars; a change from the original)
	return best.sqrt();
} );

// How wet the rain makes this point right now, 0..1 (wp world position, n world normal, mask the
// host's 0..1). The host darkens its colour by darken x this and pulls its roughness to `rough`.
export const rainSplat = /*@__PURE__*/ Fn( ( [ wp, n, mask ] ) => {
	const s = float( 0 ).toVar();
	const near = smoothstep( SP.fade.mul( 0.6 ), SP.fade, wp.distance( cameraPosition ) ).oneMinus();
	const m = mask.mul( rainFall ).mul( near );
	If( m.greaterThan( 0.001 ), () => {
		const nn = n.normalize(), a = abs( nn ), up = nn.y;
		// undersides dry, side faces a share, tops all
		const facing = smoothstep( - 0.35, - 0.02, up ).mul( mix( SP.side, float( 1 ), smoothstep( 0, 0.8, up ) ) );
		// the plane most face-on to the surface; on the side planes the second axis is world y, stretched
		const sy = wp.y.div( SP.stretch.max( 1e-3 ) );
		const plane = a.y.greaterThanEqual( a.x.max( a.z ) ).select( wp.xz, a.x.greaterThanEqual( a.z ).select( vec2( wp.z, sy ), vec2( wp.x, sy ) ) );
		const marks = splatMarks( plane.mul( SP.density ), rainClock ).mul( SP.strength );
		// trickles where gravity wins: on a flat top the water sits (the marks say so)
		const steep = smoothstep( 0.25, 0.8, up ).oneMinus();
		const runs = splatTrickles( plane.mul( SP.trickleDensity.mul( 0.5 ) ), rainClock ).mul( steep );
		// (a change from the original: the side-face share is for the drops that land; what runs down a
		// wall came from above it, so the trickles keep their strength on the steep faces)
		s.assign( marks.mul( facing ).max( runs.mul( smoothstep( - 0.35, - 0.02, up ) ) ).min( 1 ).mul( m ) );
	} );
	return s;
} );
