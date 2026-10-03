// Volumetric cumulus: a layer of clouds between BASE and BASE + THICK metres, raymarched per pixel at
// reduced resolution (like post/mist.js) and laid over the scene. The shape is a Perlin-Worley noise
// (billows) eroded by a Worley fbm (the cauliflower edges), both in one tileable 3D texture made on the
// CPU, under a coverage map: few clouds in fair weather, a closed sky in the rain (the sky's
// cloudCoverage, the panel's "Nuvens"). Flat bases, rounded tops. Lit by the sun through a short march
// toward it (Beer-Lambert with the powder term for the dark edges) with a forward and a back scattering
// lobe, plus the sky's light from above; the distance hazes them like the land. The march stops at the
// scene's depth, so the mountains stand in front of the clouds behind them.
// The technique follows the well-known recipe (Schneider, "The real-time volumetric cloudscapes of
// Horizon: Zero Dawn", SIGGRAPH 2015); the code is ours. app.clouds: coverage, density, sunScale,
// ambientScale, base, thick, strength; ?clouds=0 leaves the pass out.
import * as THREE from 'three/webgpu';
import {
	Fn, If, Loop, Break, float, mix, vec2, vec3, vec4, uniform, texture3D, screenUV, screenCoordinate, getViewPosition, interleavedGradientNoise, rtt, dot, exp, max, smoothstep
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { cacheGet, cachePut, hashSources } from '../core/cache.js';
import srcClouds from './clouds.js?raw';

const SIZE = 64, STEPS = 40, LIGHT_STEPS = 5, MAX_DIST = 60000;

// ---- the noise texture: R Perlin-Worley (shape), G Worley fbm (erosion); all periodic over the tile ----
function makeNoise( size = SIZE ) {
	const t0 = performance.now();
	let seed = 1337;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	// Worley: one feature point per cell of an f³ grid, distance to the nearest, wrapped
	const worley = ( f ) => {
		const pts = new Float32Array( f * f * f * 3 );
		for ( let i = 0; i < pts.length; i ++ ) pts[ i ] = rnd();
		const out = new Float32Array( size * size * size );
		let k = 0;
		for ( let z = 0; z < size; z ++ ) for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {
			const px = x / size * f, py = y / size * f, pz = z / size * f;
			const cx = Math.floor( px ), cy = Math.floor( py ), cz = Math.floor( pz );
			let d2 = 9;
			for ( let dz = - 1; dz <= 1; dz ++ ) for ( let dy = - 1; dy <= 1; dy ++ ) for ( let dx = - 1; dx <= 1; dx ++ ) {
				const gx = cx + dx, gy = cy + dy, gz = cz + dz;
				const i = ( ( ( gz % f + f ) % f ) * f * f + ( ( gy % f + f ) % f ) * f + ( ( gx % f + f ) % f ) ) * 3;
				const qx = gx + pts[ i ] - px, qy = gy + pts[ i + 1 ] - py, qz = gz + pts[ i + 2 ] - pz;
				const d = qx * qx + qy * qy + qz * qz;
				if ( d < d2 ) d2 = d;
			}
			out[ k ++ ] = 1 - Math.min( 1, Math.sqrt( d2 ) ); // inverted: 1 at the points (billows)
		}
		return out;
	};
	// Perlin (gradient) noise with period f
	const perlin = ( f ) => {
		const g = new Float32Array( f * f * f * 3 );
		for ( let i = 0; i < f * f * f; i ++ ) {
			const a = rnd() * Math.PI * 2, zc = rnd() * 2 - 1, r = Math.sqrt( 1 - zc * zc );
			g[ i * 3 ] = r * Math.cos( a ); g[ i * 3 + 1 ] = r * Math.sin( a ); g[ i * 3 + 2 ] = zc;
		}
		const fade = ( t ) => t * t * t * ( t * ( t * 6 - 15 ) + 10 );
		const out = new Float32Array( size * size * size );
		let k = 0;
		for ( let z = 0; z < size; z ++ ) for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {
			const px = x / size * f, py = y / size * f, pz = z / size * f;
			const cx = Math.floor( px ), cy = Math.floor( py ), cz = Math.floor( pz );
			const fx = px - cx, fy = py - cy, fz = pz - cz;
			const dotc = ( ix, iy, iz ) => {
				const i = ( ( ( cz + iz ) % f ) * f * f + ( ( cy + iy ) % f ) * f + ( ( cx + ix ) % f ) ) * 3;
				return g[ i ] * ( fx - ix ) + g[ i + 1 ] * ( fy - iy ) + g[ i + 2 ] * ( fz - iz );
			};
			const u = fade( fx ), v = fade( fy ), w = fade( fz );
			const l = ( a, b, t ) => a + ( b - a ) * t;
			out[ k ++ ] = l( l( l( dotc( 0, 0, 0 ), dotc( 1, 0, 0 ), u ), l( dotc( 0, 1, 0 ), dotc( 1, 1, 0 ), u ), v ),
				l( l( dotc( 0, 0, 1 ), dotc( 1, 0, 1 ), u ), l( dotc( 0, 1, 1 ), dotc( 1, 1, 1 ), u ), v ), w );
		}
		return out;
	};
	const w4 = worley( 4 ), w8 = worley( 8 ), w16 = worley( 16 );
	const p4 = perlin( 4 ), p8 = perlin( 8 ), p16 = perlin( 16 );
	const n = size * size * size, data = new Uint8Array( n * 2 );
	const clamp01 = ( v ) => Math.min( 1, Math.max( 0, v ) );
	for ( let i = 0; i < n; i ++ ) {
		const wf = w4[ i ] * 0.625 + w8[ i ] * 0.25 + w16[ i ] * 0.125;
		const pf = clamp01( ( p4[ i ] + p8[ i ] * 0.5 + p16[ i ] * 0.25 ) * 0.7 + 0.5 );
		// Perlin-Worley: the Perlin fbm remapped by the Worley (billowy, connected)
		const pw = clamp01( ( pf - ( 1 - wf ) ) / ( 1 - ( 1 - wf ) * 0.999 ) * 0.5 + pf * 0.5 );
		data[ i * 2 ] = Math.round( clamp01( pw ) * 255 );
		data[ i * 2 + 1 ] = Math.round( clamp01( w8[ i ] * 0.625 + w16[ i ] * 0.375 ) * 255 );
	}
	console.info( 'cloud noise (ms)', Math.round( performance.now() - t0 ) );
	return data;
}

// the noise texels, from the IndexedDB cache (core/cache.js) when this file has not changed: ~0.26 s
// of the main thread at every load otherwise
export async function loadCloudNoise() {
	const key = 'clouds:' + hashSources( srcClouds );
	const cached = await cacheGet( key );
	if ( cached?.data?.length === SIZE * SIZE * SIZE * 2 ) return cached.data;
	const data = makeNoise();
	cachePut( key, { data }, 'clouds:' );
	return data;
}

function noiseTexture( data, size = SIZE ) {
	const tex = new THREE.Data3DTexture( data, size, size, size );
	tex.format = THREE.RGFormat;
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
	tex.unpackAlignment = 1;
	tex.needsUpdate = true;
	return tex;
}

export class Clouds {

	// noise (loadCloudNoise()), scenePass (its depth), camera, hazeAmount( d, y ) (the land's haze),
	// hazeColor (uniform), sunDir (vector, followed by reference)
	constructor( { noise: noiseData, scenePass, camera, hazeAmount, hazeColor, sunDir, resolutionScale = 0.5 } ) {
		const noise = noiseTexture( noiseData ?? makeNoise() );
		this.strength = uniform( 1 );            // 0: off (under the water)
		this.coverage = uniform( 0.55 );         // the sky's cloudCoverage (main.js keeps them together)
		this.density = uniform( 0.12 );         // extinction per metre in the densest core
		this.base = uniform( 1100 ); this.thick = uniform( 900 );
		this.shapeScale = uniform( 1 / 2600 );   // m: one tile of the shape noise
		this.detailScale = uniform( 1 / 420 );
		this.erosion = uniform( 0.45 );
		this.mapScale = uniform( 1 / 14000 );    // the coverage map (where the clouds are)
		this.sunColor = uniform( new THREE.Color( 1, 0.95, 0.85 ) );
		this.sunScale = uniform( 7 );
		this.ambient = uniform( new THREE.Color( 0.55, 0.65, 0.8 ) );
		this.ambientScale = uniform( 1.1 );
		this.time = uniform( 0 );
		// the cumulus drift and change shape: a wind at the cloud level (m/s; 8 was too slow to see a few
		// km away), the shape noise walked through its third axis (tiles per second: they grow and fade
		// over minutes; a rigid stamp before) and the erosion of the edges
		this.windSpeed = uniform( 18 );
		this.evolve = uniform( 0.0012 );
		this.detailEvolve = uniform( 0.006 );
		const sun = uniform( sunDir );
		const camWorld = uniform( camera.matrixWorld ), camProjInv = uniform( camera.projectionMatrixInverse ), camPos = uniform( camera.position );
		this.camPos = camPos;
		const depthTex = scenePass.getTextureNode( 'depth' );
		// the wind from the south-west
		const wind = vec3( 0.7071, 0, - 0.7071 ).mul( this.time.mul( this.windSpeed ) );
		const morph = vec3( 0, this.time.mul( this.evolve ), 0 );

		const remap = ( v, a, b ) => v.sub( a ).div( b.sub( a ).max( 1e-4 ) ).clamp( 0, 1 );
		// density at p (0..1) and the height fraction in the layer
		const density = ( p, cheap ) => {
			const h = p.y.sub( this.base ).div( this.thick ).clamp( 0, 1 );
			const q = p.add( wind );
			// where: a low-frequency map from a slice of the noise, cut by the coverage
			const m = texture3D( noise, vec3( q.xz.mul( this.mapScale ), 0.37 ).xzy ).level( 0 );
			const cov = remap( m.r.mul( 0.75 ).add( m.g.mul( 0.25 ) ), this.coverage.oneMinus().mul( 0.95 ), this.coverage.oneMinus().mul( 0.95 ).add( 0.25 ) );
			// the cumulus profile: a flat base, a dome narrowing upwards (more so where the cover is thin)
			const grad = smoothstep( 0, 0.08, h ).mul( smoothstep( cov.mul( 0.7 ).add( 0.25 ), 0.15, h ) );
			const shape = texture3D( noise, q.mul( this.shapeScale ).add( morph ) ).level( 0 ).r;
			let d = remap( shape.mul( grad ), cov.oneMinus(), float( 1 ) ).mul( cov );
			// an overcast sky (the rain) closes into one sheet, thinner toward the top
			d = max( d, smoothstep( 0.75, 0.95, this.coverage ).mul( shape.mul( 0.5 ).add( 0.3 ) ).mul( smoothstep( 0, 0.1, h ) ).mul( smoothstep( 0.9, 0.3, h ) ) );
			if ( ! cheap ) {
				// erosion by the Worley fbm, wispier at the base, billowing at the top
				const det = texture3D( noise, q.mul( this.detailScale ).add( vec3( 0, this.time.mul( this.detailEvolve ), 0 ) ) ).level( 0 ).g;
				d = remap( d, mix( det.oneMinus(), det, h.mul( 3 ).clamp( 0, 1 ) ).mul( this.erosion ), float( 1 ) );
			}
			return d;
		};

		const march = Fn( () => {
			const depth = depthTex.sample( screenUV ).r;
			const vp = getViewPosition( screenUV, depth, camProjInv );
			const target = camWorld.mul( vec4( vp, 1 ) ).xyz;
			const ray = target.sub( camPos );
			const surf = depth.greaterThanEqual( 0.99999 ).select( float( 1e9 ), ray.length() );
			const dir = ray.normalize();
			const top = this.base.add( this.thick );
			const dy = dir.y.greaterThanEqual( 0 ).select( dir.y.max( 1e-5 ), dir.y.min( - 1e-5 ) );
			const t0 = this.base.sub( camPos.y ).div( dy ), t1 = top.sub( camPos.y ).div( dy );
			const tStart = t0.min( t1 ).max( 0 );
			const tEnd = t0.max( t1 ).min( surf ).min( MAX_DIST );
			const len = tEnd.sub( tStart ).max( 0 );
			const col = vec3( 0 ).toVar(), T = float( 1 ).toVar();
			If( len.greaterThan( 1 ), () => {
				const stepLen = len.div( STEPS );
				const jitter = interleavedGradientNoise( screenCoordinate.xy );
				// the phase: a forward lobe (silver lining toward the sun) and a softer back lobe
				const cosT = dot( dir, sun );
				const hg = ( g ) => float( 1 - g * g ).div( float( 1 + g * g ).sub( cosT.mul( 2 * g ) ).pow( 1.5 ) ).mul( 1 / ( 4 * Math.PI ) );
				const phase = mix( hg( - 0.15 ), hg( 0.75 ), 0.45 ).mul( 4 * Math.PI ).max( 0.35 );
				Loop( STEPS, ( { i } ) => {
					If( T.lessThan( 0.02 ), () => { Break(); } );
					const t = tStart.add( float( i ).add( jitter ).mul( stepLen ) );
					const p = camPos.add( dir.mul( t ) );
					const d = density( p, false );
					If( d.greaterThan( 0.002 ), () => {
						// toward the sun: optical depth over ~1 km in growing steps
						const od = float( 0 ).toVar();
						for ( let k = 0; k < LIGHT_STEPS; k ++ ) {
							const lt = ( k + 0.5 ) * ( k + 1 ) * 38;
							od.addAssign( density( p.add( sun.mul( lt ) ), true ).mul( ( k + 1 ) * 76 ) );
						}
						const sigma = d.mul( this.density );
						const beer = exp( od.mul( this.density ).negate() );
						const powder = exp( od.mul( this.density ).mul( - 2 ) ).oneMinus().mul( 0.7 ).add( 0.3 );
						const h = p.y.sub( this.base ).div( this.thick ).clamp( 0, 1 );
						const lit = this.sunColor.mul( this.sunScale ).mul( beer.mul( powder ).mul( phase ) )
							.add( this.ambient.mul( this.ambientScale ).mul( h.mul( 0.6 ).add( 0.4 ) ) );
						// hazed with the distance like the land
						const lum = mix( lit, hazeColor.mul( 1.6 ), hazeAmount( t, p.y ).mul( 1.25 ).clamp( 0, 1 ) );
						const a = exp( sigma.mul( stepLen ).negate() );
						col.addAssign( T.mul( lum ).mul( a.oneMinus() ) );
						T.mulAssign( a );
					} );
				} );
			} );
			return vec4( col, T );
		} );

		this.pass = rtt( march(), null, null, { type: THREE.HalfFloatType, resolutionScale } );
		this.smooth = gaussianBlur( this.pass, vec2( 1 ), 1, { resolutionScale } );
	}

	update( dt ) { this.time.value += dt; }

	// src: the scene colour (HDR); the clouds laid over it
	apply( src ) {
		const c = this.smooth;
		const s = this.strength;
		return src.mul( mix( float( 1 ), c.a, s ) ).add( c.rgb.mul( s ) );
	}
}
