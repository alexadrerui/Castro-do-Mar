// The look by the hour: one table of key frames, after offroad's world/environment.js
// (https://github.com/alexadrerui/offroad, MIT, Copyright (c) 2026 Arz-Gev, licenses/LICENSE-offroad.md).
// The sun and the moon follow their arcs (world/clock.js) and the sky stays physical (Preetham, the
// night factor, the sun's colour, the moonlight); what was a tuning by hand, spread as curves of the sun's
// height over main.js and sky.js, is a row per hour here and is read through a monotone cubic
// (Fritsch–Carlson) that wraps through midnight: no overshoot, no kink at the keys, and a key renders
// exactly its own values (the presets 9:00, 15:32 and 23:00 are keys, so they look as they did).
// To retune an hour, edit its row; to add a look (a pinker dawn than the dusk), add a key.
//
// The first table was sampled from the old curves (tools/lookkeys.mjs: keys added where the error was
// largest until every column was within 1.5% of its range), so the day renders as before; mornings and
// evenings were mirror images then (all of it hung on the sun's height) and can now differ.
//
// Columns (what reads them):
//   exposure   the fixed exposure, before the eye's adaptation (main.js: renderer.toneMappingExposure)
//   auto       how much the eye adapts by itself, 0..1 (post/autoExposure.js; × app.autoExposure)
//   ambient    the sky's light on the ground (sky.js: the hemisphere light's intensity)
//   haze       the brightness of the haze and the far haze (main.js: hazeColor, hazeFar)
//   warm       how warm the haze is: 0 cold dusk blue .. 1 afternoon
//   sunset     how far the low sun's light goes to deep orange (sky.js)
//   afterglow  the clouds' own glow after the sun has set (main.js, the clouds' light)
//   nightFog   the night mist in the valleys and over the water, 0..1 (× less in the rain)
//   calm       the wind's strength (world/wind.js: wind.calm; low at night against flickering leaves)
//   cool       the cool tint of the shadows in the grade (main.js graded(); 1 by day)

export const LOOK_COLUMNS = [ 'exposure', 'auto', 'ambient', 'haze', 'warm', 'sunset', 'afterglow', 'nightFog', 'calm', 'cool' ];

// "17:45" -> 17.75 (the table's hours are written as text for reading)
export const hm = ( s ) => { const [ a, b ] = s.split( ':' ).map( Number ); return a + b / 60; };

