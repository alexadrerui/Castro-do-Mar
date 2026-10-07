import * as THREE from 'three/webgpu';

// Game-engine style fly camera, modelled after hxtnv/three-freecam:
//  - right (or left) drag: look      - WASD / arrows: fly     - Q / E: down / up
//  - Shift: boost                   - wheel while looking: speed, otherwise dolly
//  - middle drag: pan               - Alt + left drag: orbit around pivot
//  - F: frame pivot
// Touch (controls/touch.js puts a stick and up/down buttons over the canvas): one finger on the view
// looks, two fingers pinch to fly forward and back (and drag together to look); `analog` is the
// stick's move (x right, y up, z back, -1..1), added to the keys.
export class FreeCam {

	constructor( camera, dom, opts = {} ) {
		this.camera = camera;
		this.dom = dom;
		this.moveSpeed = opts.moveSpeed ?? 18;
		this.boost = opts.boost ?? 5;
		this.lookSpeed = opts.lookSpeed ?? 0.0022;
		this.damping = opts.damping ?? 0.82;
		this.groundFn = opts.groundFn || null;   // (x,z) => height
		this.minClearance = opts.minClearance ?? 1.7;
		this.waterLevel = opts.waterLevel ?? 0;
		this.diveClearance = opts.diveClearance ?? 0.6; // m above the bottom when underwater
		this.enabled = true;
		this.leftLook = true; // false: the left button is left to another tool (terrain editor)
		this.planar = false;  // true: WASD move in the horizontal plane (a view from above), Q / E up and down
		this.leftBlocker = null; // ( event ) => true when a left press belongs to another tool (a gizmo under the pointer)

		this.yaw = 0; this.pitch = 0;
		this.vel = new THREE.Vector3();
		this.pivot = new THREE.Vector3();
		this.keys = new Set();
		this.analog = new THREE.Vector3();   // the touch stick and buttons (controls/touch.js)
		this.touchBoost = false;
		this.touches = new Map();            // pointerId -> { x, y } of fingers on the view
		this.touchLook = 1.8;                // a finger turns the view faster than the mouse
		this.mode = null; // 'look' | 'pan' | 'orbit'
		this.last = { x: 0, y: 0 };
		this.tween = null;

		this._syncFromCamera();

		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		dom.addEventListener( 'pointerdown', this._down.bind( this ) );
		window.addEventListener( 'pointermove', this._move.bind( this ) );
		window.addEventListener( 'pointerup', this._up.bind( this ) );
		dom.addEventListener( 'wheel', this._wheel.bind( this ), { passive: false } );
		window.addEventListener( 'keydown', ( e ) => {
			if ( e.target.closest && e.target.closest( 'input,select,textarea' ) ) return;
			this.keys.add( e.code );
			if ( e.code === 'KeyF' ) this.frame();
		} );
		window.addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => this.keys.clear() );
	}

	_syncFromCamera() {
		const e = new THREE.Euler().setFromQuaternion( this.camera.quaternion, 'YXZ' );
		this.yaw = e.y; this.pitch = e.x;
		const fwd = new THREE.Vector3( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );
		this.pivot.copy( this.camera.position ).addScaledVector( fwd, 60 );
	}

	_down( e ) {
		if ( ! this.enabled ) return;
		if ( e.pointerType === 'touch' ) return this._touchDown( e );
		this.tween = null;
		if ( e.button === 0 && ! e.altKey && ( ! this.leftLook || this.leftBlocker?.( e ) ) ) return;
		if ( e.button === 2 || ( e.button === 0 && ! e.altKey ) ) this.mode = 'look';
		else if ( e.button === 1 ) { this.mode = 'pan'; e.preventDefault(); }
		else if ( e.button === 0 && e.altKey ) this.mode = 'orbit';
		this.last.x = e.clientX; this.last.y = e.clientY;
		this.dom.setPointerCapture?.( e.pointerId );
		this.dom.classList.add( 'dragging' );
	}

	_move( e ) {
		if ( e.pointerType === 'touch' && this.touches.has( e.pointerId ) ) return this._touchMove( e );
		if ( ! this.mode ) return;
		const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
		this.last.x = e.clientX; this.last.y = e.clientY;
		if ( this.mode === 'look' ) {
			this.yaw -= dx * this.lookSpeed;
			this.pitch -= dy * this.lookSpeed;
			this.pitch = Math.max( - 1.55, Math.min( 1.55, this.pitch ) );
		} else if ( this.mode === 'pan' ) {
			const d = this.camera.position.distanceTo( this.pivot );
			const s = d * 0.0015;
			const right = new THREE.Vector3( 1, 0, 0 ).applyQuaternion( this.camera.quaternion );
			const up = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( this.camera.quaternion );
			const off = right.multiplyScalar( - dx * s ).add( up.multiplyScalar( dy * s ) );
			this.camera.position.add( off ); this.pivot.add( off );
		} else if ( this.mode === 'orbit' ) {
			const off = this.camera.position.clone().sub( this.pivot );
			const sph = new THREE.Spherical().setFromVector3( off );
			sph.theta -= dx * this.lookSpeed * 1.5;
			sph.phi = Math.max( 0.05, Math.min( Math.PI - 0.05, sph.phi - dy * this.lookSpeed * 1.5 ) );
			off.setFromSpherical( sph );
			this.camera.position.copy( this.pivot ).add( off );
			this.camera.lookAt( this.pivot );
			const eu = new THREE.Euler().setFromQuaternion( this.camera.quaternion, 'YXZ' );
			this.yaw = eu.y; this.pitch = eu.x;
		}
	}

	_up( e ) {
		if ( e?.pointerType === 'touch' ) return this._touchUp( e );
		this.mode = null;
		this.dom.classList.remove( 'dragging' );
	}

	// ---- touch: one finger looks; two pinch (fly along the view) and look with their midpoint
	_touchDown( e ) {
		if ( ! this.leftLook ) return; // an editor tool has the finger
		this.tween = null;
		this.touches.set( e.pointerId, { x: e.clientX, y: e.clientY } );
		this.dom.setPointerCapture?.( e.pointerId );
		this._pinch = this.touches.size === 2 ? this._spread() : null;
	}

	_spread() {
		const [ a, b ] = [ ...this.touches.values() ];
		return { d: Math.hypot( a.x - b.x, a.y - b.y ), x: ( a.x + b.x ) / 2, y: ( a.y + b.y ) / 2 };
	}

	_touchMove( e ) {
		const t = this.touches.get( e.pointerId );
		const dx = e.clientX - t.x, dy = e.clientY - t.y;
		t.x = e.clientX; t.y = e.clientY;
		if ( this.touches.size === 1 ) {
			this._turn( dx, dy, this.touchLook );
		} else if ( this.touches.size === 2 && this._pinch ) {
			const p = this._spread();
			// spreading the fingers flies forward: ~ the move speed per 100 px
			const fwd = new THREE.Vector3( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );
			this.camera.position.addScaledVector( fwd, ( p.d - this._pinch.d ) * this.moveSpeed * 0.01 );
			this._turn( p.x - this._pinch.x, p.y - this._pinch.y, this.touchLook * 0.6 );
			this._pinch = p;
		}
	}

	_touchUp( e ) {
		this.touches.delete( e.pointerId );
		this._pinch = this.touches.size === 2 ? this._spread() : null;
	}

	_turn( dx, dy, k ) {
		this.yaw -= dx * this.lookSpeed * k;
		this.pitch = Math.max( - 1.55, Math.min( 1.55, this.pitch - dy * this.lookSpeed * k ) );
	}

	_wheel( e ) {
		e.preventDefault();
		if ( this.mode === 'look' ) {
			this.moveSpeed = Math.max( 1, Math.min( 600, this.moveSpeed * ( e.deltaY > 0 ? 0.85 : 1.18 ) ) );
			this.onSpeed?.( this.moveSpeed );
		} else {
			const fwd = new THREE.Vector3( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );
			const d = Math.max( 2, this.camera.position.distanceTo( this.pivot ) );
			this.camera.position.addScaledVector( fwd, - Math.sign( e.deltaY ) * d * 0.12 );
		}
	}

	frame() {
		const fwd = new THREE.Vector3( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );
		this.flyTo( this.pivot.clone().addScaledVector( fwd, - 60 ), this.pivot.clone(), 1.2 );
	}

	// Smoothly fly to position `pos` looking at `target`.
	flyTo( pos, target, duration = 2.2 ) {
		const q1 = new THREE.Quaternion().setFromRotationMatrix(
			new THREE.Matrix4().lookAt( pos, target, new THREE.Vector3( 0, 1, 0 ) ) );
		this.tween = {
			t: 0, d: duration,
			p0: this.camera.position.clone(), p1: pos.clone(),
			q0: this.camera.quaternion.clone(), q1
		};
		this.pivot.copy( target );
	}

	jumpTo( pos, target ) {
		this.tween = null;
		this.camera.position.copy( pos );
		this.camera.lookAt( target );
		this.pivot.copy( target );
		this._syncFromCamera();
		this.pivot.copy( target );
		this.vel.set( 0, 0, 0 );
	}

	update( dt ) {
		const cam = this.camera;
		if ( this.tween ) {
			const tw = this.tween;
			tw.t += dt / tw.d;
			const s = tw.t >= 1 ? 1 : ( tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow( - 2 * tw.t + 2, 3 ) / 2 );
			cam.position.lerpVectors( tw.p0, tw.p1, s );
			cam.quaternion.slerpQuaternions( tw.q0, tw.q1, s );
			if ( tw.t >= 1 ) { this.tween = null; const eu = new THREE.Euler().setFromQuaternion( cam.quaternion, 'YXZ' ); this.yaw = eu.y; this.pitch = eu.x; }
			return;
		}

		if ( this.mode !== 'orbit' ) cam.quaternion.setFromEuler( new THREE.Euler( this.pitch, this.yaw, 0, 'YXZ' ) );

		if ( ! this.enabled ) return;
		const k = this.keys;
		const input = new THREE.Vector3(
			( k.has( 'KeyD' ) || k.has( 'ArrowRight' ) ? 1 : 0 ) - ( k.has( 'KeyA' ) || k.has( 'ArrowLeft' ) ? 1 : 0 ),
			( k.has( 'KeyE' ) || k.has( 'Space' ) ? 1 : 0 ) - ( k.has( 'KeyQ' ) || k.has( 'ControlLeft' ) ? 1 : 0 ),
			( k.has( 'KeyS' ) || k.has( 'ArrowDown' ) ? 1 : 0 ) - ( k.has( 'KeyW' ) || k.has( 'ArrowUp' ) ? 1 : 0 )
		);
		// the touch stick and buttons (analog, -1..1)
		input.add( this.analog );
		input.x = Math.max( - 1, Math.min( 1, input.x ) ); input.y = Math.max( - 1, Math.min( 1, input.y ) ); input.z = Math.max( - 1, Math.min( 1, input.z ) );
		const speed = this.moveSpeed * ( k.has( 'ShiftLeft' ) || k.has( 'ShiftRight' ) || this.touchBoost ? this.boost : 1 );
		let wish;
		if ( this.planar ) {
			// looking down, "forward" is up on the screen: the heading (yaw), not the view direction
			const c = Math.cos( this.yaw ), s = Math.sin( this.yaw );
			wish = new THREE.Vector3( input.x * c + input.z * s, input.y, - input.x * s + input.z * c );
		} else {
			wish = new THREE.Vector3( input.x, 0, input.z ).applyQuaternion( cam.quaternion );
			wish.y += input.y;
		}
		// full speed for keys; a stick pushed half way flies at half speed
		if ( wish.lengthSq() > 0 ) wish.normalize().multiplyScalar( speed * Math.min( 1, input.length() ) );

		const damp = Math.pow( this.damping, dt * 60 );
		this.vel.lerp( wish, 1 - damp );
		cam.position.addScaledVector( this.vel, dt );
		if ( this.vel.lengthSq() > 0.01 ) this.pivot.addScaledVector( this.vel, dt );

		if ( this.groundFn ) {
			const g = this.groundFn( cam.position.x, cam.position.z );
			// over water the camera may dive, down to just above the bottom
			// in shallow water (a river) the clearance shrinks with the depth, so the camera can still dive
			const minY = g < this.waterLevel ? g + Math.min( this.diveClearance, Math.max( 0.15, ( this.waterLevel - g ) * 0.35 ) ) : g + this.minClearance;
			if ( cam.position.y < minY ) cam.position.y = minY;
		}
	}
}
