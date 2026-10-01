// Drifting cloud shadows: a two-octave value noise in world XZ multiplied into the colour of the
// terrain, the grass, the plants, the rocks and the buildings. Two noise taps per fragment, no extra pass. Port of
// rendering/cloudShadow.js of Drusniel: Gods' End (https://github.com/danielsobrado/drusniel-gods-end,
// MIT, Copyright (c) 2026 Daniel Sobrado, licenses/LICENSE-Drusniel.md). Changes: the coverage is the
// sky's own cloudCoverage uniform (the "Nuvens" slider moves both), the drift follows the sky's clouds on
// the TSL clock instead of a CPU-updated offset, and the strength fades with the sun's
// height (no hard shadows under a low, weak sun); the threshold is rescaled to the noise's range.
// app.cloudShadow: { strength, scale, speed } uniforms; strength 0 turns it off (the factor is 1).
import { Fn, dot, float, floor, fract, mix, positionWorld, sin, smoothstep, uniform, vec2, time } from 'three/tsl';

export const cloudShadowUniforms = {
	strength: uniform( 0.4 ),
	scale: uniform( 0.012 ),   // 1 / feature size: ~85 m cloud cells
	speed: uniform( 0.05 ),    // cells per second along the drift (~4 m/s)
	coverage: uniform( 0.5 ),  // replaced by the sky's cloudCoverage (bindSky)
	sunFade: uniform( 1 )      // 0 with the sun down
};

const hash = Fn( ( [ p ] ) => fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ).mul( 43758.5453 ) ) );

const valueNoise = Fn( ( [ p ] ) => {
	const cell = floor( p );
	const f = fract( p );
	const u = f.mul( f ).mul( f.mul( - 2 ).add( 3 ) );
	return mix(
		mix( hash( cell ), hash( cell.add( vec2( 1, 0 ) ) ), u.x ),
		mix( hash( cell.add( vec2( 0, 1 ) ) ), hash( cell.add( vec2( 1, 1 ) ) ), u.x ),
		u.y
	);
} );

// the shade factor (1 in the sun, 1 - strength under a cloud)
export const cloudShade = Fn( () => {
	const U = cloudShadowUniforms;
	const drift = time.mul( U.speed ).mul( 0.7071 );
	// sampled ahead along +x +z, like the sky's cloud plane (SkyMesh adds time x speed to its uv): the
	// pattern moves toward -x -z, as the clouds overhead do
	const p = positionWorld.xz.mul( U.scale ).add( vec2( drift, drift ) );
	const noise = valueNoise( p ).mul( 0.65 ).add( valueNoise( p.mul( 2.3 ).add( 7.7 ) ).mul( 0.35 ) );
	// denser cloud cover lowers the threshold so more of the field is shaded. The two-octave noise
	// stays mostly within 0.35..0.65: the threshold spans that (cover 0 -> 0.75, none; 0.55 -> ~0.47,
	// about a third shaded; 1 -> 0.25, all), with a short ramp for soft but readable edges (the
	// original's 0.3 + 0.5 (1 - cover) and 0.32 ramp left almost no shadow at our sky's 0.55)
	const threshold = U.coverage.mul( - 0.5 ).add( 0.75 );
	const cloud = smoothstep( threshold, threshold.add( 0.14 ), noise );
	return float( 1 ).sub( cloud.mul( U.strength ).mul( U.sunFade ) );
} );

// the sky's coverage drives the shadows (call before any material using cloudShade() is built)
export function bindSky( sky ) {
	cloudShadowUniforms.coverage = sky.sky.cloudCoverage;
}

// the sun's height (degrees): full shadows from 12 degrees up
export function updateCloudSun( elevation ) {
	cloudShadowUniforms.sunFade.value = Math.min( 1, Math.max( 0, ( elevation - 2 ) / 10 ) );
}
