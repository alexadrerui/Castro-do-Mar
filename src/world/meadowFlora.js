// Meadow flowers, seed heads, foxgloves and leaf litter among the grass.
// The plant meshes are ported from Drusniel: Gods' End (https://github.com/danielsobrado/drusniel-gods-end,
// src/foliage/MeadowGeometry.js at commit 95cc587), MIT License, Copyright (c) Daniel Sobrado; see
// licenses/LICENSE-Drusniel.md. Changes: this project's vertex format (non-indexed, uv, color,
// aux = leaf, sway, ao, card), so every plant shares the birch's foliage material (vegetation.js
// createFoliageMaterial: no new shader, the project sits at the browser's shader cache limit); a
// light LOD; the daisy also as a buttercup; a foxglove (Digitalis purpurea) built with the same
// builder; placed by this project's grass density mask, the woodland and the village clearance.
import * as THREE from 'three/webgpu';
import { ChunkedInstances } from '../core/chunked.js';
import { mulberry32, makeSimplex, fbm, smoothstep as ss } from '../core/noise.js';
import { VILLAGE } from './layout.js';
import { CH, natureAt } from './natureEdits.js';
import { inLake } from './vegetation.js';

const UP = new THREE.Vector3( 0, 1, 0 );
const FORWARD = new THREE.Vector3( 0, 0, 1 );
const point = ( x, y, z ) => new THREE.Vector3( x, y, z );

// Small, opaque botanical meshes: folded leaf surfaces catch the light without alpha cards, while
// shared vertices keep each instanced clump inexpensive. lod: fewer leaf segments, no sepals.
class PlantBuilder {

	constructor( lod = 0 ) {
		this.lod = lod;
		this.positions = []; this.colors = []; this.indices = [];
	}

	vertex( position, color ) {
		const index = this.positions.length / 3;
		position.toArray( this.positions, index * 3 );
		color.toArray( this.colors, index * 3 );
		return index;
	}

	triangle( a, b, c ) { this.indices.push( a, b, c ); }

	leaf( start, end, width, curl, root, tip, twist = 0, segments = 4 ) {
		if ( this.lod ) segments = Math.min( segments, 2 );
		const axis = end.clone().sub( start ).normalize();
		const side = new THREE.Vector3().crossVectors( axis, Math.abs( axis.y ) > 0.9 ? FORWARD : UP ).normalize().applyAxisAngle( axis, twist );
		const normal = new THREE.Vector3().crossVectors( side, axis ).normalize();
		const dark = new THREE.Color( root ), light = new THREE.Color( tip );
		let previous = [ this.vertex( start, dark ) ];
		for ( let i = 1; i <= segments; i ++ ) {
			const t = i / segments;
			const color = dark.clone().lerp( light, t );
			const center = start.clone().lerp( end, t ).addScaledVector( normal, Math.sin( t * Math.PI ) * curl );
			let row;
			if ( i === segments ) row = [ this.vertex( end, color ) ];
			else {
				const w = Math.pow( Math.sin( t * Math.PI ), 0.8 ) * width;
				const edge = center.clone().addScaledVector( normal, - w * 0.32 );
				row = [ this.vertex( edge.clone().addScaledVector( side, - w ), color.clone().multiplyScalar( 0.88 ) ),
					this.vertex( center, color ), this.vertex( edge.clone().addScaledVector( side, w ), color ) ];
			}
			if ( previous.length === 1 ) {
				this.triangle( previous[ 0 ], row[ 0 ], row[ 1 ] );
				this.triangle( previous[ 0 ], row[ 1 ], row[ 2 ] );
			} else if ( row.length === 1 ) {
				this.triangle( previous[ 0 ], row[ 0 ], previous[ 1 ] );
				this.triangle( previous[ 1 ], row[ 0 ], previous[ 2 ] );
			} else {
				for ( let j = 0; j < 2; j ++ ) {
					this.triangle( previous[ j ], row[ j ], previous[ j + 1 ] );
					this.triangle( previous[ j + 1 ], row[ j ], row[ j + 1 ] );
				}
			}
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
			const ringRadius = Array.isArray( radius ) ? radius[ i ] : radius * ( 1 - i / ( points.length - 1 ) * 0.65 );
			for ( let j = 0; j < sides; j ++ ) {
				const angle = j / sides * Math.PI * 2;
				ring.push( this.vertex( points[ i ].clone().addScaledVector( side, Math.cos( angle ) * ringRadius ).addScaledVector( normal, Math.sin( angle ) * ringRadius ), tint ) );
			}
			if ( previous ) for ( let j = 0; j < sides; j ++ ) {
				const next = ( j + 1 ) % sides;
				this.triangle( previous[ j ], ring[ j ], previous[ next ] );
				this.triangle( previous[ next ], ring[ j ], ring[ next ] );
			}
			previous = ring;
		}
	}

