import { makeSimplex, fbm, ridged, smoothstep, lerp, clamp } from '../core/noise.js';
import { TERRAIN, MASK, VILLAGE, FORT, MINE, SPINE, PATHS, FIELDS, ISLANDS, BUILDINGS, footprintR, HAMLETS } from './layout.js';

const nA = makeSimplex( 890 );
const nB = makeSimplex( 31 );
const nC = makeSimplex( 77 );
const nD = makeSimplex( 4242 );

// Coast control points [z, x]: x of the waterline as a function of z,
// traced from the aerial reference (headlands, the southern bay).
const COAST = [
	[ - 1500, 360 ], [ - 1000, 290 ], [ - 650, 190 ], [ - 380, 105 ], [ - 200, 62 ],
	[ - 110, 50 ], [ - 63, 68 ], [ - 27, 90 ], [ - 14, 122 ], [ 0, 103 ], [ 20, 100 ],
	[ 38, 125 ], [ 50, 106 ], [ 65, 72 ], [ 85, 58 ], [ 120, 68 ], [ 220, 110 ],
	[ 400, 150 ], [ 900, 190 ]
];

function coastBase( z ) {
	if ( z <= COAST[ 0 ][ 0 ] ) return COAST[ 0 ][ 1 ];
	for ( let i = 1; i < COAST.length; i ++ ) {
		const [ z1, x1 ] = COAST[ i ];
		if ( z <= z1 ) {
			const [ z0, x0 ] = COAST[ i - 1 ];
			const t = ( z - z0 ) / ( z1 - z0 );
			const s = t * t * ( 3 - 2 * t );
			return lerp( x0, x1, s );
		}
	}
	return COAST[ COAST.length - 1 ][ 1 ];
}

export function coastX( z, x = 0 ) {
	return coastBase( z ) + 7 * fbm( nB, z * 0.012, 3.7, 3 ) + 3 * nC( z * 0.06, 1.3 ) + 6 * fbm( nD, x * 0.03, z * 0.03, 3 );
}

// ---------------------------------------------------------------------------
// Paths: Catmull-Rom densified polylines (organic curves instead of rulers)
// ---------------------------------------------------------------------------
function catmull( pts, sub = 6 ) {
	const out = [];
	for ( let i = 0; i < pts.length - 1; i ++ ) {
		const p0 = pts[ Math.max( 0, i - 1 ) ], p1 = pts[ i ], p2 = pts[ i + 1 ], p3 = pts[ Math.min( pts.length - 1, i + 2 ) ];
		for ( let k = 0; k < sub; k ++ ) {
			const t = k / sub, t2 = t * t, t3 = t2 * t;
			const f = ( a, b, c, d ) => 0.5 * ( 2 * b + ( - a + c ) * t + ( 2 * a - 5 * b + 4 * c - d ) * t2 + ( - a + 3 * b - 3 * c + d ) * t3 );
			out.push( [ f( p0[ 0 ], p1[ 0 ], p2[ 0 ], p3[ 0 ] ), f( p0[ 1 ], p1[ 1 ], p2[ 1 ], p3[ 1 ] ) ] );
		}
	}
	out.push( pts[ pts.length - 1 ] );
	return out;
}
// built on first use, not when the module loads: the world edits (worldEdits.js applyWorldEdits)
// change PATHS after this module is imported (the paths of the editor's "Caminhos" tab)
let PATH_SEGS = null;
function buildPathSegs() {
	PATH_SEGS = [];
	for ( const p of PATHS ) {
		if ( ! p.pts || p.pts.length < 2 ) continue;
		const c = catmull( p.pts );
		for ( let i = 1; i < c.length; i ++ ) {
			const a = c[ i - 1 ], b = c[ i ];
			PATH_SEGS.push( { ax: a[ 0 ], az: a[ 1 ], bx: b[ 0 ], bz: b[ 1 ], w: p.w,
				minx: Math.min( a[ 0 ], b[ 0 ] ) - 12, maxx: Math.max( a[ 0 ], b[ 0 ] ) + 12,
				minz: Math.min( a[ 1 ], b[ 1 ] ) - 12, maxz: Math.max( a[ 1 ], b[ 1 ] ) + 12 } );
		}
	}
}
// the curve a path's points make (the same everywhere: relief, mask, vegetation, the editor)
export function pathCurve( pts ) { return catmull( pts ); }

