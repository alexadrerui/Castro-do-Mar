// Volumetric clouds, after takram's @takram/three-clouds (three-geospatial, packages/clouds, v0.7.6:
// shaders/clouds.glsl, clouds.frag, CloudLayers.ts, qualityPresets.ts), MIT License, Copyright (c) 2024
// Shota Matsuda, licenses/LICENSE-takram-clouds.md. Its textures are used as they are (public/clouds/:
// the 128³ shape, the 32³ shape detail and the 512² local weather, one cloud layer per channel).
// Changes: rewritten in TSL for WebGPU (the original is GLSL for pmndrs' postprocessing); a flat world
// instead of the globe (the weather tiles over x / z); the Beer shadow map is a single cascade
// (world/cloudShadow.js, it shades the ground too), no turbulence; the light shafts act on this project's haze (apply()); the temporal filter is simpler (below); the
// sun and sky light are this project's (sky.js), not precomputed atmosphere irradiance; the coverage
// comes from the sky's cloudCoverage (the panel's "Nuvens", the rain).
// The model: per layer, the weather texture says where the clouds are, a semi-circle height function
// rounds their tops and the coverage remaps it; the shape noise carves them, the detail erodes the
// edges (wispy at the base, billowing at the top); a density profile grows with the height. The march
// takes 40 m steps growing with the distance, long steps through empty air, and stops once opaque.
// Light: a few steps toward the sun, multiple scattering as octaves (Wrenninge), a dual-lobe
// Henyey-Greenstein phase, the powder darkening, the sky's light by height, and the energy-conserving
// integration of each step (Frostbite 2016, 5.6.3). The distance haze is applied once, at the
// transmittance-weighted mean depth of the clouds.
// Temporal filter (after the original's resolve, much simplified): the march is jittered differently
// every frame (golden-ratio sequence) and blended into a history at 10% a frame; the history is
// reprojected by the ray's direction (the clouds are kilometres away, the camera's turn is what moves
// them) and clamped to the 3 x 3 neighbourhood of the new frame (no ghosting). No blur: sharp edges.
// app.clouds: coverage (the sky's), sunScale, ambientScale, windSpeed, evolve, layer uniforms; ?clouds=0
// leaves the pass out.
import * as THREE from 'three/webgpu';
import {
	Fn, If, Loop, Break, float, mix, vec2, vec3, vec4, uniform, texture, texture3D, screenUV, screenCoordinate, getViewPosition,
	getScreenPosition, interleavedGradientNoise, rtt, dot, exp, max, min, pow, log2, fract, uv, passTexture, convertToTexture
} from 'three/tsl';
import { cloudMap, CLOUD_MAP, marchLength, mapLookup, sunUp, mapCentreFor } from '../world/cloudShadow.js';
import { isSky } from '../core/depth.js';

const MAX_ITER = 192, SUN_STEPS = 4, SUN_REACH = 900, MAP_STEPS = 40, MAX_DIST = 60000, SHAFT_STEPS = 24, SHAFT_DIST = 30000, CIRRUS_STEPS = 4, CIRRUS_DIST = 90000, HAZE_DIST = 60000;
const N = ( x ) => ( typeof x === 'number' ? float( x ) : x );
const remap = ( v, a, b ) => v.sub( N( a ) ).div( N( b ).sub( N( a ) ).max( 1e-5 ) ).clamp( 0, 1 );

// the textures of the original (public/clouds/); the browser caches them
export async function loadCloudTextures() {
	const base = import.meta.env.BASE_URL + 'clouds/';
	const bin = ( f ) => fetch( base + f ).then( ( r ) => { if ( ! r.ok ) throw new Error( f + ' ' + r.status ); return r.arrayBuffer(); } );
	const [ shape, detail, weather ] = await Promise.all( [ bin( 'shape.bin' ), bin( 'shape_detail.bin' ), new THREE.TextureLoader().loadAsync( base + 'local_weather.png' ) ] );
	const tex3 = ( buf, n ) => {
		const t = new THREE.Data3DTexture( new Uint8Array( buf ), n, n, n );
		t.format = THREE.RedFormat;
		t.minFilter = t.magFilter = THREE.LinearFilter;
		t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
		t.unpackAlignment = 1;
		t.needsUpdate = true;
		return t;
	};
	weather.wrapS = weather.wrapT = THREE.RepeatWrapping;
	weather.colorSpace = THREE.NoColorSpace;
	weather.generateMipmaps = true;
	weather.minFilter = THREE.LinearMipmapLinearFilter;
	return { shape: tex3( shape, 128 ), detail: tex3( detail, 32 ), weather };
}

