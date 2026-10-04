// The rain up close (world/weather.js streaks, world/rainImpacts.js marks and trickles on stone):
// a round house's wall and a big granite rock in full rain, then the streaks with the camera still
// and flying forward at 15 m/s. shots/<prefixo>_{wall,rock,still,flying}.png
//   node tools/rainfx.mjs [prefixo] [--params=...]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) ) || 'rainfx';
const extra = ( args.find( ( x ) => x.startsWith( '--params=' ) ) || '--params=' ).slice( 9 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto&rain=1' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
await page.evaluate( () => { const a = window.__app; a.weather.level = 1; a.weather.wetness.value = 1; a.clock?.set( 13 ); } );

const shot = async ( name, setup ) => {
	await page.evaluate( setup );
	await new Promise( ( r ) => setTimeout( r, 1500 ) );
	// twice: app.capture hands back the previous frame when the state changed just before
	await page.evaluate( async ( n ) => { await window.__app.capture( n ); await window.__app.capture( n ); }, `${ prefix }_${ name }` );
	console.log( 'shot', name );
};
// a round house's wall, at eye height, 3 m away
await shot( 'wall', () => {
	const a = window.__app, hf = a.hf, b = a.layout?.BUILDINGS?.[ 0 ] ?? { x: - 63, z: - 22, r: 8.8 };
	const d = { x: 0.6, z: 0.8 }, g = hf.heightAt( b.x + d.x * ( b.r + 3 ), b.z + d.z * ( b.r + 3 ) );
	a.weather.rain.forceVelocity = null;
	a.views.push( { label: 'wall', pos: [ b.x + d.x * ( b.r + 3.2 ), g + 1.5, b.z + d.z * ( b.r + 3.2 ) ], target: [ b.x + d.x * b.r, g + 1.1, b.z + d.z * b.r ] } );
	a.setView( a.views.length - 1 );
} );
// the biggest granite rock within 200 m of the village
await shot( 'rock', () => {
	const a = window.__app, hf = a.hf;
	let best = null;
	a.layers.rocks.object.traverse( ( o ) => {
		const ins = o.userData?.instances;
		if ( ! ins || o.parent?.name?.startsWith( 'gravel' ) ) return;
		for ( let k = 0; k < ins.count; k ++ ) {
			const m = ins.matrices, x = m[ k * 16 + 12 ], z = m[ k * 16 + 14 ], sy = Math.hypot( m[ k * 16 + 4 ], m[ k * 16 + 5 ], m[ k * 16 + 6 ] );
			if ( Math.hypot( x + 15, z - 5 ) < 200 && ( ! best || sy > best.sy ) ) best = { x, z, y: m[ k * 16 + 13 ], sy };
		}
	} );
	const r = best.sy * 2.2 + 2, g = hf.heightAt( best.x + r, best.z );
	a.views.push( { label: 'rock', pos: [ best.x + r, Math.max( g, best.y ) + 1.6, best.z + 0.3 * r ], target: [ best.x, best.y + best.sy * 0.5, best.z ] } );
	a.setView( a.views.length - 1 );
} );
// the same two views without the marks and the trickles (the wetness only), to compare
const splat = ( on ) => page.evaluate( async ( on ) => { const m = { rainSplatter: window.__app.rainFx.splatter }; m.rainSplatter.strength.value = on ? 0.7 : 0; m.rainSplatter.trickle.value = on ? 0.7 : 0; }, on );
await splat( false );
await shot( 'rock_off', () => window.__app.setView( window.__app.views.length - 1 ) );
await shot( 'wall_off', () => window.__app.setView( window.__app.views.length - 2 ) );
await splat( true );
// the wet amount alone (white), on the wall
await page.evaluate( () => { window.__app.rainFx.splatter.debug.value = 1; } );
await shot( 'wall_debug', () => window.__app.setView( window.__app.views.length - 2 ) );
await page.evaluate( () => { window.__app.rainFx.splatter.debug.value = 0; } );
if ( args.includes( '--probe' ) ) {
	await page.evaluate( () => { const s = window.__app.rainFx.splatter; s.darken.value = 1; s.rough.value = 1; s.trickle.value = 0.6; s.strength.value = 0.7; } );
	await shot( 'wall_probe', () => window.__app.setView( window.__app.views.length - 2 ) );
	await page.evaluate( () => { window.__app.rainFx.splatter.debug.value = 0.5; } );
	await shot( 'wall_probe_half', () => window.__app.setView( window.__app.views.length - 2 ) );
	await page.evaluate( () => { window.__app.rainFx.splatter.debug.value = 0; } );
}
await shot( 'still', () => { const a = window.__app; a.weather.rain.forceVelocity = null; a.setView( 2 ); } ); // a jump: no velocity (goView flies there)
await shot( 'flying', () => {
	const a = window.__app, d = a.camera.getWorldDirection( a.camera.position.clone() );
	a.weather.rain.forceVelocity = d.multiplyScalar( 15 );
} );
console.log( errors.length ? 'page errors:\n' + errors.join( '\n' ) : 'no page errors' );
await browser.close();
