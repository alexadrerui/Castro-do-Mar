// Heads-up display: compass, stats, view presets, sun/sky/quality controls.
import { Clock, PRESETS } from '../world/clock.js';
import { QUALITY } from '../core/settings.js';
import { reloadKeepingView } from '../core/recovery.js';
import { wind, WIND_DEFAULTS, setWindFrom, windFrom } from '../world/wind.js';

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
		this._showPlay = showPlay;
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
		$( 'c-autoexp' ).checked = app.autoExposure > 0;
		$( 'c-autoexp' ).onchange = ( e ) => { app.autoExposure = e.target.checked ? 1 : 0; app.onSunChanged(); this.toast( e.target.checked ? 'Exposição automática ligada' : 'Exposição automática desligada' ); };
		$( 'c-paint' ).checked = !! app.paint && new URLSearchParams( location.search ).get( 'paint' ) === '1';
		$( 'c-paint' ).onchange = ( e ) => { app.setPaint( e.target.checked ); this.toast( e.target.checked ? 'Pintura a óleo ligada' : 'Pintura a óleo desligada' ); };

		this._bindWind();

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
		// the dynamic resolution's scale (core/dynamicRes.js), shown while below 100%
		app.dynRes?.listeners.push( ( k ) => { const el = $( 'st-res' ); el.hidden = k >= 1; el.textContent = Math.round( k * 100 ) + '% res'; } );
	}

	show() { this.root.hidden = false; }

	// The wind (world/wind.js): its settings open under the "Ajustes do vento" button; the breakdown
	// "Campo de vento" shows the gust field over the ground (world/windField.js, built on first use).
	_bindWind() {
		const app = this.app;
		const panel = $( 'wind-panel' ), open = $( 'b-wind' );
		open.onclick = () => { panel.hidden = ! panel.hidden; open.classList.toggle( 'on', ! panel.hidden ); };
		const compass = ( d ) => [ 'N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO' ][ Math.round( d / 45 ) % 8 ];
		const ranges = {
			strength: [ 'r-wstrength', 'o-wstrength', ( v ) => { wind.strength.value = v; }, ( v ) => v.toFixed( 2 ) + '×' ],
			speed: [ 'r-wspeed', 'o-wspeed', ( v ) => { wind.speed.value = v; }, ( v ) => v.toFixed( 1 ) + ' m/s' ],
			freq: [ 'r-wfreq', 'o-wfreq', ( v ) => { wind.freq.value = v; }, ( v ) => v.toFixed( 2 ) + '×' ],
			from: [ 'r-wdir', 'o-wdir', ( v ) => setWindFrom( v ), ( v ) => Math.round( v ) + '° ' + compass( v ) ],
			turb: [ 'r-wturb', 'o-wturb', ( v ) => { wind.turb.value = v; }, ( v ) => v.toFixed( 2 ) + '×' ]
		};
		const now = { strength: wind.strength.value, speed: wind.speed.value, freq: wind.freq.value, from: windFrom(), turb: wind.turb.value };
		for ( const [ k, [ id, out, apply, fmt ] ] of Object.entries( ranges ) ) this._range( id, out, now[ k ], apply, fmt );
		$( 'b-wreset' ).onclick = () => {
			for ( const [ k, [ id ] ] of Object.entries( ranges ) ) { const r = $( id ); r.value = WIND_DEFAULTS[ k ]; r.dispatchEvent( new Event( 'input' ) ); }
			this.toast( 'Vento restaurado' );
		};
		// the breakdown: the gust field over the ground
		const box = $( 'c-windfield' ), btn = $( 'b-windfield' );
		const setField = async ( on ) => {
			if ( on && ! app.windField ) {
				const { createWindField } = await import( '../world/windField.js' );
				app.windField = createWindField( app );
			}
			if ( app.windField ) app.windField.visible = on;
			box.checked = on; btn.classList.toggle( 'on', on );
		};
		app.setWindField = setField;
		box.onchange = () => setField( box.checked );
		btn.onclick = () => { setField( ! app.windField?.visible ); this.toast( app.windField?.visible ? 'Campo de vento' : 'Campo de vento desligado' ); };
	}

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

	// For the shared visit (core/multiplayer.js): a slider set through its own input event (the same
	// path as the hand, so the setter and the readout follow), and the time passing on or off.
	setRange( id, v ) {
		const r = $( id );
		if ( Math.abs( + r.value - v ) < 1e-6 ) return;
		r.value = v;
		r.dispatchEvent( new Event( 'input' ) );
	}

	setPlaying( on ) {
		this.app.clock.playing = on;
		this._showPlay();
	}

	// The panel's "Amigos": invite (opens a room and copies its link), the name, the friends (a click
	// flies to one), the shared hour and weather, leaving the room.
	bindMultiplayer( mp ) {
		const panel = $( 'mp-panel' ), tip = $( 't-mp' ), list = $( 'mp-list' ), name = $( 'i-name' ), inv = $( 'b-invite' );
		const show = () => {
			panel.hidden = ! mp.room;
			inv.textContent = mp.room ? 'Copiar link' : 'Convidar';
			tip.innerHTML = mp.note;
			list.replaceChildren( ...[ ...mp.peers ].filter( ( [ , p ] ) => p.name ).map( ( [ id, p ] ) => {
				const b = document.createElement( 'button' );
				b.textContent = '➜ ' + p.name;
				b.title = 'Voar até ' + p.name;
				b.onclick = () => mp.goTo( id );
				return b;
			} ) );
		};
		mp.listeners.push( show );
		inv.onclick = () => mp.invite();
		name.value = mp.name;
		name.addEventListener( 'change', () => { mp.rename( name.value ); name.value = mp.name; } );
		name.addEventListener( 'keydown', ( e ) => { e.stopPropagation(); if ( e.key === 'Enter' ) name.blur(); } );
		$( 'c-mpworld' ).onchange = ( e ) => { mp.shareWorld = e.target.checked; };
		$( 'b-mpleave' ).onclick = () => { mp.leave(); this.toast( 'Fora da sala' ); };
		// Entrar com código: the room of a friend, by its code or its link
		const code = $( 'i-room' );
		const join = async () => { if ( await mp.joinCode( code.value ) ) code.value = ''; };
		$( 'b-join' ).onclick = join;
		code.addEventListener( 'keydown', ( e ) => { e.stopPropagation(); if ( e.key === 'Enter' ) join(); } );
		show();
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

	toast( msg, ms = 1800 ) {
		const t = $( 'toast' );
		t.textContent = msg; t.classList.add( 'show' );
		clearTimeout( this._tt ); this._tt = setTimeout( () => t.classList.remove( 'show' ), ms );
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
