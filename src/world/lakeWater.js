// Lakes at their own level: the points where the terrain editor's "Encher" poured water (world-edits
// lakes), each filled up to its spill height (lakeFill.js) on the current relief, with a water surface
// of its own at that level (water.js with the sky's environment map for the reflection). The idea of
// a lake surface apart from the sea is Drusniel: Gods' End's (water/waterGeometry.js: a grid at the
// lake level over the lake only, the banks hiding its edge; https://github.com/danielsobrado/drusniel-gods-end,
// MIT, Copyright (c) 2026 Daniel Sobrado, licenses/LICENSE-Drusniel.md).
// levelAt(x, z): the water level over a point (a lake's, or WATER_LEVEL), for the underwater view and
// the camera's dive.
import * as THREE from 'three/webgpu';
import { WATER_LEVEL } from './layout.js';
import { fillLake } from './lakeFill.js';
import { makeLake } from './koi/lakes.js';
import { createWater } from './water.js';

// the surface: one quad per grid cell touching the lake, grown by one cell so the water runs under
// the banks (the relief hides the edge, no seam at the shoreline)
function lakeGeometry( hf, cells, level ) {
	const n = hf.n, wet = new Set( cells ), quads = new Set();
	for ( const k of wet ) {
		const i = k % n, j = ( k - i ) / n;
		for ( let b = - 2; b <= 1; b ++ ) for ( let a = - 2; a <= 1; a ++ ) {
			const ii = i + a, jj = j + b;
			if ( ii >= 0 && jj >= 0 && ii < n - 1 && jj < n - 1 ) quads.add( jj * n + ii );
		}
	}
	const pos = [], idx = [], vid = new Map();
	const v = ( i, j ) => {
		const k = j * n + i;
		if ( ! vid.has( k ) ) { vid.set( k, pos.length / 3 ); pos.push( hf.x0 + i * hf.cell, level, hf.z0 + j * hf.cell ); }
		return vid.get( k );
	};
	for ( const q of quads ) {
		const i = q % n, j = ( q - i ) / n;
		const a = v( i, j ), b = v( i + 1, j ), c = v( i, j + 1 ), d = v( i + 1, j + 1 );
		idx.push( a, c, b, b, c, d ); // facing up
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setIndex( idx );
	g.computeBoundingSphere();
	return g;
}

export class Lakes {
	// seeds: [ { x, z } ] (world-edits lakes)
	constructor( { hf, seeds = [] } ) {
		this.hf = hf;
		this.group = new THREE.Group();
		this.group.name = 'lakes';
		this.list = [];
		this.water = null; // { heightTex, sunDir, envMap } once the sky exists (attachWater)
		for ( const s of seeds ) this.add( s, { quiet: true } );
	}

	// fills the hollow at the seed; returns the lake or { error }
	add( seed, { quiet = false } = {} ) {
		const f = fillLake( this.hf, seed.x, seed.z );
		if ( f.error ) { if ( ! quiet ) return f; console.warn( `lake at ${ seed.x }, ${ seed.z }: ${ f.error }` ); return f; }
		// the same hollow twice: one lake
		if ( this.list.some( ( l ) => l.level === f.level && l.cellSet.has( f.cells[ 0 ] ) ) ) return { error: 'repetido' };
		const lake = makeLake( this.hf, f.cells, f.level );
		lake.seed = { x: +seed.x.toFixed( 2 ), z: +seed.z.toFixed( 2 ) };
		lake.cellSet = new Set( f.cells );
		lake.cells = f.cells;
		lake.spill = f.spill;
		this.list.push( lake );
		if ( this.water ) this._surface( lake );
		return lake;
	}

	remove( lake ) {
		this.list = this.list.filter( ( l ) => l !== lake );
		if ( lake.mesh ) { this.group.remove( lake.mesh ); lake.mesh.geometry.dispose(); }
	}

	// the lake whose water covers (x, z), or null
	at( x, z ) {
		const hf = this.hf, i = Math.round( ( x - hf.x0 ) / hf.cell ), j = Math.round( ( z - hf.z0 ) / hf.cell );
		const k = j * hf.n + i;
		return this.list.find( ( l ) => l.cellSet.has( k ) ) ?? null;
	}

	levelAt( x, z ) { return this.at( x, z )?.level ?? WATER_LEVEL; }

	// under a lake's water or on its wet margin (no plants, rocks or grass there)
	wet( x, z ) {
		const l = this.at( x, z );
		return !! l && this.hf.heightAt( x, z ) < l.level + 0.3;
	}

	// the water surfaces (after the sky: the reflection reads its environment map)
	attachWater( heightTex, sunDir, envMap ) {
		this.water = { heightTex, sunDir, envMap };
		for ( const l of this.list ) this._surface( l );
	}

	_surface( lake ) {
		const { heightTex, sunDir, envMap } = this.water;
		// the same shader code for every lake: the level comes from the surface's own height
		const w = createWater( heightTex, sunDir, { geometry: lakeGeometry( this.hf, lake.cells, lake.level ), level: lake.level, envMap, waveStrength: 0.16, foam: 0.12 } );
		w.mesh.name = 'lake';
		lake.mesh = w.mesh; lake.water = w;
		this.group.add( w.mesh );
	}
}
