import * as THREE from 'three/webgpu';
import {
	Fn, uv, positionWorld, normalWorld, float, vec2, vec3, color, mix, smoothstep, floor, fract, sin,
	hash, texture, fwidth, length, clamp, abs, max
} from 'three/tsl';
import { proceduralBump } from './terrain.js';
import { SURFACE } from './surfaceBake.js';
import { cloudShade } from './cloudShadow.js';
import { wetness } from './weather.js';

// All building materials read metric UVs written by core/builder.js.
// Colours are tuned against the references: warm grey granite, grey-olive
// weathered thatch with moss, dark oak timber, madder-red cloth.
// The patterns (stone cells, straw, grain, clay, the world-space patches) come from the textures
// baked by world/surfaceBake.js; the materials only colour them (a texture fetch or two per pixel
// instead of Worley cells and fractal noises).

// Pixel footprint of the metric UVs: used to fade out procedural detail that
// is finer than a pixel (prevents moire/sparkle at distance).
const footprint = ( st ) => length( fwidth( st ) );
const aa = ( st, lo, hi ) => smoothstep( lo, hi, footprint( st ) );

// Mean tone of a procedural material, for its cheap stand-in in the water reflection and the
// shadow pass (core/proxies.js): the mix of two sRGB colours, darkened by k.
const proxyTone = ( mat, a, b, k = 1 ) => {
	mat.userData.proxyColor = new THREE.Color( a ).lerp( new THREE.Color( b ), 0.5 ).multiplyScalar( k );
	return mat;
};

// world-space patches (moss, weathering, fading): one fetch of the 32 m tile, mapped so that walls
// (x / z with y) and roofs (x / z) both vary
const worldPatch = ( T ) => texture( T.world, vec2( positionWorld.x.add( positionWorld.y.mul( 0.5 ) ), positionWorld.z.sub( positionWorld.y.mul( 0.5 ) ) ).div( SURFACE.world ) );

// Dry-stone masonry (no mortar): irregular courses of granite blocks.
// fade: the pixel footprint, in rows, over which the stone cells fade to the average tone
export function stoneMaterial( T, { rowH = 0.3, len = 0.55, tintA = 0x746d61, tintB = 0xb0a692, moss = 0.6, fade = [ 0.02, 0.12 ], gapColor = 0x2b2721, bump = 1.6 } = {} ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	// the stone cells, in cell space (len x rowH metres per cell)
	const s = texture( T.stone, st.div( vec2( len, rowH ) ).div( SURFACE.stoneCells ) );
	const edge = s.r.mul( rowH );
	const stoneMask = smoothstep( 0.008, 0.04, edge );
	const cid = s.g, n = s.b;
	let col = mix( color( tintA ), color( tintB ), cid.mul( 0.7 ).add( n.mul( 0.3 ) ) );
	col = mix( col, col.mul( vec3( 1.06, 1.0, 0.9 ) ), hash( cid.mul( 91.0 ) ).step( 0.7 ) );
	const gap = color( gapColor );
	// lichen and moss: patchy, stronger low on the wall and on top faces
	const mn = worldPatch( T ).r;
	const mossM = smoothstep( 0.55, 0.8, mn.add( normalWorld.y.clamp( 0, 1 ).mul( 0.35 ) ).add( smoothstep( 0.0, 1.2, st.y ).oneMinus().mul( 0.15 ) ) ).mul( moss );
	col = mix( col, mix( color( 0x4d5a2a ), color( 0x7c7e48 ), n ), mossM.mul( 0.65 ) );
	const far = aa( st, rowH * fade[ 0 ], rowH * fade[ 1 ] );
	const avg = mix( color( tintA ), color( tintB ), 0.5 ).mul( 0.72 );
	const farCol = mix( avg, mix( color( 0x4d5a2a ), color( 0x7c7e48 ), 0.5 ), mossM.mul( 0.6 ) );
	mat.colorNode = mix( mix( gap, col, mix( stoneMask, 1.0, far ) ), farCol, far );
	mat.roughnessNode = float( 0.92 );
	// pillowed stone faces
	const bumpH = smoothstep( 0.0, 0.07, edge ).mul( 0.8 ).add( n.mul( 0.25 ) );
	mat.normalNode = proceduralBump( bumpH, far.oneMinus().mul( bump ) );
	return proxyTone( mat, tintA, tintB, 0.8 );
}

