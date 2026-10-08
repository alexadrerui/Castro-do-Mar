// GPU time per frame from timestamp queries resolved every frame (as stats-gl does in the #debug panel;
// app.gpuProfile resolved once after many frames and read ~0.1 ms). Variants are applied in turn on the
// same page and view, interleaved over rounds, to compare costs with the machine's noise averaged out.
//   node tools/gputime.mjs [view=0] "name::js" "name::js" ... [--rounds=3] [--frames=90] [--params=...]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const opt = ( k, d ) => ( args.find( ( a ) => a.startsWith( `--${ k }=` ) ) || '' ).split( '=' ).slice( 1 ).join( '=' ) || d;
const view = +( args.find( ( a ) => /^\d+$/.test( a ) ) ?? 0 );
const variants = args.filter( ( a ) => a.includes( '::' ) ).map( ( a ) => { const i = a.indexOf( '::' ); return [ a.slice( 0, i ), a.slice( i + 2 ) ]; } );
const rounds = +opt( 'rounds', 3 ), frames = +opt( 'frames', 90 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
await page.goto( `http://localhost:5190/?auto&perf${ opt( 'params', '' ) ? '&' + opt( 'params', '' ) : '' }`, { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 500 } );
await page.evaluate( ( v ) => { const a = window.__app; a.dynamicRes = false; a.renderer.setPixelRatio( 1 ); a.setView( v ); }, view );
await new Promise( ( r ) => setTimeout( r, 3000 ) );
const res = Object.fromEntries( variants.map( ( [ n ] ) => [ n, [] ] ) );
for ( let r = 0; r < rounds; r ++ ) for ( const [ name, js ] of variants ) {
	const ms = await page.evaluate( async ( js, frames ) => {
		const a = window.__app;
		new Function( 'a', js )( a );
		const loop = () => new Promise( ( r ) => requestAnimationFrame( r ) );
		for ( let k = 0; k < 30; k ++ ) { await loop(); await a.renderer.resolveTimestampsAsync( 'render' ); }
		let sum = 0, n = 0;
		for ( let k = 0; k < frames; k ++ ) {
			await loop();
			await a.renderer.resolveTimestampsAsync( 'render' );
			const t = a.renderer.info.render.timestamp;
			if ( t > 0 ) { sum += t; n ++; }
		}
		return n ? sum / n : - 1;
	}, js, frames );
	res[ name ].push( ms );
}
for ( const [ n, v ] of Object.entries( res ) ) console.log( n.padEnd( 16 ), v.map( ( x ) => x.toFixed( 2 ) ).join( '  ' ), '  mean', ( v.reduce( ( a, b ) => a + b, 0 ) / v.length ).toFixed( 2 ), 'ms' );
await browser.close();
