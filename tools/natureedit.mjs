// QA of the nature brush (?edit, tab "Natureza"): drives it with the real mouse in headless Edge.
//   node tools/natureedit.mjs [prefix] [--save]
// Finds a wooded spot and an open meadow near the village, erases everything in the wood, paints
// pines on the meadow and rocks with a wide brush, checks the painted grid and undo / redo, and
// captures shots/<prefix>_<step>.png. --save also saves, reloads (normal mode) and counts the
// instances: trees gone from the wood, pines and rocks on the meadow, bigger boulders from the wide
// brush - then deletes public/nature-edits.bin again.
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'nedit';
const doSave = process.argv.includes( '--save' );
const FILE = 'public/nature-edits.bin';
if ( doSave && fs.existsSync( FILE ) ) { console.log( `${ FILE } exists: not touching it (move it away to run --save)` ); process.exit( 1 ); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + String( e ).slice( 0, 300 ) ) );
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const shot = async ( name ) => { await sleep( 400 ); await page.screenshot( { path: `shots/${ prefix }_${ name }.png` } ); };
const check = ( ok, msg ) => { console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ msg }` ); if ( ! ok ) process.exitCode = 1; };
const ready = async ( url ) => {
	await page.goto( url, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
	await page.waitForFunction( () => { const l = document.getElementById( 'loader' ); return ! l || getComputedStyle( l ).visibility === 'hidden'; }, { timeout: 30000, polling: 200 } );
	await page.evaluate( () => { window.__app.dynamicRes = false; } );
};
// instances of the named chunked sets inside a circle (and their mean scale)
const census = ( names, c, r ) => page.evaluate( ( names, c, r ) => {
	const a = window.__app, M = new a.camera.matrixWorld.constructor(), p = a.camera.position.clone();
	let n = 0, s = 0;
	for ( const root of [ a.layers.vegetation.object, a.layers.rocks.object ] ) for ( const ch of root.children ) {
		if ( ! names.includes( ch.name ) || ! ch.tiles ) continue;
		for ( const t of ch.tiles ) {
			const { matrices, count } = t.hi.userData.instances;
			for ( let i = 0; i < count; i ++ ) {
				M.fromArray( matrices, i * 16 ); p.setFromMatrixPosition( M );
				if ( Math.hypot( p.x - c.x, p.z - c.z ) < r ) { n ++; s += M.getMaxScaleOnAxis(); }
			}
		}
	}
	return { n, scale: n ? s / n : 0 };
}, names, c, r );
const TREES = [ 'oak', 'pine', 'birch' ];

await ready( 'http://localhost:5190/?auto&edit' );
// the wood: the oak with most trees within 25 m, 60-300 m from the village; the meadow: a flat
// spot with no tree within 30 m
const spots = await page.evaluate( () => {
	const a = window.__app, M = new a.camera.matrixWorld.constructor(), p = a.camera.position.clone(), pts = [];
	for ( const ch of a.layers.vegetation.object.children ) {
		if ( ! [ 'oak', 'pine', 'birch' ].includes( ch.name ) || ! ch.tiles ) continue;
		for ( const t of ch.tiles ) { const { matrices, count } = t.hi.userData.instances; for ( let i = 0; i < count; i ++ ) { M.fromArray( matrices, i * 16 ); p.setFromMatrixPosition( M ); pts.push( [ p.x, p.z ] ); } }
	}
	const V = { x: - 15, z: 5 };
	let wood = null, best = 0;
	for ( const [ x, z ] of pts ) {
		const d = Math.hypot( x - V.x, z - V.z );
		if ( d < 60 || d > 300 ) continue;
		let k = 0; for ( const [ u, w ] of pts ) if ( Math.hypot( u - x, w - z ) < 25 ) k ++;
		if ( k > best ) { best = k; wood = { x, z }; }
	}
	let meadow = null;
	for ( let r = 120; r < 400 && ! meadow; r += 20 ) for ( let t = 0; t < 24 && ! meadow; t ++ ) {
		const x = V.x + Math.cos( t / 24 * 6.283 ) * r, z = V.z + Math.sin( t / 24 * 6.283 ) * r, h = a.hf.heightAt( x, z );
		if ( h < 8 || a.hf.slopeAt( x, z ) > 0.25 ) continue;
		if ( pts.some( ( [ u, w ] ) => Math.hypot( u - x, w - z ) < 30 ) ) continue;
		meadow = { x, z };
	}
	return { wood, woodTrees: best, meadow };
} );
check( spots.wood && spots.meadow, `achou um bosque (${ spots.woodTrees } árvores em 25 m) e um campo aberto: ${ JSON.stringify( spots ) }` );
const W = spots.wood, F = spots.meadow;
const before = { wood: await census( TREES, W, 14 ), meadowPines: await census( [ 'pine' ], F, 20 ), meadowRocks: await census( [ 'tor0', 'tor1' ], F, 25 ) };

await page.click( '#editor-tabs [data-tab=nature]' ); await sleep( 300 );
const top = async ( c, h = 110 ) => { await page.evaluate( ( c, h ) => { const a = window.__app, g = a.hf.heightAt( c.x, c.z ); a.views.push( { label: 'n', pos: [ c.x + 0.01, g + h, c.z + 0.01 ], target: [ c.x, g, c.z ] } ); a.setView( a.views.length - 1 ); }, c, h ); await sleep( 1500 ); };
const toScreen = ( x, z ) => page.evaluate( ( x, z ) => { const a = window.__app, v = new a.THREE.Vector3( x, a.hf.heightAt( x, z ), z ).project( a.camera ), r = a.renderer.domElement.getBoundingClientRect(); return { x: r.left + ( v.x * 0.5 + 0.5 ) * r.width, y: r.top + ( 0.5 - v.y * 0.5 ) * r.height }; }, x, z );
const stroke = async ( c, ms = 2500 ) => {
	const s = await toScreen( c.x, c.z );
	await page.mouse.move( s.x, s.y ); await sleep( 150 ); await page.mouse.down();
	await page.mouse.move( s.x + 2, s.y, { steps: 4 } ); await sleep( ms ); await page.mouse.up(); await sleep( 300 );
};
const val = ( ch, c ) => page.evaluate( ( ch, c ) => { const e = window.__app.natureEditor; const N = { cell: 4, res: 700, x0: - 1650, z0: - 2050, channels: 8 }; const i = Math.floor( ( c.x - N.x0 ) / N.cell ), j = Math.floor( ( c.z - N.z0 ) / N.cell ); return e.val[ ( j * N.res + i ) * N.channels + ch ]; }, ch, c );

// 1. erase everything in the wood
await top( W );
await page.click( '#nature-editor [data-brush=all]' );
await page.evaluate( () => { const e = window.__app.natureEditor; e.radius = 22; e.strength = 1; } );
await stroke( W );
const eOak = await val( 0, W ), eGrass = await val( 6, W );
check( eOak < - 0.9 && eGrass < - 0.9, `apagar tudo no bosque: carvalho ${ eOak.toFixed( 2 ) }, grama ${ eGrass.toFixed( 2 ) }` );
await shot( '1_erase' );

// 2. undo / redo
await page.click( '#nature-editor [data-act=undo]' ); await sleep( 200 );
const u = await val( 0, W );
await page.click( '#nature-editor [data-act=redo]' ); await sleep( 200 );
const r2 = await val( 0, W );
check( u === 0 && Math.abs( r2 - eOak ) < 1e-6, `desfazer / refazer: ${ u } / ${ r2.toFixed( 2 ) }` );

// 3. pines on the meadow, then rocks with a wide brush
await top( F );
await page.click( '#nature-editor [data-brush=pine]' );
await page.click( '#nature-editor [data-mode=paint]' );
await page.evaluate( () => { const e = window.__app.natureEditor; e.radius = 18; e.strength = 0.8; } );
await stroke( F );
await page.click( '#nature-editor [data-brush=rocks]' );
await page.evaluate( () => { const e = window.__app.natureEditor; e.radius = 50; e.strength = 0.5; } );
await stroke( F );
const pPine = await val( 1, F ), pRock = await val( 5, F ), pSize = await val( 7, F );
check( pPine > 0.7 && pRock > 0.4 && pSize > 0.7, `pintar no campo: pinheiro ${ pPine.toFixed( 2 ) }, pedras ${ pRock.toFixed( 2 ) }, tamanho ${ pSize.toFixed( 2 ) } (pincel de 50 m)` );
await shot( '2_paint' );

if ( doSave ) {
	const nav = page.waitForNavigation( { waitUntil: 'domcontentloaded', timeout: 120000 } );
	await page.click( '#nature-editor [data-act=save]' );
	await nav;
	check( fs.existsSync( FILE ) && fs.statSync( FILE ).size === 700 * 700 * 8, `${ FILE } gravado` );
	check( ! fs.existsSync( 'public/terrain-edits.bin' ) && ! fs.existsSync( 'public/world-edits.json' ), 'só a natureza foi gravada' );
	await ready( 'http://localhost:5190/?auto' );
	const after = { wood: await census( TREES, W, 14 ), meadowPines: await census( [ 'pine' ], F, 20 ), meadowRocks: await census( [ 'tor0', 'tor1' ], F, 25 ) };
	check( after.wood.n === 0 && before.wood.n > 0, `bosque apagado: ${ before.wood.n } -> ${ after.wood.n } árvores no miolo do pincel (14 m; a borda suave apaga em parte)` );
	// expected painted pines within 20 m: the sum of density x 0.35 per texel (vegetation.js); the
	// filters (paths, house clearance, slope) only lower it
	const expect = await page.evaluate( ( c ) => {
		const d = window.__app.natureEdits, N = { cell: 4, res: 700, x0: - 1650, z0: - 2050, ch: 8 };
		let e = 0;
		for ( let j = 0; j < N.res; j ++ ) for ( let i = 0; i < N.res; i ++ ) {
			const x = N.x0 + ( i + 0.5 ) * N.cell, z = N.z0 + ( j + 0.5 ) * N.cell;
			if ( Math.hypot( x - c.x, z - c.z ) < 20 ) e += Math.max( 0, d[ ( j * N.res + i ) * N.ch + 1 ] / 127 ) * 0.35;
		}
		return e;
	}, F );
	check( after.meadowPines.n - before.meadowPines.n >= Math.max( 3, expect * 0.3 ) && after.meadowPines.n - before.meadowPines.n <= expect * 1.6 + 3, `pinheiros pintados: ${ before.meadowPines.n } -> ${ after.meadowPines.n } em 20 m (esperado até ~${ expect.toFixed( 1 ) }, menos os filtros)` );
	check( after.meadowRocks.n > before.meadowRocks.n + 5 && after.meadowRocks.scale > 1, `pedras pintadas: ${ before.meadowRocks.n } -> ${ after.meadowRocks.n } em 25 m, escala média ${ after.meadowRocks.scale.toFixed( 2 ) }` );
	for ( const [ c, name ] of [ [ W, '3_wood' ], [ F, '4_meadow' ] ] ) {
		await page.evaluate( ( c ) => { const a = window.__app, g = a.hf.heightAt( c.x, c.z ); a.views.push( { label: 'n', pos: [ c.x + 45, g + 30, c.z + 45 ], target: [ c.x, g + 2, c.z ] } ); a.setView( a.views.length - 1 ); }, c );
		await sleep( 1800 );
		await shot( name );
	}
	fs.unlinkSync( FILE );
	console.log( `${ FILE } removido (era só teste)` );
}
check( errors.length === 0, `console sem erros${ errors.length ? ': ' + [ ...new Set( errors ) ].join( ' | ' ) : '' }` );
await browser.close();
