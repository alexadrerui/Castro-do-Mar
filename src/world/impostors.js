// Octahedral impostors for the far trees. Ported from Tidewater
// (https://github.com/dgreenheck/tidewater, src/world/vegetation/Impostors.js, three.js version at
// d32799f). MIT License, Copyright (c) 2026 DRG Software Solutions LLC.
// Changes: one plant per atlas and this project's foliage layout (the bake reads color / aux /
// the leaf-cluster atlas); no wind sway, forest thinning or dithered cross-fade (the tiles of
// core/chunked.js switch whole tiles hi -> lo -> impostor); the dominant frame only (the
// impostors start far away); colours from the per-instance tint like the near canopy.
import * as THREE from 'three/webgpu';
import { bakeTarget, textureFromData, readTarget } from '../core/bakeCache.js';
import {
	Fn, float, uniform, vec2, vec3, vec4, attribute, texture, uv, positionGeometry, normalGeometry, positionWorld, cameraPosition, property,
	normalize, cross, dot, abs, max, mix, floor, clamp, select, sin, cos, cameraViewMatrix, positionViewDirection, mx_noise_float, varying
} from 'three/tsl';
import { cloudShade } from './cloudShadow.js';

// At startup the plant is rendered from N x N directions on the upper hemisphere (hemi-octahedral
// layout) into two atlases:
//   A: leaf brightness, leaf (1) / bark (0) flag, per-leaf random, coverage
//   B: plant-local normal * 0.5 + 0.5, exposure (crown occlusion)
// At runtime each plant is one camera-facing quad; the fragment shader picks the frame nearest to
// the view direction and re-projects the view ray onto that frame's plane (exact for any view
// direction, non-uniform instance scale included).

export const OCT_N = 6; // frames per side
const FRAME_PX = 128;
const UP = vec3( 0, 1, 0 );

// hemi-octahedral decode: (u, v) in [-1, 1]^2 -> unit direction with y >= 0
function octDecode( u, v, out = new THREE.Vector3() ) {
	const x = ( u - v ) * 0.5, z = ( u + v ) * 0.5;
	return out.set( x, 1 - Math.abs( x ) - Math.abs( z ), z ).normalize();
}

function frameBasis( d ) {
	const right = new THREE.Vector3().crossVectors( new THREE.Vector3( 0, 1, 0 ), d );
	if ( right.lengthSq() < 1e-8 ) right.set( 1, 0, 0 );
	right.normalize();
	const up = new THREE.Vector3().crossVectors( d, right ).normalize();
	return { right, up };
}

const octDecodeT = ( u, v ) => {
	const x = u.sub( v ).mul( 0.5 ), z = u.add( v ).mul( 0.5 );
	return normalize( vec3( x, float( 1 ).sub( abs( x ) ).sub( abs( z ) ), z ) );
};

const octEncodeT = ( d ) => {
	const p = d.div( abs( d.x ).add( abs( d.y ) ).add( abs( d.z ) ) );
	return vec2( p.x.add( p.z ), p.z.sub( p.x ) );
};

export class ImpostorAtlas {

	// geometry: the near plant (foliage layout)
	constructor( geometry ) {
		this.geometry = geometry;
		// frame: a sphere around the plant axis holding every vertex
		geometry.computeBoundingBox();
		const bb = geometry.boundingBox;
		this.center = new THREE.Vector3( 0, ( bb.min.y + bb.max.y ) / 2, 0 );
		const p = geometry.attributes.position;
		let R = 0, rh = 0;
		for ( let i = 0; i < p.count; i ++ ) {
			const x = p.getX( i ), y = p.getY( i ) - this.center.y, z = p.getZ( i );
			R = Math.max( R, Math.hypot( x, y, z ) );
			rh = Math.max( rh, Math.hypot( x, z ) );
		}
		this.radius = R * 1.02;
		this.rh = rh * 1.02;
		this.hv = ( bb.max.y - bb.min.y ) / 2 * 1.02;
		this.rtA = this.rtB = null;
		this.textureA = this.textureB = null;
		this.bakeMs = 0;
	}

	// from cached texels (see read) instead of baking
	load( { a, b } ) {
		this.textureA = textureFromData( a, OCT_N * FRAME_PX, 'impostorA' );
		this.textureB = textureFromData( b, OCT_N * FRAME_PX, 'impostorB' );
		return this;
	}

	async read( renderer ) {
		return { a: await readTarget( renderer, this.rtA ), b: await readTarget( renderer, this.rtB ) };
	}

	// frame transforms: local plant -> atlas plane (cell centre), frame (i, j)
	_frameMatrices() {
		const mats = [];
		const R = this.radius, C = this.center;
		for ( let j = 0; j < OCT_N; j ++ ) for ( let i = 0; i < OCT_N; i ++ ) {
			const d = octDecode( - 1 + 2 * i / ( OCT_N - 1 ), - 1 + 2 * j / ( OCT_N - 1 ) );
			const { right, up } = frameBasis( d );
			const cx = ( i + 0.5 ) * 2 * R, cy = ( j + 0.5 ) * 2 * R;
			mats.push( new THREE.Matrix4().set(
				right.x, right.y, right.z, - C.dot( right ) + cx,
				up.x, up.y, up.z, - C.dot( up ) + cy,
				d.x, d.y, d.z, - C.dot( d ),
				0, 0, 0, 1 ) );
		}
		return mats;
	}

