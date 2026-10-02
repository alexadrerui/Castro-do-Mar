// Fresh-water plants of a lake (world/koi/lakes.js: the lakes of the terrain editor): eelgrass on the
// shallow shelf, whorled waterweed in deeper water and broad-leaved pondweed between, in clusters on
// the bed with their tips kept under the surface; and cattails (Typha) in stands on the shallow margin
// and the wet bank. Port of water/LakeFlora.js and of the reed of foliage/MeadowGeometry.js of
// Drusniel: Gods' End (https://github.com/danielsobrado/drusniel-gods-end, MIT, Copyright (c) 2026
// Daniel Sobrado, licenses/LICENSE-Drusniel.md). Changes: placed by the free-form lake's distance to
// the shore and the relief instead of an authored outline; their lily pads are left out (the lake
// has the lotus of world/koi/lotus.js); every species merged into one mesh (one per kind, one shader
// for all): the sway reads a per-vertex height and phase instead of instance attributes.
import * as THREE from 'three/webgpu';
import { attribute, cos, positionLocal, sin, time, vec3, vertexColor } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cloudShade } from './cloudShadow.js';

const UP = new THREE.Vector3( 0, 1, 0 );
const FORWARD = new THREE.Vector3( 0, 0, 1 );
const point = ( x, y, z ) => new THREE.Vector3( x, y, z );

// ------------------------------------------------------------------ geometry (Drusniel's)

// Per-vertex colour for merged pieces, base at y = 0 to top at y = 1.
function colored( geometry, color ) {
	const g = geometry.index ? geometry.toNonIndexed() : geometry;
	for ( const name of Object.keys( g.attributes ) ) if ( ! [ 'position', 'normal' ].includes( name ) ) g.deleteAttribute( name );
	const colors = new Float32Array( g.attributes.position.count * 3 );
	const top = new THREE.Color( color.top ?? color ), base = new THREE.Color( color.base ?? color ), c = new THREE.Color();
	for ( let i = 0; i < g.attributes.position.count; i ++ ) {
		c.copy( base ).lerp( top, THREE.MathUtils.clamp( g.attributes.position.getY( i ), 0, 1 ) );
		colors.set( [ c.r, c.g, c.b ], i * 3 );
	}
	g.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
	return g;
}

