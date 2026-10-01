// Gulls that perch and loaf, terns that hover and dive. Adapted from Tidewater
// (https://github.com/dgreenheck/tidewater, src/world/wildlife/Birds.js, three.js version at
// d32799f). MIT License, Copyright (c) 2026 DRG Software Solutions LLC.
// Changes: yellow-legged gulls and sandwich terns only (no pelicans or frigatebirds); perches
// found in this world (the ridges of the roofs, the top of the castro's wall, the shore boulders)
// instead of the pier, the huts and the boat; the terns' patrol lanes are found over the lake;
// the viewer is the free camera; a fixed south-west wind; no splash (no spray system here).
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../core/noise.js';
import { BIRD } from './shapes.js';
import { Flyer } from './flight.js';
import { setHead, groundPose, standHeight, storePrevious, resetPrevious, setWings } from './pose.js';
import { TAU, clamp, lerp, smooth, angleDiff, approach } from './kit.js';
import { BUILDINGS, FORT, VILLAGE, WATER_LEVEL } from '../layout.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// flight initiation distances (m) by species when the camera comes up to them
const FLUSH = { [ BIRD.GULL ]: 7, [ BIRD.TERN ]: 9 };
// template -> real size: laughing gull (1.03 m span) -> yellow-legged gull (~1.4 m);
// royal tern (1.3 m) -> sandwich tern (~0.95 m)
const SIZE = { [ BIRD.GULL ]: 1.36, [ BIRD.TERN ]: 0.75 };

export class Flock {

	// app: hf (heightAt), layers.buildings / fort / rocks (the perches are found on them)
	constructor( app, { gulls = 16, terns = 5, seed = 11 } = {} ) {
		this.paused = false;
		this.hf = app.hf;
		this.rng = mulberry32( seed );
		this.time = 0;
		this.agents = [];
		// a south-west breeze off the Atlantic (m/s, blowing towards +x -z), as the grass (grass.js)
		this.wind = new THREE.Vector2( 0.62, - 0.78 ).multiplyScalar( 4 );
		this.perches = this.buildPerches( app );
		this.lanes = this.buildLanes();

		const rng = this.rng;
		const add = ( kind, species, init ) => {
			const f = new Flyer( species, rng(), mulberry32( Math.floor( rng() * 1e9 ) ) );
			f.P.scale *= SIZE[ species ];
			const a = { kind, f, state: 'fly', t: 0, perch: null, id: this.agents.length, hy: 0, hp: 0, hyT: 0, hpT: 0, headT: 0, visible: true };
			init( a );
			this.agents.push( a );
			return a;
		};

		// ---- gulls: on the roofs and the wall, a loafing group on the shore rocks, a few aloft
		const high = this.perches.filter( ( p ) => p.kind !== 'rock' );
		const rocks = this.perches.filter( ( p ) => p.kind === 'rock' );
		const nHigh = Math.min( high.length, Math.round( gulls * 0.45 ) ), nRock = Math.min( rocks.length, Math.round( gulls * 0.3 ) );
		for ( let i = 0; i < nHigh; i ++ ) add( 'gull', BIRD.GULL, ( a ) => this.settle( a, high[ Math.floor( i * high.length / nHigh ) ] ) );
		for ( let i = 0; i < nRock; i ++ ) add( 'gull', BIRD.GULL, ( a ) => this.settle( a, rocks[ i ] ) );
		for ( let i = nHigh + nRock; i < gulls; i ++ ) add( 'gull', BIRD.GULL, ( a ) => {
			const g = this.randomGoal();
			this.startRoam( a, g.x, g.y, g.z );
		} );

		// ---- terns: back and forth over the water, hovering and diving
		for ( let i = 0; i < terns && this.lanes.length; i ++ ) add( 'tern', BIRD.TERN, ( a ) => {
			a.lane = this.lanes[ i % this.lanes.length ];
			const s = rng();
			a.f.place( lerp( a.lane.x0, a.lane.x1, s ), a.lane.y, lerp( a.lane.z0, a.lane.z1, s ), Math.atan2( a.lane.x1 - a.lane.x0, a.lane.z1 - a.lane.z0 ) );
			a.dir = 1;
			a.state = 'patrol';
			a.t = 4 + rng() * 8;
		} );

		for ( const a of this.agents ) a.f.P.fresh = true;
	}

	// ------------------------------------------------------------------ perches

