// Lotus on a lake: floating leaves with their notch and veins, and pink-tipped flowers in three rings
// of petals. Port of the lotus of AndyLe Pool (https://github.com/AndyLeAI/Andy_KOI_Pool, commit
// dc3b205, Copyright AndyLeAI, Apache License 2.0: see LICENSE-AndyLePool in this folder). Changes:
// node materials, real sizes (leaves 0.25-0.5 m in radius), placed on the open water of a free-form
// lake (lakes.js) by its depth and distance to the shore, and every leaf and petal merged into two
// meshes (the original made one mesh per petal).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const srgb = ( r, g, b ) => new THREE.Color().setRGB( r, g, b, THREE.SRGBColorSpace );
const smooth = ( a, b, x ) => { const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); };

function leafTexture() {
	const c = document.createElement( 'canvas' ); c.width = c.height = 256;
	const g = c.getContext( '2d' );
	const grad = g.createRadialGradient( 128, 128, 8, 128, 128, 128 );
	grad.addColorStop( 0, '#8fb152' ); grad.addColorStop( 0.6, '#5f8c34' ); grad.addColorStop( 1, '#3f6a24' );
	g.fillStyle = grad; g.fillRect( 0, 0, 256, 256 );
	g.strokeStyle = 'rgba(210,230,160,0.35)'; g.lineWidth = 2;
	for ( let i = 0; i < 22; i ++ ) {
		const a = ( i / 22 ) * TAU;
		g.beginPath(); g.moveTo( 128, 128 );
		g.quadraticCurveTo( 128 + Math.cos( a + 0.08 ) * 70, 128 + Math.sin( a + 0.08 ) * 70, 128 + Math.cos( a ) * 126, 128 + Math.sin( a ) * 126 );
		g.stroke();
	}
	g.fillStyle = 'rgba(230,240,180,0.6)'; g.beginPath(); g.arc( 128, 128, 6, 0, TAU ); g.fill();
	const t = new THREE.CanvasTexture( c ); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
	return t;
}

// one petal: a flattened sphere stretched along +z, white at the base and pink at the tip
function petalGeometry() {
	const g = new THREE.SphereGeometry( 1, 14, 10 );
	g.translate( 0, 0, 1 ); g.scale( 0.085, 0.035, 0.13 );
	const p = g.attributes.position, col = new Float32Array( p.count * 3 );
	const base = srgb( 1, 0.97, 0.94 ), tip = srgb( 0.93, 0.44, 0.62 ), c = new THREE.Color();
	for ( let i = 0; i < p.count; i ++ ) { c.copy( base ).lerp( tip, smooth( 0.08, 0.26, p.getZ( i ) ) ); col.set( [ c.r, c.g, c.b ], i * 3 ); }
	g.setAttribute( 'color', new THREE.BufferAttribute( col, 3 ) );
	g.deleteAttribute( 'uv' );
	g.computeVertexNormals();
	return g;
}

// the flower (10 + 8 + 6 petals and the yellow seed head), at the original's size x k, origin on the water
function flowerGeometry( k ) {
	const petal = petalGeometry(), parts = [];
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler( 0, 0, 0, 'YXZ' );
	[ [ 10, 0.95, 1.0 ], [ 8, 0.62, 0.8 ], [ 6, 0.3, 0.6 ] ].forEach( ( [ count, tilt, scl ], ri ) => {
		for ( let j = 0; j < count; j ++ ) {
			e.set( - tilt, ( j / count ) * TAU + ri * 0.3, 0 );
			m.compose( new THREE.Vector3(), q.setFromEuler( e ), new THREE.Vector3().setScalar( scl * 1.6 * k ) );
			parts.push( petal.clone().applyMatrix4( m ) );
		}
	} );
	const core = new THREE.CylinderGeometry( 0.07 * k, 0.09 * k, 0.08 * k, 12 ).translate( 0, 0.05 * k, 0 ).toNonIndexed();
	core.deleteAttribute( 'uv' );
	const cc = srgb( 0.95, 0.79, 0.3 ), col = new Float32Array( core.attributes.position.count * 3 );
	for ( let i = 0; i < col.length; i += 3 ) col.set( [ cc.r, cc.g, cc.b ], i );
	core.setAttribute( 'color', new THREE.BufferAttribute( col, 3 ) );
	return mergeGeometries( [ ...parts.map( ( g ) => g.toNonIndexed() ), core ] );
}