export class Clouds {

	// textures (loadCloudTextures()), scenePass (its depth), camera, hazeAmount( d, y ) (the land's haze),
	// hazeColor (uniform), sunDir (vector, followed by reference)
	constructor( { textures, scenePass, camera, hazeAmount, hazeColor, sunDir, resolutionScale = 0.5 } ) {
		const { shape: shapeTex, detail: detailTex, weather: weatherTex } = textures;
		this.strength = uniform( 1 );       // 0: off (under the water)
		this.coverage = uniform( 0.55 );    // the sky's cloudCoverage (main.js keeps them together)
		this.time = uniform( 0 );
		this.frame = uniform( 0 );
		this.windSpeed = uniform( 18 );     // m/s, from the south-west
		this.evolve = uniform( 3 );         // m/s: the shape noise drifts down through the clouds (they change)
		this.farShadow = uniform( 1 );      // the shadow map's share in the light toward the sun (0: only the short march)
		this.sunColor = uniform( new THREE.Color( 1, 0.95, 0.85 ) );
		this.sunScale = uniform( 12 );
		this.ambient = uniform( new THREE.Color( 0.55, 0.65, 0.8 ) );
		this.ambientScale = uniform( 2.5 );
		this.weatherScale = uniform( 1 / 60000 ); // m: one tile of the weather (cells of ~1-2 km)
		this.shapeRepeat = uniform( 0.0003 ); this.detailRepeat = uniform( 0.006 );
		// the layers (x, y, z, w = the weather's r, g, b, a): the original's two cumulus layers and its
		// cirrus (b, 7.5-8 km, thin, no detail; marched apart, below); a is off
		const v4 = ( x, y, z, w ) => uniform( new THREE.Vector4( x, y, z, w ) );
		const L = this.layers = {
			minH: v4( 750, 1000, 7500, 0 ), maxH: v4( 1400, 2200, 8000, 0 ),
			densityScale: v4( 0.2, 0.2, 0.003, 0 ), shapeAmount: v4( 1, 1, 0.4, 0 ), detailAmount: v4( 1, 1, 0, 0 ),
			weatherExp: v4( 1, 1, 1, 1 ), bias: v4( 0.35, 0.35, 0.35, 0.35 ), filterW: v4( 0.6, 0.6, 0.5, 0.6 ),
			profLin: v4( 0.75, 0.75, 0.75, 0.75 ), profConst: v4( 0.25, 0.25, 0.25, 0.25 )
		};
		this.base = uniform( 750 ); this.top = uniform( 2200 ); // the span of the cumulus layers (the main march)
		this.cirrus = uniform( 1 );                            // the cirrus layer's strength (0: off)
		this.stepScale = uniform( 1 );  // the main march's step: > 1 cheaper (fewer, longer steps; core/dynamicRes.js)
		this.fairDensity = 0.2;                                // the cumulus' density (1/m) in fair weather (overcast())
		const sun = uniform( sunDir );
		const camWorld = uniform( camera.matrixWorld ), camProjInv = uniform( camera.projectionMatrixInverse ), camPos = uniform( camera.position );
		this.camPos = camPos;
		const depthTex = scenePass.getTextureNode( 'depth' );
		const windDir = vec2( 0.7071, - 0.7071 );
		const wind = windDir.mul( this.time.mul( this.windSpeed ) );
		// the panel's 0.55 (fair weather) -> 0.3 (the original's example), the rain's 0.95 -> ~0.6 (a closed sky that keeps the relief of its base: above ~0.6 the filter width of 0.6 fills the whole layer)
		const cov = this.coverage.sub( 0.55 ).mul( 0.65 ).add( 0.3 ).clamp( 0, 1 );

		const weatherAt = ( p, mip ) => {
			const hf = remap( vec4( p.y ), L.minH, L.maxH );
			const lw = pow( texture( weatherTex, p.xz.sub( wind ).mul( this.weatherScale ) ).level( mip ), L.weatherExp );
			// semi-circle: rounded tops
			const x = pow( hf, L.bias ).mul( 2 ).sub( 1 ).clamp( - 1, 1 );
			const factor = x.mul( x ).oneMinus().mul( cov ).oneMinus();
			return { hf, density: remap( mix( lw, vec4( 1 ), L.filterW ), factor, factor.add( L.filterW ) ) };
		};
		// the media at p: per-layer density (vec4) and their sum (the extinction, all scattering)
		const mediaAt = ( w, p, detail ) => {
			const q = vec3( p.x.sub( wind.x ), p.y.add( this.time.mul( this.evolve ) ), p.z.sub( wind.y ) );
			const shape = texture3D( shapeTex, q.mul( this.shapeRepeat ) ).level( 0 ).r;
			const d = remap( w.density, vec4( shape.oneMinus() ).mul( L.shapeAmount ), 1 ).toVar();
			if ( detail ) {
				If( detail, () => {
					const det = texture3D( detailTex, q.mul( this.detailRepeat ) ).level( 0 ).r;
					// fluffy at the top, whippy at the bottom
					const mod = mix( vec4( pow( det, 6 ) ), vec4( det.oneMinus() ), remap( w.hf, 0.2, 0.4 ) ).mul( L.detailAmount );
					d.assign( remap( d.mul( 2 ), mod.mul( 0.5 ), 1 ) );
				} );
			}
			const dd = d.mul( L.densityScale ).mul( w.hf.mul( L.profLin ).add( L.profConst ) ).clamp( 0, 1 );
			return { d: dd, sum: dd.x.add( dd.y ).add( dd.z ).add( dd.w ) };
		};

		const march = Fn( () => {
			const depth = depthTex.sample( screenUV ).r;
			const vp = getViewPosition( screenUV, depth, camProjInv );
			const target = camWorld.mul( vec4( vp, 1 ) ).xyz;
			const ray = target.sub( camPos );
			const surf = isSky( depth ).select( float( 1e9 ), ray.length() );
			const dir = ray.normalize();
			const dy = dir.y.greaterThanEqual( 0 ).select( dir.y.max( 1e-5 ), dir.y.min( - 1e-5 ) );
			const t0 = this.base.sub( camPos.y ).div( dy ), t1 = this.top.sub( camPos.y ).div( dy );
			const tStart = t0.min( t1 ).max( 0 );
			const len = t0.max( t1 ).min( surf ).min( MAX_DIST ).sub( tStart ).max( 0 );
			const col = vec3( 0 ).toVar(), T = float( 1 ).toVar(), wSum = float( 0 ).toVar(), tSum = float( 0 ).toVar();
			If( len.greaterThan( 1 ), () => {
				const jitter = fract( interleavedGradientNoise( screenCoordinate.xy ).add( this.frame.mul( 0.618034 ) ) );
				const cosT = dot( dir, sun );
				// dual-lobe Henyey-Greenstein, the anisotropy attenuated per scattering octave
				const hg = ( g ) => float( 1 - g * g ).div( float( 1 + g * g ).sub( cosT.mul( 2 * g ) ).max( 1e-7 ).pow( 1.5 ) ).mul( 1 / ( 4 * Math.PI ) );
				const phase = ( c ) => hg( 0.7 * c ).add( hg( - 0.2 * c ) ).mul( 0.5 );
				const sunIrr = this.sunColor.mul( this.sunScale ), skyIrr = this.ambient.mul( this.ambientScale );
				const step = float( 40 ).add( tStart.mul( 0.012 ) ).mul( this.stepScale ).toVar();
				const r = step.mul( jitter ).mul( 2 ).toVar();
				Loop( MAX_ITER, () => {
					If( r.greaterThan( len ), () => { Break(); } );
					const t = tStart.add( r );
					const p = camPos.add( dir.mul( t ) );
					const mip = log2( t.div( 3000 ).max( 1 ) );
					const w = weatherAt( p, mip );
					const any = w.density.x.add( w.density.y ).add( w.density.z ).add( w.density.w ).greaterThan( 1e-4 );
					If( any, () => {
						const m = mediaAt( w, p, mip.mul( 0.5 ).add( jitter.sub( 0.5 ).mul( 0.5 ) ).lessThan( 0.5 ) );
						If( m.sum.greaterThan( 1e-5 ), () => {
							// optical depth toward the sun: steps doubling from 60 m (~0.9 km)
							const od = float( 0 ).toVar();
							let s = 60, at = 60 * 0.5;
							for ( let k = 0; k < SUN_STEPS; k ++ ) {
								const ps = p.add( sun.mul( float( at ).add( jitter.sub( 0.5 ).mul( s ) ) ) );
								od.addAssign( mediaAt( weatherAt( ps, mip ), ps, false ).sum.mul( s ) );
								at += s * 1.5; s *= 2;
							}
							// past those ~0.9 km, the shadow map: the mean extinction from the first cloud
							// toward the sun down to the end of the short march, at most the column's whole depth
							const look = mapLookup( p );
							const bsm = cloudMap.tex.sample( look.st ).level( 0 );
							const fromFront = marchLength().sub( p.y.sub( cloudMap.base ).div( sunUp() ) ).sub( bsm.x );
							od.addAssign( bsm.y.mul( fromFront.sub( SUN_REACH ).max( 0 ) ).min( bsm.z ).mul( look.inside ).mul( this.farShadow ) );
							// multiple scattering as octaves (a: attenuation, b: contribution, c: phase)
							const ms = float( 0 ).toVar();
							let a = 1, b = 1, c = 1;
							for ( let k = 0; k < 8; k ++ ) { ms.addAssign( exp( od.mul( - b ) ).mul( phase( c ) ).mul( a ) ); a *= 0.5; b *= 0.5; c *= 0.5; }
							const grad = dot( w.hf.mul( 0.5 ).add( 0.5 ), m.d.div( m.sum ) );
							const powder = exp( m.sum.mul( - 150 ) ).mul( 0.8 ).oneMinus();
							// radiance per unit scattering; the step's in-scattering, energy-conserving
							const rad = sunIrr.mul( ms ).add( skyIrr.mul( grad ).mul( 1 / ( 4 * Math.PI ) ) ).mul( powder );
							const Ts = exp( m.sum.mul( step ).negate() );
							col.addAssign( rad.mul( Ts.oneMinus() ).mul( T ) );
							T.mulAssign( Ts );
							wSum.addAssign( t.mul( T ) ); tSum.addAssign( T );
						} );
						If( T.lessThan( 0.01 ), () => { Break(); } );
						step.mulAssign( 1.012 );
						r.addAssign( step );
					} ).Else( () => {
						// empty air: longer steps, up to 900 m far away
						step.mulAssign( 1.012 );
						r.addAssign( mix( step, float( 900 ), mip.min( 1 ) ) );
					} );
				} );
				// the land's haze at the clouds' mean depth (aerial perspective)
				If( tSum.greaterThan( 0 ), () => {
					const front = wSum.div( tSum );
					const hz = hazeAmount( front, camPos.y.add( dir.y.mul( front ) ) ).mul( 1.25 ).clamp( 0, 1 );
					col.assign( mix( col, hazeColor.mul( 1.6 ).mul( T.oneMinus() ), hz ) );
				} );
			} );
			// The cirrus (layer z), above the cumulus: a short march of its own through the slab (the
			// main one would cross ~5 km of empty air to it), composited behind them. Thin: the light
			// toward the sun from a single optical depth estimate, the same phase and integration.
			If( this.cirrus.greaterThan( 0 ).and( T.greaterThan( 0.01 ) ), () => {
				const c0 = L.minH.z.sub( camPos.y ).div( dy ), c1 = L.maxH.z.sub( camPos.y ).div( dy );
				const cs = c0.min( c1 ).max( 0 ), ce = c0.max( c1 ).min( surf ).min( CIRRUS_DIST );
				If( ce.greaterThan( cs ), () => {
					const jit = fract( interleavedGradientNoise( screenCoordinate.xy ).add( this.frame.mul( 0.618034 ) ) );
					const cosT = dot( dir, sun );
					const hg = ( g ) => float( 1 - g * g ).div( float( 1 + g * g ).sub( cosT.mul( 2 * g ) ).max( 1e-7 ).pow( 1.5 ) ).mul( 1 / ( 4 * Math.PI ) );
					const phase = ( c ) => hg( 0.7 * c ).add( hg( - 0.2 * c ) ).mul( 0.5 );
					const ds = ce.sub( cs ).div( CIRRUS_STEPS );
					const cc = vec3( 0 ).toVar(), Tc = float( 1 ).toVar();
					const mid = cs.add( ce ).mul( 0.5 );
					const mip = log2( mid.div( 3000 ).max( 1 ) );
					const sunPath = float( 250 ).div( sun.y.max( 0.1 ) ).min( 2500 );
					for ( let k = 0; k < CIRRUS_STEPS; k ++ ) {
						const t = cs.add( ds.mul( jit.add( k ) ) );
						const p = camPos.add( dir.mul( t ) );
						const w = weatherAt( p, mip );
						const e = mediaAt( w, p, false ).d.z.mul( this.cirrus );
						const od = e.mul( sunPath );
						const ms = float( 0 ).toVar();
						let a = 1, b = 1, c = 1;
						for ( let o = 0; o < 4; o ++ ) { ms.addAssign( exp( od.mul( - b ) ).mul( phase( c ) ).mul( a ) ); a *= 0.5; b *= 0.5; c *= 0.5; }
						const rad = this.sunColor.mul( this.sunScale ).mul( ms ).add( this.ambient.mul( this.ambientScale ).mul( 1 / ( 4 * Math.PI ) ) );
						const Ts = exp( e.mul( ds ).negate() );
						cc.addAssign( rad.mul( Ts.oneMinus() ).mul( Tc ) );
						Tc.mulAssign( Ts );
					}
					// the haze toward them, then behind the cumulus
					const hz = hazeAmount( mid, camPos.y.add( dir.y.mul( mid ) ) ).mul( 1.25 ).clamp( 0, 1 );
					cc.assign( mix( cc, hazeColor.mul( 1.6 ).mul( Tc.oneMinus() ), hz ) );
					col.addAssign( cc.mul( T ) );
					T.mulAssign( Tc );
				} );
			} );
			return vec4( col, remap( T, 0.01, 1 ) );
		} );

		this.pass = rtt( march(), null, null, { type: THREE.HalfFloatType, resolutionScale } );
		this.smooth = new CloudHistory( this.pass, camera, resolutionScale, this.frame ).getTextureNode();

		// the Beer shadow map (world/cloudShadow.js): from each texel of the base plane, a march toward
		// the sun through the layers (cheap media: no detail, the weather's first mip); stores the first
		// cloud's distance from the march's start (the sunward end), the mean extinction past it, the
		// total optical depth
		this.camera = camera;
		this.mapEvery = 4; // frames between renders (the clouds move ~1 m in that time; a texel is 40 m)
		this._mapFrame = 0;
		this._mapCentre = new THREE.Vector2( Infinity, 0 );
		this._mapSun = new THREE.Vector3();
		const mapFrag = Fn( () => {
			const xz = uv().sub( 0.5 ).mul( CLOUD_MAP.span ).add( cloudMap.centre );
			const L = marchLength();
			const ds = L.div( MAP_STEPS );
			const start = vec3( xz.x, cloudMap.base, xz.y ).add( sun.mul( L ) );
			const od = float( 0 ).toVar(), front = float( - 1 ).toVar(), last = float( 0 ).toVar();
			Loop( MAP_STEPS, ( { i } ) => {
				const t = float( i ).add( 0.5 ).mul( ds );
				const p = start.sub( sun.mul( t ) );
				const e = mediaAt( weatherAt( p, float( 0 ) ), p, false ).sum;
				If( e.greaterThan( 1e-4 ), () => {
					If( front.lessThan( 0 ), () => { front.assign( t.sub( ds.mul( 0.5 ) ) ); } );
					last.assign( t.add( ds.mul( 0.5 ) ) );
				} );
				od.addAssign( e.mul( ds ) );
			} );
			const has = front.greaterThanEqual( 0 );
			return vec4( has.select( front, L ), od.div( last.sub( front ).max( ds ) ).mul( has.select( 1, 0 ) ), od, 1 );
		} );
		// Light shafts (the original's shadow length, here on this project's haze): along the view ray, the
		// haze each stretch adds (hazeAmount's increments) times how much of the sun the clouds take
		// there (the shadow map, as the clouds' own far shadow); the sum is the share of the haze in the
		// clouds' shadow, removed from the scene's haze in apply(). Steps crowd near the camera; jittered
		// and smoothed by a second temporal history.
		this.shafts = uniform( 1.5 );        // strength (0: off)
		this.shaftOpacity = uniform( 0.25 ); // per unit optical depth
		this.shaftSky = uniform( 0.6 );      // over the sky (the haze ends at SHAFT_DIST)
		this.shaftGlow = uniform( 1 );       // the lit haze's forward scattering toward the sun
		this.shaftDebug = uniform( 0 );      // 1: shows the shadowed (red) and lit (green) shares (x 4)
		const shaftFrag = Fn( () => {
			const depth = depthTex.sample( screenUV ).r;
			const vp = getViewPosition( screenUV, depth, camProjInv );
			const ray = camWorld.mul( vec4( vp, 1 ) ).xyz.sub( camPos );
			const sky = isSky( depth );
			const dir = ray.normalize();
			const L = sky.select( float( SHAFT_DIST ), ray.length().min( SHAFT_DIST ) );
			const jitter = fract( interleavedGradientNoise( screenCoordinate.xy ).add( this.frame.mul( 0.618034 ) ) );
			const S = float( 0 ).toVar(), Lt = float( 0 ).toVar(), hzPrev = float( 0 ).toVar();
			Loop( SHAFT_STEPS, ( { i } ) => {
				const f = float( i ).add( 1 ).div( SHAFT_STEPS );
				const t = L.mul( f.mul( f ) );
				const tm = L.mul( float( i ).add( jitter ).div( SHAFT_STEPS ).pow( 2 ) ); // inside the stretch
				const hz = hazeAmount( t, camPos.y.add( dir.y.mul( t ) ) );
				const p = camPos.add( dir.mul( tm ) );
				const look = mapLookup( p );
				const bsm = cloudMap.tex.sample( look.st ).level( 0 );
				const fromFront = marchLength().sub( p.y.sub( cloudMap.base ).div( sunUp() ) ).sub( bsm.x );
				const od = bsm.y.mul( fromFront.max( 0 ) ).min( bsm.z ).mul( look.inside );
				const dh = hz.sub( hzPrev ).max( 0 ), sunlit = exp( od.mul( this.shaftOpacity ).negate() );
				S.addAssign( dh.mul( sunlit.oneMinus() ) );
				Lt.addAssign( dh.mul( sunlit ) );
				hzPrev.assign( hz );
			} );
			const k = sky.select( this.shaftSky, float( 1 ) );
			return vec4( S.mul( k ), Lt.mul( k ), 0, 1 );
		} );
		this.shaftPass = rtt( shaftFrag(), null, null, { type: THREE.HalfFloatType, resolutionScale } );
		this.shaftSmooth = new CloudHistory( this.shaftPass, camera, resolutionScale, null ).getTextureNode();
		this.hazeColor = hazeColor;
		this.sun = sun;
		this.depthTex = depthTex;
		// The sparse haze (the original's approximateHaze): a density falling exponentially with the
		// height, integrated in closed form along the view ray (no march), in front of the scene and the
		// clouds; lit by the sun (dual-lobe phase, the share of the ray in the clouds' shadow taken out,
		// from the shafts' pass) and by the sky. Per pixel in apply().
		this.haze = uniform( 1e-5 );          // extinction at sea level, 1/m (the original: 3e-5; our haze already exists)
		this.hazeExponent = uniform( 1e-3 );  // 1/m: a scale height of 1 km
		this.hazeScattering = 0.9; this.hazeAbsorption = 0.5;
		this.sunVisible = uniform( 1 ); // the sun's light share (main.js: with its height, the rain)

		this._mapMat = new THREE.NodeMaterial();
		this._mapMat.name = 'cloudsShadowMap';
		this._mapMat.fragmentNode = mapFrag();
		this._mapQuad = new THREE.QuadMesh( this._mapMat );
	}