	buildPerches( app ) {
		const P = [];
		const rng = this.rng;
		const add = ( x, y, z, kind ) => P.push( { x, y, z, kind, bird: null, yawJitter: ( rng() - 0.5 ) * 0.8 } );
		const ray = new THREE.Raycaster();
		ray.layers.enableAll();
		const down = new THREE.Vector3( 0, - 1, 0 );
		// highest surface of `obj` under (x, z) (null if none)
		const top = ( obj, x, z ) => {
			ray.set( _v.set( x, 400, z ), down );
			const h = ray.intersectObject( obj, true )[ 0 ];
			return h ? h.point.y : null;
		};

		// ridges of the roofs: the apex of the round houses, three spots along each long house's
		// ridge (the ridge runs along whichever axis is higher)
		const houses = app.layers.buildings.object;
		for ( const b of BUILDINGS ) {
			if ( b.type === 'round' ) {
				const y = top( houses, b.x, b.z );
				if ( y !== null ) add( b.x, y - 0.1, b.z, 'roof' );
			} else if ( b.type === 'long' ) {
				// with the turn and the size of the object editor (world/worldEdits.js)
				const rot = b.rot + ( b.yaw || 0 ), bl = b.l * ( b.scale || 1 ), bw = b.w * ( b.scale || 1 );
				const c = Math.cos( rot ), s = Math.sin( rot );
				const line = ( ax, az, L ) => [ - 0.3, 0, 0.3 ].map( ( t ) => [ b.x + ax * t * L, b.z + az * t * L ] );
				const A = line( s, c, bl ), B = line( c, - s, bw );
				const ya = A.map( ( [ x, z ] ) => top( houses, x, z ) ), yb = B.map( ( [ x, z ] ) => top( houses, x, z ) );
				const mean = ( ys ) => ys.reduce( ( m, y ) => m + ( y ?? - 1e3 ), 0 ) / ys.length;
				const [ pts, ys ] = mean( ya ) >= mean( yb ) ? [ A, ya ] : [ line( c, - s, bl ), line( c, - s, bl ).map( ( [ x, z ] ) => top( houses, x, z ) ) ];
				pts.forEach( ( [ x, z ], k ) => { if ( ys[ k ] !== null && k !== 1 ) add( x, ys[ k ] - 0.1, z, 'roof' ); } );
			}
		}

		// the top of the castro's ring wall (away from the gate)
		const fort = app.layers.fort.object;
		for ( let k = 0; k < 14; k ++ ) {
			const a = k / 14 * TAU;
			if ( Math.abs( angleDiff( a, FORT.gateAngle ) ) < 0.5 ) continue;
			let best = null;
			for ( const r of [ FORT.radius - 1.2, FORT.radius - 0.6, FORT.radius ] ) {
				const x = FORT.x + Math.cos( a ) * r, z = FORT.z + Math.sin( a ) * r;
				const y = top( fort, x, z );
				if ( y !== null && ( ! best || y > best[ 1 ] ) ) best = [ x, y, z ];
			}
			if ( best && best[ 1 ] > this.hf.heightAt( best[ 0 ], best[ 2 ] ) + 1.5 ) add( best[ 0 ], best[ 1 ] - 0.05, best[ 2 ], 'wall' );
		}

		// boulders on the shore near the village (the loafing spots)
		const rocks = app.layers.rocks.object.children.filter( ( c ) => /^shore/.test( c.name ) );
		const M = new THREE.Matrix4(), p = new THREE.Vector3();
		const found = [];
		for ( const chunk of rocks ) for ( const t of chunk.tiles ) {
			const { matrices, count } = t.hi.userData.instances;
			for ( let i = 0; i < count; i ++ ) {
				M.fromArray( matrices, i * 16 );
				p.setFromMatrixPosition( M );
				if ( p.y < WATER_LEVEL + 0.3 || p.y > WATER_LEVEL + 6 ) continue;
				if ( Math.hypot( p.x - VILLAGE.x, p.z - VILLAGE.z ) > 320 ) continue;
				found.push( { x: p.x, z: p.z, tile: t.hi, d: Math.hypot( p.x - VILLAGE.x, p.z - VILLAGE.z ) } );
			}
		}
		found.sort( ( a, b ) => a.d - b.d );
		const used = [];
		for ( const r of found ) {
			if ( used.length >= 12 ) break;
			if ( used.some( ( u ) => Math.hypot( u[ 0 ] - r.x, u[ 1 ] - r.z ) < 5 ) ) continue;
			const y = top( r.tile, r.x, r.z );
			if ( y === null ) continue;
			used.push( [ r.x, r.z ] );
			add( r.x, y - 0.05, r.z, 'rock' );
		}
		return P;
	}

