// Adapted from Tidewater (https://github.com/dgreenheck/tidewater, src/world/Fish.js, three.js
// version at d32799f). MIT License, Copyright (c) 2026 DRG Software Solutions LLC.
// Kept: the per-group steering (boids, milling, hovering, foraging, the bait ball, leaping
// mullet, gliding rays), fleeing from the diver and the culling / level of detail by size on
// screen. Changes: the groups are not laid out once over a reef; they are spawned per CELL x CELL
// m cell of water around the camera by habitat (seabed.js: depth, rock / sand) and dropped when
// the camera leaves; no whale escort, pier, breakers, spray, turtle, LOD cross-fade or motion
// vectors; the species are those of the Galician coast (species.js).
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { mulberry32 } from '../../core/noise.js';
import { SeabedBatch } from '../seabed/batch.js';
import { SPECIES } from './species.js';
import { fishGeometry } from './geometry.js';
import { rayGeometry } from './creatures.js';
import { createSwimMaterial } from './material.js';

// Fish of the coast, simulated on the CPU and drawn in a single render object (SeabedBatch: one
// indirect draw per model and level of detail) with the procedural fish models (geometry.js,
// creatures.js) and material (material.js).
//
// Habitats and behaviours:
//  - rocky bottoms: white seabream milling around the rocks, ballan wrasse foraging among the
//    kelp, a sea bass or two cruising;
//  - open water: sardines (a cruising school, or a bait ball that mills when the diver or the
//    horse mackerel come close), horse mackerel patrolling (they hunt the ball), mackerel
//    schools, garfish just under the surface;
//  - shallows: grey mullet (one now and then leaps out), sand smelt fry;
//  - sand: thornback rays gliding low and resting.
// Everything scatters from the diver, stays in the water (bottom, surface) and is only simulated
// near the camera. Depths assume the water surface at y = 0 (WATER_LEVEL).
const TAU = Math.PI * 2;
const CEILING = - 0.7; // fish stay below this (m)
const FLOOR_CLEARANCE = 0.18; // minimum above the seabed (m)
const RANGE = 45; // draw distance (m)
const CELL = 48; // spawn cell (m)
const SLOTS = 16; // cells alive at once
const CELL_CAP = 900; // fish per cell
const SPAWN_R = 70; // cells within this distance of the camera are populated (m)
const ACTIVE_ABOVE = 15; // no fish when the camera is higher than this above the water (m)
const GRAVITY = 9.81;
const LOD_PX = [ 320, 80, 22 ]; // screen length (px) below which the next level of detail takes over