	bud( center, radius, color, under = 0.75 ) {
		const tint = new THREE.Color( color );
		const vertices = [ [ 0, 1, 0 ], [ 0, - 1, 0 ], [ 1, 0, 0 ], [ 0, 0, 1 ], [ - 1, 0, 0 ], [ 0, 0, - 1 ] ]
			.map( ( [ x, y, z ] ) => this.vertex( point( x * radius.x, y * radius.y, z * radius.z ).add( center ), tint.clone().multiplyScalar( y < 0 ? under : 1 ) ) );
		for ( let i = 0; i < 4; i ++ ) {
			const a = vertices[ 2 + i ], b = vertices[ 2 + ( i + 1 ) % 4 ];
			this.triangle( vertices[ 0 ], b, a );
			this.triangle( vertices[ 1 ], a, b );
		}
	}

	// this project's vertex format (plants.js finalize): non-indexed (the colours are linear already:
	// THREE.Color converts the hex strings; once more and the plants went dark, as the pines did once),
	// aux = ( leaf 0: the vertex colour as is, sway by height, ao, card 0 ), an empty uv
	build( height ) {
		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.positions, 3 ) );
		g.setIndex( this.indices );
		g.computeVertexNormals();
		g.setAttribute( 'color', new THREE.Float32BufferAttribute( this.colors, 3 ) );
		const geo = g.toNonIndexed();
		const p = geo.attributes.position, n = p.count;
		const aux = new Float32Array( n * 4 );
		for ( let i = 0; i < n; i ++ ) {
			const t = Math.max( 0, p.getY( i ) ) / height;
			aux[ i * 4 + 1 ] = Math.min( 1, t * t ) * 0.45; // sway: the heads move, the roots stay
			aux[ i * 4 + 2 ] = 0.7 + 0.3 * Math.min( 1, t * 2 ); // a little darker at the ground
		}
		geo.setAttribute( 'aux', new THREE.BufferAttribute( aux, 4 ) );
		geo.setAttribute( 'uv', new THREE.BufferAttribute( new Float32Array( n * 2 ), 2 ) );
		geo.computeBoundingSphere();
		return geo;
	}
}

// Drusniel's flower clump (oxeye daisy); the buttercup is the same plant, yellow and lower
const DAISY = { petals: 6, rays: [ '#dfbc62', '#edf4df', '#fff0c9' ], disc: '#d8a843', reach: 0.145, height: 0.76 };
const BUTTERCUP = { petals: 5, rays: [ '#c99a24', '#f2cf3c', '#f7dc55' ], disc: '#b68a22', reach: 0.1, height: 0.55 };

