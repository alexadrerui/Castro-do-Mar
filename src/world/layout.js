// Hand-authored village plan, traced from the aerial reference.
// World axes: +X = east (sea side), +Z = south, +Y = up. 1 unit = 1 m.
// Aerial reference was mapped with ~0.18 m per pixel around pixel (800,450).

export const WATER_LEVEL = 0;

export const TERRAIN = {
	size: 2800,           // metres, square (covers the whole granite massif)
	segments: 1120,       // 2.5 m cells, 14 x 14 LOD chunks of 80
	centerX: - 250,
	centerZ: - 650
};

// Area covered by the high-resolution splat mask (paths, dirt, fields).
export const MASK = { size: 640, res: 1024, centerX: - 20, centerZ: 20 };

export const VILLAGE = { x: - 15, z: 5, radius: 115 };

export const FORT = {
	x: 24, z: 24,          // stone ring centre
	radius: 19,
	wallHeight: 3.6,
	gateAngle: Math.PI * 0.5 + 0.12, // gate faces south
	ground: 30.5
};

// Rocky spine running from the north wall to the watchtower and down the
// east side: the wall and tower stand on its crest, its village-facing
// (south-west) side is a granite cliff that holds the two mine adits.
export const SPINE = {
	pts: [ [ - 5, - 58 ], [ 12, - 60 ], [ 30, - 56 ], [ 38, - 50 ], [ 50, - 34 ], [ 54, - 18 ] ],
	base: 26.0, crest: 9, crestTower: 16, halfWidth: 14
};

// Carved rock block (CSG) holding the two mine adits. The face looks WSW
// towards the village, under the wall between the tower and the east bastion.
export const MINE = {
	fx: 40.2, fz: - 37.6,  // centre of the cliff face at its foot
	nx: - 0.8, nz: 0.6,    // outward face normal (towards the village)
	width: 32,             // along the face
	depth: 16,             // into the ridge
	top: 41.0,
	floor: 25.3,
	adits: [ - 5.5, 6.0 ],  // offsets along the face tangent
	aditW: 2.0, aditH: 2.4, aditLen: 14
};
MINE.tx = MINE.nz; MINE.tz = - MINE.nx; // tangent (along the face, towards +z)
MINE.x = MINE.fx - MINE.nx * MINE.depth * 0.5;
MINE.z = MINE.fz - MINE.nz * MINE.depth * 0.5;
MINE.yardX = MINE.fx + MINE.nx * 9; MINE.yardZ = MINE.fz + MINE.nz * 9;

export const TOWER = { x: 38, z: - 50, height: 16 };

// North wall with the watchtower (upper part of the aerial reference).
export const WALLS = [
	[ [ - 5, - 55 ], [ 12, - 57 ], [ 30, - 53 ], [ 38, - 50 ] ],
	[ [ 38, - 50 ], [ 46, - 38 ], [ 50, - 22 ] ],
	// enclosure with the red market stalls
	[ [ - 20, - 30 ], [ - 5, - 22 ], [ 2, - 8 ], [ 4, 6 ] ]
];

export const PATHS = [
	// main road leaving the fort gate south-west toward the fields
	{ w: 3.2, pts: [ [ 20, 44 ], [ 8, 58 ], [ - 22, 78 ], [ - 60, 98 ], [ - 100, 118 ], [ - 150, 150 ], [ - 210, 200 ], [ - 280, 240 ] ] },
	// inner village loop
	{ w: 2.8, pts: [ [ - 70, - 8 ], [ - 45, - 12 ], [ - 22, - 8 ], [ - 4, 2 ], [ 12, 0 ], [ 30, - 8 ], [ 50, - 6 ], [ 62, 8 ], [ 66, 30 ], [ 58, 48 ], [ 40, 58 ], [ 20, 44 ] ] },
	{ w: 2.4, pts: [ [ - 45, - 12 ], [ - 52, 12 ], [ - 40, 34 ], [ - 18, 42 ], [ 4, 40 ], [ 20, 44 ] ] },
	// uphill track to the north-west
	{ w: 2.2, pts: [ [ - 22, - 8 ], [ - 30, - 40 ], [ - 45, - 80 ], [ - 75, - 130 ], [ - 120, - 190 ], [ - 170, - 250 ] ] },
	// coastal track past the watchtower
	{ w: 2.0, pts: [ [ - 5, - 22 ], [ 0, - 44 ], [ 6, - 62 ], [ 8, - 100 ], [ 0, - 150 ] ] },
	// track up to the mine yard under the tower cliff
	{ w: 2.6, pts: [ [ 12, 0 ], [ 20, - 14 ], [ 28, - 24 ], [ 34, - 30 ] ] },
	// field lanes
	{ w: 1.8, pts: [ [ - 100, 118 ], [ - 120, 80 ], [ - 150, 60 ] ] },
	{ w: 1.8, pts: [ [ - 150, 150 ], [ - 180, 120 ], [ - 200, 90 ] ] }
];