	// terns' patrol lanes: straight runs over open water off the village shore
	buildLanes() {
		const lanes = [];
		const rng = this.rng;
		const water = ( x, z ) => this.hf.heightAt( x, z ) < WATER_LEVEL - 1.5;
		for ( let k = 0; k < 400 && lanes.length < 6; k ++ ) {
			const a = rng() * TAU, r = 90 + rng() * 220;
			const cx = VILLAGE.x + Math.cos( a ) * r, cz = VILLAGE.z + Math.sin( a ) * r;
			if ( ! water( cx, cz ) ) continue;
			// along the shore: perpendicular to the direction back to the village
			const dx = - Math.sin( a ), dz = Math.cos( a );
			let L = 90;
			while ( L > 30 && ! ( water( cx + dx * L, cz + dz * L ) && water( cx - dx * L, cz - dz * L ) && water( cx, cz ) ) ) L -= 10;
			if ( L <= 30 ) continue;
			if ( lanes.some( ( l ) => Math.hypot( l.cx - cx, l.cz - cz ) < 60 ) ) continue;
			lanes.push( { cx, cz, x0: cx - dx * L, z0: cz - dz * L, x1: cx + dx * L, z1: cz + dz * L, y: WATER_LEVEL + 8 + rng() * 4 } );
		}
		return lanes;
	}

	// ------------------------------------------------------------------ state changes

	settle( a, p ) {
		if ( ! p ) {
			const g = this.randomGoal();
			this.startRoam( a, g.x, g.y, g.z );
			return;
		}
		a.state = 'perched';
		a.perch = p;
		p.bird = a;
		a.t = 20 + this.rng() * 120; // until it gets restless
		a.fold = 1;
		a.perchYaw = this.windYaw() + p.yawJitter;
		a.shuffle = 0;
		a.stretch = 0;
		a.f.P.fresh = true;
	}

	unperch( a ) {
		if ( a.perch ) a.perch.bird = null;
		a.perch = null;
	}

	startRoam( a, x, y, z ) {
		a.state = 'fly';
		a.goal = { x, y, z };
		a.t = 10 + this.rng() * 20;
		if ( a.f.P.fresh ) a.f.place( x, y, z, this.rng() * TAU );
	}

	// flee from (ux, uz): open the wings, jump into the wind / away and climb out
	takeOff( a, ux, uz ) {
		const f = a.f;
		const P = f.P;
		const away = Math.atan2( ux, uz );
		const into = this.windYaw();
		// between straight away and into the wind (birds take off into the wind when they can)
		const yaw = away + clamp( angleDiff( into, away ), - 0.9, 0.9 );
		f.x = P.pos[ 0 ]; f.y = P.pos[ 1 ]; f.z = P.pos[ 2 ];
		f.yaw = yaw;
		f.speed = f.cfg.minSpeed * 0.55;
		f.vy = 1.6;
		f.bank = 0;
		f.pitch = 0.5;
		f.flap = 1;
		f.phase = 0.2;
		f.fold = a.fold;
		f.legs = 1;
		a.state = 'takeoff';
		a.t = 0;
		this.unperch( a );
	}

	windYaw() {
		// facing into the wind
		return Math.atan2( - this.wind.x, - this.wind.y );
	}

	// ------------------------------------------------------------------ update

	// viewer: { x, y, z, speed } (the camera), batch: BirdBatch, camera: for the draw distance
	update( dt, viewer, batch, camera ) {
		if ( this.paused ) dt = 0; // QA (tools/birds.mjs): frozen poses, still drawn
		this.time += dt;
		this.lastViewer = viewer;
		for ( const a of this.agents ) {
			if ( a.kind === 'gull' ) this.updateGull( a, dt, viewer );
			else this.updateTern( a, dt );
		}
		// draw: everything within its draw distance, shrinking away the last stretch
		const cp = camera.position;
		for ( const a of this.agents ) {
			if ( ! a.visible ) continue;
			const P = a.f.P;
			const d = Math.hypot( P.pos[ 0 ] - cp.x, P.pos[ 1 ] - cp.y, P.pos[ 2 ] - cp.z );
			const far = 550;
			if ( d > far ) continue;
			const k = a.f.scale0 || ( a.f.scale0 = P.scale );
			P.scale = k * smooth( far, far * 0.8, d );
			batch.write( P );
			P.scale = k;
		}
	}