function flowers( builder, F ) {
	for ( let i = 0; i < 5; i ++ ) {
		const angle = i * 2.399;
		builder.leaf( point( 0, 0.03, 0 ), point( Math.cos( angle ) * 0.3, 0.23, Math.sin( angle ) * 0.3 ), 0.07, 0.08, '#346646', '#82ab58', angle * 0.2 );
	}
	for ( let i = 0; i < 3; i ++ ) {
		const angle = i * 2.399;
		const head = point( Math.cos( angle ) * 0.2, F.height + i * 0.16, Math.sin( angle ) * 0.2 );
		const middle = head.clone().multiplyScalar( 0.5 ).add( point( 0.05, 0, - 0.04 ) );
		builder.stem( [ point( 0, 0, 0 ), middle, head ], 0.013 );
		builder.leaf( middle, middle.clone().add( point( - 0.18, 0.18, 0.08 ) ), 0.045, 0.035, '#42764c', '#93b967' );
		for ( let petal = 0; petal < F.petals; petal ++ ) {
			const a = petal * Math.PI * 2 / F.petals + i;
			builder.leaf( head, head.clone().add( point( Math.cos( a ) * F.reach, 0.04, Math.sin( a ) * F.reach ) ), 0.049, - 0.025, F.rays[ 0 ], i === 1 ? F.rays[ 2 ] : F.rays[ 1 ], 0, 3 );
			if ( ! builder.lod ) builder.leaf( head.clone().add( point( 0, - 0.018, 0 ) ), head.clone().add( point( Math.cos( a ) * 0.08, - 0.04, Math.sin( a ) * 0.08 ) ), 0.018, 0.01, '#467247', '#7eaa53', 0, 2 );
		}
		builder.bud( head.clone().add( point( 0, 0.023, 0 ) ), point( 0.042, 0.027, 0.042 ), F.disc );
		if ( ! builder.lod ) for ( let stamen = 0; stamen < 4; stamen ++ ) {
			const a = stamen * Math.PI / 2;
			builder.bud( head.clone().add( point( Math.cos( a ) * 0.025, 0.043, Math.sin( a ) * 0.025 ) ), point( 0.008, 0.012, 0.008 ), '#f7df8b' );
		}
	}
}

// Drusniel's seed-head grass stalks
function seedStalks( builder ) {
	for ( let i = 0; i < 3; i ++ ) {
		const angle = i * 2.399;
		const base = point( Math.cos( angle ) * 0.12, 0, Math.sin( angle ) * 0.12 );
		const head = base.clone().add( point( Math.sin( angle ) * 0.13, 0.95 + i * 0.17, 0.08 ) );
		builder.stem( [ base, base.clone().lerp( head, 0.5 ), head ], 0.009, '#8c9454' );
		for ( let j = 0; j < 3; j ++ ) {
			const a = angle + j * 2.399;
			const start = base.clone().lerp( head, 0.14 + j * 0.2 );
			builder.leaf( start, start.clone().add( point( Math.cos( a ) * 0.27, 0.25, Math.sin( a ) * 0.35 ) ), 0.022, 0.16, '#487b49', '#b6bf6c', Math.sin( a ) * 0.35, 4 );
		}
		for ( let j = 0; j < ( builder.lod ? 4 : 7 ); j ++ ) {
			const a = angle + j * 2.399;
			const start = head.clone().add( point( 0, - 0.25 + j * 0.044, 0 ) );
			const reach = 0.13 * ( 1 - j / 9 );
			const end = start.clone().add( point( Math.cos( a ) * reach, 0.095, Math.sin( a ) * reach ) );
			builder.stem( [ start, end ], 0.004, '#b8ad70' );
			builder.bud( end, point( 0.022, 0.051, 0.022 ), j % 2 ? '#ceb779' : '#a7aa64' );
		}
	}
}

// Drusniel's leaf litter, a few clumps of dry oak leaves
function litter( builder ) {
	for ( let i = 0; i < 4; i ++ ) {
		const angle = i * 2.399;
		const start = point( Math.cos( angle ) * 0.09, 0.03 + i * 0.007, Math.sin( angle ) * 0.1 );
		const end = start.clone().add( point( Math.cos( angle ) * 0.28, 0.035, Math.sin( angle ) * 0.28 ) );
		builder.leaf( start, end, 0.075, 0.055, '#685b35', i % 2 ? '#aa8649' : '#b3a563' );
		builder.stem( [ start, start.clone().lerp( end, 0.5 ).add( point( 0, 0.052, 0 ) ), end ], 0.003, '#c2aa71' );
	}
}