// Behaviour per kind of swimmer (as in Tidewater). model: anatomy (species.js); length range (m);
// mode (see stepGroup); speeds in body lengths / s (cruise, max, burst when fleeing), steering
// accel, boids (separation distance and neighbour radius in body lengths, weights); depth:
// preferred height above the bottom (fraction of the water column above it: 0 on the bottom .. 1
// at the ceiling); band: water depth range of the homes; flee: reaction distance (m); amp / freq:
// tail beat amplitude and frequency (Hz at rest, per body length / s).
const base = {
	cruise: 1, max: 2.5, burst: 6, accel: 4, sep: 2, nbr: 5, wSep: 5, wAli: 1, wCoh: 0.8, wGoal: 1, flee: 3.5,
	depth: [ 0.1, 0.5 ], homeRadius: 6, amp: 0.08, freq: [ 1.6, 0.9 ], ceiling: CEILING, minDepth: 1.2, band: [ 1.5, 20 ],
};
const BEHAVIOUR = {
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
for ( const k in BEHAVIOUR ) BEHAVIOUR[ k ] = { name: k, ...base, ...BEHAVIOUR[ k ] };

// models per level of detail (0 nearest .. 3)
function buildModels( names ) {

	const kinds = [], first = {};
	for ( const name of names ) {

		first[ name ] = kinds.length;
		let geos;
		if ( name === 'ray' ) {

			const g1 = rayGeometry( { lod: 1 } );
			geos = [ rayGeometry( { lod: 0 } ), g1, g1, g1 ];

		} else {

			const S = SPECIES[ name ];
			geos = [ 0, 1, 2, 3 ].map( ( lod ) => fishGeometry( S, { lod, pose: 'swim' } ) );

		}

		for ( let l = 0; l < 4; l ++ ) kinds.push( { geometry: geos[ l ], model: name, lod: l } );

	}

	return { kinds, first };

}

class Group {

	constructor( sp, count, offset, zone, rng ) {

		this.sp = sp;
		this.count = count;
		this.offset = offset; // first fish index
		this.zone = zone; // { x, z, r, band: [ min, max ] water depth, sand? }
		this.home = new THREE.Vector3( zone.x, 0, zone.z );
		this.goal = this.home.clone();
		this.center = this.home.clone();
		this.heading = new THREE.Vector3( 1, 0, 0 );
		this.timer = 0;
		this.alarm = 0;
		this.spin = rng() < 0.5 ? 1 : - 1;
		this.rng = rng;
		this.radius = 4; // bounding radius of the group (m), updated while simulated
		this.ball = 0; // bait: 0 cruising school .. 1 milling ball
		this.rest = 0; // ray: resting time left
		this.jumpTimer = 3 + rng() * 6; // mullet: time to the next leap

	}

}

const _v = new THREE.Vector3(), _threat = new THREE.Vector3(), _q = new THREE.Quaternion();
const _frustum = new THREE.Frustum(), _sphere = new THREE.Sphere(), _m = new THREE.Matrix4();
const _H = {};

export class FishSchools {

	// hf: HeightField; seabed: Seabed (its habitat() tells rock from sand); sun: DirectionalLight;
	// getViewHeight(): drawing buffer height in pixels (level of detail by size on screen)
	constructor( { hf, seabed, sun, sunDir, getViewHeight = () => 900 } ) {

		this.hf = hf;
		this.seabed = seabed;
		this.sunLight = sun;
		this.getViewHeight = getViewHeight;
		this.time = 0;
		this.group = new THREE.Group();
		this.group.name = 'fish';

		// ---- models (all species, built once)
		const models = [ ...new Set( Object.values( BEHAVIOUR ).map( ( b ) => b.model ) ) ];
		const { kinds, first } = buildModels( models );
		this.modelKind = first;

		// ---- fish state (a fixed pool: CELL_CAP fish per cell slot)
		const n = this.n = SLOTS * CELL_CAP;
		this.pos = new Float32Array( n * 3 );
		this.vel = new Float32Array( n * 3 );
		this.head = new Float32Array( n * 3 );
		this.roll = new Float32Array( n );
		this.bend = new Float32Array( n );
		this.phase = new Float32Array( n );
		this.size = new Float32Array( n );
		this.speedMul = new Float32Array( n );
		this.panic = new Float32Array( n );
		this.seed = new Float32Array( n );
		this.kind = new Uint16Array( n );
		this.pattern = new Uint8Array( n );
		this.slot = new Float32Array( n * 4 ); // bait: formation slot (unit direction, radius)
		this.jump = new Float32Array( n ); // mullet: 0 swimming, 1 rising to the surface, 2 in the air
		this.floorC = new Float32Array( n ).fill( - 1000 ); // cached bottom under / ahead of each fish
		this.shallowC = new Uint8Array( n ); // cached: shallow water ahead
		this.tmpA = new Float32Array( n * 9 ); // boids accumulators: separation, alignment, cohesion
		this.tmpC = new Uint16Array( n ); // neighbour counts

		this.groups = [];
		this.baitGroups = [];
		this.cells = new Map(); // key -> { ix, iz, slot, groups }
		this.freeSlots = [];
		for ( let s = SLOTS - 1; s >= 0; s -- ) this.freeSlots.push( s );

		this.batch = new SeabedBatch( 'fish', kinds, { maxInstances: n, dynamic: true } );
		this.sun = { dir: uniform( new THREE.Vector3( 0, 1, 0 ) ).setName( 'fishSunDir' ), color: uniform( new THREE.Color( 1, 1, 1 ) ).setName( 'fishSunCol' ) };
		this.material = createSwimMaterial( this.batch, this.sun );
		this.mesh = this.batch.createMesh( this.material );
		this.group.add( this.mesh );
		this._frame = 0;
		this.dt = 1 / 60;
		this.paused = false; // QA: freeze the simulation (still drawn)
		this.stats = { cells: 0, groups: 0, fish: 0, visible: 0 };
		this.updateSun( sunDir );

	}

	updateSun( sunDir ) {

		if ( sunDir ) this.sun.dir.value.copy( sunDir );
		if ( this.sunLight ) this.sun.color.value.copy( this.sunLight.color ).multiplyScalar( this.sunLight.intensity );

	}

	// ------------------------------------------------------------------ layout

	floorAt( x, z ) {

		return this.hf.heightAt( x, z );

	}

	depthAt( x, z ) {

		return - this.hf.heightAt( x, z );

	}

	// water deep enough for the species (and over sand for the rays)
	fits( sp, zone, x, z ) {

		const d = this.depthAt( x, z );
		if ( d < zone.band[ 0 ] || d > zone.band[ 1 ] ) return false;
		if ( d < sp.minDepth + 0.3 ) return false;
		if ( zone.rock && this.seabed.habitat( x, z, _H ).rock < 0.5 ) return false;
		if ( zone.sand && this.seabed.habitat( x, z, _H ).rock > 0.3 ) return false;
		return true;

	}

	// Picks a home in the zone (a cell), far from the other homes of the cell.
	pickSpot( sp, zone, homes, rng ) {

		let best = null, bestScore = - Infinity;
		for ( let i = 0; i < 48; i ++ ) {

			const x = zone.x + ( rng() - 0.5 ) * zone.r * 2, z = zone.z + ( rng() - 0.5 ) * zone.r * 2;
			if ( ! this.fits( sp, zone, x, z ) ) continue;
			let score = rng();
			for ( const o of homes ) {

				const d = Math.hypot( o[ 0 ] - x, o[ 1 ] - z );
				if ( d < 10 ) score -= ( 10 - d ) * 0.3;

			}

			if ( score > bestScore ) {

				bestScore = score;
				best = [ x, z ];

			}

		}

		return best;

	}

	// Populates one cell of water by habitat (deterministic: a cell always gets the same fish).
	spawnCell( ix, iz ) {

		const cell = { ix, iz, slot: - 1, groups: [], used: 0 };
		const cx = ( ix + 0.5 ) * CELL, cz = ( iz + 0.5 ) * CELL;
		// habitat survey
		let maxD = 0, shallow = 0, rocky = 0, sandy = 0, deep = 0;
		for ( let j = 0; j < 4; j ++ ) for ( let i = 0; i < 4; i ++ ) {

			const x = ix * CELL + ( i + 0.5 ) * CELL / 4, z = iz * CELL + ( j + 0.5 ) * CELL / 4;
			const h = this.seabed.habitat( x, z, _H );
			const d = h.depth;
			maxD = Math.max( maxD, d );
			if ( d > 0.6 && d < 4 ) shallow ++;
			if ( d > 1.5 && h.rock > 0.5 ) rocky ++;
			if ( d > 3 && h.rock < 0.3 ) sandy ++;
			if ( d > 6 ) deep ++;

		}

		if ( maxD < 1 ) return cell;
		const slot = this.freeSlots.pop();
		if ( slot === undefined ) return null;
		cell.slot = slot;
		const rng = mulberry32( ( Math.imul( ix, 2654435761 ) ^ Math.imul( iz, 40503 ) ^ 0xf15 ) >>> 0 );
		const zone = { x: cx, z: cz, r: CELL / 2 };
		const homes = [];
		const place = ( name, count, extra = {} ) => {

			const sp = BEHAVIOUR[ name ];
			const z = { ...zone, band: sp.band, ...extra };
			const spot = this.pickSpot( sp, z, homes, rng );
			if ( ! spot || cell.used + count > CELL_CAP ) return null;
			homes.push( spot );
			const g = new Group( sp, count, slot * CELL_CAP + cell.used, { ...z, x: spot[ 0 ], z: spot[ 1 ], r: Math.min( z.r, sp.homeRadius * 1.5 + 4 ) }, mulberry32( Math.floor( rng() * 1e9 ) ) );
			cell.used += count;
			cell.groups.push( g );
			this.initGroup( g );
			return g;

		};

		const n = ( a, b ) => a + Math.floor( rng() * ( b - a + 1 ) );
		// rocky bottoms
		if ( rocky ) {

			for ( let k = 0, m = rocky > 6 ? 2 : 1; k < m; k ++ ) place( 'seabream', n( 6, 12 ), { rock: true } );
			for ( let k = 0, m = n( 1, 3 ); k < m; k ++ ) place( 'wrasse', 1, { rock: true } );

		}

		if ( rng() < 0.35 ) place( 'bass', n( 1, 2 ) );
		// shallows
		if ( shallow && rng() < 0.6 ) place( 'smelt', n( 40, 80 ) );
		if ( shallow && rng() < 0.45 ) place( 'mullet', n( 6, 10 ) );
		// open water
		if ( deep && rng() < 0.22 ) {

			const b = place( 'sardineBall', n( 300, 480 ) );
			if ( b ) this.baitGroups.push( b );

		} else if ( deep + sandy > 2 && rng() < 0.3 ) place( 'sardine', n( 60, 120 ) );
		if ( deep && rng() < 0.3 ) place( 'horseMackerel', n( 8, 14 ) );
		if ( deep + sandy > 2 && rng() < 0.28 ) place( 'mackerel', n( 20, 35 ) );
		if ( maxD > 2.5 && rng() < 0.25 ) place( 'garfish', n( 2, 4 ) );
		// sand
		if ( sandy && rng() < 0.25 ) place( 'ray', 1, { sand: true } );

		this.groups.push( ...cell.groups );
		return cell;

	}

	dropCell( key, cell ) {

		if ( cell.slot >= 0 ) {

			const gone = new Set( cell.groups );
			this.groups = this.groups.filter( ( g ) => ! gone.has( g ) );
			this.baitGroups = this.baitGroups.filter( ( g ) => ! gone.has( g ) );
			this.freeSlots.push( cell.slot );

		}

		this.cells.delete( key );

	}

	initGroup( g ) {

		const sp = g.sp, rng = g.rng;
		const dir = rng() * TAU;
		g.heading.set( Math.cos( dir ), 0, Math.sin( dir ) );
		const spread = sp.mode === 'school' || sp.mode === 'fry' || sp.mode === 'jumper' ? 1.5 : sp.mode === 'bait' ? 3 : [ 'solo', 'lurk', 'glide', 'cruise' ].includes( sp.mode ) ? 0 : 1.2;
		g.home.y = this.depthFor( sp, g.home.x, g.home.z, 0.5 );
		g.goal.copy( g.home );
		g.center.copy( g.home );
		const kind0 = this.modelKind[ sp.model ];
		const pattern = SPECIES[ sp.model ].pattern;
		for ( let k = 0; k < g.count; k ++ ) {

			const i = g.offset + k;
			let x = g.home.x, z = g.home.z;
			for ( let t = 0; t < 10; t ++ ) {

				const tx = g.home.x + ( rng() - 0.5 ) * spread * 2, tz = g.home.z + ( rng() - 0.5 ) * spread * 2;
				if ( this.depthAt( tx, tz ) > sp.minDepth + 0.3 ) {

					x = tx;
					z = tz;
					break;

				}

			}

			const y = this.clampY( sp, x, z, g.home.y + ( rng() - 0.5 ) * spread * 0.5 );
			const L = sp.length[ 0 ] + ( sp.length[ 1 ] - sp.length[ 0 ] ) * rng();
			this.size[ i ] = L;
			this.pos.set( [ x, y, z ], i * 3 );
			const s = sp.cruise * L;
			const d = dir + ( rng() - 0.5 ) * 0.5;
			this.vel.set( [ Math.cos( d ) * s, 0, Math.sin( d ) * s ], i * 3 );
			this.head.set( [ Math.cos( d ), 0, Math.sin( d ) ], i * 3 );
			this.roll[ i ] = 0;
			this.bend[ i ] = 0;
			this.panic[ i ] = 0;
			this.jump[ i ] = 0;
			this.floorC[ i ] = - 1000;
			this.phase[ i ] = rng() * TAU;
			this.speedMul[ i ] = 0.85 + rng() * 0.3;
			this.seed[ i ] = rng();
			this.kind[ i ] = kind0;
			this.pattern[ i ] = pattern;
			// bait formation slot: random direction, radius biased outward (a hollow-ish ball)
			const u = rng() * 2 - 1, a = rng() * TAU, rr = Math.sqrt( 1 - u * u );
			this.slot.set( [ rr * Math.cos( a ), u, rr * Math.sin( a ), 0.45 + 0.55 * Math.cbrt( rng() ) ], i * 4 );

		}

		this.retarget( g, null );

	}

	// preferred swimming height at x, z: depth[ 0 .. 1 ] of the water column above the bottom
	depthFor( sp, x, z, k ) {

		const floor = this.floorAt( x, z );
		const ceil = sp.ceiling;
		if ( sp.mode === 'surface' ) return ceil - 0.08;
		if ( sp.mode === 'glide' ) return floor + FLOOR_CLEARANCE + 0.15;
		const f = sp.depth[ 0 ] + ( sp.depth[ 1 ] - sp.depth[ 0 ] ) * k;
		return Math.min( ceil - 0.2, floor + FLOOR_CLEARANCE + 0.1 + Math.max( 0, ceil - floor ) * f );

	}

	clampY( sp, x, z, y ) {

		const h = this.floorAt( x, z );
		return Math.min( sp.ceiling - 0.02, Math.max( h + FLOOR_CLEARANCE + 0.02, y ) );

	}

	// New goal for the group: wandering in its zone, or away from a threat.
	retarget( g, away ) {

		const sp = g.sp, rng = g.rng, zone = g.zone;
		const hold = sp.mode === 'solo' || sp.mode === 'lurk' ? [ 12, 25 ] : sp.mode === 'forage' ? [ 3, 7 ] : sp.mode === 'surface' ? [ 10, 20 ] : [ 6, 12 ];
		for ( let k = 0; k < 24; k ++ ) {

			let x, z;
			if ( away && k < 16 ) {

				const a = Math.atan2( away.z, away.x ) + ( rng() - 0.5 ) * ( 0.6 + k * 0.15 );
				const d = 6 + rng() * 6;
				x = g.center.x + Math.cos( a ) * d;
				z = g.center.z + Math.sin( a ) * d;

			} else if ( sp.mode === 'surface' ) {

				// long straight runs
				const a = Math.atan2( g.heading.z, g.heading.x ) + ( rng() - 0.5 ) * 1.6;
				const d = 15 + rng() * 20;
				x = g.center.x + Math.cos( a ) * d;
				z = g.center.z + Math.sin( a ) * d;
				if ( Math.hypot( x - zone.x, z - zone.z ) > Math.max( zone.r, sp.homeRadius ) * 1.5 ) continue;

			} else {

				const a = rng() * TAU, r = Math.sqrt( rng() ) * Math.max( sp.homeRadius, zone.r * 0.8 );
				x = g.home.x + Math.cos( a ) * r;
				z = g.home.z + Math.sin( a ) * r;

			}

			const band = zone.band;
			const d = this.depthAt( x, z );
			if ( d < band[ 0 ] * 0.8 || d > band[ 1 ] * 1.2 || d < sp.minDepth + 0.3 ) continue;
			if ( zone.sand && this.seabed.habitat( x, z, _H ).rock > 0.3 ) continue; // rays: over sand
			g.goal.set( x, this.depthFor( sp, x, z, rng() ), z );
			g.timer = hold[ 0 ] + ( hold[ 1 ] - hold[ 0 ] ) * rng();
			return;

		}

		g.goal.copy( g.home );
		g.timer = 4;

	}

	// ------------------------------------------------------------------ simulation

	// Per frame: populate the cells around the camera, simulate, cull and write the instances.
	update( dt, camera ) {

		this._frame ++;
		this.time += dt;
		this.dt = dt || 1 / 60;
		const p = camera.position;
		if ( p.y > ACTIVE_ABOVE ) {

			this.mesh.visible = false;
			return;

		}

		// ---- cells: drop far ones, populate the missing ones (one per frame, nearest first)
		for ( const [ key, cell ] of this.cells ) {

			const dx = ( cell.ix + 0.5 ) * CELL - p.x, dz = ( cell.iz + 0.5 ) * CELL - p.z;
			if ( Math.hypot( dx, dz ) > SPAWN_R + CELL * 1.2 ) this.dropCell( key, cell );

		}

		const cx = Math.floor( p.x / CELL ), cz = Math.floor( p.z / CELL ), R = Math.ceil( SPAWN_R / CELL );
		let best = null, bestD = Infinity;
		for ( let j = - R; j <= R; j ++ ) for ( let i = - R; i <= R; i ++ ) {

			const ix = cx + i, iz = cz + j, key = ix * 65536 + iz;
			if ( this.cells.has( key ) ) continue;
			const dx = Math.max( 0, Math.abs( ( ix + 0.5 ) * CELL - p.x ) - CELL / 2 ), dz = Math.max( 0, Math.abs( ( iz + 0.5 ) * CELL - p.z ) - CELL / 2 );
			const d = Math.hypot( dx, dz );
			if ( d < SPAWN_R && d < bestD ) {

				bestD = d;
				best = [ ix, iz, key ];

			}

		}

		if ( best ) {

			const cell = this.spawnCell( best[ 0 ], best[ 1 ] );
			if ( cell ) this.cells.set( best[ 2 ], cell );

		}

		// ---- simulation
		let threat = null;
		if ( p.y < - 0.1 ) threat = _threat.copy( p );
		const steps = dt > 1 / 30 ? Math.min( 3, Math.ceil( dt * 30 ) ) : 1;
		const h = dt / steps;
		if ( dt > 0 && ! this.paused ) for ( let k = 0; k < steps; k ++ ) for ( const g of this.groups ) this.stepGroup( g, h, threat );

		this.cull( camera );
		let fish = 0;
		for ( const g of this.groups ) fish += g.count;
		this.stats.cells = this.cells.size;
		this.stats.groups = this.groups.length;
		this.stats.fish = fish;

	}

	stepGroup( g, dt, player ) {

		const sp = g.sp;
		const n = g.count, o = g.offset;
		const P = this.pos, V = this.vel, A = this.tmpA, C = this.tmpC;
		let cx = 0, cy = 0, cz = 0;
		for ( let k = 0; k < n; k ++ ) {

			const i = ( o + k ) * 3;
			cx += P[ i ];
			cy += P[ i + 1 ];
			cz += P[ i + 2 ];

		}

		g.center.set( cx / n, cy / n, cz / n );
		let r2 = 0;
		for ( let k = 0; k < n; k += Math.max( 1, n >> 4 ) ) {

			const i = ( o + k ) * 3;
			r2 = Math.max( r2, ( P[ i ] - g.center.x ) ** 2 + ( P[ i + 1 ] - g.center.y ) ** 2 + ( P[ i + 2 ] - g.center.z ) ** 2 );

		}

		g.radius = Math.sqrt( r2 ) + 2;
		g.timer -= dt;
		g.alarm = Math.max( 0, g.alarm - dt );
		if ( sp.mode === 'bait' ) return this.stepBait( g, dt, player );

		const gx = g.goal.x - g.center.x, gz = g.goal.z - g.center.z;
		const roams = sp.mode !== 'mill' && sp.mode !== 'hover' && sp.mode !== 'lurk';
		if ( g.timer <= 0 || ( roams && gx * gx + gz * gz < 1.5 ) ) this.retarget( g, null );

		// horse mackerel hunt the bait ball when it is near
		let hunt = null;
		if ( sp.mode === 'patrol' ) for ( const b of this.baitGroups ) {

			if ( Math.hypot( b.center.x - g.center.x, b.center.z - g.center.z ) < 30 ) hunt = b;

		}

		// ray: rests on the sand now and then
		if ( sp.mode === 'glide' ) {

			if ( g.rest > 0 ) g.rest -= dt;
			else if ( g.rng() < dt * 0.02 ) g.rest = 6 + g.rng() * 12;

		}

		// the diver
		let px = 0, py = 0, pz = 0, near = false;
		if ( player ) {

			px = player.x;
			py = player.y;
			pz = player.z;
			const dx = g.center.x - px, dy = g.center.y - py, dz = g.center.z - pz;
			const d2 = dx * dx + dy * dy + dz * dz;
			const reach = sp.flee + 4;
			near = d2 < ( reach + 20 + g.radius ) ** 2;
			if ( near && g.alarm <= 0 && d2 < reach * reach && roams ) {

				g.alarm = 4;
				g.rest = 0;
				this.retarget( g, { x: dx, z: dz } );

			}

		}

		// neighbours (symmetric, within the group)
		const nbr2 = ( sp.nbr * sp.length[ 1 ] ) ** 2, sepR = sp.sep * sp.length[ 1 ], sep2 = sepR * sepR;
		const a0 = o * 9;
		A.fill( 0, a0, a0 + n * 9 );
		C.fill( 0, o, o + n );
		if ( n > 1 && ( sp.wAli > 0 || sp.wCoh > 0 || sp.wSep > 0 ) ) {

			const stride = n > 60 ? 7 : 1; // large schools: a strided subset of neighbours
			for ( let a = 0; a < n; a ++ ) {

				const i = o + a;
				const ix = P[ i * 3 ], iy = P[ i * 3 + 1 ], iz = P[ i * 3 + 2 ];
				for ( let b = a + 1; b < n; b += stride ) {

					const j = o + b;
					const dx = P[ j * 3 ] - ix, dy = P[ j * 3 + 1 ] - iy, dz = P[ j * 3 + 2 ] - iz;
					const d2 = dx * dx + dy * dy + dz * dz;
					if ( d2 > nbr2 ) continue;
					C[ i ] ++;
					C[ j ] ++;
					const ai = i * 9, aj = j * 9;
					A[ ai + 3 ] += V[ j * 3 ]; A[ ai + 4 ] += V[ j * 3 + 1 ]; A[ ai + 5 ] += V[ j * 3 + 2 ];
					A[ aj + 3 ] += V[ i * 3 ]; A[ aj + 4 ] += V[ i * 3 + 1 ]; A[ aj + 5 ] += V[ i * 3 + 2 ];
					A[ ai + 6 ] += dx; A[ ai + 7 ] += dy; A[ ai + 8 ] += dz;
					A[ aj + 6 ] -= dx; A[ aj + 7 ] -= dy; A[ aj + 8 ] -= dz;
					if ( d2 < sep2 ) {

						const d = Math.sqrt( d2 ) + 1e-4;
						const f = ( sepR - d ) / ( sepR * d );
						A[ ai ] -= dx * f; A[ ai + 1 ] -= dy * f; A[ ai + 2 ] -= dz * f;
						A[ aj ] += dx * f; A[ aj + 1 ] += dy * f; A[ aj + 2 ] += dz * f;

					}

				}

			}

		}

		const t = this.time;
		const flee2 = sp.flee * sp.flee;
		for ( let a = 0; a < n; a ++ ) {

			const i = o + a, i3 = i * 3, ai = i * 9;
			const L = this.size[ i ];
			let x = P[ i3 ], y = P[ i3 + 1 ], z = P[ i3 + 2 ];
			let vx = V[ i3 ], vy = V[ i3 + 1 ], vz = V[ i3 + 2 ];

			// a leaping mullet flies (and falls back) on its own
			if ( this.jump[ i ] > 1.5 ) {

				vy -= GRAVITY * dt;
				x += vx * dt;
				y += vy * dt;
				z += vz * dt;
				if ( y < - 0.05 && vy < 0 ) {

					this.jump[ i ] = 0;
					vx *= 0.5;
					vz *= 0.5;
					vy *= 0.3;

				}

				P[ i3 ] = x; P[ i3 + 1 ] = y; P[ i3 + 2 ] = z;
				V[ i3 ] = vx; V[ i3 + 1 ] = vy; V[ i3 + 2 ] = vz;
				continue;

			}

			const cruise = sp.cruise * L * this.speedMul[ i ];
			let ax = A[ ai ] * sp.wSep, ay = A[ ai + 1 ] * sp.wSep, az = A[ ai + 2 ] * sp.wSep;
			const c = C[ i ];
			if ( c > 0 ) {

				const inv = 1 / c;
				ax += ( A[ ai + 3 ] * inv - vx ) * sp.wAli + A[ ai + 6 ] * inv * sp.wCoh;
				ay += ( A[ ai + 4 ] * inv - vy ) * sp.wAli + A[ ai + 7 ] * inv * sp.wCoh;
				az += ( A[ ai + 5 ] * inv - vz ) * sp.wAli + A[ ai + 8 ] * inv * sp.wCoh;

			}

			// goal per behaviour
			let tx = g.goal.x, ty = g.goal.y, tz = g.goal.z;
			let want = cruise;
			const s = this.seed[ i ];
			if ( sp.mode === 'mill' ) {

				// slow circling around the rock
				const ang = t * 0.12 * g.spin + s * 0.8;
				const r = sp.homeRadius * ( 0.5 + 0.5 * s );
				tx = g.home.x + Math.cos( ang ) * r;
				tz = g.home.z + Math.sin( ang ) * r;
				ty = g.home.y + ( s - 0.5 ) * 0.4;

			} else if ( sp.mode === 'hover' ) {

				// hold a spot, darting now and then
				const ang = s * TAU + Math.sin( t * 0.3 + s * 9 ) * 0.4;
				const r = sp.homeRadius * Math.sqrt( s );
				tx = g.home.x + Math.cos( ang ) * r;
				tz = g.home.z + Math.sin( ang ) * r;
				ty = g.home.y + ( ( s * 7.3 ) % 1 - 0.5 ) * 0.8;
				want = cruise * ( 0.3 + 0.7 * Math.max( 0, Math.sin( t * 0.8 + s * 20 ) ) );

			} else if ( sp.mode === 'lurk' ) {

				// hangs by its rock, turning slowly
				tx = g.home.x + Math.cos( t * 0.05 + s * 6 ) * sp.homeRadius;
				tz = g.home.z + Math.sin( t * 0.05 + s * 6 ) * sp.homeRadius;
				ty = g.home.y;
				want = cruise * 0.6;

			} else if ( hunt ) {

				// horse mackerel: circle the bait ball, now and then a pass through it
				const ang = t * 0.35 * g.spin + s * TAU;
				const dash = Math.sin( t * 0.4 + s * 11 ) > 0.8;
				const r = dash ? 0.5 : 5 + 2 * s;
				tx = hunt.center.x + Math.cos( ang ) * r;
				tz = hunt.center.z + Math.sin( ang ) * r;
				ty = hunt.center.y + ( s - 0.5 ) * 2;
				want = cruise * ( dash ? 2.2 : 1.3 );

			} else if ( sp.mode === 'glide' && g.rest > 0 ) {

				// resting on the sand
				tx = x;
				tz = z;
				ty = this.floorAt( x, z ) + 0.04;
				want = 0;

			}

			let dx = tx - x, dy = ty - y, dz = tz - z;
			let dl = Math.sqrt( dx * dx + dy * dy + dz * dz ) + 1e-6;
			const arrive = Math.min( 1, dl / Math.max( 0.3, L * 4 ) );
			ax += ( dx / dl * want * arrive - vx ) * sp.wGoal;
			ay += ( dy / dl * want * arrive - vy ) * sp.wGoal;
			az += ( dz / dl * want * arrive - vz ) * sp.wGoal;

			// flee from the diver (horizontally for fish near the surface)
			let panic = Math.max( 0, this.panic[ i ] - dt * 0.5 );
			if ( near ) {

				dx = x - px;
				dy = y - py;
				dz = z - pz;
				const d2 = dx * dx + dy * dy + dz * dz;
				if ( d2 < flee2 ) {

					dl = Math.sqrt( d2 ) + 1e-4;
					const k = 1 - dl / sp.flee;
					const f = ( k * k * 12 + k * 3 ) * sp.accel;
					ax += dx / dl * f;
					ay += dy / dl * f * 0.4;
					az += dz / dl * f;
					panic = Math.max( panic, Math.min( 1, k * 1.8 ) );
					g.rest = 0;

				}

			}

			this.panic[ i ] = panic;

			// bottom below (with look-ahead); the look-ups are refreshed every fourth frame
			// (staggered over the fish): fish move a few cm in between
			if ( ( ( this._frame + i ) & 3 ) === 0 || this.floorC[ i ] < - 999 ) {

				const lx = x + vx * 0.7, lz = z + vz * 0.7;
				const fa = this.floorAt( lx, lz );
				this.floorC[ i ] = Math.max( this.floorAt( x, z ), fa );
				this.shallowC[ i ] = - fa < sp.minDepth ? 1 : 0;

			}

			const clear = sp.mode === 'glide' ? 0.03 : FLOOR_CLEARANCE + L * 0.8;
			const floor = this.floorC[ i ] + clear;
			if ( y < floor ) ay += ( floor - y ) * 8;
			// shallow water ahead: turn back
			if ( this.shallowC[ i ] ) {

				ax -= vx * 3;
				az -= vz * 3;

			}

			const ceil = sp.ceiling;
			if ( y > ceil - 0.3 && ! ( sp.mode === 'jumper' && this.jump[ i ] > 0.5 ) ) ay -= ( y - ( ceil - 0.3 ) ) * 8;
			ay -= vy * 1.5; // fish prefer to swim level

			// mullet: rising to the surface for a leap
			if ( this.jump[ i ] > 0.5 ) {

				ay += 6;
				want = cruise * 2.5;

			}

			const amax = sp.accel * L * 4 * ( 1 + panic * 3 ) * ( this.jump[ i ] > 0.5 ? 3 : 1 );
			const al = Math.sqrt( ax * ax + ay * ay + az * az );
			if ( al > amax ) {

				const k = amax / al;
				ax *= k;
				ay *= k;
				az *= k;

			}

			vx += ax * dt;
			vy += ay * dt;
			vz += az * dt;
			const speed = Math.sqrt( vx * vx + vy * vy + vz * vz ) + 1e-6;
			const vmax = ( sp.max + ( sp.burst - sp.max ) * panic ) * L * ( this.jump[ i ] > 0.5 ? 2 : 1 );
			const vmin = sp.mode === 'hover' || sp.mode === 'solo' || sp.mode === 'mill' || sp.mode === 'lurk' || sp.mode === 'glide' ? 0.0 : cruise * 0.3;
			const sc = speed > vmax ? vmax / speed : ( speed < vmin ? vmin / speed : 1 );
			vx *= sc;
			vy *= sc;
			vz *= sc;
			if ( this.jump[ i ] < 0.5 ) {

				const hs = Math.sqrt( vx * vx + vz * vz );
				const vyMax = 0.15 + hs * 0.4;
				vy = Math.max( - vyMax, Math.min( vyMax, vy ) );

			}

			let nx = x + vx * dt, nz = z + vz * dt;
			if ( this.shallowC[ i ] && this.depthAt( nx, nz ) < sp.minDepth ) {

				nx = x;
				nz = z;
				vx *= - 0.5;
				vz *= - 0.5;

			}

			const bottom = this.floorC[ i ] + ( sp.mode === 'glide' ? 0.02 : FLOOR_CLEARANCE );
			let ny = y + vy * dt;
			if ( this.jump[ i ] > 0.5 && ny > - 0.25 ) {

				// break the surface: fly
				this.jump[ i ] = 2;
				const hs = Math.sqrt( vx * vx + vz * vz ) + 1e-6;
				const k = ( 1.8 + g.rng() * 0.8 ) / hs;
				vx *= k;
				vz *= k;
				vy = 3 + g.rng() * 0.8;

			} else if ( ny > ceil ) {

				ny = ceil;
				if ( vy > 0 ) vy = 0;

			}

			if ( ny < bottom ) {

				ny = bottom;
				if ( vy < 0 ) vy = 0;

			}

			P[ i3 ] = nx;
			P[ i3 + 1 ] = ny;
			P[ i3 + 2 ] = nz;
			V[ i3 ] = vx;
			V[ i3 + 1 ] = vy;
			V[ i3 + 2 ] = vz;

		}

		// mullet: now and then one of the school rises for a leap
		if ( sp.mode === 'jumper' ) {

			g.jumpTimer -= dt;
			if ( g.jumpTimer <= 0 ) {

				g.jumpTimer = 4 + g.rng() * 10;
				const i = o + Math.floor( g.rng() * n );
				if ( this.jump[ i ] === 0 && this.pos[ i * 3 + 1 ] > - 2.5 ) this.jump[ i ] = 1;

			}

		}

		// the group's heading (for surface runs)
		const hx = g.goal.x - g.center.x, hz = g.goal.z - g.center.z, hl = Math.hypot( hx, hz );
		if ( hl > 0.5 ) g.heading.set( hx / hl, 0, hz / hl );

	}

	// Bait ball: every fish steers to its slot in a formation around the group centre, a stretched
	// ellipsoid along the heading while cruising and a milling ball when threatened; they part
	// around the diver and predators (fountain effect).
	stepBait( g, dt, player ) {

		const sp = g.sp;
		const n = g.count, o = g.offset;
		const P = this.pos, V = this.vel, S = this.slot;
		const rng = g.rng;
		// threats: the diver, hunting horse mackerel
		let threatened = false;
		let tx = 0, ty = 0, tz = 0, td = Infinity;
		if ( player ) {

			const d = player.distanceTo( g.center );
			if ( d < 14 + g.radius ) {

				threatened = true;
				tx = player.x;
				ty = player.y;
				tz = player.z;
				td = d;

			}

		}

		for ( const h of this.groups ) {

			if ( h.sp.mode !== 'patrol' ) continue;
			const d = h.center.distanceTo( g.center );
			if ( d < 12 + g.radius ) threatened = true;

		}

		g.ball += ( ( threatened ? 1 : 0 ) - g.ball ) * Math.min( 1, dt * ( threatened ? 0.8 : 0.15 ) );
		if ( g.timer <= 0 || g.center.distanceTo( g.goal ) < 3 ) this.retarget( g, threatened && td < 8 ? { x: g.center.x - tx, z: g.center.z - tz } : null );

		// the centre drifts to the goal (slowly while balled)
		const L = sp.length[ 1 ];
		const speed = sp.cruise * L * ( 1 - 0.75 * g.ball ) * 3;
		_v.subVectors( g.goal, g.center );
		const dl = _v.length();
		if ( dl > 0.1 ) {

			_v.multiplyScalar( 1 / dl );
			g.heading.lerp( _v, Math.min( 1, dt * 0.5 ) ).normalize();

		}

		const cx = g.center.x + g.heading.x * speed * 1.5, cy = g.center.y + g.heading.y * speed, cz = g.center.z + g.heading.z * speed * 1.5;
		const Rb = 0.8 + Math.cbrt( n ) * 0.09; // ball radius (m)
		const hx = g.heading.x, hz = g.heading.z;
		const spin = this.time * 0.9 * g.spin;
		const cs = Math.cos( spin ), sn = Math.sin( spin );
		const kP = 2.5, kD = 2.2;
		const flee = sp.flee;
		// the bottom under the ball (highest of a few samples): one estimate for all its fish
		let ballFloor = - Infinity;
		for ( let k = 0; k < 5; k ++ ) {

			const a = k / 5 * TAU, r = k === 0 ? 0 : Rb * 2;
			ballFloor = Math.max( ballFloor, this.floorAt( cx + Math.cos( a ) * r, cz + Math.sin( a ) * r ) );

		}

		ballFloor += 0.6;
		for ( let a = 0; a < n; a ++ ) {

			const i = o + a, i3 = i * 3, i4 = i * 4;
			const sx = S[ i4 ], sy = S[ i4 + 1 ], sz = S[ i4 + 2 ], sr = S[ i4 + 3 ];
			// cruising: an ellipsoid 3 x longer along the heading
			const along = sx * 2.4, side = sz * 1.1, up = sy * 0.55;
			const cxs = cx + ( hx * along - hz * side ) * Rb, cys = cy + up * Rb, czs = cz + ( hz * along + hx * side ) * Rb;
			// balled: the slot orbits the vertical axis (milling)
			const bx = ( sx * cs - sz * sn ) * sr * Rb, bz = ( sx * sn + sz * cs ) * sr * Rb;
			const bxs = g.center.x + bx, bys = g.center.y + sy * sr * Rb * 0.8, bzs = g.center.z + bz;
			const w = g.ball;
			let tx2 = cxs + ( bxs - cxs ) * w, ty2 = cys + ( bys - cys ) * w, tz2 = czs + ( bzs - czs ) * w;
			// target velocity: along the heading while cruising, tangential while milling
			const mv = 0.9 * g.spin * sr * Rb;
			let vtx = hx * speed * ( 1 - w ) + ( - bz ) * mv * w / ( Rb + 1e-3 ), vtz = hz * speed * ( 1 - w ) + bx * mv * w / ( Rb + 1e-3 );
			const vty = 0;
			const x = P[ i3 ], y = P[ i3 + 1 ], z = P[ i3 + 2 ];
			let vx = V[ i3 ], vy = V[ i3 + 1 ], vz = V[ i3 + 2 ];
			let panic = Math.max( 0, this.panic[ i ] - dt );
			if ( player ) {

				const dx = x - player.x, dy = y - player.y, dz = z - player.z;
				const d2 = dx * dx + dy * dy + dz * dz;
				if ( d2 < flee * flee ) {

					// part around the diver: the ball opens a hole around them and closes behind
					const d = Math.sqrt( d2 ) + 1e-3;
					const k = 1 - d / flee;
					tx2 += dx / d * k * 2.2;
					ty2 += dy / d * k * 1.2;
					tz2 += dz / d * k * 2.2;
					vtx += dx / d * k * sp.burst * L;
					vtz += dz / d * k * sp.burst * L;
					panic = Math.max( panic, k );

				}

			}

			this.panic[ i ] = panic;
			// keep off the bottom and below the surface
			ty2 = Math.min( sp.ceiling - 0.2, Math.max( ballFloor, ty2 ) );
			const ax = ( tx2 - x ) * kP + ( vtx - vx ) * kD + ( rng() - 0.5 ) * 0.6;
			const ay = ( ty2 - y ) * kP + ( vty - vy ) * kD;
			const az = ( tz2 - z ) * kP + ( vtz - vz ) * kD + ( rng() - 0.5 ) * 0.6;
			vx += ax * dt;
			vy += ay * dt;
			vz += az * dt;
			const vmax = ( sp.max + ( sp.burst - sp.max ) * panic ) * L;
			const vl = Math.sqrt( vx * vx + vy * vy + vz * vz );
			if ( vl > vmax ) {

				vx *= vmax / vl;
				vy *= vmax / vl;
				vz *= vmax / vl;

			}

			P[ i3 ] = x + vx * dt;
			P[ i3 + 1 ] = y + vy * dt;
			P[ i3 + 2 ] = z + vz * dt;
			V[ i3 ] = vx;
			V[ i3 + 1 ] = vy;
			V[ i3 + 2 ] = vz;

		}

	}

	// ------------------------------------------------------------------ rendering

	// Orients the visible fish, advances their swimming wave and writes the instance records
	// (packed: only the visible fish, uploaded as one range).
	cull( camera ) {

		const dt = this.dt;
		camera.updateMatrixWorld();
		_m.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		_frustum.setFromProjectionMatrix( _m, camera.coordinateSystem, camera.reversedDepth );
		const cp = camera.position;
		// pixels per metre at 1 m: level of detail by the fish's size on screen
		const pxScale = camera.projectionMatrix.elements[ 5 ] * this.getViewHeight() * 0.5;
		// from above the water only the fish close under the surface show
		const range = cp.y < 0 ? RANGE : Math.max( 0, 30 - cp.y * 2 );
		const batch = this.batch, D = batch.data;
		const P = this.pos, V = this.vel, H = this.head;
		const kHead = 1 - Math.exp( - dt * 6 ), kRoll = 1 - Math.exp( - dt * 3 );
		batch.begin();
		let k = 0;
		for ( const g of this.groups ) {

			const sp = g.sp;
			// whole group out of range / view
			const gd = Math.hypot( g.center.x - cp.x, g.center.y - cp.y, g.center.z - cp.z );
			if ( gd > range + g.radius ) continue;
			_sphere.center.copy( g.center );
			_sphere.radius = g.radius + 2;
			if ( ! _frustum.intersectsSphere( _sphere ) ) continue;
			const ray = sp.model === 'ray';
			for ( let a = 0; a < g.count; a ++ ) {

				const i = g.offset + a, i3 = i * 3;
				const L = this.size[ i ];
				const x = P[ i3 ], y = P[ i3 + 1 ], z = P[ i3 + 2 ];
				const vx = V[ i3 ], vy = V[ i3 + 1 ], vz = V[ i3 + 2 ];
				const speed = Math.sqrt( vx * vx + vy * vy + vz * vz ) + 1e-6;
				const airborne = this.jump[ i ] > 1.5;

				// heading follows the velocity (slowly when hovering), pitch limited
				const kh = airborne ? 1 : kHead * Math.min( 1, speed / ( L * 0.5 ) + 0.15 );
				const ohx = H[ i3 ], ohz = H[ i3 + 2 ];
				let hx = ohx + ( vx / speed - ohx ) * kh;
				let hy = H[ i3 + 1 ] + ( vy / speed - H[ i3 + 1 ] ) * kh;
				let hz = ohz + ( vz / speed - ohz ) * kh;
				const pitchMax = airborne ? 1.2 : ray ? 0.3 : 0.45;
				hy = Math.max( - pitchMax, Math.min( pitchMax, hy ) );
				const hl = Math.hypot( hx, hy, hz ) || 1;
				hx /= hl;
				hy /= hl;
				hz /= hl;
				H[ i3 ] = hx;
				H[ i3 + 1 ] = hy;
				H[ i3 + 2 ] = hz;
				const yawRate = ( ohz * hx - ohx * hz ) / Math.max( dt, 1e-3 );
				const bank = ray ? 0.45 : 0.12;
				this.roll[ i ] += ( Math.max( - 0.5, Math.min( 0.5, yawRate * bank ) ) - this.roll[ i ] ) * kRoll;
				this.bend[ i ] += ( Math.max( - 0.25, Math.min( 0.25, yawRate * 0.06 ) ) - this.bend[ i ] ) * kRoll;

				// tail beat / wing wave: frequency and amplitude grow with speed
				const bl = speed / L;
				const rest = sp.mode === 'glide' && g.rest > 0;
				const freq = rest ? 0.15 : Math.min( 10, sp.freq[ 0 ] + sp.freq[ 1 ] * bl ) * ( airborne ? 2.5 : 1 );
				if ( ! this.paused ) this.phase[ i ] = ( this.phase[ i ] + dt * TAU * freq ) % ( TAU * 64 );
				const amp = rest ? sp.amp * 0.2 : sp.amp * ( 0.55 + 0.45 * Math.min( 2.5, bl / Math.max( 0.2, sp.cruise ) ) + this.panic[ i ] * 0.5 );

				// cull: distance, size on screen and view frustum
				const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z;
				const d = Math.sqrt( dx * dx + dy * dy + dz * dz );
				if ( d > range + L ) continue;
				const px = L * pxScale / Math.max( d, 0.1 );
				if ( px < 1.2 ) continue;
				_sphere.center.set( x, y, z );
				_sphere.radius = L * 0.7;
				if ( ! _frustum.intersectsSphere( _sphere ) ) continue;

				// orientation: yaw from the heading, pitch, bank into turns
				yawPitchRoll( Math.atan2( hx, hz ), - Math.asin( hy ), this.roll[ i ], _q );

				const o = k * 16;
				D[ o ] = x;
				D[ o + 1 ] = y;
				D[ o + 2 ] = z;
				D[ o + 3 ] = L;
				D[ o + 4 ] = _q.x;
				D[ o + 5 ] = _q.y;
				D[ o + 6 ] = _q.z;
				D[ o + 7 ] = _q.w;
				D[ o + 8 ] = this.phase[ i ];
				D[ o + 9 ] = amp;
				D[ o + 10 ] = this.bend[ i ];
				D[ o + 11 ] = this.pattern[ i ] + this.seed[ i ] * 0.9;
				const lod = px > LOD_PX[ 0 ] ? 0 : px > LOD_PX[ 1 ] ? 1 : px > LOD_PX[ 2 ] ? 2 : 3;
				batch.add( this.kind[ i ] + lod, k );
				k ++;

			}

		}

		if ( k > 0 ) batch.uploadRange( 0, k );
		batch.commit();
		this.mesh.visible = k > 0;
		this.stats.visible = k;

	}

	dispose() {

		this.batch.dispose();
		this.material.dispose();
		this.group.removeFromParent();

	}

}

// quaternion of the rotations yaw (about y), then pitch (about x), then roll (about z)
function yawPitchRoll( yaw, pitch, roll, q ) {

	const sy = Math.sin( yaw * 0.5 ), cy = Math.cos( yaw * 0.5 );
	const sx = Math.sin( pitch * 0.5 ), cx = Math.cos( pitch * 0.5 );
	const sz = Math.sin( roll * 0.5 ), cz = Math.cos( roll * 0.5 );
	const x1 = cy * sx, y1 = sy * cx, z1 = - sy * sx, w1 = cy * cx;
	q.set( x1 * cz + y1 * sz, - x1 * sz + y1 * cz, w1 * sz + z1 * cz, w1 * cz - z1 * sz );
	return q;

}
