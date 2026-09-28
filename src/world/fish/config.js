// Fish configuration: which fish live where and how they behave, as data. schools.js only
// interprets these tables, so the fish can be retuned (or new groups added) without touching
// the simulation. Spawning is procedural and deterministic: every CELL x CELL m cell of water
// gets its groups from `seed` and its coordinates. The anatomy and skin of the species are in
// species.js; a new species needs an entry there (and a pattern in material.js).
//
// At runtime: app.fish.regenerate() respawns the cells around the camera (after editing
// app.fish.config in the console, for example); a page reload picks up edits to this file.

const CEILING = - 0.7; // fish stay below this (m)

// defaults of every behaviour (see below)
const base = {
	cruise: 1, max: 2.5, burst: 6, accel: 4, sep: 2, nbr: 5, wSep: 5, wAli: 1, wCoh: 0.8, wGoal: 1, flee: 3.5,
	depth: [ 0.1, 0.5 ], homeRadius: 6, amp: 0.08, freq: [ 1.6, 0.9 ], ceiling: CEILING, minDepth: 1.2, band: [ 1.5, 20 ],
};

// Behaviours (as in Tidewater's Fish.js). model: species (species.js); length range (m); mode:
//   school (boids), bait (a ball that mills when threatened), patrol (hunts the bait ball), mill
//   (circles its rock), hover, lurk, forage, solo, surface (runs just under the surface), jumper
//   (mullet: leaps out now and then), fry, glide (rays: low over the sand, rests)
// speeds in body lengths / s (cruise, max, burst when fleeing), steering accel, boids (separation
// distance and neighbour radius in body lengths, weights); depth: preferred height above the
// bottom (fraction of the water column: 0 on the bottom .. 1 at the ceiling); band: water depth
// range of the homes (m); flee: reaction distance (m); amp / freq: tail beat amplitude and
// frequency (Hz at rest, per body length / s); ceiling: highest y (m); minDepth: shallowest water.
const behaviours = {
	// open water
	sardineBall: { model: 'sardine', length: [ 0.13, 0.2 ], mode: 'bait', cruise: 1.8, max: 4, burst: 10, accel: 7, flee: 3, depth: [ 0.35, 0.75 ], amp: 0.1, freq: [ 3, 1.1 ], band: [ 6, 40 ] },
	sardine: { model: 'sardine', length: [ 0.13, 0.2 ], mode: 'school', cruise: 1.6, max: 3.5, burst: 9, accel: 6, sep: 1.8, nbr: 7, wSep: 7, wAli: 2.6, wCoh: 1.4, wGoal: 0.7, flee: 4.5, depth: [ 0.35, 0.8 ], homeRadius: 18, amp: 0.1, freq: [ 3, 1.1 ], band: [ 4, 40 ] },
	horseMackerel: { model: 'horseMackerel', length: [ 0.2, 0.35 ], mode: 'patrol', cruise: 1.1, max: 2.6, burst: 5, accel: 3, sep: 2, nbr: 5, wAli: 1.4, wCoh: 0.9, wGoal: 0.9, flee: 4, depth: [ 0.25, 0.6 ], homeRadius: 20, amp: 0.07, freq: [ 1.6, 0.8 ], band: [ 5, 40 ] },
	mackerel: { model: 'mackerel', length: [ 0.25, 0.38 ], mode: 'school', cruise: 1.3, max: 3, burst: 6, accel: 4, sep: 1.8, nbr: 6, wAli: 2, wCoh: 1, wGoal: 0.8, flee: 5, depth: [ 0.3, 0.75 ], homeRadius: 20, amp: 0.07, freq: [ 1.8, 0.9 ], band: [ 4, 40 ] },
	garfish: { model: 'garfish', length: [ 0.5, 0.75 ], mode: 'surface', cruise: 0.9, max: 2.5, burst: 6, accel: 3, sep: 3, nbr: 4, wSep: 3, wAli: 1, wCoh: 0.5, wGoal: 0.9, flee: 4, homeRadius: 25, amp: 0.05, freq: [ 1.2, 0.7 ], ceiling: - 0.12, minDepth: 1.0, band: [ 2, 40 ] },
	// rocky bottoms
	seabream: { model: 'seabream', length: [ 0.2, 0.35 ], mode: 'mill', cruise: 0.45, max: 1.8, burst: 5, accel: 3, sep: 1.6, nbr: 4, wAli: 1.8, wCoh: 1.0, wGoal: 0.9, depth: [ 0.04, 0.25 ], homeRadius: 2.5, band: [ 2, 18 ] },
	wrasse: { model: 'wrasse', length: [ 0.25, 0.45 ], mode: 'forage', cruise: 0.5, max: 1.8, burst: 5, accel: 2.5, wAli: 0.3, wCoh: 0.3, wGoal: 1.2, flee: 3, depth: [ 0.02, 0.15 ], homeRadius: 6, amp: 0.06, freq: [ 1.2, 0.7 ], band: [ 1.5, 18 ] },
	bass: { model: 'bass', length: [ 0.4, 0.7 ], mode: 'solo', cruise: 0.35, max: 1.6, burst: 4, accel: 1.5, sep: 1, nbr: 2, wSep: 1, wAli: 0, wCoh: 0, wGoal: 0.7, flee: 4, depth: [ 0.2, 0.6 ], homeRadius: 12, amp: 0.05, freq: [ 0.8, 0.8 ], band: [ 2, 20 ] },
	// shallows
	mullet: { model: 'mullet', length: [ 0.3, 0.45 ], mode: 'jumper', cruise: 0.8, max: 2.2, burst: 5, accel: 3, sep: 1.8, nbr: 5, wAli: 1.5, wCoh: 1, wGoal: 0.8, flee: 4, depth: [ 0.3, 0.9 ], homeRadius: 14, amp: 0.07, freq: [ 1.5, 0.9 ], ceiling: - 0.25, minDepth: 1.2, band: [ 1.8, 5 ] },
	smelt: { model: 'sandSmelt', length: [ 0.05, 0.08 ], mode: 'fry', cruise: 2, max: 4, burst: 14, accel: 9, sep: 1.6, nbr: 8, wSep: 7, wAli: 2.4, wCoh: 1.6, wGoal: 0.9, flee: 3.2, depth: [ 0.3, 0.8 ], homeRadius: 6, amp: 0.11, freq: [ 3.5, 1.2 ], ceiling: - 0.2, minDepth: 0.5, band: [ 0.6, 3.5 ] },
	// sand
	ray: { model: 'ray', length: [ 0.6, 0.9 ], mode: 'glide', cruise: 0.3, max: 0.8, burst: 1.6, accel: 0.8, sep: 1, nbr: 2, wSep: 1, wAli: 0, wCoh: 0, wGoal: 0.8, flee: 3.5, depth: [ 0, 0 ], homeRadius: 14, amp: 0.05, freq: [ 0.9, 0.5 ], band: [ 3, 30 ] },
};
for ( const k in behaviours ) behaviours[ k ] = { name: k, ...base, ...behaviours[ k ] };

