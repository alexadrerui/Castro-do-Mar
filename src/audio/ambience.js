// Ambient sound, all synthesised with WebAudio (no sound files; the user's choice): the sea breaking
// on the shore, the wind (stronger up high and in a storm, whistling on the crests, the leaves in the
// woods), the rain, gulls along the coast and songbirds in the woods by day (a dawn chorus), crickets
// and a tawny owl at night, the hearths crackling by the houses, rivers and falls, and underwater
// everything muffled with a rumble and bubbles. The thunder (world/lightning.js) plays through the
// same bus, so the panel's volume and mute (core/settings.js) hold for all of it.
//
// The AudioContext starts on the first click or key (the browsers' autoplay rule: the loader's
// "Entrar" button is one); before that, and in the headless QA, nothing runs. Muted, or with the
// window in the background (as in Folio 2025's Audio.js), the context is suspended.
//
// Every layer is a loop or a scheduled voice whose gain follows the place, ~12 times a second:
// - the sea: the distance to the nearest shoreline cell of a 10 m grid built at the load from the
//   relief (nearest-seed chamfer transform), with the altitude; it pans to the side of the shore;
// - the wind: height above the ground, the storm, sheltered in the woods;
// - the birds: a 64 m grid of the trees (vegetation instances) counted at the load;
// - the fire: the hearths of the houses (buildings.js smoke sources); rivers: their samples and falls.
import { WATER_LEVEL } from '../world/layout.js';

const TICK = 1 / 12;
// the rain recording's level at full rain (it is ~-27 dB RMS): about the synthesised one's -29 dB
const RAIN_GAIN = 0.75;
const clamp01 = ( v ) => Math.min( 1, Math.max( 0, v ) );
const sstep = ( a, b, x ) => { const t = clamp01( ( x - a ) / ( b - a ) ); return t * t * ( 3 - 2 * t ); };
const rnd = ( a, b ) => a + Math.random() * ( b - a );

// ------------------------------------------------------------------ buffers

function noise( ctx, seconds, kind ) {
	const n = Math.floor( seconds * ctx.sampleRate ), buf = ctx.createBuffer( 2, n, ctx.sampleRate );
	for ( let ch = 0; ch < 2; ch ++ ) {
		const d = buf.getChannelData( ch );
		let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
		for ( let i = 0; i < n; i ++ ) {
			const w = Math.random() * 2 - 1;
			if ( kind === 'white' ) d[ i ] = w * 0.5;
			else if ( kind === 'pink' ) { // Paul Kellet's filter
				b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
				b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = - 0.7616 * b5 - w * 0.016898;
				d[ i ] = ( b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362 ) * 0.11; b6 = w * 0.115926;
			} else { last = ( last + 0.02 * w ) / 1.02; d[ i ] = last * 3.5; } // brown
		}
		// a seamless loop: cross-fade the last 50 ms into the start
		const f = Math.floor( 0.05 * ctx.sampleRate );
		for ( let i = 0; i < f; i ++ ) { const t = i / f; d[ i ] = d[ i ] * t + d[ n - f + i ] * ( 1 - t ); }
		for ( let i = n - f; i < n; i ++ ) d[ i ] = d[ i - n + f ];
	}
	return buf;
}

// a few crickets (Gryllus), each a ~4.5 kHz carrier in chirps of 3-4 pulses at ~30 Hz, 2-3 chirps a
// second, panned apart; looped
function crickets( ctx, seconds = 4 ) {
	const sr = ctx.sampleRate, n = Math.floor( seconds * sr ), buf = ctx.createBuffer( 2, n, sr );
	const L = buf.getChannelData( 0 ), R = buf.getChannelData( 1 );
	for ( let c = 0; c < 7; c ++ ) {
		const f = rnd( 4100, 5000 ), rate = Math.round( rnd( 2, 3.2 ) * seconds ) / seconds, pulses = Math.random() < 0.5 ? 3 : 4;
		const prf = rnd( 26, 34 ), ph = Math.random(), amp = rnd( 0.15, 0.5 ), pan = rnd( - 0.9, 0.9 );
		const gl = amp * Math.sqrt( ( 1 - pan ) / 2 ), gr = amp * Math.sqrt( ( 1 + pan ) / 2 );
		for ( let i = 0; i < n; i ++ ) {
			const t = i / sr, cp = ( ( t * rate + ph ) % 1 ) / rate; // time into the chirp
			const k = cp * prf;
			if ( k >= pulses ) continue;
			const p = k % 1, env = p < 0.6 ? Math.sin( Math.PI * p / 0.6 ) : 0;
			const s = Math.sin( 2 * Math.PI * f * t ) * env;
			L[ i ] += s * gl; R[ i ] += s * gr;
		}
	}
	return buf;
}

