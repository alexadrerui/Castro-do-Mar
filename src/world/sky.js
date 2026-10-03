import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { Fn, If, uniform, vec2, vec3, vec4, max, dot, normalize, pow, positionWorld, cameraPosition, mix, smoothstep, sqrt, atan, asin, cross, exp, length, fwidth, texture, float } from 'three/tsl';

// Preetham sky + procedural clouds (built into SkyMesh), sun light and
// sky-derived image based lighting.
// peak sun intensity (the water and underwater sun terms are normalised by it)
export const SUN_MAX = 3.9;
// the full moon's light at its highest (day and night, phase 5), before the night's exposure
export const MOON_MAX = 0.32;

export function createSky( scene, renderer ) {

	const sky = new SkyMesh();
	sky.scale.setScalar( 50000 );
	sky.renderOrder = - 1;
	sky.material.fog = false;
	sky.turbidity.value = 2.4;
	sky.rayleigh.value = 1.0;
	sky.mieCoefficient.value = 0.0025; // smaller white halo around the sun
	sky.mieDirectionalG.value = 0.86;
	sky.cloudCoverage.value = 0.55;
	sky.cloudDensity.value = 0.85;
	sky.cloudElevation.value = 0.55;
	sky.cloudScale.value = 0.00028;
	sky.cloudSpeed.value = 0.00003;
	// The Preetham sky is far brighter than the sun-lit scene at our exposure: the whole sky went
	// white around the sun (the reference has a deep blue sky with white clouds). Only the visible
	// sky is scaled; the image based lighting (envSky below) keeps its own level.
	const gain = uniform( 0.4 );
	const skyColor = sky.material.colorNode;
	// Facing the sun, the Mie halo and the back-lit clouds filled a third of the frame far above
	// white, and the bloom / god rays / DOF spread it into a white-out: the sky is dimmed towards
	// the sun (the disc itself stays far above white).
	const toSun = max( dot( normalize( positionWorld.sub( cameraPosition ) ), normalize( sky.sunPosition ) ), 0 );
	const sunDim = pow( toSun, 5 ).mul( 0.5 ).oneMinus();
	// The night sky (day and night, phase 2): the Preetham sky goes almost black below the horizon; a
	// moonlit gradient (deep blue overhead, paler toward the horizon) is added as the sun sinks, by
	// `night` (0 with the sun 2 degrees up, 1 at 10 degrees down; update())
	const night = uniform( 0 );
	// a neutral, slightly cool grey (the reference: Three.js Sky Pro's "Moonlit Night", mean colour of the
	// frame ~( 17.5, 18.5, 20.4 ) / 255; the first saturated blue read as a filter, not as moonlight)
	const nightZenith = uniform( new THREE.Color().setRGB( 0.02, 0.022, 0.027, THREE.SRGBColorSpace ) );
	const nightHorizon = uniform( new THREE.Color().setRGB( 0.08, 0.085, 0.096, THREE.SRGBColorSpace ) );
	const up = normalize( positionWorld.sub( cameraPosition ) ).y;
	const nightSky = mix( nightHorizon, nightZenith, smoothstep( 0, 0.5, up ) );
	const moon = createMoon( normalize( positionWorld.sub( cameraPosition ) ), sky.sunPosition, night );
	sky.material.colorNode = vec4( skyColor.rgb.mul( gain ).mul( sunDim ).add( nightSky.mul( night ) ).add( moon.color ), 1 );
	sky.frustumCulled = false;
	sky.layers.enable( 2 );
	scene.add( sky );

	const sun = new THREE.DirectionalLight( 0xfff1dc, 3.4 );
	sun.castShadow = true;
	sun.shadow.mapSize.set( 4096, 4096 );
	const sc = sun.shadow.camera;
	sc.left = - 190; sc.right = 190; sc.top = 190; sc.bottom = - 190;
	sc.near = 400; sc.far = 1000;
	sun.shadow.bias = - 0.00005;
	// updated once per frame by the main loop (not again for the reflection camera)
	sun.shadow.autoUpdate = false;
	sun.shadow.normalBias = 0.08;
	sun.shadow.radius = 2;
	sun.target.position.set( 0, 20, 10 );
	scene.add( sun, sun.target );

	const hemi = new THREE.HemisphereLight( 0xbfd6f2, 0x3d4a26, 0.15 );
	scene.add( hemi );

	const _hemiDay = new THREE.Color( 0xbfd6f2 ), _hemiNight = new THREE.Color( 0x8c96aa );
	const _groundDay = new THREE.Color( 0x3d4a26 ), _groundNight = new THREE.Color( 0x1c1e23 );
	const state = {
		elevation: 21,   // degrees: late-afternoon
		azimuth: 238,    // degrees, 0 = north(-z), 90 = east(+x)
		sunDir: new THREE.Vector3(),
		// the main light (day and night, phase 5): the sun by day, the moon at night; what is lit by the
		// light follows this (the directional light and its shadows, terrain, plants, water, clouds...),
		// the sky and the screen-space sun shafts keep sunDir
		lightDir: new THREE.Vector3(),
		lightElevation: 21
	};

	const pmrem = new THREE.PMREMGenerator( renderer );
	const envScene = new THREE.Scene();
	const envSky = new SkyMesh();
	envSky.scale.setScalar( 900 );
	envSky.showSunDisc.value = 0;
	envSky.cloudCoverage.value = 0; // keep IBL smooth
	envScene.add( envSky );
	let envRT = null;

	function update( rebuildEnv = true ) {
		const phi = THREE.MathUtils.degToRad( 90 - state.elevation );
		const theta = THREE.MathUtils.degToRad( state.azimuth );
		// azimuth measured clockwise from north (-z) towards east (+x)
		state.sunDir.set( Math.sin( phi ) * Math.sin( theta ), Math.cos( phi ), - Math.sin( phi ) * Math.cos( theta ) );
		sky.sunPosition.value.copy( state.sunDir );
		moon.dir.value.copy( state.sunDir ).negate(); // opposite the sun, always full (world/clock.js)
		envSky.sunPosition.value.copy( state.sunDir );
		for ( const k of [ 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG' ] ) envSky[ k ].value = sky[ k ].value;

		const e = Math.max( 0, state.elevation );
		const warm = THREE.MathUtils.smoothstep( e, 0, 25 );
		// the night (day and night, phase 2): 0 with the sun 2 degrees up, 1 at 10 degrees down
		const n = THREE.MathUtils.smoothstep( - state.elevation, - 2, 10 );
		state.night = n;
		night.value = n;
		// the real elevation (e is clamped at 0: below the horizon the sun stayed at 3.4%, warm, lighting from below)
		const sunI = SUN_MAX * THREE.MathUtils.smoothstep( state.elevation, - 1, 8 );
		if ( sunI > 0 ) {
			state.lightDir.copy( state.sunDir );
			state.lightElevation = state.elevation;
			sun.color.setRGB( 1.0, 0.7 + 0.16 * warm, 0.46 + 0.2 * warm );
			sun.intensity = sunI;
		} else {
			// the moonlight (phase 5): the same light, from the moon (opposite the sun), cool white, rising
			// with the night and the moon's height; both are 0 where the light switches (the sun at -1)
			state.lightDir.copy( moon.dir.value );
			state.lightElevation = - state.elevation;
			sun.color.copy( moon.tint.value );
			sun.intensity = MOON_MAX * THREE.MathUtils.smoothstep( n, 0.15, 1 ) * THREE.MathUtils.smoothstep( - state.elevation, - 1, 12 );
		}
		sun.position.copy( sun.target.position ).addScaledVector( state.lightDir, 700 );
		state.sunIntensity = sun.intensity; // clear sky: world/weather.js dims it under rain
		hemi.intensity = 0.08 + 0.09 * THREE.MathUtils.smoothstep( e, - 5, 30 );
		// the sky's light at night: a cool grey
		hemi.color.copy( _hemiDay ).lerp( _hemiNight, n );
		hemi.groundColor.copy( _groundDay ).lerp( _groundNight, n );

		if ( rebuildEnv ) {
			envRT = pmrem.fromScene( envScene, 0, 1, 2000, envRT ? { renderTarget: envRT } : {} );
			scene.environment = envRT.texture;
			scene.environmentIntensity = 0.22;
		}
	}
	update( false );

	return { sky, sun, hemi, state, gain, night, nightZenith, nightHorizon, moon, update, buildEnv: () => update( true ) };
}

// The moon (day and night, phase 4), after takram's MoonNode (three-geospatial, packages/atmosphere/src/
// webgpu/MoonNode.ts, MIT, licenses/LICENSE-takram-atmosphere.md): the view ray against a sphere of the
// moon's angular radius gives the surface normal; its LROC colour map (NASA CGI Moon Kit,
// https://svs.gsfc.nasa.gov/4720/, credit NASA; public/sky/moon_color.webp, takram's 1k copy) is read
// in the moon's own frame, the near side toward us; Oren-Nayar diffuse (roughness 1, albedo 1) lit from
// the sun's direction, the disc antialiased by its chord. Changes: no displacement (the disc is ~25 px),
// the moon fixed frame is simply its north up (no libration), the radius ~2.9 times the true one (the
// true 0.26 degrees is a 9-pixel dot at our field of view; the reference, Sky Pro's "Moonlit Night",
// also shows it larger), and a wide halo (the aureole of the moon in the haze: two exponential lobes)
// with the night. The moon is opposite the sun: always full. In the sky dome, so the water reflects it.
// moon: dir (uniform), radius, brightness, halo, color
function createMoon( d, sunDir, night ) {
	const M = {
		dir: uniform( new THREE.Vector3( 0, - 1, 0 ) ),
		radius: uniform( 0.013 ),     // rad (the true one: 0.0045)
		brightness: uniform( 7 ),     // the lit disc, HDR (before the night's exposure; past the bloom's threshold)
		halo: uniform( 0.15 ),        // the aureole
		color: uniform( new THREE.Color( 0.84, 0.88, 0.97 ) )
	};
	const tex = new THREE.TextureLoader().load( import.meta.env.BASE_URL + 'sky/moon_color.webp' );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.RepeatWrapping;
	const map = texture( tex );
	const node = Fn( () => {
		const m = M.dir;
		const cosT = dot( d, m );
		const r = M.radius;
		// the chord test (as takram's): inside where |d - m|^2 < 2 (1 - cos r)
		const chordVec = d.sub( m );
		const chord = dot( chordVec, chordVec );
		const thr = float( 1 ).sub( r.cos() ).mul( 2 );
		const aa = smoothstep( thr, thr.sub( fwidth( chord ) ), chord );
		const col = vec3( 0 ).toVar();
		If( chord.lessThan( thr ), () => {
			// the sphere's normal under the ray (small angles: on the unit sphere of directions)
			const P = m.sub( d.mul( cosT ) ).negate();
			const sHalf = sqrt( r.mul( r ).sub( dot( P, P ) ).max( 0 ) );
			const N = P.sub( d.mul( sHalf ) ).div( r );
			// the moon's frame: the near side toward us, its north up
			const fwd = m.negate();
			const upM = normalize( vec3( 0, 1, 0 ).sub( m.mul( m.y ) ) );
			const right = cross( m, upM );
			const lon = atan( dot( N, right ), dot( N, fwd ) );
			const lat = asin( dot( N, upM ).clamp( - 1, 1 ) );
			const uv = vec2( lon.div( 2 * Math.PI ).add( 0.5 ), lat.div( Math.PI ).add( 0.5 ) );
			// Oren-Nayar, roughness 1, albedo 1 (takram's)
			const L = normalize( sunDir ), V = d.negate();
			const cl = dot( N, L ), cv = dot( N, V );
			const sv = dot( L, V ).sub( cl.mul( cv ) );
			const t = mix( float( 1 ), max( cl, cv ).max( 0.1 ), smoothstep( 0, 0.1, sv ) );
			const A = ( 1 / Math.PI ) * ( 1 - 0.5 / 1.33 + 0.17 / 1.13 ), B = ( 1 / Math.PI ) * ( 0.45 / 1.09 );
			const diffuse = cl.max( 0 ).mul( sv.div( t ).mul( B ).add( A ) ).mul( Math.PI );
			col.assign( map.sample( uv ).level( 0 ).rgb.mul( M.color ).mul( diffuse ).mul( M.brightness ).mul( aa ) );
		} );
		// the aureole: a tight and a wide lobe around the moon, with the night (the moon also sits low in
		// the day sky, opposite the sun, below the horizon then)
		const ang = length( chordVec );
		const glow = exp( ang.div( 0.02 ).negate() ).mul( 0.7 ).add( exp( ang.div( 0.14 ).negate() ).mul( 0.3 ) );
		const above = smoothstep( - 0.03, 0.02, m.y );
		return col.add( M.color.mul( glow.mul( M.halo ).mul( night ) ) ).mul( above );
	} )();
	return { ...M, color: node, tint: M.color, texture: tex };
}
