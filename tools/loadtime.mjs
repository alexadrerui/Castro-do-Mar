// Load time per loader step, cold (empty cache) then warm (cache filled by the
// first load), up to the first frame drawn: node tools/loadtime.mjs [loads=2] [extra url params]
import puppeteer from 'puppeteer-core';

const loads = Number( process.argv[ 2 ] ) || 2;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await puppeteer.launch( {
	executablePath: EDGE,
	headless: 'new',
	protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => {
	const t = m.text();
	if ( [ 'error', 'warn' ].includes( m.type() ) || /^(load times|fields:|first frame|precompile|bakes:)/.test( t ) ) console.log( '[page]', t.slice( 0, 400 ) );
} );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e.stack || e ).slice( 0, 900 ) ) );

for ( let i = 0; i < loads; i ++ ) {
	const t0 = Date.now();
	await page.goto( 'http://localhost:5190/?auto' + ( process.argv[ 3 ] ? '&' + process.argv[ 3 ] : '' ), { waitUntil: 'domcontentloaded' } );
	if ( i === 0 ) await page.evaluate( () => new Promise( ( r ) => { const q = indexedDB.deleteDatabase( 'castro-do-mar' ); q.onsuccess = q.onerror = q.onblocked = r; } ) ).then( () => page.reload( { waitUntil: 'domcontentloaded' } ) );
	const first = new Promise( ( r ) => { const f = ( m ) => { if ( m.text().startsWith( 'first frame' ) ) { page.off( 'console', f ); r(); } }; page.on( 'console', f ); } );
	await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 250 } );
	await first;
	console.log( `load ${ i + 1 }${ i === 0 ? ' (cold)' : ' (warm)' }: first frame after ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ) } s` );
	await new Promise( ( r ) => setTimeout( r, Number( process.env.WAIT || 1500 ) ) ); // let the background cache write finish
}
await browser.close();
