// Cheap stand-ins for the water reflection and the shadow pass. The procedural surfaces of the
// houses, the fort and the mine (world/materials.js) compile into big shaders, and every one was
// compiled three times: scene, reflection and shadow (the shadow pass keeps the whole colour graph
// to read its alpha). Each such mesh keeps only the scene pass; a child with the same geometry and
// a flat-coloured material (the colour in a uniform: one shader for all of them) takes its place in
// the reflection (layer 2 -> PROXY_LAYER) and casts its shadow. See tools/shadercost.mjs.
import * as THREE from 'three/webgpu';
import { uniform, float } from 'three/tsl';

// seen only by the reflection camera and the sun's shadow camera (main.js)
export const PROXY_LAYER = 3;

const materials = new Map();
function proxyMaterial( src ) {
	const key = src.side + ':' + src.userData.proxyColor.getHexString();
	let m = materials.get( key );
	if ( ! m ) {
		m = new THREE.MeshStandardNodeMaterial( { side: src.side } );
		m.name = 'proxy';
		m.colorNode = uniform( src.userData.proxyColor.clone() );
		m.roughnessNode = float( 0.92 );
		materials.set( key, m );
	}
	return m;
}

// every mesh under root whose material has userData.proxyColor
export function addProxies( root ) {
	const meshes = [];
	root.traverse( ( o ) => { if ( o.isMesh && ! Array.isArray( o.material ) && o.material.userData.proxyColor ) meshes.push( o ); } );
	for ( const mesh of meshes ) {
		const p = new THREE.Mesh( mesh.geometry, proxyMaterial( mesh.material ) );
		p.name = mesh.name + '~proxy';
		p.userData.proxy = true;
		p.layers.set( PROXY_LAYER );
		p.castShadow = mesh.castShadow;
		p.receiveShadow = mesh.receiveShadow;
		p.frustumCulled = mesh.frustumCulled;
		mesh.castShadow = false;
		mesh.layers.disable( 2 );
		mesh.add( p );
	}
	return meshes.length;
}