// Distance from p to segment ab (2D).
function segDist( px, pz, ax, az, bx, bz ) {
	const dx = bx - ax, dz = bz - az;
	const l2 = dx * dx + dz * dz;
	let t = l2 > 0 ? ( ( px - ax ) * dx + ( pz - az ) * dz ) / l2 : 0;
	t = clamp( t, 0, 1 );
	const cx = ax + dx * t - px, cz = az + dz * t - pz;
	return Math.sqrt( cx * cx + cz * cz );
}

function pathDistance( x, z ) {
	let best = 1e9, bw = 2;
	if ( ! PATH_SEGS ) buildPathSegs();
	for ( const s of PATH_SEGS ) {
		if ( x < s.minx || x > s.maxx || z < s.minz || z > s.maxz ) continue;
		const d = segDist( x, z, s.ax, s.az, s.bx, s.bz );
		if ( d < best ) { best = d; bw = s.w; }
	}
	// width varies along the track
	return { d: best, w: bw * ( 0.85 + 0.3 * ( 0.5 + 0.5 * nC( x * 0.05, z * 0.05 ) ) ) };
}

// Signed distance to the spine polyline: s > 0 on the village (SW) side,
// t = arc-length position, plus the arc position of the tower.
const SPINE_LEN = [];
{
	let L = 0;
	SPINE_LEN.push( 0 );
	for ( let i = 1; i < SPINE.pts.length; i ++ ) {
		L += Math.hypot( SPINE.pts[ i ][ 0 ] - SPINE.pts[ i - 1 ][ 0 ], SPINE.pts[ i ][ 1 ] - SPINE.pts[ i - 1 ][ 1 ] );
		SPINE_LEN.push( L );
	}
}
const TOWER_T = SPINE_LEN[ 3 ];
function spineCoord( x, z ) {
	let best = 1e9, bs = 0, bt = 0;
	for ( let i = 1; i < SPINE.pts.length; i ++ ) {
		const [ ax, az ] = SPINE.pts[ i - 1 ], [ bx, bz ] = SPINE.pts[ i ];
		const dx = bx - ax, dz = bz - az, l = Math.hypot( dx, dz );
		let t = ( ( x - ax ) * dx + ( z - az ) * dz ) / ( l * l );
		t = clamp( t, 0, 1 );
		const cx = ax + dx * t, cz = az + dz * t;
		const d = Math.hypot( x - cx, z - cz );
		if ( d < best ) {
			best = d;
			const side = ( dx * ( z - az ) - dz * ( x - ax ) ) / l;
			bs = Math.sign( side ) * d;
			bt = SPINE_LEN[ i - 1 ] + t * l;
		}
	}
	return { s: bs, t: bt, d: best };
}

// Crest line of the big granite massif: [x, z, crest height]. The summit
// sits NNW of the village; the ridge falls to the lake valley eastwards.
const MASSIF = [
	[ - 1800, - 800, 300 ], [ - 1400, - 1250, 420 ], [ - 950, - 1650, 520 ],
	[ - 500, - 1950, 580 ], [ - 120, - 2000, 480 ], [ 220, - 1980, 320 ], [ 500, - 1950, 150 ]
];
const LOOKOUT_KNOLL = [ - 170, - 230 ];

