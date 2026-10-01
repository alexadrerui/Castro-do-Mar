// Review page of the castro house reconstruction (review/castro.html, ref/casa_castro): the house
// alone on a grey studio backdrop, framed from the five reference viewpoints.
// URL: ?detail=0|1|2 (castroHouse.js pass level), ?flat (one grey material: silhouette check),
// ?unlit (one unlit grey), ?mat (the village materials), ?plain (flat neutral backdrop).
// window.__review.shoot( name ) renders every view and POSTs shots/<name>_ref<k>.png (tools/castroreview.mjs).
import * as THREE from 'three/webgpu';
import { screenUV, mix, vec3, length, smoothstep } from 'three/tsl';
import { castroHouseGeometry } from '../world/castroHouse.js';
import { createBuildingMaterials } from '../world/materials.js';
import { surfaceTextures } from '../world/surfaceBake.js';
import { loadSurfaces } from '../world/surfaces.js';

const params = new URLSearchParams( location.search );
const detail = Number( params.get( 'detail' ) ?? 2 );
const flat = params.has( 'flat' );
const real = params.has( 'mat' ); // the project materials (world/materials.js on the baked surfaces)
const unlit = params.has( 'unlit' ); // one unlit grey: the map-stripped evidence the skill asks for the blockout

// reference viewpoints in the house frame (front/door = +Z, tower = +X): azimuth from +Z toward +X,
// elevation above the horizon, the image size of each reference and the box of its silhouette in
// pixels (from ref/casa_castro/matte; ref_2 measured by eye, its matte has a streak on the left)
export const VIEWS = [
	{ ref: 1, az: 6, el: 6, w: 933, h: 532, box: [ 33, 41, 897, 480 ] },      // front, porch and door
	{ ref: 2, az: - 55, el: 15, w: 1071, h: 582, box: [ 38, 57, 1019, 542 ] }, // west gable with the gateway
	{ ref: 3, az: 140, el: 5, w: 1015, h: 512, box: [ 65, 79, 976, 477 ] },   // east-north-east: the tower
	{ ref: 4, az: 185, el: 9, w: 891, h: 558, box: [ 80, 79, 826, 493 ] },    // back
	{ ref: 5, az: 0, el: 89.5, w: 864, h: 592, box: [ 83, 32, 761, 554 ] }    // plan
];

// flat studio colours (sRGB) per material key
const COLORS = {
	stone: 0x8a8c8e, stoneDark: 0x6e6f70, thatch: 0x6b5f3e, thatchGreen: 0x5f5a3a,
	wood: 0x6a4434, woodPost: 0x5a3a2c, doorway: 0x141210, ember: 0xff7a2a,
	daub: 0x9a7a5a, wattle: 0x6e5a40, canvas: 0xb8ab8c, cloth: 0x8a2a22,
	castroStone: 0x8a8c8e, castroThatch: 0x6b5f3e
};

const renderer = new THREE.WebGPURenderer( { antialias: true, preserveDrawingBuffer: true } );
renderer.setPixelRatio( 1 );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild( renderer.domElement );
await renderer.init();

const scene = new THREE.Scene();
// radial grey backdrop like the references
const d = length( screenUV.sub( 0.5 ).mul( vec3( 1.0, 1.25, 0 ).xy ) );
// ?plain: one flat colour (the Tier 1 diagnostics of the skill read the gradient as foreground)
if ( params.has( 'plain' ) ) scene.background = new THREE.Color( 0x303030 ) // neutral: a bluish grey passes the saturation test of the mask;
else scene.backgroundNode = mix( vec3( 0.105, 0.11, 0.12 ), vec3( 0.026, 0.028, 0.032 ), smoothstep( 0.1, 0.75, d ) );

scene.add( new THREE.HemisphereLight( 0xdfe6ef, 0x4a4844, 1.3 ) );
const sun = new THREE.DirectionalLight( 0xfff4e6, 2.2 );
sun.position.set( - 6, 14, 10 );
scene.add( sun );
const fill = new THREE.DirectionalLight( 0xcfd8e6, 0.6 );
fill.position.set( 10, 6, - 8 );
scene.add( fill );

