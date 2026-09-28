// Anatomy of the fish of the Galician coast, in the format of Tidewater's FishSpecies.js
// (https://github.com/dgreenheck/tidewater, three.js version at d32799f, MIT License,
// Copyright (c) 2026 DRG Software Solutions LLC). The sand smelt, grey mullet and garfish tables
// are Tidewater's silverside, mullet and needlefish; the others are derived from its templates
// (silverside -> sardine, bar jack -> horse mackerel, blackfin tuna -> Atlantic mackerel,
// yellowtail snapper -> sea bass, sergeant major -> white seabream, bluehead wrasse -> ballan
// wrasse), reshaped to the Atlantic species.
//
// Normalized to a total length of 1 (snout tip to the tip of the tail fin). The geometry
// (geometry.js) and the skin shader (material.js) read these.
//
//  pattern: skin pattern id in the shader (see PATTERN)
//  body: fraction of the total length up to the base of the tail fin
//  top / bot / wid: dorsal height, ventral depth and half width of the body over u (0 snout ..
//    1 base of the tail fin), [ u, value ] pairs
//  sec: cross-section exponent (2 ellipse, > 2 boxier, < 2 more pointed at back and belly)
//  mouth: { corner: u of the mouth corner, y: its height, tip: height of the lips at the snout,
//    protrude: how far the lower jaw reaches beyond the upper one }
//  eye: { u, y, r }; opercle: u of the edge of the gill cover at mid-height
//  scales: scale size (0: none visible), scaleVis: how strongly they show
//  lateral: height fraction of the lateral line (0 mid-flank .. 1 back), arch: its rise at the front
//  dorsal / anal: fin segments { from, to, rays, spiny, h: [ [ t, height ], ... ] over the
//    segment, rake: [ first, last ] angle of the rays from the vertical (rad), notch: membrane
//    dip between the rays (fraction of the ray length) }
//  pectoral: { u, y, len, base, rays, shape ('rounded' | 'pointed' | 'falcate'), spread }
//  pelvic: { u, len, rays }
//  caudal: { shape: 'forked' | 'lunate' | 'rounded' | 'truncate', len, span, fork (length of the
//    middle rays relative to the lobes), rays }
//  finlets: { from, to, dorsal, ventral } (mackerels)
//  iris: eye colour (sRGB hex); irid: iridescence (0 .. 1); metal: silvery guanine reflection

export const PATTERN = {
	sandSmelt: 0, sardine: 1, horseMackerel: 2, mackerel: 3, mullet: 4, bass: 5, seabream: 6, wrasse: 7, garfish: 8, ray: 9,
};

const spiny = ( from, to, rays, h, rake, notch = 0.16 ) => ( { from, to, rays, spiny: true, h, rake, notch } );
const soft = ( from, to, rays, h, rake, notch = 0.015 ) => ( { from, to, rays, spiny: false, h, rake, notch } );
const scale = ( pts, k ) => pts.map( ( [ u, v ] ) => [ u, v * k ] );