function massifCoord( x, z ) {
	let best = 1e9, crest = 0;
	for ( let i = 1; i < MASSIF.length; i ++ ) {
		const [ ax, az, ah ] = MASSIF[ i - 1 ], [ bx, bz, bh ] = MASSIF[ i ];
		const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
		const t = clamp( ( ( x - ax ) * dx + ( z - az ) * dz ) / l2, 0, 1 );
		const d = Math.hypot( ax + dx * t - x, az + dz * t - z );
		if ( d < best ) { best = d; crest = ah + ( bh - ah ) * t; }
	}
	// wander the crest height a little so the skyline is not a straight line
	crest *= 0.88 + 0.24 * ( 0.5 + 0.5 * nD( x * 0.0025, z * 0.0025 ) );
	return { d: best, crest };
}

// ---------------------------------------------------------------------------
// Analytic height function. Built from layers so each landmark can be tuned.
// ---------------------------------------------------------------------------
export function rawHeight( x, z ) {

	const cx = coastX( z, x );
	const d = cx - x; // >0 inland, <0 at sea

	// --- sea floor & shoreline ---
	let h;
	const cliffW = 26 + 22 * ( 0.5 + 0.5 * nB( z * 0.008, 9.1 ) );
	if ( d < 0 ) {
		// ~40 m of turquoise rocky shallows, then the drop to the lake bed
		const t2 = smoothstep( 35, 180, - d );
		h = - 1.2 - 3 * smoothstep( 0, 40, - d ) - 30 * t2 - 6 * t2 * fbm( nA, x * 0.01, z * 0.01, 3 ) + 1.0 * ( 1 - t2 ) * fbm( nD, x * 0.06, z * 0.06, 2 );
	} else {
		// granite coast: low rocky lip, then a stepped rise to the plateau
		h = - 1.2 + 3 * smoothstep( 0, 8, d ) + 24 * Math.pow( smoothstep( 10, cliffW, d ), 1.3 );
		if ( d < 60 ) h = lerp( h, Math.round( h / 4 ) * 4, 0.35 * ( 1 - smoothstep( 40, 60, d ) ) );
	}

	// --- broad inland undulation ---
	const inland = smoothstep( 20, 260, d );
	h += inland * ( 10 + 14 * fbm( nA, x * 0.0045, z * 0.0045, 4 ) );

	// --- distance / direction from the village ---
	const mx = x - VILLAGE.x, mz = z - VILLAGE.z;
	const dist = Math.sqrt( mx * mx + mz * mz );
	const dirW = clamp( ( - mx * 0.72 - mz * 0.69 ) / Math.max( dist, 1 ), - 1, 1 ); // 1 toward NW

	// --- the great granite massif (upper left of the perspective reference):
	// a crest line NNW of the village, highest ~1.2 km away, falling towards
	// the lake valley on the right. Flanks ~35-40 deg, jagged crags on top.
	const mr = massifCoord( x, z );
	let massif = 0;
	if ( mr.d < mr.crest * 0.9 ) {
		// concave flank: gentle green foot, abrupt granite summit with crags
		const flank = Math.pow( 1 - smoothstep( 0, mr.crest * 0.78, mr.d ), 1.6 );
		const crag = ridged( nC, x * 0.0035 + 3.1, z * 0.0035 - 1.7, 4 );
		const body = 0.5 + 0.5 * fbm( nB, x * 0.0022 - 4, z * 0.0022 + 2, 3 );
		massif = mr.crest * flank * ( 0.7 + 0.2 * body ) + flank * flank * mr.crest * 0.38 * Math.pow( crag, 1.2 );
		massif *= smoothstep( 30, 200, d );
	}
	// --- green rocky foothills rising gradually from the village (left of
	// the reference), with the knoll that carries the far lookout tower ---
	const westness = smoothstep( - 0.35, 0.8, dirW );
	const hillMask = smoothstep( 130, 700, dist ) * smoothstep( 40, 200, d );
	let hills = hillMask * ( ( 45 + 120 * westness ) * ( 0.55 + 0.45 * fbm( nB, x * 0.003 + 11, z * 0.003, 4 ) )
		+ 45 * Math.pow( ridged( nA, x * 0.006, z * 0.006, 3 ), 1.4 ) );
	const kx = x - LOOKOUT_KNOLL[ 0 ], kz = z - LOOKOUT_KNOLL[ 1 ];
	hills += 55 * Math.exp( - ( kx * kx + kz * kz ) / ( 2 * 70 * 70 ) ) * smoothstep( 40, 200, d );
	h += Math.max( hills, massif ) + 0.25 * Math.min( hills, massif );

	// --- small-scale granite roughness (stronger on hills and shore) ---
	const rough = fbm( nD, x * 0.045, z * 0.045, 3 );
	h += rough * ( 1.2 + 3.5 * hillMask + 2.5 * ( 1 - smoothstep( 0, 40, Math.abs( d - 8 ) ) ) );

	// --- islands: low, elongated, rocky ---
	for ( const is of ISLANDS ) {
		const ix = x - is.x, iz = z - is.z;
		if ( Math.abs( ix ) > is.r * is.e * 1.6 || Math.abs( iz ) > is.r * is.e * 1.6 ) continue;
		const c = Math.cos( is.rot ), s = Math.sin( is.rot );
		// rotate into island frame; long axis runs NNE-SSW
		const lx = ix * c - iz * s, lz = ix * s + iz * c;
		const warp = 1 + 0.3 * nA( x * 0.02 + is.x, z * 0.02 );
		const rr = Math.hypot( lx, lz / is.e ) / ( is.r * warp );
		if ( rr < 1.4 ) {
			const top = Math.min( 22, is.h * ( 0.65 + 0.55 * ridged( nB, x * 0.025, z * 0.025, 3 ) ) );
			const ih = - 6 + ( top + 6 ) * ( 1 - smoothstep( 0.5, 1.25, rr ) );
			h = Math.max( h, ih + 1.5 * fbm( nD, x * 0.08, z * 0.08, 2 ) * ( 1 - smoothstep( 0.8, 1.2, rr ) ) );
		}
	}

	return h;
}

