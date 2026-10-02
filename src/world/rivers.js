// Rivers laid in the terrain editor ("Rio"): the courses (riverCourse.js) of the world edits, each
// with a water ribbon over its channel that runs downstream. The ribbon and the flowing surface follow
// Drusniel: Gods' End's river (water/waterGeometry.js: a strip of columns across the course, each
// vertex with the flow's direction and speed; water/WaterMaterial.js: the detail advected along the
// flow in two phases; https://github.com/danielsobrado/drusniel-gods-end, MIT, Copyright (c) 2026
// Daniel Sobrado, licenses/LICENSE-Drusniel.md). Here the surface shades like our lakes (the sky's
// environment map, the depth tint) with the wave slopes of water.js carried by the current, and white
// water where it runs fast.
// app.rivers: list, add( record ), remove( river ), at( x, z ), wet( x, z ).
import * as THREE from 'three/webgpu';
import {
	Fn, attribute, texture, positionWorld, cameraPosition, time, vec2, vec3, float, mix, smoothstep, clamp,
	max, pow, dot, normalize, reflect, length, fract, abs, pmremTexture, mx_noise_float, uniform
} from 'three/tsl';
import { WATER_LEVEL } from './layout.js';
import { RiverCourse } from './riverCourse.js';
import { createWaveTexture } from './water.js';

const COLUMNS = 12;
const UNDER_BANK = 1.2; // m the ribbon runs on past the edge, under the banks (the relief hides its border)

// the surface strip: COLUMNS quads across, one row per sample; flow (dx, dz, speed) per vertex
function ribbonGeometry( course ) {
	const S = course.samples;
	const pos = [], flow = [], idx = [];
	for ( let i = 0; i < S.length; i ++ ) {
		const p = S[ i ];
		for ( let j = 0; j <= COLUMNS; j ++ ) {
			const across = ( j / COLUMNS * 2 - 1 ) * ( p.width / 2 + UNDER_BANK );
			pos.push( p.x - p.dz * across, p.y, p.z + p.dx * across );
			flow.push( p.dx, p.dz, p.flowSpeed );
			if ( i < S.length - 1 && j < COLUMNS ) {
				const a = i * ( COLUMNS + 1 ) + j, b = a + 1, c = a + COLUMNS + 1, d = c + 1;
				idx.push( a, b, c, b, d, c ); // facing up (across runs to the left of the flow)
			}
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'riverFlow', new THREE.Float32BufferAttribute( flow, 3 ) );
	g.setIndex( idx );
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

// one material for every river
let MAT = null;
function riverMaterial( heightTex, sunDir, envMap ) {
	if ( MAT ) return MAT;
	const waveTex = createWaveTexture( 256, 11 );
	const U = {
		sunDir: uniform( sunDir ), sunColor: uniform( new THREE.Color( 0xfff0d8 ) ),
		shallow: uniform( new THREE.Color( 0x3d5a3c ) ), deep: uniform( new THREE.Color( 0x1f3a3a ) ),
		envGain: uniform( 0.55 )
	};
	const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: true } );
	mat.name = 'RiverWater';
	const wp = positionWorld, V = normalize( cameraPosition.sub( wp ) );
	const hd = heightTex.userData;
	const groundH = texture( heightTex, wp.xz.sub( vec2( hd.x0, hd.z0 ) ).div( hd.cell ).add( 0.5 ).div( hd.n ) ).r;
	const depth = max( wp.y.sub( groundH ), 0.0 );
	const fl = attribute( 'riverFlow', 'vec3' );
	const dir = fl.xy, speed = fl.z;
	// two-phase flow: the detail is carried downstream for a cycle and blended out as it restarts
	const cycle = 1.6;
	const ph0 = fract( time.div( cycle ) ), ph1 = fract( time.div( cycle ).add( 0.5 ) );
	const wgt = abs( ph0.mul( 2 ).sub( 1 ) ); // 0 when phase 0 restarts, then phase 1 is fully in
	const drift = ( ph ) => dir.mul( speed ).mul( ph ).mul( cycle );
	const slopes = Fn( ( [ ph ] ) => {
		const o = drift( ph );
		const a = texture( waveTex, wp.xz.sub( o ).div( 5.5 ) ).rg.mul( 2 ).sub( 1 );
		const b = texture( waveTex, wp.xz.sub( o.mul( 1.3 ) ).div( 1.9 ).add( 0.37 ) ).rg.mul( 2 ).sub( 1 );
		return a.mul( 0.6 ).add( b.mul( 0.4 ) );
	} );
	const sl = mix( slopes( ph0 ), slopes( ph1 ), wgt );
	// rougher where it runs fast
	const strength = mix( 0.12, 0.45, smoothstep( 1.2, 4.0, speed ) );
	const N = normalize( vec3( sl.x.mul( strength ).negate(), 1.0, sl.y.mul( strength ).negate() ) );
	mat.colorNode = Fn( () => {
		const L = normalize( U.sunDir );
		const cosT = max( dot( V, N ), 0.0 );
		const fres = float( 0.02 ).add( float( 0.98 ).mul( pow( float( 1 ).sub( cosT ), 5.0 ) ) );
		const body = mix( U.shallow, U.deep, smoothstep( 0.2, 1.4, depth ) ).mul( U.sunColor ).mul( max( dot( N, L ), 0.0 ).mul( 0.35 ).add( 0.45 ) );
		const refl = pmremTexture( envMap, reflect( V.negate(), N ), float( 0.05 ) ).rgb.mul( U.envGain ).min( vec3( 1.1 ) );
		const col = mix( body, refl, clamp( fres.mul( 1.1 ).add( 0.05 ), 0, 1 ) ).toVar();
		const R = reflect( L.negate(), N );
		col.addAssign( U.sunColor.mul( pow( max( dot( R, V ), 0.0 ), 300.0 ).mul( 6.0 ) ) );
		// white water: streaks carried by the current where it runs fast, and a thin line at the banks
		const n0 = mx_noise_float( vec3( wp.xz.sub( drift( ph0 ) ).mul( vec2( 0.9, 0.9 ) ), 1.3 ) );
		const n1 = mx_noise_float( vec3( wp.xz.sub( drift( ph1 ) ).mul( vec2( 0.9, 0.9 ) ), 7.1 ) );
		const streak = smoothstep( 0.25, 0.75, mix( n0, n1, wgt ).mul( 0.5 ).add( 0.5 ) );
		const white = streak.mul( smoothstep( 2.2, 5.0, speed ) ).mul( 0.75 ).add( smoothstep( 0.0, 0.12, depth ).oneMinus().mul( 0.25 ) );
		col.assign( mix( col, vec3( 0.88, 0.92, 0.92 ), clamp( white, 0, 0.85 ) ) );
		return col;
	} )();
	mat.opacityNode = clamp( mix( 0.35, 0.95, smoothstep( 0.0, 1.2, depth ) ).add( pow( float( 1 ).sub( max( dot( V, N ), 0.0 ) ), 3.0 ).mul( 0.4 ) ), 0, 1 );
	mat.userData.uniforms = U;
	MAT = mat;
	return mat;
}

