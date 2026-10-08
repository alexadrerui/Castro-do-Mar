// What one rebuild of the sky's environment map (sky.buildEnv(): the PMREM, scene.environment)
// costs: the call on the CPU and the time until the GPU has finished it (queue.onSubmittedWorkDone),
// each against an empty wait, over N rebuilds at a few sun heights. For the real-window effect of the
// rebuilds while the time passes, compare tools/fps.mjs with the clock playing, with and without them:
//   node tools/fps.mjs 0 --js="a.clock.speed=6; a.clock.playing=true"
//   node tools/fps.mjs 0 --js="a.clock.speed=6; a.clock.playing=true; a.sky.buildEnv=()=>{}"
//   node tools/pmrem.mjs [n=12]
import puppeteer from 'puppeteer-core';

const n = +( process.argv[ 2 ] || 12 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 500 } );
await new Promise( ( r ) => setTimeout( r, 2000 ) );
const r = await page.evaluate( async ( n ) => {
	const a = window.__app, q = a.renderer.backend.device.queue;
	const idle = async () => { await q.onSubmittedWorkDone(); };
	const stats = ( v ) => { const s = [ ...v ].sort( ( x, y ) => x - y ); return { mean: +( v.reduce( ( m, x ) => m + x, 0 ) / v.length ).toFixed( 2 ), p50: +s[ s.length >> 1 ].toFixed( 2 ), max: +s[ s.length - 1 ].toFixed( 2 ) }; };
	a.renderer.setAnimationLoop( null ); // nothing else on the GPU meanwhile
	await idle();
	const out = {};
	for ( const h of [ 15.5, 17.4, 23 ] ) {
		a.clock.set( h );
		await idle();
		a.sky.buildEnv(); await idle(); // warm
		const cpu = [], gpu = [], empty = [];
		for ( let k = 0; k < n; k ++ ) {
			let t0 = performance.now(); await idle(); empty.push( performance.now() - t0 );
			t0 = performance.now(); a.sky.buildEnv(); const t1 = performance.now(); await idle(); const t2 = performance.now();
			cpu.push( t1 - t0 ); gpu.push( t2 - t0 );
		}
		out[ h ] = { cpuCall: stats( cpu ), untilGpuDone: stats( gpu ), emptyWait: stats( empty ) };
	}
	return out;
}, n );
for ( const [ h, v ] of Object.entries( r ) ) console.log( `${ h } h  call ${ JSON.stringify( v.cpuCall ) }  until the GPU is done ${ JSON.stringify( v.untilGpuDone ) }  (empty wait ${ JSON.stringify( v.emptyWait ) })` );
await browser.close();