// Cultivated plots (bottom-left of the aerial reference). Rotated rectangles.
export const FIELDS = [
	{ x: - 140, z: 100, w: 34, l: 22, rot: 0.45, crop: 0 },
	{ x: - 168, z: 128, w: 30, l: 26, rot: 0.45, crop: 1 },
	{ x: - 132, z: 136, w: 26, l: 20, rot: 0.40, crop: 2 },
	{ x: - 110, z: 90, w: 22, l: 16, rot: 0.50, crop: 1 },
	{ x: - 195, z: 160, w: 34, l: 24, rot: 0.42, crop: 0 },
	{ x: - 165, z: 175, w: 24, l: 18, rot: 0.40, crop: 2 }
];

// Buildings. round: Celtic round house; long: rectangular gable house;
// stall: red canopy; hut: small granary/round store.
export const BUILDINGS = [
	{ type: 'round', x: - 58, z: - 22, r: 7.5, seed: 1 },   // chief's house
	{ type: 'round', x: - 48, z: 30, r: 5.0, seed: 2 },
	{ type: 'round', x: - 36, z: 18, r: 6.2, seed: 3 },
	{ type: 'round', x: - 13, z: - 13, r: 4.6, seed: 4 },
	{ type: 'round', x: 37, z: - 15, r: 4.8, seed: 5 },
	{ type: 'round', x: 52, z: - 8, r: 4.0, seed: 6 },
	{ type: 'round', x: - 36, z: - 30, r: 4.4, seed: 7 },
	{ type: 'round', x: - 27, z: - 33, r: 4.0, seed: 8 },
	{ type: 'round', x: - 50, z: 4, r: 4.3, seed: 9 },
	{ type: 'round', x: - 66, z: 40, r: 4.5, seed: 10 },
	{ type: 'round', x: - 4, z: - 40, r: 4.2, seed: 26 },
	{ type: 'long', x: - 42, z: - 6, w: 7.5, l: 11.5, rot: 0.08, seed: 11 },
	{ type: 'long', x: - 31, z: - 20, w: 7, l: 11, rot: - 0.05, seed: 12 },
	{ type: 'long', x: - 16, z: 17, w: 7.5, l: 12, rot: 0.15, seed: 13 },
	{ type: 'long', x: 3, z: 12, w: 6, l: 9, rot: - 0.5, seed: 14 },
	{ type: 'long', x: 60, z: 34, w: 6, l: 9.5, rot: 1.2, seed: 15 },
	{ type: 'long', x: 59, z: - 2, w: 5.5, l: 8.5, rot: 1.35, seed: 16 },
	{ type: 'long', x: 66, z: - 12, w: 5, l: 8, rot: 1.1, seed: 17 },
	{ type: 'long', x: - 58, z: - 48, w: 6, l: 9, rot: 0.3, seed: 20 },
	{ type: 'long', x: - 115, z: 74, w: 5, l: 7, rot: 0.45, seed: 18 },
	{ type: 'long', x: - 95, z: 77, w: 4.5, l: 6.5, rot: 0.5, seed: 19 },
	{ type: 'granary', x: - 66, z: 12, r: 1.6, seed: 21 },
	{ type: 'granary', x: 12, z: 30, r: 1.6, seed: 22 },
	{ type: 'granary', x: - 106, z: 88, r: 1.6, seed: 27 },
	{ type: 'hut', x: - 5, z: 50, r: 2.8, seed: 23 },
	{ type: 'hut', x: 24, z: - 38, r: 2.2, seed: 24 },
	{ type: 'hut', x: - 76, z: - 5, r: 2.4, seed: 25 },
	// watch hut on the western edge (small tower in the perspective reference)
	{ type: 'lookout', x: - 84, z: 26, seed: 31 },
	{ type: 'lookout', x: - 170, z: - 230, seed: 32 }
];

export const STALLS = [
	[ - 15, - 26, 0.1 ], [ - 8, - 22, 0.3 ], [ - 12, - 16, 0.2 ], [ - 3, - 14, 0.5 ],
	[ - 22, 0, 0.0 ], [ - 26, 6, 0.4 ], [ - 18, 8, - 0.2 ], [ - 28, 12, 0.1 ],
	[ 6, - 4, 0.8 ], [ 10, - 10, 0.6 ], [ 22, - 2, 1.2 ], [ 28, 4, 0.9 ],
	[ - 4, 26, 0.3 ], [ 2, 34, 1.0 ], [ - 30, 0, 0.6 ], [ 16, 18, 0.2 ],
	[ - 16, - 20, 0.4 ], [ - 10, - 29, 0.0 ], [ - 4, - 24, 0.7 ], [ - 18, - 11, 0.2 ],
	[ - 8, - 10, 0.9 ], [ 0, - 20, 0.5 ], [ 14, - 20, 0.8 ], [ - 22, 20, 0.3 ],
	[ 18, 10, 1.1 ], [ 8, 24, 0.6 ], [ - 10, 34, 0.2 ], [ 22, - 12, 1.3 ]
];