export class Rivers {
	// records: world-edits rivers ([ { points, levels } ]); h: the relief
	constructor( { hf, records = [] } ) {
		this.hf = hf;
		this.group = new THREE.Group();
		this.group.name = 'rivers';
		this.list = [];
		this.water = null;
		for ( const r of records ) this.add( r );
	}

	add( record ) {
		if ( ! Array.isArray( record?.points ) || record.points.length < 2 ) return null;
		const course = new RiverCourse( record, ( x, z ) => this.hf.heightAt( x, z ), WATER_LEVEL );
		if ( course.samples.length < 2 ) return null;
		const river = { record, course };
		this.list.push( river );
		if ( this.water ) this._surface( river );
		return river;
	}

	remove( river ) {
		this.list = this.list.filter( ( r ) => r !== river );
		if ( river.mesh ) { this.group.remove( river.mesh ); river.mesh.geometry.dispose(); }
	}

	// the river whose course passes over (x, z) within `reach` m of its water, or null
	at( x, z, reach = 0 ) {
		for ( const r of this.list ) { const p = r.course.sample( x, z ); if ( p && p.edge < reach ) return r; }
		return null;
	}

	// in the water or on its wet edge (no plants, rocks or grass there)
	wet( x, z ) { return !! this.at( x, z, 0.4 ); }

	attachWater( heightTex, sunDir, envMap ) {
		this.water = { heightTex, sunDir, envMap };
		for ( const r of this.list ) this._surface( r );
	}

	_surface( river ) {
		const { heightTex, sunDir, envMap } = this.water;
		const m = new THREE.Mesh( ribbonGeometry( river.course ), riverMaterial( heightTex, sunDir, envMap ) );
		m.name = 'river';
		m.renderOrder = 1;
		river.mesh = m;
		this.group.add( m );
	}
}
