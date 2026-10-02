// Lightning QA (src/world/lightning.js): from a view, a strike far ahead (~900 m), then one where the
// view's centre meets the ground, seen from 40 m at eye level, and one 150 m away from there,
// each frozen at a few moments of its life (the return stroke, the restrokes, the cracks fading), with
// the storm's rain at 90% (the paused clocks keep the random strikes away).
//   node tools/lightning.mjs [prefix] [--cam=x,y,z,tx,ty,tz] [--near-first] [--params=a=1&b=2]
// Frames: shots/<prefix>_<far|near>_<t>.png
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) ) || 'lightning';
const camArg = args.find( ( x ) => x.startsWith( '--cam=' ) );
const cam = camArg ? camArg.slice( 6 ).split( ',' ).map( Number ) : null;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' || m.type() === 'warning' ) console.log( '[page]', m.text().slice( 0, 300 ) ); } );
const extra = ( args.find( ( x ) => x.startsWith( '--params=' ) ) || '--params=' ).slice( 9 );
await page.goto( 'http://localhost:5190/?auto' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
const out = await page.evaluate( async ( prefix, cam, nearFirst ) => {
	const a = window.__app, L = a.lightning;
	a.dynamicRes = false;
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	if ( cam ) { a.views.push( { label: 'qa', pos: cam.slice( 0, 3 ), target: cam.slice( 3, 6 ) } ); a.setView( a.views.length - 1 ); }
	L.sound = false;
	a.weather.setRain( 0.9 ); a.weather.level = 0.9;
	await sleep( 2500 );
	const c = a.camera, fwd = c.getWorldDirection( c.position.clone() ).setY( 0 ).normalize();
	const res = [];
	// freezes the strike at time t (the flicker computed for it) and captures
	const at = async ( name, t ) => {
		for ( const s of L.slots ) if ( s.active ) { s.t.value = t; if ( s.event ) s.event.t = t; }
		for ( const e of L.events ) e.t = t;
		L.shake = 0; L.update( 0, a.renderer );
		await a.capture( `${ prefix }_${ name }` ); // twice: the canvas gives the frame before
		await a.capture( `${ prefix }_${ name }` );
		const s0 = L.slots.find( ( s ) => s.active );
		res.push( name + ' ' + JSON.stringify( { uw: a.underwater?.on.value, cam: a.camera.position.toArray().map( Math.round ), t: s0?.t.value, glow: s0?.glow.value.toFixed( 2 ), hemi: a.sky.hemi.intensity.toFixed( 2 ) } ) );
	};
	// the near strike: where the view's centre meets the ground, seen from 40 m at eye level
	const dir = c.getWorldDirection( c.position.clone() ), p = c.position.clone();
	const WL = a.waterLevel ?? 0, ground = ( x, z ) => Math.max( a.hf.heightAt( x, z ), WL );
	for ( let k = 0; k < 4000 && p.y > ground( p.x, p.z ); k ++ ) p.addScaledVector( dir, 1 );
	// on land: back toward the camera out of the water
	for ( let k = 0; k < 400 && a.hf.heightAt( p.x, p.z ) < WL + 1; k ++ ) p.addScaledVector( fwd, - 3 );
	const far = [ c.position.x + fwd.x * 900, c.position.z + fwd.z * 900 ];
	L.paused = true;
	const order = [ [ 'far', ...far ], [ 'near', p.x, p.z ], [ 'mid', p.x + fwd.x * 110, p.z + fwd.z * 110 ] ];
	if ( nearFirst ) order.reverse();
	for ( const [ kind, sx, sz ] of order ) {
		if ( kind === 'near' ) {
			const ex = p.x - fwd.x * 40, ez = p.z - fwd.z * 40;
			a.views.push( { label: 'near', pos: [ ex, ground( ex, ez ) + 5, ez ], target: [ p.x, ground( p.x, p.z ) + 4, p.z ] } );
			a.setView( a.views.length - 1 );
			await sleep( 2500 );
		}
		const info = L.strike( sx, sz );
		res.push( kind + ' ' + JSON.stringify( info ) );
		for ( const t of kind === 'near' ? [ 0.17, 0.35, 0.7, 1.6 ] : [ 0.08, 0.17, 0.42 ] ) await at( `${ kind }_${ t }`, t );
		for ( const s of L.slots ) s.hide();
		L.events.length = 0; L.update( 0, a.renderer );
	}
	return res;
}, prefix, cam, args.includes( '--near-first' ) );
for ( const l of out ) console.log( l );
await browser.close();