// Village-scale sculpting applied on top of the raw field.
function plateauHeight( x, z ) {
	return 27 - 0.035 * x - 0.015 * z + 3 * fbm( nB, x * 0.012, z * 0.012, 3 )
		+ 2.5 * Math.max( 0, ridged( nD, x * 0.03, z * 0.03, 3 ) - 0.55 ) + 0.3 * nC( x * 0.2, z * 0.2 );
}

function sculptNoPads( x, z ) {
	let h = rawHeight( x, z );
	const vx = ( x - VILLAGE.x ) / 1.15, vz = z - VILLAGE.z;
	const vd = Math.sqrt( vx * vx + vz * vz );
	const wV = 1 - smoothstep( VILLAGE.radius * 0.7, VILLAGE.radius * 1.35, vd );
	if ( wV > 0 ) h = lerp( h, plateauHeight( x, z ), wV * 0.8 );
	return h;
}

function sculpt( x, z, h ) {

	if ( Math.abs( x - MASK.centerX ) > MASK.size * 0.5 || Math.abs( z - MASK.centerZ ) > MASK.size * 0.5 ) return h;

	// Village plateau: tilted towards the sea, undulating, with granite outcrops.
	const vx = ( x - VILLAGE.x ) / 1.15, vz = z - VILLAGE.z;
	const vd = Math.sqrt( vx * vx + vz * vz );
	const wV = 1 - smoothstep( VILLAGE.radius * 0.7, VILLAGE.radius * 1.35, vd );
	if ( wV > 0 ) h = lerp( h, plateauHeight( x, z ), wV * 0.8 );

	// Rocky spine: crest carries the wall and tower; SW (village) side is a
	// short cliff, N/E side a long granite slope to the shore.
	const sp = spineCoord( x, z );
	if ( sp.d < 40 ) {
		const tw = Math.exp( - Math.pow( ( sp.t - TOWER_T ) / 26, 2 ) );
		const crest = SPINE.crest + ( SPINE.crestTower - SPINE.crest ) * tw;
		const prof = sp.s > 0 ? 1 - smoothstep( 1.0, 13, sp.s ) : 1 - smoothstep( 4, 30, - sp.s );
		const endFade = smoothstep( - 6, 6, sp.t ) * ( 1 - smoothstep( SPINE_LEN[ SPINE_LEN.length - 1 ] - 6, SPINE_LEN[ SPINE_LEN.length - 1 ] + 8, sp.t ) );
		const rock = 1.2 * ridged( nD, x * 0.08, z * 0.08, 3 );
		const hs = SPINE.base + ( crest + rock ) * prof;
		h = Math.max( h, lerp( h, hs, endFade ) );
	}

	// Fort knoll: raised granite dome, steeper to the sea (S/SE).
	const fx = x - FORT.x, fz = z - FORT.z;
	const fd = Math.sqrt( fx * fx + fz * fz );
	const seaward = smoothstep( - 0.2, 0.6, ( fx * 0.5 + fz * 0.85 ) / Math.max( fd, 1 ) );
	const fall = lerp( 22, 10, seaward );
	const wF = 1 - smoothstep( FORT.radius + 2, FORT.radius + 2 + fall, fd );
	if ( wF > 0 ) {
		let fh = FORT.ground + 0.25 * nC( x * 0.3, z * 0.3 );
		if ( fd > FORT.radius + 3 && fd < FORT.radius + 12 ) fh += 2.5 * ridged( nD, x * 0.05, z * 0.05, 3 ) * ( 1 - wF * 0.3 );
		h = Math.max( h, lerp( h, fh, wF ) );
	}

	// Mine yard in front of the adit cliff (flattened ellipse at floor level).
	{
		const dx = x - MINE.yardX, dz = z - MINE.yardZ;
		const a = dx * MINE.tx + dz * MINE.tz, b = dx * MINE.nx + dz * MINE.nz;
		const e = Math.hypot( a / 21, b / 14 );
		const wY = 1 - smoothstep( 0.85, 1.35, e );
		if ( wY > 0 ) h = lerp( h, MINE.floor - 0.15 + 0.25 * nA( x * 0.2, z * 0.2 ), wY );
		// hard apron in front of the face: nothing may bury the adits
		const fa = Math.abs( ( x - MINE.fx ) * MINE.tx + ( z - MINE.fz ) * MINE.tz ), fb = ( x - MINE.fx ) * MINE.nx + ( z - MINE.fz ) * MINE.nz;
		if ( fa < MINE.width * 0.5 - 1 && fb > - 0.5 && fb < 7 ) h = Math.min( h, MINE.floor - 0.15 + 0.4 * smoothstep( 3, 7, fb ) );
	}

	// Inside the carved rock block: keep terrain below the adit floors (the
	// block mesh provides the cliff face and roof).
	{
		const dx = x - MINE.x, dz = z - MINE.z;
		const a = Math.abs( dx * MINE.tx + dz * MINE.tz ) - MINE.width * 0.5;
		const b = Math.abs( dx * MINE.nx + dz * MINE.nz ) - MINE.depth * 0.5;
		const e = Math.max( a, b );
		if ( e < - 1 ) h = Math.min( h, lerp( h, MINE.floor - 2, smoothstep( - 1, - 4, e ) ) );
		else if ( e < 0 ) h = Math.min( h, MINE.top - 0.3 );
	}

	// Flatten building pads.
	for ( const b of BUILDINGS ) {
		const r = footprintR( b ) + 2.5;
		const dx = x - b.x, dz = z - b.z;
		const dd = Math.sqrt( dx * dx + dz * dz );
		if ( dd < r + 6 ) {
			const w = 1 - smoothstep( r, r + 6, dd );
			h = lerp( h, padHeight( b ), w * 0.85 );
		}
	}

	// Paths: slightly sunken ruts.
	const p = pathDistance( x, z );
	if ( p.d < p.w + 2 ) {
		const w = 1 - smoothstep( p.w * 0.4, p.w + 2, p.d );
		h -= 0.25 * w;
	}
	// In a hamlet (HAMLETS, the third reference): low earth banks along both sides of the track
	for ( const hm of HAMLETS ) {
		const dh = Math.hypot( x - hm.x, z - hm.z );
		if ( dh > hm.r || p.d > p.w + 3 ) continue;
		const bank = smoothstep( p.w * 0.55, p.w * 0.95, p.d ) * ( 1 - smoothstep( p.w + 0.9, p.w + 2.8, p.d ) );
		h += 0.5 * bank * ( 1 - smoothstep( hm.r * 0.75, hm.r, dh ) ) * ( 0.75 + 0.25 * nC( x * 0.4, z * 0.4 ) );
	}

	// Fields: gently flattened plots.
	for ( const f of FIELDS ) {
		const c = Math.cos( f.rot ), s = Math.sin( f.rot );
		const lx = ( x - f.x ) * c - ( z - f.z ) * s;
		const lz = ( x - f.x ) * s + ( z - f.z ) * c;
		const e = Math.max( Math.abs( lx ) - f.w * 0.5, Math.abs( lz ) - f.l * 0.5 );
		if ( e < 6 ) {
			const w = 1 - smoothstep( - 2, 6, e );
			h = lerp( h, sculptNoPads( f.x, f.z ), w * 0.6 );
		}
	}

	return h;
}