// a hearth: crackles (short decaying noise bursts) over a low roar; looped
function fire( ctx, seconds = 5 ) {
	const sr = ctx.sampleRate, n = Math.floor( seconds * sr ), buf = ctx.createBuffer( 2, n, sr );
	for ( let ch = 0; ch < 2; ch ++ ) {
		const d = buf.getChannelData( ch );
		let last = 0;
		for ( let i = 0; i < n; i ++ ) { last = ( last + 0.02 * ( Math.random() * 2 - 1 ) ) / 1.02; d[ i ] = last * 1.2; }
		const pops = Math.floor( seconds * rnd( 18, 26 ) );
		for ( let k = 0; k < pops; k ++ ) {
			const at = Math.floor( Math.random() * ( n - sr * 0.03 ) ), len = Math.floor( sr * rnd( 0.002, 0.018 ) ), a = Math.random() ** 2 * 0.9;
			for ( let i = 0; i < len; i ++ ) d[ at + i ] += ( Math.random() * 2 - 1 ) * a * Math.exp( - 6 * i / len );
		}
	}
	return buf;
}

// ------------------------------------------------------------------ fields over the map

// distance to the sea's shoreline: a 10 m grid, each cell with its nearest shoreline cell
function shoreField( hf ) {
	const S = 4, m = Math.ceil( hf.n / S ), cell = hf.cell * S, N = m * m;
	const wet = new Uint8Array( N );
	for ( let j = 0; j < m; j ++ ) for ( let i = 0; i < m; i ++ ) wet[ j * m + i ] = hf.data[ Math.min( hf.n - 1, j * S ) * hf.n + Math.min( hf.n - 1, i * S ) ] < WATER_LEVEL ? 1 : 0;
	const near = new Int32Array( N ).fill( - 1 ), dist = new Float32Array( N ).fill( 1e9 );
	for ( let j = 1; j < m - 1; j ++ ) for ( let i = 1; i < m - 1; i ++ ) {
		const k = j * m + i;
		if ( wet[ k ] && ( ! wet[ k - 1 ] || ! wet[ k + 1 ] || ! wet[ k - m ] || ! wet[ k + m ] ) ) { near[ k ] = k; dist[ k ] = 0; }
	}
	const relax = ( k, q ) => {
		if ( near[ q ] < 0 ) return;
		const s = near[ q ], dx = ( s % m ) - ( k % m ), dz = Math.floor( s / m ) - Math.floor( k / m ), d = dx * dx + dz * dz;
		if ( d < dist[ k ] ) { dist[ k ] = d; near[ k ] = s; }
	};
	for ( let j = 1; j < m; j ++ ) for ( let i = 1; i < m - 1; i ++ ) { const k = j * m + i; relax( k, k - 1 ); relax( k, k - m ); relax( k, k - m - 1 ); relax( k, k - m + 1 ); }
	for ( let j = m - 2; j >= 0; j -- ) for ( let i = m - 2; i > 0; i -- ) { const k = j * m + i; relax( k, k + 1 ); relax( k, k + m ); relax( k, k + m + 1 ); relax( k, k + m - 1 ); }
	return {
		// the nearest shoreline point [ x, z ] and whether the cell is sea
		at( x, z ) {
			const i = Math.round( ( x - hf.x0 ) / cell ), j = Math.round( ( z - hf.z0 ) / cell );
			if ( i < 0 || j < 0 || i >= m || j >= m ) return null;
			const s = near[ j * m + i ];
			return s < 0 ? null : { x: hf.x0 + ( s % m ) * cell, z: hf.z0 + Math.floor( s / m ) * cell, sea: wet[ j * m + i ] === 1 };
		}
	};
}

