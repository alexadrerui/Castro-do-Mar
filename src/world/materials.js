import * as THREE from 'three/webgpu';
import {
	Fn, uv, positionWorld, normalWorld, float, vec2, vec3, color, mix, smoothstep, floor, fract, min, max, abs, sin,
	hash, mx_noise_float, mx_fractal_noise_float, mx_worley_noise_vec2, texture, clamp, fwidth, length
} from 'three/tsl';
import { proceduralBump } from './terrain.js';

// All building materials read metric UVs written by core/builder.js.
// Colours are tuned against the references: warm grey granite, grey-olive
// weathered thatch with moss, dark oak timber, madder-red cloth.

const h2 = ( v ) => hash( v.x.mul( 127.1 ).add( v.y.mul( 311.7 ) ) );

// Pixel footprint of the metric UVs: used to fade out procedural detail that
// is finer than a pixel (prevents moire/sparkle at distance).
const footprint = ( st ) => length( fwidth( st ) );
const aa = ( st, lo, hi ) => smoothstep( lo, hi, footprint( st ) );

// Dry-stone masonry (no mortar): irregular courses of granite blocks.
export function stoneMaterial( { rowH = 0.3, len = 0.55, tintA = 0x746d61, tintB = 0xb0a692, moss = 0.6, detailTex = null } = {} ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	// irregular, rounded-polygonal granite rubble (Worley cells, lightly coursed)
	const warp = vec2( mx_noise_float( st.mul( 1.3 ) ), mx_noise_float( st.mul( 1.3 ).add( 9.1 ) ) ).mul( vec2( 0.1, 0.05 ) );
	const p = st.add( warp ).div( vec2( len, rowH ) );
	const wv = mx_worley_noise_vec2( p );
	const edge = wv.y.sub( wv.x ).mul( rowH );
	const stoneMask = smoothstep( 0.008, 0.04, edge );
	const cid = mx_noise_float( p.mul( 0.9 ).add( 3.3 ) ).mul( 0.5 ).add( 0.5 ).mul( 0.6 ).add( hash( floor( p.x.add( floor( p.y ).mul( 0.5 ) ) ).add( floor( p.y ).mul( 17.0 ) ) ).mul( 0.4 ) );
	const n = mx_noise_float( st.mul( 7.0 ) ).mul( 0.5 ).add( 0.5 );
	let col = mix( color( tintA ), color( tintB ), cid.mul( 0.7 ).add( n.mul( 0.3 ) ) );
	col = mix( col, col.mul( vec3( 1.06, 1.0, 0.9 ) ), hash( cid.mul( 91.0 ) ).step( 0.7 ) );
	const gap = color( 0x2b2721 );
	// lichen and moss: patchy, stronger low on the wall and on top faces
	const mn = mx_fractal_noise_float( positionWorld.mul( 0.6 ), 3 ).mul( 0.5 ).add( 0.5 );
	const mossM = smoothstep( 0.55, 0.8, mn.add( normalWorld.y.clamp( 0, 1 ).mul( 0.35 ) ).add( smoothstep( 0.0, 1.2, st.y ).oneMinus().mul( 0.15 ) ) ).mul( moss );
	col = mix( col, mix( color( 0x4d5a2a ), color( 0x7c7e48 ), n ), mossM.mul( 0.65 ) );
	const far = aa( st, rowH * 0.02, rowH * 0.12 );
	const avg = mix( color( tintA ), color( tintB ), 0.5 ).mul( 0.72 );
	const farCol = mix( avg, mix( color( 0x4d5a2a ), color( 0x7c7e48 ), 0.5 ), mossM.mul( 0.6 ) );
	mat.colorNode = mix( mix( gap, col, mix( stoneMask, 1.0, far ) ), farCol, far );
	mat.roughnessNode = float( 0.92 );
	// pillowed stone faces
	const bumpH = smoothstep( 0.0, 0.07, edge ).mul( 0.8 ).add( n.mul( 0.25 ) );
	mat.normalNode = proceduralBump( bumpH, far.oneMinus().mul( 1.6 ) );
	void detailTex;
	return mat;
}

