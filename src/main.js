import * as THREE from 'three/webgpu';
import { fog, uniform, positionWorld, positionView, length, float, exp, color, mix, smoothstep, max, Fn, normalize, cameraPosition, dot, pass, renderOutput, vec3, vec4, uv, clamp, screenUV, getViewPosition, vec2, rtt, screenSize } from 'three/tsl';

import { Loader } from './ui/loader.js';
import { HUD } from './ui/hud.js';
import { FreeCam } from './controls/freecam.js';
import { AutoFocus } from './controls/focus.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { ao as gtao } from 'three/addons/tsl/display/GTAONode.js';
import { depthAwareBlur } from 'three/addons/tsl/display/depthAwareBlur.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { LensDroplets, discBlur } from './post/lensDroplets.js';
import { Underwater } from './post/underwater.js';
import { MarineSnow } from './post/marineSnow.js';
import { Mist } from './post/mist.js';
import { Godrays } from './post/godrays.js';
import { createWaterUnderside } from './world/waterUnderside.js';
import { Seabed } from './world/seabed/seabed.js';
import { FishSchools } from './world/fish/schools.js';
import { KoiPonds } from './world/koi/ponds.js';
import { BirdBatch } from './world/birds/batch.js';
import { Flock } from './world/birds/flock.js';
import { Splashes } from './world/birds/splash.js';
import { WATER_LEVEL } from './world/layout.js';
import { HeightField } from './world/heightfield.js';
import { createTerrain, loadDetailData } from './world/terrain.js';
import { createSky, SUN_MAX, MOON_MAX } from './world/sky.js';
import { createWater } from './world/water.js';
import { setWaterLevels } from './world/terrain.js';
import { Lakes } from './world/lakeWater.js';
import { Weather } from './world/weather.js';
import { Clock, PRESETS } from './world/clock.js';
import { Stars, loadStars } from './world/stars.js';
import { Lightning } from './world/lightning.js';
import { Clouds, loadCloudTextures } from './post/clouds.js';
import { ValleyFog } from './post/valleyFog.js';
import { Rivers } from './world/rivers.js';
import { installRecovery, restoreAfterRecovery } from './core/recovery.js';
import { Settings, QUALITY, startQuality } from './core/settings.js';
import { Multiplayer, roomFromURL } from './core/multiplayer.js';
import { Ambience } from './audio/ambience.js';
import { wind } from './world/wind.js';
import { bindSky, updateCloudSun, cloudShadowUniforms, clearCloudMap } from './world/cloudShadow.js';
import { setLakeTest } from './world/vegetation.js';
import { createHorizon } from './world/horizon.js';
import { Kuwahara } from './post/kuwahara.js';
import { AutoExposure } from './post/autoExposure.js';
import { DynamicResolution } from './core/dynamicRes.js';
import { TouchControls } from './controls/touch.js';
import { KEYS as LOOK_KEYS, lookAt, refreshLook } from './world/look.js';
import { createSunShadows } from './world/sunShadows.js';
import { createTerrainShadow, SHADOW_LAYER } from './world/terrainShadow.js';
import { generateFields } from './world/genFields.js';
import { cacheGet, cachePut, cacheClear, hashSources } from './core/cache.js';
import { PROXY_LAYER } from './core/proxies.js';
import { loadTerrainEdits, hashEdits } from './world/terrainEdits.js';
import { loadWorldEdits, applyWorldEdits } from './world/worldEdits.js';
import { loadNatureEdits } from './world/natureEdits.js';
import { loadSurfaces } from './world/surfaces.js';
import { BUILDINGS, PATHS, MASK } from './world/layout.js';
// the generated fields depend only on this code: its hash is the cache key
import srcHeight from './world/heightfield.js?raw';
import srcLayout from './world/layout.js?raw';
import srcNoise from './core/noise.js?raw';
import srcWorker from './world/gen.worker.js?raw';
import srcGenFields from './world/genFields.js?raw';
import srcHorizon from './world/horizon.js?raw';
import { isSky, setReversedDepth } from './core/depth.js';

const params = new URLSearchParams( location.search );
const FORCE_WEBGL = params.has( 'webgl' );
const AUTO = params.has( 'auto' );
if ( params.has( 'debug' ) ) THREE.Node.captureStackTrace = true;

const STEPS = [
	{ id: 'gpu', label: 'Despertando a GPU', weight: 1 },
	{ id: 'height', label: 'Esculpindo o relevo', weight: 5 },
	{ id: 'mask', label: 'Traçando caminhos e roças', weight: 2 },
	{ id: 'ao', label: 'Sombreando vales e fendas', weight: 2 },
	{ id: 'macro', label: 'Tecendo texturas do solo', weight: 1 },
	{ id: 'terrain', label: 'Erguendo o terreno', weight: 2 },
	{ id: 'water', label: 'Enchendo o lago e as ilhas', weight: 1 },
	{ id: 'horizon', label: 'Levantando as montanhas', weight: 2 },
	{ id: 'sky', label: 'Pintando o céu e as nuvens', weight: 1 },
	{ id: 'world', label: 'Povoando o castro', weight: 3 },
	{ id: 'compile', label: 'Compilando shaders TSL', weight: 3 }
];

const app = {
	views: [
		{ label: 'Panorâmica', pos: [ - 45, 68, 95 ], target: [ 30, 52, - 45 ] },
		{ label: 'Aérea', pos: [ 0, 195, 38 ], target: [ 0, 26, - 2 ] },
		{ label: 'Vila', pos: [ - 42, 38, 62 ], target: [ - 5, 28, 5 ] },
		{ label: 'Minas', pos: [ 18, 31, - 14 ], target: [ 46, 29, - 34 ] },
		{ label: 'Lago', pos: [ 110, 42, - 110 ], target: [ 420, 10, - 520 ] },
		{ label: 'Montanhas', pos: [ - 80, 90, 60 ], target: [ - 1400, 700, - 900 ] }
	],
	layers: {},
	onFrame: [],
	pixelRatio: 1.0,
	fogScale: uniform( 1.0 ),
	dynamicRes: true
};
window.__app = app;
app.THREE = THREE; // QA tools (tools/houses.mjs: raycasts in the page)

const loader = new Loader( STEPS );

main().catch( ( e ) => loader.fail( e ) );