// hour (0..24) and the values; ascending by hour
// KEYS:BEGIN (tools/lookkeys.mjs --write rewrites this block from the old curves)
export const KEYS = [
	{ h: hm( '00:00' ), exposure: 2, auto: 1, ambient: 0.08499, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0, nightFog: 1, calm: 0.3, cool: 0.3 },
	{ h: hm( '05:22' ), exposure: 2, auto: 1, ambient: 0.0852, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0, nightFog: 1, calm: 0.3, cool: 0.3 },
	{ h: hm( '05:35' ), exposure: 2, auto: 1, ambient: 0.10997, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0, nightFog: 1, calm: 0.30524, cool: 0.30524 },
	{ h: hm( '05:42' ), exposure: 2, auto: 1, ambient: 0.13311, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0, nightFog: 1, calm: 0.34707, cool: 0.34707 },
	{ h: hm( '05:59' ), exposure: 1.98159, auto: 0.98466, ambient: 0.1809, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0.00005, nightFog: 1, calm: 0.56556, cool: 0.56556 },
	{ h: hm( '06:04' ), exposure: 1.93703, auto: 0.94752, ambient: 0.18497, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0.05108, nightFog: 1, calm: 0.64508, cool: 0.64508 },
	{ h: hm( '06:12' ), exposure: 1.82124, auto: 0.85103, ambient: 0.18499, haze: 0.36423, warm: 0, sunset: 0.8, afterglow: 0.24874, nightFog: 1, calm: 0.77098, cool: 0.77098 },
	{ h: hm( '06:17' ), exposure: 1.72753, auto: 0.77294, ambient: 0.18499, haze: 0.38709, warm: 0, sunset: 0.8, afterglow: 0.37362, nightFog: 1, calm: 0.84302, cool: 0.84302 },
	{ h: hm( '06:20' ), exposure: 1.66552, auto: 0.72127, ambient: 0.18499, haze: 0.4052, warm: 0, sunset: 0.8, afterglow: 0.42594, nightFog: 1, calm: 0.8819, cool: 0.8819 },
	{ h: hm( '06:24' ), exposure: 1.57793, auto: 0.64828, ambient: 0.18293, haze: 0.4338, warm: 0, sunset: 0.8, afterglow: 0.45, nightFog: 1, calm: 0.92705, cool: 0.92705 },
	{ h: hm( '06:31' ), exposure: 1.41692, auto: 0.5141, ambient: 0.16917, haze: 0.49392, warm: 0.00455, sunset: 0.75457, afterglow: 0.45, nightFog: 0.99963, calm: 0.9825, cool: 0.9825 },
	{ h: hm( '06:36' ), exposure: 1.30096, auto: 0.41747, ambient: 0.15415, haze: 0.54282, warm: 0.01845, sunset: 0.63164, afterglow: 0.45, nightFog: 0.98726, calm: 0.99926, cool: 0.99926 },
	{ h: hm( '06:46' ), exposure: 1.08384, auto: 0.23653, ambient: 0.12125, haze: 0.64914, warm: 0.07064, sunset: 0.28637, afterglow: 0.44138, nightFog: 0.91642, calm: 1, cool: 1 },
	{ h: hm( '06:58' ), exposure: 0.88506, auto: 0.07089, ambient: 0.10062, haze: 0.77824, warm: 0.16769, sunset: 0.00504, afterglow: 0.2989, nightFog: 0.76985, calm: 1, cool: 1 },
	{ h: hm( '07:06' ), exposure: 0.81304, auto: 0.01087, ambient: 0.10497, haze: 0.8565, warm: 0.2476, sunset: 0, afterglow: 0.164, nightFog: 0.648, calm: 1, cool: 1 },
	{ h: hm( '07:20' ), exposure: 0.8, auto: 0, ambient: 0.11391, haze: 0.96044, warm: 0.40489, sunset: 0, afterglow: 0.00429, nightFog: 0.41701, calm: 1, cool: 1 },
	{ h: hm( '07:30' ), exposure: 0.8, auto: 0, ambient: 0.1205, haze: 0.99669, warm: 0.52256, sunset: 0, afterglow: 0, nightFog: 0.25926, calm: 1, cool: 1 },
	{ h: hm( '07:52' ), exposure: 0.8, auto: 0, ambient: 0.13484, haze: 1, warm: 0.76474, sunset: 0, afterglow: 0, nightFog: 0.0223, calm: 1, cool: 1 },
	{ h: hm( '08:19' ), exposure: 0.8, auto: 0, ambient: 0.1505, haze: 1, warm: 0.96371, sunset: 0, afterglow: 0, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '08:31' ), exposure: 0.8, auto: 0, ambient: 0.15629, haze: 1, warm: 0.9976, sunset: 0, afterglow: 0, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '09:00' ), exposure: 0.8, auto: 0, ambient: 0.16628, haze: 1, warm: 1, sunset: 0, afterglow: 0, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '09:28' ), exposure: 0.8, auto: 0, ambient: 0.16995, haze: 1, warm: 1, sunset: 0, afterglow: 0, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '14:36' ), exposure: 0.8, auto: 0, ambient: 0.16979, haze: 1, warm: 1, sunset: 0, afterglow: 0, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '15:32' ), exposure: 0.8, auto: 0, ambient: 0.15492, haze: 1, warm: 0.9928, sunset: 0, afterglow: 0, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '16:29' ), exposure: 0.8, auto: 0, ambient: 0.12116, haze: 0.99816, warm: 0.53429, sunset: 0, afterglow: 0, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '16:41' ), exposure: 0.8, auto: 0, ambient: 0.11325, haze: 0.95485, warm: 0.39322, sunset: 0, afterglow: 0.00867, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '16:46' ), exposure: 0.8, auto: 0, ambient: 0.11002, haze: 0.9223, warm: 0.33561, sunset: 0, afterglow: 0.05003, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '17:01' ), exposure: 0.87299, auto: 0.06082, ambient: 0.10081, haze: 0.78853, warm: 0.17712, sunset: 0.00068, afterglow: 0.28242, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '17:05' ), exposure: 0.92594, auto: 0.10495, ambient: 0.10217, haze: 0.74675, warm: 0.14051, sunset: 0.04016, afterglow: 0.34574, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '17:10' ), exposure: 1.0079, auto: 0.17325, ambient: 0.11061, haze: 0.69282, warm: 0.09935, sunset: 0.15749, afterglow: 0.40964, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '17:18' ), exposure: 1.16698, auto: 0.30581, ambient: 0.13397, haze: 0.60576, warm: 0.04618, sunset: 0.4288, afterglow: 0.45, nightFog: 0, calm: 1, cool: 1 },
	{ h: hm( '17:28' ), exposure: 1.39362, auto: 0.49468, ambient: 0.16644, haze: 0.50336, warm: 0.00661, sunset: 0.73512, afterglow: 0.45, nightFog: 0.01782, calm: 0.98752, cool: 0.98752 },
	{ h: hm( '17:32' ), exposure: 1.48662, auto: 0.57218, ambient: 0.17623, haze: 0.46677, warm: 0.00065, sunset: 0.79324, afterglow: 0.45, nightFog: 0.05306, calm: 0.96286, cool: 0.96286 },
	{ h: hm( '17:38' ), exposure: 1.62232, auto: 0.68527, ambient: 0.18466, haze: 0.4189, warm: 0, sunset: 0.8, afterglow: 0.44545, nightFog: 0.13496, calm: 0.90553, cool: 0.90553 },
	{ h: hm( '17:41' ), exposure: 1.6866, auto: 0.73883, ambient: 0.18499, haze: 0.39883, warm: 0, sunset: 0.8, afterglow: 0.41122, nightFog: 0.18661, calm: 0.86937, cool: 0.86937 },
	{ h: hm( '17:47' ), exposure: 1.80361, auto: 0.83634, ambient: 0.18499, haze: 0.36801, warm: 0, sunset: 0.8, afterglow: 0.27581, nightFog: 0.30574, calm: 0.78598, cool: 0.78598 },
	{ h: hm( '17:51' ), exposure: 1.87025, auto: 0.89187, ambient: 0.18499, haze: 0.35543, warm: 0, sunset: 0.8, afterglow: 0.16705, nightFog: 0.39327, calm: 0.72471, cool: 0.72471 },
	{ h: hm( '17:54' ), exposure: 1.91275, auto: 0.92729, ambient: 0.18499, haze: 0.35072, warm: 0, sunset: 0.8, afterglow: 0.09225, nightFog: 0.46124, calm: 0.67713, cool: 0.67713 },
	{ h: hm( '18:01' ), exposure: 1.98159, auto: 0.98466, ambient: 0.1809, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0.00005, nightFog: 0.62063, calm: 0.56556, cool: 0.56556 },
	{ h: hm( '18:18' ), exposure: 2, auto: 1, ambient: 0.13311, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0, nightFog: 0.93275, calm: 0.34707, cool: 0.34707 },
	{ h: hm( '18:25' ), exposure: 2, auto: 1, ambient: 0.10997, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0, nightFog: 0.99251, calm: 0.30524, cool: 0.30524 },
	{ h: hm( '18:38' ), exposure: 2, auto: 1, ambient: 0.0852, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0, nightFog: 1, calm: 0.3, cool: 0.3 },
	{ h: hm( '23:00' ), exposure: 2, auto: 1, ambient: 0.08499, haze: 0.35, warm: 0, sunset: 0.8, afterglow: 0, nightFog: 1, calm: 0.3, cool: 0.3 }
];
// KEYS:END

