// Cost of the first dive: frame times right after the camera goes under the water (first time, then
// again somewhere else after surfacing: both spots stream new seabed / fish tiles, so the difference
// is the shaders), and the render pipelines created on the way. node tools/divecost.mjs [params]
import puppeteer from 'puppeteer-core';
const extra = process.argv[ 2 ] ? '&' + process.argv[ 2 ] : '';
const b = await puppeteer.launch( { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ], defaultViewport: { width: 1600, height: 900 } } );
const p = await b.newPage();
await p.goto( 'http://localhost:5190/?auto' + extra, { waitUntil: 'domcontentloaded' } );
await p.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
console.log( await p.evaluate( async () => {
	const a = window.__app, backend = a.renderer.backend;
	// count render pipelines as the backend creates them
	let pipes = 0; const labels = [];
	const dev = backend.device, orig = dev.createRenderPipeline.bind( dev ), origA = dev.createRenderPipelineAsync.bind( dev );
	dev.createRenderPipeline = ( d ) => { pipes ++; labels.push( d.label ); return orig( d ); };
	dev.createRenderPipelineAsync = ( d ) => { pipes ++; labels.push( d.label ); return origA( d ); };
	const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	const frames = ( ms ) => new Promise( ( res ) => {
		const ts = [], t0 = performance.now();
		let last = t0;
		const f = ( t ) => { ts.push( t - last ); last = t; if ( t - t0 < ms ) requestAnimationFrame( f ); else res( ts ); };
		requestAnimationFrame( f );
	} );
	const go = ( pos, target ) => { a.views.push( { label: 'd', pos, target } ); a.setView( a.views.length - 1 ); };
	// two dives at different spots (the seabed and fish tiles are new at both: only the shaders differ)
	const spots = [ [ 200, - 60 ], [ 330, - 200 ] ];
	const above = ( [ x, z ] ) => [ [ x, 30, z ], [ x + 30, 0, z - 20 ] ], under = ( [ x, z ] ) => [ [ x, - 4, z ], [ x + 30, - 6, z - 20 ] ];
	go( ...above( spots[ 0 ] ) ); await frames( 1500 );
	const out = [];
	for ( const k of [ 1, 2 ] ) {
		const p0 = pipes, l0 = labels.length;
		go( ...under( spots[ k - 1 ] ) );
		const ts = await frames( 2500 );
		out.push( `mergulho ${ k }: maior quadro ${ Math.max( ...ts ).toFixed( 0 ) } ms, soma dos > 50 ms ${ ts.filter( ( t ) => t > 50 ).reduce( ( s, t ) => s + t, 0 ).toFixed( 0 ) } ms, pipelines novos ${ pipes - p0 }${ pipes > p0 ? ' (' + labels.slice( l0 ).join( ', ' ) + ')' : '' }` );
		go( ...above( spots[ k % 2 ] ) ); await frames( 1500 );
	}
	return out.join( '\n' );
} ) );
await b.close();
