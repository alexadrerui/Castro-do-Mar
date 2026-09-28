import * as THREE from 'three/webgpu';
import { fog, uniform, positionWorld, positionView, length, float, exp, color, mix, smoothstep, max, Fn, normalize, cameraPosition, dot, pass, renderOutput, vec3, vec4, uv, clamp, screenUV } from 'three/tsl';

import { Loader } from './ui/loader.js';
import { HUD } from './ui/hud.js';
import { FreeCam } from './controls/freecam.js';
import { AutoFocus } from './controls/focus.js';
import { LensDroplets, discBlur } from './post/lensDroplets.js';
import { Underwater } from './post/underwater.js';
import { MarineSnow } from './post/marineSnow.js';
import { createWaterUnderside } from './world/waterUnderside.js';
import { Seabed } from './world/seabed/seabed.js';
import { FishSchools } from './world/fish/schools.js';
import { WATER_LEVEL } from './world/layout.js';
import { HeightField } from './world/heightfield.js';
import { createTerrain } from './world/terrain.js';
import { createSky } from './world/sky.js';
import { createWater } from './world/water.js';
import { createHorizon } from './world/horizon.js';

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

	hf = new HeightField();
	const worker = new Worker( new URL( './world/gen.worker.js', import.meta.url ), { type: 'module' } );
	const job = ( cmd, p ) => new Promise( ( resolve, reject ) => {
		worker.onmessage = ( e ) => e.data.type === 'progress' ? p( e.data.p ) : resolve( e.data.data );
		worker.onerror = reject;
		worker.postMessage( { cmd } );
	} );
	await loader.run( 'height', async ( p ) => { hf.data = await job( 'height', p ); } );
	app.hf = hf;

	const mask = await loader.run( 'mask', ( p ) => job( 'mask', p ) );
	app.mask = mask;
	const ao = await loader.run( 'ao', ( p ) => job( 'ao', p ) );
	const macro = await loader.run( 'macro', ( p ) => job( 'macro', p ) );
	worker.terminate();

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

	// ---- camera & controls ----
	const cam = new FreeCam( camera, canvas, { groundFn: ( x, z ) => hf.heightAt( x, z ), moveSpeed: 22 } );
	app.freecam = cam;
	const v0 = app.views[ params.has( 'view' ) ? + params.get( 'view' ) : 0 ];
	cam.jumpTo( new THREE.Vector3( ...v0.pos ), new THREE.Vector3( ...v0.target ) );

	app.goView = ( i ) => {
		const v = app.views[ i ];
		cam.flyTo( new THREE.Vector3( ...v.pos ), new THREE.Vector3( ...v.target ), 2.4 );
	};
	app.setView = ( i ) => {
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

	const graded = ( input ) => Fn( () => {
		const wetRGB = lensFn( underwater.apply( input.rgb ), blurred, screenUV );
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
	const outSharp = graded( scenePass );
	const outFocus = graded( focus.node );
	post.outputNode = outFocus;
	app.setFocus = ( on ) => {
		focus.enabled = on;
		post.outputNode = on ? outFocus : outSharp;
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
		// precompile, but never block the loader forever (hidden tabs throttle the GPU queue)
		await Promise.race( [ renderer.compileAsync( scene, camera ), new Promise( ( r ) => setTimeout( r, 12000 ) ) ] );
		// reflection sees only layer 2 (sky, horizon, terrain, buildings, trees)
		app.water.reflector.reflector.getVirtualCamera( camera ).layers.set( 2 );
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
		app.renderFrame();
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
