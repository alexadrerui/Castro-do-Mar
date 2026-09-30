// QA for the gulls: close-ups of one bird (side, below, above) and a wide view of the bay.
//   node tools/gulls.mjs [prefix] [bird index]   -> shots/<prefix>_<view>.png
// The flight is paused (app.gulls.paused), the bird's position is computed here with the same
// formula as the vertex shader (world/birds/gulls.js) and the camera is set next to it.
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'gulls';
const bird = Number( process.argv[ 3 ] ?? 3 );
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( m.type() === 'error' || ( m.type() === 'warn' && ! /maxLeafSize|powerPreference/.test( m.text() ) ) ) console.log( '[page]', m.type(), m.text().slice( 0, 600 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 600 ) ) );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 240000, polling: 1000 } );

const out = await page.evaluate( async ( prefix, i ) => {
	const a = window.__app;
	a.dynamicRes = false;
	a.setFocus?.( false );
	const g = a.gulls.mesh.geometry, A = g.attributes.gA.array, B = g.attributes.gB.array;
	a.gulls.paused = true;
	const at = ( t ) => {
		const R = A[ i * 4 + 2 ], dir = B[ i * 4 + 3 ];
		const th = B[ i * 4 ] + t * B[ i * 4 + 1 ] / R * dir;
		return {
			p: [ A[ i * 4 ] + Math.cos( th ) * R, A[ i * 4 + 3 ] + Math.sin( th * 2 + B[ i * 4 + 2 ] ) * 3, A[ i * 4 + 1 ] + Math.sin( th ) * R ],
			f: [ - Math.sin( th ) * dir, 0, Math.cos( th ) * dir ]
		};
	};
	const shot = async ( name, off ) => {
		const s = at( a.gulls.time.value );
		const r = [ s.f[ 2 ], 0, - s.f[ 0 ] ];
		const pos = [ 0, 1, 2 ].map( ( k ) => s.p[ k ] + r[ k ] * off[ 0 ] + ( k === 1 ? off[ 1 ] : 0 ) + s.f[ k ] * off[ 2 ] );
		a.views.push( { label: 'qa', pos, target: s.p } ); a.setView( a.views.length - 1 ); a.views.pop();
		await new Promise( ( r ) => setTimeout( r, 400 ) ); // the free camera applies the jump on its next update
		await a.capture( `${ prefix }_${ name }` );
		return { bird: s.p.map( ( v ) => +v.toFixed( 1 ) ), want: pos.map( ( v ) => +v.toFixed( 1 ) ), cam: a.camera.position.toArray().map( ( v ) => +v.toFixed( 1 ) ), t: +a.gulls.time.value.toFixed( 2 ) };
	};
	a.setView( 4 ); await new Promise( ( r ) => setTimeout( r, 1000 ) ); // settle the free camera after the load
	await shot( 'warm', [ 3.2, 0.3, 0.6 ] ); // the first capture after a jump still shows the old view
	const res = {};
	res.side = await shot( 'side', [ 3.2, 0.3, 0.6 ] );
	a.gulls.time.value += 0.12; // another moment of the wing beat
	res.below = await shot( 'below', [ 0.8, - 2.6, 0.4 ] );
	a.gulls.time.value += 0.12;
	res.above = await shot( 'above', [ 0.6, 2.8, - 0.8 ] );
	a.setView( 4 ); await new Promise( ( r ) => setTimeout( r, 800 ) );
	await a.capture( `${ prefix }_wide` );
	return res;
}, prefix, bird );
console.log( JSON.stringify( out ) );
await browser.close();