	// threat from the viewer: distance and closing speed
	threat( viewer, x, y, z ) {
		if ( ! viewer ) return 1e9;
		const d = Math.hypot( viewer.x - x, ( viewer.y - y ) * 0.7, viewer.z - z );
		return d - viewer.speed * 0.6;
	}

	// head saccades while standing: quick turns toward something new every so often
	idleHead( a, dt, pitch0 = 0, range = 1.1 ) {
		a.headT -= dt;
		if ( a.headT <= 0 ) {
			a.headT = 0.4 + this.rng() * 2.2;
			a.hyT = ( this.rng() - 0.5 ) * 2 * range;
			a.hpT = pitch0 + ( this.rng() - 0.5 ) * 0.3;
		}
		a.hy += ( a.hyT - a.hy ) * approach( 14, dt );
		a.hp += ( a.hpT - a.hp ) * approach( 14, dt );
	}

	// standing on a perch: idle head, the odd shuffle, a wing stretch now and then
	perchedPose( a, dt ) {
		const f = a.f, P = f.P, sp = f.sp;
		if ( P.fresh ) resetPrevious( P );
		else storePrevious( P );
		const p = a.perch;
		// turn to face into the wind, in a few shuffling steps
		const want = this.windYaw() + p.yawJitter;
		const err = angleDiff( want, a.perchYaw );
		a.shuffle = Math.max( 0, a.shuffle - dt );
		if ( Math.abs( err ) > 0.5 && a.shuffle <= 0 ) a.shuffle = 0.6;
		let phase = 0, stride = 0;
		if ( a.shuffle > 0 ) {
			a.perchYaw += err * approach( 5, dt );
			phase = a.shuffle * 18;
			stride = sp.legs.toe * 0.8;
		}
		// the legs are posed in the template's units (the shader scales the body): lift the body by
		// the scaled standing height
		const h = standHeight( sp );
		groundPose( P, p.x, p.y, p.z, a.perchYaw, 0.24, h, phase, stride, sp.legs.toe * 0.3 );
		P.pos[ 1 ] = p.y + h * P.scale;
		this.idleHead( a, dt, - 0.12, 1.2 );
		setHead( P, a.hy, a.hp, 0, 0.03 * sp.length, 0.01 * sp.length );
		// wings: folded; stretched up for a moment now and then (and just after landing)
		a.stretch = Math.max( 0, a.stretch - dt );
		if ( a.stretch <= 0 && this.rng() < dt / 90 ) a.stretch = 1.6;
		const s = Math.sin( Math.PI * clamp( a.stretch / 1.6, 0, 1 ) );
		a.fold = Math.min( 1, a.fold + dt * 2.5 );
		P.fold = a.fold * ( 1 - s * 0.85 );
		setWings( P, 0.2 + s * 0.9, - 0.2 * s, 0.1, 0.5 - s * 0.3, 0.6 - s * 0.4, 0.1 );
		P.tailPitch = 0.12;
		P.tailSpread = 0.9;
		f.x = P.pos[ 0 ]; f.y = P.pos[ 1 ]; f.z = P.pos[ 2 ];
	}

	// scripted take-off: wings open, a hop, hard flapping; then normal flight
	takeoffStep( a, dt, then ) {
		const f = a.f;
		a.t += dt;
		f.fold = Math.max( 0, 1 - a.t / 0.18 );
		f.legs = Math.max( 0, 1 - a.t / 0.7 );
		f.extraPitch = 0.35 * Math.max( 0, 1 - a.t / 0.9 );
		const fx = Math.sin( f.yaw ), fz = Math.cos( f.yaw );
		f.steer( dt, f.x + fx * 30, f.y + 6, f.z + fz * 30, f.cfg.speed, 2, 0.2, this.wind );
		f.animate( dt );
		if ( a.t > 1.1 ) {
			f.extraPitch = 0;
			f.legs = 0;
			f.fold = 0;
			then();
		}
	}

