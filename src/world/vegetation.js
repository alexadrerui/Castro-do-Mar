import * as THREE from 'three/webgpu';
import {
	Fn, attribute, uniform, positionLocal, positionWorld, normalWorld, time, vec3, float, color, mix, smoothstep,
	sin, dot, max, min, abs, sqrt, floor, fract, fwidth, dFdx, dFdy, log2, length, select, normalize, mx_noise_float, instanceIndex, hash, texture, uv, normalViewGeometry, faceDirection
} from 'three/tsl';
import { makeFoliageAtlas } from '../core/texgen.js';
import { ChunkedInstances } from '../core/chunked.js';
import { mineLedgeSpots } from './fort.js';
import { placeables, addPlaced } from './placed.js';
import { oakTree, pineTree, birchTree, shrubBush, bracken, deadTree, fallenLog, hollyBush, ivyGeometry, spruceTree, OAK_BARK, PINE_BARK } from './trees.js';
import { LeafAtlas } from './leafAtlas.js';
import { ImpostorAtlas } from './impostors.js';
import { cacheGet, cachePut, hashSources } from '../core/cache.js';
import srcLeafAtlas from './leafAtlas.js?raw';
import srcImpostors from './impostors.js?raw';
import srcTrees from './trees.js?raw';
import srcVegetation from './vegetation.js?raw';
import { makeSimplex, fbm, mulberry32, cellRand, smoothstep as ss } from '../core/noise.js';
import { pathDistance } from './heightfield.js';
import { NATURE, CH, erased, forPainted, texelSeed } from './natureEdits.js';
import { BUILDINGS, STALLS, PROPS, FORT, MINE, FIELDS, VILLAGE, MASK, TOWER, PATHS, HAMLETS, footprintR } from './layout.js';
import { cloudShade } from './cloudShadow.js';
import { entranceFootprint, ARCH } from './gate.js';
import { wind, windAmount, gustSoft } from './wind.js';

const nV = makeSimplex( 606 );

// ---------------------------------------------------------------------------
// TSL foliage material: per-instance tint (aTint), wind sway, fake
// translucency when back-lit by the sun, baked crown occlusion.
// ---------------------------------------------------------------------------
let ATLAS = null;
export function foliageAtlas() {
	if ( ! ATLAS ) {
		ATLAS = new THREE.CanvasTexture( makeFoliageAtlas() );
		ATLAS.colorSpace = THREE.NoColorSpace;
		ATLAS.generateMipmaps = true;
		ATLAS.minFilter = THREE.LinearMipmapLinearFilter;
		ATLAS.anisotropy = 4;
	}
	return ATLAS;
}