// Everyday props: pens, haystacks, the well, carts, racks, bee skeps, woodpiles.
export const PROPS = [
	{ type: 'pen', x: - 76, z: 52, w: 7, d: 5, rot: 0.3 },
	{ type: 'pen', x: - 30, z: 56, w: 6, d: 5, rot: - 0.2 },
	{ type: 'hay', x: - 84, z: 44, r: 1.3 }, { type: 'hay', x: - 70, z: 60, r: 1.1 },
	{ type: 'hay', x: - 122, z: 62, r: 1.4 }, { type: 'hay', x: - 100, z: 100, r: 1.2 },
	{ type: 'well', x: - 26, z: - 11 },
	{ type: 'cart', x: 8, z: 5, rot: 1.0 }, { type: 'cart', x: - 108, z: 70, rot: 0.2 },
	{ type: 'rack', x: 78, z: 6, rot: 0.4 }, { type: 'rack', x: 74, z: 18, rot: 0.2 },
	{ type: 'skep', x: - 57, z: 47 }, { type: 'skep', x: - 55.5, z: 48.2 }, { type: 'skep', x: - 58.2, z: 49 },
	{ type: 'wood', x: - 40, z: - 42, rot: 0.2 }, { type: 'wood', x: 30, z: - 26, rot: 1.0 }
];

// Islands in the sea / lake. r = radius, h = peak height above water.
// Islands: glacial, low, elongated NNE-SSW. e = elongation, rot = heading.
export const ISLANDS = [
	{ x: 175, z: - 200, r: 36, h: 9, e: 2.2, rot: 0.35 },
	{ x: 150, z: - 330, r: 14, h: 5, e: 1.8, rot: 0.3 },
	{ x: 230, z: 40, r: 22, h: 7, e: 2.0, rot: 0.4 },
	{ x: 330, z: - 150, r: 30, h: 8, e: 2.2, rot: 0.35 },
	{ x: 300, z: - 470, r: 40, h: 10, e: 2.4, rot: 0.3 },
	{ x: 560, z: - 300, r: 45, h: 11, e: 2.2, rot: 0.4 },
	{ x: 520, z: - 760, r: 55, h: 12, e: 2.6, rot: 0.35 },
	{ x: 210, z: - 620, r: 40, h: 12, e: 2.0, rot: 0.3 },
	{ x: 380, z: 160, r: 18, h: 5, e: 1.8, rot: 0.45 },
	{ x: 610, z: 20, r: 70, h: 18, e: 2.3, rot: 0.35 },
	{ x: 160, z: - 90, r: 10, h: 3.5, e: 1.6, rot: 0.3 },
	{ x: 125, z: 110, r: 9, h: 3, e: 1.7, rot: 0.4 },
	// skerries hugging the coast (aerial reference, top right)
	{ x: 88, z: - 80, r: 6, h: 2, e: 1.6, rot: 0.3 },
	{ x: 122, z: - 60, r: 7, h: 2.5, e: 1.7, rot: 0.5 },
	{ x: 72, z: - 88, r: 4, h: 1.5, e: 1.5, rot: 0.2 },
	{ x: 150, z: - 12, r: 5, h: 1.8, e: 1.6, rot: 0.4 },
	{ x: 140, z: 42, r: 6, h: 2, e: 1.8, rot: 0.3 },
	{ x: 98, z: 76, r: 5, h: 1.5, e: 1.6, rot: 0.5 },
	// the lake corridor to the north (beyond the detailed terrain, far mesh)
	{ x: 650, z: - 1150, r: 50, h: 12, e: 2.4, rot: 0.35 },
	{ x: 900, z: - 1500, r: 80, h: 16, e: 2.6, rot: 0.3 },
	{ x: 560, z: - 1650, r: 35, h: 9, e: 2.0, rot: 0.4 },
	{ x: 1250, z: - 1900, r: 130, h: 22, e: 2.2, rot: 0.35 },
	{ x: 800, z: - 2150, r: 90, h: 14, e: 2.4, rot: 0.3 },
	{ x: 1100, z: - 2500, r: 180, h: 22, e: 2.6, rot: 0.4 },
	{ x: 700, z: - 2800, r: 120, h: 16, e: 2.2, rot: 0.35 },
	{ x: 1450, z: - 2900, r: 250, h: 25, e: 2.0, rot: 0.3 },
	{ x: 950, z: - 3300, r: 150, h: 18, e: 2.5, rot: 0.35 },
	{ x: 1300, z: - 3500, r: 200, h: 22, e: 2.3, rot: 0.4 },
	{ x: 1050, z: - 1200, r: 80, h: 10, e: 2.0, rot: 0.3 },
	{ x: 620, z: - 2450, r: 70, h: 12, e: 2.2, rot: 0.35 }
];
