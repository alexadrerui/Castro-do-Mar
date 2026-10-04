// Rain and wet ground. The rain streaks follow Cortiz's RainCurtain (Stylized Premium Scenes,
// https://github.com/CortizLabs/stylized-premium-patreon, src/components/rain/RainCurtain.tsx and
// shaders/rainStreak.ts, MIT License, Copyright (c) 2026 Christian Ortiz, licenses/LICENSE-Cortiz.md);
// first they were camera-facing streaks placed on the GPU in a box around the camera,
// falling, leaning with the wind and fading at their ends: a port of weather/RainSystem.js of Drusniel:
// Gods' End (https://github.com/danielsobrado/drusniel-gods-end, MIT, Copyright (c) 2026 Daniel Sobrado,
// licenses/LICENSE-Drusniel.md), with an InstancedBufferGeometry like the rest of the project and our
// south-west wind. `wetness` (0..1) is read by the terrain, the buildings and the granite (darker,
// glossier: their GroundMaterial's wet term); it rises while it rains and dries slowly after.
// The weather follows the rain: the clouds close in, the haze thickens and the sun dims, from the
// panel's own values and back to them when it stops; past 60% it storms (world/lightning.js).
// app.weather: setRain( 0..1 ), rain, wetness.
import * as THREE from 'three/webgpu';
import { rainFall, rainClock, rainImpacts, rainSplatter } from './rainImpacts.js';
import { clothWind } from './materials.js';
import { cameraPosition, cross, float, fract, hash, instanceIndex, mix, positionGeometry, smoothstep, time, uniform, uv, varying, vec3 } from 'three/tsl';

export const wetness = uniform( 0 );

const WIND = { x: 0.7071, z: - 0.7071, strength: 2.5 }; // from the south-west
// Two layers, after Cortiz's RainCurtain (as above): the mass of the weather far around, and a few
// fat drops near the lens for the parallax that makes rain read as volume rather than as a texture.
const LAYERS = {
	far: { count: 9000, half: 30, height: 50, below: 20, speed: 8.5, width: 0.006, opacity: 0.32, fadeNear: 3, fadeFar: 55 },
	near: { count: 600, half: 7, height: 16, below: 8, speed: 9.5, width: 0.02, opacity: 0.22, fadeNear: 1.6, fadeFar: 9 }
};
const EXPOSURE = 0.085; // s: a streak is the path a drop covers in it, relative to the camera
const MIN_PIXELS = 1.5;  // a streak is never drawn thinner (its alpha paid back), or it breaks into crawling dashes

const camVel = uniform( new THREE.Vector3() ), pixelScale = uniform( 0.002 ), rainLight = uniform( new THREE.Color( 0.75, 0.82, 0.95 ) );

export class Rain {
	constructor() {
		this.intensity = uniform( 0 );
		// both layers in one instanced mesh (one draw, one pipeline): the first LAYERS.far.count drops
		// are the far layer, the rest the near one
		const quad = new THREE.PlaneGeometry( 1, 1 );
		const geo = new THREE.InstancedBufferGeometry();
		geo.index = quad.index;
		geo.setAttribute( 'position', quad.attributes.position );
		geo.setAttribute( 'uv', quad.attributes.uv );
		geo.instanceCount = LAYERS.far.count + LAYERS.near.count;
		this.mesh = new THREE.Mesh( geo, this._material() );
		this.mesh.name = 'rain';
		this.mesh.frustumCulled = false; // the column is around the camera
		this.mesh.renderOrder = 3;
		this.mesh.visible = false;
		this.mesh.layers.set( 1 ); // not in the reflection
		this._prev = null;
		this.forceVelocity = null; // QA: a Vector3 the camera is taken to move at (tools/rainfx.mjs)
	}