// Foxglove (dedaleira, Digitalis purpurea), common at the Galician woodland edges: a rosette of broad
// leaves and a tall spike of purple bells hanging to one side, green buds at the tip. Ours, with the
// same builder.
function foxglove( builder ) {
	for ( let i = 0; i < 7; i ++ ) {
		const angle = i * 2.399;
		const r = 0.32 + ( i % 3 ) * 0.05;
		builder.leaf( point( 0, 0.02, 0 ), point( Math.cos( angle ) * r, 0.12 + ( i % 2 ) * 0.06, Math.sin( angle ) * r ), 0.1, 0.05, '#2f5a36', '#6f9a52', angle * 0.3 );
	}
	const H = 1.15;
	const spine = [ 0, 0.3, 0.65, 1 ].map( ( t ) => point( Math.sin( t * 1.4 ) * 0.06, t * H, 0 ) );
	builder.stem( spine, 0.016, '#5a7a45', builder.lod ? 3 : 4 );
	for ( let k = 0; k < 4; k ++ ) {
		const y = 0.25 + k * 0.12;
		builder.leaf( point( 0.01, y, 0 ), point( Math.cos( k * 2.4 ) * 0.16, y + 0.1, Math.sin( k * 2.4 ) * 0.16 ), 0.04, 0.02, '#3d6a3e', '#7ea65a' );
	}
	const bells = builder.lod ? 8 : 14;
	for ( let k = 0; k < bells; k ++ ) {
		const t = 0.48 + k / bells * 0.5;
		const at = point( Math.sin( t * 1.4 ) * 0.06, t * H, 0 );
		// the bells hang on one side of the spike, bigger and more open lower down
		const side = - 0.6 + ( k % 3 ) * 0.6;
		const out = point( Math.cos( side ) * 0.07, - 0.03, Math.sin( side ) * 0.07 );
		const size = 0.038 * ( 1.15 - t * 0.55 );
		const tip = k > bells - 3;
		builder.bud( at.clone().add( out ), point( size * 0.85, size * 1.6, size * 0.85 ), tip ? '#7d9a52' : k % 2 ? '#a8458c' : '#c05fa2', 0.62 );
	}
}

// geometries of one kind (lod 0 / 1) and the height its sway is measured against
const KINDS = {
	daisy: { make: ( b ) => flowers( b, DAISY ), height: 1.2 },
	buttercup: { make: ( b ) => flowers( b, BUTTERCUP ), height: 0.9 },
	seed: { make: seedStalks, height: 1.4 },
	litter: { make: litter, height: 1 },
	foxglove: { make: foxglove, height: 1.2 }
};
function plantGeometry( kind, lod ) {
	const b = new PlantBuilder( lod );
	KINDS[ kind ].make( b );
	return b.build( KINDS[ kind ].height );
}

const RADIUS = 480; // around the village