const padCache = new Map();
function padHeight( b ) {
	if ( ! padCache.has( b ) ) {
		let s = 0, n = 0;
		for ( let i = 0; i < 8; i ++ ) {
			const a = i / 8 * Math.PI * 2;
			s += sculptNoPads( b.x + Math.cos( a ) * 3, b.z + Math.sin( a ) * 3 ); n ++;
		}
		padCache.set( b, s / n );
	}
	return padCache.get( b );
}

export function heightAnalytic( x, z ) {
	return sculpt( x, z, rawHeight( x, z ) );
}

// ---------------------------------------------------------------------------
// Grid build (chunked so the loading screen can report progress).
// ---------------------------------------------------------------------------
// Sky-visibility AO from the heightfield: horizon angles in 8 directions.
// rows j0..j1 only (the generator pool in world/genFields.js splits it between workers)
export function bakeAO( hf, onProgress, j0 = 0, j1 = hf.n ) {
	const { n } = hf;
	const out = new Float32Array( ( j1 - j0 ) * n );
	const dist = [ 3, 6, 10, 16, 26, 42, 70 ];
	const dirs = [];
	for ( let k = 0; k < 8; k ++ ) dirs.push( [ Math.cos( k * Math.PI / 4 ), Math.sin( k * Math.PI / 4 ) ] );
	for ( let j = j0; j < j1; j ++ ) {
		const z = hf.z0 + j * hf.cell;
		for ( let i = 0; i < n; i ++ ) {
			const x = hf.x0 + i * hf.cell;
			const h0 = hf.data[ j * n + i ];
			let occ = 0;
			for ( const [ dx, dz ] of dirs ) {
				let maxT = 0;
				for ( const d of dist ) {
					const t = ( hf.heightAt( x + dx * d, z + dz * d ) - h0 - 0.3 ) / d;
					if ( t > maxT ) maxT = t;
				}
				occ += maxT / Math.sqrt( 1 + maxT * maxT ); // sin(elevation)
			}
			out[ ( j - j0 ) * n + i ] = Math.max( 0, 1 - occ / 8 * 1.6 );
		}
		if ( j % 40 === 0 ) onProgress?.( ( j - j0 ) / ( j1 - j0 ) );
	}
	return out;
}