// a bent ribbon one unit tall, narrowing to the tip
function ribbon( width, segments, lean, twist ) {
	const positions = [];
	const pt = ( t, side ) => {
		const bend = lean * t * t, w = width * ( 1 - t * 0.7 ) * side, a = twist * t;
		return [ Math.cos( a ) * w + bend, t, Math.sin( a ) * w ];
	};
	for ( let s = 0; s < segments; s ++ ) {
		const a = s / segments, b = ( s + 1 ) / segments;
		const [ p0, p1, p2, p3 ] = [ pt( a, - 1 ), pt( a, 1 ), pt( b, - 1 ), pt( b, 1 ) ];
		positions.push( ...p0, ...p1, ...p2, ...p2, ...p1, ...p3 );
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	g.computeVertexNormals();
	return g;
}

function eelgrass( blades, segments, random ) {
	const parts = [];
	for ( let i = 0; i < blades; i ++ ) {
		const blade = ribbon( 0.035, segments, ( random() - 0.5 ) * 0.5, ( random() - 0.5 ) * 1.2 );
		blade.scale( 1, 0.75 + random() * 0.25, 1 );
		blade.rotateY( ( i / blades ) * Math.PI * 2 + random() * 0.6 );
		blade.translate( ( random() - 0.5 ) * 0.12, 0, ( random() - 0.5 ) * 0.12 );
		parts.push( colored( blade, { base: '#2f4a1c', top: '#7f9a3a' } ) );
	}
	return mergeGeometries( parts );
}

// a thin stalk with whorls of needle leaves (hornwort, milfoil)
function waterweed( whorls, leaves ) {
	const parts = [];
	const stalk = new THREE.CylinderGeometry( 0.012, 0.018, 1, 4, 1, true ).translate( 0, 0.5, 0 );
	parts.push( colored( stalk, { base: '#35491f', top: '#56702c' } ) );
	for ( let w = 0; w < whorls; w ++ ) {
		const y = 0.12 + ( w / whorls ) * 0.85, length = 0.26 * ( 1 - ( w / whorls ) * 0.45 );
		for ( let l = 0; l < leaves; l ++ ) {
			const a = ( l / leaves ) * Math.PI * 2 + w * 0.5;
			const leaf = new THREE.BufferGeometry();
			const tip = [ Math.cos( a ) * length, y + 0.07, Math.sin( a ) * length ];
			const side = [ Math.cos( a + 1.57 ) * 0.02, 0, Math.sin( a + 1.57 ) * 0.02 ];
			leaf.setAttribute( 'position', new THREE.Float32BufferAttribute( [ side[ 0 ], y, side[ 2 ], - side[ 0 ], y, - side[ 2 ], ...tip ], 3 ) );
			leaf.computeVertexNormals();
			parts.push( colored( leaf, { base: '#3d5a22', top: '#6f8f35' } ) );
		}
	}
	return mergeGeometries( parts );
}

// a stem with a few broad oval leaves held at angles (pondweed)
function pondweed( leafCount, leafSegments, random ) {
	const parts = [];
	const stem = new THREE.CylinderGeometry( 0.01, 0.015, 1, 4, 1, true ).translate( 0, 0.5, 0 );
	parts.push( colored( stem, { base: '#3b4a1d', top: '#5b6b28' } ) );
	for ( let i = 0; i < leafCount; i ++ ) {
		const y = 0.35 + ( i / leafCount ) * 0.6;
		const leaf = new THREE.CircleGeometry( 0.17, leafSegments );
		leaf.scale( 1, 0.42, 1 );
		leaf.rotateX( - Math.PI / 2 + 0.5 + random() * 0.4 );
		leaf.translate( 0, 0, 0.1 );
		leaf.rotateY( ( i / leafCount ) * Math.PI * 2 + random() * 0.8 );
		leaf.translate( 0, y, 0 );
		parts.push( colored( leaf, { base: '#4a6326', top: '#5f7a2c' } ) );
	}
	return mergeGeometries( parts );
}

// Drusniel's PlantBuilder (foliage/MeadowGeometry.js): folded opaque leaves, faceted stems, buds
class PlantBuilder {
	positions = []; colors = []; indices = [];
	vertex( p, c ) { const i = this.positions.length / 3; p.toArray( this.positions, i * 3 ); c.toArray( this.colors, i * 3 ); return i; }
	triangle( a, b, c ) { this.indices.push( a, b, c ); }
	leaf( start, end, width, curl, root, tip, twist = 0, segments = 4 ) {
		const axis = end.clone().sub( start ).normalize();
		const side = new THREE.Vector3().crossVectors( axis, Math.abs( axis.y ) > 0.9 ? FORWARD : UP ).normalize().applyAxisAngle( axis, twist );
		const normal = new THREE.Vector3().crossVectors( side, axis ).normalize();
		const dark = new THREE.Color( root ), light = new THREE.Color( tip );
		let previous = [ this.vertex( start, dark ) ];
		for ( let i = 1; i <= segments; i ++ ) {
			const t = i / segments, color = dark.clone().lerp( light, t );
			const center = start.clone().lerp( end, t ).addScaledVector( normal, Math.sin( t * Math.PI ) * curl );
			let row;
			if ( i === segments ) row = [ this.vertex( end, color ) ];
			else {
				const w = Math.pow( Math.sin( t * Math.PI ), 0.8 ) * width;
				const edge = center.clone().addScaledVector( normal, - w * 0.32 );
				row = [ this.vertex( edge.clone().addScaledVector( side, - w ), color.clone().multiplyScalar( 0.88 ) ), this.vertex( center, color ), this.vertex( edge.clone().addScaledVector( side, w ), color ) ];
			}
			if ( previous.length === 1 ) { this.triangle( previous[ 0 ], row[ 0 ], row[ 1 ] ); this.triangle( previous[ 0 ], row[ 1 ], row[ 2 ] ); }
			else if ( row.length === 1 ) { this.triangle( previous[ 0 ], row[ 0 ], previous[ 1 ] ); this.triangle( previous[ 1 ], row[ 0 ], previous[ 2 ] ); }
			else for ( let j = 0; j < 2; j ++ ) { this.triangle( previous[ j ], row[ j ], previous[ j + 1 ] ); this.triangle( previous[ j + 1 ], row[ j ], row[ j + 1 ] ); }
			previous = row;
		}
	}
	stem( points, radius, color = '#507748', sides = 3 ) {
		const tint = new THREE.Color( color );
		let previous;
		for ( let i = 0; i < points.length; i ++ ) {
			const tangent = points[ Math.min( i + 1, points.length - 1 ) ].clone().sub( points[ Math.max( i - 1, 0 ) ] ).normalize();
			const side = new THREE.Vector3().crossVectors( tangent, Math.abs( tangent.z ) > 0.9 ? UP : FORWARD ).normalize();
			const normal = new THREE.Vector3().crossVectors( side, tangent ).normalize();
			const ring = [];
			const r = Array.isArray( radius ) ? radius[ i ] : radius * ( 1 - i / ( points.length - 1 ) * 0.65 );
			for ( let j = 0; j < sides; j ++ ) {
				const a = j / sides * Math.PI * 2;
				ring.push( this.vertex( points[ i ].clone().addScaledVector( side, Math.cos( a ) * r ).addScaledVector( normal, Math.sin( a ) * r ), tint ) );
			}
			if ( previous ) for ( let j = 0; j < sides; j ++ ) { const nx = ( j + 1 ) % sides; this.triangle( previous[ j ], ring[ j ], previous[ nx ] ); this.triangle( previous[ nx ], ring[ j ], ring[ nx ] ); }
			previous = ring;
		}
	}
	build() {
		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.positions, 3 ) );
		g.setAttribute( 'color', new THREE.Float32BufferAttribute( this.colors, 3 ) );
		g.setIndex( this.indices );
		g.computeVertexNormals();
		return g.toNonIndexed();
	}
}

