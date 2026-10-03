// QA for the trees: frames the oak nearest to the village from eye level (close), from 60 m and
// from above, with the depth of field off.
//   node tools/trees.mjs [prefix] [species=oak] [--imp] [--warm]   -> shots/<prefix>_<view>.png
// --warm reloads once first (the GPU bakes read from the cache); --imp draws the impostors at every distance (to compare them with the near trees); --solo hides
// the rocks and the other plants.
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'trees';
const species = process.argv.slice( 3 ).find( ( a ) => ! a.startsWith( '--' ) ) || 'oak';
const forceImp = process.argv.includes( '--imp' );
const solo = process.argv.includes( '--solo' );
const warm = process.argv.includes( '--warm' ); // reload once: the bakes come from the IndexedDB cache
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( m.type() === 'error' || ( m.type() === 'warn' && ! /maxLeafSize|powerPreference/.test( m.text() ) ) ) console.log( '[page]', m.type(), m.text().slice( 0, 600 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 600 ) ) );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 240000, polling: 1000 } );
if ( warm ) {
	await new Promise( ( r ) => setTimeout( r, 3000 ) ); // the cache write
	await page.reload( { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 240000, polling: 1000 } );
}

const out = await page.evaluate( async ( prefix, species, forceImp, solo ) => {
	const a = window.__app;
	a.dynamicRes = false;
	a.setFocus?.( false );
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	const view = async ( pos, target, name ) => {
		a.views.push( { label: 'qa', pos, target } ); a.setView( a.views.length - 1 ); a.views.pop();
		await sleep( 500 );
		await a.capture( `${ prefix }_${ name }` );
	};
	// the instance nearest to the village (core/chunked.js tiles)
	const chunk = a.layers.vegetation.object.children.find( ( c ) => c.name === species );
	if ( forceImp ) chunk.impostorDistance = 0;
	if ( solo ) {
		a.layers.rocks.object.visible = false;
		for ( const c of a.layers.vegetation.object.children ) if ( c !== chunk ) c.visible = false;
	}
	const M = new a.camera.matrixWorld.constructor();
	const p = a.camera.position.clone();
	let best = null, bestD = Infinity;
	for ( const t of chunk.tiles ) {
		const { matrices, count } = t.hi.userData.instances;
		for ( let i = 0; i < count; i ++ ) {
			M.fromArray( matrices, i * 16 );
			p.setFromMatrixPosition( M );
			const d = Math.hypot( p.x + 15, p.z - 60 );
			if ( d < bestD ) { bestD = d; best = { x: p.x, y: p.y, z: p.z, s: M.getMaxScaleOnAxis() }; }
		}
	}
	const { x, y, z, s } = best;
	const H = ( { oak: 9, pine: 9, birch: 10, bush: 1.6, fern: 1.1 }[ species ] ?? ( species.startsWith( 'broad' ) ? 9 : 5 ) ) * s; // plant height at scale s
	const k = H / 6.75; // camera distances scaled to the plant (6.75 m: the oak at scale 0.75)
	await view( [ x + 2, y + 1, z + 1 ], [ x, y + H * 0.5, z ], 'warm' ); // settles the free camera
	const ground = ( gx, gz ) => a.hf.heightAt( gx, gz );
	// the camera stands on the sun's side (front-lit): offsets ( along, across ) the sun direction
	const sd = a.sky.state.sunDir, sl = Math.hypot( sd.x, sd.z ) || 1;
	const fx = sd.x / sl, fz = sd.z / sl;
	const at = ( al, ac ) => [ x + fx * al - fz * ac, z + fz * al + fx * ac ];
	{ const [ cx, cz ] = at( 16 * k, 4 * k ); await view( [ cx, ground( cx, cz ) + Math.max( 1.7 * k, 0.6 ), cz ], [ x, y + H * 0.5, z ], 'near' ); }
	{ const [ cx, cz ] = at( 55 * k, 20 * k ); await view( [ cx, Math.max( ground( cx, cz ) + 6 * k, y + 6 * k ), cz ], [ x, y + H * 0.45, z ], 'far' ); }
	{ const [ cx, cz ] = at( 12 * k, 8 * k ); await view( [ cx, y + H + 18 * k, cz ], [ x, y + H * 0.6, z ], 'above' ); }
	return { at: [ x, y, z ].map( ( v ) => +v.toFixed( 1 ) ), scale: +s.toFixed( 2 ) };
}, prefix, species, forceImp, solo );
console.log( JSON.stringify( out ) );
await browser.close();