	update( dt ) { this.time.value += dt; }

	// The cumulus thin out as the cover closes (the rain's 0.95, the panel past 60%): at the high cover
	// the weather fills the layer, the shape stops carving it (remap( 1, 1 - shape, 1 ) is 1) and at
	// 0.2/m a few tens of metres turn opaque. The rain sky was a flat grey plate cut out with crisp,
	// polygon-like edges and bright thin rims. At 0.06/m the deck is soft, its edges translucent.
	overcast() {
		const c = this.coverage.value;
		const k = THREE.MathUtils.smoothstep( c, 0.6, 0.95 );
		const ds = this.layers.densityScale.value;
		ds.x = ds.y = THREE.MathUtils.lerp( this.fairDensity, 0.06, k );
	}

	// the shadow map, before the scene pass (app.renderFrame): every few frames, or at once when the
	// camera's projection moves the map by a texel or the sun turns
	renderShadow( renderer ) {
		cloudMap.base.value = this.base.value; cloudMap.top.value = this.top.value;
		const sun = cloudMap.sun.value;
		const c = mapCentreFor( this.camera.position.x, this.camera.position.z, sun, this.base.value );
		const moved = ! c.equals( this._mapCentre ) || sun.angleTo( this._mapSun ) > 0.002;
		if ( ! moved && ++ this._mapFrame < this.mapEvery ) return;
		this._mapFrame = 0;
		this._mapCentre.copy( c ); this._mapSun.copy( sun );
		cloudMap.centre.value.copy( c );
		const prev = renderer.getRenderTarget();
		renderer.setRenderTarget( cloudMap.rt );
		this._mapQuad.render( renderer );
		renderer.setRenderTarget( prev );
	}

