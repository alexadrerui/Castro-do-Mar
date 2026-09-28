// GPU cost breakdown: node tools/perf.mjs [view]
// Measures GPU ms/frame (timestamp queries) with everything on, then with
// one feature switched off at a time; the difference is that feature's cost.
import puppeteer from 'puppeteer-core';

const view = Number( process.argv[ 2 ] || 0 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5190/?auto&perf', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 1000 } );
const res = await page.evaluate( async ( view ) => {
	const a = window.__app;
	a.dynamicRes = false;
	a.setView( view );
	await new Promise( ( r ) => setTimeout( r, 2000 ) );
	const P = () => a.gpuProfile( 30 );
	await P(); // warm pipelines
	const out = { all: await P() };
	const toggle = async ( name, off, on ) => { off(); await P(); out[ name ] = await P(); on(); };
	for ( const k of Object.keys( a.layers ) ) {
		const o = a.layers[ k ].object;
		await toggle( '-' + k, () => { o.visible = false; }, () => { o.visible = true; } );
	}
	await toggle( '-terrain', () => { a.terrain.mesh.visible = false; }, () => { a.terrain.mesh.visible = true; } );
	await toggle( '-shadows', () => { a.sky.sun.castShadow = false; }, () => { a.sky.sun.castShadow = true; } );
	await toggle( '-reflection', () => a.setReflections( false ), () => a.setReflections( true ) );
	await toggle( '-dof', () => a.setFocus( false ), () => a.setFocus( true ) );
	await toggle( '-grade', () => { a.grade.value = 0; }, () => { a.grade.value = 1; } );
	return out;
}, view );
const base = res.all.gpuMs;
for ( const [ k, v ] of Object.entries( res ) ) {
	const d = k === 'all' ? '' : `  saves ${( base - v.gpuMs ).toFixed( 2 )} ms`;
	console.log( `${k.padEnd( 14 )} gpu ${String( v.gpuMs ).padStart( 7 )} ms  cpu ${String( v.cpuMs ).padStart( 7 )} ms  tris ${v.tris}  calls ${v.calls}${d}` );
}
await browser.close();
