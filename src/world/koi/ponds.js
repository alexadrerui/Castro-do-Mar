// Koi ponds: every lake made with the terrain editor ("Encher": world/lakeWater.js, at its own
// level; or "Cavar" below the sea level, closed off from the sea: lakes.js) gets koi (koi.js), lotus (lotus.js) and the lake plants with the cattails of its margin (world/lakeFlora.js); the sea keeps its own fish
// (world/fish). Nothing is built, and no shader compiled, while there is no lake. Everything is
// seeded by the lake's position, so the same lake gets the same fish and leaves.
// The fish swim only while the camera is within ACTIVE m of their lake.
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../core/noise.js';
import { findLakes } from './lakes.js';
import { Koi, VARIETIES } from './koi.js';
import { buildLotus } from './lotus.js';
import { buildLakeFlora } from '../lakeFlora.js';

const ACTIVE = 160;

export class KoiPonds {
	constructor( { hf, waterLevel, edits, lakes = [] } ) {
		this.hf = hf; this.water = waterLevel;
		this.group = new THREE.Group();
		this.group.name = 'koiPonds';
		this.time = 0;
		this.paused = false; // QA: freezes the fish
		const t0 = performance.now();
		// basins dug below the sea level, and the lakes at their own level (world/lakeWater.js)
		this.lakes = [ ...findLakes( hf, waterLevel, edits ), ...lakes ];
		this.ponds = this.lakes.map( ( lake ) => this._pond( lake ) );
		console.info( `koi: ${ this.lakes.length } lake(s) in ${ Math.round( performance.now() - t0 ) } ms`, this.lakes.map( ( l ) => `${ Math.round( l.area ) } m² at ${ l.cx.toFixed( 0 ) }, ${ l.cz.toFixed( 0 ) }` ) );
	}

	_pond( lake ) {
		lake.hf = this.hf;
		const water = lake.level ?? this.water;
		const rnd = mulberry32( ( Math.round( lake.cx * 7 ) * 73856093 ) ^ ( Math.round( lake.cz * 7 ) * 19349663 ) ^ 0x6b6f69 );
		const group = new THREE.Group();
		group.name = 'pond';
		// one koi per ~25 m², 3 to 14 of them, in the original's mix of varieties
		const n = Math.max( 3, Math.min( VARIETIES.length, Math.round( lake.area / 25 ) ) );
		const start = Math.floor( rnd() * VARIETIES.length );
		const fishes = [];
		for ( let k = 0; k < n; k ++ ) {
			const f = new Koi( VARIETIES[ ( start + k ) % VARIETIES.length ], lake, rnd, water );
			fishes.push( f );
			group.add( ...f.meshes );
		}
		const lotus = buildLotus( lake, this.hf, water, rnd );
		if ( lotus ) group.add( lotus );
		// the bed's plants and the cattails of the margin (world/lakeFlora.js)
		const flora = buildLakeFlora( lake, this.hf, water, rnd );
		if ( flora ) group.add( flora );
		this.group.add( group );
		// a first pose (the bodies are empty until drawn)
		for ( const f of fishes ) { f.update( 0.016, fishes, 0, null ); f.draw( 0 ); }
		return { lake, group, fishes, lotus, flora };
	}

	update( dt, camera ) {
		if ( ! this.ponds.length || this.paused ) return;
		dt = Math.min( dt, 0.05 );
		this.time += dt;
		const c = camera.position;
		for ( const p of this.ponds ) {
			const [ x0, z0, x1, z1 ] = p.lake.box;
			const dx = Math.max( x0 - c.x, 0, c.x - x1 ), dz = Math.max( z0 - c.z, 0, c.z - z1 );
			const active = Math.hypot( dx, dz ) < ACTIVE;
			for ( const f of p.fishes ) for ( const m of f.meshes ) m.visible = active;
			if ( ! active ) continue;
			for ( const f of p.fishes ) f.update( dt, p.fishes, this.time, c );
			for ( const f of p.fishes ) f.draw( this.time );
		}
	}
}
