// QA of the terrain editor's "Rio" (world/rivers.js, world/riverCourse.js): lays a course downhill from
// a start point (25 m steps along the steepest descent), finishes it in the editor (levels never rise,
// the channel carved into the edits, the water shown), saves, reloads in the normal mode and captures
// the river; then deletes the test files.
//   node tools/river.mjs [prefix] [--x=-95 --z=40] [--width=5] [--keep]
// --keep: leaves public/terrain-edits.bin and public/world-edits.json (does not run if either exists).
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const arg = ( k, d ) => Number( ( process.argv.find( ( a ) => a.startsWith( `--${ k }=` ) ) || `=${ d }` ).split( '=' )[ 1 ] );
const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'river';
const X = arg( 'x', - 95 ), Z = arg( 'z', 40 ), WIDTH = arg( 'width', 5 ), KEEP = process.argv.includes( '--keep' );
const FILES = [ 'public/terrain-edits.bin', 'public/world-edits.json' ];
for ( const f of FILES ) if ( fs.existsSync( f ) ) { console.log( `${ f } exists: not touching it` ); process.exit( 1 ); }
const browser = await puppeteer.launch( { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000, args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ], defaultViewport: { width: 1600, height: 900 } } );
const page = await browser.newPage();
const errors = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + String( e ).slice( 0, 300 ) ) );
const check = ( ok, msg ) => { console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ msg }` ); if ( ! ok ) process.exitCode = 1; };
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
try {
	await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready && window.__app.editor && window.__app.objectEditor, { timeout: 300000, polling: 250 } );
	const r = await page.evaluate( ( X, Z, W ) => {
		const a = window.__app, ed = a.editor, hf = a.hf;
		// downhill course: 25 m steps along the steepest of 16 directions, until the sea or flat ground
		const pts = [ [ X, Z ] ];
		for ( let k = 0; k < 9; k ++ ) {
			const [ x, z ] = pts.at( - 1 ), h = hf.heightAt( x, z );
			if ( h < 0.3 ) break;
			let best = null;
			for ( let q = 0; q < 16; q ++ ) {
				const ang = q / 16 * Math.PI * 2, nx = x + Math.cos( ang ) * 25, nz = z + Math.sin( ang ) * 25;
				// no sharp turns back
				if ( pts.length > 1 ) { const [ px, pz ] = pts.at( - 2 ); if ( ( nx - x ) * ( x - px ) + ( nz - z ) * ( z - pz ) < 0 ) continue; }
				const nh = hf.heightAt( nx, nz );
				if ( ! best || nh < best.h ) best = { x: nx, z: nz, h: nh };
			}
			if ( ! best || best.h > h + 1 ) break;
			pts.push( [ best.x, best.z ] );
		}
		ed.tool = 'river'; ed.river.width = W;
		for ( const [ x, z ] of pts ) ed._riverClick( { x, z, y: hf.heightAt( x, z ) } );
		const before = ed.undo.length;
		const rec = ed._riverFinish();
		const lv = rec?.levels ?? [];
		let rises = 0;
		for ( let i = 1; i < lv.length; i ++ ) if ( lv[ i ] > lv[ i - 1 ] + 1e-6 ) rises ++;
		const carved = ed.undo.length === before + 1 ? ed.undo.at( - 1 ).keys.length : 0;
		const river = a.rivers.list.at( - 1 );
		return { points: pts.length, samples: lv.length, top: lv[ 0 ], bottom: lv.at( - 1 ), rises, carved, mesh: !! river?.mesh, saved: a.objectEditor.edits.rivers?.length ?? 0, start: pts[ 0 ], end: pts.at( - 1 ) };
	}, X, Z, WIDTH );
	console.log( 'editor', JSON.stringify( r ) );
	check( r.samples > 10 && r.rises === 0 && r.carved > 0 && r.mesh && r.saved === 1, `Rio no editor: ${ r.points } pontos, ${ r.samples } amostras, nível ${ r.top?.toFixed( 1 ) } → ${ r.bottom?.toFixed( 1 ) } m sem subir, ${ r.carved } células escavadas, água visível` );
	// save (the relief edits and the world edits) and reload in the normal mode
	await page.evaluate( () => window.__app.editor.save() ).catch( () => {} );
	await sleep( 2500 );
	check( FILES.every( ( f ) => fs.existsSync( f ) ), 'salvo: terrain-edits.bin e world-edits.json' );
	await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
	const after = await page.evaluate( () => {
		const a = window.__app; const rv = a.rivers.list[ 0 ], S = rv?.course.samples;
		const falls = ( rv?.course.falls ?? [] ).map( ( f ) => ( { lip: S[ f.lip ], foot: S[ f.foot ], drop: f.drop } ) );
		// the deepest point of the channel (for the dive)
		let deep = null;
		for ( const p of S ?? [] ) { if ( p.y < 1 ) continue; const d = p.y - a.hf.heightAt( p.x, p.z ); if ( ! deep || d > deep.d ) deep = { ...p, d }; } // above the sea: the river's own water
		return { n: a.rivers.list.length, mesh: !! rv?.mesh, mid: S ? S[ Math.floor( S.length / 2 ) ] : null, len: rv?.course.length, falls, mist: a.rivers.mist?.count ?? 0, deep };
	} );
	console.log( 'quedas', JSON.stringify( after.falls.map( ( f ) => ( { drop: +f.drop.toFixed( 1 ), x: +f.foot.x.toFixed( 0 ), z: +f.foot.z.toFixed( 0 ) } ) ) ), 'spray', after.mist, 'mais fundo', after.deep?.d?.toFixed( 2 ) );
	check( after.n === 1 && after.mesh, `depois de recarregar: ${ after.n } rio, ${ Math.round( after.len ?? 0 ) } m` );
	if ( after.mid ) {
		const m = after.mid;
		const views = [
			[ 'above', [ m.x - m.dz * 30, m.y + 35, m.z + m.dx * 30 ], [ m.x, m.y, m.z ] ],
			[ 'bank', [ m.x - m.dz * 9, m.y + 2.2, m.z + m.dx * 9 ], [ m.x + m.dx * 8, m.y, m.z + m.dz * 8 ] ],
			[ 'along', [ m.x - m.dx * 10, m.y + 1.6, m.z - m.dz * 10 ], [ m.x + m.dx * 10, m.y - 0.3, m.z + m.dz * 10 ] ]
		];
		// the first fall, from below its foot looking up the course
		const f = after.falls[ 0 ];
		if ( f ) views.push( [ 'fall', [ f.foot.x + f.foot.dx * 14 - f.foot.dz * 5, f.foot.y + 2.5, f.foot.z + f.foot.dz * 14 + f.foot.dx * 5 ], [ f.lip.x, ( f.lip.y + f.foot.y ) / 2, f.lip.z ] ] );
		for ( const [ name, pos, at ] of views ) {
			await page.evaluate( ( pos, at ) => { const a = window.__app; a.dynamicRes = false; a.views.push( { label: 'r', pos, target: at } ); a.setView( a.views.length - 1 ); }, pos, at );
			await sleep( 2500 );
			await page.evaluate( ( n ) => window.__app.capture( n ), `${ prefix }_${ name }` );
		}
		// a dive in the river's deepest point: the underwater view takes the river's level
		const d = after.deep;
		if ( d && d.d > 0.55 ) {
			// over the river first (the camera's dive limit takes the water level under it), then down
			const jump = ( dy ) => page.evaluate( ( d, dy ) => { const a = window.__app; a.views.push( { label: 'r', pos: [ d.x - d.dx * 2, d.y + dy, d.z - d.dz * 2 ], target: [ d.x + d.dx * 6, d.y + dy - 0.13, d.z + d.dz * 6 ] } ); a.setView( a.views.length - 1 ); }, d, dy );
			await jump( 1.5 ); await sleep( 800 );
			await jump( - 0.3 ); await sleep( 2500 );
			const under = await page.evaluate( () => window.__app.underwater.on.value );
			console.log( 'mergulho em', JSON.stringify( { x: d.x.toFixed( 0 ), z: d.z.toFixed( 0 ), nivel: d.y.toFixed( 2 ), fundo: d.d.toFixed( 2 ) } ) );
			check( under > 0.5, `mergulho no rio: visão submersa ${ under > 0.5 ? 'ligada' : 'desligada' } (fundo ${ d.d.toFixed( 2 ) } m)` );
			await page.evaluate( ( n ) => window.__app.capture( n ), `${ prefix }_under` );
		}
	}
} finally {
	if ( ! KEEP ) for ( const f of FILES ) if ( fs.existsSync( f ) ) fs.unlinkSync( f );
	console.log( errors.length ? 'errors: ' + errors.join( ' | ' ) : 'no console errors' );
	await browser.close();
}