// a clump of three cattails: stalks with long leaves and the velvet head with its flowering spike
function cattail() {
	const b = new PlantBuilder();
	for ( let i = 0; i < 3; i ++ ) {
		const angle = i * 2.399;
		const base = point( Math.cos( angle ) * 0.12, 0, Math.sin( angle ) * 0.12 );
		const head = base.clone().add( point( Math.sin( angle ) * 0.13, 1.55 + i * 0.17, 0.08 ) );
		b.stem( [ base, base.clone().lerp( head, 0.5 ), head ], 0.018, '#64864d' );
		for ( let j = 0; j < 3; j ++ ) {
			const a = angle + j * 2.399;
			const start = base.clone().lerp( head, 0.14 + j * 0.2 );
			b.leaf( start, start.clone().add( point( Math.cos( a ) * 0.43, 0.25, Math.sin( a ) * 0.35 ) ), 0.035, 0.16, '#487b49', '#b6bf6c', Math.sin( a ) * 0.35, 4 );
		}
		b.stem( [ - 0.23, - 0.19, 0.04, 0.08 ].map( ( y ) => head.clone().add( point( 0, y, 0 ) ) ), [ 0.015, 0.048, 0.048, 0.012 ], '#795635', 6 );
		b.stem( [ head.clone().add( point( 0, 0.07, 0 ) ), head.clone().add( point( 0, 0.22, 0 ) ) ], 0.01, '#b9a166' );
	}
	return b.build();
}

// ------------------------------------------------------------------ placement

const UNDERWATER_CLUSTERS = 90, REED_STANDS = 40;

// one plant: the geometry placed, scaled, with the per-vertex sway data (local height x amount, phase)
function plant( geo, pos, yaw, sx, sy, sway, phase, tilt = 0, tiltAxis = 0 ) {
	const g = geo.clone();
	const h = new Float32Array( g.attributes.position.count * 2 );
	const p = g.attributes.position;
	for ( let i = 0; i < p.count; i ++ ) { const y = Math.max( 0, p.getY( i ) ); h[ i * 2 ] = y * y * sway * sy; h[ i * 2 + 1 ] = phase; }
	g.setAttribute( 'sway', new THREE.BufferAttribute( h, 2 ) );
	const q = new THREE.Quaternion().setFromEuler( new THREE.Euler( Math.cos( tiltAxis ) * tilt, yaw, Math.sin( tiltAxis ) * tilt, 'YXZ' ) );
	g.applyMatrix4( new THREE.Matrix4().compose( pos, q, new THREE.Vector3( sx, sy, sx ) ) );
	return g;
}

function placeUnderwater( lake, hf, water, random, shapes ) {
	const out = [ [], [], [] ];
	const [ x0, z0, x1, z1 ] = lake.box;
	let clusters = 0;
	const want = Math.min( UNDERWATER_CLUSTERS, Math.round( lake.area / 12 ) );
	for ( let attempt = 0; attempt < want * 20 && clusters < want; attempt ++ ) {
		const cx = THREE.MathUtils.lerp( x0, x1, random() ), cz = THREE.MathUtils.lerp( z0, z1, random() );
		if ( lake.shore( cx, cz ) < 1.5 ) continue;
		const depth = water - hf.heightAt( cx, cz );
		if ( ! ( depth > 0.6 && depth < 7 ) ) continue;
		clusters ++;
		// eelgrass on the shallow shelf, waterweed in deeper water, pondweed between
		const species = depth < 2.2 ? ( random() < 0.7 ? 0 : 2 ) : depth < 4.5 ? ( random() < 0.5 ? 2 : 1 ) : 1;
		const radius = 0.8 + random() * 2.5, members = 6 + Math.floor( random() * 16 );
		for ( let m = 0; m < members; m ++ ) {
			const a = random() * Math.PI * 2, r = radius * Math.sqrt( random() );
			const x = cx + Math.cos( a ) * r, z = cz + Math.sin( a ) * r;
			if ( lake.shore( x, z ) < 0.8 ) continue;
			const y = hf.heightAt( x, z ), w = water - y;
			if ( ! ( w > 0.5 ) ) continue;
			const kind = random() < 0.8 ? species : Math.floor( random() * 3 );
			// taller toward the cluster's middle; the tips stay under the surface
			const centre = 1 - r / radius;
			const height = Math.min( w - 0.25, ( kind === 0 ? 1.1 : kind === 1 ? 1.6 : 0.9 ) * ( 0.55 + centre * 0.6 + random() * 0.35 ) );
			if ( height < 0.3 ) continue;
			const width = kind === 0 ? 1.2 + random() * 0.6 : 0.9 + random() * 0.4;
			out[ kind ].push( plant( shapes[ kind ], new THREE.Vector3( x, y - 0.05, z ), random() * Math.PI * 2, width, height, [ 0.16, 0.1, 0.08 ][ kind ], random(), random() * 0.15, random() * 6.28 ) );
		}
	}
	return out;
}

