// Dynamic resolution: the scene is drawn at fewer pixels when the frame rate drops, never above the
// user's choice (the panel's "Resolução" stays the canvas' pixel ratio). The rule is offroad's
// updateDynamicResolution (https://github.com/alexadrerui/offroad, main.js, MIT, Copyright (c) 2026
// Arz-Gev, licenses/LICENSE-offroad.md): steps of 12.5% judged over 2.5 s windows, a step up at >= 57
// fps and down below 45; the window after a change is skipped (it holds the change's own hitch); a step
// up that lands under 50 fps goes back down and that level is blocked for 60 s, so it does not bounce.
// Different here: only the scene pass is scaled (PassNode.setResolutionScale), not the canvas, so the
// HUD, the clouds, the bloom and the grade keep their resolution and nothing else is reallocated (the
// old version changed the renderer's pixel ratio, which resized every target at each step); and a
// window with a stall in it (a hidden tab, a load) is thrown away.
// Stages (the idea of Ascent, github.com/hapybeing/Ascent: the clouds get cheaper first, the
// resolution drops last): cheaper looks switched on one by one before the first step of resolution,
// and switched off last on the way back up (addStage; main.js: the clouds' longer march steps).
// The ladder is one list of levels: 0 = everything full, 1..stages = stages on, then the resolution
// steps; the rule above moves along it one level per window.

const STEP = 0.125, MIN = 0.5;        // 100% .. 50% of the pixels per side
const WINDOW = 2.5;                    // s
const UP_FPS = 57, DOWN_FPS = 45, BACK_FPS = 50;
const BLOCK = 60;                      // s a level stays blocked after a failed step up
const STALL = 0.25;                    // s: a longer frame throws the window away

export class DynamicResolution {

	// scenePass: the PassNode drawn at the scale
	constructor( scenePass ) {
		this.pass = scenePass;
		this.enabled = true;
		this.scale = 1;
		this.level = 0;
		this.stages = [];              // { name, apply( on ) }, cheapest loss first
		this.listeners = [];
		this._t = 0; this._n = 0;
		this._skip = false;
		this._probe = 0;               // the level a step up just tried, + 1 (0: none)
		this._blocked = new Map();     // level -> time it is free again
		this._now = 0;
	}

	// a cheaper look, switched on before the resolution drops (apply( true )) and off after it is back
	addStage( name, apply ) {
		this.stages.push( { name, apply, on: false } );
	}

	get maxLevel() { return this.stages.length + Math.round( ( 1 - MIN ) / STEP ); }

	// the stages that are on (names), for the HUD and the debug panel
	get active() { return this.stages.filter( ( s ) => s.on ).map( ( s ) => s.name ); }

	// a resolution scale: below 1 every stage is on too; 1 switches them all off
	set( scale ) {
		scale = Math.max( MIN, Math.min( 1, Math.round( scale / STEP ) * STEP ) );
		this.setLevel( scale < 1 ? this.stages.length + Math.round( ( 1 - scale ) / STEP ) : 0 );
	}

	setLevel( level ) {
		level = Math.max( 0, Math.min( this.maxLevel, level ) );
		const S = this.stages.length;
		const scale = 1 - STEP * Math.max( 0, level - S );
		let changed = level !== this.level;
		this.level = level;
		this.stages.forEach( ( st, i ) => {
			const on = i < level;
			if ( on !== st.on ) { st.on = on; st.apply( on ); }
		} );
		if ( scale !== this.scale ) {
			this.scale = scale;
			this.pass.setResolutionScale( scale );
			changed = true;
		}
		if ( changed ) for ( const f of this.listeners ) f( this.scale, this.active );
	}

	// rawDt: the frame's real duration (not the clamped one the simulation uses)
	update( rawDt ) {
		this._now += rawDt;
		if ( ! this.enabled ) { if ( this.level !== 0 ) this.setLevel( 0 ); return; }
		if ( rawDt > STALL || ( typeof document !== 'undefined' && document.hidden ) ) { this._t = 0; this._n = 0; return; }
		this._t += rawDt; this._n ++;
		if ( this._t < WINDOW ) return;
		const fps = this._n / this._t;
		this._t = 0; this._n = 0;
		if ( this._skip ) { this._skip = false; return; }
		const l = this.level;
		if ( this._probe ) {
			const tried = this._probe;
			this._probe = 0;
			if ( fps < BACK_FPS ) { this._blocked.set( tried - 1, this._now + BLOCK ); this._change( l + 1 ); return; }
		}
		if ( fps >= UP_FPS && l > 0 ) {
			const up = l - 1;
			if ( ( this._blocked.get( up ) ?? 0 ) > this._now ) return;
			this._probe = up + 1; // +1: level 0 is a valid probe too
			this._change( up );
		} else if ( fps < DOWN_FPS && l < this.maxLevel ) {
			this._change( l + 1 );
		}
	}

	_change( level ) {
		this.setLevel( level );
		this._skip = true;
	}

}