export const FISH = {

	seed: 0xf15,

	// ---- spawning cells
	cell: 48, // m
	spawnRange: 70, // cells within this distance of the camera are populated (m)
	drawRange: 45, // draw distance (m)
	activeAbove: 15, // no fish when the camera is higher than this above the water (m)

	behaviours,

	// ---- habitat survey of a cell: 4 x 4 samples; each counter is the number of samples that
	// match (0 .. 16), plus the deepest water (maxDepth, m)
	survey: {
		shallow: { depth: [ 0.6, 4 ] }, // any ground
		rocky: { depth: [ 1.5, 1e9 ], rock: [ 0.5, 1 ] },
		sandy: { depth: [ 3, 1e9 ], rock: [ 0, 0.3 ] },
		deep: { depth: [ 6, 1e9 ] },
	},

	// ---- spawn rules, in order. A rule applies when every `when` condition holds (survey counter
	// or maxDepth >= the value; an array [ a, b ] sums those counters), then with probability
	// `chance` places `groups` groups (random count in the range) of `count` fish each. `zone`
	// restricts the homes to rock or sand; `oneOf`: only the first successful rule of a set spawns.
	spawn: [
		{ behaviour: 'seabream', when: { rocky: 1 }, chance: 1, groups: [ 1, 2 ], count: [ 6, 12 ], zone: 'rock' },
		{ behaviour: 'wrasse', when: { rocky: 1 }, chance: 1, groups: [ 1, 3 ], count: [ 1, 1 ], zone: 'rock' },
		{ behaviour: 'bass', when: { maxDepth: 2 }, chance: 0.35, groups: [ 1, 1 ], count: [ 1, 2 ] },
		{ behaviour: 'smelt', when: { shallow: 1 }, chance: 0.6, groups: [ 1, 1 ], count: [ 40, 80 ] },
		{ behaviour: 'mullet', when: { shallow: 1 }, chance: 0.45, groups: [ 1, 1 ], count: [ 6, 10 ] },
		{ behaviour: 'sardineBall', when: { deep: 1 }, chance: 0.22, groups: [ 1, 1 ], count: [ 300, 480 ], oneOf: 'sardines' },
		{ behaviour: 'sardine', when: { 'deep+sandy': 3 }, chance: 0.3, groups: [ 1, 1 ], count: [ 60, 120 ], oneOf: 'sardines' },
		{ behaviour: 'horseMackerel', when: { deep: 1 }, chance: 0.3, groups: [ 1, 1 ], count: [ 8, 14 ] },
		{ behaviour: 'mackerel', when: { 'deep+sandy': 3 }, chance: 0.28, groups: [ 1, 1 ], count: [ 20, 35 ] },
		{ behaviour: 'garfish', when: { maxDepth: 2.5 }, chance: 0.25, groups: [ 1, 1 ], count: [ 2, 4 ] },
		{ behaviour: 'ray', when: { sandy: 1 }, chance: 0.25, groups: [ 1, 1 ], count: [ 1, 1 ], zone: 'sand' },
	],

};
