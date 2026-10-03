// QA of the sun's shadows: views where they should show (the village street, a slope seen from above,
// a wood, the aerial view), each through app.capture, which places the shadow box on the view as the
// main loop does (main.js placeShadow).
//   node tools/shadows.mjs [prefix]   ->  shots/<prefix>_{village,slope,wood,aerial}.png
// A still-frame test of the flicker does not work: the water and the grass move with the clock and
// their change hides a shadow shifted by a texel (old and new snapping measured the same).
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : 'shadows';
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
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
await page.evaluate( () => { window.__app.dynamicRes = false; window.__app.setFocus( false ); } );

// camera ( x, height above the ground, z ) looking at ( x, height above the ground, z )
const views = {
	village: [ - 20, 6, 30, - 45, 1, 0 ],
	slope: [ - 110, 14, - 120, - 60, 2, - 60 ],
	wood: [ - 150, 4, 60, - 120, 1, 20 ],
	aerial: [ 10, 220, 160, - 10, 0, 0 ]
};
for ( const [ name, [ x, dy, z, tx, ty, tz ] ] of Object.entries( views ) ) {
	await page.evaluate( async ( x, dy, z, tx, ty, tz, name ) => {
		const a = window.__app, V = a.camera.position.constructor;
		a.freecam.jumpTo( new V( x, a.hf.heightAt( x, z ) + dy, z ), new V( tx, a.hf.heightAt( tx, tz ) + ty, tz ) );
		await new Promise( ( r ) => setTimeout( r, 500 ) );
		// twice: right after a change app.capture returns the frame before
		await a.capture( name ); await a.capture( name );
	}, x, dy, z, tx, ty, tz, `${ prefix }_${ name }` );
}
console.log( `shots/${ prefix }_{${ Object.keys( views ).join( ',' ) }}.png` );
if ( errors.length ) { console.log( 'console errors:' ); for ( const e of errors ) console.log( '  ', e ); process.exitCode = 1; }
await browser.close();
