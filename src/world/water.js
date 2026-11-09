import * as THREE from 'three/webgpu';
import {
	Fn, uniform, texture, positionWorld, cameraPosition, time, reflector,
	vec2, vec3, float, color, mix, smoothstep, clamp, max, pow, dot, normalize, reflect, length, sin, cos, fract,
	mx_noise_float, pmremTexture, exp
} from 'three/tsl';
import { PlanarReprojection } from './planarReprojection.js';
import { rainRipples } from './rainImpacts.js';
import { WATER_LEVEL } from './layout.js';

// in-place radix-2 inverse FFT of n complex values at re/im[ off + i * stride ] (unnormalised)
function ifft1( re, im, n, off, stride ) {
	for ( let i = 1, j = 0; i < n; i ++ ) {
		let bit = n >> 1;
		for ( ; j & bit; bit >>= 1 ) j ^= bit;
		j ^= bit;
		if ( i < j ) {
			const a = off + i * stride, b = off + j * stride;
			let t = re[ a ]; re[ a ] = re[ b ]; re[ b ] = t;
			t = im[ a ]; im[ a ] = im[ b ]; im[ b ] = t;
		}
	}
	for ( let len = 2; len <= n; len <<= 1 ) {
		const ang = 2 * Math.PI / len, half = len >> 1;
		for ( let i = 0; i < n; i += len ) for ( let j = 0; j < half; j ++ ) {
			const wr = Math.cos( ang * j ), wi = Math.sin( ang * j );
			const a = off + ( i + j ) * stride, b = a + half * stride;
			const tr = wr * re[ b ] - wi * im[ b ], ti = wr * im[ b ] + wi * re[ b ];
			re[ b ] = re[ a ] - tr; im[ b ] = im[ a ] - ti;
			re[ a ] += tr; im[ a ] += ti;
		}
	}
}

