import * as THREE from 'three/webgpu';
import {
	Fn, uniform, float, vec2, vec3, vec4, attribute, positionGeometry, cameraViewMatrix, cameraProjectionMatrix,
	sin, cos, max, min, mix, pow, smoothstep, length, varyingProperty, uv, If, Discard, select
} from 'three/tsl';

// Air bubbles rising under water. The look follows the bubble sprites of Abyssal Garden
// (github.com/Noniv/abyssal-garden, W_SPR vsBub / fsBub, MIT, (c) 2026 Maksymilian Dendura): a disc with
// a bright rim and highlights, wobbling as it rises and growing toward the surface. Here each bubble is
// an opaque, depth-writing disc (as the marine snow), so the underwater pass (post/underwater.js) fogs
// it at its own distance: seen from the side, a bubble in water is a silver mirror (total reflection
// at its wall), with the light from above on its upper rim.
// The motion is analytic: each slot of a ring buffer holds where and when a bubble was born, its
// radius and its rise speed; the vertex shader moves it (rise, a helical wobble, a slow current, the
// growth as the pressure drops: r ~ ((1 + d0 / 10) / (1 + d / 10))^(1/3)) and hides it once it
// reaches the surface. The CPU only writes new slots. Sources:
//  - the plunge: a cloud of bubbles around the camera when it dives in;
//  - the breath: a puff every few seconds beside and under the camera, as a diver's exhaust;
//  - a few streams from the seabed near the camera, in pulses.

const POOL = 1024;
const STRIDE = 8; // bA: x, y, z (birth), radius (m); bB: birth time (s), rise speed (m/s), seed, -
const MAX_DIST = 30; // m: not drawn past this (the murk leaves ~1%)

const rnd = ( a, b ) => a + ( b - a ) * Math.random();
// terminal rise speed of a bubble of radius r (m): ~0.15 m/s at 0.5 mm to ~0.3 m/s from 3 mm
const riseSpeed = ( r ) => Math.min( 0.12 + 60 * r, 0.32 ) * rnd( 0.9, 1.1 );
// mostly small: 0.4 .. 6 mm (cubed: few large ones)
const radius = ( lo, hi ) => lo + ( hi - lo ) * Math.random() ** 3;

const _f = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3( 0, 1, 0 );

export class Bubbles {

	// floorAt( x, z ): height of the bottom (seabed rocks included) or null
	constructor( { floorAt, waterLevel = 0 } = {} ) {

		this.floorAt = floorAt;
		this.now = uniform( 0 ).setName( 'bubNow' );
		this.level = uniform( waterLevel ).setName( 'bubLevel' );
		this.light = uniform( new THREE.Color( 0.6, 0.7, 0.8 ) ).setName( 'bubLight' ); // daylight at the surface
		this.exhale = true; // the breath (QA and taste: app.bubbles.exhale = false)
		this.streams = 4;   // seabed streams kept around the camera
		this._t = 0;
		this._slot = 0;
		this._wasEye = false;
		this._breath = 2;
		this._queue = []; // [ time, fn ] spawns spread over a burst
		this._streams = [];

		const data = new Float32Array( POOL * STRIDE );
		for ( let i = 0; i < POOL; i ++ ) { data[ i * STRIDE + 4 ] = - 1e6; data[ i * STRIDE + 5 ] = 1; }
		this.data = data;
		const ib = new THREE.InstancedInterleavedBuffer( data, STRIDE );
		ib.setUsage( THREE.DynamicDrawUsage );
		this.ib = ib;

		const geo = new THREE.PlaneGeometry( 2, 2 );
		const inst = new THREE.InstancedBufferGeometry();
		inst.index = geo.index;
		inst.setAttribute( 'position', geo.getAttribute( 'position' ) );
		inst.setAttribute( 'uv', geo.getAttribute( 'uv' ) );
		inst.setAttribute( 'bA', new THREE.InterleavedBufferAttribute( ib, 4, 0 ) );
		inst.setAttribute( 'bB', new THREE.InterleavedBufferAttribute( ib, 4, 4 ) );
		inst.instanceCount = POOL;

		const mat = new THREE.MeshBasicNodeMaterial();
		mat.name = 'Bubbles';
		mat.fog = false; // the underwater pass does the water fog
		const vSeed = varyingProperty( 'float', 'vBubSeed' );

		mat.vertexNode = Fn( () => {

			const A = attribute( 'bA', 'vec4' ), B = attribute( 'bB', 'vec4' );
			const age = this.now.sub( B.x );
			const seed = B.z;
			const y = A.y.add( age.mul( B.y ) );
			const d0 = max( this.level.sub( A.y ), 0 ), d = max( this.level.sub( y ), 0 );
			const r = A.w.mul( pow( d0.div( 10 ).add( 1 ).div( d.div( 10 ).add( 1 ) ), 1 / 3 ) );
			// a helical wobble for the larger ones (a few mm to ~2 cm), a slow current
			const amp = mix( 0.002, 0.018, smoothstep( 0.0008, 0.004, A.w ) );
			const ph = age.mul( seed.mul( 4 ).add( 5 ) ).add( seed.mul( 40 ) );
			const p = vec3(
				A.x.add( sin( ph ).mul( amp ) ).add( age.mul( 0.04 ) ),
				y,
				A.z.add( cos( ph.mul( 0.9 ) ).mul( amp.mul( 0.8 ) ) ).add( age.mul( 0.025 ) )
			);
			const pv0 = cameraViewMatrix.mul( vec4( p, 1 ) );
			const dist = pv0.z.negate();
			// alive: born, below the surface (bursting: shrinks in the last 2 cm), near and in front
			const alive = age.greaterThanEqual( 0 ).and( dist.greaterThan( 0.06 ) ).and( dist.lessThan( MAX_DIST ) );
			const size = select( alive, max( r, dist.mul( 0.0008 ) ).mul( smoothstep( 0.0, 0.02, this.level.sub( y ).sub( r ) ) ), float( 0 ) );
			vSeed.assign( seed );
			return cameraProjectionMatrix.mul( vec4( pv0.xy.add( positionGeometry.xy.mul( size ) ), pv0.z, pv0.w ) );

		} )();

		mat.colorNode = Fn( () => {

			const q = uv().mul( 2 ).sub( 1 );
			const r = length( q );
			If( r.greaterThan( 1 ), () => { Discard(); } );
			// silver rim, darker middle where the water behind shows through, lit from above
			const rim = smoothstep( 0.5, 0.97, r );
			const top = smoothstep( - 0.8, 0.8, q.y );
			const hl = smoothstep( 0.32, 0.0, length( q.sub( vec2( - 0.32, 0.4 ) ) ) )
				.add( smoothstep( 0.18, 0.0, length( q.sub( vec2( 0.38, - 0.4 ) ) ) ).mul( 0.4 ) );
			const base = mix( float( 0.7 ), float( 1.9 ), rim.mul( rim ) ).mul( mix( 0.7, 1.3, top ) );
			const col = vec3( this.light ).mul( vec3( 0.85, 1.0, 1.0 ) ).mul( base.add( hl.mul( 3.5 ) ) );
			return vec4( min( col, vec3( 8 ) ), 1 );

		} )();

		this.mesh = new THREE.Mesh( inst, mat );
		this.mesh.name = 'bubbles';
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;

	}