// Coursed flat slabs of the castro house (ref/casa_castro): long thin granite slabs in level courses,
// dark recessed joints, faces pillowed toward rounded arrises. The relief is a height in metres
// (proceduralBump then gives the true slope): ~1.2 cm of pillow over the outer ~5 cm of each slab, so
// the raking light catches the upper arris and the joint falls into shadow, without flipping the
// normal (the stone material's bump at 0.2 m courses did, in black lines).
export function slabMaterial( T, { rowH = 0.2, tintA = 0x3f4045, tintB = 0xa4a6b0, moss = 0.15, fade = [ 0.05, 0.25 ], gapColor = 0x2c2b2a, relief = 0.012 } = {} ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	const len = rowH * SURFACE.slabAspect;
	const s = texture( T.slab, st.div( vec2( len, rowH ) ).div( SURFACE.stoneCells ) );
	const edge = s.r, id = s.g, grain = s.b, pillow = s.a;
	const stoneMask = smoothstep( 0.04, 0.11, edge );
	let col = mix( color( tintA ), color( tintB ), id.mul( 0.75 ).add( grain.mul( 0.25 ) ) );
	col = mix( col, col.mul( vec3( 1.07, 1.0, 0.9 ) ), hash( id.mul( 91.0 ) ).step( 0.75 ) );
	// arrises a shade lighter (weathered), the joint side shadowed (occlusion of the recess)
	col = col.mul( smoothstep( 0.04, 0.35, edge ).mul( 0.25 ).add( 0.75 ) );
	const mn = worldPatch( T ).r;
	const mossM = smoothstep( 0.55, 0.8, mn.add( normalWorld.y.clamp( 0, 1 ).mul( 0.35 ) ).add( smoothstep( 0.0, 1.2, st.y ).oneMinus().mul( 0.15 ) ) ).mul( moss );
	const mossC = mix( color( 0x4d5a2a ), color( 0x7c7e48 ), grain );
	col = mix( col, mossC, mossM.mul( 0.65 ) );
	// moss and soil settle in the joints low on the wall
	const gap = mix( color( gapColor ), color( 0x3a3f22 ), mossM );
	const far = aa( st, rowH * fade[ 0 ], rowH * fade[ 1 ] );
	const avg = mix( color( tintA ), color( tintB ), 0.5 ).mul( 0.72 );
	const farCol = mix( avg, mix( color( 0x4d5a2a ), color( 0x7c7e48 ), 0.5 ), mossM.mul( 0.6 ) );
	mat.colorNode = mix( mix( gap, col, mix( stoneMask, 1.0, far ) ), farCol, far );
	// rough granite, the joints rougher still
	mat.roughnessNode = mix( float( 1.0 ), grain.mul( 0.12 ).add( 0.8 ), stoneMask );
	const h = smoothstep( 0.04, 0.5, edge ).sqrt().mul( pillow.mul( 0.8 ).add( 0.6 ) ).mul( relief ).add( grain.mul( relief * 0.12 ) );
	mat.normalNode = proceduralBump( h, far.oneMinus() );
	return proxyTone( mat, tintA, tintB, 0.8 );
}