export const SPECIES = {

	// sand smelt (Atherina presbyter, "peixe-rei"): slender, big-eyed, a silver band along the flank
	// (Tidewater's Atlantic silverside)
	sandSmelt: {
		pattern: PATTERN.sandSmelt, body: 0.83, sec: 2.0,
		top: [ [ 0, 0.003 ], [ 0.03, 0.016 ], [ 0.1, 0.035 ], [ 0.25, 0.058 ], [ 0.45, 0.068 ], [ 0.65, 0.056 ], [ 0.85, 0.034 ], [ 1, 0.026 ] ],
		bot: [ [ 0, 0.003 ], [ 0.03, 0.014 ], [ 0.1, 0.032 ], [ 0.25, 0.055 ], [ 0.45, 0.064 ], [ 0.65, 0.05 ], [ 0.85, 0.03 ], [ 1, 0.024 ] ],
		wid: [ [ 0, 0.003 ], [ 0.05, 0.016 ], [ 0.2, 0.032 ], [ 0.4, 0.036 ], [ 0.7, 0.026 ], [ 1, 0.013 ] ],
		mouth: { corner: 0.07, y: 0.004, tip: 0.006, protrude: 0 },
		eye: { u: 0.1, y: 0.014, r: 0.03 }, opercle: 0.22,
		scales: 0.02, scaleVis: 0.35, lateral: 0.05, arch: 0.1,
		dorsal: [ spiny( 0.47, 0.53, 5, [ [ 0, 0.035 ], [ 1, 0.02 ] ], [ 0.5, 0.7 ], 0.125 ), soft( 0.63, 0.74, 9, [ [ 0, 0.04 ], [ 1, 0.02 ] ], [ 0.6, 0.9 ] ) ],
		anal: [ soft( 0.58, 0.78, 12, [ [ 0, 0.035 ], [ 1, 0.018 ] ], [ 0.6, 0.9 ] ) ],
		pectoral: { u: 0.2, y: 0.02, len: 0.1, base: 0.018, rays: 10, shape: 'pointed', spread: 0.4 },
		pelvic: { u: 0.45, len: 0.05, rays: 5 },
		caudal: { shape: 'forked', len: 0.17, span: 0.1, fork: 0.5, rays: 13 },
		iris: 0xd8d8c0, irid: 0.8, metal: 0.65,
	},

	// sardine (Sardina pilchardus): fusiform, a single dorsal fin in the middle, pelvics under it,
	// a small anal fin far back, large loose scales, forked tail
	sardine: {
		pattern: PATTERN.sardine, body: 0.82, sec: 2.05,
		top: [ [ 0, 0.003 ], [ 0.03, 0.018 ], [ 0.1, 0.045 ], [ 0.25, 0.075 ], [ 0.45, 0.085 ], [ 0.65, 0.07 ], [ 0.85, 0.042 ], [ 1, 0.03 ] ],
		bot: [ [ 0, 0.003 ], [ 0.03, 0.017 ], [ 0.1, 0.043 ], [ 0.25, 0.072 ], [ 0.45, 0.08 ], [ 0.65, 0.062 ], [ 0.85, 0.036 ], [ 1, 0.027 ] ],
		wid: [ [ 0, 0.003 ], [ 0.05, 0.018 ], [ 0.2, 0.036 ], [ 0.4, 0.04 ], [ 0.7, 0.028 ], [ 1, 0.014 ] ],
		mouth: { corner: 0.08, y: 0.006, tip: 0.008, protrude: 0.004 },
		eye: { u: 0.11, y: 0.016, r: 0.028 }, opercle: 0.22,
		scales: 0.03, scaleVis: 0.5, lateral: 0.05, arch: 0.05,
		dorsal: [ soft( 0.42, 0.55, 18, [ [ 0, 0.06 ], [ 1, 0.02 ] ], [ 0.5, 0.9 ] ) ],
		anal: [ soft( 0.78, 0.88, 18, [ [ 0, 0.025 ], [ 1, 0.015 ] ], [ 0.6, 0.9 ] ) ],
		pectoral: { u: 0.22, y: - 0.04, len: 0.1, base: 0.016, rays: 15, shape: 'pointed', spread: 0.4 },
		pelvic: { u: 0.5, len: 0.05, rays: 8 },
		caudal: { shape: 'forked', len: 0.19, span: 0.13, fork: 0.4, rays: 19 },
		iris: 0xd0d0c0, irid: 0.8, metal: 0.7,
	},

	// Atlantic horse mackerel (Trachurus trachurus, "chicharro"): the bar jack, a little slimmer;
	// the lateral line carries a row of bony scutes, arched at the front
	horseMackerel: {
		pattern: PATTERN.horseMackerel, body: 0.79, sec: 2.0,
		top: scale( [ [ 0, 0.004 ], [ 0.03, 0.024 ], [ 0.08, 0.055 ], [ 0.16, 0.088 ], [ 0.28, 0.114 ], [ 0.42, 0.12 ], [ 0.56, 0.107 ], [ 0.7, 0.078 ], [ 0.84, 0.042 ], [ 0.94, 0.024 ], [ 1, 0.02 ] ], 0.82 ),
		bot: scale( [ [ 0, 0.004 ], [ 0.03, 0.02 ], [ 0.08, 0.046 ], [ 0.16, 0.074 ], [ 0.28, 0.098 ], [ 0.42, 0.105 ], [ 0.56, 0.094 ], [ 0.7, 0.068 ], [ 0.84, 0.037 ], [ 0.94, 0.022 ], [ 1, 0.019 ] ], 0.82 ),
		wid: [ [ 0, 0.004 ], [ 0.05, 0.022 ], [ 0.15, 0.04 ], [ 0.3, 0.046 ], [ 0.5, 0.042 ], [ 0.7, 0.03 ], [ 0.88, 0.02 ], [ 1, 0.016 ] ],
		mouth: { corner: 0.1, y: - 0.004, tip: - 0.001, protrude: 0.004 },
		eye: { u: 0.11, y: 0.026, r: 0.028 }, opercle: 0.26,
		scales: 0.008, scaleVis: 0.2, lateral: 0.3, arch: 0.4,
		dorsal: [ spiny( 0.32, 0.45, 8, [ [ 0, 0.05 ], [ 0.3, 0.055 ], [ 1, 0.02 ] ], [ 0.4, 0.7 ], 0.15 ), soft( 0.47, 0.84, 30, [ [ 0, 0.055 ], [ 0.15, 0.04 ], [ 1, 0.02 ] ], [ 0.55, 1.05 ] ) ],
		anal: [ spiny( 0.54, 0.57, 2, [ [ 0, 0.02 ], [ 1, 0.03 ] ], [ 0.5, 0.6 ], 0.15 ), soft( 0.58, 0.84, 27, [ [ 0, 0.05 ], [ 0.15, 0.035 ], [ 1, 0.018 ] ], [ 0.55, 1.05 ] ) ],
		pectoral: { u: 0.28, y: 0.0, len: 0.19, base: 0.022, rays: 20, shape: 'falcate', spread: 0.35 },
		pelvic: { u: 0.3, len: 0.07, rays: 6 },
		caudal: { shape: 'forked', len: 0.22, span: 0.18, fork: 0.25, rays: 17 },
		iris: 0xc8c8b0, irid: 0.7, metal: 0.55,
	},

	// Atlantic mackerel (Scomber scombrus, "xarda / sarda"): the tuna, slimmer, two widely spaced
	// dorsal fins, five finlets above and below, a forked tail; no visible scales
	mackerel: {
		pattern: PATTERN.mackerel, body: 0.85, sec: 2.0,
		top: scale( [ [ 0, 0.003 ], [ 0.03, 0.02 ], [ 0.08, 0.045 ], [ 0.15, 0.075 ], [ 0.26, 0.105 ], [ 0.38, 0.118 ], [ 0.5, 0.115 ], [ 0.62, 0.095 ], [ 0.74, 0.065 ], [ 0.86, 0.035 ], [ 0.95, 0.02 ], [ 1, 0.018 ] ], 0.72 ),
		bot: scale( [ [ 0, 0.003 ], [ 0.03, 0.018 ], [ 0.08, 0.04 ], [ 0.15, 0.065 ], [ 0.26, 0.092 ], [ 0.38, 0.105 ], [ 0.5, 0.102 ], [ 0.62, 0.085 ], [ 0.74, 0.058 ], [ 0.86, 0.032 ], [ 0.95, 0.018 ], [ 1, 0.016 ] ], 0.72 ),
		wid: scale( [ [ 0, 0.003 ], [ 0.04, 0.025 ], [ 0.12, 0.055 ], [ 0.25, 0.08 ], [ 0.4, 0.088 ], [ 0.55, 0.08 ], [ 0.7, 0.058 ], [ 0.85, 0.035 ], [ 0.95, 0.03 ], [ 1, 0.02 ] ], 0.75 ),
		mouth: { corner: 0.09, y: - 0.004, tip: - 0.002, protrude: 0.002 },
		eye: { u: 0.1, y: 0.022, r: 0.022 }, opercle: 0.25,
		scales: 0.0, scaleVis: 0.0, lateral: 0.3, arch: 0.15,
		dorsal: [ spiny( 0.3, 0.42, 11, [ [ 0, 0.06 ], [ 0.3, 0.055 ], [ 1, 0.015 ] ], [ 0.45, 0.8 ], 0.1 ), soft( 0.55, 0.62, 11, [ [ 0, 0.05 ], [ 0.5, 0.035 ], [ 1, 0.012 ] ], [ 0.75, 1.1 ] ) ],
		anal: [ soft( 0.58, 0.65, 11, [ [ 0, 0.045 ], [ 0.5, 0.03 ], [ 1, 0.01 ] ], [ 0.75, 1.1 ] ) ],
		pectoral: { u: 0.28, y: 0.0, len: 0.12, base: 0.022, rays: 18, shape: 'pointed', spread: 0.3 },
		pelvic: { u: 0.31, len: 0.05, rays: 5 },
		caudal: { shape: 'forked', len: 0.17, span: 0.19, fork: 0.3, rays: 19 },
		finlets: { from: 0.68, to: 0.93, dorsal: 5, ventral: 5 },
		iris: 0xc0b890, irid: 0.9, metal: 0.55,
	},

	// thick-lipped grey mullet (Chelon labrosus, "muxo"): Tidewater's white mullet
	mullet: {
		pattern: PATTERN.mullet, body: 0.82, sec: 2.15,
		top: [ [ 0, 0.008 ], [ 0.03, 0.03 ], [ 0.08, 0.055 ], [ 0.16, 0.08 ], [ 0.28, 0.1 ], [ 0.42, 0.107 ], [ 0.56, 0.1 ], [ 0.7, 0.082 ], [ 0.84, 0.058 ], [ 1, 0.044 ] ],
		bot: [ [ 0, 0.008 ], [ 0.03, 0.028 ], [ 0.08, 0.05 ], [ 0.16, 0.072 ], [ 0.28, 0.088 ], [ 0.42, 0.093 ], [ 0.56, 0.086 ], [ 0.7, 0.07 ], [ 0.84, 0.05 ], [ 1, 0.04 ] ],
		wid: [ [ 0, 0.008 ], [ 0.04, 0.036 ], [ 0.12, 0.06 ], [ 0.25, 0.072 ], [ 0.42, 0.072 ], [ 0.6, 0.06 ], [ 0.8, 0.04 ], [ 1, 0.024 ] ],
		mouth: { corner: 0.055, y: - 0.004, tip: 0.0, protrude: 0 },
		eye: { u: 0.1, y: 0.024, r: 0.02 }, opercle: 0.25,
		scales: 0.024, scaleVis: 0.6, lateral: 0.3, arch: 0.0,
		dorsal: [ spiny( 0.44, 0.52, 4, [ [ 0, 0.06 ], [ 1, 0.035 ] ], [ 0.35, 0.6 ], 0.125 ), soft( 0.66, 0.74, 9, [ [ 0, 0.06 ], [ 1, 0.025 ] ], [ 0.55, 0.9 ] ) ],
		anal: [ soft( 0.62, 0.72, 11, [ [ 0, 0.055 ], [ 1, 0.025 ] ], [ 0.55, 0.9 ] ) ],
		pectoral: { u: 0.27, y: 0.03, len: 0.13, base: 0.022, rays: 16, shape: 'pointed', spread: 0.45 },
		pelvic: { u: 0.4, len: 0.08, rays: 6 },
		caudal: { shape: 'forked', len: 0.18, span: 0.13, fork: 0.6, rays: 15 },
		iris: 0xc8b890, irid: 0.5, metal: 0.55,
	},

	// European sea bass (Dicentrarchus labrax, "robaliza"): the yellowtail snapper's body, a larger
	// mouth, two separate dorsal fins, a slightly forked tail
	bass: {
		pattern: PATTERN.bass, body: 0.8, sec: 2.1,
		top: [ [ 0, 0.004 ], [ 0.03, 0.02 ], [ 0.08, 0.045 ], [ 0.16, 0.074 ], [ 0.28, 0.099 ], [ 0.42, 0.108 ], [ 0.56, 0.099 ], [ 0.7, 0.077 ], [ 0.85, 0.051 ], [ 1, 0.04 ] ],
		bot: [ [ 0, 0.004 ], [ 0.03, 0.016 ], [ 0.08, 0.035 ], [ 0.16, 0.058 ], [ 0.28, 0.079 ], [ 0.42, 0.089 ], [ 0.56, 0.082 ], [ 0.7, 0.063 ], [ 0.85, 0.044 ], [ 1, 0.036 ] ],
		wid: [ [ 0, 0.004 ], [ 0.05, 0.022 ], [ 0.14, 0.038 ], [ 0.28, 0.048 ], [ 0.45, 0.048 ], [ 0.65, 0.039 ], [ 0.85, 0.027 ], [ 1, 0.019 ] ],
		mouth: { corner: 0.12, y: - 0.01, tip: - 0.002, protrude: 0.005 },
		eye: { u: 0.12, y: 0.034, r: 0.02 }, opercle: 0.28,
		scales: 0.016, scaleVis: 0.55, lateral: 0.35, arch: 0.1,
		dorsal: [ spiny( 0.3, 0.47, 9, [ [ 0, 0.045 ], [ 0.3, 0.07 ], [ 1, 0.03 ] ], [ 0.35, 0.55 ], 0.16 ), soft( 0.52, 0.76, 13, [ [ 0, 0.055 ], [ 1, 0.03 ] ], [ 0.6, 0.95 ] ) ],
		anal: [ spiny( 0.6, 0.64, 3, [ [ 0, 0.025 ], [ 1, 0.04 ] ], [ 0.4, 0.5 ], 0.1 ), soft( 0.64, 0.77, 11, [ [ 0, 0.05 ], [ 1, 0.028 ] ], [ 0.6, 0.9 ] ) ],
		pectoral: { u: 0.3, y: - 0.015, len: 0.14, base: 0.025, rays: 16, shape: 'pointed', spread: 0.4 },
		pelvic: { u: 0.33, len: 0.09, rays: 6 },
		caudal: { shape: 'forked', len: 0.2, span: 0.15, fork: 0.75, rays: 17 },
		iris: 0xd8d0b0, irid: 0.4, metal: 0.5,
	},

	// white seabream (Diplodus sargus, "sargo"): the sergeant major's deep body, a pointed snout
	// with a small mouth, a forked tail
	seabream: {
		pattern: PATTERN.seabream, body: 0.79, sec: 2.1,
		top: [ [ 0, 0.005 ], [ 0.03, 0.03 ], [ 0.08, 0.07 ], [ 0.16, 0.12 ], [ 0.28, 0.165 ], [ 0.42, 0.18 ], [ 0.56, 0.168 ], [ 0.7, 0.132 ], [ 0.84, 0.08 ], [ 1, 0.052 ] ],
		bot: [ [ 0, 0.005 ], [ 0.03, 0.024 ], [ 0.08, 0.055 ], [ 0.16, 0.095 ], [ 0.28, 0.135 ], [ 0.42, 0.148 ], [ 0.56, 0.138 ], [ 0.7, 0.108 ], [ 0.84, 0.07 ], [ 1, 0.048 ] ],
		wid: [ [ 0, 0.005 ], [ 0.05, 0.028 ], [ 0.15, 0.048 ], [ 0.3, 0.055 ], [ 0.5, 0.05 ], [ 0.7, 0.038 ], [ 0.9, 0.023 ], [ 1, 0.019 ] ],
		mouth: { corner: 0.065, y: - 0.008, tip: - 0.004, protrude: 0 },
		eye: { u: 0.16, y: 0.058, r: 0.03 }, opercle: 0.29,
		scales: 0.022, scaleVis: 0.55, lateral: 0.55, arch: 0.15,
		dorsal: [ spiny( 0.3, 0.6, 12, [ [ 0, 0.05 ], [ 0.3, 0.08 ], [ 1, 0.06 ] ], [ 0.35, 0.5 ] ), soft( 0.6, 0.85, 14, [ [ 0, 0.065 ], [ 0.5, 0.06 ], [ 1, 0.03 ] ], [ 0.6, 1.0 ] ) ],
		anal: [ spiny( 0.58, 0.63, 3, [ [ 0, 0.04 ], [ 1, 0.06 ] ], [ 0.4, 0.5 ], 0.1 ), soft( 0.63, 0.84, 13, [ [ 0, 0.065 ], [ 0.5, 0.06 ], [ 1, 0.03 ] ], [ 0.6, 1.0 ] ) ],
		pectoral: { u: 0.3, y: - 0.02, len: 0.2, base: 0.03, rays: 15, shape: 'pointed', spread: 0.4 },
		pelvic: { u: 0.34, len: 0.1, rays: 6 },
		caudal: { shape: 'forked', len: 0.21, span: 0.17, fork: 0.55, rays: 17 },
		iris: 0xc8c0a0, irid: 0.2, metal: 0.35,
	},

	// ballan wrasse (Labrus bergylta, "maragota"): the bluehead wrasse, deeper and heavier, thick
	// lips, a long spiny dorsal fin, a rounded tail
	wrasse: {
		pattern: PATTERN.wrasse, body: 0.83, sec: 2.1,
		top: scale( [ [ 0, 0.004 ], [ 0.03, 0.02 ], [ 0.08, 0.042 ], [ 0.18, 0.07 ], [ 0.32, 0.088 ], [ 0.5, 0.09 ], [ 0.68, 0.075 ], [ 0.85, 0.05 ], [ 1, 0.042 ] ], 1.3 ),
		bot: scale( [ [ 0, 0.004 ], [ 0.03, 0.018 ], [ 0.08, 0.038 ], [ 0.18, 0.063 ], [ 0.32, 0.08 ], [ 0.5, 0.082 ], [ 0.68, 0.068 ], [ 0.85, 0.046 ], [ 1, 0.04 ] ], 1.25 ),
		wid: scale( [ [ 0, 0.004 ], [ 0.05, 0.022 ], [ 0.15, 0.038 ], [ 0.3, 0.045 ], [ 0.5, 0.043 ], [ 0.7, 0.034 ], [ 0.9, 0.022 ], [ 1, 0.018 ] ], 1.2 ),
		mouth: { corner: 0.08, y: - 0.006, tip: 0.0, protrude: 0.002 },
		eye: { u: 0.13, y: 0.038, r: 0.019 }, opercle: 0.26,
		scales: 0.022, scaleVis: 0.6, lateral: 0.6, arch: 0.2,
		dorsal: [ spiny( 0.25, 0.62, 19, [ [ 0, 0.04 ], [ 1, 0.045 ] ], [ 0.5, 0.6 ], 0.1 ), soft( 0.62, 0.86, 11, [ [ 0, 0.055 ], [ 1, 0.04 ] ], [ 0.6, 0.85 ] ) ],
		anal: [ spiny( 0.6, 0.64, 3, [ [ 0, 0.03 ], [ 1, 0.04 ] ], [ 0.5, 0.6 ], 0.1 ), soft( 0.64, 0.85, 10, [ [ 0, 0.05 ], [ 1, 0.035 ] ], [ 0.6, 0.85 ] ) ],
		pectoral: { u: 0.25, y: 0.0, len: 0.12, base: 0.028, rays: 14, shape: 'rounded', spread: 0.5 },
		pelvic: { u: 0.29, len: 0.07, rays: 5 },
		caudal: { shape: 'rounded', len: 0.16, span: 0.11, fork: 1.0, rays: 14 },
		iris: 0xc06a3a, irid: 0.1, metal: 0.05,
	},

	// garfish (Belone belone, "agulla"): Tidewater's needlefish
	garfish: {
		pattern: PATTERN.garfish, body: 0.9, sec: 2.0,
		top: [ [ 0, 0.0015 ], [ 0.1, 0.0035 ], [ 0.17, 0.007 ], [ 0.22, 0.017 ], [ 0.28, 0.026 ], [ 0.4, 0.032 ], [ 0.6, 0.034 ], [ 0.78, 0.03 ], [ 0.9, 0.02 ], [ 1, 0.014 ] ],
		bot: [ [ 0, 0.0015 ], [ 0.1, 0.0035 ], [ 0.17, 0.007 ], [ 0.22, 0.016 ], [ 0.28, 0.024 ], [ 0.4, 0.03 ], [ 0.6, 0.032 ], [ 0.78, 0.028 ], [ 0.9, 0.019 ], [ 1, 0.013 ] ],
		wid: [ [ 0, 0.0015 ], [ 0.1, 0.003 ], [ 0.18, 0.008 ], [ 0.24, 0.02 ], [ 0.4, 0.026 ], [ 0.7, 0.024 ], [ 0.9, 0.016 ], [ 1, 0.012 ] ],
		mouth: { corner: 0.2, y: 0.0, tip: 0.0, protrude: 0.006 },
		eye: { u: 0.235, y: 0.008, r: 0.012 }, opercle: 0.3,
		scales: 0.0, scaleVis: 0.0, lateral: - 0.7, arch: 0.0,
		dorsal: [ soft( 0.76, 0.9, 14, [ [ 0, 0.04 ], [ 0.2, 0.035 ], [ 1, 0.018 ] ], [ 0.6, 0.95 ] ) ],
		anal: [ soft( 0.73, 0.89, 18, [ [ 0, 0.04 ], [ 0.2, 0.035 ], [ 1, 0.018 ] ], [ 0.6, 0.95 ] ) ],
		pectoral: { u: 0.33, y: 0.006, len: 0.06, base: 0.01, rays: 12, shape: 'pointed', spread: 0.35 },
		pelvic: { u: 0.62, len: 0.04, rays: 6 },
		caudal: { shape: 'forked', len: 0.1, span: 0.06, fork: 0.75, rays: 15 },
		iris: 0xd0d8c8, irid: 0.6, metal: 0.55,
	},

	// thornback ray (Raja clavata): geometry from creatures.js; this entry only feeds the skin table
	ray: { pattern: PATTERN.ray, body: 1, eye: { u: 0.3, y: 0.05, r: 0.012 }, opercle: 0.4, mouth: { corner: 0.1, y: - 0.03, tip: - 0.03 }, lateral: 0, arch: 0, scales: 0, scaleVis: 0, iris: 0x606040, irid: 0, metal: 0 },

};

