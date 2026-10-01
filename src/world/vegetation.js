import * as THREE from 'three/webgpu';
import {
	Fn, attribute, uniform, positionLocal, positionWorld, normalWorld, time, vec3, float, color, mix, smoothstep,
	sin, dot, max, min, abs, sqrt, floor, fract, fwidth, dFdx, dFdy, log2, length, select, normalize, mx_noise_float, instanceIndex, hash, texture, uv, normalViewGeometry, faceDirection
} from 'three/tsl';
import { makeFoliageAtlas } from '../core/texgen.js';
import { ChunkedInstances } from '../core/chunked.js';
import { birchGeometry } from './plants.js';
import { oakTree, pineTree, shrubBush, bracken, OAK_BARK, PINE_BARK } from './trees.js';
import { LeafAtlas } from './leafAtlas.js';
import { ImpostorAtlas } from './impostors.js';
import { cacheGet, cachePut, hashSources } from '../core/cache.js';
import srcLeafAtlas from './leafAtlas.js?raw';
import srcImpostors from './impostors.js?raw';
import srcTrees from './trees.js?raw';
import srcVegetation from './vegetation.js?raw';
import { makeSimplex, fbm, mulberry32, smoothstep as ss } from '../core/noise.js';
import { pathDistance } from './heightfield.js';
import { NATURE, CH, erased, forPainted, texelSeed } from './natureEdits.js';
import { BUILDINGS, FORT, MINE, FIELDS, VILLAGE, MASK, TOWER, footprintR } from './layout.js';

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
// instead of the canvas atlas (A coverage, R luminance); fern: fronds of trees.js bracken(), the
// pinnae cut out from the frond uv (s along, t across the leaflet strip)
export function createFoliageMaterial( sunDir, { clusters = null, fern = false } = {} ) {
	const U = { wind: uniform( 1.0 ), sunDir: uniform( sunDir ) };
	// low specular: at grazing angles (fronds seen from below, the upright grass cards) the Fresnel
	// reflection of the bright sky washed the green out to grey / white
	const mat = new THREE.MeshPhysicalNodeMaterial( { side: THREE.DoubleSide, specularIntensity: 0.2 } );
	mat.alphaTest = 0.45;
	mat.alphaToCoverage = true;
	const card = fern ? float( 0 ) : attribute( 'aux', 'vec4' ).w;
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

	// wind: gusts travel across the world, phase per instance
	const phase = hash( instanceIndex ).mul( 6.283 );
	mat.positionNode = Fn( () => {
		const p = positionLocal.toVar();
		const gust = sin( time.mul( 0.6 ).add( phase ) ).mul( 0.5 ).add( 0.5 );
		const w = sway.mul( U.wind ).mul( gust.mul( 0.6 ).add( 0.4 ) );
		p.x.addAssign( sin( time.mul( 1.7 ).add( phase ).add( p.y.mul( 0.4 ) ) ).mul( 0.12 ).mul( w ) );
		p.z.addAssign( sin( time.mul( 1.3 ).add( phase.mul( 1.3 ) ).add( p.x.mul( 0.5 ) ) ).mul( 0.09 ).mul( w ) );
		// leaf flutter
		p.addAssign( vec3( sin( time.mul( 7.0 ).add( p.y.mul( 3.0 ) ).add( phase ) ) ).mul( 0.02 ).mul( leaf ).mul( w ) );
		return p;
	} )();

	const n = mx_noise_float( positionWorld.mul( 0.9 ) ).mul( 0.5 ).add( 0.5 ).toVertexStage();
	const nBig = mx_noise_float( positionWorld.mul( 0.25 ) ).mul( 0.5 ).add( 0.5 ).toVertexStage();
	// per-leaf brightness; with the clusters a slight per-leaf shift towards yellow-green
	const lum = clusters ? tex.g.mul( 1.4 ) : tex.r.mul( 1.35 ).add( 0.15 );
	const cardLum = mix( float( 1 ), lum, card );
	let leafCol = tint.mul( mix( 0.72, 1.18, n ) ).mul( mix( 0.85, 1.1, nBig ) ).mul( cardLum );
	if ( clusters ) leafCol = leafCol.mul( mix( vec3( 0.9, 0.95, 1.05 ), vec3( 1.1, 1.06, 0.85 ), tex.b.mul( card ) ) );
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
		mat.maskNode = pinna.or( ft.lessThan( 0.06 ) ).or( fs.lessThan( 0.3 ).and( ft.lessThan( 0.5 ) ) );
		mat.maskShadowNode = mat.maskNode;
		mat.opacityNode = float( 1 );
	}
	const bark = baseCol.mul( mix( 0.75, 1.1, n ) );
	mat.colorNode = mix( bark, leafCol, leaf ).mul( mix( 0.55, 1.0, ao ) );

	// fake subsurface: brighten foliage facing away from the sun (back-lit rims)
	const back = max( dot( normalWorld, normalize( U.sunDir ) ).negate(), 0.0 );
	mat.emissiveNode = leafCol.mul( back.mul( 0.08 ) ).mul( leaf ).mul( ao );
	mat.roughnessNode = mix( float( 0.9 ), float( 0.75 ), leaf );
	// both faces of the thin cards and fronds keep the same soft (bent-up / volumetric) normal:
	// DoubleSide would flip it on the back faces, and the undersides seen from below turned black;
	// solid parts (trunks and branches) keep the usual flip
	mat.normalNode = fern ? normalViewGeometry : normalViewGeometry.mul( select( card.greaterThan( 0.5 ), float( 1 ), faceDirection ) );
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