	// Every drop has a fixed place in the WORLD on a lattice that falls (and drifts with the wind),
	// wrapped in a box around the camera on all three axes: the camera moves through the rain and
	// the rain does not move with it (the old box followed the camera's height). A streak is drawn
	// along the drop's velocity RELATIVE TO THE CAMERA over a short exposure, so flying into the rain
	// draws it towards the lens, like a photograph would; facing the camera about that direction.
	_material() {
		const i = instanceIndex.toFloat();
		const near = i.greaterThanEqual( LAYERS.far.count );
		const P = {};
		for ( const k of [ 'half', 'height', 'below', 'speed', 'width', 'opacity', 'fadeNear', 'fadeFar' ] ) P[ k ] = near.select( float( LAYERS.near[ k ] ), float( LAYERS.far[ k ] ) );
		const r = ( k ) => hash( i.add( k ) );
		// real rain is not one drop size: speed and length paired (a long exposure does that), width apart
		const spd = P.speed.mul( mix( 0.75, 1.3, r( 71.91 ) ) );
		const lenK = mix( 0.7, 1.3, r( 331.71 ) );
		const wid = P.width.mul( mix( 0.6, 1.4, r( 441.31 ) ) );
		const windE = mix( 0.8, 1.2, r( 121.43 ) ).mul( WIND.strength );
		const vDrop = vec3( windE.mul( WIND.x ), spd.negate(), windE.mul( WIND.z ) );
		const wrap = ( seed, travel, lo, span ) => fract( seed.mul( span ).add( travel ).sub( lo ).div( span ) ).mul( span ).add( lo );
		const side2 = P.half.mul( 2 );
		const x = wrap( r( 17.13 ), time.mul( vDrop.x ), cameraPosition.x.sub( P.half ), side2 );
		const z = wrap( r( 93.71 ), time.mul( vDrop.z ), cameraPosition.z.sub( P.half ), side2 );
		const y = wrap( r( 41.27 ), time.mul( vDrop.y ), cameraPosition.y.sub( P.below ), P.height );
		const center = vec3( x, y, z );
		const vRel = vDrop.sub( camVel ), sp = vRel.length().max( 0.001 );
		const dir = vRel.div( sp );
		const len = sp.mul( EXPOSURE ).clamp( 0.12, 4 ).mul( lenK );
		const toCam = cameraPosition.sub( center ).normalize();
		const side = cross( dir, toCam ).normalize();
		const d = cameraPosition.distance( center );
		const drawW = wid.max( pixelScale.mul( MIN_PIXELS ).mul( d ) );
		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, side: THREE.DoubleSide } );
		mat.name = 'Rain';
		mat.forceSinglePass = true; // double-sided (the quad's winding follows the drop) in one pass: one pipeline, not two
		mat.positionNode = center.add( side.mul( positionGeometry.x.mul( drawW ) ) ).add( dir.mul( positionGeometry.y.mul( len ) ) );
		// per drop: how much it was widened (paid back in alpha), the fades at the lens and into the haze,
		// and a brightness of its own (else the curtain reads as one texture)
		const k = varying( wid.div( drawW ).mul( P.opacity )
			.mul( smoothstep( 0, P.fadeNear, d ) ).mul( smoothstep( P.fadeFar.mul( 0.55 ), P.fadeFar, d ).oneMinus() )
			.mul( mix( 0.55, 1, r( 551.91 ) ) ), 'vRainK' );
		const across = uv().x.mul( 2 ).sub( 1 ).abs().oneMinus();
		const along = uv().y; // 1 at the leading end: the drop itself, the rest the smeared trail
		const head = smoothstep( 0.68, 1, along ).mul( 0.8 );
		mat.opacityNode = smoothstep( 0, 0.6, across ).mul( smoothstep( 0, 0.3, along ) ).mul( smoothstep( 0, 0.45, along.oneMinus() ) )
			.mul( head.add( 1 ) ).mul( k ).mul( this.intensity );
		mat.colorNode = rainLight.mul( head.add( 1 ) );
		return mat;
	}

	// camera: the view; dt: the frame; renderer: for the pixel size; light: the drops' colour
	update( camera, intensity, dt = 1 / 60, renderer = null, light = null ) {
		this.intensity.value = intensity;
		this.mesh.visible = intensity > 0.001;
		// the camera's velocity, smoothed; a jump (a preset view) is not a velocity
		const p = camera.position;
		if ( this._prev && dt > 0 ) {
			const raw = this._v || ( this._v = new THREE.Vector3() );
			raw.subVectors( p, this._prev ).divideScalar( dt );
			if ( raw.length() > 150 ) raw.set( 0, 0, 0 ); else raw.clampLength( 0, 60 );
			camVel.value.lerp( raw, Math.min( 1, dt * 8 ) );
		}
		( this._prev || ( this._prev = new THREE.Vector3() ) ).copy( p );
		if ( this.forceVelocity ) camVel.value.copy( this.forceVelocity );
		if ( ! this.mesh.visible ) return;
		if ( renderer && camera.isPerspectiveCamera ) {
			const h = renderer.getDrawingBufferSize( this._bs || ( this._bs = new THREE.Vector2() ) ).y;
			pixelScale.value = 2 * Math.tan( camera.fov * Math.PI / 360 ) / Math.max( h, 1 );
		}
		if ( light ) rainLight.value.copy( light );
	}
}

