import * as THREE from 'three/webgpu';
import {
	Fn, attribute, uniform, positionLocal, positionWorld, normalWorld, time, vec3, float, color, mix, smoothstep,
	sin, dot, max, normalize, mx_noise_float, instanceIndex, hash, texture, uv
} from 'three/tsl';
import { makeFoliageAtlas } from '../core/texgen.js';
import { ChunkedInstances } from '../core/chunked.js';
import { oakGeometry, pineGeometry, birchGeometry, bushGeometry, grassTuftGeometry } from './plants.js';
import { makeSimplex, fbm, mulberry32, smoothstep as ss } from '../core/noise.js';
import { pathDistance } from './heightfield.js';
import { BUILDINGS, FORT, MINE, FIELDS, VILLAGE, MASK, TOWER } from './layout.js';

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

export function createFoliageMaterial( sunDir, palette ) {
	const U = { wind: uniform( 1.0 ), sunDir: uniform( sunDir ) };
	const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
	mat.alphaTest = 0.45;
	mat.alphaToCoverage = true;
	const card = attribute( 'aux', 'vec4' ).w;
	const tex = texture( foliageAtlas(), uv() );
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
	const cardLum = mix( float( 1 ), tex.r.mul( 1.35 ).add( 0.15 ), card );
	const leafCol = tint.mul( mix( 0.72, 1.18, n ) ).mul( mix( 0.85, 1.1, nBig ) ).mul( cardLum );
	mat.opacityNode = mix( float( 1 ), tex.a, card );
	// cards: cut empty texels before shading, and in the shadow pass
	mat.maskNode = card.lessThan( 0.5 ).or( tex.a.greaterThan( 0.2 ) );
	mat.maskShadowNode = card.lessThan( 0.5 ).or( tex.a.greaterThan( 0.45 ) );
	const bark = baseCol.mul( mix( 0.75, 1.1, n ) );
	mat.colorNode = mix( bark, leafCol, leaf ).mul( mix( 0.55, 1.0, ao ) );

	// fake subsurface: brighten foliage facing away from the sun (back-lit rims)
	const back = max( dot( normalWorld, normalize( U.sunDir ) ).negate(), 0.0 );
	mat.emissiveNode = leafCol.mul( back.mul( 0.08 ) ).mul( leaf ).mul( ao );
	mat.roughnessNode = mix( float( 0.9 ), float( 0.75 ), leaf );
	void palette;
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
export function clearance( x, z, mask, pad = 0 ) {
	const [ path, dirt, field ] = sampleMask( mask, x, z );
	if ( path > 0.05 || field > 0.2 ) return 0;
	let free = 1 - ss( 0.3, 0.8, dirt );
	for ( const b of BUILDINGS ) {
		const r = ( b.r || Math.max( b.w || 4, b.l || 4 ) * 0.62 ) + 1.8 + pad;
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

export function createVegetation( app, progress ) {
	const { hf, mask } = app;
	const sunDir = app.sky.state.sunDir;
	const group = new THREE.Group();
	group.name = 'vegetation';

	const { material } = createFoliageMaterial( sunDir );
	app.foliageMaterial = material;

	const species = {
		oak: new ChunkedInstances( { name: 'oak', hi: oakGeometry( 0, 11 ), lo: oakGeometry( 1, 11 ), material, tile: 260, lodDistance: 150, shadowDistance: 140 } ),
		pine: new ChunkedInstances( { name: 'pine', hi: pineGeometry( 0, 12 ), lo: pineGeometry( 1, 12 ), material, tile: 260, lodDistance: 150, shadowDistance: 140 } ),
		birch: new ChunkedInstances( { name: 'birch', hi: birchGeometry( 0, 13 ), lo: birchGeometry( 1, 13 ), material, tile: 260, lodDistance: 150, shadowDistance: 140 } ),
		bush: new ChunkedInstances( { name: 'bush', hi: bushGeometry( 0, 14 ), lo: bushGeometry( 1, 14 ), material, tile: 260, lodDistance: 110, shadowDistance: 0, castShadow: false, layer: 1, reflect: false } )
	};
	species.grass = new ChunkedInstances( { name: 'grass', hi: grassTuftGeometry(), material, tile: 64, castShadow: false, layer: 1, maxDistance: 70, reflect: false } );
	for ( const s of Object.values( species ) ) s.addAttribute( 'aTint', 3 );

	const PAL = {
		oak: [ 0x3d4f24, 0x4b5f2b, 0x5b6b2e, 0x455a27 ],
		pine: [ 0x2f4424, 0x37502a, 0x2a3e20, 0x40582e ],
		birch: [ 0x5f7231, 0x6b7c36, 0x76833c, 0x5a6a2f ],
		bush: [ 0x44582a, 0x51642e, 0x5f6a33, 0x3d5026 ],
		grass: [ 0x5f7431, 0x6f7f36, 0x8a8744, 0x53692c, 0x9a8f50 ]
	};
	const tmpC = new THREE.Color();
	const tint = ( sp, rnd ) => {
		const pal = PAL[ sp ];
		tmpC.set( pal[ Math.floor( rnd() * pal.length ) ] ).convertSRGBToLinear();
		const v = 0.9 + rnd() * 0.2;
		return [ tmpC.r * v, tmpC.g * v, tmpC.b * v ];
	};

	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
	const up = new THREE.Vector3( 0, 1, 0 ), nrm = new THREE.Vector3();
	const rnd = mulberry32( 890 );
	const place = ( sp, x, z, s, tilt = 0.08 ) => {
		const y = hf.heightAt( x, z );
		hf.normalAt( x, z, nrm );
		q.setFromUnitVectors( up, nrm.lerp( up, 1 - tilt ).normalize() );
		q.multiply( new THREE.Quaternion().setFromAxisAngle( up, rnd() * Math.PI * 2 ) );
		pos.set( x, y - 0.25 * s, z );
		sc.set( s * ( 0.9 + rnd() * 0.2 ), s * ( 0.85 + rnd() * 0.3 ), s * ( 0.9 + rnd() * 0.2 ) );
		m.compose( pos, q, sc );
		species[ sp === 'gold' ? 'birch' : sp ].add_( m, [ sp === 'gold' ? [ 0.47, 0.32, 0.045 ] : tint( sp, rnd ) ] );
	};

	// Jittered-grid scatter over the whole terrain.
	const step = 9;
	const x0 = hf.x0 + 10, x1 = hf.x0 + hf.size - 10, z0 = hf.z0 + 10, z1 = hf.z0 + hf.size - 10;
	let counts = { oak: 0, pine: 0, birch: 0, bush: 0, grass: 0 };
	for ( let z = z0; z < z1; z += step ) {
		for ( let x = x0; x < x1; x += step ) {
			const px = x + ( rnd() - 0.5 ) * step, pz = z + ( rnd() - 0.5 ) * step;
			const h = hf.heightAt( px, pz );
			if ( h < 1.6 || h > 430 ) continue;
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
				place( sp, px, pz, s );
				counts[ sp ] ++;
			} else if ( r < dens * 0.72 + ( 0.3 + 0.5 * patch ) * steep * altitude * c * 0.9 ) {
				place( 'bush', px, pz, 0.6 + rnd() * 0.9, 0.5 );
				counts.bush ++;
			}
			// extra shrub clumps (gorse / broom / bracken) on the open hills
			if ( ! nearVillage && h > 3 && rnd() < 0.9 * steep * altitude ) {
				for ( let k = 0; k < 2; k ++ ) { place( 'bush', px + ( rnd() - 0.5 ) * step, pz + ( rnd() - 0.5 ) * step, 0.5 + rnd() * 0.8, 0.5 ); counts.bush ++; }
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
	for ( const [ sp, x, z, s ] of featured ) { place( sp, x, z, s ); counts[ sp === 'gold' ? 'birch' : sp ] ++; }

	// Grass tufts around the village and on the near hills (drawn only close to the camera).
	for ( let z = - 300; z < 320; z += 1.6 ) {
		for ( let x = - 330; x < 280; x += 1.6 ) {
			const px = x + ( rnd() - 0.5 ) * 1.6, pz = z + ( rnd() - 0.5 ) * 1.6;
			const h = hf.heightAt( px, pz );
			if ( h < 1.5 ) continue;
			const [ path, dirt, field ] = sampleMask( app.mask, px, pz );
			if ( path > 0.3 || field > 0.3 ) continue;
			const slope = hf.slopeAt( px, pz );
			const dens = ( 1 - ss( 0.2, 0.7, dirt ) ) * ( 1 - ss( 0.5, 1.0, slope ) ) * ( 0.45 + 0.55 * ss( - 0.2, 0.4, fbm( nV, px * 0.05, pz * 0.05, 2 ) ) );
			if ( rnd() > dens * 0.85 ) continue;
			if ( clearance( px, pz, app.mask, - 1.2 ) <= 0 && dirt < 0.2 ) continue;
			place( 'grass', px, pz, 0.35 + rnd() * 0.45, 0.6 );
			counts.grass ++;
		}
	}

	for ( const s of Object.values( species ) ) { s.build(); group.add( s ); }
	app.onFrame.push( () => { for ( const s of Object.values( species ) ) s.update( app.camera ); } );
	progress?.( 1 );
	group.userData.counts = counts;
	return group;
}