	// unlit materials writing the two atlases (cards cut at the same coverage as the canopy)
	_bakeMaterials() {
		const tex = texture( this.leafTexture, uv() );
		const aux = attribute( 'aux', 'vec4' );
		const card = aux.w.greaterThan( 0.5 );
		const cover = tex.r, bright = tex.g;
		const make = ( colorNode ) => {
			const m = new THREE.MeshBasicNodeMaterial( { side: THREE.DoubleSide } );
			m.colorNode = colorNode;
			m.maskNode = card.not().or( cover.greaterThan( 0.45 ) );
			return m;
		};
		return {
			albedo: make( vec4( select( card, bright, float( 0.6 ) ), aux.x, select( card, tex.b, float( 0.5 ) ), 1 ) ),
			normal: make( vec4( normalGeometry.mul( 0.5 ).add( 0.5 ), aux.z ) )
		};
	}

	// leafTexture: the leaf-cluster (or needle) texture the plant's cards use
	bake( renderer, leafTexture ) {
		this.leafTexture = leafTexture;
		const t0 = performance.now();
		this.rtA = bakeTarget( OCT_N * FRAME_PX, 'impostorA', { depthBuffer: true } );
		this.rtB = bakeTarget( OCT_N * FRAME_PX, 'impostorB', { depthBuffer: true } );
		this.textureA = this.rtA.texture;
		this.textureB = this.rtB.texture;
		const mats = this._bakeMaterials();
		const scene = new THREE.Scene();
		const prevTarget = renderer.getRenderTarget();
		const prevClear = renderer.getClearColor( new THREE.Color() );
		const prevAlpha = renderer.getClearAlpha();
		const prevAuto = renderer.autoClear;
		const R = this.radius;
		// the atlas plane is one orthographic view: every cell is 2R wide
		const cam = new THREE.OrthographicCamera( 0, OCT_N * 2 * R, OCT_N * 2 * R, 0, 0.1, 6 * R + 10 );
		cam.position.set( 0, 0, 3 * R + 2 );
		cam.lookAt( 0, 0, - 1 );
		cam.updateMatrixWorld();
		cam.updateProjectionMatrix();
		const frames = this._frameMatrices();
		for ( const [ rt, mat ] of [ [ this.rtA, mats.albedo ], [ this.rtB, mats.normal ] ] ) {
			renderer.setRenderTarget( rt );
			renderer.setClearColor( 0x000000, 0 );
			renderer.autoClear = false;
			renderer.clear();
			const mesh = new THREE.InstancedMesh( this.geometry, mat, frames.length );
			frames.forEach( ( m, k ) => mesh.setMatrixAt( k, m ) );
			mesh.frustumCulled = false;
			scene.add( mesh );
			renderer.render( scene, cam );
			scene.remove( mesh );
			mesh.dispose();
			mat.dispose();
		}
		renderer.setRenderTarget( prevTarget );
		renderer.setClearColor( prevClear, prevAlpha );
		renderer.autoClear = prevAuto;
		this.bakeMs = performance.now() - t0;
		return this;
	}

