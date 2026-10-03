import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { uniform, vec4, max, dot, normalize, pow, positionWorld, cameraPosition, mix, smoothstep } from 'three/tsl';

// Preetham sky + procedural clouds (built into SkyMesh), sun light and
// sky-derived image based lighting.
// peak sun intensity (the water and underwater sun terms are normalised by it)
export const SUN_MAX = 3.9;

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
	const nightZenith = uniform( new THREE.Color().setRGB( 0.012, 0.022, 0.05, THREE.SRGBColorSpace ) );
	const nightHorizon = uniform( new THREE.Color().setRGB( 0.07, 0.1, 0.17, THREE.SRGBColorSpace ) );
	const up = normalize( positionWorld.sub( cameraPosition ) ).y;
	const nightSky = mix( nightHorizon, nightZenith, smoothstep( 0, 0.5, up ) );
	sky.material.colorNode = vec4( skyColor.rgb.mul( gain ).mul( sunDim ).add( nightSky.mul( night ) ), 1 );
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

	const _hemiDay = new THREE.Color( 0xbfd6f2 ), _hemiNight = new THREE.Color( 0x5d78b0 );
	const _groundDay = new THREE.Color( 0x3d4a26 ), _groundNight = new THREE.Color( 0x141a26 );
	const state = {
		elevation: 21,   // degrees: late-afternoon
		azimuth: 238,    // degrees, 0 = north(-z), 90 = east(+x)
		sunDir: new THREE.Vector3()
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
		envSky.sunPosition.value.copy( state.sunDir );
		for ( const k of [ 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG' ] ) envSky[ k ].value = sky[ k ].value;

		sun.position.copy( sun.target.position ).addScaledVector( state.sunDir, 700 );
		const e = Math.max( 0, state.elevation );
		const warm = THREE.MathUtils.smoothstep( e, 0, 25 );
		sun.color.setRGB( 1.0, 0.7 + 0.16 * warm, 0.46 + 0.2 * warm );
		// the real elevation (e is clamped at 0: below the horizon the sun stayed at 3.4%, warm, lighting from below)
		sun.intensity = SUN_MAX * THREE.MathUtils.smoothstep( state.elevation, - 1, 8 );
		state.sunIntensity = sun.intensity; // clear sky: world/weather.js dims it under rain
		hemi.intensity = 0.08 + 0.09 * THREE.MathUtils.smoothstep( e, - 5, 30 );
		// the night (day and night, phase 2): 0 with the sun 2 degrees up, 1 at 10 degrees down
		const n = THREE.MathUtils.smoothstep( - state.elevation, - 2, 10 );
		state.night = n;
		night.value = n;
		// the sky's light at night: moonlit blue
		hemi.color.copy( _hemiDay ).lerp( _hemiNight, n );
		hemi.groundColor.copy( _groundDay ).lerp( _groundNight, n );

		if ( rebuildEnv ) {
			envRT = pmrem.fromScene( envScene, 0, 1, 2000, envRT ? { renderTarget: envRT } : {} );
			scene.environment = envRT.texture;
			scene.environmentIntensity = 0.22;
		}
	}
	update( false );

	return { sky, sun, hemi, state, gain, night, nightZenith, nightHorizon, update, buildEnv: () => update( true ) };
}