const house = new THREE.Group();
const grey = new THREE.MeshStandardNodeMaterial( { color: 0x8a8a8a, roughness: 0.9, side: THREE.DoubleSide } );
const mats = real ? createBuildingMaterials( surfaceTextures( await loadSurfaces() ) ) : null;
for ( const [ key, geo ] of castroHouseGeometry( { detail } ).build() ) {
	const mat = real ? mats[ key ] : unlit ? new THREE.MeshBasicNodeMaterial( { color: 0x9a9a9a, side: THREE.DoubleSide } ) : flat ? grey : new THREE.MeshStandardNodeMaterial( {
		color: COLORS[ key ] ?? 0xff00ff, roughness: 0.9, side: THREE.DoubleSide,
		emissive: key === 'ember' ? 0xff5010 : 0x000000, emissiveIntensity: 2
	} );
	const m = new THREE.Mesh( geo, mat );
	m.name = key;
	house.add( m );
}
scene.add( house );

const box = new THREE.Box3().setFromObject( house );
const center = box.getCenter( new THREE.Vector3() );
// framing samples: a subset of the real vertices (the box corners left a loose margin)
const corners = [];
for ( const m of house.children ) {
	const p = m.geometry.attributes.position;
	const step = Math.max( 1, Math.floor( p.count / 400 ) );
	for ( let i = 0; i < p.count; i += step ) corners.push( new THREE.Vector3().fromBufferAttribute( p, i ) );
}

const camera = new THREE.PerspectiveCamera( 20, 1, 0.1, 500 );

// pixel box of the projected house
function projectedBox( v ) {
	const b = [ Infinity, Infinity, - Infinity, - Infinity ];
	for ( const c of corners ) {
		const p = c.clone().project( camera );
		const x = ( p.x + 1 ) / 2 * v.w, y = ( 1 - p.y ) / 2 * v.h;
		b[ 0 ] = Math.min( b[ 0 ], x ); b[ 1 ] = Math.min( b[ 1 ], y );
		b[ 2 ] = Math.max( b[ 2 ], x ); b[ 3 ] = Math.max( b[ 3 ], y );
	}
	return b;
}

// place the camera on the view direction, pull it back until the silhouette fits the box of the
// reference silhouette (the larger side matches; the other side is left free, so the aspect stays a
// measure), then shift the frustum so the two boxes share their centre
function frame( v ) {
	renderer.setSize( v.w, v.h );
	camera.aspect = v.w / v.h;
	camera.clearViewOffset();
	const az = THREE.MathUtils.degToRad( v.az ), el = THREE.MathUtils.degToRad( v.el );
	const dir = new THREE.Vector3( Math.sin( az ) * Math.cos( el ), Math.sin( el ), Math.cos( az ) * Math.cos( el ) );
	camera.up.set( 0, 1, 0 );
	if ( v.el > 80 ) camera.up.set( 0, 0, - 1 ); // plan: +Z (front) at the bottom
	const t = v.box;
	let lo = 2, hi = 300, b;
	for ( let k = 0; k < 40; k ++ ) {
		const dist = ( lo + hi ) / 2;
		camera.position.copy( center ).addScaledVector( dir, dist );
		camera.lookAt( center );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();
		b = projectedBox( v );
		const ratio = Math.max( ( b[ 2 ] - b[ 0 ] ) / ( t[ 2 ] - t[ 0 ] ), ( b[ 3 ] - b[ 1 ] ) / ( t[ 3 ] - t[ 1 ] ) );
		if ( ratio > 1 ) lo = dist; else hi = dist;
	}
	const dx = ( b[ 0 ] + b[ 2 ] - t[ 0 ] - t[ 2 ] ) / 2, dy = ( b[ 1 ] + b[ 3 ] - t[ 1 ] - t[ 3 ] ) / 2;
	camera.setViewOffset( v.w, v.h, dx, dy, v.w, v.h );
}

async function shoot( name ) {
	for ( const v of VIEWS ) {
		frame( v );
		renderer.render( scene, camera );
		await new Promise( ( r ) => requestAnimationFrame( r ) );
		renderer.render( scene, camera );
		const blob = await new Promise( ( r ) => renderer.domElement.toBlob( r, 'image/png' ) );
		await fetch( `/__capture?name=${ name }_ref${ v.ref }`, { method: 'POST', body: blob } );
	}
	return 'ok';
}

let current = 0;
frame( VIEWS[ 0 ] );
renderer.setAnimationLoop( () => renderer.render( scene, camera ) );
addEventListener( 'keydown', ( e ) => {
	const k = Number( e.key );
	if ( k >= 1 && k <= VIEWS.length ) { current = k - 1; frame( VIEWS[ current ] ); }
} );
document.getElementById( 'hud' ).textContent = `detail ${ detail }${ flat ? ' · flat' : '' } · teclas 1–5: vistas das referências`;

window.__review = { ready: true, shoot, VIEWS, scene, camera, renderer };
