// Wooden bridges where a path crosses a river (pedido do usuário: whichever was laid first). Every path
// (layout.js PATHS as edited, or the "Caminhos" tab's working list) is walked along its own curve
// (heightfield.js pathCurve) every half metre; where it enters a river's water (riverCourse.js sample:
// edge < 0) a crossing runs on until dry ground on both sides. Over it: two stringers, a deck of
// planks laid across (each a little askew), pairs of piles in the water with a cap beam, and a railing
// on both sides. The deck runs from bank to bank, at least DECK_CLEAR over the water.
// Built with the houses' wood materials (world/materials.js wood, woodPost: no new shader) and their
// cheap stand-ins for the reflection and the sun's shadow (core/proxies.js). Rebuilt in the editor as
// the rivers or the paths change (app.rebuildBridges).
import * as THREE from 'three/webgpu';
import { GeoBuilder, box, post, beam } from '../core/builder.js';
import { pathCurve } from './heightfield.js';
import { mulberry32 } from '../core/noise.js';
import { addProxies } from '../core/proxies.js';

const STEP = 0.5;          // m: the walk along a path
const DECK_CLEAR = 0.8;    // m over the water at least
const BANK = 1.2;          // m of dry bank past the water's edge before the deck lands
const MAX_SPAN = 60;       // m: longer crossings are left without a bridge
// a crossing: the path enters the water and leaves it on the other bank, across the current (> 35°)
const PLANK = 0.3, PLANK_GAP = 0.04, PILE_EVERY = 3.2, RAIL_EVERY = 1.6;

// the path's curve resampled every STEP m: [ { x, z } ]
function walk( pts ) {
	const c = pathCurve( pts ), out = [ { x: c[ 0 ][ 0 ], z: c[ 0 ][ 1 ] } ];
	let carry = 0;
	for ( let i = 1; i < c.length; i ++ ) {
		const ax = c[ i - 1 ][ 0 ], az = c[ i - 1 ][ 1 ], dx = c[ i ][ 0 ] - ax, dz = c[ i ][ 1 ] - az, l = Math.hypot( dx, dz );
		let t = STEP - carry;
		while ( t <= l ) { out.push( { x: ax + dx * t / l, z: az + dz * t / l } ); t += STEP; }
		carry = l - ( t - STEP );
	}
	return out;
}

// The crossings of the paths and the rivers: [ { a, b (the deck's ends, x z), w (deck width), level, ha, hb } ]
export function findCrossings( paths, rivers, hf ) {
	const out = [];
	for ( const p of paths ) {
		if ( ! p.pts || p.pts.length < 2 ) continue;
		const S = walk( p.pts );
		for ( const r of rivers ) {
			const wet = S.map( ( s ) => { const q = r.course.sample( s.x, s.z ); return q && q.edge < 0 ? q.y : null; } );
			for ( let i = 0; i < S.length; i ++ ) {
				if ( wet[ i ] === null ) continue;
				let j = i, level = wet[ i ];
				while ( j + 1 < S.length && wet[ j + 1 ] !== null ) { j ++; level = Math.max( level, wet[ j ] ); }
				// out to dry ground on both sides
				const dry = ( k ) => { const q = r.course.sample( S[ k ].x, S[ k ].z ); return ( ! q || q.edge > BANK ) && hf.heightAt( S[ k ].x, S[ k ].z ) > level + 0.25; };
				let a = i, b = j;
				while ( a > 0 && ! dry( a ) && i - a < 30 ) a --;
				while ( b < S.length - 1 && ! dry( b ) && b - j < 30 ) b ++;
				const len = Math.hypot( S[ b ].x - S[ a ].x, S[ b ].z - S[ a ].z );
				// it must cross the river, not run along it (a lane beside the water dipping into it is
				// not a crossing): the angle between the path and the current over 35 degrees
				const m = S[ Math.round( ( i + j ) / 2 ) ], q = r.course.sample( m.x, m.z );
				const across = q && len > 0 ? Math.abs( ( ( S[ b ].x - S[ a ].x ) * q.dx + ( S[ b ].z - S[ a ].z ) * q.dz ) / len ) < Math.cos( 35 * Math.PI / 180 ) : false;
				if ( len > 1 && len <= MAX_SPAN && across ) {
					out.push( { a: S[ a ], b: S[ b ], w: Math.max( 1.8, p.w ) + 0.3, level,
						ha: hf.heightAt( S[ a ].x, S[ a ].z ), hb: hf.heightAt( S[ b ].x, S[ b ].z ) } );
				}
				i = b;
			}
		}
	}
	return out;
}

