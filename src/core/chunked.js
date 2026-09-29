import * as THREE from 'three/webgpu';
import { Fn, attribute, mat4, vec4, positionLocal, normalLocal, transformNormal } from 'three/tsl';

// Spatially chunked instancing with two LOD levels.
//  - every tile owns a hi and a lo mesh sharing the same instance data,
//    so frustum culling works per tile (main, shadow and reflection cameras);
//  - geometry buffers are shared by all tiles (no per-tile copies);
//  - tiles are plain Meshes with an InstancedBufferGeometry, NOT InstancedMeshes.
//    three.js keys the shader of an InstancedMesh by the object's uuid (its
//    instance buffer is bound into the node graph), so every tile paid its own
//    TSL build (~12 ms each, ~830 builds: most of the load time, and a hitch
//    whenever a tile changed LOD or came into view). Here the instance matrix
//    is a named geometry attribute (iM0..iM3, one interleaved buffer = one
//    vertex buffer slot) applied in the material's positionNode, so all tiles
//    of a material share ONE build, shader and pipeline.

const patched = new WeakSet();

// Applies the per-instance matrix before the material's own positionNode (the
// same order as three.js instancing). The shadow pass copies positionNode, so
// shadows follow too.
function useGeometryInstancing( material ) {
	if ( patched.has( material ) ) return;
	patched.add( material );
	const inner = material.positionNode;
	material.positionNode = Fn( () => {
		const m = mat4( attribute( 'iM0', 'vec4' ), attribute( 'iM1', 'vec4' ), attribute( 'iM2', 'vec4' ), attribute( 'iM3', 'vec4' ) );
		positionLocal.assign( m.mul( vec4( positionLocal, 1 ) ).xyz );
		normalLocal.assign( transformNormal( normalLocal, m ) );
		return inner ?? positionLocal;
	} )();
}

const _m = new THREE.Matrix4(), _hits = [], _sphere = new THREE.Sphere();
const _probe = new THREE.Mesh();

// Per-instance raycast (like InstancedMesh.raycast), for the focus picking.
function raycastInstances( raycaster, intersects ) {
	const { src, matrices, count } = this.userData.instances;
	_sphere.copy( this.geometry.boundingSphere );
	if ( ! raycaster.ray.intersectsSphere( _sphere ) ) return;
	_probe.geometry = src;
	_probe.material = this.material;
	for ( let i = 0; i < count; i ++ ) {
		_probe.matrixWorld.fromArray( matrices, i * 16 );
		_hits.length = 0;
		_probe.raycast( raycaster, _hits );
		for ( const h of _hits ) { h.instanceId = i; h.object = this; intersects.push( h ); }
	}
}

export class ChunkedInstances extends THREE.Group {

	constructor( { name, hi, lo = null, material, materialLo = null, tile = 220, lodDistance = 320, castShadow = true, receiveShadow = true, shadowDistance = 260, layer = 0, maxDistance = Infinity, reflect = true } ) {
		super();
		this.name = name;
		this.layerId = layer;
		this.maxDistance = maxDistance;
		this.hiGeo = hi; this.loGeo = lo;
		this.material = material; this.materialLo = materialLo || material;
		useGeometryInstancing( this.material );
		useGeometryInstancing( this.materialLo );
		this.tileSize = tile;
		this.lodDistance = lodDistance;
		this.shadowDistance = shadowDistance;
		this.cast = castShadow; this.receive = receiveShadow;
		this.reflect = reflect;
		this.items = [];
		this.tiles = [];
		this.extraAttrs = [];
	}

	addAttribute( name, itemSize ) { this.extraAttrs.push( { name, itemSize } ); }

	add_( matrix, extra = [] ) { this.items.push( { m: matrix.clone(), e: extra } ); }

