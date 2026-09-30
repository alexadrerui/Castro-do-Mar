import * as THREE from 'three/webgpu';
import { fog, uniform, positionWorld, positionView, length, float, exp, color, mix, smoothstep, max, Fn, normalize, cameraPosition, dot, pass, renderOutput, vec3, vec4, uv, clamp, screenUV } from 'three/tsl';

import { Loader } from './ui/loader.js';
import { HUD } from './ui/hud.js';
import { FreeCam } from './controls/freecam.js';
import { AutoFocus } from './controls/focus.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { LensDroplets, discBlur } from './post/lensDroplets.js';
import { Underwater } from './post/underwater.js';
import { MarineSnow } from './post/marineSnow.js';
import { createWaterUnderside } from './world/waterUnderside.js';
import { Seabed } from './world/seabed/seabed.js';
import { FishSchools } from './world/fish/schools.js';
import { Gulls } from './world/birds/gulls.js';
import { WATER_LEVEL } from './world/layout.js';
import { HeightField } from './world/heightfield.js';
import { createTerrain } from './world/terrain.js';
import { createSky } from './world/sky.js';
import { createWater } from './world/water.js';
import { createHorizon } from './world/horizon.js';
import { cacheGet, cachePut, cacheClear, hashSources } from './core/cache.js';
// the generated fields depend only on this code: its hash is the cache key
import srcHeight from './world/heightfield.js?raw';
import srcLayout from './world/layout.js?raw';
import srcNoise from './core/noise.js?raw';
import srcWorker from './world/gen.worker.js?raw';

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

const loader = new Loader( STEPS );

main().catch( ( e ) => loader.fail( e ) );