// cattail stands: the shallow margin (water under ~0.5 m) and the wet bank (up to ~0.45 m above it)
function placeReeds( lake, hf, water, random, shape ) {
	const out = [];
	const [ x0, z0, x1, z1 ] = lake.box, pad = 4;
	const wetAt = ( x, z ) => {
		const d = hf.heightAt( x, z ) - water; // above the water: positive
		return d > - 0.55 && d < 0.45 && hf.slopeAt( x, z ) < 0.45;
	};
	let stands = 0;
	const want = Math.min( REED_STANDS, Math.max( 3, Math.round( lake.area / 18 ) ) );
	for ( let attempt = 0; attempt < want * 60 && stands < want; attempt ++ ) {
		const cx = THREE.MathUtils.lerp( x0 - pad, x1 + pad, random() ), cz = THREE.MathUtils.lerp( z0 - pad, z1 + pad, random() );
		if ( ! wetAt( cx, cz ) ) continue;
		stands ++;
		const radius = 0.8 + random() * 1.8, members = 4 + Math.floor( random() * 10 );
		for ( let m = 0; m < members; m ++ ) {
			const a = random() * Math.PI * 2, r = radius * Math.sqrt( random() );
			const x = cx + Math.cos( a ) * r, z = cz + Math.sin( a ) * r;
			if ( ! wetAt( x, z ) ) continue;
			const y = hf.heightAt( x, z );
			// Drusniel's reed scale with the moisture: taller in the water than on the bank
			const wet = THREE.MathUtils.clamp( ( water - y + 0.45 ) / 1, 0, 1 );
			const s = ( 0.82 + wet * 0.58 ) * ( 0.85 + random() * 0.3 );
			out.push( plant( shape, new THREE.Vector3( x, y - 0.05, z ), random() * Math.PI * 2, s, s, 0.05, random(), random() * 0.08, random() * 6.28 ) );
		}
	}
	return out;
}

// ------------------------------------------------------------------ material

// one material for every plant: vertex colours, the cloud shadows, and a slow sway stronger toward the
// tip (the per-vertex sway.x is local height^2 x amount, sway.y the plant's phase)
let MAT = null;
function floraMaterial() {
	if ( MAT ) return MAT;
	MAT = new THREE.MeshStandardNodeMaterial( { side: THREE.DoubleSide, roughness: 0.85 } );
	const sw = attribute( 'sway', 'vec2' );
	const wave = time.mul( 0.9 ).add( sw.y.mul( 6.283 ) ).add( positionLocal.y.mul( 0.6 ) );
	MAT.positionNode = positionLocal.add( vec3( sin( wave ).mul( sw.x ), 0, cos( wave.mul( 0.8 ) ).mul( sw.x.mul( 0.7 ) ) ) );
	MAT.colorNode = vertexColor().mul( cloudShade() );
	return MAT;
}

// The plants of a lake as a group (null when nothing fits): rnd is the lake's generator.
export function buildLakeFlora( lake, hf, water, rnd ) {
	const shapes = [ eelgrass( 7, 5, rnd ), waterweed( 9, 8 ), pondweed( 5, 8, rnd ) ];
	const under = placeUnderwater( lake, hf, water, rnd, shapes );
	const reeds = placeReeds( lake, hf, water, rnd, cattail() );
	const group = new THREE.Group();
	group.name = 'lakeFlora';
	const names = [ 'eelgrass', 'waterweed', 'pondweed' ];
	const add = ( list, name, shadow ) => {
		if ( ! list.length ) return;
		const m = new THREE.Mesh( mergeGeometries( list ), floraMaterial() );
		m.name = 'flora_' + name;
		m.castShadow = shadow; m.receiveShadow = true;
		group.add( m );
	};
	under.forEach( ( list, k ) => add( list, names[ k ], false ) ); // under the water: no shadow of their own
	add( reeds, 'cattail', true );
	group.userData.count = { eelgrass: under[ 0 ].length, waterweed: under[ 1 ].length, pondweed: under[ 2 ].length, cattail: reeds.length };
	return group.children.length ? group : null;
}