	build() {
		const bins = new Map();
		const p = new THREE.Vector3();
		for ( const it of this.items ) {
			p.setFromMatrixPosition( it.m );
			const key = Math.floor( p.x / this.tileSize ) + ',' + Math.floor( p.z / this.tileSize );
			if ( ! bins.has( key ) ) bins.set( key, [] );
			bins.get( key ).push( it );
		}
		for ( const all of bins.values() ) this._batch( all );
		this.items = null;
		return this;
	}

	_batch( list ) {
		const n = list.length;
		const p = new THREE.Vector3();
		const matrices = new Float32Array( n * 16 );
		const ib = new THREE.InstancedInterleavedBuffer( matrices, 16 );
		const extras = this.extraAttrs.map( ( a ) => new THREE.InstancedBufferAttribute( new Float32Array( n * a.itemSize ), a.itemSize ) );
		const box = new THREE.Box3();
		list.forEach( ( it, i ) => {
			it.m.toArray( matrices, i * 16 );
			p.setFromMatrixPosition( it.m );
			box.expandByPoint( p );
			extras.forEach( ( ea, k ) => {
				const v = it.e[ k ] ?? 0;
				for ( let c = 0; c < ea.itemSize; c ++ ) ea.array[ i * ea.itemSize + c ] = Array.isArray( v ) ? v[ c ] : v;
			} );
		} );
		const center = box.getCenter( new THREE.Vector3() );
		// bounds of all the instances (the source sphere moved and scaled by each matrix)
		const sphereOf = ( src ) => {
			if ( ! src.boundingSphere ) src.computeBoundingSphere();
			const s = src.boundingSphere, c = new THREE.Vector3();
			let r = 0;
			for ( const it of list ) {
				c.copy( s.center ).applyMatrix4( it.m );
				r = Math.max( r, c.distanceTo( center ) + s.radius * it.m.getMaxScaleOnAxis() );
			}
			return new THREE.Sphere( center.clone(), r );
		};
		const make = ( src, mat ) => {
			const geo = new THREE.InstancedBufferGeometry();
			for ( const k in src.attributes ) geo.setAttribute( k, src.attributes[ k ] );
			if ( src.index ) geo.setIndex( src.index );
			for ( let c = 0; c < 4; c ++ ) geo.setAttribute( 'iM' + c, new THREE.InterleavedBufferAttribute( ib, 4, c * 4 ) );
			this.extraAttrs.forEach( ( a, k ) => geo.setAttribute( a.name, extras[ k ] ) );
			geo.instanceCount = n;
			geo.boundingSphere = sphereOf( src );
			const mesh = new THREE.Mesh( geo, mat );
			mesh.userData.instances = { src, matrices, count: n };
			mesh.raycast = raycastInstances;
			mesh.castShadow = this.cast;
			mesh.receiveShadow = this.receive;
			if ( this.layerId ) mesh.layers.set( this.layerId );
			if ( this.reflect ) mesh.layers.enable( 2 );
			return mesh;
		};
		const hi = make( this.hiGeo, this.material );
		const lo = this.loGeo ? make( this.loGeo, this.materialLo ) : null;
		// the low-res water reflection only needs the cheap LOD
		if ( lo ) hi.layers.disable( 2 );
		if ( lo ) { lo.castShadow = false; lo.visible = false; }
		this.add( hi ); if ( lo ) this.add( lo );
		this.tiles.push( { hi, lo, center, radius: box.getSize( p ).length() * 0.5 } );
	}

	update( camera ) {
		const cp = camera.position;
		for ( const t of this.tiles ) {
			const dc = cp.distanceTo( t.center );
			const d = Math.max( 0, dc - t.radius );
			const near = dc < this.lodDistance;
			const alive = d < this.maxDistance;
			if ( t.lo ) { t.hi.visible = near && alive; t.lo.visible = ! near && alive; } else t.hi.visible = alive;
			t.hi.castShadow = this.cast && dc < this.shadowDistance;
		}
	}

	get count() { return this.tiles.reduce( ( s, t ) => s + t.hi.geometry.instanceCount, 0 ); }
}