	_spawn( x, y, z, r, t0 = this._t ) {

		const o = this._slot * STRIDE, d = this.data;
		d[ o ] = x; d[ o + 1 ] = y; d[ o + 2 ] = z; d[ o + 3 ] = r;
		d[ o + 4 ] = t0; d[ o + 5 ] = riseSpeed( r ); d[ o + 6 ] = Math.random(); d[ o + 7 ] = 0;
		this._slot = ( this._slot + 1 ) % POOL;
		this._dirty = true;

	}

	// camera; visible: any part of the view under water; under: the whole view; eyeUnder: the eye
	update( dt, camera, { visible, under, eyeUnder, level } ) {

		this._t += Math.min( dt, 0.1 );
		this.now.value = this._t;
		this.level.value = level;
		this.mesh.visible = visible;
		const c = camera.position;
		camera.getWorldDirection( _f );
		_s.crossVectors( _f, _u ).normalize();

		// the plunge: a cloud around and in front of the camera, over ~0.4 s
		if ( eyeUnder && ! this._wasEye && level - c.y < 1.5 ) {

			for ( let i = 0; i < 320; i ++ ) {

				const fw = rnd( 0.3, 2.2 ), sd = rnd( - 1.1, 1.1 ), up = rnd( - 1.2, 0.3 );
				this._spawn( c.x + _f.x * fw + _s.x * sd, Math.min( c.y + up, level - 0.05 ), c.z + _f.z * fw + _s.z * sd, radius( 0.0006, 0.014 ), this._t + rnd( 0, 0.4 ) );

			}
			this._breath = 3;

		}
		this._wasEye = eyeUnder;

		if ( under ) {

			// the breath: a puff every ~4.5 s from beside and under the camera, over ~0.9 s
			this._breath -= dt;
			if ( this.exhale && this._breath <= 0 ) {

				this._breath = rnd( 3.8, 5.2 );
				const side = Math.random() < 0.5 ? - 1 : 1, n = 18 + ( Math.random() * 14 | 0 );
				for ( let i = 0; i < n; i ++ ) {

					const k = 0.2 * side + rnd( - 0.04, 0.04 ), fw = 0.16 + rnd( - 0.04, 0.04 );
					this._spawn( c.x + _f.x * fw + _s.x * k + rnd( - 0.03, 0.03 ), c.y - 0.32 + rnd( - 0.03, 0.03 ), c.z + _f.z * fw + _s.z * k + rnd( - 0.03, 0.03 ),
						radius( 0.0008, 0.008 ), this._t + rnd( 0, 0.9 ) );

				}

			}

			// seabed streams near the camera, in pulses
			const S = this._streams;
			for ( let i = S.length - 1; i >= 0; i -- ) if ( Math.hypot( S[ i ].x - c.x, S[ i ].z - c.z ) > 35 ) S.splice( i, 1 );
			for ( let tries = 0; S.length < this.streams && tries < 6; tries ++ ) {

				const a = Math.random() * Math.PI * 2, rr = rnd( 6, 28 );
				const x = c.x + Math.cos( a ) * rr, z = c.z + Math.sin( a ) * rr;
				const y = this.floorAt?.( x, z );
				if ( y == null || y > level - 1.5 ) continue;
				S.push( { x, y, z, next: this._t + rnd( 0, 3 ), until: 0 } );

			}
			for ( const s of S ) {

				if ( this._t < s.next ) continue;
				if ( this._t > s.until ) { s.next = this._t + rnd( 1, 5 ); s.until = s.next + rnd( 2, 6 ); continue; }
				this._spawn( s.x + rnd( - 0.02, 0.02 ), s.y + 0.03, s.z + rnd( - 0.02, 0.02 ), radius( 0.0015, 0.007 ) );
				s.next = this._t + rnd( 0.06, 0.25 );

			}

		}

		if ( this._dirty ) { this.ib.needsUpdate = true; this._dirty = false; }

	}

}