// Macro noise texture over the whole terrain (RGBA8):
//  R: very large patches  G: large  B: medium  A: granite outcrop field
export const MACRO_RES = 1024;
// rows j0..j1 only (see bakeAO)
export function buildMacro( onProgress, j0 = 0, j1 = MACRO_RES ) {
	const res = MACRO_RES;
	const data = new Uint8Array( ( j1 - j0 ) * res * 4 );
	const x0 = TERRAIN.centerX - TERRAIN.size / 2, z0 = TERRAIN.centerZ - TERRAIN.size / 2;
	const px = TERRAIN.size / res;
	const q = ( v ) => Math.max( 0, Math.min( 255, ( v * 0.5 + 0.5 ) * 255 ) );
	for ( let j = j0; j < j1; j ++ ) {
		const z = z0 + ( j + 0.5 ) * px;
		for ( let i = 0; i < res; i ++ ) {
			const x = x0 + ( i + 0.5 ) * px;
			const k = ( ( j - j0 ) * res + i ) * 4;
			data[ k ] = q( fbm( nA, x * 0.0035, z * 0.0035, 3 ) * 1.6 );
			data[ k + 1 ] = q( fbm( nB, x * 0.018, z * 0.018, 3 ) * 1.6 );
			data[ k + 2 ] = q( fbm( nC, x * 0.11, z * 0.11, 2 ) * 1.6 );
			data[ k + 3 ] = q( fbm( nD, x * 0.028, z * 0.028, 3 ) * 1.6 );
		}
		if ( j % 64 === 0 ) onProgress?.( ( j - j0 ) / ( j1 - j0 ) );
	}
	return data;
}