// Tileable wave-slope texture from a directional wind-sea spectrum (after NeuralSpecOcean's
// SpectralWaves.js, https://github.com/bgbg108555/NeuralSpecOcean, MIT, Copyright (c) 2026 bgbg108555,
// licenses/LICENSE-NeuralSpecOcean.md): every integer wave vector up to kMax harmonics per tile gets a
// Gaussian amplitude from a Phillips spectrum (k^-4, the peak at kPeak, a smooth roll-off before the
// tile's Nyquist) times a broad directional spreading around `dir` (cos^2s of the angle to the wind
// axis plus a floor: a natural fan of crests, not the diamond lattice of a few crossing sines). The
// slopes i k H come out of one complex inverse FFT (Sx + i Sz, the height spectrum made Hermitian).
// The integer wave vectors make it wrap perfectly. RG store d(h)/dx, d(h)/dz.
// opts: dir (the wind axis in texture space, radians; 0 = crests along v), spread (cos power; low =
// broad), floor (the share of energy in every direction), kPeak, kMax.
export function createWaveTexture( size = 256, seed = 7, opts = {} ) {
	const { dir = 0, spread = 3, floor = 0.18, kPeak = 3.5, kMax = 56 } = opts;
	let s = seed;
	const rnd = () => ( s = ( s * 16807 ) % 2147483647 ) / 2147483647;
	const gauss = () => Math.sqrt( - 2 * Math.log( rnd() + 1e-12 ) ) * Math.cos( 2 * Math.PI * rnd() );
	const n = size, N = n * n;
	const hr = new Float32Array( N ), hi = new Float32Array( N );
	const cd = Math.cos( dir ), sd = Math.sin( dir );
	for ( let y = 0; y < n; y ++ ) for ( let x = 0; x < n; x ++ ) {
		const kx = x <= n / 2 ? x : x - n, kz = y <= n / 2 ? y : y - n;
		const k = Math.hypot( kx, kz );
		if ( k === 0 || k > kMax ) continue;
		const c = Math.abs( kx * cd + kz * sd ) / k; // |cos| of the angle to the wind axis
		const D = floor + ( 1 - floor ) * Math.pow( c, 2 * spread );
		const taper = Math.exp( - ( k * k ) / ( kMax * kMax * 0.35 ) );
		const P = Math.exp( - ( kPeak * kPeak ) / ( k * k ) ) / ( k * k * k * k ) * D * taper;
		const a = Math.sqrt( P * 0.5 );
		hr[ y * n + x ] = gauss() * a; hi[ y * n + x ] = gauss() * a;
	}
	// Hermitian height spectrum (a real height field): Hs(k) = ( H(k) + conj H(-k) ) / 2; slopes
	// packed as A = i kx Hs + i ( i kz Hs ), whose inverse transform is Sx + i Sz
	const re = new Float32Array( N ), im = new Float32Array( N );
	for ( let y = 0; y < n; y ++ ) for ( let x = 0; x < n; x ++ ) {
		const i = y * n + x, j = ( ( n - y ) % n ) * n + ( ( n - x ) % n );
		const sr = ( hr[ i ] + hr[ j ] ) / 2, si = ( hi[ i ] - hi[ j ] ) / 2;
		const kx = x <= n / 2 ? x : x - n, kz = y <= n / 2 ? y : y - n;
		const ok = x !== n / 2 && y !== n / 2; // the Nyquist row/column has no partner
		re[ i ] = ok ? - kx * si - kz * sr : 0;
		im[ i ] = ok ? kx * sr - kz * si : 0;
	}
	for ( let y = 0; y < n; y ++ ) ifft1( re, im, n, y * n, 1 );
	for ( let x = 0; x < n; x ++ ) ifft1( re, im, n, x, n );
	const data = new Uint8Array( N * 4 );
	// scaled to 3 standard deviations (a Gaussian field's rare extremes, clamped, would flatten the rest)
	let v2 = 0;
	for ( let k = 0; k < N; k ++ ) v2 += re[ k ] * re[ k ] + im[ k ] * im[ k ];
	const range = 3 * Math.sqrt( v2 / ( 2 * N ) );
	const q = ( v ) => Math.max( 0, Math.min( 255, ( v / range * 0.5 + 0.5 ) * 255 ) );
	for ( let k = 0; k < N; k ++ ) {
		data[ k * 4 ] = q( re[ k ] );
		data[ k * 4 + 1 ] = q( im[ k ] );
		data[ k * 4 + 2 ] = 128; data[ k * 4 + 3 ] = 255;
	}
	const tex = new THREE.DataTexture( data, size, size, THREE.RGBAFormat );
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true;
	tex.needsUpdate = true;
	return tex;
}