export function clearance( x, z, mask, pad = 0 ) {
	const [ path, dirt, field ] = sampleMask( mask, x, z );
	if ( path > 0.05 || field > 0.2 ) return 0;
	let free = 1 - ss( 0.3, 0.8, dirt );
	for ( const b of BUILDINGS ) {
		const r = footprintR( b, 0.62 ) + 1.8 + pad;
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

export async function createVegetation( app, progress ) {
	const { hf, mask } = app;
	const sunDir = app.sky.state.sunDir;
	const group = new THREE.Group();
	group.name = 'vegetation';

	const { material } = createFoliageMaterial( sunDir );
	app.foliageMaterial = material;
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
	const { material: canopy } = createFoliageMaterial( sunDir, { clusters: leafAtlas.texture } );
	app.canopyMaterial = canopy;
	const { material: fernMat } = createFoliageMaterial( sunDir, { fern: true } );
	const oakImpostor = oakAtlas.createMaterial( { bark: OAK_BARK } );
	const pineImpostor = pineAtlas.createMaterial( { bark: PINE_BARK } );
	app.oakImpostors = oakAtlas;
	app.pineImpostors = pineAtlas;
	const species = {
		oak: new ChunkedInstances( { name: 'oak', hi: oakHi, lo: oakTree( 1, 11 ), material: canopy, tile: 260, lodDistance: 150, shadowDistance: 140, impostor: oakImpostor, impostorDistance: 320 } ),
		pine: new ChunkedInstances( { name: 'pine', hi: pineHi, lo: pineTree( 1, 12 ), material: canopy, tile: 260, lodDistance: 150, shadowDistance: 140, impostor: pineImpostor, impostorDistance: 320 } ),
		birch: new ChunkedInstances( { name: 'birch', hi: birchGeometry( 0, 13 ), lo: birchGeometry( 1, 13 ), material, tile: 260, lodDistance: 150, shadowDistance: 140 } ),
		bush: new ChunkedInstances( { name: 'bush', hi: shrubBush( 0, 14 ), lo: shrubBush( 1, 14 ), material: canopy, tile: 260, lodDistance: 110, shadowDistance: 0, castShadow: false, layer: 1, reflect: false } ),
		fern: new ChunkedInstances( { name: 'fern', hi: bracken( 0, 15 ), lo: bracken( 1, 15 ), material: fernMat, tile: 260, lodDistance: 90, shadowDistance: 0, castShadow: false, layer: 1, reflect: false, maxDistance: 260 } )
	};
	for ( const s of Object.values( species ) ) s.addAttribute( 'aTint', 3 );

	const PAL = {
		oak: [ 0x3d4f24, 0x4b5f2b, 0x5b6b2e, 0x455a27 ],
		pine: [ 0x2f4424, 0x37502a, 0x2a3e20, 0x40582e ],
		birch: [ 0x5f7231, 0x6b7c36, 0x76833c, 0x5a6a2f ],
		bush: [ 0x34482a, 0x3c5026, 0x48562a, 0x303f22 ], // gorse / broom: dark, dense greens
		fern: [ 0x506a26, 0x5c722a, 0x4a6224, 0x6a7230 ] // bracken: fresh green, some yellowing
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
	const place = ( sp, x, z, s, tilt = 0.08, R = rnd ) => {
		const y = hf.heightAt( x, z );
		hf.normalAt( x, z, nrm );
		q.setFromUnitVectors( up, nrm.lerp( up, 1 - tilt ).normalize() );
		q.multiply( new THREE.Quaternion().setFromAxisAngle( up, R() * Math.PI * 2 ) );
		pos.set( x, y - 0.25 * s, z );
		sc.set( s * ( 0.9 + R() * 0.2 ), s * ( 0.85 + R() * 0.3 ), s * ( 0.9 + R() * 0.2 ) );
		m.compose( pos, q, sc );
		const kind = sp === 'gold' ? 'birch' : sp;
		const extra = [ sp === 'gold' ? [ 0.47, 0.32, 0.045 ] : tint( sp, R ) ];
		if ( R === rnd && nature && erased( nature, CH[ kind ], x, z ) ) return false;
		species[ kind ].add_( m, extra );
		return true;
	};

	// Jittered-grid scatter over the whole terrain.
	const step = 9;
	const x0 = hf.x0 + 10, x1 = hf.x0 + hf.size - 10, z0 = hf.z0 + 10, z1 = hf.z0 + hf.size - 10;
	let counts = { oak: 0, pine: 0, birch: 0, bush: 0, fern: 0 };
	// understory: bracken in the woodland patches and the lowlands, gorse / broom on the high open hills
	const shrub = ( x, z, s, patch, h ) => {
		const fernP = ( 0.25 + 0.45 * patch ) * ( 1 - ss( 90, 220, h ) );
		if ( rnd() < fernP ) { if ( place( 'fern', x, z, 0.8 + rnd() * 0.5, 0.3 ) ) counts.fern ++; } else if ( place( 'bush', x, z, s, 0.5 ) ) counts.bush ++;
	};
	for ( let z = z0; z < z1; z += step ) {
		for ( let x = x0; x < x1; x += step ) {
			const px = x + ( rnd() - 0.5 ) * step, pz = z + ( rnd() - 0.5 ) * step;
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
			const c = distV < 360 ? clearance( px, pz, app.mask ) : 1;
			if ( c <= 0 ) continue;
			dens *= c;
			const r = rnd();
			if ( r < dens * 0.72 ) {
				// tree: pines higher up & on islands/coast, oaks on the lowlands
				const pinePref = ss( 40, 140, h ) * 0.6 + ( h < 30 && distV > 250 ? 0.5 : 0 ) + 0.2;
				const pick = rnd();
				let sp;
				if ( pick < pinePref ) sp = 'pine';
				else if ( pick < pinePref + 0.025 ) sp = 'birch';
				else sp = 'oak';
				const s = ( sp === 'pine' ? 0.6 + rnd() * 0.8 : 0.7 + rnd() * 0.6 ) * ( 1 - 0.3 * ss( 200, 420, h ) );
				if ( place( sp, px, pz, s ) ) counts[ sp ] ++;
			} else if ( r < dens * 0.72 + ( 0.3 + 0.5 * patch ) * steep * altitude * c * 0.9 ) {
				shrub( px, pz, 0.6 + rnd() * 0.9, patch, h );
			}
			// extra shrub clumps (gorse / broom / bracken) on the open hills
			if ( ! nearVillage && h > 3 && rnd() < 0.9 * steep * altitude ) {
				for ( let k = 0; k < 2; k ++ ) shrub( px + ( rnd() - 0.5 ) * step, pz + ( rnd() - 0.5 ) * step, 0.5 + rnd() * 0.8, patch, h );
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
	for ( const [ sp, x, z, s ] of featured ) if ( place( sp, x, z, s ) ) counts[ sp === 'gold' ? 'birch' : sp ] ++;

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
					if ( Math.hypot( x - VILLAGE.x, z - VILLAGE.z ) < 380 && clearance( x, z, app.mask ) <= 0 ) continue;
					if ( place( sp, x, z, s0 + prnd() * ( s1 - s0 ), tilt, prnd ) ) counts[ sp ] ++;
				}
			} );
		}
	}

	for ( const s of Object.values( species ) ) { s.build(); group.add( s ); }
	app.onFrame.push( () => { for ( const s of Object.values( species ) ) s.update( app.camera ); } );
	progress?.( 1 );
	group.userData.counts = counts;
	return group;
}