async function main() {

	const canvas = document.getElementById( 'view' );
	let renderer, scene, camera, hf, terrain;

	await loader.run( 'gpu', async () => {
		renderer = new THREE.WebGPURenderer( { canvas, antialias: false, forceWebGL: FORCE_WEBGL, powerPreference: 'high-performance', trackTimestamp: params.has( 'perf' ) } );
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
	} );

	// Heightfield, splat mask, AO and macro noise: from the IndexedDB cache when
	// the generator code is unchanged, otherwise baked in the worker and stored.
	hf = new HeightField();
	const genKey = 'fields:' + hashSources( srcHeight, srcLayout, srcNoise, srcWorker );
	app.clearCache = cacheClear;
	const cached = await cacheGet( genKey );
	let mask, ao, macro;
	if ( cached && cached.height?.length === hf.data.length ) {
		console.info( 'fields: from cache', genKey );
		for ( const id of [ 'height', 'mask', 'ao', 'macro' ] ) await loader.run( id, async () => {} );
		( { mask, ao, macro } = cached );
		hf.data = cached.height;
	} else {
		const worker = new Worker( new URL( './world/gen.worker.js', import.meta.url ), { type: 'module' } );
		const job = ( cmd, p ) => new Promise( ( resolve, reject ) => {
			worker.onmessage = ( e ) => e.data.type === 'progress' ? p( e.data.p ) : resolve( e.data.data );
			worker.onerror = reject;
			worker.postMessage( { cmd } );
		} );
		await loader.run( 'height', async ( p ) => { hf.data = await job( 'height', p ); } );
		mask = await loader.run( 'mask', ( p ) => job( 'mask', p ) );
		ao = await loader.run( 'ao', ( p ) => job( 'ao', p ) );
		macro = await loader.run( 'macro', ( p ) => job( 'macro', p ) );
		worker.terminate();
		// store in the background (structured clone copies the arrays)
		cachePut( genKey, { height: hf.data, mask, ao, macro }, 'fields:' ).then( () => console.info( 'fields: cached', genKey ) );
	}
	app.hf = hf;
	app.mask = mask;

	let sky;
	await loader.run( 'sky', async () => {
		sky = createSky( scene, renderer );
		app.sky = sky;
	} );

	await loader.run( 'terrain', async () => {
		terrain = createTerrain( hf, mask, ao, sky.state.sunDir, macro );
		scene.add( terrain.mesh );
		app.terrain = terrain;
	} );


	await loader.run( 'water', async () => {
		const water = createWater( terrain.heightTex, sky.state.sunDir );
		scene.add( water.mesh );
		app.water = water;
		app.layers.water = { label: 'Água', object: water.mesh };
	} );

	await loader.run( 'horizon', async ( p ) => {
		const h = await createHorizon( p );
		h.layers.enable( 2 );
		scene.add( h );
		app.layers.horizon = { label: 'Horizonte', object: h };
	} );

	// Aerial perspective: exponential-squared haze that thins with altitude.
	const hazeColor = uniform( new THREE.Color( 0x9db6d6 ) );
	app.hazeColor = hazeColor;
	const hazeFar = uniform( new THREE.Color( 0x8fa9cc ) );
	scene.fogNode = fog( mix( hazeColor, hazeFar, smoothstep( 4000, 14000, length( positionView ) ) ), Fn( () => {
		const d = length( positionView );
		const dens = float( 0.00013 ).mul( app.fogScale );
		const f = float( 1 ).sub( exp( d.mul( dens ).negate() ) );
		const altitude = exp( max( positionWorld.y, 0 ).div( 2200 ).negate() );
		return f.mul( altitude.mul( 0.55 ).add( 0.45 ) ).mul( 0.72 );
	} )() );

	await loader.run( 'world', async ( p ) => {
		const mod = await import( './world/populate.js' );
		await mod.populate( app, p );
	} );

	// Seabed life, streamed in tiles around the camera (only near / under the water).
	const seabed = new Seabed( { hf, waterLevel: WATER_LEVEL, sun: sky.sun, sunDir: sky.state.sunDir } );
	scene.add( seabed.group );
	app.seabed = seabed;
	app.layers.seabed = { label: 'Fundo do mar', object: seabed.group };
	app.onFrame.push( () => seabed.update( camera ) );
	// Fish, spawned by habitat in cells around the camera (only near / under the water).
	const fish = new FishSchools( { hf, seabed, sun: sky.sun, sunDir: sky.state.sunDir, getViewHeight: () => renderer.domElement.height } );
	scene.add( fish.group );
	app.fish = fish;
	app.layers.fish = { label: 'Peixes', object: fish.group };
	app.onFrame.push( ( dt ) => fish.update( dt, camera ) );
	// Gulls soaring over the bay (animated in the vertex shader).
	const gulls = new Gulls( { hf, waterLevel: WATER_LEVEL } );
	scene.add( gulls.mesh );
	app.gulls = gulls;
	app.layers.gulls = { label: 'Gaivotas', object: gulls.mesh };
	app.onFrame.push( ( dt ) => gulls.update( dt ) );

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
	app.setPixelRatio = ( v ) => { app.pixelRatio = v; dyn.scale = 1; renderer.setPixelRatio( v ); };
	app.setShadows = ( on ) => { sky.sun.castShadow = on; };
	app.setReflections = ( on ) => {
		app.water.uniforms.reflectivity.value = on ? 1 : 0;
		app.water.reflector.reflector.updateBeforeType = on ? THREE.NodeUpdateType.RENDER : THREE.NodeUpdateType.NONE;
	};
	app.onSunChanged = () => {
		sky.update( false );
		app.water.uniforms.sunColor.value.copy( sky.sun.color ).multiplyScalar( Math.min( 1, sky.sun.intensity / 4.2 ) );
		clearTimeout( app._envT );
		app._envT = setTimeout( () => sky.buildEnv(), 250 );
		const e = sky.state.elevation;
		const warm = THREE.MathUtils.smoothstep( e, 0, 22 );
		hazeColor.value.setRGB( 0.5 + 0.04 * warm, 0.6 + 0.08 * warm, 0.72 + 0.1 * warm, THREE.SRGBColorSpace ).multiplyScalar( 0.35 + 0.65 * THREE.MathUtils.smoothstep( e, - 4, 12 ) );
		app.underwater?.setDaylight( hazeColor.value );
		app.underwater?.setSun( sky.state.sunDir, sky.sun.intensity / 5.4 );
		app.underside?.setDaylight( hazeColor.value, sky.state.sunDir, sky.sun, app.underwater?.murk.value );
		app.snow?.light.value.copy( hazeColor.value );
		app.seabed?.updateSun( sky.state.sunDir );
		app.fish?.updateSun( sky.state.sunDir );
	};

	// Post: scene pass -> tone map / sRGB -> colour grade (late-afternoon look).
	const post = new THREE.RenderPipeline( renderer );
	post.outputColorTransform = false;
	const scenePass = pass( scene, camera, { samples: 4 } );
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
			if ( moved > 5 || dt > 350 || ! focus.enabled ) return;
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
		underwater.update( camera, WATER_LEVEL );
		lens.update( dt, underwater.on.value > 0.5 );
		snow.update( camera, underwater.on.value > 0.5 );
		underside.update( underwater.on.value > 0.5 );
	} );

	// Bloom (as in three's ocean example): a soft glow around what is brighter than white in the
	// HDR scene (the sun's glitter on the water, the sun-lit sky near the horizon), from the scene
	// pass at half resolution. Toggled in the panel; when off the output is rebuilt without it.
	const bloomPass = bloom( scenePass.getTextureNode(), 0.16, 0.35, 1.05 );
	app.bloom = bloomPass;
	let bloomOn = true;

	const graded = ( input, withBloom ) => Fn( () => {
		const src = withBloom ? input.rgb.add( bloomPass.rgb ) : input.rgb;
		const wetRGB = lensFn( underwater.apply( src ), blurred, screenUV );
		const c = renderOutput( vec4( wetRGB, 1.0 ) ).toVar();
		const rgb = c.rgb.toVar();
		const luma = dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		// saturation, gentle S-curve, split toning (cool shadows, warm highlights)
		rgb.assign( mix( vec3( luma ), rgb, float( 0.97 ) ) );
		// tame acid greens / yellows: desaturate where green dominates
		const greenness = smoothstep( 0.0, 0.12, rgb.g.sub( max( rgb.r, rgb.b ) ) );
		rgb.assign( mix( rgb, mix( vec3( luma ), rgb, 0.78 ), greenness ) );
		rgb.assign( mix( rgb, rgb.mul( rgb ).mul( rgb.mul( - 2.0 ).add( 3.0 ) ), 0.22 ) );
		rgb.addAssign( vec3( - 0.012, 0.0, 0.022 ).mul( luma.oneMinus().pow( 2.0 ) ) );
		rgb.addAssign( vec3( 0.06, 0.02, - 0.04 ).mul( luma.pow( 2.0 ) ) );
		rgb.assign( rgb.mul( 0.97 ).add( 0.012 ) ); // lifted blacks
		// soft vignette
		const v = length( uv().sub( 0.5 ).mul( vec3( 1.0, 0.8, 0 ).xy ) );
		rgb.mulAssign( smoothstep( 0.35, 0.85, v ).oneMinus().mul( 0.22 ).add( 0.78 ) );
		return vec4( mix( c.rgb, clamp( rgb, 0.0, 1.0 ), grade ), 1.0 );
	} )();
	// the four outputs: with / without depth of field, with / without bloom
	const outputs = {};
	const output = () => {
		const key = ( focus.enabled ? 'f' : 's' ) + ( bloomOn ? 'b' : '' );
		return outputs[ key ] || ( outputs[ key ] = graded( focus.enabled ? focus.node : scenePass, bloomOn ) );
	};
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
	app.post = post;
	app.renderFrame = () => post.render();

	// GPU time per frame (needs ?perf for timestamp queries), at a fixed size.
	app.gpuProfile = async ( frames = 30, w = 1600, h = 900 ) => {
		renderer.setPixelRatio( 1 ); renderer.setSize( w, h, false );
		camera.aspect = w / h; camera.updateProjectionMatrix();
		for ( let k = 0; k < 3; k ++ ) { sky.sun.shadow.needsUpdate = true; app.renderFrame(); }
		await renderer.resolveTimestampsAsync( 'render' );
		const t0 = performance.now();
		for ( let k = 0; k < frames; k ++ ) { sky.sun.shadow.needsUpdate = true; app.renderFrame(); }
		const gpu = await renderer.resolveTimestampsAsync( 'render' );
		const cpu = ( performance.now() - t0 ) / frames;
		const i = renderer.info.render;
		return { gpuMs: +( gpu / frames ).toFixed( 2 ), cpuMs: +cpu.toFixed( 2 ), tris: i.triangles, calls: i.drawCalls };
	};

	app.capture = async ( name = 'shot', w = 1600, h = 900 ) => {
		const prev = { w: innerWidth, h: innerHeight, pr: renderer.getPixelRatio() };
		renderer.setPixelRatio( 1 ); renderer.setSize( w, h, false );
		camera.aspect = w / h; camera.updateProjectionMatrix();
		for ( const f of app.onFrame ) f( 0 );
		terrain.update( camera );
		sky.sun.shadow.needsUpdate = true;
		app.renderFrame();
		const blob = await new Promise( ( r ) => canvas.toBlob( r, 'image/png' ) );
		renderer.setPixelRatio( prev.pr ); renderer.setSize( prev.w, prev.h, false );
		camera.aspect = prev.w / prev.h; camera.updateProjectionMatrix();
		await fetch( '/__capture?name=' + encodeURIComponent( name ), { method: 'POST', body: blob } );
		return name;
	};

	// QA helper: capture a set of preset views to shots/<prefix>_<i>.png
	app.captureViews = async ( prefix, list = app.views.map( ( _, i ) => i ) ) => {
		const out = [];
		for ( const i of list ) {
			app.setView( i );
			for ( let k = 0; k < 3; k ++ ) { sky.sun.shadow.needsUpdate = true; app.renderFrame(); }
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
			const refl = compileFor( reflCam, reflRT, null );
			app.water.mesh.visible = true;
			await refl;
		};
		// never block the loader forever (hidden tabs throttle the GPU queue)
		const t0 = performance.now();
		const all = compiles().then( () => console.info( 'precompile done (ms)', Math.round( performance.now() - t0 ) ) );
		await Promise.race( [ all, new Promise( ( r ) => setTimeout( r, 12000 ) ) ] );
		sky.sun.shadow.camera.layers.enable( 1 );
	} );


	const hud = new HUD( app );
	app.hud = hud;

	addEventListener( 'resize', () => {
		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( innerWidth, innerHeight );
	} );

	const timer = new THREE.Timer();
	let firstFrame = true;
	renderer.setAnimationLoop( () => {
		timer.update();
		const dt = Math.min( timer.getDelta(), 0.1 );
		cam.update( dt );
		terrain.update( camera );
		for ( const f of app.onFrame ) f( dt );
		focus.update( dt );
		hud.updateFocus( focus );
		// keep the shadow frustum centred ahead of the camera
		const fwd = camera.getWorldDirection( tmpV ).setY( 0 ).normalize();
		const c = tmpC.copy( camera.position ).addScaledVector( fwd, 80 );
		c.y = hf.heightAt( c.x, c.z );
		snapShadow( sky.sun, c );
		sky.sun.shadow.needsUpdate = true;
		const tf = firstFrame ? performance.now() : 0;
		app.renderFrame();
		if ( firstFrame ) { firstFrame = false; console.info( 'first frame (ms)', Math.round( performance.now() - tf ) ); }
		hud.update( dt, camera, renderer.info, cam.moveSpeed );
		adaptResolution( dt );
	} );

	loader.finish( () => hud.show(), AUTO );
	if ( AUTO ) hud.show();
	app.ready = true;
}