export class HeightField {

	constructor() {
		this.size = TERRAIN.size;
		this.seg = TERRAIN.segments;
		this.n = this.seg + 1;
		this.x0 = TERRAIN.centerX - this.size / 2;
		this.z0 = TERRAIN.centerZ - this.size / 2;
		this.cell = this.size / this.seg;
		this.data = new Float32Array( this.n * this.n );
	}

	// rows j0..j1 (the generator pool splits the field between workers)
	async build( onProgress, inWorker = false, j0 = 0, j1 = this.n ) {
		const { n, data } = this;
		const rows = 40;
		for ( let j = j0; j < j1; j ++ ) {
			const z = this.z0 + j * this.cell;
			for ( let i = 0; i < n; i ++ ) {
				data[ j * n + i ] = heightAnalytic( this.x0 + i * this.cell, z );
			}
			if ( j % rows === 0 ) {
				onProgress?.( ( j - j0 ) / ( j1 - j0 ) );
				if ( ! inWorker ) await new Promise( ( r ) => setTimeout( r, 0 ) );
			}
		}
		onProgress?.( 1 );
	}

	// Bilinear sample in world space.
	heightAt( x, z ) {
		const fx = ( x - this.x0 ) / this.cell, fz = ( z - this.z0 ) / this.cell;
		const i = clamp( Math.floor( fx ), 0, this.seg - 1 ), j = clamp( Math.floor( fz ), 0, this.seg - 1 );
		const tx = clamp( fx - i, 0, 1 ), tz = clamp( fz - j, 0, 1 );
		const n = this.n, d = this.data;
		const a = d[ j * n + i ], b = d[ j * n + i + 1 ], c = d[ ( j + 1 ) * n + i ], e = d[ ( j + 1 ) * n + i + 1 ];
		return lerp( lerp( a, b, tx ), lerp( c, e, tx ), tz );
	}

	normalAt( x, z, out ) {
		const e = this.cell;
		const hx = this.heightAt( x + e, z ) - this.heightAt( x - e, z );
		const hz = this.heightAt( x, z + e ) - this.heightAt( x, z - e );
		out.set( - hx, 2 * e, - hz ).normalize();
		return out;
	}