export class Weather {
	// app: sky, fogScale; scene to add the rain to
	constructor( app, scene ) {
		this.app = app;
		// the drops' effects on the surfaces, for tuning from the console and the QA (world/rainImpacts.js)
		app.rainFx = { ripples: rainImpacts, splatter: rainSplatter, fall: rainFall };
		this.rain = new Rain();
		scene.add( this.rain.mesh );
		this.target = 0;  // the rain asked for (0..1)
		this.level = 0;   // the rain now (eases in and out)
		this.base = null; // the panel's clouds and haze before the rain
		this.wetness = wetness;
	}

	setRain( v ) {
		this.target = THREE.MathUtils.clamp( v, 0, 1 );
		if ( this.target > 0 && ! this.base ) this.base = { cloud: this.app.sky.sky.cloudCoverage.value, fog: this.app.fogScale.value };
	}

	update( dt, camera, underwater ) {
		// the rain eases in and out over a few seconds; the ground wets in ~40 s and dries in ~2 min
		this.level += ( this.target - this.level ) * Math.min( 1, dt / 4 );
		// the drops landing (world/rainImpacts.js): rings on the water and the puddles, glints
		rainFall.value = this.level;
		rainClock.value += dt;
		// and the wind in the cloth picks up (world/materials.js clothWind)
		clothWind.strength.value = 0.5 * ( 1 + 0.6 * this.level );
		clothWind.turb.value = 0.12 * ( 1 + 1.0 * this.level );
		const w = wetness.value;
		wetness.value = this.level > w ? Math.min( this.level, w + dt / 40 ) : Math.max( this.level, w - dt / 120 );
		// the drops lit like the air around them: the sky's light, dim at night
		const night = this.app.sky.state.night ?? 0;
		this._rainLight = ( this._rainLight || new THREE.Color() ).setRGB( 0.75, 0.82, 0.95 ).multiplyScalar( 1 - 0.85 * night );
		this.rain.update( camera, underwater ? 0 : this.level, dt, this.app.renderer, this._rainLight );
		// a storm past 60% rain (world/lightning.js); its shaders are warmed before the first strike
		const L = this.lightning;
		if ( L ) {
			if ( this.level > 0.4 ) L.warm();
			L.storm = underwater ? 0 : THREE.MathUtils.clamp( ( this.level - 0.6 ) / 0.4, 0, 1 );
		}
		const e = this.level, sky = this.app.sky;
		if ( this.base ) {
			sky.sky.cloudCoverage.value = this.base.cloud + ( 0.95 - this.base.cloud ) * e;
			this.app.fogScale.value = this.base.fog * ( 1 + 1.4 * e );
			if ( this.target === 0 && e < 0.002 ) { sky.sky.cloudCoverage.value = this.base.cloud; this.app.fogScale.value = this.base.fog; this.base = null; }
		}
		// the sun dims under the rain clouds (sky.update sets its clear-sky intensity on every change)
		if ( sky.state.sunIntensity !== undefined ) sky.sun.intensity = sky.state.sunIntensity * ( 1 - 0.55 * e );
		// and the shadows soften (unless the panel switched them off: app.setShadows)
		if ( this.app.shadowsOn !== false ) this.app.shadows?.setIntensity( 1 - 0.6 * e );
	}
}