async function main() {

	const canvas = document.getElementById( 'view' );
	let renderer, scene, camera, hf, terrain;

	await loader.run( 'gpu', async () => {
		// ?revz=1: reversed depth (float32, even precision to the far plane; core/depth.js), WebGPU only (test)
		const reversedDepth = params.get( 'revz' ) === '1' && ! FORCE_WEBGL;
		setReversedDepth( reversedDepth );
		renderer = new THREE.WebGPURenderer( { canvas, antialias: false, forceWebGL: FORCE_WEBGL, powerPreference: 'high-performance', trackTimestamp: params.has( 'perf' ), reversedDepthBuffer: reversedDepth } );
		renderer.setPixelRatio( app.pixelRatio );
		renderer.setSize( innerWidth, innerHeight );
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 0.8;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFShadowMap;
		await renderer.init();
		app.backendName = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
		loader.backend( 'Renderizador: ' + app.backendName + ' · three.js r' + THREE.REVISION );

		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera( 50, innerWidth / innerHeight, 1.0, 40000 );
		camera.layers.enable( 1 ); // layer 1: small props (skipped by reflection and shadows)
		app.renderer = renderer; app.scene = scene; app.camera = camera;
		// a lost GPU device reloads the page and restores the view (core/recovery.js)
		installRecovery( app );
	} );

	// Heightfield, splat mask, AO and macro noise: from the IndexedDB cache when
	// the generator code is unchanged, otherwise baked in the worker and stored.
	// the house surfaces bake in their own worker meanwhile (world/surfaces.js; cached after the first load)
	app.surfaces = loadSurfaces();
	hf = new HeightField();
	// hand edits of the relief (public/terrain-edits.bin, see world/terrainEdits.js and ?edit)
	const terrainEdits = await loadTerrainEdits();
	app.terrainEdits = terrainEdits;
	// edits of the village objects (public/world-edits.json, see world/worldEdits.js): applied to the
	// layout lists before anything reads them
	const worldEdits = await loadWorldEdits();
	app.worldEdits = worldEdits;
	applyWorldEdits( worldEdits );
	// painted nature (public/nature-edits.bin, world/natureEdits.js): read by vegetation, rocks, grass
	app.natureEdits = await loadNatureEdits();
	// the generator reads only the houses of the edited layout (pads, trampled ground): moving a stall
	// or a prop does not regenerate the fields
	const houses = BUILDINGS.map( ( b ) => [ b.x, b.z, b.r, b.w, b.l, b.scale ] );
	// and the paths (the "Caminhos" tab edits them: the ruts and the dirt of the mask follow)
	const paths = PATHS.map( ( p ) => [ p.w, p.pts ] );
	const genKey = 'fields:' + hashSources( srcHeight, srcLayout, srcNoise, srcWorker, srcGenFields, JSON.stringify( houses ), JSON.stringify( paths ) ) + ':' + hashEdits( terrainEdits );
	app.clearCache = cacheClear;
	const cached = await cacheGet( genKey );
	let mask, ao, macro;
	if ( cached && cached.height?.length === hf.data.length ) {
		console.info( 'fields: from cache', genKey );
		for ( const id of [ 'height', 'mask', 'ao', 'macro' ] ) await loader.run( id, async () => {} );
		( { mask, ao, macro } = cached );
		hf.data = cached.height;
	} else {
		// in bands of rows over a pool of workers (world/genFields.js)
		const fields = await generateFields( { loader, edits: terrainEdits, world: worldEdits } );
		hf.data = fields.height;
		( { mask, ao, macro } = fields );
		// store in the background (structured clone copies the arrays)
		cachePut( genKey, { height: hf.data, mask, ao, macro }, 'fields:' ).then( () => console.info( 'fields: cached', genKey ) );
	}
	app.hf = hf;
	app.mask = mask;
	app.paths = PATHS; // the paths as edited (world/worldEdits.js), for the console and the QA
	app.maskInfo = { x0: MASK.centerX - MASK.size / 2, z0: MASK.centerZ - MASK.size / 2, size: MASK.size };
	app.macro = macro; // baked macro noise (CPU copy), for the grass density mask

	let sky;
	await loader.run( 'sky', async () => {
		sky = createSky( scene, renderer );
		app.sky = sky;
		// the sun's shadows in cascades (world/sunShadows.js), before any material builds
		app.shadows = createSunShadows( { sun: sky.sun, camera, renderer } );
		// cloud shadows on the ground: the clouds' shadow map along the sun (world/cloudShadow.js, before the materials)
		bindSky( sky );
		updateCloudSun( sky.state.lightElevation );
		app.cloudShadow = cloudShadowUniforms;
		if ( params.get( 'cloudshadow' ) === '0' ) cloudShadowUniforms.strength.value = 0;
		// the catalog stars (world/stars.js), turned by the clock, seen with the night; ?stars=0 leaves them out
		if ( params.get( 'stars' ) !== '0' ) {
			app.stars = new Stars( await loadStars(), sky.night );
			app.stars.setHour( PRESETS.tarde );
			scene.add( app.stars );
		}
	} );

	await loader.run( 'terrain', async () => {
		terrain = createTerrain( hf, mask, ao, sky.state.lightDir, macro, await loadDetailData() );
		scene.add( terrain.mesh );
		// the hills' shadows: a coarse grid drawn only into the sun's shadow maps (world/terrainShadow.js)
		const terrainShadow = createTerrainShadow( terrain.heightTex );
		scene.add( terrainShadow.mesh );
		app.shadows.enableLayer( SHADOW_LAYER );
		app.terrainShadow = terrainShadow;
		app.terrain = terrain;
	} );


	await loader.run( 'water', async () => {
		// the planar reflection is captured every 100 ms (or when the camera moves 2 m) and reprojected
		// in between (world/planarReprojection.js); ?reflectms=0 captures every frame
		const water = createWater( terrain.heightTex, sky.state.lightDir, { reflectionInterval: Number( params.get( 'reflectms' ) ?? 0 ) } );
		scene.add( water.mesh );
		app.water = water;
		app.layers.water = { label: 'Água', object: water.mesh };
		// lakes at their own level (world/lakeWater.js: the terrain editor's "Encher"); their water
		// reflects the sky's environment map, built here already so they are in the pre-compile
		const lakes = new Lakes( { hf, seeds: app.worldEdits?.lakes ?? [] } );
		app.lakes = lakes;
		// and the rivers of the editor's "Rio" (world/rivers.js)
		const rivers = new Rivers( { hf, records: app.worldEdits?.rivers ?? [], lakes } );
		app.rivers = rivers;
		scene.add( rivers.group );
		if ( lakes.list.length || rivers.list.length ) setLakeTest( ( x, z ) => lakes.wet( x, z ) || rivers.wet( x, z ) );
		// the water level over the relief for the terrain's silt and wet band (terrain.js setWaterLevels)
		app.refreshWaterLevels = () => {
			const boxes = [ ...lakes.gridBoxes(), ...rivers.gridBoxes() ];
			setWaterLevels( terrain.waterTex, hf, boxes, ( i, j ) => rivers.levelAtPoint( hf.x0 + i * hf.cell, hf.z0 + j * hf.cell ) ?? lakes.levelAtCell( i, j ) );
		};
		if ( lakes.list.length || rivers.list.length ) app.refreshWaterLevels();
		scene.add( lakes.group );
		if ( lakes.list.length || rivers.list.length || params.has( 'edit' ) ) {
			sky.buildEnv();
			lakes.attachWater( terrain.heightTex, sky.state.lightDir, scene.environment );
			rivers.attachWater( terrain.heightTex, sky.state.lightDir, scene.environment );
		}
	} );

	await loader.run( 'horizon', async ( p ) => {
		// the far ring (~1 s to compute) from the IndexedDB cache, keyed by its code and the height function
		const key = 'horizon:' + hashSources( srcHorizon, srcHeight, srcLayout, srcNoise );
		const cached = await cacheGet( key );
		const h = await createHorizon( p, cached?.index?.length ? cached : null, terrain.detailTex );
		if ( h.userData.bake ) { cachePut( key, h.userData.bake, 'horizon:' ); delete h.userData.bake; }
		console.info( 'horizon:', cached ? 'from cache' : 'computed' );
		h.layers.enable( 2 );
		scene.add( h );
		app.layers.horizon = { label: 'Horizonte', object: h };
	} );

	// Aerial perspective: exponential-squared haze that thins with altitude.
	const hazeColor = uniform( new THREE.Color( 0x9db6d6 ) );
	app.hazeColor = hazeColor;
	// the cool tint of the shadows in the grade, the look's `cool` (world/look.js): 1 by day, 0.3 at night
	const lookCool = uniform( 1 );
	const hazeFar = uniform( new THREE.Color( 0x8fa9cc ) );
	// haze amount at view distance d and world height y (also weights the scattering blur below)
	const hazeAmount = ( d, y ) => {
		const dens = float( 0.00013 ).mul( app.fogScale );
		const f = float( 1 ).sub( exp( d.mul( dens ).negate() ) );
		const altitude = exp( max( y, 0 ).div( 2200 ).negate() );
		return f.mul( altitude.mul( 0.55 ).add( 0.45 ) ).mul( 0.72 );
	};
	scene.fogNode = fog( mix( hazeColor, hazeFar, smoothstep( 4000, 14000, length( positionView ) ) ), hazeAmount( length( positionView ), positionWorld.y ) );

	await loader.run( 'world', async ( p ) => {
		const mod = await import( './world/populate.js' );
		await mod.populate( app, p );
	} );

	// Seabed life, streamed in tiles around the camera (only near / under the water), and the fish that
	// live by its habitat. WebGPU only: the seabed draws indirectly from a storage buffer, which the WebGL
	// 2 backend does not have (?webgl stopped at "createIndirectStorageAttribute is not a function").
	const webgpu = renderer.backend.isWebGPUBackend;
	const seabed = webgpu ? new Seabed( { hf, waterLevel: WATER_LEVEL, sun: sky.sun, sunDir: sky.state.lightDir } ) : null;
	if ( seabed ) {
		scene.add( seabed.group );
		app.seabed = seabed;
		app.layers.seabed = { label: 'Fundo do mar', object: seabed.group };
		app.onFrame.push( () => seabed.update( camera ) );
		// Fish, spawned by habitat in cells around the camera (only near / under the water).
		const fish = new FishSchools( { hf, seabed, sun: sky.sun, sunDir: sky.state.lightDir, getViewHeight: () => renderer.domElement.height } );
		scene.add( fish.group );
		app.fish = fish;
		app.layers.fish = { label: 'Peixes', object: fish.group };
		app.onFrame.push( ( dt ) => fish.update( dt, camera ) );
	}
	app.onFrame.push( () => app.rivers.update( camera ) ); // the falls' spray near the camera
	// Koi and lotus in the lakes made in the terrain editor ("Encher", or dug below the sea level):
	// world/koi, nothing until there is one.
	const koi = new KoiPonds( { hf, waterLevel: WATER_LEVEL, edits: app.terrainEdits, lakes: app.lakes.list } );
	app.koi = koi;
	// the seabed and the fish keep out of the lakes dug down to the sea level (they pick by the depth)
	const seaLakes = koi.lakes.filter( ( l ) => l.level <= WATER_LEVEL + 1e-3 );
	if ( seaLakes.length && seabed ) seabed.exclude = ( x, z ) => seaLakes.some( ( l ) => l.shore( x, z ) > 0 );
	if ( koi.ponds.length ) {
		scene.add( koi.group );
		app.layers.koi = { label: 'Carpas e lótus', object: koi.group };
		app.onFrame.push( ( dt ) => koi.update( dt, camera ) );
	}
	// the birds go to roost as night falls (the sun 2 degrees under the horizon) and come back at dawn:
	// a group of their own, so the panel's layer buttons still switch each one (app.birdsAwake)
	const birdGroup = new THREE.Group();
	birdGroup.name = 'birds';
	scene.add( birdGroup );
	app.birdsAwake = true;
	app.onFrame.push( () => {
		app.birdsAwake = sky.state.elevation > - 2;
		birdGroup.visible = app.birdsAwake;
	} );
	// Gulls that perch on the roofs, the wall and the shore rocks or soar high over the bay, terns
	// that hover and dive (one instanced draw from a storage buffer: WebGPU only, like the seabed).
	if ( renderer.backend.isWebGPUBackend ) {
		const birds = new BirdBatch( { capacity: 48 } );
		// upload the (empty) records now: a storage buffer never uploaded left the precompile of
		// the scene pending until its 12 s timeout
		birds.commit();
		birds.mesh.layers.enable( 2 ); // seen in the water reflection
		birdGroup.add( birds.mesh );
		const flock = new Flock( app );
		app.flock = flock;
		// the divers' splashes (world/birds/splash.js): one instanced mesh, lit by the rivers' light
		const splashes = new Splashes( app.rivers?.light ?? { sunDir: uniform( sky.state.sunDir ), sunColor: uniform( new THREE.Color( 1, 0.95, 0.85 ) ), skyColor: hazeColor } );
		if ( app.rivers ) app.rivers.light.sunDir.value = sky.state.lightDir; // (set by attachWater only when there is water of the editor)
		flock.splash = splashes;
		app.splashes = splashes;
		birdGroup.add( splashes.mesh );
		app.layers.birds = { label: 'Aves', object: birds.mesh };
		// the camera is the "viewer" that flushes them
		const viewer = { x: 0, y: 0, z: 0, speed: 0 };
		app.onFrame.push( ( dt ) => {
			if ( ! app.birdsAwake ) return; // roosting: no simulation
			const p = camera.position;
			if ( dt > 0 ) viewer.speed = Math.hypot( p.x - viewer.x, p.y - viewer.y, p.z - viewer.z ) / dt;
			viewer.x = p.x; viewer.y = p.y; viewer.z = p.z;
			birds.begin();
			flock.update( dt, viewer, birds, camera );
			birds.commit();
			splashes.update( flock.paused ? 0 : dt );
		} );
	}

	// ---- camera & controls ----
	const cam = new FreeCam( camera, canvas, { groundFn: ( x, z ) => hf.heightAt( x, z ), moveSpeed: 22 } );
	app.freecam = cam;
	const v0 = app.views[ params.has( 'view' ) ? + params.get( 'view' ) : 0 ];
	cam.jumpTo( new THREE.Vector3( ...v0.pos ), new THREE.Vector3( ...v0.target ) );

	app.goView = ( i ) => {
		app.focus?.release();
		const v = app.views[ i ];
		cam.flyTo( new THREE.Vector3( ...v.pos ), new THREE.Vector3( ...v.target ), 2.4 );
	};
	app.setView = ( i ) => {
		app.focus?.release();
		const v = app.views[ i ];
		cam.jumpTo( new THREE.Vector3( ...v.pos ), new THREE.Vector3( ...v.target ) );
	};
	app.setPixelRatio = ( v ) => { app.pixelRatio = v; app.dynRes?.set( 1 ); renderer.setPixelRatio( v ); };
	// Shadows off: the shadow's intensity goes to 0 and its map stops being redrawn (the cost goes with
	// it). Toggling castShadow broke the renderer: three r186 disposes the light's shadow map, and the
	// shadow node, still in the compiled materials, read the disposed map when the light cast again
	// ("Cannot read properties of null (reading 'depthTexture')", then WebGPU validation errors).
	app.shadowsOn = true;
	app.setShadows = ( on ) => {
		app.shadowsOn = on;
		app.shadows.setIntensity( on ? 1 : 0 );
		if ( on ) app.shadows.markDirty();
	};
	app.setReflections = ( on ) => {
		app.water.uniforms.reflectivity.value = on ? 1 : 0;
		app.water.reflector.reflector.updateBeforeType = on ? THREE.NodeUpdateType.RENDER : THREE.NodeUpdateType.NONE;
	};
	const _sunTint = new THREE.Color();
	// the look by the hour (world/look.js): the table (edit a row in the console, then app.look.apply())
	app.look = { keys: LOOK_KEYS, at: ( h ) => lookAt( h, LOOK_KEYS ), apply: () => { refreshLook(); app.onSunChanged(); } };
	app.autoExposure = params.get( 'autoexp' ) === '0' ? 0 : 1; // how much the eye adapts by itself where it does (0 = the fixed exposure; ?autoexp=0)
	const _nightLit = new THREE.Color(), _nightAmb = new THREE.Color(), _smokeDay = new THREE.Color( 1, 0.95, 0.88 );
	app.onSunChanged = () => {
		sky.update( false );
		updateCloudSun( sky.state.lightElevation );
		// the moon's glow in the mist, gentle (stronger, it burnt into white bands at the night's exposure)
		app.valleyFog?.sunColor.value.copy( sky.sun.color ).multiplyScalar( sky.state.elevation > - 1 ? Math.min( 1, sky.sun.intensity / SUN_MAX ) : sky.sun.intensity / MOON_MAX * 0.25 );
		app.rivers?.setLight( _sunTint.copy( sky.sun.color ).multiplyScalar( Math.min( 1, sky.sun.intensity / SUN_MAX ) ), app.hazeColor.value );
		app.water.uniforms.sunColor.value.copy( sky.sun.color ).multiplyScalar( Math.min( 1, sky.sun.intensity / SUN_MAX ) );
		clearTimeout( app._envT );
		app._envT = setTimeout( () => sky.buildEnv(), 250 );
		const e = sky.state.elevation;
		// the look by the hour (world/look.js, computed in sky.update): exposure, haze, wind, ...
		const look = sky.state.look;
		const warm = look.warm;
		hazeColor.value.setRGB( 0.5 + 0.04 * warm, 0.6 + 0.08 * warm, 0.72 + 0.1 * warm, THREE.SRGBColorSpace ).multiplyScalar( look.haze );
		// at night the haze takes the night sky's horizon (sky.js), and the exposure rises as the eye
		// adapts: the moonlit scene stays readable, the lanterns and windows stand out
		const night = sky.state.night;
		hazeColor.value.lerp( sky.nightHorizon.value, night );
		// the far haze (fogNode, past 4-14 km) too: a fixed day colour, it glowed over the distant ranges at night
		hazeFar.value.setHex( 0x8fa9cc ).multiplyScalar( look.haze ).lerp( sky.nightHorizon.value, night );
		// the eye adapts from the sunset on (phase 6; now the look's `exposure` and `auto`)
		const adapt = look.auto;
		renderer.toneMappingExposure = look.exposure;
		// and the automatic exposure takes over with it: by day the look as tuned, at dusk and night the
		// eye adapts to what it looks at (moonlit clouds, a dark wood, the lit windows)
		if ( app.exposure ) {
			app.exposure.fixed.value = renderer.toneMappingExposure;
			app.exposure.auto.value = adapt * app.autoExposure;
		}
		// things that are not lit by the lights but kept a fixed day colour, white at night: the
		// shore's foam (water.js) and the chimney smoke (smoke.js, unlit sprites) take the moonlight
		// and the night sky's grey (day: unchanged)
		const lit = e > - 1 ? sky.sun.intensity / SUN_MAX * 0.8 : sky.sun.intensity / MOON_MAX * 0.18; // the sun's or the moon's light
		_nightLit.copy( sky.sun.color ).multiplyScalar( lit ).add( _nightAmb.copy( sky.nightHorizon.value ).multiplyScalar( 1.2 ) );
		// (with the eye's adaptation, from the sunset on: in the dusk they stayed white)
		app.water.uniforms.foamLight.value.setRGB( 1, 1, 1 ).lerp( _nightLit, adapt );
		for ( const l of app.lakes?.list ?? [] ) l.water?.uniforms.foamLight?.value.setRGB( 1, 1, 1 ).lerp( _nightLit, adapt );
		app.smoke?.uniforms.tint.value.copy( _smokeDay ).lerp( _nightLit, adapt );
		// the wind calms at night (to 30%): the leaves and blades swaying over the moonlit sky and clouds
		// opened and closed bright gaps in the dark crowns at every frame (they flickered); without wind
		// the flicker fell from 1.3% to 0.06% of the pixels (tools/flicker.mjs, a wood at 23:00)
		// (the world's one wind, world/wind.js: grass, plants and cloth together)
		wind.calm.value = look.calm;
		lookCool.value = look.cool;
		app.underwater?.setDaylight( hazeColor.value );
		app.underwater?.setSun( sky.state.lightDir, sky.sun.intensity / SUN_MAX );
		app.underside?.setDaylight( hazeColor.value, sky.state.lightDir, sky.sun, app.underwater?.murk.value );
		app.snow?.light.value.copy( hazeColor.value );
		app.seabed?.updateSun( sky.state.lightDir );
		app.fish?.updateSun( sky.state.lightDir );
	};
	// the time of day (world/clock.js): stopped at the opening; the panel's presets and "passar o tempo"
	app.clock = new Clock( app );
	app.onFrame.push( ( dt ) => app.clock.update( dt ) );

	// Post: scene pass -> tone map / sRGB -> colour grade (late-afternoon look).
	const post = new THREE.RenderPipeline( renderer );
	post.outputColorTransform = false;
	// anti-aliasing (the offroad's option): MSAA 4x, or none and FXAA on the final image in the 'baixa'
	// preset (phones). Fixed at load from the stored quality (core/settings.js startQuality): the sample
	// count is part of every scene pipeline; ?msaa=0|2|4 overrides
	const msaa = params.has( 'msaa' ) ? Number( params.get( 'msaa' ) ) : QUALITY[ startQuality() ].msaa;
	app.msaa = msaa;
	const scenePass = pass( scene, camera, { samples: msaa } );
	// the eye's adaptation (post/autoExposure.js): a multiplier on the exposure, measured from the scene
	// after each frame; 1 by day, adaptive from the sunset on (onSunChanged)
	const exposure = new AutoExposure( scenePass.renderTarget.texture );
	app.exposure = exposure;
	// dynamic resolution (core/dynamicRes.js): the scene pass drawn at fewer pixels when the frame rate drops
	const dynRes = new DynamicResolution( scenePass );
	app.dynRes = dynRes;
	app.scenePass = scenePass;
	const grade = uniform( 1.0 );
	app.grade = grade;

	// Auto-focus depth of field on top of the scene pass (toggle: B).
	const focus = new AutoFocus( {
		camera, hf, scenePass,
		targets: [ app.layers.buildings.object, app.layers.fort.object ],
		instanced: [ app.layers.vegetation.object, app.layers.rocks.object ]
	} );
	app.focus = focus;
	// click to focus: a press and release without dragging focuses on the point under the
	// cursor; a click on the sky goes back to the automatic focus at the screen centre
	{
		let down = null;
		canvas.addEventListener( 'pointerdown', ( e ) => { if ( e.button === 0 ) down = { x: e.clientX, y: e.clientY, t: performance.now() }; } );
		canvas.addEventListener( 'pointerup', ( e ) => {
			if ( e.button !== 0 || ! down ) return;
			const moved = Math.hypot( e.clientX - down.x, e.clientY - down.y ), dt = performance.now() - down.t;
			down = null;
			if ( moved > 5 || dt > 350 || ! focus.enabled || app.editor ) return; // in the editors the left button selects and sculpts
			const r = canvas.getBoundingClientRect();
			const hit = focus.focusAt( ( e.clientX - r.left ) / r.width * 2 - 1, - ( ( e.clientY - r.top ) / r.height ) * 2 + 1 );
			app.hud?.toast( hit ? `Foco em ${ focus.hit.toFixed( 1 ) } m` : 'Foco automático no centro' );
		} );
	}

	// Diving: underwater medium while below the surface, water drops on the lens after surfacing.
	const underwater = new Underwater( scenePass );
	const lens = new LensDroplets();
	const lensFn = lens.build();
	const blurred = discBlur( scenePass.getTextureNode(), 6 );
	app.underwater = underwater;
	app.lens = lens;
	const snow = new MarineSnow( { waterLevel: WATER_LEVEL } );
	scene.add( snow.mesh );
	app.snow = snow;
	// the water surface seen from below (Snell's window, total internal reflection)
	const underside = createWaterUnderside( { waterLevel: WATER_LEVEL } );
	scene.add( underside.mesh );
	app.underside = underside;
	app.onFrame.push( ( dt ) => {
		// a river's or a lake's own level when the camera is over one (world/rivers.js, lakeWater.js)
		const wl = app.rivers.levelAt( camera.position.x, camera.position.z ) ?? app.lakes.levelAt( camera.position.x, camera.position.z );
		cam.waterLevel = wl;
		underwater.update( camera, wl );
		lens.update( dt, underwater.on.value > 0.5 );
		snow.update( camera, underwater.on.value > 0.5, wl );
		underside.update( underwater.on.value > 0.5, wl );
	} );

	// Bloom (as in three's ocean example): a soft glow around what is brighter than white in the
	// HDR scene (the sun's glitter on the water, the sun-lit sky near the horizon), from the scene
	// pass at half resolution. Toggled in the panel; when off the output is rebuilt without it.
	// The input is clamped: the sun disc of the SkyMesh is thousands of times brighter than white
	// and turned the bloom into a glare over half of the frame (the sky went white around the sun).
	const bloomPass = bloom( scenePass.getTextureNode().min( vec4( 2.5 ) ), 0.12, 0.3, 1.05 );
	app.bloom = bloomPass;
	let bloomOn = true;

	// Low mist over the water and the valleys (volumetric, raymarched at reduced resolution).
	const mist = params.get( 'mist' ) === '0' ? null : new Mist( { scenePass, camera, waterLevel: WATER_LEVEL } );
	app.mist = mist;
	// and the mist pooling in the valleys and over the bay, following the ground (post/valleyFog.js, after
	// Drusniel's valleyFog); ?valley=0 switches it off
	const valley = params.get( 'valley' ) === '0' ? null : new ValleyFog( { scenePass, camera, heightTex: terrain.heightTex, waterTex: terrain.waterTex, waterLevel: WATER_LEVEL, fogColor: hazeColor, sunDir: sky.state.lightDir } );
	app.valleyFog = valley;
	// volumetric cumulus over the sky's own clouds (post/clouds.js); ?clouds=0 leaves them out
	// the clouds' light: the scene's (sun, moon), but after the sunset the sun still lights the clouds
	// from below the horizon (they are 750-2200 m up) in a deep orange, down to 5 degrees below
	const cloudLight = new THREE.Vector3().copy( sky.state.lightDir ), _afterglow = new THREE.Color( 1, 0.32, 0.14 );
	const clouds = params.get( 'clouds' ) === '0' ? null : new Clouds( { textures: await loadCloudTextures(), scenePass, camera, hazeAmount, hazeColor, sunDir: cloudLight } );
	app.clouds = clouds;
	if ( ! clouds ) clearCloudMap( renderer ); // no clouds, no cloud shadows
	// the cirrus of the volumetric clouds replace the sky's flat clouds
	if ( clouds ) sky.sky.cloudDensity.value = 0;
	if ( clouds ) app.onFrame.push( ( dt ) => {
		clouds.update( dt );
		clouds.coverage.value = sky.sky.cloudCoverage.value; // the panel's "Nuvens" and the rain
		clouds.overcast(); // thinner, softer cumulus under a closed sky
		const se = sky.state.elevation;
		if ( se > - 5 ) {
			// the sun, low or just set: the clouds keep a golden, then orange-red light that the ground
			// has lost (one curve: no gap where the sun's own light reaches 0 at -1 degree)
			cloudLight.copy( sky.state.sunDir );
			const glow = sky.state.look.afterglow * ( 1 - 0.55 * ( app.weather?.wetness?.value ?? 0 ) ); // the look's `afterglow`
			const k = Math.max( se > - 1 ? sky.sun.intensity / SUN_MAX : 0, glow );
			clouds.sunColor.value.copy( se > - 1 ? sky.sun.color : _afterglow ).multiplyScalar( k );
		} else {
			cloudLight.copy( sky.state.lightDir );
			clouds.sunColor.value.copy( sky.sun.color ).multiplyScalar( sky.sun.intensity / SUN_MAX );
		}
		// the sky's light from above, with the lightning's flashes (sky.gain)
		clouds.ambient.value.copy( hazeColor.value ).multiplyScalar( sky.gain.value / 0.4 );
		clouds.strength.value = app.underwater?.on.value > 0.5 ? 0 : 1;
		// the light shafts follow the sun's height and its light under the rain
		clouds.sunVisible.value = sky.state.sunIntensity > 0 ? cloudShadowUniforms.sunFade.value * Math.min( 1, sky.sun.intensity / sky.state.sunIntensity ) : 0; // 0 / 0 with the sun down
	} );
	// rain and wet ground (world/weather.js): the panel's "Chuva", app.setRain( 0..1 ), ?rain=0.8
	const weather = new Weather( app, scene );
	app.weather = weather;
	app.setRain = ( v ) => weather.setRain( v );
	app.onFrame.push( ( dt ) => weather.update( dt, camera, app.underwater?.on.value > 0.5 ) );
	if ( params.has( 'rain' ) ) weather.setRain( Number( params.get( 'rain' ) ) || 1 );
	// lightning (world/lightning.js): storms when the rain passes 60%, the panel's "Raio" (L), app.strike( x, z )
	const lightning = new Lightning( { scene, camera, heightAt: ( x, z ) => hf.heightAt( x, z ), sky } );
	app.lightning = lightning;
	weather.lightning = lightning;
	app.strike = ( x, z ) => lightning.strike( x, z );
	app.onFrame.push( ( dt ) => lightning.update( dt, renderer ) );
	// The night mist (radiation fog: calm, clear nights): it gathers with the night in the valleys and
	// over the water, stays through the dawn and clears by ~8 h; less of it in the rain. One factor,
	// app.nightFog (0 by day: the day is unchanged), drives the valley mist and the low mist.
	const VALLEY_DAY = { density: 0.0028, height: 7, ceiling: 30, pocketStrength: 0.75, sunScatter: 0.3, waterBonus: 0 };
	const VALLEY_NIGHT = { density: 0.008, height: 9, ceiling: 35, pocketStrength: 0.9, sunScatter: 0.5, waterBonus: 0.7 };
	const MIST_DAY = { density: 0.035, top: WATER_LEVEL + 14 }, MIST_NIGHT = { density: 0.045, top: WATER_LEVEL + 18 };
	app.nightFog = 0;
	app.valleyLook = { day: VALLEY_DAY, night: VALLEY_NIGHT }; // the debug panel tunes these (ui/debug.js)
	app.mistLook = { day: MIST_DAY, night: MIST_NIGHT };
	app.onFrame.push( () => {
		// the look's `nightFog` (world/look.js): with the night, through the sunrise, clear by 8 h
		const k = sky.state.look.nightFog * ( 1 - 0.8 * Math.min( 1, app.weather?.target ?? 0 ) );
		app.nightFog = k;
		if ( valley ) for ( const key in VALLEY_DAY ) valley[ key ].value = THREE.MathUtils.lerp( VALLEY_DAY[ key ], VALLEY_NIGHT[ key ], k );
		if ( mist ) for ( const key in MIST_DAY ) mist[ key ].value = THREE.MathUtils.lerp( MIST_DAY[ key ], MIST_NIGHT[ key ], k );
	} );
	if ( valley ) app.onFrame.push( ( dt ) => {
		valley.update( dt );
		valley.strength.value = app.underwater?.on.value > 0.5 ? 0 : 1; // not under the water
	} );
	if ( mist ) app.onFrame.push( ( dt ) => {
		mist.update( dt );
		mist.color.value.copy( hazeColor.value ).multiplyScalar( 1.25 ); // lit like the haze
		mist.strength.value = app.underwater?.on.value > 0.5 ? 0 : 1; // not under the water
	} );

	// Sun shafts (screen-space light scattering, post/godrays.js): the sky around the sun, cut by
	// the mountains, clouds and trees, blurred radially from the sun. ?godrays=0 leaves them out.
	const godrays = params.get( 'godrays' ) === '0' ? null : new Godrays( { scenePass, sunDir: sky.state.sunDir } );
	app.godrays = godrays;
	if ( godrays ) app.onFrame.push( () => {
		const sunUp = THREE.MathUtils.smoothstep( sky.state.elevation, - 1, 6 );
		godrays.update( camera, app.underwater?.on.value > 0.5 ? 0 : sunUp );
	} );

	// Fog scattering (three's webgpu_custom_fog_scattering): light scattered by the humid air
	// softens what lies deep in the haze. A half-resolution blur of the scene is mixed in by the
	// haze amount of each pixel (distance and height rebuilt from the depth); the sky is left sharp.
	const scatter = uniform( 1.6 ); // strength (app.scatter.value); ?scatter=0 leaves the pass out
	app.scatter = scatter;
	const sceneBlur = gaussianBlur( scenePass.getTextureNode( 'output' ), vec2( 2 ), 4, { resolutionScale: 0.5 } );
	const camWorld = uniform( camera.matrixWorld ), camProjInv = uniform( camera.projectionMatrixInverse );
	const scattered = params.get( 'scatter' ) === '0' ? ( src ) => src : ( src ) => {
		const depth = scenePass.getTextureNode( 'depth' ).sample( screenUV ).r;
		const vp = getViewPosition( screenUV, depth, camProjInv );
		const wy = camWorld.mul( vec4( vp, 1 ) ).y;
		const k = hazeAmount( length( vp ), wy ).mul( scatter ).mul( isSky( depth ).select( 0, 1 ) ).clamp( 0, 1 );
		return mix( src, sceneBlur.rgb, k );
	};

	// Ambient occlusion (the offroad's "Ambient occlusion" option, MIT, Arz-Gev; three's GTAONode): contact
	// shading in corners, where a house meets the ground, between rocks, under eaves, inside the crowns.
	// Normals rebuilt from the depth (no MRT: a normal output would change every material's pipeline),
	// half resolution. Multiplied into the scene colour first, faded out between 35 and 70 m (farther, the
	// normals rebuilt from the depth turn to grain and stripes on the hills; the terrain's baked AO takes
	// over) and under water. Built when first switched on; 'off' leaves it out of the output (no cost).
	const AO_LEVELS = { off: null, low: { samples: 8, radius: 1.0, strength: 0.7 }, high: { samples: 16, radius: 1.6, strength: 0.85 } };
	const aoStrength = uniform( 0.7 ), aoFar = uniform( 70 ), aoDebug = uniform( 0 ); // debug 1: the occlusion alone
	let aoNode = null, aoLevel = 'off';
	app.ao = { strength: aoStrength, far: aoFar, debug: aoDebug, get node() { return aoNode; }, get level() { return aoLevel; } };
	// With MSAA the scene pass's depth is a texture_depth_multisampled_2d, which WGSL cannot
	// textureGather (the GTAO's half-resolution path gathers 2x2 depths and keeps the nearest): the
	// gather is given as the texel itself (a point read at half resolution, the same as the other passes)
	const makeAO = () => {
		const depthNode = scenePass.getTextureNode( 'depth' );
		depthNode.gather = () => ( { sample: ( u ) => vec4( depthNode.sample( u ).r ) } );
		const n = gtao( depthNode, null, camera );
		n.resolutionScale = 0.5; // ~0.5 ms low, ~0.9 ms high at 1600x900 (tools/gputime.mjs, the village)
		return n;
	};
	// GTAO's noise (one 4x4 rotation pattern, no temporal filter here) as grain on the grass and the
	// flowers: a depth-aware blur, across at half resolution into a texture and down in the composite
	let aoBlurred = null;
	const occluded = ( src ) => {
		aoNode ??= makeAO();
		if ( ! aoBlurred ) {
			const depthTex = scenePass.getTextureNode( 'depth' );
			const across = rtt( depthAwareBlur( aoNode.getTextureNode(), depthTex, vec2( 2, 0 ).div( screenSize ), camera, 2, 0.5 ), null, null, { resolutionScale: 0.5 } );
			aoBlurred = depthAwareBlur( across, depthTex, vec2( 0, 2 ).div( screenSize ), camera, 2, 0.5 );
		}
		const a = aoBlurred;
		const depth = scenePass.getTextureNode( 'depth' ).sample( screenUV ).r;
		const d = length( getViewPosition( screenUV, depth, camProjInv ) );
		const k = aoStrength.mul( smoothstep( aoFar.mul( 0.5 ), aoFar, d ).oneMinus() ).mul( underwater.on.oneMinus() ).mul( isSky( depth ).select( 0, 1 ) );
		return mix( src.mul( mix( float( 1 ), a, k ) ), vec3( a ), aoDebug );
	};

	const graded = ( input, withBloom, withAO ) => Fn( () => {
		const lit = withAO ? occluded( input.rgb ) : input.rgb;
		const clouded = clouds ? clouds.apply( scattered( lit ) ) : scattered( lit );
		const misty0 = mist ? mist.apply( clouded ) : clouded;
		const misty = valley ? valley.apply( misty0 ) : misty0;
		const src0 = godrays ? godrays.apply( misty ) : misty;
		const src = withBloom ? src0.add( bloomPass.rgb ) : src0;
		const wetRGB = lensFn( underwater.apply( src ), blurred, screenUV ).mul( exposure.texture.sample( vec2( 0.5 ) ).r );
		const c = renderOutput( vec4( wetRGB, 1.0 ) ).toVar();
		const rgb = c.rgb.toVar();
		const luma = dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		// saturation, gentle S-curve, split toning (cool shadows, warm highlights)
		rgb.assign( mix( vec3( luma ), rgb, float( 0.97 ) ) );
		// tame acid greens / yellows: desaturate where green dominates
		const greenness = smoothstep( 0.0, 0.12, rgb.g.sub( max( rgb.r, rgb.b ) ) );
		rgb.assign( mix( rgb, mix( vec3( luma ), rgb, 0.78 ), greenness ) );
		rgb.assign( mix( rgb, rgb.mul( rgb ).mul( rgb.mul( - 2.0 ).add( 3.0 ) ), 0.22 ) );
		// (30% of it at night: almost all of the frame is shadow then, and in full it turned the moonlit grey blue)
		rgb.addAssign( vec3( - 0.012, 0.0, 0.022 ).mul( luma.oneMinus().pow( 2.0 ) ).mul( lookCool ) );
		rgb.addAssign( vec3( 0.06, 0.02, - 0.04 ).mul( luma.pow( 2.0 ) ) );
		rgb.assign( rgb.mul( 0.97 ).add( 0.012 ) ); // lifted blacks
		// soft vignette
		const v = length( uv().sub( 0.5 ).mul( vec3( 1.0, 0.8, 0 ).xy ) );
		rgb.mulAssign( smoothstep( 0.35, 0.85, v ).oneMinus().mul( 0.22 ).add( 0.78 ) );
		return vec4( mix( c.rgb, clamp( rgb, 0.0, 1.0 ), grade ), 1.0 );
	} )();
	// the outputs: with / without depth of field, with / without bloom, and the "oil paint" (post/kuwahara.js,
	// the panel's option): the scene painted in place of the depth of field (the paint smooths already,
	// and the depth of field would sample the unpainted scene); built only when first chosen
	const outputs = {};
	let paint = null;
	const output = () => {
		const withAO = aoLevel !== 'off';
		const key = ( paint ? 'p' : focus.enabled ? 'f' : 's' ) + ( bloomOn ? 'b' : '' ) + ( withAO ? 'o' : '' );
		const input = paint ? paint.node( scenePass.getTextureNode() ) : focus.enabled ? focus.node : scenePass;
		return outputs[ key ] || ( outputs[ key ] = msaa > 0 ? graded( input, bloomOn, withAO ) : fxaa( graded( input, bloomOn, withAO ) ) );
	};
	// 'off' | 'low' | 'high' (the quality presets, the panel's "Oclusão de ambiente"; ?ao=low|high)
	app.setAO = ( level ) => {
		// WebGPU only: on the WebGL 2 backend the occlusion came out white (the depth it reads does not match there)
		const L = AO_LEVELS[ level ] === undefined || ! webgpu ? 'off' : level;
		aoLevel = L;
		if ( L !== 'off' ) {
			const c = AO_LEVELS[ L ];
			aoNode ??= makeAO();
			aoNode.samples.value = c.samples;
			aoNode.radius.value = c.radius;
			aoStrength.value = c.strength;
		}
		post.outputNode = output();
		post.needsUpdate = true;
	};
	app.setPaint = ( on ) => {
		paint = on ? ( app.paint ??= new Kuwahara() ) : null;
		post.outputNode = output();
		post.needsUpdate = true;
	};
	// ?paint=1 starts with it on
	if ( params.get( 'paint' ) === '1' ) { paint = app.paint = new Kuwahara(); post.outputNode = output(); }
	post.outputNode = output();
	app.setFocus = ( on ) => {
		focus.enabled = on;
		post.outputNode = output();
		post.needsUpdate = true;
	};
	app.setBloom = ( on ) => {
		bloomOn = on;
		post.outputNode = output();
		post.needsUpdate = true;
	};
	// on by default (the 'media' preset: low); ?ao=off|low|high
	app.setAO( params.get( 'ao' ) ?? 'low' );
	app.post = post;
	// The sea's reflection is captured before the scene pass, not inside it (world/planarReprojection.js
	// captureBefore): three shares the uniform buffer of the "render" group (camera, lights) between all
	// materials with the same set of those uniforms, and the scene pass, already updated for that render,
	// did not write its camera back after the nested capture. Since the lights joined the reflection's
	// layers the distant ranges (horizon.js) had the same set as the reflection's draws: on the frames
	// with a capture they were drawn with the mirrored camera, upside down over the bay (every frame
	// with ?reflectms=0).
	app.renderFrame = () => {
		const w = app.water;
		if ( w.mesh.visible && w.reflector.reflector.updateBeforeType !== THREE.NodeUpdateType.NONE ) w.reflection?.captureBefore( { renderer, scene, camera, material: w.material } );
		// the clouds' shadow map (world/cloudShadow.js), read by the ground and by the clouds' pass
		if ( clouds ) clouds.renderShadow( renderer );
		post.render();
		exposure.update( renderer, app.frameDt ?? 0 );
	};

	// GPU time per frame (needs ?perf for timestamp queries), at a fixed size.
	app.gpuProfile = async ( frames = 30, w = 1600, h = 900 ) => {
		renderer.setPixelRatio( 1 ); renderer.setSize( w, h, false );
		camera.aspect = w / h; camera.updateProjectionMatrix();
		for ( let k = 0; k < 3; k ++ ) { app.shadows.markDirty(); app.renderFrame(); }
		await renderer.resolveTimestampsAsync( 'render' );
		const t0 = performance.now();
		for ( let k = 0; k < frames; k ++ ) { app.shadows.markDirty(); app.renderFrame(); }
		const gpu = await renderer.resolveTimestampsAsync( 'render' );
		const cpu = ( performance.now() - t0 ) / frames;
		const i = renderer.info.render;
		return { gpuMs: +( gpu / frames ).toFixed( 2 ), cpuMs: +cpu.toFixed( 2 ), tris: i.triangles, calls: i.drawCalls };
	};

	app.capture = async ( name = 'shot', w = 1600, h = 900 ) => {
		app.water.reflection?.invalidate(); // a fresh reflection for the shot
		const prev = { w: innerWidth, h: innerHeight, pr: renderer.getPixelRatio(), scale: scenePass.getResolutionScale() };
		renderer.setPixelRatio( 1 ); renderer.setSize( w, h, false );
		scenePass.setResolutionScale( 1 ); // a shot at full resolution, whatever the dynamic resolution did
		camera.aspect = w / h; camera.updateProjectionMatrix();
		for ( const f of app.onFrame ) f( 0 );
		terrain.update( camera );
		app.terrainShadow.update( camera );
		focus.snap(); // the lens settled on this view, also with the loop paused
		app.hud?.updateFocus( focus );
		if ( app.shadowsOn ) app.shadows.markDirty();
		// the eye adapted to this view at once (a frame to measure it)
		if ( exposure.auto.value > 0.001 ) { exposure.settle(); app.renderFrame(); }
		app.renderFrame();
		const blob = await new Promise( ( r ) => canvas.toBlob( r, 'image/png' ) );
		renderer.setPixelRatio( prev.pr ); renderer.setSize( prev.w, prev.h, false );
		scenePass.setResolutionScale( prev.scale );
		camera.aspect = prev.w / prev.h; camera.updateProjectionMatrix();
		app.lastCaptureBlob = blob; // tools/verify.mjs measures it
		await fetch( '/__capture?name=' + encodeURIComponent( name ), { method: 'POST', body: blob } );
		return name;
	};

	// QA helper: capture a set of preset views to shots/<prefix>_<i>.png
	app.captureViews = async ( prefix, list = app.views.map( ( _, i ) => i ) ) => {
		const out = [];
		for ( const i of list ) {
			app.setView( i );
			for ( let k = 0; k < 3; k ++ ) { app.shadows.markDirty(); app.renderFrame(); }
			await new Promise( ( r ) => setTimeout( r, 250 ) );
			out.push( await app.capture( `${prefix}_${i}` ) );
		}
		return out;
	};

	// Static world: compute matrices once, then skip them every frame.
	for ( const root of [ terrain.mesh, ...Object.values( app.layers ).map( ( l ) => l.object ) ] ) {
		if ( root === app.smoke?.mesh ) continue;
		root.updateMatrixWorld( true );
		root.traverse( ( o ) => { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; } );
	}
	// the reflector target lives under the water mesh and must keep updating
	app.water.mesh.matrixWorldAutoUpdate = true;
	app.water.mesh.traverse( ( o ) => { o.matrixWorldAutoUpdate = true; } );

	await loader.run( 'compile', async () => {
		sky.buildEnv();
		app.onSunChanged();
		// reflection sees only layer 2 (sky, horizon, terrain, buildings, trees)
		const reflector = app.water.reflector.reflector;
		const reflCam = reflector.getVirtualCamera( camera );
		reflCam.layers.set( 2 );
		// stand-ins of the procedural surfaces in the reflection and the shadow pass (core/proxies.js)
		reflCam.layers.enable( PROXY_LAYER );
		app.shadows.enableLayer( PROXY_LAYER );
		// The lights on the reflection's layers too. The reflection (budgeted, world/planarReprojection.js)
		// renders inside the scene pass; seeing no lights, it changed the shared lights state for the
		// transparent draws after the water, and every frame with a capture following one without (or the
		// other way round) built new pipelines for the water's shadow layer and the chimney smoke: ~14 a
		// second, 500+ in a minute, past the browser's shader cache (the cached load recompiled, ~7 s).
		scene.traverse( ( o ) => { if ( o.isLight ) { o.layers.enable( 2 ); o.layers.enable( PROXY_LAYER ); } } );
		// Precompile in the render contexts the frame really uses. The shader cache key of a
		// render object includes its render context, keyed by render target, MRT and call
		// depth (how deeply the render() is nested: the scene pass runs inside post.render(),
		// the water reflection inside the scene pass). compileAsync() always uses depth 0, so
		// a plain compileAsync( scene, camera ) built variants no frame ever used and the
		// first frame rebuilt every shader again (~6 s of freeze after the loader).
		// 1. probe frame with an empty scene (only the water, so the reflection runs too):
		//    records the call depth of each render target.
		const contexts = renderer._renderContexts, getContext = contexts.get; // three.js r186 internals
		const depthOf = new Map();
		const hidden = scene.children.filter( ( o ) => o.visible && ! o.isLight && o !== app.water.mesh );
		hidden.forEach( ( o ) => { o.visible = false; } );
		contexts.get = ( t, m, d ) => { if ( t && ! depthOf.has( t ) ) depthOf.set( t, d ); return getContext.call( contexts, t, m, d ); };
		try { app.renderFrame(); } finally {
			contexts.get = getContext;
			hidden.forEach( ( o ) => { o.visible = true; } );
		}
		// 2. compile the scene for the scene pass and for the reflection, at those depths
		const compileFor = ( cam, rt, mrt ) => {
			const depth = depthOf.get( rt );
			if ( depth === undefined ) console.warn( 'precompile: render target not seen in the probe frame' );
			const prevRT = renderer.getRenderTarget(), prevMRT = renderer.getMRT();
			contexts.get = ( t, m, d ) => getContext.call( contexts, t, m, depth ?? d );
			renderer.setRenderTarget( rt ); renderer.setMRT( mrt );
			// the lights / environment / fog key is cached per render call (info.calls), which
			// compileAsync() does not advance: without this, the second compile reused the key
			// of the first (the reflection camera sees no lights) and built the wrong variants
			renderer.info.calls ++;
			try {
				return renderer.compileAsync( scene, cam ); // the render context is taken synchronously
			} finally {
				contexts.get = getContext;
				renderer.setRenderTarget( prevRT ); renderer.setMRT( prevMRT );
			}
		};
		// the reflection's render target (the reflector keys it by the virtual camera)
		const reflRT = reflector.renderTargets.get( reflCam );
		// One after the other, in the order of a real frame (scene pass, then the reflection
		// nested in it). Concurrent compiles share the scene's lights node, and the reflection
		// camera (layer 2 only) sees no lights, so it would clear them while the scene compile
		// still builds; compiling the reflection first left the main sky white.
		const compiles = async () => {
			await compileFor( camera, scenePass.renderTarget, scenePass.getMRT() );
			if ( ! reflRT ) return;
			app.water.mesh.visible = false; // the reflection pass hides the water itself
			// nor the sky: whenever the whole precompile finished (always with the cache, also cold
			// since the proxies of core/proxies.js made it fast enough), a cold load drew the main
			// sky white (the horizon tone, no clouds), as if through the reflection camera, in the
			// depth-of-field output; cause not pinned down. Its shader is small and builds on the
			// first frame. tools/verify.mjs fails on it.
			sky.sky.visible = false;
			const refl = compileFor( reflCam, reflRT, null );
			app.water.mesh.visible = true;
			sky.sky.visible = true;
			await refl;
		};
		// never block the loader forever (hidden tabs throttle the GPU queue)
		const t0 = performance.now();
		let compiled = false;
		const all = compiles().then( () => { compiled = true; console.info( 'precompile done (ms)', Math.round( performance.now() - t0 ) ); } );
		await Promise.race( [ all, new Promise( ( r ) => setTimeout( r, 12000 ) ) ] );
		app.shadows.enableLayer( 1 );
		// and what only shows under the water (marine snow, the surface seen from below, the water's
		// shadow layer from below...): one frame with the camera dived, every geometry drawing nothing
		if ( compiled && ! params.has( 'nodiveprep' ) ) prepareDive();
		// the automatic exposure's two passes, built now (by day they write 1 and then sleep)
		exposure.warm( renderer );
		// The sun's shadows: on by default again since the terrain casts through a coarse grid of its own
		// (world/terrainShadow.js, 07/10/2026; from 03/10 they were off: the terrain drawn into the three
		// cascades took the village view from 60 to 34-55 FPS). ?shadows=0 (or the quality "Baixa") off.
		app.setShadows( params.get( 'shadows' ) !== '0' );
	} );


	// Prepares the draws of the underwater view without drawing them (after Drusniel: Gods' End,
	// rendering/DrawPreparation.js, MIT, licenses/LICENSE-Drusniel.md: render the real passes with the
	// geometries drawing nothing, so the pipelines are built in the contexts the frames use; a
	// standalone compileAsync builds other variants). The first dive used to build them, a ~0.1-0.2 s
	// hitch (tools/divecost.mjs). Here only the draws that exist just under the water (the marine snow, the
	// surface seen from below) are prepared, from a camera under the sea; the rest of the scene is
	// hidden for that frame (preparing all of it, ~1000 objects, cost ~0.26 s of the load).
	function prepareDive() {
		const t0 = performance.now();
		// a point of the sea at least 6 m deep, the nearest to the village on a coarse grid
		let best = null;
		for ( let z = hf.z0 + 50; z < hf.z0 + hf.size - 50; z += 20 ) for ( let x = hf.x0 + 50; x < hf.x0 + hf.size - 50; x += 20 ) {
			if ( hf.heightAt( x, z ) > WATER_LEVEL - 6 ) continue;
			const d = Math.hypot( x, z );
			if ( ! best || d < best.d ) best = { x, z, d };
		}
		if ( ! best ) return;
		const pos = camera.position.clone(), quat = camera.quaternion.clone();
		const ranges = new Map(), culled = [], hidden = [];
		// only the underwater state (the seabed and the fish are compiled with the scene already; their
		// frame hooks would stream tiles at the dive point, ~0.3 s for nothing)
		const hooks = ( under ) => {
			underwater.update( camera, WATER_LEVEL );
			snow.update( camera, under );
			underside.update( under );
		};
		try {
			camera.position.set( best.x, WATER_LEVEL - 3, best.z );
			camera.lookAt( best.x + 10, WATER_LEVEL - 4, best.z );
			camera.updateMatrixWorld();
			hooks( true );
			// only the draws that exist under the water alone (with the lights: they are part of the
			// shader key), out of the frustum culling, drawing nothing
			// (the water's shadow layer and the chimney smoke get other pipelines seen from under the
			// water too: tools/divecost.mjs lists them; the water mesh carries its shadow layer)
			const targets = [ snow.mesh, underside.mesh, app.water.mesh, app.smoke?.mesh ].filter( Boolean );
			for ( const o of scene.children ) if ( o.visible && ! o.isLight && ! targets.includes( o ) ) { hidden.push( o ); o.visible = false; }
			for ( const t of targets ) t.traverse( ( o ) => {
				if ( o.frustumCulled ) { culled.push( o ); o.frustumCulled = false; }
				const g = o.geometry;
				if ( ! g || ranges.has( g ) ) return;
				ranges.set( g, { start: g.drawRange.start, count: g.drawRange.count } );
				g.setDrawRange( 0, 0 );
			} );
			app.shadows.markDirty(); // the shadow pass too (its own pipelines)
			app.renderFrame();
		} finally {
			for ( const [ g, r ] of ranges ) g.setDrawRange( r.start, r.count );
			for ( const o of culled ) o.frustumCulled = true;
			for ( const o of hidden ) o.visible = true;
			camera.position.copy( pos ); camera.quaternion.copy( quat ); camera.updateMatrixWorld();
			hooks( false );
			// the dive was not real: no water on the lens when the camera "surfaces"
			lens._wasUnder = false; lens.wet.value = 0;
			app.shadows.markDirty();
		}
		console.info( 'dive prepared (ms)', Math.round( performance.now() - t0 ) );
	}

	const hud = new HUD( app );
	app.hud = hud;
	// ambient sound (audio/ambience.js), synthesised; starts on the first click or key
	app.wind = wind; // the world's one wind (world/wind.js), for the console and the QA
	app.ambience = new Ambience( app );
	app.onFrame.push( ( dt ) => app.ambience.update( dt ) );
	// the player's options (core/settings.js): quality preset, audio, renderer, editor
	app.settings = new Settings( app );
	hud.bindOptions( app.settings );
	// visiting together (core/multiplayer.js): a room from the invite link (?sala=), peer to peer
	app.mp = new Multiplayer( app );
	hud.bindMultiplayer( app.mp );
	// the debug panel (ui/debug.js): #debug (or ?debug) in the address; loaded only then
	const wantDebug = () => /debug/i.test( location.hash ) || params.has( 'debug' );
	const openDebug = () => { if ( ! app.debug && ! app._debugLoading ) { app._debugLoading = true; import( './ui/debug.js' ).then( ( m ) => m.createDebugPanel( app ) ); } };
	if ( wantDebug() ) openDebug();
	addEventListener( 'hashchange', () => { if ( wantDebug() ) openDebug(); } );
	// phones and tablets (controls/touch.js): a stick and up / down buttons, shown on the first touch
	app.touch = new TouchControls( app );
	const room = roomFromURL();
	// opened from a link: fly to the first friend heard from (not after a reload that keeps the view)
	let keepView = false;
	try { keepView = !! sessionStorage.getItem( 'castroDoMar:recovery' ); } catch ( e ) { /* no storage */ }
	if ( room ) app.mp.join( room, { follow: ! keepView } );
	// terrain editor (?edit): sculpt the relief, save it into public/terrain-edits.bin
	if ( params.has( 'edit' ) ) {
		const { TerrainEditor } = await import( './editor/terrainEditor.js' );
		app.editor = new TerrainEditor( app );
		// and the village objects (tab "Objetos")
		const { ObjectEditor } = await import( './editor/objectEditor.js' );
		app.objectEditor = new ObjectEditor( app, app.editor );
		// and the painted nature (tab "Natureza"), then the tabs over the three panels
		const { NatureEditor } = await import( './editor/natureEditor.js' );
		app.natureEditor = new NatureEditor( app, app.editor );
		// and the paths (tab "Caminhos"): the village's tracks and new ones, in the world edits
		const { PathEditor } = await import( './editor/pathEditor.js' );
		app.pathEditor = new PathEditor( app, app.editor );
		const { createEditorTabs } = await import( './editor/tabs.js' );
		createEditorTabs( app );
	}

	addEventListener( 'resize', () => {
		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( innerWidth, innerHeight );
	} );

	const timer = new THREE.Timer();
	let firstFrame = true;
	renderer.setAnimationLoop( () => {
		timer.update();
		const rawDt = timer.getDelta();
		const dt = Math.min( rawDt, 0.1 );
		app.frameDt = dt;
		cam.update( dt );
		terrain.update( camera );
		app.terrainShadow.update( camera );
		for ( const f of app.onFrame ) f( dt );
		focus.update( dt );
		hud.updateFocus( focus );
		app.shadows.update();
		if ( app.shadowsOn ) app.shadows.markDirty();
		const tf = firstFrame ? performance.now() : 0;
		app.renderFrame();
		if ( firstFrame ) { firstFrame = false; console.info( 'first frame (ms)', Math.round( performance.now() - tf ) ); }
		hud.update( dt, camera, renderer.info, cam.moveSpeed );
		dynRes.enabled = app.dynamicRes;
		dynRes.update( rawDt );
	} );

	loader.finish( () => hud.show(), AUTO );
	if ( AUTO ) hud.show();
	app.ready = true;
	restoreAfterRecovery( app );
}

const tmpV = new THREE.Vector3(), tmpC = new THREE.Vector3();

// Move the sun + target with the camera, snapped to shadow texels to avoid shimmering.
export { color, mix, smoothstep, normalize, cameraPosition, dot };