	// src: the scene colour (HDR); the clouds laid over it
	apply( src ) {
		const c = this.smooth;
		const s = this.strength;
		// the shafts: the sun's part of the haze taken where the clouds shade it, more toward the sun
		// (forward scattering)
		const camWorld = uniform( this.camera.matrixWorld ), camProjInv = uniform( this.camera.projectionMatrixInverse );
		const dir = camWorld.mul( vec4( getViewPosition( screenUV, float( 1 ), camProjInv ), 0 ) ).xyz.normalize();
		const cosT = dot( dir, this.sun );
		// Henyey-Greenstein g = 0.7 (the haze's forward lobe), per 4 pi
		const mie = float( 0.51 ).div( float( 1.49 ).sub( cosT.mul( 1.4 ) ).pow( 1.5 ) ).mul( 1 / ( 4 * Math.PI ) );
		const k = this.shafts.mul( this.sunVisible ).mul( s );
		const sh = this.shaftSmooth;
		const shade = sh.r.mul( cosT.max( 0 ).pow( 6 ).mul( 2 ).add( 0.4 ) ).mul( k );
		const glow = this.sunColor.mul( sh.g.mul( mie ).mul( this.shaftGlow ).mul( k ) );
		const lit = src.sub( this.hazeColor.mul( shade ) ).max( src.mul( 0.25 ) ).add( glow );
		const clouded = lit.mul( mix( float( 1 ), c.a, s ) ).add( c.rgb.mul( s ) );
		// the sparse haze over all of it: optical depth from the camera's height along the ray, to the
		// surface or HAZE_DIST over the sky
		const depth = this.depthTex.sample( screenUV ).r;
		const dist = isSky( depth ).select( float( HAZE_DIST ), getViewPosition( screenUV, depth, camProjInv ).length().min( HAZE_DIST ) );
		const camY = camWorld.mul( vec4( 0, 0, 0, 1 ) ).y.max( 0 );
		const a = this.hazeExponent, ay = a.mul( dir.y );
		const ext0 = this.haze.mul( exp( a.mul( camY ).negate() ) );
		// (1 - e^(-a y t)) / (a y), t when a y -> 0
		const path = ay.abs().lessThan( 1e-6 ).select( dist, exp( ay.mul( dist ).negate() ).oneMinus().div( ay ) );
		const od = ext0.mul( path ).mul( this.hazeScattering + this.hazeAbsorption ).mul( s );
		const Th = exp( od.negate() );
		const hg = ( g ) => float( 1 - g * g ).div( float( 1 + g * g ).sub( cosT.mul( 2 * g ) ).max( 1e-7 ).pow( 1.5 ) ).mul( 1 / ( 4 * Math.PI ) );
		const sunLit = sh.g.div( sh.r.add( sh.g ).max( 1e-4 ) ).mul( sh.r.add( sh.g ).greaterThan( 1e-4 ).select( 1, 0 ) ).add( sh.r.add( sh.g ).lessThanEqual( 1e-4 ).select( 1, 0 ) );
		const Lh = this.sunColor.mul( this.sunScale ).mul( hg( 0.7 ).add( hg( - 0.2 ) ).mul( 0.5 ) ).mul( sunLit ).mul( this.sunVisible )
			.add( this.ambient.mul( this.ambientScale ).mul( 1 / ( 4 * Math.PI ) ) )
			.mul( this.hazeScattering / ( this.hazeScattering + this.hazeAbsorption ) ).mul( Th.oneMinus() );
		const hazed = clouded.mul( Th ).add( Lh );
		return mix( hazed, vec3( sh.r, sh.g, 0 ).mul( 4 ), this.shaftDebug );
	}
}

