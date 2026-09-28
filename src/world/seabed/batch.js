// Adapted from Tidewater (https://github.com/dgreenheck/tidewater, src/world/reef/ReefBatch.js,
// three.js version at d32799f). MIT License, Copyright (c) 2026 DRG Software Solutions LLC.
// Changes: no level-of-detail cross-fade channel (it relies on TAA, we use MSAA); the owner may
// rewrite ranges of the instance buffer (tiles streamed around the camera).
import * as THREE from 'three/webgpu';
import { attribute, storage, uniformArray, instanceIndex, uint } from 'three/tsl';

// Many different instanced models in a single render object.
//
// All models ("kinds": an organism type at one level of detail) share one vertex / index
// buffer. Every frame the owner decides which instances are drawn with which kind
// (culling + LOD) and calls commit(): the instance ids of each kind are packed into one
// list and one indirect draw command per non-empty kind is written (firstIndex /
// baseVertex select the model, instanceCount the number of instances). The vertex
// shader finds its instance as list[ base[ kind ] + instance_index ], with the kind
// stored per vertex, so no per-instance vertex buffers are needed (the draw uses four
// vertex buffers) and the draws don't rely on the 'indirect-first-instance' feature.
// Per-instance data lives in a storage buffer (4 vec4 per instance, owner defined).
// Nothing is allocated per frame.
//
// The shadow pass draws only the kinds flagged `shadow`: the indirect offsets are swapped in
// onBeforeRender when the camera is a shadow camera.
export class SeabedBatch {

	constructor( name, kinds, { maxInstances, dynamic = false } ) {

		this.name = name;
		this.kinds = kinds;
		const K = kinds.length;
		this.maxInstances = maxInstances;

		// ---- merged geometry
		let nv = 0, ni = 0;
		for ( const k of kinds ) {

			nv += k.geometry.attributes.position.count;
			ni += k.geometry.index.count;

		}

		const pos = new Float32Array( nv * 3 ), nrm = new Float32Array( nv * 3 ), dat = new Float32Array( nv * 4 ), kid = new Float32Array( nv );
		const idx = new Uint32Array( ni );
		this.firstIndex = new Uint32Array( K );
		this.indexCount = new Uint32Array( K );
		this.baseVertex = new Uint32Array( K );
		let v0 = 0, i0 = 0;
		kinds.forEach( ( k, i ) => {

			const g = k.geometry;
			const n = g.attributes.position.count;
			pos.set( g.attributes.position.array, v0 * 3 );
			nrm.set( g.attributes.normal.array, v0 * 3 );
			if ( g.attributes.aData ) dat.set( g.attributes.aData.array, v0 * 4 );
			kid.fill( i, v0, v0 + n );
			idx.set( g.index.array, i0 );
			this.firstIndex[ i ] = i0;
			this.indexCount[ i ] = g.index.count;
			this.baseVertex[ i ] = v0;
			k.triangles = g.index.count / 3;
			k.vertices = n;
			v0 += n;
			i0 += g.index.count;

		} );

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
		geometry.setAttribute( 'normal', new THREE.BufferAttribute( nrm, 3 ) );
		geometry.setAttribute( 'aData', new THREE.BufferAttribute( dat, 4 ) );
		geometry.setAttribute( 'aKind', new THREE.BufferAttribute( kid, 1 ) );
		geometry.setIndex( new THREE.BufferAttribute( idx, 1 ) );
		this.vertexCount = nv;

		// ---- per-instance data (owner writes this.data, then calls upload() / uploadRange())
		this.data = new Float32Array( maxInstances * 16 );
		this.dataAttr = new THREE.StorageBufferAttribute( this.data, 4 );
		if ( dynamic ) this.dataAttr.setUsage( THREE.DynamicDrawUsage );
		this.instances = storage( this.dataAttr, 'vec4', maxInstances * 4 ).toReadOnly();

		// ---- visible instance ids, per-kind bases and the indirect commands (an instance can be
		// listed twice: drawn, and as a shadow proxy)
		const cap = maxInstances * 2;
		this.list = new Uint32Array( cap );
		this.listAttr = new THREE.StorageBufferAttribute( this.list, 1 );
		this.listNode = storage( this.listAttr, 'uint', cap ).toReadOnly();
		this.base = uniformArray( new Array( K ).fill( 0 ), 'uint' );
		this.commands = new Uint32Array( K * 5 );
		this.indirect = new THREE.IndirectStorageBufferAttribute( this.commands, 5 );
		this.offsetPool = [ [], [] ]; // arrays of indirect offsets by length (no per-frame allocation)
		this.mainOffsets = [];
		this.shadowOffsets = [];
		geometry.setIndirect( this.indirect, this.mainOffsets );
		this.geometry = geometry;

		// per-frame ( kind, id ) pairs, sorted by kind in commit()
		this.pairKind = new Uint16Array( cap );
		this.pairId = new Uint32Array( cap );
		this.pairs = 0;
		this.counts = new Uint32Array( K );
		this.cursor = new Uint32Array( K );
		this.visibleInstances = 0;
		this.visibleTriangles = 0;
		this.shadowTriangles = 0;
		this._dataDirty = false;

		this.mesh = null;

	}