	slopeAt( x, z ) {
		const e = this.cell;
		const hx = ( this.heightAt( x + e, z ) - this.heightAt( x - e, z ) ) / ( 2 * e );
		const hz = ( this.heightAt( x, z + e ) - this.heightAt( x, z - e ) ) / ( 2 * e );
		return Math.sqrt( hx * hx + hz * hz );
	}
}

// ---------------------------------------------------------------------------
// Splat mask: R path, G trampled village ground, B field, A crop id.
// ---------------------------------------------------------------------------
// rows j0..j1 only (see bakeAO)
export function buildMask( onProgress, j0 = 0, j1 = MASK.res ) {
	const { res, size, centerX, centerZ } = MASK;
	const data = new Uint8Array( ( j1 - j0 ) * res * 4 );
	const x0 = centerX - size / 2, z0 = centerZ - size / 2;
	const px = size / res;

	for ( let j = j0; j < j1; j ++ ) {
		if ( j % 64 === 0 ) onProgress?.( ( j - j0 ) / ( j1 - j0 ) );
		const z = z0 + ( j + 0.5 ) * px;
		for ( let i = 0; i < res; i ++ ) {
			const x = x0 + ( i + 0.5 ) * px;
			const k = ( ( j - j0 ) * res + i ) * 4;

			// village trampled earth, irregular
			const vx = ( x - VILLAGE.x ) / 1.35, vz = z - VILLAGE.z;
			const vd = Math.sqrt( vx * vx + vz * vz );
			const vn = fbm( nA, x * 0.05, z * 0.05, 3 );
			// packed earth over the village core, between the houses (as in the aerial reference); further
			// out patchy, worn grass
			let g = ( 1 - smoothstep( 16, 40, vd + vn * 26 ) ) * 0.9;
			g = Math.max( g, smoothstep( 0.35, 0.7, fbm( nD, x * 0.09, z * 0.09, 3 ) + 0.25 ) * ( 1 - smoothstep( 30, 80, vd ) ) * 0.55 );
			// fort interior & around buildings
			const fd = Math.hypot( x - FORT.x, z - FORT.z );
			g = Math.max( g, 1 - smoothstep( FORT.radius - 4, FORT.radius + 3, fd ) );
			for ( const b of BUILDINGS ) {
				const r = footprintR( b ) + ( b.awning ? 5 : 3 );
				const bd = Math.hypot( x - b.x, z - b.z );
				g = Math.max( g, 0.85 * ( 1 - smoothstep( r - 2, r + 2.5 + vn * 3, bd ) ) );
			}
			// mine terrace spoil
			const td = Math.hypot( x - MINE.yardX, z - MINE.yardZ );
			g = Math.max( g, 1 - smoothstep( 6, 16, td + vn * 6 ) );

			// paths
			const p = pathDistance( x, z );
			const pn = nC( x * 0.3, z * 0.3 ) * 0.5;
			const r = 1 - smoothstep( p.w * 0.35, p.w * ( 0.75 + pn * 0.3 ), p.d );

			// fields
			let b = 0, a = 0;
			for ( let fi = 0; fi < FIELDS.length; fi ++ ) {
				const f = FIELDS[ fi ];
				const c = Math.cos( f.rot ), s = Math.sin( f.rot );
				const lx = ( x - f.x ) * c - ( z - f.z ) * s;
				const lz = ( x - f.x ) * s + ( z - f.z ) * c;
				const e = Math.max( Math.abs( lx ) - f.w * 0.5, Math.abs( lz ) - f.l * 0.5 );
				const m = 1 - smoothstep( - 1.2, 0.3, e );
				if ( m > b ) { b = m; a = f.crop; }
			}

			data[ k ] = r * 255;
			data[ k + 1 ] = clamp( g, 0, 1 ) * 255;
			data[ k + 2 ] = b * 255;
			data[ k + 3 ] = ( a + 1 ) * 60;
		}
	}
	return data;
}

export { pathDistance, segDist, spineCoord };