// One bridge into the builder (world space)
function bridge( B, c, hf, rnd ) {
	const ax = c.a.x, az = c.a.z, dx = c.b.x - ax, dz = c.b.z - az, L = Math.hypot( dx, dz );
	const ux = dx / L, uz = dz / L, vx = - uz, vz = ux; // along, across
	const yaw = Math.atan2( - uz, ux );                 // a box's x along the bridge
	const hw = c.w / 2;
	const floor = c.level + DECK_CLEAR;
	// the deck's top at t (0..1): from bank to bank, lifted over the water
	const deck = ( t ) => Math.max( c.ha + ( c.hb - c.ha ) * t + 0.12, floor + Math.sin( Math.PI * t ) * 0.35 );
	const at = ( t, side ) => new THREE.Vector3( ax + dx * t + vx * side, deck( t ), az + dz * t + vz * side );
	const M = ( p, ry = yaw, rx = 0, rz = 0 ) => new THREE.Matrix4().compose( p, new THREE.Quaternion().setFromEuler( new THREE.Euler( rx, ry, rz, 'YXZ' ) ), new THREE.Vector3( 1, 1, 1 ) );
	// stringers under the deck, in short straight runs following its line
	const runs = Math.max( 2, Math.ceil( L / 1.6 ) );
	for ( const side of [ - hw + 0.2, hw - 0.2 ] ) for ( let k = 0; k < runs; k ++ ) {
		const p0 = at( k / runs, side ), p1 = at( ( k + 1 ) / runs, side );
		p0.y -= 0.2; p1.y -= 0.2;
		B.add( 'woodPost', beam( p0, p1, 0.12, 6 ) );
	}
	// planks across, each a little askew and of its own height
	const n = Math.floor( L / ( PLANK + PLANK_GAP ) );
	for ( let k = 0; k <= n; k ++ ) {
		const t = ( k + 0.5 ) / ( n + 1 ), p = at( t, ( rnd() - 0.5 ) * 0.08 );
		p.y -= 0.07 + rnd() * 0.02;
		B.add( 'wood', box( PLANK * ( 0.9 + rnd() * 0.15 ), 0.07, c.w * ( 0.96 + rnd() * 0.06 ) ), M( p, yaw + ( rnd() - 0.5 ) * 0.05, 0, ( rnd() - 0.5 ) * 0.03 ) );
	}
	// pairs of piles in the water, from the bed up under the deck, with a cap beam across
	const piles = Math.max( 1, Math.round( L / PILE_EVERY ) - 1 );
	for ( let k = 1; k <= piles; k ++ ) {
		const t = k / ( piles + 1 ), top = deck( t ) - 0.3;
		const ends = [];
		for ( const side of [ - hw + 0.2, hw - 0.2 ] ) {
			const x = ax + dx * t + vx * side, z = az + dz * t + vz * side, bed = Math.min( hf.heightAt( x, z ), c.level ) - 0.4;
			if ( top - bed < 0.2 ) continue;
			B.add( 'woodPost', post( 0.13, top - bed, 7 ), M( new THREE.Vector3( x, bed, z ), rnd() * 6 ) );
			ends.push( new THREE.Vector3( x, top, z ) );
		}
		if ( ends.length === 2 ) {
			const e0 = ends[ 0 ].clone().addScaledVector( new THREE.Vector3( vx, 0, vz ), - 0.25 ), e1 = ends[ 1 ].clone().addScaledVector( new THREE.Vector3( vx, 0, vz ), 0.25 );
			B.add( 'woodPost', beam( e0, e1, 0.1, 6 ) );
		}
	}
	// the railing: posts on both sides, a top rail and a mid rail
	const rails = Math.max( 2, Math.round( L / RAIL_EVERY ) );
	for ( const side of [ - hw + 0.06, hw - 0.06 ] ) {
		let prev = null;
		for ( let k = 0; k <= rails; k ++ ) {
			const t = k / rails, p = at( t, side );
			B.add( 'woodPost', post( 0.055, 1.05, 6 ), M( new THREE.Vector3( p.x, p.y - 0.1, p.z ), rnd() * 6 ) );
			const top = new THREE.Vector3( p.x, p.y + 0.92, p.z ), mid = new THREE.Vector3( p.x, p.y + 0.48, p.z );
			if ( prev ) { B.add( 'woodPost', beam( prev.top, top, 0.045, 5 ) ); B.add( 'woodPost', beam( prev.mid, mid, 0.035, 5 ) ); }
			prev = { top, mid };
		}
	}
}

export class Bridges {

	// app: hf, scene, buildingMaterials (wood, woodPost)
	constructor( app ) {
		this.app = app;
		this.group = new THREE.Group();
		this.group.name = 'bridges';
		app.scene.add( this.group );
		this.count = 0;
		this.crossings = [];
	}

	rebuild( paths, rivers ) {
		const app = this.app, hf = app.hf, mats = app.buildingMaterials;
		for ( const o of [ ...this.group.children ] ) { this.group.remove( o ); o.geometry?.dispose(); }
		this.crossings = rivers?.length ? findCrossings( paths, rivers, hf ) : [];
		this.count = this.crossings.length;
		if ( ! this.count || ! mats ) return 0;
		const B = new GeoBuilder();
		// each bridge on its own sequence (from where it stands): one changing leaves the others as they were
		for ( const c of this.crossings ) bridge( B, c, hf, mulberry32( ( Math.round( c.a.x * 7 ) * 73856093 ) ^ ( Math.round( c.a.z * 7 ) * 19349663 ) ) );
		for ( const [ k, g ] of B.build() ) {
			const m = new THREE.Mesh( g, mats[ k ] );
			m.name = 'bridge-' + k;
			m.castShadow = true; m.receiveShadow = true;
			m.layers.enable( 2 );
			this.group.add( m );
		}
		addProxies( this.group );
		return this.count;
	}

}