// The coastal swell on the sea plane, after NeuralSpecOcean's CoastalWaves.js
// (https://github.com/bgbg108555/NeuralSpecOcean, MIT, Copyright (c) 2026 bgbg108555,
// licenses/LICENSE-NeuralSpecOcean.md): three swell trains at the phase w (t - tau) of the travel time
// over the bed (world/surf.js), so the crests bend round the coast and come in square to it; each has
// the skewed shoaling profile of a wave about to break (a steep front, a long back; steeper in the
// shallows), the wave groups of a swell (sets and lulls), the shoaling gain (Green's law, h^-1/4) and
// the depth limit. The sea stays a plane: the swell is its slope (the normal) and the white water.
// The breaking lip shows where the local wave height nears the depth limit (Miche / McCowan,
// H ~ 0.64-0.78 d) on the crest's front and its long trailing roller.
// Returns { slope (dh/dx, dh/dz), lip (0..~1.3), run (0..1: a wave running up the shore), dir (the
// crests' travel direction) }.
function coastalSurf( surfTex, huv, insideT, depth, U ) {
	const su = surfTex.userData;
	U.surf = uniform( 1.6 ); // the swell's height (0: none; 1: NeuralSpecOcean's)
	const sv = texture( surfTex, huv );
	const reach = sv.a.mul( insideT );
	const tau = sv.r.add( float( su.X0 ).sub( positionWorld.x ).div( su.c0 ) );
	const gT = sv.gb; // grad tau (s/m)
	const dir = gT.div( max( length( gT ), 1e-4 ) );
	const wp = positionWorld;
	const t = time.add( 3.05 );
	// only near the coast (out at sea the swell is part of the spectral slopes)
	const coast = smoothstep( 4.0, 14.0, depth ).oneMinus().mul( reach );
	const d0 = depth;
	const shoal = clamp( pow( float( 1.98 ).div( max( d0, 0.24 ) ), 0.28 ), 1.0, 1.9 );
	const lim = clamp( d0.div( 0.42 ), 0.0, 1.0 );
	const skew = mix( 0.24, 0.88, smoothstep( 0.16, 2.45, d0 ).oneMinus() );
	// crests broken along their length (static bends in the phase) and sets that vary along the coast
	const bend = mx_noise_float( wp.xz.div( 38 ) ).mul( 1.4 ).add( mx_noise_float( wp.xz.div( 11 ).add( 7.7 ) ).mul( 0.35 ) );
	const along = mx_noise_float( wp.xz.div( 90 ).add( 3.1 ) ).mul( 3.0 );
	// one train: elevation, d(elevation)/d(phase), the breaking lip
	const train = ( w, ph, sk ) => {
		const W = ph.add( sk.mul( sin( ph ) ) ).add( sk.mul( sk ).mul( 0.34 ).mul( sin( ph.mul( 2 ) ) ) );
		const dW = float( 1 ).add( sk.mul( cos( ph ) ) ).add( sk.mul( sk ).mul( 0.68 ).mul( cos( ph.mul( 2 ) ) ) );
		const s = sin( W );
		const e = s.add( sk.mul( 0.33 ).mul( s.mul( s ).sub( 0.5 ) ) ).add( sk.mul( sk ).mul( 0.12 ).mul( s.mul( s ).mul( s ).sub( s.mul( 0.75 ) ) ) );
		const dE = cos( W ).mul( float( 1 ).add( sk.mul( 0.66 ).mul( s ) ).add( sk.mul( sk ).mul( 0.12 ).mul( s.mul( s ).mul( 3 ).sub( 0.75 ) ) ) ).mul( dW );
		const u = fract( W.div( 6.2831853 ) );
		const lip = smoothstep( 0.03, 0.22, u ).mul( pow( smoothstep( 0.21, 0.84, u ).oneMinus(), 1.75 ) ).mul( smoothstep( - 0.18, 0.58, e ).mul( 0.55 ).add( 0.45 ) );
		return { e, dE, lip };
	};
	const w1 = 2 * Math.PI / 7.1, w2 = 2 * Math.PI / 6.55, w3 = 2 * Math.PI / 4.75;
	const p1 = t.sub( tau ).mul( w1 ).add( bend );
	const p2 = t.sub( tau.mul( 0.985 ) ).mul( w2 ).sub( bend.mul( 0.65 ) ).add( 1.35 );
	const p3 = t.sub( tau.mul( 1.045 ) ).mul( w3 ).add( bend.mul( 0.8 ) ).add( 2.6 );
	const env1 = clamp( float( 0.68 ).add( sin( t.mul( 0.21 ).sub( tau.mul( 0.16 ) ).add( along ) ).mul( 0.34 ) ).add( cos( t.mul( 0.13 ).sub( tau.mul( 0.11 ) ).sub( along ) ).mul( 0.22 ) ), 0.22, 1.3 );
	const env2 = clamp( float( 0.6 ).add( cos( t.mul( 0.25 ).sub( tau.mul( 0.18 ) ).sub( along ).add( 1.55 ) ).mul( 0.36 ) ).add( sin( t.mul( 0.16 ).sub( tau.mul( 0.09 ) ).add( along ) ).mul( 0.2 ) ), 0.18, 1.24 );
	const env3 = clamp( float( 0.56 ).add( sin( t.mul( 0.29 ).sub( tau.mul( 0.21 ) ).add( along.mul( 1.3 ) ).sub( 0.8 ) ).mul( 0.44 ) ), 0.15, 1.18 );
	const a = train( w1, p1, skew ), b = train( w2, p2, skew.mul( 0.94 ) ), c = train( w3, p3, skew.mul( 0.88 ) );
	const gain = shoal.mul( lim ).mul( coast ).mul( U.surf );
	const sum = a.e.mul( env1 ).mul( 0.245 ).add( b.e.mul( env2 ).mul( 0.175 ) ).add( c.e.mul( env3 ).mul( 0.145 ) );
	const elev = sum.mul( gain );
	// d(phase)/dx = -w s grad tau
	const dPh = a.dE.mul( env1 ).mul( 0.245 * w1 ).add( b.dE.mul( env2 ).mul( 0.175 * w2 * 0.985 ) ).add( c.dE.mul( env3 ).mul( 0.145 * w3 * 1.045 ) ).mul( gain );
	const slope = gT.mul( dPh ).negate();
	// breaking: the local wave height against the depth
	const H = max( elev.mul( 2.15 ), 0.0 );
	const miche = H.div( max( d0.add( max( elev, 0.0 ).mul( 0.35 ) ), 0.26 ).mul( 0.64 ) );
	const steep = smoothstep( 0.32, 1.08, miche );
	const crest = max( a.lip.mul( env1 ).mul( 0.76 ).add( b.lip.mul( env2 ).mul( 0.62 ) ).add( c.lip.mul( env3 ).mul( 0.56 ) ), 0.0 );
	const zone = smoothstep( 0.03, 0.24, d0 ).mul( smoothstep( 0.6, 2.6, d0 ).oneMinus() );
	const lip = clamp( crest.mul( zone ).mul( steep.mul( 0.9 ).add( 0.35 ) ).mul( 1.8 ).mul( coast ).mul( U.surf.min( 1.5 ) ), 0.0, 1.3 );
	// (without the depth limit, which takes the swell to nothing at the waterline)
	const run = clamp( sum.mul( shoal ).mul( coast ).mul( U.surf ).div( 0.25 ), 0.0, 1.0 );
	return { slope, lip, run, dir: dir.negate() };
}

