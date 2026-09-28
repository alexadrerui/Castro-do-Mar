// Heads-up display: compass, stats, view presets, sun/sky/quality controls.
const $ = ( id ) => document.getElementById( id );

export class HUD {

	constructor( app ) {
		this.app = app;
		this.root = $( 'hud' );
		this._buildCompass();
		this._frames = 0; this._acc = 0;

		// views
		const views = $( 'views' );
		app.views.forEach( ( v, i ) => {
			const b = document.createElement( 'button' );
			b.innerHTML = `${v.label}<kbd>${i + 1}</kbd>`;
			b.onclick = () => app.goView( i );
			views.appendChild( b );
		} );

		// layers
		const layers = $( 'layers' );
		for ( const [ key, layer ] of Object.entries( app.layers ) ) {
			const b = document.createElement( 'button' );
			b.textContent = layer.label;
			b.onclick = () => { layer.object.visible = ! layer.object.visible; b.classList.toggle( 'off', ! layer.object.visible ); };
			b.dataset.key = key;
			layers.appendChild( b );
		}

		// sliders
		const sky = app.sky;
		this._range( 'r-elev', 'o-elev', sky.state.elevation, ( v ) => { sky.state.elevation = v; app.onSunChanged(); }, ( v ) => v.toFixed( 1 ) + '°' );
		this._range( 'r-azi', 'o-azi', sky.state.azimuth, ( v ) => { sky.state.azimuth = v; app.onSunChanged(); }, ( v ) => v.toFixed( 0 ) + '°' );
		this._range( 'r-cloud', 'o-cloud', sky.sky.cloudCoverage.value, ( v ) => { sky.sky.cloudCoverage.value = v; }, ( v ) => Math.round( v * 100 ) + '%' );
		this._range( 'r-fog', 'o-fog', app.fogScale.value, ( v ) => { app.fogScale.value = v; }, ( v ) => v.toFixed( 2 ) + '×' );
		this._range( 'r-res', 'o-res', app.pixelRatio, ( v ) => app.setPixelRatio( v ), ( v ) => v.toFixed( 2 ) + '×' );
		$( 'c-shadows' ).onchange = ( e ) => app.setShadows( e.target.checked );
		$( 'c-refl' ).onchange = ( e ) => app.setReflections( e.target.checked );

		$( 'side-toggle' ).onclick = () => $( 'side' ).classList.toggle( 'collapsed' );
		window.addEventListener( 'keydown', ( e ) => {
			if ( e.target.closest && e.target.closest( 'input' ) ) return;
			if ( e.code === 'KeyH' ) $( 'side' ).classList.toggle( 'collapsed' );
			if ( e.code === 'KeyP' ) app.capture( 'foto_' + Date.now() ).then( () => this.toast( 'Foto salva em shots/' ) );
			if ( e.code === 'KeyU' ) document.body.classList.toggle( 'clean' );
			const n = parseInt( e.key, 10 );
			if ( n >= 1 && n <= app.views.length ) app.goView( n - 1 );
		} );
		$( 'st-backend' ).textContent = app.backendName;
	}

	show() { this.root.hidden = false; }

	toast( msg ) {
		const t = $( 'toast' );
		t.textContent = msg; t.classList.add( 'show' );
		clearTimeout( this._tt ); this._tt = setTimeout( () => t.classList.remove( 'show' ), 1800 );
	}

	_range( id, outId, value, onInput, fmt ) {
		const r = $( id ), o = $( outId );
		r.value = value; o.textContent = fmt( +value );
		r.addEventListener( 'input', () => { onInput( +r.value ); o.textContent = fmt( +r.value ); } );
	}

	_buildCompass() {
		const strip = $( 'compass-strip' );
		const names = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
		this.pxPerDeg = 3;
		for ( let rep = - 1; rep <= 1; rep ++ ) {
			for ( let d = 0; d < 360; d += 15 ) {
				const s = document.createElement( 'span' );
				const isCard = names[ d ] !== undefined;
				s.className = isCard ? 'card' + ( d === 0 ? ' n' : '' ) : 'tick';
				s.textContent = isCard ? names[ d ] : '';
				s.style.left = ( ( d + rep * 360 ) * this.pxPerDeg ) + 'px';
				strip.appendChild( s );
			}
		}
		this.strip = strip;
	}

	update( dt, cam, info, speed ) {
		// heading: 0 = north (-z), clockwise
		const dir = cam.getWorldDirection( this._v || ( this._v = cam.position.clone() ) );
		let hdg = Math.atan2( dir.x, - dir.z ) * 180 / Math.PI;
		if ( hdg < 0 ) hdg += 360;
		this.strip.style.transform = `translateX(${- hdg * this.pxPerDeg}px)`;

		this._frames ++; this._acc += dt;
		if ( this._acc > 0.5 ) {
			$( 'st-fps' ).textContent = Math.round( this._frames / this._acc );
			this._frames = 0; this._acc = 0;
			$( 'st-calls' ).textContent = info.render.drawCalls;
			const t = info.render.triangles;
			$( 'st-tris' ).textContent = t > 1e6 ? ( t / 1e6 ).toFixed( 2 ) + 'M' : ( t / 1e3 ).toFixed( 0 ) + 'k';
			$( 'c-x' ).textContent = cam.position.x.toFixed( 0 );
			$( 'c-z' ).textContent = cam.position.z.toFixed( 0 );
			$( 'c-y' ).textContent = cam.position.y.toFixed( 0 );
			$( 'c-v' ).textContent = speed.toFixed( 0 );
		}
	}
}