// trees per 64 m cell (oaks, pines, birches), from the vegetation instances
function forestField( vegetation, hf ) {
	const C = 64, m = Math.ceil( hf.size / C ), count = new Float32Array( m * m ), seen = new Set();
	vegetation?.traverse( ( o ) => {
		const ins = o.userData?.instances, sp = o.parent?.name;
		if ( ! ins || seen.has( ins.matrices ) || ! [ 'oak', 'pine', 'birch' ].includes( sp ) ) return;
		seen.add( ins.matrices );
		for ( let k = 0; k < ins.count; k ++ ) {
			const i = Math.floor( ( ins.matrices[ k * 16 + 12 ] - hf.x0 ) / C ), j = Math.floor( ( ins.matrices[ k * 16 + 14 ] - hf.z0 ) / C );
			if ( i >= 0 && j >= 0 && i < m && j < m ) count[ j * m + i ] ++;
		}
	} );
	return {
		// 0..1: ~25 trees a cell is a wood
		at( x, z ) {
			const fx = ( x - hf.x0 ) / C - 0.5, fz = ( z - hf.z0 ) / C - 0.5, i = Math.floor( fx ), j = Math.floor( fz ), u = fx - i, v = fz - j;
			const g = ( a, b ) => ( a < 0 || b < 0 || a >= m || b >= m ) ? 0 : count[ b * m + a ];
			const c = ( g( i, j ) * ( 1 - u ) + g( i + 1, j ) * u ) * ( 1 - v ) + ( g( i, j + 1 ) * ( 1 - u ) + g( i + 1, j + 1 ) * u ) * v;
			return clamp01( c / 25 );
		}
	};
}

// ------------------------------------------------------------------ the mixer

export class Ambience {

	constructor( app ) {
		this.app = app;
		this.volume = 0.8; this.muted = false;
		this.ctx = null;
		this.levels = {}; // the layers' current targets (QA: tools/ambience.mjs)
		this._acc = 0;
		this._fields = null;
		const start = () => { if ( ! this.muted ) this.start(); };
		addEventListener( 'pointerdown', start, { once: false, passive: true } );
		addEventListener( 'keydown', start, { passive: true } );
		addEventListener( 'blur', () => this.ctx?.suspend() );
		addEventListener( 'focus', () => { if ( this.ctx && ! this.muted ) this.ctx.resume(); } );
	}

	// the panel (core/settings.js)
	setAudio( muted, volume ) {
		this.muted = muted; this.volume = volume;
		// unmuted by a click on the panel: that click is the gesture that may start it
		if ( ! this.ctx ) { if ( ! muted && navigator.userActivation?.hasBeenActive ) this.start(); return; }
		this.master.gain.setTargetAtTime( muted ? 0 : volume, this.ctx.currentTime, 0.1 );
		if ( muted ) this.ctx.suspend(); else this.ctx.resume();
	}

	// the thunder's way out (world/lightning.js): null before the first gesture
	output() { return this.ctx ? { ctx: this.ctx, destination: this.air } : null; }