// Layered straw thatch, grey with age, mossy patches (reference roofs). The fibres run down the
// slope (uv.y); the courses are faint and broken up (they read as corrugated tiles otherwise).
// courses: weight of the texture's 0.42 m layers (0 where the geometry is laid in courses, the castro
// house); tufts: weight of the bundles (the straw stretched 4x across, ~18 cm by 60 cm), in the colour and as a
// relief of `tufts` x 2.5 cm (a height in metres, a gentle slope)
export function thatchMaterial( T, { base = 0x6a604c, light = 0x8e8266, mossy = 0.2, courses = 1, tufts = 0 } = {} ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv(); // x around/along, y down-slope distance
	const s = texture( T.thatch, st.div( vec2( SURFACE.thatch[ 0 ], SURFACE.thatch[ 1 ] ) ) );
	const course = s.b;
	const f1 = aa( st, 0.008, 0.03 ), f2 = aa( st, 0.003, 0.012 ), fc = aa( st, 0.02, 0.08 );
	const strands = mix( s.r, 0.5, f1 );
	const strands2 = mix( s.g, 0.5, f2 );
	const patch = worldPatch( T ).g;
	// the straw: a gentle tone variation (full contrast read as black stripes)
	let col = mix( color( base ), color( light ), strands.mul( 0.6 ).add( strands2.mul( 0.4 ) ).sub( 0.5 ).mul( 0.55 ).add( 0.5 ) );
	// a faint shadow line at the bottom of every layer
	if ( courses ) col = col.mul( mix( smoothstep( 0.0, 0.2, course ).mul( 0.05 * courses ).add( 1 - 0.05 * courses ), 1 - 0.03 * courses, fc ) );
	// bundles: darker hollows between the tufts
	const tuft = tufts ? texture( T.thatch, st.div( vec2( SURFACE.thatch[ 0 ] * 4, SURFACE.thatch[ 1 ] ) ) ).r : null;
	if ( tufts ) col = col.mul( smoothstep( 0.25, 0.75, tuft ).mul( 0.35 * tufts ).add( 1 - 0.3 * tufts ) );
	// weathering: grey sun-bleached vs. dark damp
	col = mix( col, col.mul( vec3( 0.8, 0.82, 0.85 ) ).add( 0.03 ), smoothstep( 0.4, 0.7, patch ).mul( 0.5 ) );
	const mossM = smoothstep( 0.58, 0.78, patch.add( strands.mul( 0.15 ) ) ).mul( mossy );
	col = mix( col, mix( color( 0x4a5626 ), color( 0x6f7a36 ), strands ), mossM.mul( 0.75 ) );
	// thick, shadowed eave lip
	col = col.mul( mix( 0.45, 1.0, smoothstep( 0.0, 0.6, st.y ) ) );
	mat.colorNode = col;
	mat.roughnessNode = float( 0.97 );
	// soft relief: the layers, and the straw barely (its fast variation as a height bent the normal
	// into dark streaks down the roof); the straw itself lives in the colour
	if ( tufts ) {
		// metres: straw 4 mm, tufts up to 2.5 cm (a gentle slope; the castro roofs)
		const bm = strands.mul( 0.004 ).add( smoothstep( 0.2, 0.8, tuft ).mul( 0.025 * tufts ) );
		mat.normalNode = proceduralBump( bm, aa( st, 0.02, 0.1 ).oneMinus() );
	} else {
		const bh = strands.mul( 0.05 ).add( smoothstep( 0.0, 0.3, course ).mul( 0.12 * courses ) );
		mat.normalNode = proceduralBump( bh, f1.oneMinus() );
	}
	return proxyTone( mat, base, light, 0.85 );
}