// Layered straw thatch, grey with age, mossy patches (reference roofs).
export function thatchMaterial( { base = 0x6a604c, light = 0x8e8266, mossy = 0.2 } = {} ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv(); // x around/along, y down-slope distance
	const course = fract( st.y.add( mx_noise_float( st.mul( vec2( 0.9, 0.4 ) ) ).mul( 0.18 ) ).div( 0.42 ) );
	const f1 = aa( st, 0.008, 0.03 ), f2 = aa( st, 0.003, 0.012 ), fc = aa( st, 0.02, 0.08 );
	const strands = mix( mx_noise_float( vec2( st.x.mul( 22.0 ), st.y.mul( 1.6 ) ) ).mul( 0.5 ).add( 0.5 ), 0.5, f1 );
	const strands2 = mix( mx_noise_float( vec2( st.x.mul( 55.0 ), st.y.mul( 3.0 ) ) ).mul( 0.5 ).add( 0.5 ), 0.5, f2 );
	const patch = mx_fractal_noise_float( positionWorld.mul( 0.35 ), 3 ).mul( 0.5 ).add( 0.5 );
	let col = mix( color( base ), color( light ), strands.mul( 0.6 ).add( strands2.mul( 0.4 ) ) );
	// course shadow line at the bottom of every layer
	col = col.mul( mix( smoothstep( 0.0, 0.2, course ).mul( 0.08 ).add( 0.92 ), 0.96, fc ) );
	// weathering: grey sun-bleached vs. dark damp
	col = mix( col, col.mul( vec3( 0.8, 0.82, 0.85 ) ).add( 0.03 ), smoothstep( 0.4, 0.7, patch ).mul( 0.5 ) );
	const mossM = smoothstep( 0.58, 0.78, patch.add( strands.mul( 0.15 ) ) ).mul( mossy );
	col = mix( col, mix( color( 0x4a5626 ), color( 0x6f7a36 ), strands ), mossM.mul( 0.75 ) );
	// thick, shadowed eave lip
	col = col.mul( mix( 0.45, 1.0, smoothstep( 0.0, 0.6, st.y ) ) );
	mat.colorNode = col;
	mat.roughnessNode = float( 0.97 );
	const bh = strands.mul( 0.5 ).add( strands2.mul( 0.25 ) ).add( smoothstep( 0.0, 0.3, course ).mul( 0.25 ) );
	mat.normalNode = proceduralBump( bh, fc.oneMinus().mul( 2.2 ) );
	return mat;
}

// Planks / timber. Grain runs along uv.y (posts) — plank seams across uv.x.
export function woodMaterial( { a = 0x4a3526, b = 0x755638, plank = 0.24, seams = true } = {} ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	const pid = floor( st.x.div( plank ) );
	const fg = aa( st, 0.01, 0.04 ), fs = aa( st, plank * 0.15, plank * 0.6 );
	const grain = mix( mx_noise_float( vec2( st.x.mul( 30.0 ), st.y.mul( 1.5 ) ).add( pid.mul( 7.0 ) ) ).mul( 0.5 ).add( 0.5 ), 0.5, fg );
	const knots = smoothstep( 0.75, 0.9, mx_noise_float( st.mul( 3.0 ).add( pid ) ).mul( 0.5 ).add( 0.5 ) );
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
	return mat;
}

// Woven cloth (market canopies, bunting, banners).
export function clothMaterial( { a = 0x8c2419, b = 0xb13a28 } = {} ) {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	const weave = mix( sin( st.x.mul( 260.0 ) ).mul( sin( st.y.mul( 260.0 ) ) ).mul( 0.5 ).add( 0.5 ), 0.5, aa( st, 0.002, 0.008 ) );
	const fade = mx_fractal_noise_float( positionWorld.mul( 0.8 ), 2 ).mul( 0.5 ).add( 0.5 );
	let col = mix( color( a ), color( b ), fade );
	col = col.mul( weave.mul( 0.08 ).add( 0.94 ) );
	// sun-faded, dusty edges
	col = mix( col, col.mul( 0.8 ).add( vec3( 0.06, 0.05, 0.04 ) ), smoothstep( 0.6, 0.9, fade ).mul( 0.4 ) );
	mat.colorNode = col;
	mat.roughnessNode = float( 0.95 );
	// thin cloth glows a little when back-lit
	mat.emissiveNode = col.mul( 0.04 );
	return mat;
}