	// landing on a perch along a curve from the current flight state
	beginLanding( a, p ) {
		const f = a.f;
		const h = standHeight( f.sp ) * f.P.scale;
		const dist = Math.hypot( p.x - f.x, p.y + h - f.y, p.z - f.z );
		const T = clamp( dist / Math.max( 4, f.speed ) * 1.7, 1.2, 4 );
		a.land = { x0: f.x, y0: f.y, z0: f.z, vx: f.vx, vy: f.vy, vz: f.vz, T, h };
		a.state = 'land';
		a.t = 0;
		a.perch = p;
		p.bird = a;
	}

	landStep( a, dt ) {
		const f = a.f, L = a.land;
		a.t += dt;
		const s = Math.min( 1, a.t / L.T );
		const q = a.perch;
		const x1 = q.x, y1 = q.y + L.h, z1 = q.z;
		// cubic Hermite: arrive with a small velocity along the approach direction
		const h00 = 2 * s * s * s - 3 * s * s + 1, h10 = s * s * s - 2 * s * s + s, h01 = - 2 * s * s * s + 3 * s * s, h11 = s * s * s - s * s;
		const d00 = 6 * s * s - 6 * s, d10 = 3 * s * s - 4 * s + 1, d01 = - 6 * s * s + 6 * s, d11 = 3 * s * s - 2 * s;
		const T = L.T;
		const ex = ( x1 - L.x0 ) * 0.05, ez = ( z1 - L.z0 ) * 0.05;
		f.x = h00 * L.x0 + h10 * T * L.vx + h01 * x1 + h11 * T * ex;
		f.y = h00 * L.y0 + h10 * T * L.vy + h01 * y1 + h11 * T * 0.2;
		f.z = h00 * L.z0 + h10 * T * L.vz + h01 * z1 + h11 * T * ez;
		const vx = ( d00 * L.x0 + d10 * T * L.vx + d01 * x1 + d11 * T * ex ) / T;
		const vy = ( d00 * L.y0 + d10 * T * L.vy + d01 * y1 + d11 * T * 0.2 ) / T;
		const vz = ( d00 * L.z0 + d10 * T * L.vz + d01 * z1 + d11 * T * ez ) / T;
		const hs = Math.hypot( vx, vz );
		if ( hs > 0.3 ) {
			const yaw = Math.atan2( vx, vz );
			const dy = angleDiff( yaw, f.yaw );
			f.bank += ( clamp( dy / Math.max( dt, 1e-3 ) * hs / 9.81, - 0.6, 0.6 ) - f.bank ) * approach( 6, dt );
			f.yaw = yaw;
		}
		f.vx = vx; f.vy = vy; f.vz = vz;
		f.speed = Math.hypot( hs, vy );
		f.gamma = Math.atan2( vy, Math.max( hs, 0.1 ) );
		// flare: braking pose, legs forward, quick shallow beats in the last second
		f.flare = smooth( 0.45, 0.9, s );
		f.legs = smooth( 0.3, 0.75, s );
		f.flapWant = s > 0.55 ? 0.6 : 0.15;
		f.animate( dt );
		if ( s >= 1 ) {
			a.state = 'perched';
			a.t = 25 + this.rng() * 120;
			a.fold = 0;
			a.stretch = 0.8; // wings held up a moment after touching down
			a.perchYaw = f.yaw;
			f.flare = 0;
			f.legs = 0;
			q.bird = a;
		}
	}

	// ------------------------------------------------------------------ gulls

