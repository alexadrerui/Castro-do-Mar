import * as THREE from 'three/webgpu';
import {
	Fn, uniform, texture, positionWorld, normalWorld, positionView, normalView, faceDirection,
	vec2, vec3, float, color, mix, smoothstep, clamp, max, abs, sin, cross, dot, normalize, length,
	attribute, fwidth
} from 'three/tsl';
import { MASK, WATER_LEVEL } from './layout.js';
import { makeDetailTexture } from '../core/texgen.js';

// Screen-space bump from an arbitrary procedural height node (the built-in
// bumpMap() only differentiates texture UVs).
export const proceduralBump = Fn( ( [ h, strength ] ) => {
	const dHdx = h.dFdx().mul( strength );
	const dHdy = h.dFdy().mul( strength );
	const pos = positionView;
	const N = normalView;
	const sX = pos.dFdx(), sY = pos.dFdy();
	const R1 = cross( sY, N ), R2 = cross( N, sX );
	const det = dot( sX, R1 ).mul( faceDirection );
	const grad = det.sign().mul( dHdx.mul( R1 ).add( dHdy.mul( R2 ) ) );
	return normalize( max( abs( det ), 1e-6 ).mul( N ).sub( grad ) );
} );

// Meadow colour from the baked macro noise (nMacro, nLarge, nMed: macroTex r, g, b) and the sun
// exposure of the slope (sunFace = N . sunDir, 0..1). Shared by the terrain and the grass blades
// (grass.js), so the sward and the ground under it are the same green. Returns { tone, dry, lush }
// (dry: sun-bleached share, lush: deep / mossy share).
export function meadowTone( nMacro, nLarge, nMed, sunFace ) {
	const gDeep = color( 0x3a4a1f ), gMid = color( 0x5d6a30 ), gSun = color( 0x7b7f3c ), gDry = color( 0x8f8450 ), gMoss = color( 0x2c3a1a );
	const deep = smoothstep( 0.25, 0.7, nLarge );
	let tone = mix( gDeep, gMid, deep );
	tone = mix( tone, gSun, smoothstep( 0.55, 0.85, nMacro ).mul( 0.7 ) );
	const dry = smoothstep( 0.55, 0.9, sunFace.add( nMed.sub( 0.5 ).mul( 0.5 ) ) ).mul( 0.3 ).add( smoothstep( 0.7, 0.9, nMed ).mul( 0.12 ) );
	tone = mix( tone, gDry, dry );
	const moss = smoothstep( 0.2, 0.45, nMed ).oneMinus().mul( 0.4 );
	tone = mix( tone, gMoss, moss );
	return { tone, dry, lush: moss.add( deep.oneMinus().mul( 0.5 ) ) };
}

