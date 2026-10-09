// The tabs of the editor (?edit): Relevo and Água (both editor/terrainEditor.js, its relief tools or its
// water ones: rivers, lakes, dig and fill), Objetos (objectEditor.js), Natureza (natureEditor.js) and
// Caminhos (pathEditor.js). The editor opens with no tab: nothing edits until one is picked (the left
// button only looks around); a click on the open tab closes it again. One tab at a time owns the left
// mouse button and its panel shows. "Salvar e aplicar" reloads the page on the tab it was pressed in.
const KEY = 'castroDoMar:editorTab';

export function createEditorTabs( app ) {
	const relief = app.editor, objects = app.objectEditor, nature = app.natureEditor, paths = app.pathEditor;
	const el = document.createElement( 'div' );
	el.id = 'editor-tabs';
	el.className = 'panel';
	el.innerHTML = '<button data-tab="relief" title="Elevar, baixar, suavizar, gerar relevo">Relevo</button><button data-tab="water" title="Rios, lagos, cavar e aterrar">Água</button><button data-tab="objects" title="A biblioteca: casas, adereços, árvores e pedras">Objetos</button><button data-tab="nature" title="Pincel de árvores, arbustos, pedras e grama">Natureza</button><button data-tab="paths" title="Trilhas e caminhos">Caminhos</button>';
	document.body.appendChild( el );
	const style = document.createElement( 'style' );
	style.textContent = `
		#editor-tabs { position: fixed; top: 78px; left: 12px; width: 304px; max-width: calc(100vw - 24px); box-sizing: border-box; padding: 4px; z-index: 12; display: flex; gap: 3px; }
		#editor-tabs button { flex: 1; min-width: 0; background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 6px; padding: 5px 2px; cursor: pointer; font: 11.5px Inter, system-ui, sans-serif; }
		#editor-tabs button:hover { border-color: var(--gold); }
		#editor-tabs button.on { background: rgba(201,164,92,.35); border-color: var(--gold-2); color: #fff; }
		#terrain-editor { top: 122px !important; max-height: calc(100vh - 184px) !important; width: 304px !important; max-width: calc(100vw - 24px); box-sizing: border-box; }`;
	document.head.appendChild( style );

	let current, reliefWasActive = true;
	app.setEditorTab = ( name = null ) => {
		if ( name === current ) name = null; // the open tab again: closed
		// never in the middle of a stroke or a gizmo drag
		if ( objects.dragging || nature.down || relief.down || paths?.dragging ) return;
		const terrainTab = ( n ) => n === 'relief' || n === 'water';
		if ( terrainTab( current ) ) reliefWasActive = relief.active;
		current = app.editorTab = name; // null: no tab open
		objects.setActive( name === 'objects' );
		nature.setActive( name === 'nature' );
		paths?.setActive( name === 'paths' );
		if ( terrainTab( name ) ) relief.setMode( name );
		relief.panel.style.display = terrainTab( name ) ? '' : 'none';
		relief.setActive( terrainTab( name ) && reliefWasActive );
		// the left button: sculpt / paint, or (no tab, objects, a paused relief) select and look around
		app.freecam.leftLook = ! name || name === 'objects' || ( terrainTab( name ) && ! reliefWasActive );
		for ( const b of el.querySelectorAll( 'button' ) ) b.classList.toggle( 'on', b.dataset.tab === name );
	};
	app.rememberEditorTab = () => { try { sessionStorage.setItem( KEY, current || '' ); } catch ( e ) { /* no storage */ } };
	for ( const b of el.querySelectorAll( 'button' ) ) b.onclick = () => app.setEditorTab( b.dataset.tab );
	// closed at the opening (the editors start their panels shown and the relief active), unless a
	// "Salvar e aplicar" reloaded the page from a tab
	let again = null;
	try { again = sessionStorage.getItem( KEY ); sessionStorage.removeItem( KEY ); } catch ( e ) { /* no storage */ }
	current = 'relief';
	app.setEditorTab( null );
	if ( again ) app.setEditorTab( again );
	return el;
}