	updateGull( a, dt, viewer ) {
		const f = a.f;
		switch ( a.state ) {
			case 'perched': {
				this.perchedPose( a, dt );
				const P = f.P;
				const th = this.threat( viewer, P.pos[ 0 ], P.pos[ 1 ], P.pos[ 2 ] );
				const flush = FLUSH[ BIRD.GULL ] * ( a.perch.kind === 'rock' ? 1.6 : 1 );
				a.t -= dt;
				if ( th < flush ) {
					a.alarm = ( a.alarm || 0 ) + dt;
					if ( a.alarm > 0.15 + ( a.id % 5 ) * 0.07 ) this.takeOff( a, P.pos[ 0 ] - viewer.x, P.pos[ 2 ] - viewer.z );
				} else if ( a.t <= 0 ) {
					this.takeOff( a, Math.sin( a.perchYaw ), Math.cos( a.perchYaw ) );
				} else a.alarm = 0;
				break;
			}
			case 'takeoff':
				this.takeoffStep( a, dt, () => {
					a.state = 'fly';
					a.t = 12 + this.rng() * 25;
					a.goal = { x: f.x + Math.sin( f.yaw ) * 60, y: f.y + 8 + this.rng() * 10, z: f.z + Math.cos( f.yaw ) * 60 };
				} );
				break;
			case 'fly': {
				a.t -= dt;
				const g = a.goal;
				const d = Math.hypot( g.x - f.x, g.z - f.z );
				if ( d < 12 || a.t <= 0 ) {
					// next: another waypoint, a spell of circling on an updraft, or a perch
					const r = this.rng();
					if ( r < 0.3 ) {
						const p = this.pickPerch( a, viewer );
						if ( p ) {
							a.state = 'approach';
							a.perch = p;
							p.bird = a;
							break;
						}
					}
					if ( r < 0.6 ) {
						a.state = 'circle';
						a.circle = { x: f.x + ( this.rng() - 0.5 ) * 30, z: f.z + ( this.rng() - 0.5 ) * 30, r: 14 + this.rng() * 14, dir: this.rng() < 0.5 ? - 1 : 1, y: f.y };
						a.t = 10 + this.rng() * 20;
						break;
					}
					this.newGullGoal( a );
				}
				this.flyTo( a, dt, g.x, g.y, g.z, f.cfg.speed, 1 );
				break;
			}
			case 'circle': {
				// soaring in circles on an updraft, wings held still, drifting and gaining height
				a.t -= dt;
				const c = a.circle;
				c.x += this.wind.x * 0.25 * dt;
				c.z += this.wind.y * 0.25 * dt;
				c.y = Math.min( c.y + dt * 0.5, this.hf.heightAt( c.x, c.z ) + 45 );
				const ang = Math.atan2( f.z - c.z, f.x - c.x ) + c.dir * 0.6;
				this.flyTo( a, dt, c.x + Math.cos( ang ) * c.r, c.y, c.z + Math.sin( ang ) * c.r, f.cfg.speed * 0.9, 0, 1.6 );
				if ( a.t <= 0 ) {
					a.state = 'fly';
					a.t = 15 + this.rng() * 20;
					this.newGullGoal( a );
				}
				break;
			}
			case 'approach': {
				// come in from downwind of the perch, a few metres above it
				const q = a.perch;
				const wx = - this.wind.x, wz = - this.wind.y;
				const wl = Math.hypot( wx, wz ) || 1;
				const ax = q.x - wx / wl * 16, az = q.z - wz / wl * 16;
				const d = Math.hypot( ax - f.x, az - f.z );
				if ( this.threat( viewer, q.x, q.y, q.z ) < FLUSH[ BIRD.GULL ] * 2.5 ) {
					this.unperch( a );
					a.state = 'fly';
					this.newGullGoal( a );
					break;
				}
				if ( d < 5 ) this.beginLanding( a, q );
				else this.flyTo( a, dt, ax, q.y + 2.5, az, f.cfg.speed * 0.85, 1, 1, q.y + 1.5 );
				break;
			}
			case 'land':
				this.landStep( a, dt );
				break;
		}
	}

	// somewhere over the village, the shore or the lake, now and then near the camera
	randomGoal( viewer = null ) {
		const r = this.rng;
		if ( viewer && r() < 0.35 ) return { x: viewer.x + ( r() - 0.5 ) * 70, y: this.hf.heightAt( viewer.x, viewer.z ) + 7 + r() * 12, z: viewer.z + ( r() - 0.5 ) * 70 };
		const a = r() * TAU, d = 30 + r() * 260;
		const x = VILLAGE.x + Math.cos( a ) * d, z = VILLAGE.z + Math.sin( a ) * d;
		return { x, y: Math.max( this.hf.heightAt( x, z ), WATER_LEVEL ) + 8 + r() * 28, z };
	}

	newGullGoal( a ) {
		a.goal = this.randomGoal( this.lastViewer );
		a.t = 20 + this.rng() * 20;
	}

	pickPerch( a, viewer ) {
		let best = null, bestS = - Infinity;
		for ( const p of this.perches ) {
			if ( p.bird ) continue;
			if ( this.threat( viewer, p.x, p.y, p.z ) < 18 ) continue;
			const d = Math.hypot( p.x - a.f.x, p.z - a.f.z );
			const s = - d * 0.01 + this.rng() * 2;
			if ( s > bestS ) { bestS = s; best = p; }
		}
		return best;
	}

