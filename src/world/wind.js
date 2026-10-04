// One wind for the whole world (after Folio 2025 / Cortiz's grass field, where the blades, the
// flowers and the canopies read the same direction and clock, so a gust moves the trees and the
// grass under them together instead of each swaying on its own): the direction it blows to, a gust
// field travelling along it, and an overall amount (calm at night, stronger in the rain). Each
// material keeps its own amplitude and shape; what they share is where and when the gusts are.
//
// Readers: the grass (grass.js), the foliage of trees, shrubs, ferns and meadow flowers
// (vegetation.js createFoliageMaterial), the cloth (materials.js clothSway), the rain (weather.js).
// Set by main.js (onSunChanged: the night's calm) and weather.js (the storm).
import * as THREE from 'three/webgpu';
import { Fn, vec2, vec3, dot, floor, fract, mix, smoothstep, time, uniform } from 'three/tsl';

// where it blows to: from the south-west, off the Atlantic (+x east, +z south)
export const WIND_DIR = new THREE.Vector2( 0.62, - 0.78 ).normalize();

export const wind = {
	dir: uniform( WIND_DIR.clone() ),
	strength: uniform( 1 ),  // the panel's "Força": over everything below
	speed: uniform( 5.5 ),   // m/s: how fast the gusts travel across the world
	freq: uniform( 1 ),      // the panel's "Frequência": 1 = gusts in ~35 m and ~15 m cells, 2 = half as big
	turb: uniform( 1 ),      // the panel's "Turbulência": the fast flutter of blades, leaves and cloth
	calm: uniform( 1 ),      // the night's calm (main.js: 1 by day, 0.3 at night)
	storm: uniform( 1 ),     // the rain's (weather.js: 1, up to 1.6 in full rain)
};
// the overall amount every reader multiplies its own by
export const windAmount = wind.strength.mul( wind.calm ).mul( wind.storm );

// the panel's defaults and the direction it blows FROM, in compass degrees (0 north, 90 east)
export const WIND_DEFAULTS = { strength: 1, speed: 5.5, freq: 1, turb: 1, from: 218 };
export function setWindFrom( deg ) {
	const a = deg * Math.PI / 180;
	// from the compass bearing to where it blows: north is -z, east +x
	wind.dir.value.set( - Math.sin( a ), Math.cos( a ) );
}
export function windFrom() {
	const d = wind.dir.value;
	return ( Math.atan2( - d.x, d.y ) * 180 / Math.PI + 360 ) % 360;
}

const hash12 = /*@__PURE__*/ Fn( ( [ p ] ) => {
	const p3 = fract( vec3( p.x, p.y, p.x ).mul( 0.1031 ) ).toVar();
	p3.addAssign( dot( p3, p3.yzx.add( 33.33 ) ) );
	return fract( p3.x.add( p3.y ).mul( p3.z ) );
} ).setLayout( { name: 'windHash12', type: 'float', inputs: [ { name: 'p', type: 'vec2' } ] } );
const vnoise = /*@__PURE__*/ Fn( ( [ p ] ) => {
	const i = floor( p );
	const f = fract( p );
	const u = f.mul( f ).mul( f.mul( - 2 ).add( 3 ) );
	const a = hash12( i ), b = hash12( i.add( vec2( 1, 0 ) ) ), c = hash12( i.add( vec2( 0, 1 ) ) ), d = hash12( i.add( vec2( 1, 1 ) ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
} ).setLayout( { name: 'windNoise', type: 'float', inputs: [ { name: 'p', type: 'vec2' } ] } );

// The gust at world xz now, 0..1: a noise field (~35 m and ~15 m cells) carried downwind, sharpened
// into gusts with lulls between them (the grass's own, moved here so everything reads the same).
export const gustAt = ( xz ) => {
	const p = xz.sub( wind.dir.mul( time.mul( wind.speed ) ) ).mul( wind.freq );
	const nz = vnoise( p.div( 35 ) ).mul( 0.62 ).add( vnoise( p.div( 15 ).add( 0.37 ) ).mul( 0.38 ) );
	return smoothstep( 0.46, 0.6, nz );
};
// the same, softened (a canopy or a cloth answers the gust with a lag and never quite stops)
export const gustSoft = ( xz ) => {
	const p = xz.sub( wind.dir.mul( time.mul( wind.speed ) ) ).mul( wind.freq );
	const nz = vnoise( p.div( 35 ) ).mul( 0.62 ).add( vnoise( p.div( 15 ).add( 0.37 ) ).mul( 0.38 ) );
	return smoothstep( 0.35, 0.68, nz );
};

export const windDir3 = vec3( wind.dir.x, 0, wind.dir.y );