// Planks / timber. Grain runs along uv.y (posts) — plank seams across uv.x.
export function woodMaterial( T, { a = 0x4a3526, b = 0x755638, plank = 0.24, seams = true } = {} ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	const pid = floor( st.x.div( plank ) );
	const fg = aa( st, 0.01, 0.04 ), fs = aa( st, plank * 0.15, plank * 0.6 );
	// every plank its own stretch of the grain
	const s = texture( T.wood, st.add( vec2( hash( pid ).mul( 0.73 ), hash( pid.add( 7 ) ).mul( 8 ) ) ).div( vec2( SURFACE.wood[ 0 ], SURFACE.wood[ 1 ] ) ) );
	const grain = mix( s.r, 0.5, fg );
	const knots = smoothstep( 0.75, 0.9, s.g );
	let col = mix( color( a ), color( b ), grain.mul( 0.7 ).add( hash( pid ).mul( 0.3 ) ) );
	col = col.mul( knots.mul( - 0.35 ).add( 1.0 ) );
	if ( seams ) {
		const fx = fract( st.x.div( plank ) );
		col = col.mul( mix( smoothstep( 0.0, 0.06, fx ).mul( smoothstep( 0.94, 1.0, fx ).oneMinus() ).mul( 0.5 ).add( 0.5 ), 0.85, fs ) );
	}
	// weathered grey on up-facing parts
	col = mix( col, col.mul( 0.8 ).add( 0.05 ), normalWorld.y.clamp( 0, 1 ).mul( 0.5 ) );
	mat.colorNode = col;
	mat.roughnessNode = float( 0.85 );
	mat.normalNode = proceduralBump( grain.mul( 0.4 ), fg.oneMinus().mul( 0.8 ) );
	return proxyTone( mat, a, b );
}

// Woven cloth (market canopies, bunting, banners).
export function clothMaterial( T, { a = 0x8c2419, b = 0xb13a28 } = {} ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	const weave = mix( sin( st.x.mul( 260.0 ) ).mul( sin( st.y.mul( 260.0 ) ) ).mul( 0.5 ).add( 0.5 ), 0.5, aa( st, 0.002, 0.008 ) );
	const fade = worldPatch( T ).b;
	let col = mix( color( a ), color( b ), fade );
	col = col.mul( weave.mul( 0.08 ).add( 0.94 ) );
	// sun-faded, dusty edges
	col = mix( col, col.mul( 0.8 ).add( vec3( 0.06, 0.05, 0.04 ) ), smoothstep( 0.6, 0.9, fade ).mul( 0.4 ) );
	mat.colorNode = col;
	mat.roughnessNode = float( 0.95 );
	// thin cloth glows a little when back-lit
	mat.emissiveNode = col.mul( 0.04 );
	return proxyTone( mat, a, b );
}

// Woven wattle (hazel rods around stakes).
export function wattleMaterial( T ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	const rod = fract( st.y.div( 0.06 ) );
	const weave = sin( st.x.mul( 14.0 ).add( floor( st.y.div( 0.06 ) ).mul( 3.14159 ) ) ).mul( 0.5 ).add( 0.5 );
	const far = aa( st, 0.01, 0.04 );
	// the rods' streaks: the wood grain stretched across
	const n = texture( T.wood, vec2( st.y.mul( 1.3 ), st.x.mul( 0.1 ) ) ).r;
	let col = mix( color( 0x4e3c29 ), color( 0x86704e ), n.mul( 0.6 ).add( weave.mul( 0.4 ) ) );
	col = mix( col.mul( smoothstep( 0.0, 0.3, rod ).mul( smoothstep( 0.7, 1.0, rod ).oneMinus() ).mul( 0.5 ).add( 0.5 ) ), color( 0x655038 ), far );
	mat.colorNode = col;
	mat.roughnessNode = float( 0.9 );
	return proxyTone( mat, 0x4e3c29, 0x86704e, 0.85 );
}

// Wattle & daub (clay render), cream-brown.
export function daubMaterial( T ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	const s = texture( T.daub, st.div( SURFACE.daub ) );
	const n = s.r;
	const cracks = smoothstep( 0.49, 0.5, s.g ).mul( 0.25 );
	mat.colorNode = mix( color( 0x8f7a5c ), color( 0xb4a07c ), n ).mul( cracks.oneMinus() ).mul( smoothstep( 0.0, 0.5, st.y ).mul( 0.25 ).add( 0.75 ) );
	mat.roughnessNode = float( 0.95 );
	mat.normalNode = proceduralBump( n.mul( 0.5 ), float( 0.8 ) );
	return proxyTone( mat, 0x8f7a5c, 0xb4a07c, 0.9 );
}

