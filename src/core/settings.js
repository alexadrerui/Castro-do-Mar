// The player's options (the panel's "Opções"), organised after the options menu of Bruno Simon's
// Folio 2025 (https://github.com/brunosimon/folio-2025, sources/Game/Options.js, Quality.js and the
// mute of Audio.js; MIT License, Copyright (c) 2025 Bruno Simon, licenses/LICENSE-folio-2025.md):
// a quality level that the rest listens to (events), the sound muted or not kept in localStorage,
// the renderer in use with a warning on the WebGL fallback. Here the quality is three presets over
// the image controls that already exist (resolution, shadows, reflection, focus, bloom), the audio
// has a volume too, and the renderer can be switched (a reload, like opening the editor, keeping the
// view: core/recovery.js reloadKeepingView).

const KEY = 'castroDoMar:settings';

// Each preset sets the image controls; 'media' is the default look (main.js), so a first visit
// (nothing stored) is not touched at all.
export const QUALITY = {
	// shadowReach: how far trees and rocks cast (m; the hills always, through world/terrainShadow.js);
	// ao: the ambient occlusion (main.js setAO: 'off' | 'low' | 'high', as the offroad's presets)
	baixa: { label: 'Baixa', pixelRatio: 0.75, shadows: false, shadowReach: 250, reflections: false, focus: false, bloom: false, ao: 'off' },
	media: { label: 'Média', pixelRatio: 1, shadows: true, shadowReach: 250, reflections: true, focus: true, bloom: true, ao: 'low' },
	alta: { label: 'Alta', pixelRatio: 1, shadows: true, shadowReach: 420, reflections: true, focus: true, bloom: true, ao: 'high' }
};

const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test( navigator.userAgent );

function load() {
	try { return JSON.parse( localStorage.getItem( KEY ) ) ?? {}; } catch ( e ) { return {}; }
}

export class Settings {

	constructor( app ) {
		this.app = app;
		this.listeners = { quality: [], audio: [] };
		const s = load();
		// as in the original: phones start low
		this.quality = QUALITY[ s.quality ] ? s.quality : isMobile ? 'baixa' : 'media';
		this.muted = s.muted === true;
		this.volume = Number.isFinite( s.volume ) ? Math.min( 1, Math.max( 0, s.volume ) ) : 0.8;
		// the visitor's name in a shared visit (core/multiplayer.js)
		this.name = typeof s.name === 'string' ? s.name.slice( 0, 24 ) : '';
		// a stored (or phone) quality is applied once the world is up; the default is the look as built
		if ( this.quality !== 'media' ) this.applyQuality();
		this.applyAudio();
	}

	on( type, f ) { this.listeners[ type ].push( f ); }

	_save() {
		try { localStorage.setItem( KEY, JSON.stringify( { quality: this.quality, muted: this.muted, volume: this.volume, name: this.name } ) ); } catch ( e ) { /* no storage */ }
	}

	setQuality( level ) {
		if ( ! QUALITY[ level ] ) return;
		this.quality = level;
		this.applyQuality();
		this._save();
	}

	// through the app's own setters, the same the panel's checkboxes call
	applyQuality() {
		const q = QUALITY[ this.quality ], app = this.app;
		app.setPixelRatio( Math.min( q.pixelRatio, devicePixelRatio || 1 ) );
		app.setShadows( q.shadows );
		app.shadows?.setReach( q.shadowReach );
		app.setReflections( q.reflections );
		app.setFocus( q.focus );
		app.setBloom( q.bloom );
		app.setAO( q.ao );
		for ( const f of this.listeners.quality ) f( this.quality, q );
	}

	setName( name ) {
		this.name = String( name ).slice( 0, 24 );
		this._save();
	}

	// unmuting at volume 0 (the slider pulled down) brings a volume back
	toggleMute() { this.setAudio( ! this.muted, this.muted && this.volume === 0 ? 0.8 : this.volume ); }

	setAudio( muted, volume ) {
		this.muted = muted; this.volume = volume;
		this.applyAudio();
		this._save();
	}

	// the ambience (audio/ambience.js) carries the thunder too: its master volume is the one
	applyAudio() {
		const amb = this.app.ambience, l = this.app.lightning;
		amb?.setAudio( this.muted, this.volume );
		if ( l ) { l.sound = ! this.muted; l.volume = amb ? 1 : this.volume; }
		document.documentElement.classList.toggle( 'is-audio-muted', this.muted );
		for ( const f of this.listeners.audio ) f( this.muted, this.volume );
	}

	get webgpuAvailable() { return typeof navigator !== 'undefined' && !! navigator.gpu; }

}