// app: hf, foliageMaterial (the birch's), the vegetation group (its trees), natureEdits;
// density: the grass density mask (grass.js GrassField.density, G = meadow)
export function createMeadowFlora( app, density, vegetation ) {
	const { hf } = app;
	const material = app.foliageMaterial;
	const group = new THREE.Group();
	group.name = 'meadowFlora';
	const species = {};
	const dist = { daisy: 150, buttercup: 130, seed: 150, litter: 90, foxglove: 260 };
	for ( const k of Object.keys( KINDS ) ) {
		species[ k ] = new ChunkedInstances( { name: 'flora_' + k, hi: plantGeometry( k, 0 ), lo: plantGeometry( k, 1 ), material, tile: 120, lodDistance: 35, maxDistance: dist[ k ], castShadow: false, shadowDistance: 0, layer: 1, reflect: false } );
		species[ k ].addAttribute( 'aTint', 3 ); // read by the material (unused with leaf 0)
	}
	const meadowAt = ( x, z ) => {
		const i = Math.floor( ( x - density.x0 ) / density.texel ), j = Math.floor( ( z - density.z0 ) / density.texel );
		if ( i < 0 || j < 0 || i >= density.res || j >= density.res ) return 0;
		return density.data[ ( j * density.res + i ) * 4 + 1 ] / 255;
	};
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), nrm = new THREE.Vector3();
	const counts = Object.fromEntries( Object.keys( KINDS ).map( ( k ) => [ k, 0 ] ) );
	const place = ( kind, x, z, s, R, tilt = 0.5 ) => {
		hf.normalAt( x, z, nrm );
		q.setFromUnitVectors( UP, nrm.lerp( UP, 1 - tilt ).normalize() ).multiply( q2.setFromAxisAngle( UP, R() * Math.PI * 2 ) );
		pos.set( x, hf.heightAt( x, z ) - 0.02, z );
		sc.set( s * ( 0.85 + R() * 0.3 ), s * ( 0.85 + R() * 0.3 ), s * ( 0.85 + R() * 0.3 ) );
		species[ kind ].add_( m.compose( pos, q, sc ), [ [ 1, 1, 1 ] ] );
		counts[ kind ] ++;
	};

	// flowers and seed heads over the meadow, in patches (daisies and buttercups where the patch
	// noise is high, seed heads between them); own random sequence, the rest of the world unchanged
	const rnd = mulberry32( 7310 );
	const noise = makeSimplex( 7311 );
	const step = 1.6;
	for ( let z = VILLAGE.z - RADIUS; z < VILLAGE.z + RADIUS; z += step ) {
		for ( let x = VILLAGE.x - RADIUS; x < VILLAGE.x + RADIUS; x += step ) {
			const px = x + ( rnd() - 0.5 ) * step, pz = z + ( rnd() - 0.5 ) * step;
			const r0 = rnd(), r1 = rnd();
			if ( Math.hypot( px - VILLAGE.x, pz - VILLAGE.z ) > RADIUS ) continue;
			const meadow = meadowAt( px, pz );
			if ( meadow < 0.35 ) continue;
			const patch = ss( - 0.05, 0.45, fbm( noise, px * 0.022, pz * 0.022, 2 ) );
			if ( r0 > meadow * ( 0.12 + 0.8 * patch * patch ) ) continue;
			let kind;
			if ( patch > 0.45 ) kind = r1 < 0.45 ? 'daisy' : r1 < 0.8 ? 'buttercup' : 'seed';
			else kind = r1 < 0.72 ? 'seed' : r1 < 0.86 ? 'daisy' : 'buttercup';
			// above the meadow grass (~0.6 m): daisies 0.5-0.9 m, buttercups 0.4-0.7 m, seed heads up to ~1.2 m
			place( kind, px, pz, kind === 'seed' ? 0.65 + rnd() * 0.3 : kind === 'daisy' ? 0.62 + rnd() * 0.25 : 0.7 + rnd() * 0.3, rnd );
		}
	}

	// around the trees near the village: dry leaves under the oaks, foxgloves at the woodland edge
	const rt = mulberry32( 7320 );
	const p = new THREE.Vector3();
	for ( const ch of vegetation.children ) {
		if ( ! [ 'oak', 'pine', 'birch' ].includes( ch.name ) || ! ch.tiles ) continue;
		for ( const t of ch.tiles ) {
			const { matrices, count } = t.hi.userData.instances;
			for ( let i = 0; i < count; i ++ ) {
				p.set( matrices[ i * 16 + 12 ], 0, matrices[ i * 16 + 14 ] );
				if ( Math.hypot( p.x - VILLAGE.x, p.z - VILLAGE.z ) > RADIUS ) continue;
				const free = ( x, z ) => hf.heightAt( x, z ) > 1.5 && ! inLake( x, z ) && natureAt( app.natureEdits, CH.grass, x, z ) > - 0.5;
				if ( ch.name === 'oak' ) for ( let k = 0, n = 3 + Math.floor( rt() * 4 ); k < n; k ++ ) {
					const a = rt() * Math.PI * 2, d = 0.8 + rt() * 3;
					const x = p.x + Math.cos( a ) * d, z = p.z + Math.sin( a ) * d;
					if ( free( x, z ) && hf.slopeAt( x, z ) < 0.7 ) place( 'litter', x, z, 0.8 + rt() * 0.5, rt, 0.9 );
				}
				if ( rt() < 0.3 ) for ( let k = 0, n = 1 + Math.floor( rt() * 3 ); k < n; k ++ ) {
					const a = rt() * Math.PI * 2, d = 2.5 + rt() * 3;
					const x = p.x + Math.cos( a ) * d, z = p.z + Math.sin( a ) * d;
					if ( free( x, z ) && meadowAt( x, z ) > 0.2 && hf.slopeAt( x, z ) < 0.6 ) place( 'foxglove', x, z, 0.85 + rt() * 0.4, rt, 0.2 );
				}
			}
		}
	}

	for ( const s of Object.values( species ) ) { s.build(); group.add( s ); }
	group.userData.counts = counts;
	app.onFrame.push( () => { for ( const s of Object.values( species ) ) s.update( app.camera ); } );
	return group;
}