// ---- the temporal filter: ping-pong history (as three's AfterImageNode) ----
const _size = new THREE.Vector2(), _quad = new THREE.QuadMesh();
let _state;

class CloudHistory extends THREE.TempNode {

	// frame: the march's jitter index, advanced here at every render (also with the clouds frozen, as
	// tools/verify.mjs does: a still jitter shows the raw march's noise)
	constructor( input, camera, resolutionScale, frame ) {
		super( 'vec4' );
		this.frame = frame;
		this.input = convertToTexture( input );
		this.camera = camera;
		this.scale = resolutionScale;
		const opts = { depthBuffer: false, type: THREE.HalfFloatType };
		this._rtA = new THREE.RenderTarget( 1, 1, opts ); this._rtA.texture.name = 'clouds.historyA';
		this._rtB = new THREE.RenderTarget( 1, 1, opts ); this._rtB.texture.name = 'clouds.historyB';
		this._out = passTexture( this, this._rtA.texture );
		this._old = texture( this._rtB.texture );
		this._prevView = new THREE.Matrix4(); this._prevProj = new THREE.Matrix4();
		this.prevView = uniform( this._prevView ); this.prevProj = uniform( this._prevProj );
		this.reset = uniform( 1 );
		this._material = null;
		this.updateBeforeType = THREE.NodeUpdateType.FRAME;
	}

