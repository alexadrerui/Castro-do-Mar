// Heads-up display: compass, stats, view presets, sun/sky/quality controls.
import { Clock, PRESETS } from '../world/clock.js';
import { QUALITY } from '../core/settings.js';
import { reloadKeepingView } from '../core/recovery.js';

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
		// the time of day (world/clock.js): three presets, the time passing and its speed (game hours per real minute)
		const clock = app.clock;
		const hourOut = $( 'o-hour' ), play = $( 'b-play' );
		const hourRange = $( 'r-hour' );
		const showHour = ( h ) => { hourOut.textContent = Clock.format( h ); hourRange.value = h; };
		// the hour by hand: the sun along its arc (its height), the moon and the stars with it
		hourRange.addEventListener( 'input', () => clock.set( + hourRange.value ) );
		showHour( clock.hour );
		clock.listeners.push( showHour );
		for ( const b of document.querySelectorAll( '#day [data-preset]' ) ) b.onclick = () => clock.set( PRESETS[ b.dataset.preset ] );
		const showPlay = () => { play.textContent = clock.playing ? '⏸ Parar o tempo' : '▶ Passar o tempo'; play.classList.toggle( 'on', clock.playing ); };
		showPlay();
		play.onclick = () => { clock.playing = ! clock.playing; showPlay(); };
		this._range( 'r-speed', 'o-speed', clock.speed, ( v ) => { clock.speed = v; }, ( v ) => '1 dia em ' + Math.round( 24 / v ) + ' min' );
		this._range( 'r-cloud', 'o-cloud', sky.sky.cloudCoverage.value, ( v ) => { sky.sky.cloudCoverage.value = v; }, ( v ) => Math.round( v * 100 ) + '%' );
		this._range( 'r-rain', 'o-rain', app.weather?.target ?? 0, ( v ) => app.setRain?.( v ), ( v ) => Math.round( v * 100 ) + '%' );
		$( 'b-strike' )?.addEventListener( 'click', () => app.strike?.() );
		this._range( 'r-fog', 'o-fog', app.fogScale.value, ( v ) => { app.fogScale.value = v; }, ( v ) => v.toFixed( 2 ) + '×' );
		this._range( 'r-res', 'o-res', app.pixelRatio, ( v ) => app.setPixelRatio( v ), ( v ) => v.toFixed( 2 ) + '×' );
		$( 'c-shadows' ).checked = app.shadowsOn; // off by default (main.js), ?shadows=1
		$( 'c-shadows' ).onchange = ( e ) => app.setShadows( e.target.checked );
		$( 'c-refl' ).onchange = ( e ) => app.setReflections( e.target.checked );
		$( 'c-focus' ).onchange = ( e ) => this.setFocus( e.target.checked );
		$( 'c-bloom' ).onchange = ( e ) => { app.setBloom( e.target.checked ); this.toast( e.target.checked ? 'Brilho ligado' : 'Brilho desligado' ); };
		$( 'c-paint' ).checked = !! app.paint && new URLSearchParams( location.search ).get( 'paint' ) === '1';
		$( 'c-paint' ).onchange = ( e ) => { app.setPaint( e.target.checked ); this.toast( e.target.checked ? 'Pintura a óleo ligada' : 'Pintura a óleo desligada' ); };

		$( 'side-toggle' ).onclick = () => $( 'side' ).classList.toggle( 'collapsed' );
		window.addEventListener( 'keydown', ( e ) => {
			if ( e.target.closest && e.target.closest( 'input' ) ) return;
			if ( e.code === 'KeyH' ) $( 'side' ).classList.toggle( 'collapsed' );
			if ( e.code === 'KeyP' ) app.capture( 'foto_' + Date.now() ).then( () => this.toast( 'Foto salva em shots/' ) );
			if ( e.code === 'KeyU' ) document.body.classList.toggle( 'clean' );
			if ( e.code === 'KeyB' ) this.setFocus( ! app.focus.enabled );
			if ( e.code === 'KeyL' && ! e.ctrlKey ) app.strike?.();
			if ( e.code === 'KeyM' && app.settings ) { app.settings.toggleMute(); this.toast( app.settings.muted ? 'Som desligado' : 'Som ligado' ); }
			const n = parseInt( e.key, 10 );
			if ( n >= 1 && n <= app.views.length ) app.goView( n - 1 );
		} );
		$( 'st-backend' ).textContent = app.backendName;
	}

	show() { this.root.hidden = false; }

	// The panel's "Opções" (core/settings.js): quality presets, audio, renderer, editor.
	bindOptions( settings ) {
		const app = this.app;
		// quality: the preset buttons, and the image controls below showing what a preset set; touching
		// one of those by hand leaves the preset dimmed (custom)
		const seg = $( 'o-quality' );
		const showQuality = ( level ) => {
			for ( const b of seg.querySelectorAll( 'button' ) ) b.classList.toggle( 'on', b.dataset.q === level );
			seg.classList.remove( 'custom' );
		};
		for ( const b of seg.querySelectorAll( 'button' ) ) b.onclick = () => {
			settings.setQuality( b.dataset.q );
			this.toast( 'Qualidade ' + QUALITY[ b.dataset.q ].label.toLowerCase() );
		};
		settings.on( 'quality', ( level, q ) => {
			showQuality( level );
			$( 'r-res' ).value = app.pixelRatio; $( 'o-res' ).textContent = app.pixelRatio.toFixed( 2 ) + '×';
			$( 'c-shadows' ).checked = q.shadows; $( 'c-refl' ).checked = q.reflections;
			$( 'c-focus' ).checked = q.focus; $( 'c-bloom' ).checked = q.bloom;
		} );
		showQuality( settings.quality );
		for ( const id of [ 'r-res', 'c-shadows', 'c-refl', 'c-focus', 'c-bloom' ] ) $( id ).addEventListener( 'input', () => seg.classList.add( 'custom' ) );

		// audio: mute (M) and volume, kept in localStorage
		const audio = $( 'b-audio' );
		const showAudio = ( muted, volume ) => {
			audio.textContent = muted ? '🔇 Mudo' : '🔊 Ligado'; audio.classList.toggle( 'warn', muted );
			$( 'r-volume' ).value = volume; $( 'o-volume' ).textContent = Math.round( volume * 100 ) + '%';
		};
		audio.onclick = () => settings.toggleMute();
		settings.on( 'audio', showAudio );
		this._range( 'r-volume', 'o-volume', settings.volume, ( v ) => settings.setAudio( v === 0, v ), ( v ) => Math.round( v * 100 ) + '%' );
		showAudio( settings.muted, settings.volume );

		// renderer: the one in use; the other is a reload away (keeping the view)
		const params = new URLSearchParams( location.search );
		const rb = $( 'b-renderer' ), tip = $( 't-renderer' );
		const webgl = ! app.renderer.backend.isWebGPUBackend;
		$( 'o-renderer' ).textContent = app.backendName;
		rb.classList.toggle( 'danger', webgl );
		if ( ! webgl ) {
			rb.title = 'Trocar para WebGL 2 (recarrega mantendo a vista)';
		} else if ( params.has( 'webgl' ) ) {
			rb.title = 'Voltar ao WebGPU (recarrega mantendo a vista)';
			tip.innerHTML = 'WebGL 2 escolhido. É mais lento, e o mergulho fica sem fundo do mar, peixes e aves pousadas.';
		} else {
			rb.disabled = true;
			tip.innerHTML = 'Este navegador <strong>não tem WebGPU</strong>: o WebGL 2 é mais lento, e o mergulho fica sem fundo do mar, peixes e aves pousadas.';
		}
		rb.onclick = () => {
			const url = new URL( location.href );
			if ( webgl ) url.searchParams.delete( 'webgl' ); else url.searchParams.set( 'webgl', '' );
			url.searchParams.set( 'auto', '' );
			reloadKeepingView( app, url.href.replace( /=(?=&|$)/g, '' ), 'Renderizador: ' + ( webgl ? 'WebGPU' : 'WebGL 2' ) );
		};

		// editor: open it (or leave it) on the same view; unsaved edits ask a second click
		const eb = $( 'b-editor' ), inEditor = params.has( 'edit' );
		eb.textContent = inEditor ? 'Sair do editor' : 'Abrir editor';
		let armed = false;
		eb.onclick = () => {
			const unsaved = inEditor && [ app.editor, app.objectEditor, app.natureEditor ].some( ( e ) => e?.changed );
			if ( unsaved && ! armed ) {
				armed = true;
				eb.textContent = 'Descartar edições?';
				setTimeout( () => { armed = false; eb.textContent = 'Sair do editor'; }, 3000 );
				return;
			}
			const url = new URL( location.href );
			if ( inEditor ) url.searchParams.delete( 'edit' ); else url.searchParams.set( 'edit', '' );
			url.searchParams.set( 'auto', '' );
			reloadKeepingView( app, url.href.replace( /=(?=&|$)/g, '' ), inEditor ? 'Fora do editor' : 'Editor aberto: relevo, objetos e natureza' );
		};
	}

	setFocus( on ) {
		this.app.setFocus( on );
		$( 'c-focus' ).checked = on;
		this.toast( on ? 'Foco automático ligado' : 'Foco automático desligado' );
	}

	// Focus reticle: tightens and shows the focal distance while the
	// background is being blurred; at the screen centre, or on the clicked
	// point when the focus is locked (click to focus).
	updateFocus( f ) {
		const r = this._ret || ( this._ret = $( 'focus-reticle' ) );
		const p = f.lockNDC?.( this._fp || ( this._fp = f.camera.position.clone() ) );
		r.style.left = p ? ( ( p.x * 0.5 + 0.5 ) * 100 ).toFixed( 2 ) + '%' : '50%';
		r.style.top = p ? ( ( 0.5 - p.y * 0.5 ) * 100 ).toFixed( 2 ) + '%' : '50%';
		r.classList.toggle( 'locked', !! p );
		const a = f.enabled ? ( p ? Math.max( f.amount, 0.6 ) : f.amount ) : 0;
		r.style.opacity = ( 0.15 + 0.85 * a ).toFixed( 2 );
		r.classList.toggle( 'off', ! f.enabled );
		r.style.setProperty( '--k', ( 1 - 0.35 * a ).toFixed( 3 ) );
		if ( ( this._ft = ( this._ft || 0 ) + 1 ) % 6 === 0 ) $( 'focus-dist' ).textContent = a > 0.05 ? f.focusDistance.value.toFixed( 1 ) + ' m' : '';
	}

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
