// Seabed configuration: everything that decides WHAT grows WHERE on the sea floor, as data.
// seabed.js only interprets these tables, so the seabed can be retuned (or new organisms added)
// without touching the generation code. The result is procedural and deterministic: every
// TILE x TILE m tile gets its content from `seed` and its coordinates, so the same seed always
// gives the same seabed. Change `seed` for another arrangement with the same rules.
//
// At runtime: app.seabed.regenerate() rebuilds the tiles around the camera (after editing
// app.seabed.config in the console, for example); a page reload picks up edits to this file.

export const SEABED = {

	seed: 0x5eab,

	// ---- streaming / drawing
	tile: 16, // m
	range: 45, // underwater draw distance (m)
	rangeAbove: 26, // from just above the water (shrinks with height)
	maxTop: - 0.15, // nothing but rocks rises above this depth (m below the surface)

	// ---- habitat fields (from the heightfield and a few noise fields)
	// rock share = max( smoothstep( slope ), smoothstep( rock noise ) ): 0 sand .. 1 rock
	habitat: {
		rockSlope: [ 0.22, 0.5 ], // slope (rise / run) that turns sand into rock
		rockNoise: { freq: 0.035, detailFreq: 0.11, detail: 0.3, range: [ 0.12, 0.42 ] }, // rock patches on flat ground
		patchFreq: 0.09, // clumping of kelp, algae and mussels (field -1 .. 1)
		meadowFreq: 0.045, meadowDetailFreq: 0.15, meadowDetail: 0.35, // eelgrass beds (field ~ -1.3 .. 1.3)
	},

	// ---- types: what can be placed
	//  model: geometry (see MODELS in seabed.js; several = random pick)
	//  surface: shader branch (materials.js SURFACE: rock, urchin, anemone, rubble, grass, kelp,
	//    ulva, algae, star, mussel, cucumber)
	//  flex: sway with the surge (0 rigid) | warp: per-instance shape warp for rocks
	//  scale: size (m) range; sy / sxz: vertical / horizontal stretch ranges
	//  lod: level-of-detail switch distances, then the draw distance, in multiples of the radius
	//  align: 0 upright .. 1 follows the ground normal; sink: share of the height buried
	//  solid: keeps its footprint clear of everything else in the tile
	//  c1 / c2: palettes (sRGB hex), picked per instance and varied a little
	types: {
		boulder: { model: [ 'boulder', 'rock' ], surface: 'rock', warp: 0.08, scale: [ 0.7, 2.6 ], sy: [ 0.55, 1.0 ], sxz: [ 0.8, 1.25 ], lod: [ 4, 12, 70 ], align: 0.4, sink: 0.3, solid: true,
			c1: [ 0x6f6c66, 0x7a766e, 0x65625c, 0x807b72, 0x726a60 ], c2: [ 0xb87a8a, 0xa87088, 0xc08c96, 0x9a6a80 ] },
		outcrop: { model: [ 'slab' ], surface: 'rock', warp: 0.05, scale: [ 1.6, 3.8 ], sy: [ 0.4, 0.75 ], sxz: [ 0.75, 1.3 ], lod: [ 1.5, 4, 10, 60 ], align: 0.75, sink: 0.25, solid: true,
			c1: [ 0x6a6760, 0x747068, 0x5f5c56 ], c2: [ 0xb07888, 0xa8708a, 0xbc8a94 ] },
		kelpForest: { model: [ 'kelpForest' ], surface: 'kelp', flex: 0.55, scale: [ 1.0, 2.2 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 6, 16, 60 ], align: 0.15, sink: 0,
			c1: [ 0x6b4e22, 0x7a5a26, 0x5e4620, 0x80602a ], c2: [ 0x8a3a3a, 0x7a3444, 0x96504a ] },
		kelpSugar: { model: [ 'kelpSugar' ], surface: 'kelp', flex: 0.9, scale: [ 0.8, 1.6 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 6, 16, 60 ], align: 0.2, sink: 0,
			c1: [ 0x7a6428, 0x8a6e2c, 0x6e5a24 ], c2: [ 0x5a4a22 ] },
		ulva: { model: [ 'ulva' ], surface: 'ulva', flex: 0.5, scale: [ 0.6, 1.3 ], sy: [ 0.8, 1.2 ], sxz: [ 0.85, 1.15 ], lod: [ 5, 15, 70 ], align: 0.6, sink: 0,
			c1: [ 0x4f8a2e, 0x5a9a34, 0x468028 ], c2: [ 0x9ac070 ] },
		algae: { model: [ 'algae' ], surface: 'algae', flex: 0.9, scale: [ 0.7, 1.5 ], sy: [ 0.8, 1.3 ], sxz: [ 0.85, 1.15 ], lod: [ 5, 16, 70 ], align: 0.2, sink: 0,
			c1: [ 0x6a5a26, 0x7a6428, 0x5e5020, 0x806a2c ], c2: [ 0x4a4020 ] },
		meadow: { model: [ 'meadow' ], surface: 'grass', flex: 0.8, scale: [ 1.0, 1.4 ], sy: [ 1.3, 2.2 ], sxz: [ 0.9, 1.1 ], lod: [ 2.5, 7, 40 ], align: 0.5, sink: 0,
			c1: [ 0x3e5a26, 0x46622a, 0x3a5222, 0x4a6a2e ], c2: [ 0x6a7a3a ] },
		mussels: { model: [ 'mussels' ], surface: 'mussel', warp: 0, scale: [ 0.7, 1.5 ], sy: [ 0.9, 1.2 ], sxz: [ 0.85, 1.15 ], lod: [ 6, 18, 80 ], align: 0.8, sink: 0.05,
			c1: [ 0x1e2230, 0x242636, 0x1a1c26 ], c2: [ 0x5a4a32 ] },
		urchin: { model: [ 'urchin' ], surface: 'urchin', scale: [ 0.8, 1.3 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 15, 180 ], align: 0.9, sink: 0,
			c1: [ 0x2a1e2a ], c2: [ 0x4a2a52, 0x3e3a26, 0x5a3048, 0x3a2e3e ] },
		anemone: { model: [ 'anemone' ], surface: 'anemone', flex: 0.35, scale: [ 0.6, 1.2 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 10, 120 ], align: 0.8, sink: 0,
			c1: [ 0x6a8a4a, 0x5a7a3e, 0x7a8e56 ], c2: [ 0x9a4a8a, 0x8a5a9a ] },
		star: { model: [ 'star' ], surface: 'star', scale: [ 0.7, 1.3 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 150 ], align: 1.0, sink: 0,
			c1: [ 0xc0602a, 0xb85a30, 0x8a4a6a, 0xc87a3a ], c2: [ 0xe0c0a0 ] },
		rubble: { model: [ 'rubble' ], surface: 'rubble', scale: [ 0.7, 1.4 ], sy: [ 0.9, 1.1 ], sxz: [ 0.8, 1.2 ], lod: [ 8, 20, 80 ], align: 1.0, sink: 0.02,
			c1: [ 0x6a665e, 0x77716a, 0x5e5a52 ], c2: [ 0x6a665e ] },
		cucumber: { model: [ 'cucumber' ], surface: 'cucumber', scale: [ 0.8, 1.3 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 15, 150 ], align: 1.0, sink: 0,
			c1: [ 0x3a2a1e, 0x4a3424, 0x2e2420 ], c2: [ 0x2a1e18 ] },
	},

	// ---- layers: how the types are scattered, in this order (the solid rocks first, so the
	// later layers keep clear of them). Each layer throws one candidate per spacing x spacing m
	// cell (jittered); at a candidate every entry gets a weight
	//     weight x depth window x ground x patch x meadow x slope
	// and the candidate becomes one entry, picked in proportion to the weights, with probability
	// min( sum of the weights, cap ). Entry fields (all optional but `type` and `weight`):
	//  depth: [ in0, in1, out0, out1 ] water depth (m) fading in over in0..in1, out over out0..out1
	//  rock: k -> min( 1, rock share x k )  |  sand: k -> min( 1, sand share x k )
	//  patch / meadow: [ lo, hi ] smoothstep over that noise field (a negative range = its low side)
	//  slopeMax: the ground slope must stay below this
	layers: [
		{ name: 'granite', spacing: 3.2, cap: 0.5, entries: [
			{ type: 'boulder', weight: 0.35, rock: 1 },
			{ type: 'outcrop', weight: 0.15, rock: 1, slopeMax: 0.35 },
		] },
		{ name: 'kelp', spacing: 0.8, cap: 0.9, entries: [
			{ type: 'kelpForest', weight: 0.9, rock: 1.4, depth: [ 1.8, 3.5, 10, 16 ], patch: [ - 0.7, - 0.1 ] },
			{ type: 'kelpSugar', weight: 0.9, rock: 1.4, depth: [ 0.7, 1.4, 5, 9 ], patch: [ - 0.7, - 0.1 ] },
		] },
		{ name: 'eelgrass', spacing: 1.7, cap: 1, entries: [
			{ type: 'meadow', weight: 1, sand: 1, depth: [ 0.8, 1.5, 5, 8 ], meadow: [ 0.05, 0.3 ] },
		] },
		{ name: 'small', spacing: 0.75, cap: 0.9, entries: [
			{ type: 'ulva', weight: 0.35, depth: [ 0.3, 0.8, 2.5, 5 ], rock: 1, sand: 0.4 },
			{ type: 'algae', weight: 0.45, rock: 1, depth: [ 0.4, 1, 3.5, 7 ], patch: [ - 0.3, 0.3 ] },
			{ type: 'mussels', weight: 0.6, rock: 1, depth: [ 0.3, 0.6, 1.5, 3.5 ], patch: [ - 0.2, - 0.45 ] },
			{ type: 'urchin', weight: 0.12, rock: 1, depth: [ 0.8, 1.5, 40, 50 ] },
			{ type: 'anemone', weight: 0.07, rock: 1, depth: [ 0.5, 1, 40, 50 ] },
			{ type: 'star', weight: 0.03, depth: [ 0.6, 1.2, 40, 50 ] },
			{ type: 'rubble', weight: 0.12, sand: 1, depth: [ 0.4, 1, 40, 50 ] },
			{ type: 'cucumber', weight: 0.03, sand: 1, depth: [ 2.5, 4, 40, 50 ] },
		] },
	],

};