// clusters: the leaf-cluster atlas of leafAtlas.js (R coverage, G brightness, B per-leaf random)
// instead of the canvas atlas (A coverage, R luminance); fern: fronds of trees.js bracken() (aux.w
// = 2), the pinnae cut out from the frond uv (s along, t across the leaflet strip): 'only' for a
// material of fronds alone, true to tell them apart per vertex (one material, one pipeline, for
// the trees, shrubs, ferns and meadow flowers: the browser's shader cache is at its limit and
// every pipeline costs ~0.4 s of cold compile on a first visit); groundShift (terrain.js):
// every plant moved, whole, onto the ground its terrain chunk draws (the far coarse LODs cut below
// the crests, where the trees hung in the air)
export function createFoliageMaterial( sunDir, { clusters = null, fern = false, groundShift = null } = {} ) {
	const U = { wind: uniform( 1.0 ), sunDir: uniform( sunDir ) };
	// low specular: at grazing angles (fronds seen from below, the upright grass cards) the Fresnel
	// reflection of the bright sky washed the green out to grey / white
	const mat = new THREE.MeshPhysicalNodeMaterial( { side: THREE.DoubleSide, specularIntensity: 0.2 } );
	mat.alphaTest = 0.45;
	mat.alphaToCoverage = true;
	// aux.w: 1 a leaf card, 0 a solid part, -1 a thin opaque surface (meadowFlora.js petals and leaves:
	// no card texture, but the card's unflipped normal)
	const auxW = attribute( 'aux', 'vec4' ).w;
	const isFern = fern === 'only' ? float( 1 ) : fern ? auxW.greaterThan( 1.5 ).select( 1, 0 ) : float( 0 );
	const card = fern === 'only' ? float( 0 ) : auxW.min( 1 ).max( 0 ).mul( isFern.oneMinus() );
	const thin = fern === 'only' ? float( 0 ) : auxW.lessThan( - 0.5 ).select( 1, 0 );
	const tex = texture( clusters ?? foliageAtlas(), uv() );
	let cover = clusters ? tex.r : tex.a;
	if ( clusters ) {
		// pine needles (atlas tile 1, the uv quarter u > 0.5, v > 0.5): the mipmaps average the thin
		// needles down below the cut and the distant crowns vanished, leaving bare trunks; the
		// coverage is raised with the mip level instead
		const st = uv();
		const mip = max( log2( max( length( dFdx( st ) ), length( dFdy( st ) ) ).mul( 1024 ) ), 0 );
		cover = select( st.x.greaterThan( 0.5 ).and( st.y.greaterThan( 0.5 ) ), cover.mul( mip.mul( 0.4 ).add( 1 ) ), cover );
	}
	const aux = attribute( 'aux', 'vec4' );
	const leaf = aux.x, sway = aux.y, ao = aux.z;
	const baseCol = attribute( 'color', 'vec3' );
	const tint = attribute( 'aTint', 'vec3' );

	// wind: the world's (world/wind.js). The gust travelling across the map, read at the plant's anchor
	// (core/chunked.js iM3), leans it downwind as it passes, so a gust crosses the meadow and the wood
	// together; a smaller sway on its own phase rides on top, and the leaves flutter harder in a gust.
	// U.wind is this material's own amount (0 holds the plants still: tools/flicker.mjs), times the
	// shared calm (night) and storm (rain).
	const phase = hash( instanceIndex ).mul( 6.283 );
	mat.positionNode = Fn( () => {
		const p = positionLocal.toVar();
		const gust = gustSoft( attribute( 'iM3', 'vec4' ).xz );
		const w = sway.mul( U.wind ).mul( windAmount );
		const push = gust.mul( 0.75 ).add( 0.15 ).mul( 0.16 ).mul( w );
		p.x.addAssign( wind.dir.x.mul( push ) );
		p.z.addAssign( wind.dir.y.mul( push ) );
		const stir = w.mul( gust.add( 0.5 ) ).mul( wind.turb );
		p.x.addAssign( sin( time.mul( 1.7 ).add( phase ).add( p.y.mul( 0.4 ) ) ).mul( 0.07 ).mul( stir ) );
		p.z.addAssign( sin( time.mul( 1.3 ).add( phase.mul( 1.3 ) ).add( p.x.mul( 0.5 ) ) ).mul( 0.05 ).mul( stir ) );
		// leaf flutter
		p.addAssign( vec3( sin( time.mul( 7.0 ).add( p.y.mul( 3.0 ) ).add( phase ) ) ).mul( 0.02 ).mul( leaf ).mul( w ).mul( gust.mul( 0.8 ).add( 0.6 ) ).mul( wind.turb ) );
		// the instance's anchor (core/chunked.js iM3)
		if ( groundShift ) p.y.addAssign( groundShift( attribute( 'iM3', 'vec4' ).xz ) );
		return p;
	} )();

	const n = mx_noise_float( positionWorld.mul( 0.9 ) ).mul( 0.5 ).add( 0.5 ).toVertexStage();
	const nBig = mx_noise_float( positionWorld.mul( 0.25 ) ).mul( 0.5 ).add( 0.5 ).toVertexStage();
	// per-leaf brightness; with the clusters a slight per-leaf shift towards yellow-green
	const lum = clusters ? tex.g.mul( 1.4 ) : tex.r.mul( 1.35 ).add( 0.15 );
	const cardLum = mix( float( 1 ), lum, card );
	let leafCol = tint.mul( mix( 0.72, 1.18, n ) ).mul( mix( 0.85, 1.1, nBig ) ).mul( cardLum );
	// (cards only: the fronds keep their colour)
	if ( clusters ) leafCol = leafCol.mul( mix( vec3( 1 ), mix( vec3( 0.9, 0.95, 1.05 ), vec3( 1.1, 1.06, 0.85 ), tex.b ), card ) );
	mat.opacityNode = mix( float( 1 ), cover, card );
	// cards: cut empty texels before shading, and in the shadow pass
	mat.maskNode = card.lessThan( 0.5 ).or( cover.greaterThan( 0.2 ) );
	mat.maskShadowNode = card.lessThan( 0.5 ).or( cover.greaterThan( 0.45 ) );
	if ( fern ) {
		// Tidewater's fern pinnae (VegMaterials.js): rounded leaflets along the frond; sub-pixel
		// leaflets widen instead of aliasing (the fronds turn solid in the distance)
		const st = uv(), fs = st.x, ft = st.y;
		const fwS = fwidth( fs );
		const N = 24;
		const x = fs.mul( N );
		const k = floor( x );
		const fx = fract( x ).sub( 0.5 );
		const tt = ft.div( mix( 0.8, 1.0, hash( k.add( 7.1 ) ) ) );
		const hw = sqrt( max( tt.mul( tt ).oneMinus(), 0 ) ).mul( 0.36 );
		const hwE = max( hw, min( fwS.mul( N * 0.6 ), 0.5 ).mul( select( tt.lessThan( 1 ), 1, 0 ) ) );
		const pinna = abs( fx ).lessThan( hwE ).and( tt.lessThan( 1 ) ).and( fs.greaterThan( 0.3 ) );
		// rachis: a thin line along the frond, the whole strip on the bare stalk
		const frond = pinna.or( ft.lessThan( 0.06 ) ).or( fs.lessThan( 0.3 ).and( ft.lessThan( 0.5 ) ) );
		if ( fern === 'only' ) {
			mat.maskNode = frond;
			mat.maskShadowNode = frond;
			mat.opacityNode = float( 1 );
		} else {
			// per vertex: fronds (aux.w = 2) cut by their pinnae, the rest as above
			const f = isFern.greaterThan( 0.5 );
			mat.maskNode = f.and( frond ).or( f.not().and( mat.maskNode ) );
			mat.maskShadowNode = f.and( frond ).or( f.not().and( mat.maskShadowNode ) );
		}
	}
	const bark = baseCol.mul( mix( 0.75, 1.1, n ) );
	mat.colorNode = mix( bark, leafCol, leaf ).mul( mix( 0.55, 1.0, ao ) ).mul( cloudShade() );

	// fake subsurface: brighten foliage facing away from the sun (back-lit rims)
	const back = max( dot( normalWorld, normalize( U.sunDir ) ).negate(), 0.0 );
	mat.emissiveNode = leafCol.mul( back.mul( 0.08 ) ).mul( leaf ).mul( ao );
	mat.roughnessNode = mix( float( 0.9 ), float( 0.75 ), leaf );
	// both faces of the thin cards and fronds keep the same soft (bent-up / volumetric) normal:
	// DoubleSide would flip it on the back faces, and the undersides seen from below turned black;
	// solid parts (trunks and branches) keep the usual flip. The meadow flowers' thin petals and
	// leaves too: curled, they show both faces at once, and in the wind each facet that turned edge-on
	// flipped its normal, its light jumping between bright and dark from frame to frame (they flickered)
	mat.normalNode = fern === 'only' ? normalViewGeometry : normalViewGeometry.mul( select( card.add( thin ).add( isFern ).greaterThan( 0.5 ), float( 1 ), faceDirection ) );
	mat.userData.foliage = U; // QA (tools/flicker.mjs): wind 0 holds the plants still
	return { material: mat, uniforms: U };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------
export function sampleMask( mask, x, z ) {
	const { res, size, centerX, centerZ } = MASK;
	const u = ( x - ( centerX - size / 2 ) ) / size, v = ( z - ( centerZ - size / 2 ) ) / size;
	if ( u < 0 || v < 0 || u >= 1 || v >= 1 ) return [ 0, 0, 0 ];
	const i = Math.floor( u * res ), j = Math.floor( v * res );
	const k = ( j * res + i ) * 4;
	return [ mask[ k ] / 255, mask[ k + 1 ] / 255, mask[ k + 2 ] / 255 ];
}

// How much free space around (x,z) for vegetation (0 = forbidden, 1 = free).
// Lakes at their own level (world/lakeWater.js) keep their water clear of plants and rocks: set by
// main.js once the lakes are filled (none in the worker).
let lakeTest = null;
export function setLakeTest( fn ) { lakeTest = fn; }
export const inLake = ( x, z ) => !! lakeTest && lakeTest( x, z );

// Ground radius of a stall or prop (m), before the clearance's margin.
// the spruce's instances are built in the editor, or when the world edits hold a placed one
const SPRUCE_WANTED = ( app ) => new URLSearchParams( location.search ).has( 'edit' ) || ( app.worldEdits?.added ?? [] ).some( ( a ) => a?.kind === 'plant' && a.species === 'spruce' );
const PROP_R = { well: 1.0, cart: 1.6, rack: 1.9, skep: 0.45, wood: 0.8, gate: 9.5, arch: 2.8, ruin: 5.5 };
const propR = ( p ) => ( p.type === 'pen' ? Math.hypot( p.w || 6, p.d || 5 ) / 2 : p.type === 'hay' ? p.r || 1.2 : PROP_R[ p.type ] ?? 1.5 ) * ( p.scale || 1 );
let editedList = null;

// The objects added or moved in the object editor (world/worldEdits.js `edited`): stalls and props
// have no pad and no trampled ground, so only this keeps trees and rocks off them, and a house
// added away from the village is past the distance the village clearance is tested at. Without
// edits the list is empty and the world comes out as before. 0 = forbidden, 1 = free.
export function editedClearance( x, z, pad = 0 ) {
	if ( ! editedList ) {
		editedList = [];
		for ( const b of BUILDINGS ) if ( b.edited ) editedList.push( [ b.x, b.z, footprintR( b, 0.62 ) + 1.8 ] );
		for ( const s of STALLS ) if ( s.edited && ! s.removed ) editedList.push( [ s[ 0 ], s[ 1 ], 3.2 * ( s.scale || 1 ) + 1.2 ] );
		for ( const p of PROPS ) if ( p.edited ) editedList.push( [ p.x, p.z, propR( p ) + 1.2 ] );
	}
	for ( const [ ox, oz, r ] of editedList ) if ( Math.hypot( x - ox, z - oz ) < r + pad ) return 0;
	return 1;
}

// the entrances (layout.js PROPS 'gate' / 'arch', world/gate.js): their frame, side poles and walls, also where
// the object editor never touched them (they stand outside the houses' clearance)
let gatePts = null;
export function gateClearance( x, z, pad = 0 ) {
	gatePts ??= PROPS.filter( ( p ) => ( p.type === 'gate' || p.type === 'arch' ) && ! p.removed ).flatMap( entranceFootprint );
	for ( const [ gx, gz ] of gatePts ) if ( Math.hypot( x - gx, z - gz ) < 1.6 + pad ) return 0;
	return 1;
}

export function clearance( x, z, mask, pad = 0 ) {
	if ( editedClearance( x, z, pad ) <= 0 ) return 0;
	if ( gateClearance( x, z, pad ) <= 0 ) return 0;
	const [ path, dirt, field ] = sampleMask( mask, x, z );
	if ( path > 0.05 || field > 0.2 ) return 0;
	let free = 1 - ss( 0.3, 0.8, dirt );
	for ( const b of BUILDINGS ) {
		const r = footprintR( b, 0.62 ) + ( b.awning ? 3.8 : 1.8 ) + pad; // an awning reaches ~3.6 m out
		const d = Math.hypot( x - b.x, z - b.z );
		if ( d < r ) return 0;
	}
	if ( Math.hypot( x - FORT.x, z - FORT.z ) < FORT.radius + 5 + pad ) return 0;
	{
		const dx = x - MINE.x, dz = z - MINE.z;
		const a = Math.abs( dx * MINE.tx + dz * MINE.tz ), bb = Math.abs( dx * MINE.nx + dz * MINE.nz );
		if ( a < MINE.width / 2 + 3 && bb < MINE.depth / 2 + 3 ) return 0;
		if ( Math.hypot( x - MINE.yardX, z - MINE.yardZ ) < 16 ) return 0;
	}
	if ( Math.hypot( x - TOWER.x, z - TOWER.z ) < 6 ) return 0;
	for ( const f of FIELDS ) {
		const c = Math.cos( f.rot ), s = Math.sin( f.rot );
		const lx = ( x - f.x ) * c - ( z - f.z ) * s, lz = ( x - f.x ) * s + ( z - f.z ) * c;
		if ( Math.abs( lx ) < f.w / 2 + 2 && Math.abs( lz ) < f.l / 2 + 2 ) return 0;
	}
	const p = pathDistance( x, z );
	if ( p.d < p.w + 1.2 + pad ) return 0;
	return free;
}

// shadowDistance > 0: the tiles cast shadows wherever they reach into the sun's box (core/chunked.js
// shadowSphere, placed by world/sunShadows.js); 0 never
export const SHADOW_REACH = 1;

export async function createVegetation( app, progress ) {
	const { hf, mask } = app;
	const sunDir = app.sky.state.lightDir; // the sun, the moon at night (sky.js)
	const group = new THREE.Group();
	group.name = 'vegetation';

	const groundShift = app.terrain.groundShift;
	// GPU bakes: the leaf-cluster atlas (Tidewater's; tile 1 the pine needles) and the octahedral
	// impostors of the far oaks / pines; after the first load read from the IndexedDB cache
	const oakHi = oakTree( 0, 11 ), pineHi = pineTree( 0, 12 );
	const leafAtlas = new LeafAtlas();
	const oakAtlas = new ImpostorAtlas( oakHi ), pineAtlas = new ImpostorAtlas( pineHi );
	const bakeKey = 'bakes:' + hashSources( srcLeafAtlas, srcImpostors, srcTrees, srcVegetation, THREE.REVISION );
	const cached = await cacheGet( bakeKey );
	if ( cached ) {
		leafAtlas.load( cached.leaf );
		oakAtlas.load( cached.oak ); pineAtlas.load( cached.pine );
		console.info( 'bakes: from cache', bakeKey );
	} else {
		const r = app.renderer, t0 = performance.now();
		leafAtlas.bake( r );
		oakAtlas.bake( r, leafAtlas.texture ); pineAtlas.bake( r, leafAtlas.texture );
		console.info( 'bakes: done in', Math.round( performance.now() - t0 ), 'ms' );
		Promise.all( [ leafAtlas.read( r ), oakAtlas.read( r ), pineAtlas.read( r ) ] )
			.then( ( [ leaf, oak, pine ] ) => cachePut( bakeKey, { leaf, oak, pine }, 'bakes:' ) )
			.then( () => console.info( 'bakes: cached', bakeKey ) );
	}
	// one material for every plant (trees, shrubs, bracken, the meadow flowers of meadowFlora.js):
	// the flowers draw their vertex colour (no card), the fronds are told apart per vertex
	const { material: canopy } = createFoliageMaterial( sunDir, { clusters: leafAtlas.texture, fern: true, groundShift } );
	app.canopyMaterial = app.fernMaterial = app.foliageMaterial = canopy;
	const fernMat = canopy;
	const oakImpostor = oakAtlas.createMaterial( { bark: OAK_BARK, groundShift } );
	const pineImpostor = pineAtlas.createMaterial( { bark: PINE_BARK, groundShift } );
	app.oakImpostors = oakAtlas;
	app.pineImpostors = pineAtlas;
	const species = {
		oak: new ChunkedInstances( { name: 'oak', hi: oakHi, lo: oakTree( 1, 11 ), material: canopy, tile: 260, lodDistance: 150, shadowDistance: SHADOW_REACH, impostor: oakImpostor, impostorDistance: 320 } ),
		pine: new ChunkedInstances( { name: 'pine', hi: pineHi, lo: pineTree( 1, 12 ), material: canopy, tile: 260, lodDistance: 150, shadowDistance: SHADOW_REACH, impostor: pineImpostor, impostorDistance: 320 } ),
		// no impostor: the birches are few (~2.5% of the trees) and their lo LOD is cheap far away (520 m tiles: sparse, fewer draw calls); one
		// bake less at the load and 3 pipelines less (the browser's shader cache is at its limit)
		birch: new ChunkedInstances( { name: 'birch', hi: birchTree( 0, 13 ), lo: birchTree( 1, 13 ), material: canopy, tile: 520, lodDistance: 150, shadowDistance: SHADOW_REACH } ),
		bush: new ChunkedInstances( { name: 'bush', hi: shrubBush( 0, 14 ), lo: shrubBush( 1, 14 ), material: canopy, tile: 260, lodDistance: 110, shadowDistance: 0, castShadow: false, layer: 1, reflect: false } ),
		fern: new ChunkedInstances( { name: 'fern', hi: bracken( 0, 15 ), lo: bracken( 1, 15 ), material: fernMat, tile: 260, lodDistance: 90, shadowDistance: 0, castShadow: false, layer: 1, reflect: false, maxDistance: 260 } ),
		// the woodland floor after the offroad forest (trees.js): snags, fallen logs, holly; same
		// material and vertex layout as the rest (no new shader). Sparse (a few hundred over the map):
		// 780 m tiles, or each plant stood nearly in a tile of its own and cost a draw call per pass
		// (83 calls in the panorama, ~10% of the frame's; the CPU, not the GPU, sets the frame time)
		snag: new ChunkedInstances( { name: 'snag', hi: deadTree( 0, 41 ), lo: deadTree( 1, 41 ), material: canopy, tile: 780, lodDistance: 150, shadowDistance: SHADOW_REACH } ),
		log: new ChunkedInstances( { name: 'log', hi: fallenLog( 0, 51 ), lo: fallenLog( 1, 51 ), material: canopy, tile: 780, lodDistance: 70, shadowDistance: SHADOW_REACH, layer: 1, reflect: false, maxDistance: 320 } ),
		holly: new ChunkedInstances( { name: 'holly', hi: hollyBush( 0, 61 ), lo: hollyBush( 1, 61 ), material: canopy, tile: 780, lodDistance: 110, shadowDistance: 0, castShadow: false, layer: 1, reflect: false } ),
		// the ivy on the rustic archways (world/gate.js), one per arch on its frame
		ivy: new ChunkedInstances( { name: 'ivy', hi: ivyGeometry( 0, 71, ARCH.half, ARCH.beamY ), lo: ivyGeometry( 1, 71, ARCH.half, ARCH.beamY ), material: canopy, tile: 260, lodDistance: 90, shadowDistance: SHADOW_REACH, layer: 1, reflect: false, maxDistance: 400 } ),
		// the spruce (offroad's, trees.js): never scattered, only placed by hand from the editor's library
		// (world/placed.js); built only in the editor or when one was placed (same material and layout:
		// no new shader either way)
		...( SPRUCE_WANTED( app ) ? { spruce: new ChunkedInstances( { name: 'spruce', hi: spruceTree( 0, 81 ), lo: spruceTree( 1, 81 ), material: canopy, tile: 780, lodDistance: 150, shadowDistance: SHADOW_REACH } ) } : {} )
	};
	for ( const s of Object.values( species ) ) s.addAttribute( 'aTint', 3 );

	const PAL = {
		oak: [ 0x3d4f24, 0x4b5f2b, 0x5b6b2e, 0x455a27 ],
		pine: [ 0x2f4424, 0x37502a, 0x2a3e20, 0x40582e ],
		birch: [ 0x5f7231, 0x6b7c36, 0x76833c, 0x5a6a2f ],
		bush: [ 0x34482a, 0x3c5026, 0x48562a, 0x303f22 ], // gorse / broom: dark, dense greens
		fern: [ 0x506a26, 0x5c722a, 0x4a6224, 0x6a7230 ], // bracken: fresh green, some yellowing
		holly: [ 0x22341c, 0x283a1e, 0x1f3020, 0x2c3f22 ], // holly: very dark, glossy greens
		ivy: [ 0x416c2b ], // ivy: deep green (lighter than the holly: it hangs in the open)
		spruce: [ 0x253a22, 0x2b4126, 0x21341f, 0x2f4429 ], // spruce: dark, bluish greens
		snag: [ 0x808080 ], log: [ 0x808080 ] // bark only (the tint colours leaves)
	};
	const tmpC = new THREE.Color();
	const tint = ( sp, rnd ) => {
		const pal = PAL[ sp ];
		tmpC.set( pal[ Math.floor( rnd() * pal.length ) ] ); // hex is sRGB: set() already converts to linear
		const v = 0.9 + rnd() * 0.2;
		return [ tmpC.r * v, tmpC.g * v, tmpC.b * v ];
	};

	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
	const up = new THREE.Vector3( 0, 1, 0 ), nrm = new THREE.Vector3();
	const rnd = mulberry32( 890 );
	// hand-painted nature (world/natureEdits.js): erased plants still use up their random draws
	// (the rest of the scatter stays the same), painted ones come from a sequence of their own
	const nature = app.natureEdits;
	// y: a given height (the cliff's ledges) instead of the relief's, standing upright
	const place = ( sp, x, z, s, tilt = 0.08, R = rnd, y0 ) => {
		const y = y0 ?? hf.heightAt( x, z );
		if ( y0 === undefined ) hf.normalAt( x, z, nrm ); else nrm.copy( up );
		q.setFromUnitVectors( up, nrm.lerp( up, 1 - tilt ).normalize() );
		q.multiply( new THREE.Quaternion().setFromAxisAngle( up, R() * Math.PI * 2 ) );
		pos.set( x, y - 0.25 * s, z );
		sc.set( s * ( 0.9 + R() * 0.2 ), s * ( 0.85 + R() * 0.3 ), s * ( 0.9 + R() * 0.2 ) );
		m.compose( pos, q, sc );
		const kind = sp === 'gold' ? 'birch' : sp;
		const extra = [ sp === 'gold' ? [ 0.47, 0.32, 0.045 ] : tint( sp, R ) ];
		if ( ( R === rnd || R.cell ) && nature && erased( nature, CH[ kind ], x, z ) ) return false;
		species[ kind ].add_( m, extra );
		return true;
	};

	// Jittered-grid scatter over the whole terrain, each cell with its own random sequence (cellRand).
	const step = 9;
	const x0 = hf.x0 + 10, x1 = hf.x0 + hf.size - 10, z0 = hf.z0 + 10, z1 = hf.z0 + hf.size - 10;
	let counts = { oak: 0, pine: 0, birch: 0, bush: 0, fern: 0, snag: 0, log: 0, holly: 0 };
	// the scatter's trees, for the woodland floor below: [ x, z, species ]
	const woods = [];
	// understory: bracken in the woodland patches and the lowlands, gorse / broom on the high open hills
	const shrub = ( x, z, s, patch, h, R ) => {
		const fernP = ( 0.25 + 0.45 * patch ) * ( 1 - ss( 90, 220, h ) );
		if ( R() < fernP ) { if ( place( 'fern', x, z, 0.8 + R() * 0.5, 0.3, R ) ) counts.fern ++; } else if ( place( 'bush', x, z, s, 0.5, R ) ) counts.bush ++;
	};
	for ( let z = z0, j = 0; z < z1; z += step, j ++ ) {
		for ( let x = x0, i = 0; x < x1; x += step, i ++ ) {
			const R = cellRand( i, j, 890 );
			const px = x + ( R() - 0.5 ) * step, pz = z + ( R() - 0.5 ) * step;
			const h = hf.heightAt( px, pz );
			if ( h < 1.6 || h > 430 || inLake( px, pz ) ) continue;
			const slope = hf.slopeAt( px, pz );
			if ( slope > 0.95 ) continue;
			const distV = Math.hypot( px - VILLAGE.x, pz - VILLAGE.z );
			// woodland patches: noise field, denser in hollows, thinner on high rock
			const f = fbm( nV, px * 0.006, pz * 0.006, 4 );
			const patch = ss( - 0.15, 0.35, f );
			const altitude = 1 - ss( 180, 420, h );
			const steep = 1 - ss( 0.45, 0.95, slope );
			let dens = patch * altitude * steep;
			const nearVillage = distV < 170;
			if ( nearVillage ) dens *= 0.6; // village: trees between the houses
			const c = distV < 360 ? clearance( px, pz, app.mask ) : editedClearance( px, pz );
			if ( c <= 0 ) continue;
			dens *= c;
			const r = R();
			if ( r < dens * 0.72 ) {
				// tree: pines higher up & on islands/coast, oaks on the lowlands
				const pinePref = ss( 40, 140, h ) * 0.6 + ( h < 30 && distV > 250 ? 0.5 : 0 ) + 0.2;
				const pick = R();
				let sp;
				if ( pick < pinePref ) sp = 'pine';
				else if ( pick < pinePref + 0.025 ) sp = 'birch';
				else sp = 'oak';
				// the hamlets' core is open around the track: birches only (the third reference)
				if ( sp !== 'birch' && HAMLETS.some( ( hm ) => Math.hypot( px - hm.x, pz - hm.z ) < hm.r * 0.5 ) ) sp = 'birch';
				const s = ( sp === 'pine' ? 0.6 + R() * 0.8 : 0.7 + R() * 0.6 ) * ( 1 - 0.3 * ss( 200, 420, h ) );
				if ( place( sp, px, pz, s, 0.08, R ) ) { counts[ sp ] ++; woods.push( [ px, pz, sp ] ); }
			} else if ( r < dens * 0.72 + ( 0.3 + 0.5 * patch ) * steep * altitude * c * 0.9 ) {
				shrub( px, pz, 0.6 + R() * 0.9, patch, h, R );
			}
			// extra shrub clumps (gorse / broom / bracken) on the open hills
			if ( ! nearVillage && h > 3 && R() < 0.9 * steep * altitude ) {
				for ( let k = 0; k < 2; k ++ ) {
					// off the cell's centre: their own clearance test (they stood on the tracks)
					const sx = px + ( R() - 0.5 ) * step, sz = pz + ( R() - 0.5 ) * step, ss_ = 0.5 + R() * 0.8;
					if ( ( distV < 360 ? clearance( sx, sz, app.mask ) : editedClearance( sx, sz ) ) <= 0 || inLake( sx, sz ) ) continue;
					shrub( sx, sz, ss_, patch, h, R );
				}
			}
		}
		progress?.( ( z - z0 ) / ( z1 - z0 ) * 0.9 );
	}

	// Hand-placed village trees (from the references: yellow tree near the
	// fort's north-west, a few oaks between the houses).
	const featured = [
		[ 'gold', 10, - 44, 1.15 ], [ 'gold', 16, - 24, 1.05 ], [ 'oak', - 52, - 44, 1.1 ], [ 'oak', - 80, 18, 1.2 ],
		[ 'oak', 8, 58, 1.0 ], [ 'oak', - 28, 50, 0.9 ], [ 'pine', 55, - 55, 1.0 ], [ 'oak', 30, 58, 0.95 ],
		[ 'gold', - 62, 58, 0.9 ], [ 'oak', 72, 22, 0.9 ], [ 'pine', - 95, - 40, 1.1 ], [ 'oak', - 5, 30, 0.8 ]
	];
	// a featured tree standing on a track or a pad (the layout moved under it) goes to the nearest free spot
	const freeSpot = ( x, z ) => {
		for ( let r = 0; r <= 12; r += 1 ) for ( let k = 0, n = Math.max( 1, r * 3 ); k < n; k ++ ) {
			const a = k / n * Math.PI * 2, fx = x + Math.cos( a ) * r, fz = z + Math.sin( a ) * r;
			if ( clearance( fx, fz, app.mask, 1 ) > 0 ) return [ fx, fz ];
		}
		return null;
	};
	for ( const [ sp, x, z, s ] of featured ) {
		const f = freeSpot( x, z );
		if ( f && place( sp, f[ 0 ], f[ 1 ], s ) ) counts[ sp === 'gold' ? 'birch' : sp ] ++;
	}
	// the hamlets (layout.js HAMLETS, the third reference): young birches lining the track beyond its
	// fences, and birches among the trees around; their own random sequence
	{
		const R = mulberry32( 5454 );
		const ok = ( x, z ) => clearance( x, z, app.mask, 0.6 ) > 0 && ! inLake( x, z );
		for ( const hm of HAMLETS ) {
			for ( const p of PATHS ) for ( let i = 1; i < p.pts.length; i ++ ) {
				const [ ax, az ] = p.pts[ i - 1 ], [ bx, bz ] = p.pts[ i ];
				const L = Math.hypot( bx - ax, bz - az ), tx = ( bx - ax ) / L, tz = ( bz - az ) / L;
				for ( let t = 0; t < L; t += 3.2 ) {
					const cx = ax + tx * t, cz = az + tz * t;
					if ( Math.hypot( cx - hm.x, cz - hm.z ) > hm.r * 0.9 ) continue;
					for ( const side of [ - 1, 1 ] ) {
						if ( R() > 0.6 ) continue;
						const o = p.w * 0.6 + 1.7 + R() * 2.4, j = ( R() - 0.5 ) * 2;
						const x = cx - tz * o * side + tx * j, z = cz + tx * o * side + tz * j;
						const sc = 0.3 + R() * 0.3;
						if ( ok( x, z ) && place( 'birch', x, z, sc, 0.08, R ) ) counts.birch ++;
					}
				}
			}
			for ( let k = 0; k < 70; k ++ ) {
				const a = R() * Math.PI * 2, d = Math.sqrt( R() ) * hm.r, x = hm.x + Math.cos( a ) * d, z = hm.z + Math.sin( a ) * d;
				const sc = 0.5 + R() * 0.55;
				if ( pathDistance( x, z ).d < 6 || ! ok( x, z ) ) continue;
				if ( place( 'birch', x, z, sc, 0.08, R ) ) counts.birch ++;
			}
		}
	}
	// Woodland floor (after the offroad forest): around the scatter's trees, a few dead trees, fallen
	// logs and holly under the oaks; a random sequence of its own (the rest of the world unchanged).
	// The nature brush's erasing reads the oak channel for snags and logs, the gorse one for holly.
	{
		const R = mulberry32( 4141 );
		const ok = ( x, z, pad ) => ( Math.hypot( x - VILLAGE.x, z - VILLAGE.z ) < 360 ? clearance( x, z, app.mask, pad ) : editedClearance( x, z, pad ) ) > 0 && ! inLake( x, z ) && hf.heightAt( x, z ) > 2 && hf.slopeAt( x, z ) < 0.75;
		const near = ( x, z, d0, d1 ) => {
			const a = R() * Math.PI * 2, d = d0 + R() * ( d1 - d0 );
			return [ x + Math.cos( a ) * d, z + Math.sin( a ) * d ];
		};
		const eul = new THREE.Euler(), lq = new THREE.Quaternion();
		const placeLog = ( x, z ) => {
			const len = 0.7 + R() * 0.7, rad = 0.6 + R() * 0.7, yaw = R() * Math.PI * 2;
			const hx = Math.cos( yaw ) * 3 * len, hz = - Math.sin( yaw ) * 3 * len; // the log lies along its local +x
			for ( const f of [ - 1, 1 ] ) if ( ! ok( x + hx * f, z + hz * f, 0.3 ) ) return false;
			const h0 = hf.heightAt( x - hx, z - hz ), h1 = hf.heightAt( x + hx, z + hz ), hm = hf.heightAt( x, z );
			if ( Math.abs( h1 - h0 ) > 6 * len * 0.4 ) return false;
			if ( nature && erased( nature, CH.oak, x, z ) ) return false;
			const r = 0.34 * rad;
			eul.set( 0, yaw, Math.atan2( h1 - h0, 6 * len ), 'YZX' );
			lq.setFromEuler( eul );
			pos.set( x, Math.max( ( h0 + h1 ) / 2, hm ) + r * 0.7, z );
			sc.set( len, rad, rad );
			m.compose( pos, lq, sc );
			species.log.add_( m, [ tint( 'log', R ) ] );
			return true;
		};
		for ( const [ x, z, sp ] of woods ) {
			const r = R();
			if ( r < 0.035 ) {
				const [ sx, sz ] = near( x, z, 4, 9 );
				if ( ok( sx, sz, 1 ) && ! ( nature && erased( nature, CH.oak, sx, sz ) ) && place( 'snag', sx, sz, 0.9 + R() * 0.5, 0.06, R ) ) counts.snag ++;
			} else if ( r < 0.13 ) {
				const [ lx, lz ] = near( x, z, 2.5, 6.5 );
				if ( placeLog( lx, lz ) ) counts.log ++;
			}
			// holly under the oaks (the Galician fragas)
			if ( sp === 'oak' && R() < 0.16 ) {
				const [ hx, hz ] = near( x, z, 2.5, 5.5 );
				if ( ok( hx, hz, 0 ) && ! ( nature && erased( nature, CH.bush, hx, hz ) ) && place( 'holly', hx, hz, 0.6 + R() * 0.7, 0.3, R ) ) counts.holly ++;
			}
		}
	}

	// the ivy of the rustic archways, on each arch's frame (the arch stands on the ground at its middle)
	for ( const p of PROPS ) if ( p.type === 'arch' && ! p.removed ) {
		q.setFromAxisAngle( up, p.rot || 0 );
		pos.set( p.x, hf.heightAt( p.x, p.z ), p.z );
		sc.setScalar( p.scale || 1 );
		m.compose( pos, q, sc );
		species.ivy.add_( m, [ tint( 'ivy', mulberry32( 9191 ) ) ] );
	}

	// gorse and bracken on the ledges of the mine cliff (world/fort.js), with their own random sequence
	const lrnd = mulberry32( 3131 );
	for ( const p of mineLedgeSpots() ) if ( place( p.kind, p.x, p.z, p.s, 0.3, lrnd, p.y ) ) counts[ p.kind ] ++;

	// painted plants: per texel ( NATURE.cell m ) up to `per` plants at full density, each texel with
	// its own random sequence (texelSeed)
	if ( nature ) {
		for ( const [ sp, per, s0, s1, tilt ] of [ [ 'oak', 0.35, 0.7, 1.3, 0.08 ], [ 'pine', 0.35, 0.6, 1.4, 0.08 ], [ 'birch', 0.3, 0.7, 1.3, 0.08 ], [ 'bush', 1.0, 0.5, 1.4, 0.5 ], [ 'fern', 1.3, 0.8, 1.3, 0.3 ] ] ) {
			forPainted( nature, CH[ sp ], ( tx, tz, v, i, j ) => {
				const prnd = mulberry32( texelSeed( i, j, CH[ sp ], 4242 ) );
				for ( let n = v * per; n > 0; n -= 1 ) {
					if ( prnd() >= Math.min( 1, n ) ) continue;
					const x = tx + prnd() * NATURE.cell, z = tz + prnd() * NATURE.cell;
					const h = hf.heightAt( x, z );
					if ( h < 1.2 || hf.slopeAt( x, z ) > 1.1 || inLake( x, z ) ) continue;
					if ( ( Math.hypot( x - VILLAGE.x, z - VILLAGE.z ) < 380 ? clearance( x, z, app.mask ) : editedClearance( x, z ) ) <= 0 ) continue;
					if ( place( sp, x, z, s0 + prnd() * ( s1 - s0 ), tilt, prnd ) ) counts[ sp ] ++;
				}
			} );
		}
	}

	// hand-placed ones (the object editor's library, world/placed.js): what each is drawn with, then the
	// saved ones into the instances (in the editor they are groups of their own instead)
	const placedKeys = [];
	for ( const sp of [ 'oak', 'pine', 'birch', 'gold', 'snag', 'log', 'holly', 'bush', 'fern', ...( species.spruce ? [ 'spruce' ] : [] ) ] ) {
		placedKeys.push( 'plant:' + sp );
		placeables[ 'plant:' + sp ] = {
			chunk: species[ sp === 'gold' ? 'birch' : sp ],
			tint: ( seed ) => sp === 'gold' ? [ 0.47, 0.32, 0.045 ] : tint( sp, mulberry32( seed ) ),
			lift: ( s ) => sp === 'log' ? 0.24 * s : - 0.25 * s // the log lies on the ground; the rest stand sunk a little
		};
	}
	addPlaced( app, placedKeys );

	for ( const s of Object.values( species ) ) { s.build(); group.add( s ); }
	app.onFrame.push( () => { for ( const s of Object.values( species ) ) s.update( app.camera ); } );
	progress?.( 1 );
	group.userData.counts = counts;
	return group;
}