	// fly toward a point, keeping clear of the ground (minY overrides the clearance, for approaches)
	flyTo( a, dt, x, y, z, speed, power, turn = 1, minY = null ) {
		const f = a.f;
		const lx = f.x + f.vx * 2, lz = f.z + f.vz * 2;
		const ground = Math.max( this.hf.heightAt( lx, lz ), this.hf.heightAt( f.x, f.z ), WATER_LEVEL );
		const floor = minY ?? ground + ( ground > WATER_LEVEL + 0.5 ? 6 : 2 );
		f.steer( dt, x, Math.max( y, floor ), z, speed, power, turn, this.wind );
		if ( f.y < floor - 1.5 ) f.y += ( floor - 1.5 - f.y ) * approach( 3, dt );
		f.animate( dt );
	}

	// ------------------------------------------------------------------ terns

	updateTern( a, dt ) {
		const f = a.f, L = a.lane;
		const wh = WATER_LEVEL;
		switch ( a.state ) {
			case 'patrol': {
				// back and forth along the lane, looking down for fish
				a.t -= dt;
				const tx = a.dir > 0 ? L.x1 : L.x0, tz = a.dir > 0 ? L.z1 : L.z0;
				if ( Math.hypot( tx - f.x, tz - f.z ) < 15 ) a.dir = - a.dir;
				f.headPitch += ( 0.7 - f.headPitch ) * approach( 3, dt );
				this.flyTo( a, dt, tx, L.y + Math.sin( this.time * 0.4 + a.id ) * 1.5, tz, f.cfg.speed, 1, 0.8 );
				if ( a.t <= 0 ) {
					a.state = 'hover';
					a.t = 1.5 + this.rng() * 2.5;
				}
				break;
			}
			case 'hover': {
				// kiting into the wind: air speed ~ wind speed, fast shallow beats, tail fanned
				a.t -= dt;
				f.hover += ( 1 - f.hover ) * approach( 4, dt );
				const into = this.windYaw();
				const ws = Math.max( this.wind.length(), 3 );
				const tx = f.x + Math.sin( into ) * 10, tz = f.z + Math.cos( into ) * 10;
				f.windK = 1;
				f.steer( dt, tx, f.y, tz, ws * 0.95, 1, 1.5, this.wind );
				// cancel the remaining drift
				f.x -= f.vx * dt * 0.85;
				f.z -= f.vz * dt * 0.85;
				f.flapWant = 0.7;
				f.headPitch += ( 1.1 - f.headPitch ) * approach( 5, dt );
				f.animate( dt );
				if ( a.t <= 0 ) {
					f.windK = 0.35;
					if ( this.rng() < 0.45 ) {
						a.state = 'dive';
						a.t = 0;
					} else {
						a.state = 'patrol';
						a.t = 5 + this.rng() * 10;
						f.hover = 0;
					}
				}
				break;
			}
			case 'dive': {
				// plunge: wings swept back, steep, straight down into the water
				a.t += dt;
				f.hover = Math.max( 0, f.hover - dt * 4 );
				f.dive += ( 1 - f.dive ) * approach( 6, dt );
				f.flapWant = 0;
				f.speed = Math.min( 14, f.speed + 15 * dt );
				f.vy = - f.speed * 0.85;
				f.gamma = - 1.1;
				f.x += Math.sin( f.yaw ) * f.speed * 0.3 * dt;
				f.z += Math.cos( f.yaw ) * f.speed * 0.3 * dt;
				f.y += f.vy * dt;
				f.animate( dt );
				if ( f.y < wh + 0.05 ) {
					a.state = 'under';
					a.t = 0.35 + this.rng() * 0.3;
					a.visible = false;
				}
				break;
			}
			case 'under':
				a.t -= dt;
				f.y = wh - 0.3;
				if ( a.t <= 0 ) {
					// burst out of the water and climb away
					a.visible = true;
					f.P.fresh = true;
					f.dive = 0;
					f.y = wh + 0.05;
					f.speed = 4;
					f.vy = 2.5;
					f.pitch = 0.6;
					f.flap = 1.2;
					a.state = 'patrol';
					a.t = 6 + this.rng() * 10;
				}
				break;
		}
	}

}