	// TSL: instance record index for the current vertex, and its 4 data vec4s
	recordIndex() {

		const kind = uint( attribute( 'aKind', 'float' ) );
		return this.listNode.element( this.base.element( kind ).add( instanceIndex ) );

	}

	record( index ) {

		const i = index.mul( 4 );
		const d = this.instances;
		return [ d.element( i ), d.element( i.add( 1 ) ), d.element( i.add( 2 ) ), d.element( i.add( 3 ) ) ];

	}

	createMesh( material, { castShadow = false, receiveShadow = true } = {} ) {

		const mesh = new THREE.Mesh( this.geometry, material );
		mesh.name = this.name;
		mesh.frustumCulled = false;
		mesh.castShadow = castShadow;
		mesh.receiveShadow = receiveShadow;
		mesh.matrixAutoUpdate = false;
		const geometry = this.geometry;
		mesh.onBeforeRender = ( renderer, scene, camera ) => {

			geometry.indirectOffset = camera.isOrthographicCamera ? this.shadowOffsets : this.mainOffsets;

		};

		this.mesh = mesh;
		return mesh;

	}

	upload() {

		this.dataAttr.clearUpdateRanges();
		this.dataAttr.needsUpdate = true;

	}

	// upload only instances [ first, first + count ) (records written since the last frame)
	uploadRange( first, count ) {

		if ( ! this._dataDirty ) {

			this.dataAttr.clearUpdateRanges();
			this._dataDirty = true;

		}

		this.dataAttr.addUpdateRange( first * 16, count * 16 );
		this.dataAttr.needsUpdate = true;

	}

	// ---- per frame: begin(), add( kind, id ) for every drawn instance, commit()

	begin() {

		this.pairs = 0;
		this.counts.fill( 0 );

	}

	add( kind, id ) {

		const n = this.pairs ++;
		this.pairKind[ n ] = kind;
		this.pairId[ n ] = id;
		this.counts[ kind ] ++;

	}

	offsets( which, n ) {

		const pool = this.offsetPool[ which ];
		return pool[ n ] || ( pool[ n ] = new Array( n ).fill( 0 ) );

	}

	commit() {

		this._dataDirty = false;
		const K = this.kinds.length;
		const cmd = this.commands, base = this.base.array, counts = this.counts, cursor = this.cursor;
		let n = 0, nMain = 0, nShadow = 0, tris = 0, shadowTris = 0;
		for ( let k = 0; k < K; k ++ ) {

			const c = counts[ k ];
			base[ k ] = n;
			cursor[ k ] = n;
			const o = k * 5;
			cmd[ o ] = this.indexCount[ k ];
			cmd[ o + 1 ] = c;
			cmd[ o + 2 ] = this.firstIndex[ k ];
			cmd[ o + 3 ] = this.baseVertex[ k ];
			cmd[ o + 4 ] = 0;
			if ( c > 0 ) {

				if ( this.kinds[ k ].shadow ) nShadow ++;
				if ( ! this.kinds[ k ].shadowOnly ) nMain ++;

			}

			n += c;

		}

		// counting sort of the pairs into the per-kind ranges of the list
		const list = this.list, pk = this.pairKind, pid = this.pairId;
		for ( let i = 0; i < this.pairs; i ++ ) list[ cursor[ pk[ i ] ] ++ ] = pid[ i ];
		const main = this.offsets( 0, nMain ), shadow = this.offsets( 1, nShadow );
		let im = 0, is = 0;
		for ( let k = 0; k < K; k ++ ) {

			const c = counts[ k ];
			if ( c === 0 ) continue;
			const kind = this.kinds[ k ];
			if ( ! kind.shadowOnly ) {

				main[ im ++ ] = k * 20;
				tris += c * kind.triangles;

			}

			if ( kind.shadow ) {

				shadow[ is ++ ] = k * 20;
				shadowTris += c * kind.triangles;

			}

		}

		this.mainOffsets = main;
		this.shadowOffsets = shadow;
		this.visibleInstances = n;
		this.visibleTriangles = tris;
		this.shadowTriangles = shadowTris;
		this.listAttr.clearUpdateRanges();
		this.listAttr.addUpdateRange( 0, Math.max( n, 1 ) );
		this.listAttr.needsUpdate = true;
		this.indirect.needsUpdate = true;

	}

	dispose() {

		this.geometry.dispose();
		if ( this.mesh ) this.mesh.removeFromParent();

	}

}