// Woven wattle (hazel rods around stakes).
export function wattleMaterial() {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	const rod = fract( st.y.div( 0.06 ) );
	const weave = sin( st.x.mul( 14.0 ).add( floor( st.y.div( 0.06 ) ).mul( 3.14159 ) ) ).mul( 0.5 ).add( 0.5 );
	const far = aa( st, 0.01, 0.04 );
	const n = mx_noise_float( st.mul( vec2( 3.0, 40.0 ) ) ).mul( 0.5 ).add( 0.5 );
	let col = mix( color( 0x4e3c29 ), color( 0x86704e ), n.mul( 0.6 ).add( weave.mul( 0.4 ) ) );
	col = mix( col.mul( smoothstep( 0.0, 0.3, rod ).mul( smoothstep( 0.7, 1.0, rod ).oneMinus() ).mul( 0.5 ).add( 0.5 ) ), color( 0x655038 ), far );
	mat.colorNode = col;
	mat.roughnessNode = float( 0.9 );
	return mat;
}

// Wattle & daub (clay render), cream-brown.
export function daubMaterial() {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const st = uv();
	const n = mx_fractal_noise_float( st.mul( 2.5 ), 3 ).mul( 0.5 ).add( 0.5 );
	const cracks = smoothstep( 0.49, 0.5, mx_noise_float( st.mul( 6.0 ) ).mul( 0.5 ).add( 0.5 ) ).mul( 0.25 );
	mat.colorNode = mix( color( 0x8f7a5c ), color( 0xb4a07c ), n ).mul( cracks.oneMinus() ).mul( smoothstep( 0.0, 0.5, st.y ).mul( 0.25 ).add( 0.75 ) );
	mat.roughnessNode = float( 0.95 );
	mat.normalNode = proceduralBump( n.mul( 0.5 ), float( 0.8 ) );
	return mat;
}

// Mine interior: dark rock swallowing light with depth.
export function darkRockMaterial() {
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	const n = mx_fractal_noise_float( positionWorld.mul( 0.8 ), 3 ).mul( 0.5 ).add( 0.5 );
	mat.colorNode = mix( color( 0x221f1b ), color( 0x4a443b ), n );
	mat.roughnessNode = float( 0.95 );
	mat.normalNode = proceduralBump( n, float( 1.2 ) );
	return mat;
}

export function doorwayMaterial() {
	return new THREE.MeshBasicNodeMaterial( { color: 0x0b0906, side: THREE.DoubleSide } );
}

export function emberMaterial() {
	const mat = new THREE.MeshBasicNodeMaterial();
	const t = mx_noise_float( positionWorld.mul( 2.0 ).add( vec3( 0, 0, 0 ) ) ).mul( 0.5 ).add( 0.5 );
	mat.colorNode = mix( color( 0xff8a2a ), color( 0xffd27a ), t ).mul( 3.0 );
	return mat;
}

export function createBuildingMaterials() {
	return {
		stone: stoneMaterial( { tintA: 0x5d574c, tintB: 0x8f8574, moss: 0.25 } ),
		stoneDark: stoneMaterial( { tintA: 0x524d44, tintB: 0x7d7566, rowH: 0.34, len: 0.6, moss: 0.35 } ),
		fortStone: stoneMaterial( { tintA: 0x5e5a50, tintB: 0x8a8272, rowH: 0.45, len: 0.8, moss: 0.8 } ),
		thatch: thatchMaterial(),
		thatchGreen: thatchMaterial( { base: 0x5c5a40, light: 0x7c7856, mossy: 0.55 } ),
		wattle: wattleMaterial(),
		wood: woodMaterial(),
		woodPost: woodMaterial( { a: 0x3f2d20, b: 0x624631, plank: 10, seams: false } ),
		cloth: clothMaterial(),
		canvas: clothMaterial( { a: 0xbdb39b, b: 0xdcd3bd } ),
		daub: daubMaterial(),
		darkRock: darkRockMaterial(),
		doorway: doorwayMaterial(),
		ember: emberMaterial()
	};
}

export { Fn, texture, clamp, abs, max };