	start() {
		if ( this.ctx ) { if ( this.ctx.state === 'suspended' && document.hasFocus() ) this.ctx.resume(); return; }
		if ( typeof AudioContext === 'undefined' ) return;
		const ctx = this.ctx = new AudioContext();
		const app = this.app;
		this._fields = { shore: shoreField( app.hf ), forest: forestField( app.layers.vegetation?.object, app.hf ) };
		// master <- [ air (muffled underwater) <- the layers above the water ] + the underwater layer
		this.master = ctx.createGain(); this.master.gain.value = 0;
		this.master.connect( ctx.destination );
		this.master.gain.setTargetAtTime( this.muted ? 0 : this.volume, ctx.currentTime + 0.2, 1.2 ); // a soft start
		this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
		this.muffleGain = ctx.createGain();
		this.muffle.connect( this.muffleGain ).connect( this.master );
		this.air = ctx.createGain(); this.air.connect( this.muffle );
		const B = { white: noise( ctx, 5, 'white' ), pink: noise( ctx, 6, 'pink' ), brown: noise( ctx, 7, 'brown' ) };
		this.B = B;
		// a looping source -> filters -> gain -> panner -> out
		const loop = this._loop = ( buf, filters, out = this.air, rate = 1 ) => {
			const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
			src.loopStart = 0; src.start( 0, Math.random() * buf.duration );
			let node = src;
			const fs = filters.map( ( [ type, f, q = 0.7 ] ) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; node.connect( b ); node = b; return b; } );
			const g = ctx.createGain(); g.gain.value = 0;
			const p = ctx.createStereoPanner();
			node.connect( g ).connect( p ).connect( out );
			return { src, f: fs, g, p };
		};
		this.L = {
			seaBase: loop( B.brown, [ [ 'lowpass', 420 ] ] ),
			seaWashA: loop( B.pink, [ [ 'lowpass', 600 ], [ 'highpass', 120 ] ] ),
			seaWashB: loop( B.pink, [ [ 'lowpass', 600 ], [ 'highpass', 120 ] ], this.air, 0.93 ),
			wind: loop( B.pink, [ [ 'bandpass', 420, 0.6 ] ] ),
			whistle: loop( B.white, [ [ 'bandpass', 1200, 9 ] ] ),
			leaves: loop( B.pink, [ [ 'highpass', 1800 ], [ 'lowpass', 7000 ] ] ),
			rain: loop( B.pink, [ [ 'highpass', 700 ], [ 'lowpass', 4500 ] ] ), // a soft hiss, not a white one
			rainLow: loop( B.pink, [ [ 'lowpass', 500 ] ] ),
			river: loop( B.pink, [ [ 'bandpass', 900, 0.5 ] ] ),
			riverHiss: loop( B.white, [ [ 'highpass', 2500 ], [ 'lowpass', 9000 ] ] ),
			falls: loop( B.brown, [ [ 'lowpass', 1400 ] ] ),
			fallsHiss: loop( B.pink, [ [ 'highpass', 600 ] ] ),
			crickets: loop( crickets( ctx ), [ [ 'highpass', 2500 ] ] ),
			fire: loop( fire( ctx ), [ [ 'highpass', 60 ] ] ),
			under: loop( B.brown, [ [ 'lowpass', 220 ] ], this.master )
		};
		this.waves = { next: ctx.currentTime + 1, voice: 0 };
		this.gust = { v: 0.5, target: 0.5, next: 0 };
		this.calls = { gull: ctx.currentTime + 3, song: ctx.currentTime + 2, owl: ctx.currentTime + 10, bubble: 0 };
		app.lightning && ( app.lightning.output = () => this.output() );
		console.info( 'ambience: started' );
	}

	update( dt ) {
		if ( ! this.ctx || this.ctx.state !== 'running' ) return;
		this._acc += dt;
		if ( this._acc < TICK ) return;
		this._acc = 0;
		const app = this.app, ctx = this.ctx, t = ctx.currentTime, cam = app.camera, p = cam.position;
		const L = this.L, F = this._fields, set = ( node, v, tc = 0.35 ) => node.gain.setTargetAtTime( v, t, tc );
		// the listener: right vector of the view, for panning a source on the map
		const d = cam.getWorldDirection( this._d || ( this._d = p.clone() ) );
		const rx = - d.z, rz = d.x, rl = Math.hypot( rx, rz ) || 1;
		const panTo = ( x, z ) => { const dx = x - p.x, dz = z - p.z, l = Math.hypot( dx, dz ) || 1; return Math.max( - 0.85, Math.min( 0.85, ( dx * rx + dz * rz ) / ( l * rl ) ) ); };

		// the state of the world
		const ground = app.hf.heightAt( p.x, p.z ), wl = app.rivers?.levelAt( p.x, p.z ) ?? app.lakes?.levelAt( p.x, p.z ) ?? WATER_LEVEL;
		const under = app.underwater?.on.value > 0.5;
		const alt = p.y - Math.max( ground, wl );
		const rain = app.weather?.level ?? 0, night = app.sky.state.night ?? 0;
		const day = app.birdsAwake ? 1 - night : 0, hour = app.clock?.hour ?? 15;
		const forest = F.forest.at( p.x, p.z ) * ( 1 - sstep( 20, 120, alt ) );
		// underwater: everything above the surface heard through it
		this.muffle.frequency.setTargetAtTime( under ? 320 : 20000, t, 0.15 );
		this.muffleGain.gain.setTargetAtTime( under ? 0.35 : 1, t, 0.15 );
		const lv = this.levels;

		// --- the sea
		const sh = F.shore.at( p.x, p.z );
		let sea = 0, seaPan = 0;
		if ( sh ) {
			const dist = Math.hypot( Math.hypot( sh.x - p.x, sh.z - p.z ), Math.max( 0, p.y - WATER_LEVEL ) );
			sea = Math.exp( - dist / 90 ) * 0.9 + ( sh.sea ? 0.18 : 0 ) * ( 1 - sstep( 30, 300, alt ) );
			seaPan = sh.sea ? 0 : panTo( sh.x, sh.z ) * clamp01( dist / 25 );
		}
		lv.sea = sea;
		set( L.seaBase.g, sea * 0.55 ); L.seaBase.p.pan.setTargetAtTime( seaPan, t, 0.3 );
		// the breakers: two voices taking turns, swelling then hissing out as the wave spends itself
		if ( t > this.waves.next ) {
			const v = this.waves.voice ^= 1, w = v ? L.seaWashA : L.seaWashB, peak = sea * rnd( 0.5, 1.0 ), rise = rnd( 1.2, 2.2 ), fall = rnd( 2.5, 4.5 );
			w.g.gain.cancelScheduledValues( t ); w.g.gain.setValueAtTime( w.g.gain.value, t );
			w.g.gain.linearRampToValueAtTime( peak * 0.85, t + rise ); w.g.gain.setTargetAtTime( 0, t + rise, fall / 3 );
			const f = w.f[ 0 ].frequency;
			f.cancelScheduledValues( t ); f.setValueAtTime( 450, t ); f.exponentialRampToValueAtTime( rnd( 1800, 3200 ), t + rise ); f.setTargetAtTime( 500, t + rise, fall / 2.5 );
			w.p.pan.setValueAtTime( seaPan + rnd( - 0.15, 0.15 ), t );
			this.waves.next = t + rnd( 4.5, 9 );
		}

		// --- the wind: gusts (a random walk), up high, in the storm; the woods shelter
		const g = this.gust;
		if ( t > g.next ) { g.target = rnd( 0.2, 1 ); g.next = t + rnd( 2, 6 ); }
		g.v += ( g.target - g.v ) * 0.08;
		const calm = 1 - 0.55 * night; // the night is calmer (as the leaves, main.js onSunChanged)
		// exposed: high over the ground below, or high over the sea (a summit has its ground right underfoot)
		const exposed = Math.max( sstep( 8, 180, alt ), sstep( 40, 300, p.y - WATER_LEVEL ) );
		lv.exposed = exposed;
		const wind = ( 0.1 + 0.5 * exposed + 0.25 * sstep( 0.4, 1, rain ) ) * ( 0.45 + 0.55 * g.v ) * calm * ( 1 - 0.5 * forest );
		lv.wind = wind;
		set( L.wind.g, wind * 0.9, 0.6 ); L.wind.f[ 0 ].frequency.setTargetAtTime( 260 + 520 * g.v, t, 0.8 );
		set( L.whistle.g, wind * 0.12 * exposed * g.v, 0.8 ); L.whistle.f[ 0 ].frequency.setTargetAtTime( 900 + 900 * g.v, t, 1.2 );
		lv.leaves = forest * ( 0.3 + 0.7 * g.v ) * calm;
		set( L.leaves.g, lv.leaves * 0.2, 0.5 );

		// --- the rain: the recording (public/audio/light-rain.mp3, fetched the first time it rains),
		// the synthesised hiss until it is in (or if it fails)
		lv.rain = rain;
		if ( rain > 0.01 && ! this._rainLoading ) this._loadRain();
		const rec = lv.rainRec = L.rainRec ? 1 : 0;
		set( L.rain.g, Math.pow( rain, 0.8 ) * 0.3 * ( 1 - rec ), 0.8 ); set( L.rainLow.g, rain * 0.08 * ( 1 - rec ), 0.8 );
		if ( rec ) set( L.rainRec.g, Math.pow( rain, 0.8 ) * RAIN_GAIN, 0.8 );

		// --- rivers and falls: the nearest sample (every 3rd) and the nearest fall
		let river = 0, riverPan = 0, falls = 0, fallsPan = 0;
		for ( const r of app.rivers?.list ?? [] ) {
			const S = r.course.samples;
			for ( let i = 0; i < S.length; i += 3 ) {
				const s = S[ i ], dd = Math.hypot( s.x - p.x, s.z - p.z, ( s.y ?? ground ) - p.y );
				const v = Math.exp( - dd / 35 ) * Math.min( 1, s.width / 8 + 0.3 );
				if ( v > river ) { river = v; riverPan = panTo( s.x, s.z ); }
			}
			for ( const f of r.course.falls ) {
				const s = S[ f.foot ], dd = Math.hypot( s.x - p.x, s.z - p.z, ( s.y ?? ground ) - p.y );
				const v = Math.exp( - dd / 80 ) * Math.min( 1.4, f.drop / 12 );
				if ( v > falls ) { falls = v; fallsPan = panTo( s.x, s.z ); }
			}
		}
		lv.river = river; lv.falls = falls;
		set( L.river.g, river * 0.35 ); set( L.riverHiss.g, river * 0.12 );
		L.river.p.pan.setTargetAtTime( riverPan, t, 0.3 ); L.riverHiss.p.pan.setTargetAtTime( riverPan, t, 0.3 );
		set( L.falls.g, falls * 0.55 ); set( L.fallsHiss.g, falls * 0.3 );
		L.falls.p.pan.setTargetAtTime( fallsPan, t, 0.3 ); L.fallsHiss.p.pan.setTargetAtTime( fallsPan, t, 0.3 );

		// --- the hearths
		let fireV = 0, firePan = 0, best = 1e9;
		for ( const h of app.hearths ?? [] ) {
			const dd = Math.hypot( h.x - p.x, h.y - p.y, h.z - p.z );
			fireV += Math.exp( - dd / 9 );
			if ( dd < best ) { best = dd; firePan = panTo( h.x, h.z ); }
		}
		lv.fire = Math.min( 1, fireV ) * ( 1 - 0.6 * rain );
		set( L.fire.g, lv.fire * 0.4 ); L.fire.p.pan.setTargetAtTime( firePan * clamp01( best / 4 ), t, 0.3 );

		// --- night: crickets in the open, low, on land, not in the rain
		const land = sh ? ! sh.sea : true;
		lv.crickets = sstep( 0.3, 0.8, night ) * ( land ? 1 : 0 ) * ( 1 - sstep( 15, 80, alt ) ) * ( 1 - 0.7 * forest ) * ( 1 - sstep( 0.1, 0.4, rain ) );
		set( L.crickets.g, lv.crickets * 0.09, 1.5 );

		// --- underwater
		lv.under = under ? 1 : 0;
		set( L.under.g, under ? 0.3 : 0, 0.15 );
		if ( under && t > this.calls.bubble ) { this._bubble( t ); this.calls.bubble = t + rnd( 0.3, 2.5 ); }

		if ( under ) return;
		// --- gulls along the coast by day
		const coast = sh ? Math.exp( - Math.hypot( sh.x - p.x, sh.z - p.z ) / 220 ) : 0;
		lv.gulls = coast * day * ( 1 - sstep( 0.3, 0.7, rain ) );
		if ( t > this.calls.gull ) {
			if ( Math.random() < lv.gulls ) this._gull( t, rnd( 0.4, 1 ) * lv.gulls );
			this.calls.gull = t + rnd( 2.5, 9 );
		}
		// --- songbirds in the woods by day, a chorus at dawn
		const dawn = 1 + 1.2 * Math.exp( - ( ( ( hour - 7 ) / 1.3 ) ** 2 ) );
		lv.birds = forest * day * ( 1 - sstep( 0.2, 0.6, rain ) ) * dawn;
		if ( t > this.calls.song ) {
			if ( Math.random() < Math.min( 1, lv.birds ) ) this._song( t, Math.min( 1, lv.birds ) );
			this.calls.song = t + rnd( 0.8, 4 ) / Math.max( 0.4, dawn );
		}
		// --- a tawny owl at night in the woods
		lv.owl = forest * sstep( 0.5, 0.9, night ) * ( 1 - sstep( 0.1, 0.4, rain ) );
		if ( t > this.calls.owl ) {
			if ( Math.random() < lv.owl ) this._owl( t, lv.owl );
			this.calls.owl = t + rnd( 12, 35 );
		}
	}

	async _loadRain() {
		this._rainLoading = true;
		try {
			const res = await fetch( ( import.meta.env?.BASE_URL ?? '/' ) + 'audio/light-rain.mp3' );
			if ( ! res.ok ) throw new Error( res.status );
			const buf = await this.ctx.decodeAudioData( await res.arrayBuffer() );
			// the file is a seamless loop (its end cross-faded into its start); 30 ms more against the decoder's edges
			const f = Math.floor( 0.03 * buf.sampleRate ), n = buf.length;
			for ( let ch = 0; ch < buf.numberOfChannels; ch ++ ) {
				const d = buf.getChannelData( ch );
				for ( let i = 0; i < f; i ++ ) { const t = i / f; d[ i ] = d[ i ] * t + d[ n - f + i ] * ( 1 - t ); }
			}
			this.L.rainRec = this._loop( buf, [ [ 'highpass', 70 ] ] );
		} catch ( e ) { console.warn( 'ambience: rain recording not loaded, the synthesised rain stays', e ); }
	}

	// ------------------------------------------------------------------ voices

	// one voice: oscillator -> bandpass -> envelope -> panner -> air; the caller shapes the frequency
	_voice( t, { type = 'sine', band = null, q = 1, pan = 0, gain = 0.2, len = 0.3, attack = 0.015, far = 1, out = this.air } ) {
		const ctx = this.ctx, o = ctx.createOscillator(); o.type = type;
		let node = o;
		if ( band ) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = band; b.Q.value = q; node.connect( b ); node = b; }
		// a far bird: duller
		const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500 + 9000 * far; node.connect( lp ); node = lp;
		const g = ctx.createGain(); g.gain.setValueAtTime( 0, t ); g.gain.linearRampToValueAtTime( gain, t + attack ); g.gain.setTargetAtTime( 0, t + len * 0.6, len * 0.15 );
		const p = ctx.createStereoPanner(); p.pan.value = pan;
		node.connect( g ).connect( p ).connect( out );
		o.start( t ); o.stop( t + len + 0.3 );
		return o.frequency;
	}

	// a yellow-legged gull: a run of "kyow" calls, falling and slowing (or a few short "kek")
	_gull( t, level ) {
		const pan = rnd( - 0.9, 0.9 ), far = rnd( 0.2, 1 ), gain = 0.05 * level * ( 0.4 + 0.6 * far );
		const long = Math.random() < 0.6, n = long ? Math.floor( rnd( 4, 9 ) ) : Math.floor( rnd( 2, 4 ) );
		let at = t;
		for ( let k = 0; k < n; k ++ ) {
			const len = long ? rnd( 0.28, 0.42 ) * ( k ? 0.85 : 1.3 ) : rnd( 0.09, 0.13 ), f0 = rnd( 900, 1150 ) * ( 1 - k * 0.02 );
			const f = this._voice( at, { type: 'sawtooth', band: rnd( 1500, 2100 ), q: 2.5, pan, gain, len, attack: 0.02, far } );
			f.setValueAtTime( f0, at ); f.linearRampToValueAtTime( f0 * 1.55, at + len * 0.35 ); f.exponentialRampToValueAtTime( f0 * 0.75, at + len );
			at += len + ( long ? rnd( 0.05, 0.12 ) : rnd( 0.08, 0.15 ) );
		}
	}

	// a songbird phrase: one of four patterns (a robin's tumbling notes, a blackbird's fluted glides,
	// a chaffinch's falling trill with its flourish, a great tit's "teacher")
	_song( t, level ) {
		const pan = rnd( - 0.95, 0.95 ), far = rnd( 0.15, 1 ), gain = 0.035 * level * ( 0.35 + 0.65 * far );
		const note = ( at, len, f0, f1, g = gain ) => { const f = this._voice( at, { pan, gain: g, len, attack: 0.008, far } ); f.setValueAtTime( f0, at ); f.exponentialRampToValueAtTime( f1, at + len ); };
		const kind = Math.floor( Math.random() * 4 );
		let at = t;
		if ( kind === 0 ) { // robin
			for ( let k = Math.floor( rnd( 6, 12 ) ); k > 0; k -- ) { const len = rnd( 0.05, 0.16 ); note( at, len, rnd( 2500, 6500 ), rnd( 2500, 6500 ) ); at += len + rnd( 0.02, 0.09 ); }
		} else if ( kind === 1 ) { // blackbird
			for ( let k = Math.floor( rnd( 3, 6 ) ); k > 0; k -- ) {
				const len = rnd( 0.18, 0.4 ), f0 = rnd( 1500, 2600 );
				const f = this._voice( at, { pan, gain: gain * 1.2, len, attack: 0.02, far } );
				f.setValueAtTime( f0, at ); f.linearRampToValueAtTime( f0 * rnd( 1.1, 1.4 ), at + len * 0.4 ); f.linearRampToValueAtTime( f0 * rnd( 0.8, 1.05 ), at + len );
				at += len + rnd( 0.05, 0.15 );
			}
		} else if ( kind === 2 ) { // chaffinch
			let f = rnd( 4800, 5600 ), gap = 0.11;
			for ( let k = 0; k < 10; k ++ ) { note( at, 0.05, f, f * 0.9 ); at += gap; gap *= 0.93; f *= 0.965; }
			note( at + 0.03, 0.22, f * 1.3, f * 0.7, gain * 1.2 );
		} else { // great tit
			const hi = rnd( 4300, 5200 ), lo = hi * rnd( 0.68, 0.78 );
			for ( let k = Math.floor( rnd( 3, 6 ) ); k > 0; k -- ) { note( at, 0.09, hi, hi * 0.97 ); note( at + 0.13, 0.11, lo, lo * 0.98 ); at += 0.33; }
		}
	}

	// a tawny owl: "hoo ... hu-hu-hooo"
	_owl( t, level ) {
		const pan = rnd( - 0.8, 0.8 ), gain = 0.06 * level, far = rnd( 0.3, 0.8 );
		const hoot = ( at, len, f0 ) => {
			const f = this._voice( at, { type: 'triangle', pan, gain, len, attack: 0.06, far } );
			f.setValueAtTime( f0, at ); f.linearRampToValueAtTime( f0 * 1.06, at + len * 0.3 ); f.linearRampToValueAtTime( f0 * 0.97, at + len );
		};
		hoot( t, 0.7, 420 );
		hoot( t + 3.2, 0.18, 400 ); hoot( t + 3.45, 0.18, 410 ); hoot( t + 3.75, 1.1, 415 );
	}

	// a bubble rising past the ear
	_bubble( t ) {
		const f = this._voice( t, { pan: rnd( - 0.7, 0.7 ), gain: rnd( 0.02, 0.06 ), len: rnd( 0.03, 0.08 ), attack: 0.003, far: 1, out: this.master } );
		const f0 = rnd( 300, 700 ); f.setValueAtTime( f0, t ); f.exponentialRampToValueAtTime( f0 * rnd( 2, 3 ), t + 0.06 );
	}

}
