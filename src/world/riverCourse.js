// A river's course: points [ x, z, width ] laid in the terrain editor ("Rio"), a centripetal
// Catmull-Rom sampled every 1.5 m, the water level along it, the channel carved into the relief and
// the surface ribbon. Port of water/RiverCourse.js (and of the river ribbon of water/waterGeometry.js)
// of Drusniel: Gods' End (https://github.com/danielsobrado/drusniel-gods-end, MIT, Copyright (c) 2026
// Daniel Sobrado, licenses/LICENSE-Drusniel.md). Their rules: the water settles below the ground and
// BANK_FREEBOARD below the lower bank and never rises downstream (so a course drawn uphill still
// flows); the carve leaves a bed under it and banks standing above it. Changes: no authored lake
// outlet or estuary mouth (the level only stops at the sea's); the carve is applied once, by the
// editor, as an undoable relief edit (the edits layer keeps it); the levels are saved with the course,
// so later sculpting does not move the water; a flat-array grid index.

const clamp = ( x, a, b ) => Math.min( b, Math.max( a, x ) );
const ease = ( a, b, x ) => { const t = clamp( ( x - a ) / ( b - a ), 0, 1 ); return t * t * ( 3 - 2 * t ); };

const STEP = 1.5;            // m between samples
const BELOW_GROUND = 0.45;   // m the water settles under the ground at the centre (theirs: 1.15, for a larger river)
const BANK_PROBES = [ 1, 2.4 ];
const BANK_FREEBOARD = 0.3;
const BANK_CREST_START = 0.6, BANK_CREST_END = 1.6, BANK_ROUNDING = 0.35;
// m: the outlet's sill past a lake, over the lake's level (0.05 over its spill height: the lake does not
// drain through the river's own channel; a channel that opens a lower way out elsewhere lowers it, and
// relevel() then meets the lake at its new level). A short lip: a longer, higher one left a strip of
// dry ground between the lake and the river.
const SILL_LENGTH = 2.5, SILL_HEIGHT = 0.25;
export const BANK_BLEND = 6; // m past the edge the carve reaches
const FLAT_SPEED = 1.4, FALL_SPEED = 6.5, SPEED_RESPONSE = 4;
const CELL = 24;

// centripetal Catmull-Rom through the points (x, z, width), sampled every STEP m
export function sampleCurve( points ) {
	const P = points.map( ( [ x, z, w ] ) => ( { x, z, w } ) );
	if ( P.length < 2 ) return [];
	// phantom ends
	const ext = [ { x: 2 * P[ 0 ].x - P[ 1 ].x, z: 2 * P[ 0 ].z - P[ 1 ].z, w: P[ 0 ].w }, ...P,
		{ x: 2 * P.at( - 1 ).x - P.at( - 2 ).x, z: 2 * P.at( - 1 ).z - P.at( - 2 ).z, w: P.at( - 1 ).w } ];
	const seg = ( p0, p1, p2, p3, t ) => {
		const d = ( a, b ) => Math.pow( Math.hypot( b.x - a.x, b.z - a.z ) || 1e-4, 0.5 );
		const t0 = 0, t1 = t0 + d( p0, p1 ), t2 = t1 + d( p1, p2 ), t3 = t2 + d( p2, p3 );
		const u = t1 + ( t2 - t1 ) * t;
		const L = ( a, b, ta, tb ) => ( { x: ( ( tb - u ) * a.x + ( u - ta ) * b.x ) / ( tb - ta ), z: ( ( tb - u ) * a.z + ( u - ta ) * b.z ) / ( tb - ta ) } );
		const A1 = L( p0, p1, t0, t1 ), A2 = L( p1, p2, t1, t2 ), A3 = L( p2, p3, t2, t3 );
		const B1 = L( A1, A2, t0, t2 ), B2 = L( A2, A3, t1, t3 );
		return L( B1, B2, t1, t2 );
	};
	// dense polyline, then resampled at STEP
	const dense = [];
	for ( let i = 1; i < ext.length - 2; i ++ ) {
		const n = Math.max( 4, Math.ceil( Math.hypot( ext[ i + 1 ].x - ext[ i ].x, ext[ i + 1 ].z - ext[ i ].z ) / 0.5 ) );
		for ( let k = 0; k < n; k ++ ) {
			const t = k / n, q = seg( ext[ i - 1 ], ext[ i ], ext[ i + 1 ], ext[ i + 2 ], t );
			dense.push( { x: q.x, z: q.z, w: ext[ i ].w + ( ext[ i + 1 ].w - ext[ i ].w ) * t } );
		}
	}
	dense.push( { ...P.at( - 1 ) } );
	const out = [ { ...dense[ 0 ], s: 0 } ];
	let acc = 0, next = STEP;
	for ( let i = 1; i < dense.length; i ++ ) {
		const a = dense[ i - 1 ], b = dense[ i ], l = Math.hypot( b.x - a.x, b.z - a.z );
		while ( acc + l >= next ) {
			const t = ( next - acc ) / l;
			out.push( { x: a.x + ( b.x - a.x ) * t, z: a.z + ( b.z - a.z ) * t, w: a.w + ( b.w - a.w ) * t, s: next } );
			next += STEP;
		}
		acc += l;
	}
	const last = dense.at( - 1 );
	if ( acc - out.at( - 1 ).s > STEP * 0.3 ) out.push( { ...last, s: acc } );
	// tangents
	for ( let i = 0; i < out.length; i ++ ) {
		const a = out[ Math.max( 0, i - 1 ) ], b = out[ Math.min( out.length - 1, i + 1 ) ];
		const l = Math.hypot( b.x - a.x, b.z - a.z ) || 1;
		out[ i ].dx = ( b.x - a.x ) / l; out[ i ].dz = ( b.z - a.z ) / l;
		out[ i ].width = out[ i ].w;
	}
	return out;
}

