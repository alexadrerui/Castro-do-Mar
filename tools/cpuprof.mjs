// CPU profile of the render loop: node tools/cpuprof.mjs [view] [frames]
// Prints the functions with the most self time (aggregated by name+file).
import puppeteer from 'puppeteer-core';

const view = Number( process.argv[ 2 ] || 0 );
const frames = Number( process.argv[ 3 ] || 60 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 1000 } );
await page.evaluate( async ( view ) => {
	const a = window.__app; a.dynamicRes = false; a.setView( view );
	// warm up: let every pipeline finish compiling before profiling
	for ( let k = 0; k < 60; k ++ ) await new Promise( ( r ) => requestAnimationFrame( r ) );
}, view );
const cdp = await page.createCDPSession();
await cdp.send( 'Profiler.enable' );
await cdp.send( 'Profiler.setSamplingInterval', { interval: 200 } );
await cdp.send( 'Profiler.start' );
const ms = await page.evaluate( async ( frames ) => {
	const t0 = performance.now();
	for ( let k = 0; k < frames; k ++ ) await new Promise( ( r ) => requestAnimationFrame( r ) );
	return ( performance.now() - t0 ) / frames;
}, frames );
const { profile } = await cdp.send( 'Profiler.stop' );
await browser.close();

// self time per node = samples hitting it
const dt = new Map();
const byId = new Map( profile.nodes.map( ( n ) => [ n.id, n ] ) );
for ( let i = 0; i < profile.samples.length; i ++ ) {
	const id = profile.samples[ i ];
	dt.set( id, ( dt.get( id ) || 0 ) + ( profile.timeDeltas[ i ] || 0 ) );
}
const agg = new Map();
let total = 0;
for ( const [ id, t ] of dt ) {
	const n = byId.get( id );
	const f = n.callFrame;
	const file = ( f.url || '' ).split( '/' ).pop().split( '?' )[ 0 ];
	const key = `${f.functionName || '(anon)'}  ${file}:${f.lineNumber + 1}`;
	agg.set( key, ( agg.get( key ) || 0 ) + t );
	total += t;
}
console.log( `frame (rAF) ${ms.toFixed( 1 )} ms; profiled ${( total / 1000 ).toFixed( 0 )} ms` );
[ ...agg.entries() ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 30 ).forEach( ( [ k, t ] ) => {
	console.log( `${( t / total * 100 ).toFixed( 1 ).padStart( 5 )}%  ${k}` );
} );
