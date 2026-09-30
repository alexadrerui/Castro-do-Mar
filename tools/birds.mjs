// QA for the perching / diving birds (world/birds/flock.js): lists the perches and the birds'
// states, then (flock paused) frames a gull on a roof, one on the shore rocks and a tern.
//   node tools/birds.mjs [prefix]   -> shots/<prefix>_<roof|rock|tern|wide>.png
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'birds';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( m.type() === 'error' || ( m.type() === 'warn' && ! /maxLeafSize|powerPreference/.test( m.text() ) ) ) console.log( '[page]', m.type(), m.text().slice( 0, 600 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e.stack || e ).slice( 0, 900 ) ) );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 240000, polling: 1000 } );
await new Promise( ( r ) => setTimeout( r, 4000 ) ); // let the flock live a little

const out = await page.evaluate( async ( prefix ) => {
	const a = window.__app, F = a.flock;
	a.dynamicRes = false;
	a.setFocus?.( false );
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	const perches = {};
	for ( const p of F.perches ) perches[ p.kind ] = ( perches[ p.kind ] || 0 ) + 1;
	const states = {};
	for ( const b of F.agents ) states[ b.kind + ':' + b.state ] = ( states[ b.kind + ':' + b.state ] || 0 ) + 1;
	F.paused = true;
	const view = async ( pos, target, name ) => {
		a.views.push( { label: 'qa', pos, target } ); a.setView( a.views.length - 1 ); a.views.pop();
		await sleep( 500 );
		await a.capture( `${ prefix }_${ name }` );
	};
	await view( [ 0, 60, 0 ], [ 10, 30, 10 ], 'warm' );
	const shots = [];
	const perched = ( kind ) => F.agents.find( ( b ) => b.state === 'perched' && b.perch.kind === kind );
	const sd = a.sky.state.sunDir, sl = Math.hypot( sd.x, sd.z ) || 1;
	for ( const [ name, b, dist, up ] of [ [ 'roof', perched( 'roof' ) || perched( 'wall' ), 2.4, 0.6 ], [ 'rock', perched( 'rock' ), 2.4, 0.5 ], [ 'tern', F.agents.find( ( b ) => b.kind === 'tern' ), 2.2, 0.3 ] ] ) {
		if ( ! b ) { shots.push( { name, found: false } ); continue; }
		const P = b.f.P.pos;
		// camera on the sun's side, level with the bird
		await view( [ P[ 0 ] + sd.x / sl * dist, P[ 1 ] + up, P[ 2 ] + sd.z / sl * dist ], [ P[ 0 ], P[ 1 ], P[ 2 ] ], name );
		shots.push( { name, at: P.map( ( v ) => +v.toFixed( 1 ) ), state: b.state } );
	}
	F.paused = false;
	// flush test: the camera comes up to a perched gull; it should take off within a second or two
	const g = F.agents.find( ( b ) => b.state === 'perched' );
	let flush = null;
	if ( g ) {
		const P = g.f.P.pos.slice();
		await view( [ P[ 0 ] + 12, P[ 1 ] + 2, P[ 2 ] ], P, 'flush_before' );
		const before = g.state;
		a.views.push( { label: 'qa', pos: [ P[ 0 ] + 3, P[ 1 ] + 1, P[ 2 ] ], target: P } ); a.setView( a.views.length - 1 ); a.views.pop();
		await sleep( 2500 );
		flush = { before, after: g.state, rise: +( g.f.P.pos[ 1 ] - P[ 1 ] ).toFixed( 1 ) };
	}
	a.setView( 0 ); await sleep( 800 );
	await a.capture( `${ prefix }_wide` );
	return { perches, states, lanes: F.lanes.length, shots, flush };
}, prefix );
console.log( JSON.stringify( out ) );
await browser.close();