function lowestBank( h, p, width ) {
	let lowest = Infinity;
	for ( const beyond of BANK_PROBES ) for ( const side of [ - 1, 1 ] ) {
		const across = side * ( width / 2 + beyond );
		lowest = Math.min( lowest, h( p.x - p.dz * across, p.z + p.dx * across ) );
	}
	return lowest;
}

// slope, flow speed (m/s) and travel time along the surface (their measureRiverSurface)
function measure( samples ) {
	let flowSpeed = FLAT_SPEED, travel = 0;
	for ( let i = 0; i < samples.length; i ++ ) {
		const p = samples[ i ], before = samples[ Math.max( 0, i - 1 ) ], after = samples[ Math.min( samples.length - 1, i + 1 ) ];
		const step = Math.hypot( p.s - before.s, p.y - before.y );
		const slope = Math.max( 0, ( before.y - after.y ) / Math.max( 0.001, after.s - before.s ) );
		const target = FLAT_SPEED + ( FALL_SPEED - FLAT_SPEED ) * ease( 0.08, 0.9, slope );
		const nextSpeed = target + ( flowSpeed - target ) * Math.exp( - step / SPEED_RESPONSE );
		travel += step / ( ( flowSpeed + nextSpeed ) / 2 );
		flowSpeed = nextSpeed;
		Object.assign( p, { slope, flowSpeed, travel } );
	}
}

// A fall starts where the course steepens past FALL_ENTER_SLOPE and ends at its foot, the first sample
// back under FALL_EXIT_SLOPE; runs that drop less than FALL_MIN_DROP m, or never pass FALL_MIN_PEAK,
// are rapids (their findRiverFalls). Returns [ { lip, foot, drop, peak } ] (sample indices, metres).
const FALL_ENTER_SLOPE = 0.35, FALL_EXIT_SLOPE = 0.2, FALL_MIN_DROP = 3, FALL_MIN_PEAK = 0.6;
export function findRiverFalls( samples ) {
	const falls = [];
	let lip = - 1, peak = 0;
	for ( let i = 0; i <= samples.length; i ++ ) {
		const slope = i < samples.length ? samples[ i ].slope ?? 0 : 0;
		if ( lip < 0 ) { if ( slope > FALL_ENTER_SLOPE ) { lip = i; peak = slope; } continue; }
		peak = Math.max( peak, slope );
		if ( slope >= FALL_EXIT_SLOPE ) continue;
		const foot = Math.min( i, samples.length - 1 );
		const drop = samples[ Math.max( 0, lip - 1 ) ].y - samples[ foot ].y;
		if ( drop >= FALL_MIN_DROP && peak >= FALL_MIN_PEAK ) falls.push( { lip, foot, drop, peak } );
		lip = - 1;
	}
	return falls;
}

