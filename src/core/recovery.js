// Recovery from a lost GPU device (driver reset, GPU hang, the tab's device taken away): the view is
// saved in sessionStorage and the page reloads (with the IndexedDB caches a reload is ~6 s) and puts
// the camera, the sun and the panel settings back. Bounded like Drusniel: Gods' End's
// rendering/RendererRecovery.js (https://github.com/danielsobrado/drusniel-gods-end, MIT, Copyright
// (c) 2026 Daniel Sobrado, licenses/LICENSE-Drusniel.md): one recovery per RETRY_WINDOW; a second loss
// within it shows a message with a reload button instead of looping. There the renderer and the scene
// are rebuilt in place (and fall back to WebGL); here the whole load is one function in main.js, so a
// reload is the rebuild (the WebGL fallback is still unconfirmed here, so it is not tried on its own).
// In the editor (?edit) unsaved edits are never thrown away: they are downloaded and the page stays.

const KEY = 'castroDoMar:recovery', LAST = 'castroDoMar:lastRecovery';
const RETRY_WINDOW = 120000; // ms
const RESTORE_MAX_AGE = 60000; // ms: an older saved view is not restored

const store = {
	get( k ) { try { return JSON.parse( sessionStorage.getItem( k ) ); } catch ( e ) { return null; } },
	set( k, v ) { try { sessionStorage.setItem( k, JSON.stringify( v ) ); return true; } catch ( e ) { return false; } },
	del( k ) { try { sessionStorage.removeItem( k ); } catch ( e ) { /* no storage */ } }
};

function showFailure( msg ) {
	if ( document.getElementById( 'gpu-lost' ) ) return;
	const el = document.createElement( 'div' );
	el.id = 'gpu-lost';
	el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:rgba(10,12,14,.82);z-index:100;color:#eee;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:24px';
	el.innerHTML = `<div style="max-width:440px"><b style="font-size:17px">A GPU parou de responder</b><p>${ msg }</p><button style="margin-top:8px;padding:8px 18px;border-radius:8px;border:1px solid #c9a45c;background:#3c5a2a;color:#fff;font:inherit;cursor:pointer">Recarregar</button></div>`;
	el.querySelector( 'button' ).onclick = () => { store.del( LAST ); location.reload(); };
	document.body.appendChild( el );
}

function saveView( app, reason ) {
	const c = app.camera, d = c.getWorldDirection( c.position.clone() );
	store.set( KEY, {
		t: Date.now(), reason,
		pos: c.position.toArray(),
		target: c.position.clone().addScaledVector( d, 20 ).toArray(),
		sun: { elevation: app.sky.state.elevation, azimuth: app.sky.state.azimuth, hour: app.clock?.hour },
		clouds: app.sky.sky.cloudCoverage.value
	} );
}

// Opens the page again at another address (the panel's "Opções": the editor, the other renderer)
// keeping the view, which restoreAfterRecovery puts back after the load.
export function reloadKeepingView( app, url, message ) {
	if ( app.ready ) saveView( app, message );
	location.href = url;
}

// app: renderer, camera, sky, plus the editors and the panel state when present
export function installRecovery( app ) {
	const { renderer } = app;
	const prev = renderer.onDeviceLost?.bind( renderer );
	let handled = false;
	renderer.onDeviceLost = ( info ) => {
		try { prev?.( info ); } catch ( e ) { /* the default handler only logs */ }
		if ( handled ) return;
		handled = true;
		app.lostDevice = info;
		try { renderer.setAnimationLoop( null ); } catch ( e ) { /* already gone */ }
		// unsaved edits: download them, never reload over them
		const editors = [ app.editor, app.objectEditor, app.natureEditor ].filter( ( e ) => e?.changed );
		if ( editors.length ) {
			for ( const e of editors ) { try { e.exportFile(); } catch ( err ) { console.error( err ); } }
			showFailure( 'As edições não salvas foram baixadas (coloque os arquivos em <code>public/</code>). Recarregue para continuar.' );
			return;
		}
		const last = store.get( LAST );
		if ( last && Date.now() - last < RETRY_WINDOW ) {
			showFailure( 'Ela já tinha sido reiniciada há pouco. Feche outras abas pesadas ou atualize o driver de vídeo e recarregue.' );
			return;
		}
		store.set( LAST, Date.now() );
		// the view (only once the world is up: a loss during the load just reloads)
		if ( app.ready ) saveView( app, 'gpu' );
		console.warn( 'GPU device lost: reloading to recover', info );
		app.hud?.toast?.( 'A GPU foi reiniciada: recarregando…' );
		setTimeout( () => location.reload(), 500 );
	};
}

// after a recovery (or reloadKeepingView) reload: the saved view back (camera, sun, clouds); returns
// true if restored
export function restoreAfterRecovery( app ) {
	const s = store.get( KEY );
	store.del( KEY );
	if ( ! s || Date.now() - s.t > RESTORE_MAX_AGE ) return false;
	app.views.push( { label: 'recuperada', pos: s.pos, target: s.target } );
	app.setView( app.views.length - 1 );
	// through the panel's own sliders when they exist (the panel shows the restored values too)
	const slide = ( id, v, apply ) => {
		const el = document.getElementById( id );
		if ( el ) { el.value = v; el.dispatchEvent( new Event( 'input' ) ); } else apply();
	};
	if ( s.sun ) {
		// the clock's hour (world/clock.js; the panel follows it), else the sun as it was
		if ( Number.isFinite( s.sun.hour ) && app.clock ) app.clock.set( s.sun.hour );
		else { app.sky.state.elevation = s.sun.elevation; app.sky.state.azimuth = s.sun.azimuth; app.onSunChanged(); }
	}
	if ( Number.isFinite( s.clouds ) ) slide( 'r-cloud', s.clouds, () => { app.sky.sky.cloudCoverage.value = s.clouds; } );
	app.hud?.toast?.( s.reason && s.reason !== 'gpu' ? s.reason : 'Vista recuperada depois da reinicialização da GPU.' );
	return true;
}