// ---- monotone cubic through the keys, periodic in 24 h
let _tangents = null, _keys = null;

function prepare( keys ) {
	const n = keys.length;
	const T = {};
	for ( const c of LOOK_COLUMNS ) {
		const y = keys.map( ( k ) => k[ c ] );
		const h = keys.map( ( k, i ) => ( i === n - 1 ? keys[ 0 ].h + 24 : keys[ i + 1 ].h ) - k.h );
		const d = y.map( ( v, i ) => ( y[ ( i + 1 ) % n ] - v ) / h[ i ] );
		const m = y.map( ( _, i ) => {
			const dp = d[ ( i - 1 + n ) % n ], dn = d[ i ];
			if ( dp * dn <= 0 ) return 0;                 // a peak, a trough or a flat: no overshoot
			const hp = h[ ( i - 1 + n ) % n ], hn = h[ i ];
			const w1 = 2 * hn + hp, w2 = hn + 2 * hp;     // Fritsch–Butland weighted harmonic mean
			return ( w1 + w2 ) / ( w1 / dp + w2 / dn );
		} );
		T[ c ] = { y, h, m };
	}
	return T;
}

// after editing the table in place (the console: app.look.keys[ i ].exposure = 2.2; app.look.apply())
export function refreshLook() { _keys = null; }

// the look at an hour, written into `out` (a fresh object without one)
export function lookAt( hour, keys = KEYS, out = {} ) {
	if ( keys !== _keys ) { _tangents = prepare( keys ); _keys = keys; }
	const n = keys.length;
	hour = ( ( hour % 24 ) + 24 ) % 24;
	let i = n - 1;
	for ( let j = 0; j < n; j ++ ) if ( keys[ j ].h <= hour ) i = j;
	const h0 = keys[ i ].h, t0 = hour >= h0 ? hour - h0 : hour + 24 - h0;
	for ( const c of LOOK_COLUMNS ) {
		const { y, h, m } = _tangents[ c ];
		const hi = h[ i ], t = t0 / hi, t2 = t * t, t3 = t2 * t;
		const y1 = y[ ( i + 1 ) % n ];
		out[ c ] = ( 2 * t3 - 3 * t2 + 1 ) * y[ i ] + ( t3 - 2 * t2 + t ) * hi * m[ i ] + ( - 2 * t3 + 3 * t2 ) * y1 + ( t3 - t2 ) * hi * m[ ( i + 1 ) % n ];
	}
	return out;
}