export class RiverCourse {
	// record: { points: [ [ x, z, width ] ], levels?: [ y per sample ] }; h(x, z): the relief;
	// floor: the lowest the water goes (the sea); lakeAt(x, z): the level of a lake of the terrain editor
	// at a point, or null (world/lakeWater.js). A river running into a lake comes down to its level and
	// ends there; one leaving a lake starts at its level, behind a sill (SILL_LENGTH m of bed kept
	// SILL_HEIGHT over the lake) so its channel does not drain the lake (the lake's level is its spill
	// height, lakeFill.js); in the lake the river is the lake: no carve, no ribbon.
	constructor( record, h, floor, lakeAt = null ) {
		this.record = record;
		this.samples = sampleCurve( record.points );
		const S = this.samples;
		const saved = Array.isArray( record.levels ) && record.levels.length === S.length ? record.levels : null;
		let prev = Infinity;
		for ( let i = 0; i < S.length; i ++ ) {
			const p = S[ i ];
			p.lake = lakeAt?.( p.x, p.z ) ?? null;
			if ( saved ) p.y = saved[ i ];
			else if ( p.lake !== null ) p.y = p.lake;
			else p.y = Math.max( floor, Math.min( prev, h( p.x, p.z ) - BELOW_GROUND, lowestBank( h, p, p.width ) - BANK_FREEBOARD ) );
			prev = p.y;
		}
		// backwater: upstream of every lake it runs into, the river stands at least at the lake's level (the
		// relief's rule left it lower near the mouth and the level jumped up into the lake)
		if ( ! saved ) for ( let i = S.length - 1; i > 0; i -- ) {
			if ( S[ i ].lake === null || S[ i - 1 ].lake !== null ) continue;
			for ( let k = i - 1; k >= 0 && S[ k ].lake === null && S[ k ].y < S[ i ].lake; k -- ) S[ k ].y = S[ i ].lake;
		}
		this._sills();
		this.floor = floor;
		measure( S );
		this.falls = findRiverFalls( S );
		// the plunge: white water easing off over ~9 m below the foot of every fall (their `impact`)
		for ( const p of S ) p.plunge = 0;
		for ( const f of this.falls ) for ( let i = f.foot; i < S.length && S[ i ].s - S[ f.foot ].s < 12; i ++ ) S[ i ].plunge = Math.max( S[ i ].plunge, Math.exp( - ( S[ i ].s - S[ f.foot ].s ) / 4 ) );
		this.length = S.length ? S.at( - 1 ).s : 0;
		// grid index: the segments near each CELL cell
		this.cells = new Map();
		this.box = [ Infinity, Infinity, - Infinity, - Infinity ];
		for ( let i = 0; i < S.length - 1; i ++ ) {
			const a = S[ i ], b = S[ i + 1 ], r = Math.max( a.width, b.width ) / 2 + BANK_BLEND + 2;
			const cx0 = Math.floor( ( Math.min( a.x, b.x ) - r ) / CELL ), cx1 = Math.floor( ( Math.max( a.x, b.x ) + r ) / CELL );
			const cz0 = Math.floor( ( Math.min( a.z, b.z ) - r ) / CELL ), cz1 = Math.floor( ( Math.max( a.z, b.z ) + r ) / CELL );
			for ( let cz = cz0; cz <= cz1; cz ++ ) for ( let cx = cx0; cx <= cx1; cx ++ ) {
				const key = cx * 100003 + cz;
				if ( ! this.cells.has( key ) ) this.cells.set( key, [] );
				this.cells.get( key ).push( i );
			}
			this.box = [ Math.min( this.box[ 0 ], a.x - r ), Math.min( this.box[ 1 ], a.z - r ), Math.max( this.box[ 2 ], a.x + r ), Math.max( this.box[ 3 ], a.z + r ) ];
		}
	}