const tmpV = new THREE.Vector3(), tmpC = new THREE.Vector3();

// Dynamic resolution: trade pixels for frame rate, never above the user's choice.
const dyn = { acc: 0, n: 0, scale: 1 };
function adaptResolution( dt ) {
	if ( ! app.dynamicRes ) return;
	dyn.acc += dt; dyn.n ++;
	if ( dyn.acc < 1.0 ) return;
	const fps = dyn.n / dyn.acc;
	dyn.acc = 0; dyn.n = 0;
	const max = app.pixelRatio;
	if ( fps < 27 && dyn.scale > 0.55 ) dyn.scale = Math.max( 0.55, dyn.scale - 0.1 );
	else if ( fps > 48 && dyn.scale < 1 ) dyn.scale = Math.min( 1, dyn.scale + 0.05 );
	else return;
	app.renderer.setPixelRatio( max * dyn.scale );
}

// Move the sun + target with the camera, snapped to shadow texels to avoid shimmering.
function snapShadow( sun, center ) {
	const texel = ( sun.shadow.camera.right - sun.shadow.camera.left ) / sun.shadow.mapSize.x;
	const snap = texel * 4;
	const x = Math.round( center.x / snap ) * snap, z = Math.round( center.z / snap ) * snap;
	const dir = tmpV.copy( sun.position ).sub( sun.target.position ).normalize();
	sun.target.position.set( x, center.y, z );
	sun.position.copy( sun.target.position ).addScaledVector( dir, 700 );
	sun.target.updateMatrixWorld();
}

export { color, mix, smoothstep, normalize, cameraPosition, dot };
