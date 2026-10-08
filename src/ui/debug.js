// The debug panel (#debug or ?debug in the address; the backquote key shows and hides it): the fine
// settings that were only reachable from the console (app.clouds, app.godrays, app.valleyFog, the look's
// key frames...) as sliders, and the frame's numbers. After the Debug.js / Monitoring.js of Bruno Simon's
// Folio 2025 (https://github.com/brunosimon/folio-2025, MIT, Copyright (c) 2025 Bruno Simon,
// licenses/LICENSE-folio-2025.md): a Tweakpane (MIT, Copyright (c) 2016 cocopon, licenses/LICENSE-
// tweakpane.md) with its essentials plugin (button grids, the FPS graph; licenses/LICENSE-tweakpane-
// essentials.md) and stats-gl (MIT, Renaud Rohlinger, licenses/LICENSE-stats-gl.md) for the CPU and GPU
// time. This module and its libraries are loaded only with #debug: without it nothing changes.
//
// Everything is bound to the live uniforms, so a change shows at once. Two kinds of values are written
// by the app every frame and are bound to their source instead: the valley fog and the low mist follow
// the day / night tables of main.js (app.valleyLook, app.mistLook), and the look of the hour comes from
// the key frames of world/look.js (edited row by row, "Copiar tabela" puts the table on the clipboard as
// code for src/world/look.js).
import { Pane } from 'tweakpane';
import * as Essentials from '@tweakpane/plugin-essentials';
import { LOOK_COLUMNS } from '../world/look.js';
import { Clock } from '../world/clock.js';

// a slider for a uniform (its .value) or a plain property
function bindU( folder, u, label, min, max, step ) {
	if ( ! u ) return null;
	return folder.addBinding( u, 'value', { label, min, max, step } );
}

// a colour picker for a THREE.Color (the uniform's value), in sRGB
function bindColor( folder, color, label ) {
	if ( ! color ) return null;
	const proxy = { c: '#' + color.getHexString() };
	return folder.addBinding( proxy, 'c', { label, view: 'color' } ).on( 'change', ( e ) => color.set( e.value ) );
}

