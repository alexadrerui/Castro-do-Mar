// Shooting stars at night (idea from Nightscape, WeebLabs: the repository has no licence, so only the
// description, no code). By default one every two minutes on average, at random (Poisson); both ends
// of the path are picked inside the view, so the whole streak is seen; at least 6 degrees up, clear of
// the moon, heading downward. A pixel-thin line with a hot blue-white head and a warmer fading trail,
// 0.3 to 2 s; about one in twelve a brighter, longer, wider fireball (past the bloom's threshold).
// Drawn like the stars (world/stars.js): at 30 km from the camera, additive, behind the mountains and
// under the clouds (composited later), not in the water's reflection (layer 0 only).
//
// One strip mesh, always in the scene (so its single pipeline is compiled with the rest; idle it is
// drawn with brightness 0). app.meteors: rate (per minute; 0 turns them off), fire( fireball ),
// uniforms. Key K (ui/hud.js) sends one now.
import * as THREE from 'three/webgpu';
import { Fn, cameraPosition, cross, exp, max, mix, normalize, positionGeometry, smoothstep, uniform, vec3, vec4 } from 'three/tsl';

const FAR = 30000;  // m, as the stars
const SEG = 24;     // segments along the streak
const MIN_UP = Math.sin( THREE.MathUtils.degToRad( 6 ) );
const MOON_CLEAR = Math.cos( THREE.MathUtils.degToRad( 10 ) );

export class Meteors extends THREE.Mesh {

	// night: the sky's night factor (uniform)
	constructor( night ) {
		// x: 0 (tail) .. 1 (head) along the streak, y: -1 .. 1 across
		const pos = [], idx = [];
		for ( let i = 0; i <= SEG; i ++ ) pos.push( i / SEG, - 1, 0, i / SEG, 1, 0 );
		for ( let i = 0; i < SEG; i ++ ) { const a = i * 2; idx.push( a, a + 1, a + 3, a, a + 3, a + 2 ); }
		const geo = new THREE.BufferGeometry();
		geo.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
		geo.setIndex( idx );

		const U = {
			from: uniform( new THREE.Vector3( 0, 0.5, - 1 ).normalize() ),
			to: uniform( new THREE.Vector3( 0.1, 0.4, - 1 ).normalize() ),
			head: uniform( 0 ),        // 0..1 along the path
			trail: uniform( 0.35 ),    // the trail's length, as a share of the path
			bright: uniform( 0 ),      // 0 while idle
			halfWidth: uniform( 1.5 ), // px, the quad's half width (the line's core is ~1 px)
			pxAngle: uniform( 0.001 ), // rad a pixel (main loop: from the camera's fov and the canvas)
			intensity: uniform( 14 ),
			night
		};
		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } );
		mat.fog = false;
		const t = positionGeometry.x, s = positionGeometry.y;
		const tail = max( U.head.sub( U.trail ), 0 );
		const u = mix( tail, U.head, t );
		const dir = normalize( mix( U.from, U.to, u ) );
		const side = normalize( cross( normalize( U.to.sub( U.from ) ), dir ) );
		mat.positionNode = cameraPosition.add( dir.mul( FAR ) ).add( side.mul( s.mul( U.halfWidth ).mul( U.pxAngle ).mul( FAR ) ) );
		mat.colorNode = Fn( () => {
			const across = exp( s.mul( s ).mul( - 4.5 ) );
			// fading trail, a hot head; it flares in and burns out along the path
			const along = t.pow( 2.5 ).add( exp( t.oneMinus().mul( - 28 ) ).mul( 1.5 ) );
			const life = smoothstep( 0, 0.12, U.head ).mul( smoothstep( 0.75, 1.0, U.head ).oneMinus().mul( 0.85 ).add( 0.15 ) );
			const col = mix( vec3( 1.0, 0.62, 0.32 ), vec3( 0.78, 0.88, 1.0 ), smoothstep( 0.75, 1.0, t ) );
			const vis = smoothstep( 0.35, 0.9, U.night );
			return vec4( col.mul( across.mul( along ).mul( life ).mul( U.bright ).mul( U.intensity ).mul( vis ) ), 1 );
		} )();
		super( geo, mat );
		this.name = 'meteors';
		this.frustumCulled = false;
		this.renderOrder = - 0.4; // after the sky dome and the stars
		this.matrixAutoUpdate = false;
		this.uniforms = U;
		this.rate = 0.5;  // per minute, on average
		this.active = null;
		this._v = new THREE.Vector3();
	}

	// a new streak now, inside the view of `camera`; moonDir: keep clear of it (or null)
	fire( camera, fireball = Math.random() < 1 / 12, moonDir = null ) {
		const U = this.uniforms, a = new THREE.Vector3(), b = new THREE.Vector3();
		const aspect = camera.aspect || 1.6;
		const ok = ( d ) => d.y > MIN_UP && ! ( moonDir && d.dot( moonDir ) > MOON_CLEAR );
		for ( let k = 0; k < 30; k ++ ) {
			const x0 = ( Math.random() * 2 - 1 ) * 0.8, y0 = - 0.1 + Math.random() * 0.95;
			const ang = THREE.MathUtils.degToRad( - 30 - Math.random() * 120 ); // generally downward
			const len = fireball ? 0.45 + Math.random() * 0.45 : 0.2 + Math.random() * 0.4;
			const x1 = x0 + Math.cos( ang ) * len / aspect, y1 = y0 + Math.sin( ang ) * len;
			if ( Math.abs( x1 ) > 0.95 || Math.abs( y1 ) > 0.95 ) continue;
			a.set( x0, y0, 0.5 ).unproject( camera ).sub( camera.position ).normalize();
			b.set( x1, y1, 0.5 ).unproject( camera ).sub( camera.position ).normalize();
			if ( ! ok( a ) || ! ok( b ) ) continue;
			U.from.value.copy( a ); U.to.value.copy( b );
			U.halfWidth.value = fireball ? 3 : 1.5;
			U.intensity.value = fireball ? 45 : 14;
			U.trail.value = fireball ? 0.5 : 0.3 + Math.random() * 0.15;
			U.head.value = 0;
			U.bright.value = 1;
			this.active = { age: 0, life: fireball ? 1.4 + Math.random() * 0.8 : 0.3 + Math.random() * 1.2 };
			return true;
		}
		return false; // no sky in view
	}

	// dt in s; night: 0..1; rain: 0..1
	update( dt, camera, renderer, night, rain = 0, moonDir = null ) {
		const U = this.uniforms;
		const h = renderer.domElement.clientHeight || 900;
		U.pxAngle.value = 2 * Math.tan( THREE.MathUtils.degToRad( camera.fov / 2 ) ) / h;
		if ( this.active ) {
			this.active.age += dt;
			// the head runs a little ahead of the end, so the trail burns out as it arrives
			U.head.value = Math.min( 1, this.active.age / this.active.life );
			if ( this.active.age >= this.active.life ) { this.active = null; U.bright.value = 0; }
			return;
		}
		if ( this.rate > 0 && night > 0.6 && rain < 0.3 && Math.random() < dt * this.rate / 60 ) this.fire( camera, undefined, moonDir );
	}

}