// lake: lakes.js; rnd: the lake's generator. Returns a group with the leaves and the flowers.
export function buildLotus( lake, hf, water, rnd ) {
	const rand = ( a, b ) => a + ( b - a ) * rnd();
	// about one leaf per 14 m² of open water, at most 60
	const want = Math.min( 60, Math.round( lake.area / 14 ) );
	const spots = [];
	const [ x0, z0, x1, z1 ] = lake.box;
	for ( let tries = 0; spots.length < want && tries < want * 40; tries ++ ) {
		const x = rand( x0, x1 ), z = rand( z0, z1 ), s = rand( 0.25, 0.5 );
		const depth = water - hf.heightAt( x, z );
		// rooted plants: shallow to middling water, clear of the bank, in loose clumps
		if ( depth < 0.3 || depth > 3 || lake.shore( x, z ) < s + 0.6 ) continue;
		if ( spots.some( ( o ) => Math.hypot( o.x - x, o.z - z ) < ( o.s + s ) * 1.02 ) ) continue;
		if ( spots.length && rnd() < 0.6 && ! spots.some( ( o ) => Math.hypot( o.x - x, o.z - z ) < 3 ) ) continue;
		spots.push( { x, z, s } );
	}
	if ( ! spots.length ) return null;
	const leaves = [], flowers = [];
	const flower = flowerGeometry( 0.55 );
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3( 0, 1, 0 );
	spots.forEach( ( sp, i ) => {
		const notch = rand( 0.25, 0.45 );
		const g = new THREE.CircleGeometry( 1, 40, notch / 2, TAU - notch );
		g.rotateX( - Math.PI / 2 );
		const p = g.attributes.position;
		// the leaf's edge turns up a little
		for ( let k = 0; k < p.count; k ++ ) { const r = Math.hypot( p.getX( k ), p.getZ( k ) ); p.setY( k, ( 0.07 * r * r * r - 0.02 * r ) * 0.5 ); }
		g.computeVertexNormals();
		const yaw = rand( 0, TAU );
		q.setFromAxisAngle( up, yaw );
		m.compose( new THREE.Vector3( sp.x, water + 0.02, sp.z ), q, new THREE.Vector3().setScalar( sp.s ) );
		leaves.push( g.applyMatrix4( m ) );
		// a flower on one leaf in three, standing a little off its centre
		if ( i % 3 === 1 ) {
			const off = new THREE.Vector3( sp.s * 0.2, 0, - sp.s * 0.15 ).applyQuaternion( q );
			m.compose( new THREE.Vector3( sp.x + off.x, water + 0.04, sp.z + off.z ), q.setFromAxisAngle( up, rand( 0, TAU ) ), new THREE.Vector3( 1, 1, 1 ) );
			flowers.push( flower.clone().applyMatrix4( m ) );
		}
	} );
	const group = new THREE.Group();
	group.name = 'lotus';
	const leafMat = new THREE.MeshStandardNodeMaterial( { map: leafTexture(), roughness: 0.5, side: THREE.DoubleSide } );
	const leafMesh = new THREE.Mesh( mergeGeometries( leaves ), leafMat );
	leafMesh.name = 'lotus_leaves';
	leafMesh.receiveShadow = true; leafMesh.castShadow = true;
	group.add( leafMesh );
	if ( flowers.length ) {
		const fm = new THREE.Mesh( mergeGeometries( flowers ), new THREE.MeshStandardNodeMaterial( { vertexColors: true, roughness: 0.45 } ) );
		fm.name = 'lotus_flowers';
		fm.castShadow = true; fm.receiveShadow = true;
		group.add( fm );
	}
	group.userData.count = { leaves: spots.length, flowers: flowers.length };
	return group;
}