export async function createDebugPanel( app ) {
	const pane = new Pane( { title: 'Depuração · Castro do Mar' } );
	pane.registerPlugin( Essentials );
	const root = pane.element.parentElement;
	root.style.zIndex = '30';
	root.style.width = '300px';
	root.style.maxHeight = 'calc(100vh - 190px)';
	root.style.overflowY = 'auto';
	root.style.top = '84px'; // under the HUD's title
	root.style.left = '16px';
	root.style.right = 'auto';
	addEventListener( 'keydown', ( e ) => {
		if ( e.code === 'Backquote' && ! e.target.closest?.( 'input,select,textarea' ) ) { pane.hidden = ! pane.hidden; if ( stats ) stats.dom.style.display = pane.hidden ? 'none' : ''; }
	} );

	// ---- the frame: stats-gl (FPS, CPU, GPU time with timestamp queries) and the renderer's counters
	let stats = null;
	try {
		const { default: Stats } = await import( 'stats-gl' );
		stats = new Stats( { trackGPU: true, trackHz: true, logsPerSecond: 4, graphsPerSecond: 30, samplesLog: 40, samplesGraph: 10, precision: 1, horizontal: true, minimal: false, mode: 0 } );
		await stats.init( app.renderer );
		// bottom left, above the keys' help (its graphs are laid out to the right of its left edge)
		stats.dom.style.cssText += ';position:fixed;left:16px;right:auto;top:auto;bottom:122px;z-index:30';
		document.body.append( stats.dom );
		app.onFrame.push( () => {
			// timestamps are resolved only while the panel is open (they are read by stats-gl from renderer.info)
			app.renderer.resolveTimestampsAsync?.( 'render' ).catch?.( () => {} );
			stats.update();
		} );
	} catch ( e ) {
		console.warn( 'debug: stats-gl unavailable', e );
	}
	const perf = pane.addFolder( { title: 'Desempenho' } );
	const counters = { calls: 0, triangles: 0, res: '100%', pixelRatio: 1 };
	perf.addBinding( counters, 'calls', { label: 'chamadas', readonly: true, format: ( v ) => v.toFixed( 0 ) } );
	perf.addBinding( counters, 'triangles', { label: 'triângulos', readonly: true, format: ( v ) => ( v / 1e6 ).toFixed( 2 ) + ' M' } );
	perf.addBinding( counters, 'res', { label: 'resolução da cena', readonly: true } );
	perf.addBinding( counters, 'pixelRatio', { label: 'pixel ratio', readonly: true, format: ( v ) => v.toFixed( 2 ) } );
	if ( app.dynRes ) perf.addBinding( app, 'dynamicRes', { label: 'resolução dinâmica' } );
	setInterval( () => {
		const i = app.renderer.info.render;
		counters.calls = i.drawCalls; counters.triangles = i.triangles;
		counters.res = Math.round( ( app.dynRes?.scale ?? 1 ) * 100 ) + '%';
		counters.pixelRatio = app.renderer.getPixelRatio();
	}, 500 );

	// ---- the hour and the look's key frames (world/look.js)
	const look = pane.addFolder( { title: 'Hora e visual', expanded: false } );
	const hour = { h: app.clock.hour, text: Clock.format( app.clock.hour ) };
	look.addBinding( hour, 'h', { label: 'hora', min: 0, max: 24, step: 0.01 } ).on( 'change', ( e ) => { if ( Math.abs( e.value - app.clock.hour ) > 1e-4 ) app.clock.set( e.value ); } );
	look.addBinding( hour, 'text', { label: '', readonly: true } );
	app.clock.listeners.push( ( h ) => { hour.h = h; hour.text = Clock.format( h ); } );
	look.addBinding( app.clock, 'playing', { label: 'passar o tempo' } );
	look.addBinding( app.clock, 'speed', { label: 'horas / min', min: 0.2, max: 6, step: 0.1 } );
	const now = Object.fromEntries( LOOK_COLUMNS.map( ( c ) => [ c, 0 ] ) );
	const nowF = look.addFolder( { title: 'Visual desta hora (leitura)', expanded: false } );
	for ( const c of LOOK_COLUMNS ) nowF.addBinding( now, c, { readonly: true, format: ( v ) => v.toFixed( 3 ) } );
	setInterval( () => { const L = app.sky.state.look; for ( const c of LOOK_COLUMNS ) now[ c ] = L[ c ] ?? 0; }, 300 );
	// a key frame, row by row
	const keys = app.look.keys;
	const fmtKey = ( k ) => Clock.format( k.h );
	const sel = { key: 0 };
	const keyF = look.addFolder( { title: 'Quadro-chave', expanded: false } );
	const row = {};
	const rowBindings = [];
	const loadRow = () => { const k = keys[ sel.key ]; for ( const c of LOOK_COLUMNS ) row[ c ] = k[ c ]; for ( const b of rowBindings ) b.refresh(); };
	keyF.addBinding( sel, 'key', { label: 'linha', options: Object.fromEntries( keys.map( ( k, i ) => [ fmtKey( k ), i ] ) ) } ).on( 'change', loadRow );
	const RANGE = { exposure: [ 0.2, 4 ], auto: [ 0, 1 ], ambient: [ 0, 0.5 ], haze: [ 0, 1.5 ], warm: [ 0, 1 ], sunset: [ 0, 1 ], afterglow: [ 0, 1 ], nightFog: [ 0, 1 ], calm: [ 0, 1.5 ], cool: [ 0, 1.5 ] };
	for ( const c of LOOK_COLUMNS ) {
		row[ c ] = 0;
		rowBindings.push( keyF.addBinding( row, c, { min: RANGE[ c ][ 0 ], max: RANGE[ c ][ 1 ], step: 0.001 } ).on( 'change', ( e ) => {
			keys[ sel.key ][ c ] = e.value;
			app.look.apply();
		} ) );
	}
	loadRow();
	keyF.addBlade( { view: 'buttongrid', size: [ 2, 1 ], cells: ( x ) => ( { title: [ 'Ir para essa hora', 'Copiar tabela' ][ x ] } ) } ).on( 'click', async ( e ) => {
		if ( e.index[ 0 ] === 0 ) app.clock.set( keys[ sel.key ].h );
		else {
			const text = keys.map( ( k ) => `\t{ h: hm( '${ fmtKey( k ) }' ), ${ LOOK_COLUMNS.map( ( c ) => `${ c }: ${ +k[ c ].toFixed( 5 ) }` ).join( ', ' ) } }` ).join( ',\n' );
			try { await navigator.clipboard.writeText( `export const KEYS = [\n${ text }\n];\n` ); app.hud?.toast( 'Tabela copiada: cole em src/world/look.js' ); } catch ( err ) { console.log( text ); app.hud?.toast( 'Tabela no console' ); }
		}
	} );

	// ---- the eye's adaptation (post/autoExposure.js)
	const ex = app.exposure;
	if ( ex ) {
		const f = pane.addFolder( { title: 'Exposição automática', expanded: false } );
		f.addBinding( app, 'autoExposure', { label: 'ligada (0..1)', min: 0, max: 1, step: 0.01 } ).on( 'change', () => app.onSunChanged() );
		bindU( f, ex.key, 'chave', 0.002, 0.05, 0.0005 );
		bindU( f, ex.amount, 'compensação', 0, 1, 0.01 );
		bindU( f, ex.min, 'mínimo ×', 0.1, 1, 0.01 );
		bindU( f, ex.max, 'máximo ×', 1, 5, 0.05 );
		bindU( f, ex.speedUp, 'clarear (1/s)', 0.05, 5, 0.05 );
		bindU( f, ex.speedDown, 'escurecer (1/s)', 0.05, 5, 0.05 );
		const m = { mul: 1 };
		f.addBinding( m, 'mul', { label: 'multiplicador', readonly: true, format: ( v ) => '×' + v.toFixed( 3 ) } );
		setInterval( async () => { try { m.mul = ( await ex.read( app.renderer ) )[ 0 ]; } catch ( e ) { /* busy */ } }, 500 );
	}

	// ---- sky and clouds
	{
		const f = pane.addFolder( { title: 'Céu e nuvens', expanded: false } );
		bindU( f, app.sky?.gain, 'brilho do céu', 0, 2, 0.01 );
		const c = app.clouds;
		if ( c ) {
			bindU( f, c.sunScale, 'luz do sol', 0, 40, 0.1 );
			bindU( f, c.ambientScale, 'luz do céu', 0, 10, 0.05 );
			bindU( f, c.windSpeed, 'vento (m/s)', 0, 60, 0.5 );
			bindU( f, c.evolve, 'evolução', 0, 20, 0.1 );
			bindU( f, c.cirrus, 'cirros', 0, 3, 0.01 );
			bindU( f, c.farShadow, 'autossombra', 0, 2, 0.01 );
			bindU( f, c.shafts, 'raios de luz', 0, 5, 0.05 );
			bindU( f, c.shaftGlow, 'brilho dos raios', 0, 5, 0.05 );
			bindU( f, c.shaftOpacity, 'piso dos raios', 0, 1, 0.01 );
			bindU( f, c.haze, 'névoa esparsa', 0, 1e-4, 1e-6 );
		}
		const s = app.cloudShadow;
		if ( s ) {
			bindU( f, s.strength, 'sombra das nuvens', 0, 1, 0.01 );
			bindU( f, s.opacity, 'borda da sombra', 0, 1, 0.01 );
		}
		const moon = app.sky?.moon;
		if ( moon ) {
			const mf = f.addFolder( { title: 'Lua', expanded: false } );
			bindU( mf, moon.brightness, 'brilho', 0, 20, 0.1 );
			bindU( mf, moon.halo, 'halo', 0, 1, 0.01 );
			bindU( mf, moon.radius, 'raio (rad)', 0.003, 0.04, 0.0005 );
		}
	}

	// ---- screen-space sun rays (post/godrays.js)
	const g = app.godrays;
	if ( g ) {
		const f = pane.addFolder( { title: 'Raios de sol (tela)', expanded: false } );
		bindU( f, g.strength, 'força', 0, 10, 0.05 );
		bindU( f, g.decay, 'decaimento', 0.8, 1, 0.001 );
		bindU( f, g.length, 'comprimento', 0, 2, 0.01 );
		bindU( f, g.falloff, 'queda', 0, 20, 0.1 );
		bindColor( f, g.tint?.value, 'cor' );
	}

	// ---- fog: the scattering, the valley fog and the low mist (their day / night tables)
	{
		const f = pane.addFolder( { title: 'Névoas', expanded: false } );
		bindU( f, app.fogScale, 'névoa geral ×', 0, 3, 0.01 );
		bindU( f, app.scatter, 'espalhamento', 0, 4, 0.05 );
		const table = ( title, T, spec ) => {
			if ( ! T ) return;
			const tf = f.addFolder( { title, expanded: false } );
			for ( const [ k, label, min, max, step ] of spec ) if ( k in T ) tf.addBinding( T, k, { label, min, max, step } );
		};
		const V = [ [ 'density', 'densidade', 0, 0.03, 0.0001 ], [ 'height', 'altura (m)', 1, 30, 0.1 ], [ 'ceiling', 'teto (m)', 5, 120, 0.5 ], [ 'pocketStrength', 'bancos', 0, 1, 0.01 ], [ 'sunScatter', 'lóbulo do sol', 0, 2, 0.01 ], [ 'waterBonus', 'sobre a água', 0, 2, 0.01 ] ];
		table( 'Névoa de vale · dia', app.valleyLook?.day, V );
		table( 'Névoa de vale · noite', app.valleyLook?.night, V );
		const M = [ [ 'density', 'densidade', 0, 0.2, 0.001 ], [ 'top', 'topo (m)', 0, 60, 0.5 ] ];
		table( 'Brétema · dia', app.mistLook?.day, M );
		table( 'Brétema · noite', app.mistLook?.night, M );
	}

	// ---- the sea (world/water.js)
	const wu = app.water?.uniforms;
	if ( wu ) {
		const f = pane.addFolder( { title: 'Água', expanded: false } );
		bindU( f, wu.absorb, 'absorção (1/m)', 0, 1, 0.005 );
		bindU( f, wu.waveStrength, 'ondas', 0, 2, 0.01 );
		bindU( f, wu.foam, 'espuma', 0, 3, 0.01 );
		bindU( f, wu.reflectivity, 'reflexo', 0, 1, 0.01 );
		bindColor( f, wu.shallow?.value, 'raso' );
		bindColor( f, wu.mid?.value, 'médio' );
		bindColor( f, wu.deep?.value, 'fundo' );
	}

	// ---- the grass (world/grass.js)
	const gr = app.grass;
	if ( gr ) {
		const f = pane.addFolder( { title: 'Grama', expanded: false } );
		if ( gr.wind?.isUniformNode || gr.wind?.value !== undefined ) bindU( f, gr.wind, 'vento', 0, 2, 0.01 );
		bindU( f, gr.trans?.strength, 'contraluz', 0, 3, 0.01 );
		bindU( f, gr.trans?.power, 'contraluz: foco', 1, 16, 0.1 );
		bindU( f, gr.trans?.tip, 'contraluz: pontas', 0, 2, 0.01 );
		bindU( f, gr.trample?.flatten, 'amassada: altura', 0, 1, 0.01 );
		bindU( f, gr.trample?.bend, 'amassada: curva', 0, 2, 0.01 );
	}

	// ---- the sun's shadows (world/sunShadows.js, world/terrainShadow.js)
	if ( app.shadows ) {
		const f = pane.addFolder( { title: 'Sombras do sol', expanded: false } );
		const sh = { on: app.shadowsOn, reach: app.shadows.reach };
		f.addBinding( sh, 'on', { label: 'ligadas' } ).on( 'change', ( e ) => app.setShadows( e.value ) );
		f.addBinding( sh, 'reach', { label: 'árvores e pedras (m)', min: 50, max: 900, step: 10 } ).on( 'change', ( e ) => app.shadows.setReach( e.value ) );
	}

	// ---- the birds (world/birds/)
	if ( app.flock ) {
		const f = pane.addFolder( { title: 'Aves', expanded: false } );
		f.addBinding( app.flock, 'paused', { label: 'congelar o bando' } );
		f.addButton( { title: 'Borrifo de teste à frente' } ).on( 'click', () => {
			const c = app.camera, d = c.getWorldDirection( c.position.clone() );
			const x = c.position.x + d.x * 15, z = c.position.z + d.z * 15;
			app.splashes?.emit( x, Math.max( 0, app.hf.heightAt( x, z ) ), z, 1 );
		} );
	}

	app.debug = { pane, stats };
	return app.debug;
}
