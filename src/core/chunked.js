import * as THREE from 'three/webgpu';

// Spatially chunked instancing with two LOD levels.
//  - every tile owns a hi and a lo InstancedMesh sharing the same instance data,
//    so frustum culling works per tile (main, shadow and reflection cameras);
//  - geometry buffers are shared by all tiles (no per-tile copies);
//  - every batch has the same fixed capacity, so the instance-matrix uniform
//    array has one size and all tiles of a species share ONE shader/pipeline.
// Above 1024 matrices (64 KB) three.js feeds instance matrices through an
// instanced vertex attribute instead of a per-object uniform array. The
// uniform path bakes a uniquely named buffer into every object's vertex
// shader (one pipeline per tile!); the attribute path shares ONE shader and
// pipeline across all tiles of a species.
const CAPACITY = 2048;

export class ChunkedInstances extends THREE.Group {

	constructor( { name, hi, lo = null, material, materialLo = null, tile = 220, lodDistance = 320, castShadow = true, receiveShadow = true, shadowDistance = 260, layer = 0, maxDistance = Infinity, reflect = true } ) {
		super();
		this.name = name;
		this.layerId = layer;
		this.maxDistance = maxDistance;
		this.hiGeo = hi; this.loGeo = lo;
		this.material = material; this.materialLo = materialLo || material;
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
		for ( const all of bins.values() ) {
			for ( let s = 0; s < all.length; s += CAPACITY ) this._batch( all.slice( s, s + CAPACITY ) );
		}
		this.items = null;
		return this;
	}

	_batch( list ) {
		const n = list.length;
		const p = new THREE.Vector3();
		const matAttr = new THREE.InstancedBufferAttribute( new Float32Array( CAPACITY * 16 ), 16 );
		const extras = this.extraAttrs.map( ( a ) => new THREE.InstancedBufferAttribute( new Float32Array( CAPACITY * a.itemSize ), a.itemSize ) );
		const box = new THREE.Box3();
		list.forEach( ( it, i ) => {
			it.m.toArray( matAttr.array, i * 16 );
			p.setFromMatrixPosition( it.m );
			box.expandByPoint( p );
			extras.forEach( ( ea, k ) => {
				const v = it.e[ k ] ?? 0;
				for ( let c = 0; c < ea.itemSize; c ++ ) ea.array[ i * ea.itemSize + c ] = Array.isArray( v ) ? v[ c ] : v;
			} );
		} );
		const center = box.getCenter( new THREE.Vector3() );
		const make = ( src, mat ) => {
			const geo = new THREE.BufferGeometry();
			for ( const k in src.attributes ) geo.setAttribute( k, src.attributes[ k ] );
			if ( src.index ) geo.setIndex( src.index );
			this.extraAttrs.forEach( ( a, k ) => geo.setAttribute( a.name, extras[ k ] ) );
			geo.boundingSphere = src.boundingSphere;
			const mesh = new THREE.InstancedMesh( geo, mat, CAPACITY );
			mesh.instanceMatrix = matAttr;
			mesh.count = n;
			mesh.castShadow = this.cast;
			mesh.receiveShadow = this.receive;
			mesh.computeBoundingSphere();
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

	get count() { return this.tiles.reduce( ( s, t ) => s + t.hi.count, 0 ); }
}