// Skin colours (sRGB): back, flank, belly, fins, fin edges; the shader adds the species'
// markings (spots, bars, scutes, mottling) on top.
export const SKIN = {
	sandSmelt: { back: 0x6d8a7a, flank: 0xc4ccce, belly: 0xe6eaea, fin: 0xa8b4ae, edge: 0x98a4a0, rough: 0.3 },
	sardine: { back: 0x2a5a6a, flank: 0xc8d0d4, belly: 0xeef0f0, fin: 0x9aa8ac, edge: 0x6a787c, rough: 0.3 },
	horseMackerel: { back: 0x4a6470, flank: 0xb8c4c8, belly: 0xe6eaea, fin: 0x8c989c, edge: 0x5a6468, rough: 0.3 },
	mackerel: { back: 0x1e5a4a, flank: 0xa8c0c4, belly: 0xeef2f2, fin: 0x5a6e6a, edge: 0x2a3a36, rough: 0.28 },
	mullet: { back: 0x485856, flank: 0xb4bcbe, belly: 0xe6eaea, fin: 0x848c8c, edge: 0x6c7474, rough: 0.33 },
	bass: { back: 0x4a5a64, flank: 0xb4bcc2, belly: 0xe8ecee, fin: 0x7a868c, edge: 0x5a646a, rough: 0.33 },
	seabream: { back: 0x7a7e7a, flank: 0xbcc0bc, belly: 0xe4e6e2, fin: 0x9a9c96, edge: 0x2a2a2a, rough: 0.35 },
	wrasse: { back: 0x4a5a2e, flank: 0x7a6a3a, belly: 0xb89a62, fin: 0x5a5a32, edge: 0x3a3a22, rough: 0.4 },
	garfish: { back: 0x2a6a5a, flank: 0xb4cccc, belly: 0xeef2f2, fin: 0x6a8a82, edge: 0x3a5a5a, rough: 0.3 },
	ray: { back: 0x6a5a44, flank: 0x7a6a50, belly: 0xdcdad4, fin: 0x4c4236, edge: 0x8a7c66, rough: 0.5 },
};
