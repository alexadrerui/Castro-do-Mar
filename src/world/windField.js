// The wind field made visible (the panel's "Campo de vento", a breakdown view after Cortiz's grass
// field, debug/DebugWind.tsx): the gust every plant and cloth reads (world/wind.js gustAt) painted as
// grey over a sheet that hovers 1.6 m over the relief around the camera, so a gust can be watched
// crossing the meadow and the blades leaning as it passes; gold chevrons point where it blows.
// Built only the first time it is switched on (its shader with it): nothing at the load.
import * as THREE from 'three/webgpu';
import { Fn, abs, dot, float, fract, max, mix, positionLocal, smoothstep, texture, uniform, vec2, vec3, length } from 'three/tsl';
import { wind, gustAt } from './wind.js';
import { WATER_LEVEL } from './layout.js';

const SIZE = 160, SEGMENTS = 128, LIFT = 1.6, ARROW = 10; // m, quads, m over the ground, m between chevrons

export function createWindField( app ) {
	const hd = app.terrain.heightTex.userData;
	const center = uniform( new THREE.Vector2() );
	const geo = new THREE.PlaneGeometry( SIZE, SIZE, SEGMENTS, SEGMENTS ).rotateX( - Math.PI / 2 );
	const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false } );
	mat.name = 'WindField';
	const heightTex = texture( app.terrain.heightTex );
	const worldXZ = positionLocal.xz.add( center );
	const groundAt = ( xz ) => heightTex.sample( xz.sub( vec2( hd.x0, hd.z0 ) ).div( hd.cell ).add( 0.5 ).div( hd.n ) ).level( 0 ).x;
	mat.positionNode = vec3( worldXZ.x, max( groundAt( worldXZ ), float( WATER_LEVEL ) ).add( LIFT ), worldXZ.y );
	mat.colorNode = Fn( () => {
		const xz = worldXZ;
		// the gust, kept off black and white (black reads as nothing there, white blows out: the scene is
		// HDR and blooms, so the lull is a dark grey and a full gust a light one)
		const g = mix( float( 0.03 ), float( 0.42 ), gustAt( xz ) );
		// chevrons in the wind's frame, pointing downwind
		const d = wind.dir, u = dot( xz, d ), v = dot( xz, vec2( d.y.negate(), d.x ) );
		const fu = fract( u.div( ARROW ) ).sub( 0.5 ), fv = fract( v.div( ARROW ) ).sub( 0.5 );
		const chevron = smoothstep( 0.02, 0.045, abs( fu.add( abs( fv ).mul( 0.9 ) ) ) ).oneMinus().mul( smoothstep( 0.2, 0.24, abs( fv ) ).oneMinus() );
		return mix( vec3( g ), vec3( 0.7, 0.48, 0.16 ), chevron.mul( 0.9 ) );
	} )();
	// faded out towards the sheet's edge
	mat.opacityNode = smoothstep( SIZE * 0.3, SIZE * 0.5, length( positionLocal.xz ) ).oneMinus().mul( 0.5 );
	const mesh = new THREE.Mesh( geo, mat );
	mesh.name = 'windField';
	mesh.frustumCulled = false;
	mesh.renderOrder = 4;
	mesh.layers.set( 1 ); // not in the water's reflection
	mesh.visible = false;
	app.scene.add( mesh );
	// follows the camera in steps (the pattern is in world space, so it does not slide)
	app.onFrame.push( () => {
		if ( ! mesh.visible ) return;
		const p = app.camera.position;
		center.value.set( Math.round( p.x / 4 ) * 4, Math.round( p.z / 4 ) * 4 );
	} );
	return mesh;
}