export function createTerrain( hf, maskData, aoData, sunDir, macroData ) {

	// ---------- geometry: full-res normals, then LOD chunks ----------
	const n = hf.n;
	const normals = computeGridNormals( hf );
	const aoArr = aoData || new Float32Array( n * n ).fill( 1 );
	const chunks = buildChunks( hf, normals, aoArr );

	// ---------- textures (node inputs) ----------
	const maskTex = new THREE.DataTexture( maskData, MASK.res, MASK.res, THREE.RGBAFormat );
	maskTex.magFilter = THREE.LinearFilter;
	maskTex.minFilter = THREE.LinearMipmapLinearFilter;
	maskTex.generateMipmaps = true;
	maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
	maskTex.needsUpdate = true;

	const heightTex = createHeightTexture( hf );

	const macroTex = new THREE.DataTexture( macroData, 1024, 1024, THREE.RGBAFormat );
	macroTex.magFilter = THREE.LinearFilter; macroTex.minFilter = THREE.LinearMipmapLinearFilter;
	macroTex.generateMipmaps = true; macroTex.needsUpdate = true;
	const detailTex = createDetailTexture();

	const mat = new THREE.MeshStandardNodeMaterial();
	mat.name = 'TerrainTSL';

	const U = {
		detail: uniform( 1.0 ),
		wetLine: uniform( 0.6 ),
		sunDir: uniform( sunDir )
	};

	const wp = positionWorld;
	const xz = wp.xz;
	const slope = float( 1 ).sub( normalWorld.y.clamp( 0, 1 ) );
	const viewDist = length( positionView );
	const nearFade = smoothstep( 15, 150, viewDist ).oneMinus(); // fine detail only close up

	// ---- mask ----
	const maskUV = xz.sub( vec2( MASK.centerX - MASK.size / 2, MASK.centerZ - MASK.size / 2 ) ).div( MASK.size );
	const m = texture( maskTex, maskUV );
	const inMask = smoothstep( 0.0, 0.01, maskUV.x ).mul( smoothstep( 0.99, 1.0, maskUV.x ).oneMinus() )
		.mul( smoothstep( 0.0, 0.01, maskUV.y ) ).mul( smoothstep( 0.99, 1.0, maskUV.y ).oneMinus() );
	const pathM = m.r.mul( inMask );
	const dirtM = m.g.mul( inMask );
	const fieldM = m.b.mul( inMask );
	const cropId = m.a;

	// ---- noise layers ----
	// baked macro noise (one fetch) + tileable detail texture (node textures)
	const Mx = texture( macroTex, xz.sub( vec2( hf.x0, hf.z0 ) ).div( hf.size ) );
	const nMacro = Mx.r, nLarge = Mx.g, nMed = Mx.b, nOut = Mx.a;
	const D1 = texture( detailTex, xz.div( 6.0 ) );
	// rock detail: horizontal plane blended with a vertical plane on cliffs
	const tw = abs( normalWorld ).pow( vec3( 4.0 ) ).toVar();
	const twn = tw.div( tw.x.add( tw.y ).add( tw.z ) );
	const D2 = texture( detailTex, xz.div( 38.0 ) ).mul( twn.y )
		.add( texture( detailTex, wp.zy.div( 38.0 ) ).mul( twn.x ) )
		.add( texture( detailTex, wp.xy.div( 38.0 ) ).mul( twn.z ) );
	const stretch = ( v ) => v.sub( 0.5 ).mul( 2.2 ).add( 0.5 ).clamp( 0, 1 );
	const nFine = stretch( D1.r );
	// the rock detail repeats every 38 m: far away the repetition reads as a checker /
	// camouflage pattern on the big faces, so it hands over to the baked macro noise,
	// which never repeats over the terrain
	const rockFar = smoothstep( 120, 520, viewDist );
	const nRock3 = mix( stretch( D2.b ), stretch( nMed.mul( 0.55 ).add( nLarge.mul( 0.45 ) ) ), rockFar );
	// granite joints: thin dark lines along Worley cell borders (F2 - F1), faded with the detail
	const cracks = mix( D2.g.mul( 0.5 ), float( 1 ), rockFar );
	const cracksFine = D1.a.mul( 0.5 );
	const ao = attribute( 'ao', 'float' );

	// ---- grass ----
	// sun-bleached on sun-facing slopes
	const sunFace = dot( normalWorld, normalize( U.sunDir ) ).clamp( 0, 1 );
	let grass = meadowTone( nMacro, nLarge, nMed, sunFace ).tone;
	grass = grass.mul( mix( 0.7, 1.25, nFine.mul( nearFade ).add( float( 0.5 ).mul( nearFade.oneMinus() ) ) ) );

	// ---- granite rock ----
	const rBase = color( 0x958b7a ), rLight = color( 0xc4baa6 ), rDark = color( 0x5e574c ), rLichen = color( 0x7b7a4e );
	let rock = mix( rDark, rBase, smoothstep( 0.35, 0.55, nRock3 ) );
	rock = mix( rock, rLight, smoothstep( 0.55, 0.72, nRock3 ) );
	rock = mix( rock, rLichen, smoothstep( 0.62, 0.8, nLarge ).mul( 0.45 ) );
	rock = rock.mul( smoothstep( 0.0, 0.06, cracks ).mul( 0.35 ).add( 0.65 ) );
	// horizontal strata / sheeting bands on the big faces
	rock = rock.mul( sin( wp.y.mul( 0.35 ).add( nLarge.mul( 4.0 ) ) ).mul( 0.08 ).add( 0.92 ) );
	rock = rock.mul( mix( 1.0, smoothstep( 0.0, 0.05, cracksFine ).mul( 0.3 ).add( 0.7 ), nearFade ) );

	// rock exposure: slopes + granite outcrops scattered on the hills
	const outcrop = smoothstep( 0.62, 0.74, nOut )
		.mul( smoothstep( 24, 40, wp.y ) ).mul( dirtM.oneMinus() );
	const rockM = clamp(
		smoothstep( mix( 0.3, 0.42, smoothstep( 60, 260, wp.y ) ), mix( 0.62, 0.72, smoothstep( 60, 260, wp.y ) ), slope.add( nMed.sub( 0.5 ).mul( 0.08 ) ) ).add( outcrop.mul( 0.4 ) ).add( smoothstep( 180, 420, wp.y ).mul( 0.55 ) ),
		0, 1 ).mul( fieldM.oneMinus() );

	// ---- dirt / paths / fields ----
	const dirtDark = color( 0x5d4c3a ), dirtMid = color( 0x7a6750 ), pathLight = color( 0x8f7f63 );
	let dirt = mix( dirtDark, dirtMid, nMed );
	dirt = dirt.mul( mix( 0.85, 1.1, nFine ) );
	const pathCol = mix( dirtMid, pathLight, nFine.mul( 0.6 ).add( nMed.mul( 0.4 ) ) );

	// crop rows in field-local space (fields share ~0.44 rad rotation)
	const ca = float( Math.cos( 0.44 ) ), sa = float( Math.sin( 0.44 ) );
	const rowCoord = wp.x.mul( sa ).add( wp.z.mul( ca ) );
	const rows = mix( sin( rowCoord.mul( 5.2 ) ).mul( 0.5 ).add( 0.5 ), float( 0.5 ), smoothstep( 0.15, 0.6, fwidth( rowCoord ) ) );
	const cropA = color( 0x6f7d2c ), cropB = color( 0xa18d45 ), cropC = color( 0x55702a );
	const cropCol = mix( mix( cropA, cropB, cropId.mul( 255 ).step( 90 ).oneMinus() ), cropC, cropId.mul( 255 ).step( 150 ).oneMinus() );
	const field = mix( dirtMid.mul( 0.9 ), cropCol, smoothstep( 0.35, 0.65, rows ).mul( 0.85 ) );

	// ---- shore / underwater ----
	const sand = color( 0xa4977a ), wetSand = color( 0x6f6754 );
	const shoreM = smoothstep( WATER_LEVEL + 0.6, WATER_LEVEL + 2.6, wp.y ).oneMinus();
	const underM = smoothstep( WATER_LEVEL - 4, WATER_LEVEL + 0.2, wp.y ).oneMinus();
	const shoreRock = smoothstep( WATER_LEVEL + 1.5, WATER_LEVEL + 7, wp.y ).oneMinus().mul( smoothstep( 0.35, 0.65, nLarge.add( slope ) ) ).mul( dirtM.oneMinus() )
		.mul( smoothstep( WATER_LEVEL - 0.6, WATER_LEVEL + 0.2, wp.y ) ); // shore only: the seabed has its own look
	// seabed: pale sand and olive silt in patches (the seabed life sits on it, see world/seabed)
	const seabedCol = mix( color( 0x7a725c ), color( 0x56583e ), smoothstep( 0.3, 0.7, nMed ) ).mul( mix( 0.85, 1.1, nFine ) );
	// sand ripple marks, running across the swell (from the east)
	const ripples = sin( wp.x.mul( 6.3 ).add( wp.z.mul( 1.4 ) ).add( nMed.mul( 9.0 ) ) ).mul( 0.5 ).add( 0.5 );

	// ---- snow on the highest local peaks ----
	const snowM = smoothstep( 390, 470, wp.y.add( nLarge.mul( 60 ) ) ).mul( smoothstep( 0.3, 0.55, slope ).oneMinus() );

	// ---- compose ----
	let col = grass;
	col = mix( col, dirt, smoothstep( 0.25, 0.75, dirtM.add( nMed.sub( 0.5 ).mul( 0.4 ) ) ) );
	col = mix( col, field, fieldM );
	col = mix( col, pathCol, smoothstep( 0.2, 0.7, pathM ) );
	const rockAll = clamp( rockM.add( shoreRock ), 0, 1 );
	col = mix( col, rock, rockAll );
	col = mix( col, mix( sand, rock, rockAll.mul( 0.8 ) ), shoreM.mul( 0.25 ) );
	col = mix( col, wetSand, smoothstep( WATER_LEVEL, U.wetLine.add( WATER_LEVEL ), wp.y ).oneMinus().mul( 0.6 ) );
	col = mix( col, mix( seabedCol, rock.mul( 0.7 ), rockM ), underM );
	col = mix( col, color( 0xf2f4f7 ), snowM );

	// baked sky-visibility (heightfield AO) darkens valleys and crevices
	mat.colorNode = col.mul( mix( 0.55, 1.0, ao ) );
	mat.aoNode = mix( float( 0.6 ), float( 1.0 ), ao );

	// roughness: wet near water, rock slightly smoother
	mat.roughnessNode = mix( float( 0.96 ), float( 0.82 ), rockM ).sub( smoothstep( WATER_LEVEL, WATER_LEVEL + 0.8, wp.y ).oneMinus().mul( 0.4 ) );
	mat.metalnessNode = float( 0 );

	// ---- micro relief (normal detail) ----
	const hRock = smoothstep( 0.0, 0.08, cracks ).mul( 0.7 ).add( nRock3.mul( 0.8 ) ).add( smoothstep( 0.0, 0.05, cracksFine ).mul( 0.25 ) );
	const hGrass = nFine.mul( 0.25 ).add( nMed.mul( 0.3 ) );
	const hPath = nFine.mul( 0.15 );
	const hSea = mix( nFine.mul( 0.2 ).add( ripples.mul( 0.35 ) ), hRock, rockM );
	const hDetail = mix( mix( mix( hGrass, hPath, pathM ), hRock, rockAll ), hSea, underM ).mul( U.detail );
	const bumpFade = smoothstep( 80, 420, viewDist ).oneMinus();
	mat.normalNode = proceduralBump( hDetail, mix( 0.35, 1.4, rockAll ).mul( nearFade.mul( 0.8 ).add( 0.2 ) ).mul( bumpFade ) );

	const group = new THREE.Group();
	group.name = 'terrain';
	for ( const c of chunks ) {
		const mesh = new THREE.Mesh( c.lods[ 0 ], mat );
		mesh.receiveShadow = true;
		mesh.castShadow = false;
		mesh.layers.enable( 2 );
		group.add( mesh );
		c.mesh = mesh;
	}
	// pick a LOD per chunk from the camera distance to its bounds
	const _p = new THREE.Vector3();
	const update = ( camera ) => {
		for ( const c of chunks ) {
			c.box.clampPoint( camera.position, _p );
			const d = _p.distanceTo( camera.position );
			const lod = d < 160 ? 0 : d < 420 ? 1 : d < 900 ? 2 : d < 1700 ? 3 : 4;
			if ( c.lod !== lod ) { c.lod = lod; c.mesh.geometry = c.lods[ lod ]; }
			// only nearby chunks are worth drawing again in the water reflection
			// (the far mesh already covers the distant shores)
			if ( d < 700 ) c.mesh.layers.enable( 2 ); else c.mesh.layers.disable( 2 );
		}
	};

	return { mesh: group, material: mat, uniforms: U, maskTex, heightTex, macroTex, detailTex, update };
}

