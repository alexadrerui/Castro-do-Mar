// The time of day: a simple clock (the user's choice: no calendar, no astronomy library). The sun
// follows one fixed arc, the sun's path at this latitude (Galicia, 42.5 N) for a fixed declination,
// chosen so the scene opens where it always did (21 degrees up, bearing 238, at 15:32): an early
// October day, sunrise ~6:27, sunset ~17:33. The moon is opposite the sun, always full.
// The clock starts stopped at the opening; the panel has three presets (morning, afternoon, night),
// a button that lets the time pass and its speed. app.clock: hour, playing, speed (game hours per
// real minute), set( hour ), presets.
import * as THREE from 'three/webgpu';

const LAT = THREE.MathUtils.degToRad( 42.5 );
const DECL = THREE.MathUtils.degToRad( - 7.1 );

export const PRESETS = { manha: 9, tarde: 15 + 32 / 60, noite: 23 };

// the sun at a given hour: elevation (degrees) and azimuth (degrees clockwise from north)
export function sunAt( hour ) {
	const H = THREE.MathUtils.degToRad( ( hour - 12 ) * 15 );
	const el = Math.asin( Math.sin( LAT ) * Math.sin( DECL ) + Math.cos( LAT ) * Math.cos( DECL ) * Math.cos( H ) );
	const az = Math.atan2( - Math.sin( H ) * Math.cos( DECL ), Math.cos( LAT ) * Math.sin( DECL ) - Math.sin( LAT ) * Math.cos( DECL ) * Math.cos( H ) );
	return { elevation: THREE.MathUtils.radToDeg( el ), azimuth: ( THREE.MathUtils.radToDeg( az ) + 360 ) % 360 };
}

export class Clock {

	// app: sky (state.elevation / azimuth), onSunChanged(), sky.buildEnv()
	constructor( app ) {
		this.app = app;
		this.hour = PRESETS.tarde;
		this.playing = false;
		this.speed = 1.2;          // game hours per real minute: a day in 20 min
		this.listeners = [];       // the panel follows the hour
		this._envAt = 0;           // the elevation of the last sky environment (IBL) rebuild
		this._lastEl = null;
	}

	// jump to an hour (0-24)
	set( hour ) {
		this.hour = ( ( hour % 24 ) + 24 ) % 24;
		this._apply( true );
	}

	update( dt ) {
		if ( ! this.playing || dt <= 0 ) return;
		this.hour = ( this.hour + dt * this.speed / 60 ) % 24;
		this._apply( false );
	}

	_apply( jump ) {
		const { elevation, azimuth } = sunAt( this.hour );
		const s = this.app.sky.state;
		s.elevation = elevation; s.azimuth = azimuth;
		// the sun's dependants (sky, light, haze, water, rivers, underwater): onSunChanged() also
		// rebuilds the sky environment 250 ms after the last change, which never comes while the time
		// passes; then it is rebuilt once the sun has moved half a degree
		if ( jump || this._lastEl === null || Math.abs( elevation - this._lastEl ) > 0.02 ) {
			this.app.onSunChanged();
			this._lastEl = elevation;
		}
		if ( ! jump && Math.abs( elevation - this._envAt ) > 0.5 ) {
			this.app.sky.buildEnv();
			this._envAt = elevation;
		}
		if ( jump ) this._envAt = elevation;
		for ( const f of this.listeners ) f( this.hour );
	}

	// "15:32"
	static format( hour ) {
		const m = Math.floor( hour * 60 + 1e-6 ) % ( 24 * 60 );
		return String( Math.floor( m / 60 ) ).padStart( 2, '0' ) + ':' + String( m % 60 ).padStart( 2, '0' );
	}

}
