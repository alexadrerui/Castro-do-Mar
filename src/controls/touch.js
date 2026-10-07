// On-screen controls for phones and tablets, after offroad's touch.js (https://github.com/alexadrerui/offroad,
// MIT, Copyright (c) 2026 Arz-Gev, licenses/LICENSE-offroad.md): pointer events with pointer capture, so each
// finger keeps its control even when it slides off it and several work at once; the stick appears under
// the thumb. Rewritten for the free camera (controls/freecam.js) instead of a truck:
//   left thumb   fly: touch anywhere in the lower left and slide (forward, back, sideways), analog
//   right thumb  ▲ up, ▼ down, » fast (held)
//   the view     one finger looks, two pinch to fly along the view (freecam), a tap focuses (main.js)
// They show on the first touch (or at once on a touch-only screen) and hide again on a mouse or a key;
// body.is-touch also hides the keyboard help. Nothing is drawn in WebGL: plain DOM.

const RADIUS = 56;   // px of stick travel for full speed
const DEAD = 0.08;

export class TouchControls {

	// app: freecam, hud
	constructor( app ) {
		this.app = app;
		this.cam = app.freecam;
		this.visible = false;
		this.stick = null;            // { id, x0, y0 }
		this.held = new Map();        // pointerId -> button action

		const root = this.root = document.createElement( 'div' );
		root.id = 'touch-ui';
		root.innerHTML = `
			<div class="t-zone" id="t-zone"><div class="t-base" hidden><div class="t-knob"></div></div><span class="t-hint">arraste para voar</span></div>
			<div class="t-buttons">
				<button class="t-btn" data-act="up" aria-label="Subir">▲</button>
				<button class="t-btn" data-act="boost" aria-label="Rápido">»</button>
				<button class="t-btn" data-act="down" aria-label="Descer">▼</button>
			</div>`;
		document.body.appendChild( root );
		this.zone = root.querySelector( '#t-zone' );
		this.base = root.querySelector( '.t-base' );
		this.knob = root.querySelector( '.t-knob' );

		// the stick
		this.zone.addEventListener( 'pointerdown', ( e ) => {
			if ( this.stick ) return;
			e.preventDefault();
			this.zone.setPointerCapture( e.pointerId );
			this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
			const r = this.zone.getBoundingClientRect();
			this.base.style.left = ( e.clientX - r.left ) + 'px'; this.base.style.top = ( e.clientY - r.top ) + 'px';
			this.base.hidden = false;
			this.zone.classList.add( 'active' );
			this._stickTo( e );
		} );
		this.zone.addEventListener( 'pointermove', ( e ) => { if ( this.stick?.id === e.pointerId ) this._stickTo( e ); } );
		const release = ( e ) => {
			if ( this.stick?.id !== e.pointerId ) return;
			this.stick = null;
			this.base.hidden = true;
			this.zone.classList.remove( 'active' );
			this.cam.analog.x = 0; this.cam.analog.z = 0;
		};
		this.zone.addEventListener( 'pointerup', release );
		this.zone.addEventListener( 'pointercancel', release );

		// the buttons (held)
		for ( const b of root.querySelectorAll( '.t-btn' ) ) {
			b.addEventListener( 'pointerdown', ( e ) => {
				e.preventDefault();
				b.setPointerCapture( e.pointerId );
				this.held.set( e.pointerId, b.dataset.act );
				b.classList.add( 'on' );
				this._buttons();
			} );
			const up = ( e ) => { if ( this.held.delete( e.pointerId ) ) { b.classList.remove( 'on' ); this._buttons(); } };
			b.addEventListener( 'pointerup', up );
			b.addEventListener( 'pointercancel', up );
			b.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		}

		// show on a touch, hide on a mouse or a key
		addEventListener( 'pointerdown', ( e ) => { if ( e.pointerType === 'touch' ) this.show( true ); else if ( e.pointerType === 'mouse' ) this.show( false ); }, true );
		addEventListener( 'keydown', ( e ) => { if ( ! e.target.closest?.( 'input,select,textarea' ) ) this.show( false ); } );
		if ( matchMedia( '(hover: none) and (pointer: coarse)' ).matches ) this.show( true );
	}

	show( on ) {
		if ( on === this.visible ) return;
		this.visible = on;
		document.body.classList.toggle( 'is-touch', on );
		// a phone starts with the panel folded: it would cover the view
		if ( on && ! this._folded && innerWidth < 900 ) { this._folded = true; document.getElementById( 'side' )?.classList.add( 'collapsed' ); }
		if ( ! on ) { this.cam.analog.set( 0, 0, 0 ); this.cam.touchBoost = false; }
	}

	_stickTo( e ) {
		let dx = ( e.clientX - this.stick.x0 ) / RADIUS, dy = ( e.clientY - this.stick.y0 ) / RADIUS;
		const l = Math.hypot( dx, dy );
		if ( l > 1 ) { dx /= l; dy /= l; }
		this.knob.style.transform = `translate(${ ( dx * RADIUS ).toFixed( 1 ) }px, ${ ( dy * RADIUS ).toFixed( 1 ) }px)`;
		const k = l < DEAD ? 0 : 1;
		// up on the screen = forward (-z)
		this.cam.analog.x = dx * k; this.cam.analog.z = dy * k;
	}

	_buttons() {
		const acts = new Set( this.held.values() );
		this.cam.analog.y = ( acts.has( 'up' ) ? 1 : 0 ) - ( acts.has( 'down' ) ? 1 : 0 );
		this.cam.touchBoost = acts.has( 'boost' );
	}

}
