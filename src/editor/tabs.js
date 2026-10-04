// The tabs of the editor (?edit): Relevo (editor/terrainEditor.js), Objetos (objectEditor.js),
// Natureza (natureEditor.js) and Caminhos (pathEditor.js). One tab at a time owns the left mouse
// button and its panel shows.
export function createEditorTabs( app ) {
	const relief = app.editor, objects = app.objectEditor, nature = app.natureEditor, paths = app.pathEditor;
	const el = document.createElement( 'div' );
	el.id = 'editor-tabs';
	el.className = 'panel';
	el.innerHTML = '<button data-tab="relief" class="on">Relevo</button><button data-tab="objects">Objetos</button><button data-tab="nature">Natureza</button><button data-tab="paths">Caminhos</button>';
	document.body.appendChild( el );
	const style = document.createElement( 'style' );
	style.textContent = `
		#editor-tabs { position: fixed; top: 78px; left: 12px; width: 288px; padding: 4px; z-index: 12; display: flex; gap: 4px; }
		#editor-tabs button { flex: 1; background: rgba(0,0,0,.35); color: var(--ink); border: 1px solid var(--panel-edge); border-radius: 6px; padding: 5px 6px; cursor: pointer; font: 12px Inter, system-ui, sans-serif; }
		#editor-tabs button:hover { border-color: var(--gold); }
		#editor-tabs button.on { background: rgba(201,164,92,.35); border-color: var(--gold-2); color: #fff; }
		#terrain-editor { top: 122px !important; max-height: calc(100vh - 184px) !important; }`;
	document.head.appendChild( style );

	let current = 'relief', reliefWasActive = true;
	app.setEditorTab = ( name ) => {
		// never in the middle of a stroke or a gizmo drag
		if ( name === current || objects.dragging || nature.down || relief.down || paths?.dragging ) return;
		if ( current === 'relief' ) reliefWasActive = relief.active;
		current = name;
		objects.setActive( name === 'objects' );
		nature.setActive( name === 'nature' );
		paths?.setActive( name === 'paths' );
		relief.panel.style.display = name === 'relief' ? '' : 'none';
		relief.setActive( name === 'relief' && reliefWasActive );
		// the left button: sculpt / paint, or (objects, a paused relief) select and look around
		app.freecam.leftLook = name === 'objects' || ( name === 'relief' && ! reliefWasActive );
		for ( const b of el.querySelectorAll( 'button' ) ) b.classList.toggle( 'on', b.dataset.tab === name );
	};
	for ( const b of el.querySelectorAll( 'button' ) ) b.onclick = () => app.setEditorTab( b.dataset.tab );
	return el;
}
