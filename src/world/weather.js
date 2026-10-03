// Rain and wet ground. The rain is camera-facing streaks placed on the GPU in a box around the camera,
// falling, leaning with the wind and fading at their ends: a port of weather/RainSystem.js of Drusniel:
// Gods' End (https://github.com/danielsobrado/drusniel-gods-end, MIT, Copyright (c) 2026 Daniel Sobrado,
// licenses/LICENSE-Drusniel.md), with an InstancedBufferGeometry like the rest of the project and our
// south-west wind. `wetness` (0..1) is read by the terrain, the buildings and the granite (darker,
// glossier: their GroundMaterial's wet term); it rises while it rains and dries slowly after.
// The weather follows the rain: the clouds close in, the haze thickens and the sun dims, from the
// panel's own values and back to them when it stops; past 60% it storms (world/lightning.js).
// app.weather: setRain( 0..1 ), rain, wetness.
import * as THREE from 'three/webgpu';
import { rainFall, rainClock } from './rainImpacts.js';
import { cameraPosition, float, fract, hash, instanceIndex, mix, positionGeometry, time, uniform, vec3 } from 'three/tsl';

export const wetness = uniform( 0 );

const COUNT = 9000, AREA = 28, BELOW = 25, ABOVE = 35; // drops in a 28 m box from 25 m below to 35 m above the camera
const SPEED = 9, DROP_LENGTH = 1.1, DROP_WIDTH = 0.014, OPACITY = 0.5;
const WIND = { x: 0.7071, z: - 0.7071, strength: 2.5 }; // from the south-west

export class Rain {
	constructor() {
		this.center = uniform( new THREE.Vector3() );
		this.intensity = uniform( 0 );
		const quad = new THREE.PlaneGeometry( 1, 1 ).translate( 0, - 0.5, 0 );
		const geo = new THREE.InstancedBufferGeometry();
		geo.index = quad.index;
		geo.setAttribute( 'position', quad.attributes.position );
		geo.setAttribute( 'uv', quad.attributes.uv );
		geo.instanceCount = COUNT;
		this.mesh = new THREE.Mesh( geo, this._material() );
		this.mesh.name = 'rain';
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 3;
		this.mesh.visible = false;
		this.mesh.layers.set( 1 ); // not in the reflection
	}

	_material() {
		const i = instanceIndex.toFloat();
		const r = ( k ) => hash( i.add( k ) );
		const len = mix( DROP_LENGTH * 0.45, DROP_LENGTH * 1.35, r( 331.71 ) );
		const wid = mix( DROP_WIDTH * 0.55, DROP_WIDTH * 1.25, r( 441.31 ) );
		const spd = mix( SPEED * 0.7, SPEED * 1.35, r( 71.91 ) );
		const range = BELOW + ABOVE;
		// falling through the box (wraps), around the camera's height
		const y = fract( r( 41.27 ).add( time.mul( spd ).div( range ).negate() ) ).mul( range ).sub( BELOW ).add( this.center.y );
		const windE = mix( 0.8, 1.2, r( 121.43 ) ).mul( WIND.strength );
		const wt = time.mul( windE );
		const x = fract( r( 17.13 ).add( wt.mul( WIND.x ).div( AREA ) ).sub( this.center.x.div( AREA ) ) ).sub( 0.5 ).mul( AREA ).add( this.center.x );
		const z = fract( r( 93.71 ).add( wt.mul( WIND.z ).div( AREA ) ).sub( this.center.z.div( AREA ) ) ).sub( 0.5 ).mul( AREA ).add( this.center.z );
		const ph = time.mul( 0.7 ).add( r( 211.17 ).mul( Math.PI * 2 ) );
		const dx = x.add( ph.sin().mul( 0.15 ) ), dz = z.add( ph.cos().mul( 0.15 ) );
		// facing the camera about the vertical, leaning with the wind
		const toCam = cameraPosition.sub( vec3( dx, 0, dz ) );
		const hd = toCam.xz.length().max( 0.001 );
		const right = vec3( toCam.z.div( hd ), 0, toCam.x.div( hd ).negate() );
		const w = positionGeometry.x.mul( wid ), l = positionGeometry.y.mul( len );
		const tilt = positionGeometry.y.add( 0.5 ).mul( windE.div( spd ) ).mul( len );
		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false } );
		mat.name = 'Rain';
		mat.positionNode = vec3( dx.add( right.x.mul( w ) ).add( tilt.mul( WIND.x ) ), y.add( l ), dz.add( right.z.mul( w ) ).add( tilt.mul( WIND.z ) ) );
		const ly = positionGeometry.y.add( 0.5 );
		const profile = ly.mul( float( 1 ).sub( ly ) ).mul( 4 ).clamp( 0, 1 );
		// the drops right at the lens thin out (wide white bars there, blurred wider by the depth of field)
		const near = cameraPosition.distance( vec3( dx, y, dz ) ).smoothstep( 1.5, 3.5 );
		mat.opacityNode = profile.mul( 0.1 ).mul( mix( 0.5, 1, r( 551.91 ) ) ).mul( OPACITY ).clamp( 0.05, 1 ).mul( this.intensity ).mul( near );
		mat.colorNode = vec3( 0.78, 0.86, 1.0 );
		return mat;
	}

	update( camera, intensity ) {
		this.intensity.value = intensity;
		this.mesh.visible = intensity > 0.001;
		if ( this.mesh.visible ) this.center.value.copy( camera.position );
	}
}

export class Weather {
	// app: sky, fogScale; scene to add the rain to
	constructor( app, scene ) {
		this.app = app;
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
		const w = wetness.value;
		wetness.value = this.level > w ? Math.min( this.level, w + dt / 40 ) : Math.max( this.level, w - dt / 120 );
		this.rain.update( camera, underwater ? 0 : this.level );
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
		if ( this.app.shadowsOn !== false ) sky.sun.shadow.intensity = 1 - 0.6 * e;
	}
}