function computeGridNormals( hf ) {
	const n = hf.n, d = hf.data, e = hf.cell;
	const out = new Float32Array( n * n * 3 );
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {
		const hl = d[ j * n + Math.max( 0, i - 1 ) ], hr = d[ j * n + Math.min( n - 1, i + 1 ) ];
		const hd = d[ Math.max( 0, j - 1 ) * n + i ], hu = d[ Math.min( n - 1, j + 1 ) * n + i ];
		const nx = hl - hr, ny = 2 * e, nz = hd - hu;
		const l = Math.hypot( nx, ny, nz );
		const k = ( j * n + i ) * 3;
		out[ k ] = nx / l; out[ k + 1 ] = ny / l; out[ k + 2 ] = nz / l;
	}
	return out;
}

// 11 x 11 chunks of 80 cells, LOD strides 1/2/4/8/16, with skirts to hide cracks.
function buildChunks( hf, normals, ao ) {
	const n = hf.n, CH = 80, NC = hf.seg / CH;
	const strides = [ 1, 2, 4, 8, 16 ];
	const chunks = [];
	for ( let cj = 0; cj < NC; cj ++ ) for ( let ci = 0; ci < NC; ci ++ ) {
		const lods = [];
		const box = new THREE.Box3();
		for ( const st of strides ) {
			const m = CH / st + 1; // verts per side
			const vcount = m * m + 4 * ( m - 1 );
			const pos = new Float32Array( vcount * 3 ), nor = new Float32Array( vcount * 3 ), a = new Float32Array( vcount );
			let v = 0;
			const put = ( gi, gj, drop ) => {
				const k = gj * n + gi;
				pos[ v * 3 ] = hf.x0 + gi * hf.cell; pos[ v * 3 + 1 ] = hf.data[ k ] - drop; pos[ v * 3 + 2 ] = hf.z0 + gj * hf.cell;
				nor[ v * 3 ] = normals[ k * 3 ]; nor[ v * 3 + 1 ] = normals[ k * 3 + 1 ]; nor[ v * 3 + 2 ] = normals[ k * 3 + 2 ];
				a[ v ] = ao[ k ];
				return v ++;
			};
			const i0 = ci * CH, j0 = cj * CH;
			for ( let y = 0; y < m; y ++ ) for ( let x = 0; x < m; x ++ ) put( i0 + x * st, j0 + y * st, 0 );
			const idx = [];
			for ( let y = 0; y < m - 1; y ++ ) for ( let x = 0; x < m - 1; x ++ ) {
				const q = y * m + x;
				idx.push( q, q + m, q + 1, q + 1, q + m, q + m + 1 );
			}
			// skirts: walk the border and extrude down
			const border = [];
			for ( let x = 0; x < m - 1; x ++ ) border.push( [ x, 0 ] );
			for ( let y = 0; y < m - 1; y ++ ) border.push( [ m - 1, y ] );
			for ( let x = m - 1; x > 0; x -- ) border.push( [ x, m - 1 ] );
			for ( let y = m - 1; y > 0; y -- ) border.push( [ 0, y ] );
			const drop = 2 + st * 1.5;
			const top = [], bot = [];
			for ( const [ x, y ] of border ) { top.push( y * m + x ); bot.push( put( i0 + x * st, j0 + y * st, drop ) ); }
			for ( let q = 0; q < border.length; q ++ ) {
				const q2 = ( q + 1 ) % border.length;
				idx.push( top[ q ], bot[ q ], top[ q2 ], top[ q2 ], bot[ q ], bot[ q2 ] );
			}
			const g = new THREE.BufferGeometry();
			g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
			g.setAttribute( 'normal', new THREE.BufferAttribute( nor, 3 ) );
			g.setAttribute( 'ao', new THREE.BufferAttribute( a, 1 ) );
			g.setIndex( idx );
			g.computeBoundingBox();
			if ( st === 1 ) box.copy( g.boundingBox );
			lods.push( g );
		}
		// all LODs share the full-res bounds so culling never flickers
		for ( const g of lods ) { g.boundingBox = box.clone(); g.boundingSphere = box.getBoundingSphere( new THREE.Sphere() ); }
		chunks.push( { lods, box, lod: 0 } );
	}
	return chunks;
}

export function createDetailTexture() {
	const size = 512;
	const tex = new THREE.DataTexture( makeDetailTexture( size ), size, size, THREE.RGBAFormat );
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
	return tex;
}

// Heightfield as a half-float texture: used by the water shader for depth.
export function createHeightTexture( hf ) {
	const n = hf.n;
	const buf = new Uint16Array( n * n );
	for ( let k = 0; k < n * n; k ++ ) buf[ k ] = THREE.DataUtils.toHalfFloat( hf.data[ k ] );
	const tex = new THREE.DataTexture( buf, n, n, THREE.RedFormat, THREE.HalfFloatType );
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearFilter;
	tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.needsUpdate = true;
	tex.userData = { x0: hf.x0, z0: hf.z0, size: hf.size, cell: hf.cell, n: hf.n };
	return tex;
}
