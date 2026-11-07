// QA of the thunder (world/lightning.js _thunder): renders it in the page into an OfflineAudioContext
// (the real filters, limiter and panner) for several distances, with the strike to the camera's right
// and left, and prints: the start (should be distance / 343 m/s), the peak (≤ 1: no clipping), the RMS,
// the last 20 ms (≈ 0: no cut at the end) and the left / right energy (the side of the strike).
//   node tools/thunder.mjs [--runs=6] [--params=...]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const runs = Number( ( args.find( ( x ) => x.startsWith( '--runs=' ) ) || '--runs=6' ).slice( 7 ) );
const extra = ( args.find( ( x ) => x.startsWith( '--params=' ) ) || '--params=' ).slice( 9 );
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5190/?auto&meteors=0' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );

const rows = await page.evaluate( async ( runs ) => {
	const L = window.__app.lightning, cam = L.camera;
	const keep = { output: L.output, sound: L.sound, volume: L.volume };
	L.sound = true; L.volume = 1;
	const right = { x: 0, z: 0 };
	cam.updateMatrixWorld();
	const e = cam.matrixWorld.elements; right.x = e[ 0 ]; right.z = e[ 2 ];
	const n = Math.hypot( right.x, right.z ) || 1; right.x /= n; right.z /= n;
	const out = [];
	for ( const dist of [ 30, 100, 250, 600, 1200, 2500 ] ) for ( const side of [ 1, - 1 ] ) {
		const acc = { start: [], peak: [], rms: [], tail: [], lr: [] };
		for ( let r = 0; r < runs; r ++ ) {
			const sr = 48000, len = dist / 343 + 3.5 + Math.min( 5, dist / 600 ) + 0.5;
			const ctx = new OfflineAudioContext( 2, Math.ceil( len * sr ), sr );
			L.output = () => ( { ctx, destination: ctx.destination } );
			L._thunder( dist, 1, cam.position.x + right.x * dist * side, cam.position.z + right.z * dist * side );
			const buf = await ctx.startRendering();
			const a = buf.getChannelData( 0 ), b = buf.getChannelData( 1 );
			let peak = 0, sum = 0, ea = 0, eb = 0, start = - 1, tail = 0;
			for ( let i = 0; i < a.length; i ++ ) {
				const m = Math.max( Math.abs( a[ i ] ), Math.abs( b[ i ] ) );
				if ( start < 0 && m > 1e-3 ) start = i / sr;
				peak = Math.max( peak, m ); sum += ( a[ i ] * a[ i ] + b[ i ] * b[ i ] ) / 2; ea += a[ i ] * a[ i ]; eb += b[ i ] * b[ i ];
			}
			// the last 20 ms of the sound itself (before the silence the render leaves after it)
			let last = a.length - 1;
			while ( last > 0 && Math.abs( a[ last ] ) < 1e-6 && Math.abs( b[ last ] ) < 1e-6 ) last --;
			// the limiter's release leaves a faint tail after the buffer: take 20 ms before the source's end
			const endI = Math.min( a.length - 1, Math.floor( ( dist / 343 + 3.5 + Math.min( 5, dist / 600 ) ) * sr ) );
			for ( let i = Math.max( 0, endI - 960 ); i < endI; i ++ ) tail = Math.max( tail, Math.abs( a[ i ] ), Math.abs( b[ i ] ) );
			acc.start.push( start ); acc.peak.push( peak ); acc.rms.push( Math.sqrt( sum / a.length ) ); acc.tail.push( tail ); acc.lr.push( 10 * Math.log10( ( ea + 1e-12 ) / ( eb + 1e-12 ) ) );
		}
		const med = ( v ) => v.slice().sort( ( x, y ) => x - y )[ v.length >> 1 ];
		out.push( { dist, side: side > 0 ? 'direita' : 'esquerda', delay: +( dist / 343 ).toFixed( 2 ), start: +med( acc.start ).toFixed( 2 ), peakMed: +med( acc.peak ).toFixed( 2 ), peakMax: +Math.max( ...acc.peak ).toFixed( 2 ), rms: +med( acc.rms ).toFixed( 3 ), tailMax: +Math.max( ...acc.tail ).toFixed( 4 ), leftMinusRightDb: +med( acc.lr ).toFixed( 1 ) } );
	}
	Object.assign( L, keep );
	return out;
}, runs );
console.table( rows );
const bad = rows.filter( ( r ) => r.peakMax > 1 || r.tailMax > 0.01 || Math.abs( r.start - r.delay ) > 0.05 || ( r.side === 'direita' ? r.leftMinusRightDb > - 3 : r.leftMinusRightDb < 3 ) );
console.log( bad.length ? 'FALHOU: ' + bad.map( ( r ) => r.dist + ' m ' + r.side ).join( ', ' ) : 'OK' );
await browser.close();
process.exit( bad.length ? 1 : 0 );