	// the sill past every lake the river leaves
	_sills() {
		const S = this.samples;
		for ( const p of S ) p.sill = null;
		for ( let i = 1; i < S.length; i ++ ) {
			if ( S[ i ].lake !== null || S[ i - 1 ].lake === null ) continue;
			const level = S[ i - 1 ].lake, s0 = S[ i ].s;
			for ( let k = i; k < S.length && S[ k ].lake === null && S[ k ].s - s0 < SILL_LENGTH; k ++ ) S[ k ].sill = level + SILL_HEIGHT;
		}
	}

	// The lakes' levels as they are now (after the carve, a lake may have found a lower way out through
	// the new channel and fallen): the samples in a lake take its level and the course stays monotonic
	// below it (the channel is already deeper than the water).
	relevel( lakeAt ) {
		const S = this.samples;
		let prev = Infinity;
		for ( const p of S ) {
			p.lake = lakeAt?.( p.x, p.z ) ?? null;
			p.y = p.lake !== null ? p.lake : Math.min( p.y, prev );
			prev = p.y;
		}
		this._sills();
		measure( S );
		this.falls = findRiverFalls( S );
		return this;
	}

	// the levels to save with the course
	levels() { return this.samples.map( ( p ) => Math.round( p.y * 100 ) / 100 ); }

	// the course at a point: { y, edge (m past the water's edge, < 0 in the water), width, s, dx, dz }
	sample( x, z, out = {} ) {
		const list = this.cells.get( Math.floor( x / CELL ) * 100003 + Math.floor( z / CELL ) );
		if ( ! list ) return null;
		let best = Infinity, found = false;
		for ( const i of list ) {
			const a = this.samples[ i ], b = this.samples[ i + 1 ];
			const dx = b.x - a.x, dz = b.z - a.z;
			const t = clamp( ( ( x - a.x ) * dx + ( z - a.z ) * dz ) / Math.max( dx * dx + dz * dz, 1e-4 ), 0, 1 );
			const px = x - a.x - dx * t, pz = z - a.z - dz * t, d = Math.hypot( px, pz );
			if ( d >= best ) continue;
			best = d; found = true;
			const span = Math.max( b.s - a.s, 1e-3 ), width = a.width + ( b.width - a.width ) * t, s = a.s + span * t;
			const lateral = ( px * - dz + pz * dx ) / span;
			// their eroded, uneven banks
			const erosion = Math.sin( s * 0.39 + Math.sign( lateral ) * 1.8 ) * 0.38 + Math.sin( s * 0.13 + Math.sign( lateral ) * 3.1 ) * 0.55;
			out.y = a.y + ( b.y - a.y ) * t; out.edge = d - width / 2 - erosion * Math.min( 1, width / 8 );
			out.width = width; out.s = s; out.dx = dx / span; out.dz = dz / span;
			const near = t < 0.5 ? a : b;
			out.lake = near.lake ?? null; out.sill = near.sill ?? null;
		}
		return found ? out : null;
	}

	// the carved height at a point (their carve, without the mouth): the bed under the water, the
	// banks standing BANK_FREEBOARD above it past the edge, rounding off beyond the crest
	carve( x, z, original ) {
		const p = this.sample( x, z );
		if ( ! p || p.edge > BANK_BLEND || p.lake !== null ) return original; // in a lake: the lake's own basin
		const depth = clamp( 0.35 + p.width * 0.08, 0.45, 1.4 );
		const cross = clamp( 1 + p.edge / ( p.width * 0.5 ), 0, 1 );
		let bed = p.y - depth + Math.pow( cross, 3 ) * depth * 0.72;
		if ( p.sill !== null ) bed = Math.max( bed, p.sill ); // the outlet's sill holds the lake
		const blend = 1 - ease( - 0.1, BANK_BLEND, p.edge );
		const carved = Math.min( original, original + ( bed - original ) * blend );
		// no bank inside the channel, nor where the river has come down to the sea
		if ( p.edge <= 0 || p.y <= this.floor + 0.05 ) return carved;
		const past = Math.max( 0, p.edge - BANK_CREST_END );
		const bank = bed + ( p.y + BANK_FREEBOARD - bed ) * ease( 0, BANK_CREST_START, p.edge ) - past * past * BANK_ROUNDING;
		return Math.max( carved, Math.min( bank, Math.max( original, p.y + BANK_FREEBOARD ) ) );
	}
}