// Mine interior: dark rock swallowing light with depth.
export function darkRockMaterial( T ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const n = worldPatch( T ).a;
	mat.colorNode = mix( color( 0x221f1b ), color( 0x4a443b ), n );
	mat.roughnessNode = float( 0.95 );
	mat.normalNode = proceduralBump( n, float( 1.2 ) );
	return proxyTone( mat, 0x221f1b, 0x4a443b );
}

export function doorwayMaterial() {
	return new THREE.MeshBasicNodeMaterial( { color: 0x0b0906, side: THREE.DoubleSide } );
}

export function emberMaterial( T ) {
	const mat = new THREE.MeshBasicNodeMaterial();
	const t = worldPatch( T ).b;
	mat.colorNode = mix( color( 0xff8a2a ), color( 0xffd27a ), t ).mul( 3.0 );
	return mat;
}

// T: the baked surface textures (world/surfaceBake.js surfaceTextures)
export function createBuildingMaterials( T ) {
	const mats = {
		stone: stoneMaterial( T, { tintA: 0x5d574c, tintB: 0x8f8574, moss: 0.25 } ),
		stoneDark: stoneMaterial( T, { tintA: 0x524d44, tintB: 0x7d7566, rowH: 0.34, len: 0.6, moss: 0.35 } ),
		fortStone: stoneMaterial( T, { tintA: 0x5e5a50, tintB: 0x8a8272, rowH: 0.45, len: 0.8, moss: 0.8 } ),
		// weathered, dark straw (the reference roofs are brown-grey, not straw yellow)
		thatch: thatchMaterial( T, { base: 0x544a3a, light: 0x756a54 } ),
		thatchGreen: thatchMaterial( T, { base: 0x4a4834, light: 0x666244, mossy: 0.55 } ),
		// the composite castro house (world/castroHouse.js, ref/casa_castro): thin flat granite slabs in
		// ~14 courses per wall, neutral cool grey (reference crop mean 82,79,77, light 125,116,109),
		// and darker olive-brown thatch (crop mean 69,61,48). Compiled only where a mesh uses them.
		castroStone: slabMaterial( T, { tintA: 0x3b3835, tintB: 0x8e8981, rowH: 0.2 } ),
		castroThatch: thatchMaterial( T, { base: 0x24211d, light: 0x6c604f, mossy: 0.12, courses: 0, tufts: 1 } ),
		wattle: wattleMaterial( T ),
		wood: woodMaterial( T ),
		woodPost: woodMaterial( T, { a: 0x3f2d20, b: 0x624631, plank: 10, seams: false } ),
		cloth: clothMaterial( T ),
		canvas: clothMaterial( T, { a: 0xbdb39b, b: 0xdcd3bd } ),
		daub: daubMaterial( T ),
		darkRock: darkRockMaterial( T ),
		doorway: doorwayMaterial(),
		ember: emberMaterial( T )
	};
	// drifting cloud shadows (world/cloudShadow.js) on every lit surface (not the dark doorway, not the embers)
	for ( const [ k, m ] of Object.entries( mats ) ) if ( k !== 'doorway' && k !== 'ember' ) m.colorNode = m.colorNode.mul( cloudShade() );
	// and the rain's wetness (world/weather.js): darker, glossier
	for ( const [ k, m ] of Object.entries( mats ) ) {
		if ( k === 'doorway' || k === 'ember' ) continue;
		m.colorNode = m.colorNode.mul( wetness.mul( - 0.2 ).add( 1 ) );
		if ( m.roughnessNode ) m.roughnessNode = mix( m.roughnessNode, float( 0.5 ), wetness.mul( 0.6 ) );
	}
	return mats;
}

export { Fn, texture, clamp, abs, max };