	// Runtime material. Per instance: iPos (x, y, z, scale), iDat (yaw, height stretch, 0, seed),
	// aTint (vec3, the canopy tint). bark: linear colour of the trunk. groundShift (terrain.js): the
	// plant set on the ground its far terrain chunk draws (the coarse LODs cut below the crests).
	createMaterial( { bark, groundShift = null } ) {
		const mat = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide } );
		mat.name = 'impostor';
		const iPos = attribute( 'iPos', 'vec4' ), iDat = attribute( 'iDat', 'vec4' ), tint = attribute( 'aTint', 'vec3' );
		const base = groundShift ? iPos.xyz.add( vec3( 0, varying( groundShift( iPos.xz ) ), 0 ) ) : iPos.xyz;
		// uniforms, not constants: the impostors of every species share one shader (and pipeline)
		const R = uniform( this.radius ), Rh = uniform( this.rh ), Hv = uniform( this.hv ), Cy = uniform( this.center.y );

		// ---- vertex: camera-facing quad fitted to the plant's projected extent
		mat.positionNode = Fn( () => {
			const s = iPos.w, sy = iDat.y;
			const C = base.add( vec3( 0, Cy.mul( s ).mul( sy ), 0 ) );
			const toCam = normalize( cameraPosition.sub( C ) );
			const right = normalize( cross( UP, toCam ).add( vec3( 1e-4, 0, 0 ) ) );
			const up = cross( toCam, right );
			// its horizontal radius across; from above the crown disc, from the side the height
			const ty = abs( toCam.y );
			const halfW = Rh.mul( s );
			const halfH = Hv.mul( sy ).mul( max( float( 1 ).sub( ty.mul( ty ) ), 0 ).sqrt() ).add( Rh.mul( ty ) ).mul( s );
			const p = positionGeometry;
			return C.add( right.mul( p.x.mul( halfW ) ).add( up.mul( p.y.mul( halfH ) ) ) );
		} )();

		// ---- fragment: frame selection + re-projection (shared by mask, colour and normal)
		const vA = property( 'vec4', 'impA' ), vB = property( 'vec4', 'impB' );
		const atlasA = texture( this.textureA ), atlasB = texture( this.textureB );
		mat.maskNode = Fn( () => {
			const s = iPos.w, sy = iDat.y, yaw = iDat.x;
			const cyw = cos( yaw ), syw = sin( yaw );
			const C = base.add( vec3( 0, Cy.mul( s ).mul( sy ), 0 ) );
			// world -> plant-local (unstretched, centred): rotate by -yaw, divide by the scale
			const toLocal = ( v ) => vec3( v.x.mul( cyw ).sub( v.z.mul( syw ) ), v.y, v.x.mul( syw ).add( v.z.mul( cyw ) ) ).div( vec3( s, s.mul( sy ), s ) );
			const O = toLocal( cameraPosition.sub( C ) ).toVar();
			const D = toLocal( positionWorld.sub( cameraPosition ) ).toVar();
			const vdir = normalize( O );
			const vd = normalize( vec3( vdir.x, max( vdir.y, 0.02 ), vdir.z ) );
			const g = octEncodeT( vd ).mul( 0.5 ).add( 0.5 ).mul( OCT_N - 1 );
			// the frame nearest to the view direction
			const ij = floor( clamp( g.add( 0.5 ), vec2( 0 ), vec2( OCT_N - 1 ) ) );
			const d = octDecodeT( ij.x.div( OCT_N - 1 ).mul( 2 ).sub( 1 ), ij.y.div( OCT_N - 1 ).mul( 2 ).sub( 1 ) );
			const right = normalize( cross( UP, d ) );
			const up = cross( d, right );
			const t = dot( O, d ).negate().div( dot( D, d ) );
			const P = O.add( D.mul( t ) );
			const a = dot( P, right ).div( R ), b = dot( P, up ).div( R );
			const inCell = abs( a ).lessThan( 1 ).and( abs( b ).lessThan( 1 ) );
			const cu = ij.x.add( a.mul( 0.5 ).add( 0.5 ) ), cv = ij.y.add( b.mul( 0.5 ).add( 0.5 ) );
			// render targets are stored top row first: flip v
			const st = vec2( cu.div( OCT_N ), float( 1 ).sub( cv.div( OCT_N ) ) );
			const k = select( inCell, float( 1 ), float( 0 ) );
			vA.assign( atlasA.sample( st ).mul( k ) );
			vB.assign( atlasB.sample( st ).mul( k ) );
			return vA.w.greaterThan( 0.42 );
		} )();

		// same look as the near canopy (vegetation.js createFoliageMaterial with clusters)
		mat.colorNode = Fn( () => {
			const cov = max( vA.w, 1e-3 );
			const bright = vA.x.div( cov ), leaf = vA.y.div( cov ), cr = vA.z.div( cov ), ex = vB.w.div( cov );
			const n = mx_noise_float( iPos.xyz.mul( 0.9 ) ).mul( 0.5 ).add( 0.5 );
			const leafCol = tint.mul( mix( 0.8, 1.1, n ) ).mul( bright.mul( 1.4 ) ).mul( mix( vec3( 0.9, 0.95, 1.05 ), vec3( 1.1, 1.06, 0.85 ), cr ) );
			return select( leaf.greaterThan( 0.5 ), leafCol, uniform( bark ) ).mul( mix( 0.55, 1.0, ex ) ).mul( cloudShade() );
		} )();

		mat.normalNode = Fn( () => {
			const yaw = iDat.x, sy = iDat.y;
			const cyw = cos( yaw ), syw = sin( yaw );
			// B is written where A has coverage: un-premultiply the filtered edges by A's coverage
			const nl = vB.xyz.div( max( vA.w, 1e-3 ) ).mul( 2 ).sub( 1 );
			// local -> world: inverse-transpose of the stretch, then the yaw rotation
			const ns = vec3( nl.x, nl.y.div( sy ), nl.z );
			const nw = normalize( vec3( ns.x.mul( cyw ).add( ns.z.mul( syw ) ), ns.y, ns.z.mul( cyw ).sub( ns.x.mul( syw ) ) ) );
			return normalize( cameraViewMatrix.mul( vec4( nw, 0 ) ).xyz.add( positionViewDirection.mul( 0.12 ) ) );
		} )();

		mat.roughnessNode = float( 0.85 );
		mat.metalnessNode = float( 0 );
		return mat;
	}

}

// Quad geometry of the impostor instances (corners at +-1).
export function impostorQuad() {
	const g = new THREE.InstancedBufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( [ - 1, - 1, 0, 1, - 1, 0, 1, 1, 0, - 1, 1, 0 ], 3 ) );
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1 ], 3 ) );
	g.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
	return g;
}