	getTextureNode() { return this._out; }

	updateBefore( frame ) {
		const { renderer } = frame;
		_state = THREE.RendererUtils.resetRendererState( renderer, _state );
		renderer.getDrawingBufferSize( _size );
		const w = Math.max( 1, Math.round( _size.x * this.scale ) ), h = Math.max( 1, Math.round( _size.y * this.scale ) );
		if ( this._rtA.width !== w || this._rtA.height !== h ) { this._rtA.setSize( w, h ); this._rtB.setSize( w, h ); this.reset.value = 1; }
		this._out.value = this._rtA.texture;
		this._old.value = this._rtB.texture;
		_quad.material = this._material;
		renderer.setRenderTarget( this._rtA );
		_quad.render( renderer );
		this.reset.value = 0;
		if ( this.frame ) this.frame.value = ( this.frame.value + 1 ) % 1024;
		// the view of this frame, for the next one's reprojection
		this._prevView.copy( this.camera.matrixWorldInverse );
		this._prevProj.copy( this.camera.projectionMatrix );
		const t = this._rtA; this._rtA = this._rtB; this._rtB = t;
		THREE.RendererUtils.restoreRendererState( renderer, _state );
	}

	setup( builder ) {
		const cur = this.input, old = this._old, camera = this.camera;
		const camWorld = uniform( camera.matrixWorld ), camProjInv = uniform( camera.projectionMatrixInverse );
		const resolve = Fn( () => {
			const st = uv();
			const c = cur.sample( st ).toVar();
			// the new frame's neighbourhood: the history is clamped into it
			const px = vec2( 1 ).div( vec2( cur.size( 0 ) ) );
			const lo = c.toVar(), hi = c.toVar();
			for ( const [ dx, dy ] of [ [ - 1, - 1 ], [ 0, - 1 ], [ 1, - 1 ], [ - 1, 0 ], [ 1, 0 ], [ - 1, 1 ], [ 0, 1 ], [ 1, 1 ] ] ) {
				const n = cur.sample( st.add( px.mul( vec2( dx, dy ) ) ) );
				lo.assign( min( lo, n ) ); hi.assign( max( hi, n ) );
			}
			// where this pixel's ray pointed last frame (a point 4 km out: the clouds' distance)
			const vdir = getViewPosition( st, float( 1 ), camProjInv ).normalize();
			const wdir = camWorld.mul( vec4( vdir, 0 ) ).xyz;
			const P = camWorld.mul( vec4( 0, 0, 0, 1 ) ).xyz.add( wdir.mul( 4000 ) );
			const pv = this.prevView.mul( vec4( P, 1 ) ).xyz;
			const pst = getScreenPosition( pv, this.prevProj );
			const inside = pst.x.greaterThan( 0 ).and( pst.x.lessThan( 1 ) ).and( pst.y.greaterThan( 0 ) ).and( pst.y.lessThan( 1 ) ).and( pv.z.lessThan( 0 ) );
			const h = old.sample( pst ).clamp( lo, hi );
			const a = inside.and( this.reset.lessThan( 0.5 ) ).select( float( 0.1 ), float( 1 ) );
			return mix( h, c, a );
		} );
		const m = this._material || ( this._material = new THREE.NodeMaterial() );
		m.name = 'cloudsHistory';
		m.fragmentNode = resolve();
		builder.getNodeProperties( this ).input = cur;
		return this._out;
	}

	dispose() {
		super.dispose();
		this._rtA.dispose(); this._rtB.dispose();
		this._material?.dispose();
	}

}