// opts: reflectionInterval (ms between planar captures, planarReprojection.js), waveStrength, foam (the surf; lakes are calmer), level (WATER_LEVEL; a lake's own level, world/lakeFill.js), geometry (a horizontal surface in
// world space; the sea's endless plane when omitted), envMap (lakes: the sky's PMREM reflected instead
// of a planar reflector, one extra scene pass per lake was too dear), reflectionScale.
export function createWater( heightTex, sunDir, opts = {} ) {
	const level = opts.level ?? WATER_LEVEL;
	const planar = ! opts.envMap;

	const waveTex = createWaveTexture();
	const U = {
		sunDir: uniform( sunDir ),
		sunColor: uniform( new THREE.Color( 0xfff0d8 ) ),
		deep: uniform( new THREE.Color( 0x173556 ) ),
		mid: uniform( new THREE.Color( 0x17506b ) ),
		shallow: uniform( new THREE.Color( 0x2f6f74 ) ),
		waveStrength: uniform( opts.waveStrength ?? 0.4 ),
		foam: uniform( opts.foam ?? 1 ), // the surf at the shore (a still lake: a thin wet line)
		foamLight: uniform( new THREE.Color( 1, 1, 1 ) ), // the light on the foam (main.js: dim at night; it glowed white)
		reflectivity: uniform( 1.0 ),
		// how fast the water hides the bed (1/m along the light's path down and back up to the eye)
		absorb: uniform( 0.12 )
	};

	const mat = new THREE.MeshBasicNodeMaterial();
	mat.transparent = true;
	mat.depthWrite = true;
	// the colour below is premultiplied (reflection on top, the bed through what the water lets pass)
	mat.premultipliedAlpha = true;
	mat.name = 'WaterTSL';

	const geo = opts.geometry ?? new THREE.PlaneGeometry( 36000, 36000, 1, 1 );
	const mesh = new THREE.Mesh( geo, mat );
	if ( ! opts.geometry ) {
		mesh.rotation.x = - Math.PI / 2;
		mesh.position.y = level;
	}
	mesh.name = opts.geometry ? 'lakeWater' : 'water';
	mesh.renderOrder = 1;

	const hd = heightTex.userData;
	const wp = positionWorld;
	const toCam = cameraPosition.sub( wp );
	const dist = length( toCam );
	const V = normalize( toCam );

	// terrain depth under the surface
	// texel-centre correct lookup (vertex k lives at texel centre (k+0.5)/n)
	const huv = wp.xz.sub( vec2( hd.x0, hd.z0 ) ).div( hd.cell ).add( 0.5 ).div( hd.n );
	const insideT = smoothstep( 0.0, 0.004, huv.x ).mul( smoothstep( 0.996, 1.0, huv.x ).oneMinus() ).mul( smoothstep( 0.0, 0.004, huv.y ) ).mul( smoothstep( 0.996, 1.0, huv.y ).oneMinus() );
	const groundH = mix( float( - 40 ), texture( heightTex, huv ).r, insideT );
	// the surface's own height (the sea plane at WATER_LEVEL, a lake at its level): every lake shares
	// the same shader code
	const depth = max( wp.y.sub( groundH ), 0.0 );

	// Large-scale variation (as three's WaterMesh, which mixes samples at scales of hundreds of
	// metres to hide the tiling): wind patches from low-frequency noise (~420 m and ~140 m
	// features): calm slicks (clean mirror) next to rougher, wind-rippled water; they drift slowly
	const windField = Fn( () => {
		const t = time;
		const n = mx_noise_float( vec3( wp.x.div( 420 ), wp.z.div( 420 ), t.mul( 0.004 ) ) ).mul( 0.7 )
			.add( mx_noise_float( vec3( wp.x.div( 140 ).add( 5.3 ), wp.z.div( 140 ), t.mul( 0.011 ) ) ).mul( 0.3 ) ); // ~ -1 .. 1
		return smoothstep( - 0.25, 0.35, n );
	} )();
	const wind = mix( float( 0.35 ), float( 1.3 ), windField );

	// animated wave slopes: a long swell octave plus 3 scrolling octaves, fading with distance
	// The texture's wind axis is world x (the swell comes in from the open sea to the east, crests
	// along the coast); the shorter octaves are read in frames turned off that axis (the wind sea is
	// broader than the swell) and their slopes turned back. All drift shoreward (towards -x).
	const octave = ( scale, ang, vx, vz ) => {
		const c = Math.cos( ang ), s = Math.sin( ang );
		const p = vec2( wp.x.mul( c ).add( wp.z.mul( s ) ), wp.z.mul( c ).sub( wp.x.mul( s ) ) );
		const g = texture( waveTex, p.div( scale ).add( vec2( time.mul( vx ), time.mul( vz ) ) ) ).rg.mul( 2 ).sub( 1 );
		return ang === 0 ? g : vec2( g.x.mul( c ).sub( g.y.mul( s ) ), g.x.mul( s ).add( g.y.mul( c ) ) );
	};
	const slope = Fn( () => {
		const s0 = octave( 163, 0, 0.0045, 0.0008 );
		const s1 = octave( 46, 0.31, 0.010, 0.002 );
		const s2 = octave( 15.5, - 0.44, 0.018, - 0.004 );
		const s3 = octave( 4.3, 0.7, 0.035, 0.012 );
		const nearF = smoothstep( 20, 220, dist ).oneMinus();
		// the wind patches scale the short octaves (the long swell is the same everywhere)
		return s0.mul( 0.35 ).add( s1.mul( 0.55 ).add( s2.mul( 0.4 ) ).add( s3.mul( 0.3 ).mul( nearF ) ).mul( wind ) );
	} )();
	const strength = mix( 0.6, 0.05, smoothstep( 40, 2200, dist ) ).mul( U.waveStrength )
		.mul( smoothstep( 0.0, 1.5, depth ).mul( 0.7 ).add( 0.3 ) );
	// raindrops landing (world/rainImpacts.js): their rings added to the wave slopes, near the camera
	const rain = rainRipples( wp.xz, smoothstep( 45, 75, dist ).oneMinus() ).mul( 0.12 );
	// the coastal swell (the sea only: opts.surfTex, world/surf.js): its slope and its breaking crests
	const surf = opts.surfTex ? coastalSurf( opts.surfTex, huv, insideT, depth, U ) : null;
	const sSlope = surf ? surf.slope : vec2( 0 );
	const N = normalize( vec3( slope.x.mul( strength ).add( rain.x ).add( sSlope.x ).negate(), 1.0, slope.y.mul( strength ).add( rain.y ).add( sSlope.y ).negate() ) );

	// planar reflection with wave distortion (the sea); a lake reflects the sky's environment map
	let refl = null, reflNode, reproj = null, reflWeight = float( 1 );
	if ( planar ) {
		refl = reflector( { resolutionScale: opts.reflectionScale ?? 0.45, generateMipmaps: false, bounces: false } );
		// captured on a budget and sampled through the capture's own camera (planarReprojection.js)
		reproj = new PlanarReprojection( refl, { interval: opts.reflectionInterval } );
		const cap = reproj.uvNode();
		refl.uvNode = cap.uv.add( N.xz.mul( 0.012 ).mul( smoothstep( 0, 3000, dist ).oneMinus().mul( 0.8 ).add( 0.2 ) ).mul( mix( 0.4, 1.7, windField ) ) );
		reflWeight = cap.weight;
		mesh.add( refl.target );
		reflNode = refl.rgb;
	} else {
		U.envGain = uniform( opts.envGain ?? 0.55 );
		reflNode = pmremTexture( opts.envMap, reflect( V.negate(), N ), float( 0.04 ) ).rgb.mul( U.envGain );
	}

	// The bed in the shallows, after offroad's water.js (https://github.com/alexadrerui/offroad, MIT,
	// Copyright (c) 2026 Arz-Gev, licenses/LICENSE-offroad.md): the depth comes from the height texture
	// (no depth pre-pass), the light that reaches the bed and comes back is T = exp(-absorb * depth *
	// (1 + 1/cos)) (down from the surface, back up along the view: more water at a grazing look), and
	// the Fresnel reflection lies on top at its full strength (premultiplied blending): what shows of
	// the bed is (1 - kR) T; the water's own colour is the light it scatters, (1 - kR)(1 - T). Over deep
	// water T = 0 and this is the old mix of body and reflection; before, the shallows were a fixed
	// opacity (0.18 at the shore to 1 at 5.5 m) that also faded the reflection there.
	const cosV = max( dot( V, N ), 0.0 );
	const fres = float( 0.02 ).add( float( 0.98 ).mul( pow( float( 1 ).sub( cosV ), 5.0 ) ) );
	// wind patches read mostly through the reflection: calm slicks are a bright mirror, the
	// rippled patches scatter it and show more of the darker water body
	const kR = clamp( fres.mul( 1.15 ).add( 0.06 ), 0.0, 1.0 ).mul( U.reflectivity ).mul( mix( 1.0, 0.62, windField ) ).mul( reflWeight );
	// the view's path under the surface follows the refracted ray (index 1.33: steeper than the look)
	const cosR = float( 1 ).sub( float( 1 ).sub( cosV.mul( cosV ) ).div( 1.78 ) ).sqrt();
	const trans = exp( U.absorb.mul( depth ).mul( float( 1 ).add( float( 1 ).div( cosR ) ) ).negate() );
	// the shoreline foam (bands travelling towards the shore): opaque, over everything
	const foam = Fn( () => {
		const fn = mx_noise_float( wp.xz.mul( 0.35 ).add( time.mul( 0.08 ) ) ).mul( 0.5 ).add( 0.5 );
		let f;
		if ( surf ) {
			// the breaking crests (lace: two noise scales drifting with the swell) and the wash at the
			// waterline, wider while a wave runs up
			const lace = mx_noise_float( wp.xz.mul( 1.3 ).add( surf.dir.mul( time ).mul( 1.4 ) ) ).mul( 0.5 ).add( 0.5 );
			const broken = smoothstep( 0.25, 0.75, lace.mul( 0.6 ).add( fn.mul( 0.6 ) ).sub( 0.1 ) );
			const wash = smoothstep( 0.0, surf.run.mul( 0.5 ).add( 0.2 ), depth ).oneMinus();
			f = surf.lip.mul( broken.mul( 0.8 ).add( 0.35 ) ).add( wash.mul( fn.mul( 0.6 ).add( 0.5 ) ) );
		} else {
			const band = sin( depth.mul( 9.0 ).sub( time.mul( 1.7 ) ).add( fn.mul( 5.0 ) ) ).mul( 0.5 ).add( 0.5 );
			f = smoothstep( 0.0, 1.1, depth ).oneMinus().mul( smoothstep( 0.55, 0.95, band ).mul( 0.6 ).add( smoothstep( 0.0, 0.35, depth ).oneMinus() ) ).mul( fn.mul( 0.6 ).add( 0.5 ) );
		}
		// (x 0.5: the foam is opaque now; before, the shallows' low opacity also thinned it)
		return clamp( f.mul( U.foam ).mul( 0.5 ), 0, 0.9 );
	} )();
	// what of the water is not see-through: the reflection, the scattered light (the foam on top)
	const cover = kR.add( kR.oneMinus().mul( trans.oneMinus() ) );

	mat.colorNode = Fn( () => {
		const L = normalize( U.sunDir );

		// body colour by depth (turquoise over sand -> deep teal/navy)
		const body = mix( U.shallow, U.mid, smoothstep( 0.8, 3.5, depth ) ).toVar();
		body.assign( mix( body, U.deep, smoothstep( 12.0, 36.0, depth ) ) );
		const diffuse = max( dot( N, L ), 0.0 ).mul( 0.35 ).add( 0.45 );
		const bodyLit = body.mul( U.sunColor ).mul( diffuse );

		const reflCol = reflNode.min( vec3( 1.1 ) );
		// premultiplied: the reflection, plus the light the water body scatters back
		const col = reflCol.mul( kR ).add( bodyLit.mul( kR.oneMinus() ).mul( trans.oneMinus() ) ).toVar();

		// sun glitter
		const R = reflect( L.negate(), N );
		const spec = pow( max( dot( R, V ), 0.0 ), 420.0 ).mul( 9.0 ).add( pow( max( dot( R, V ), 0.0 ), 60.0 ).mul( 0.25 ) );
		col.addAssign( U.sunColor.mul( spec ) );

		// the foam over it (premultiplied: its colour at its own coverage)
		col.assign( mix( col, vec3( 0.92, 0.95, 0.95 ).mul( U.foamLight ), foam ) );
		return col;
	} )();

	// the bed shows through what the water lets pass: alpha is what covers it
	mat.opacityNode = mix( cover, float( 1 ), foam );

	// The sun's shadow on the water (hills, fort, houses). The water computes its own shading and
	// receives no light, so the shadow is a thin layer just above it drawn with three's
	// ShadowNodeMaterial: it shows only the shadow the sun casts there (through the same shadow
	// map as the terrain), as a translucent dark tint over the water. Seen only from above (not
	// from under the water, not in the reflection).
	const shadowMat = new THREE.ShadowNodeMaterial( { color: 0x06141c, opacity: 0.42, transparent: true, depthWrite: false } );
	shadowMat.name = 'WaterShadow';
	const shadowMesh = new THREE.Mesh( opts.geometry ?? new THREE.PlaneGeometry( 36000, 36000, 1, 1 ), shadowMat );
	shadowMesh.name = 'waterShadow';
	shadowMesh.receiveShadow = true;
	shadowMesh.renderOrder = 2;
	mesh.add( shadowMesh );
	// 2 cm above the water (the sea's shadow is a child of the rotated plane: its local z is up)
	if ( opts.geometry ) shadowMesh.position.set( 0, 0.02, 0 ); else shadowMesh.position.set( 0, 0, 0.02 );

	return { mesh, material: mat, uniforms: U, reflector: refl, reflection: reproj, shadowMesh };
}
