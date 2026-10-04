// Ambient sound (audio/ambience.js) at a few places: the level of every layer there and a WAV of what
// is heard (shots/<prefixo>_<place>.wav, stereo) with its loudness, to listen to.
//   node tools/ambience.mjs [prefixo] [--seconds=8] [places...]
// places: shore village forest peak under night rain falls (falls only with a river of the editor)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const args = process.argv.slice( 2 );
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) && ! PLACES().includes( x ) ) || 'amb';
const seconds = + ( ( args.find( ( x ) => x.startsWith( '--seconds=' ) ) || '--seconds=8' ).slice( 10 ) );
function PLACES() { return [ 'shore', 'village', 'forest', 'peak', 'under', 'night', 'rain', 'falls' ]; }
const want = args.filter( ( x ) => PLACES().includes( x ) );
const places = want.length ? want : PLACES().slice( 0, 7 );

const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready && window.__app.ambience, { timeout: 300000, polling: 500 } );
await page.waitForFunction( () => getComputedStyle( document.getElementById( 'loader' ) ).visibility === 'hidden', { timeout: 20000 } );
await page.mouse.click( 800, 450 ); // the gesture that starts the audio
await page.waitForFunction( () => window.__app.ambience.ctx?.state === 'running', { timeout: 20000 } );

// the places, found on the map
const spots = await page.evaluate( () => {
	const a = window.__app, hf = a.hf, F = a.ambience._fields, V = { x: - 15, z: 5 };
	const out = {};
	// shore: from the village eastwards (+x is the sea) to the first shoreline within 12 m
	for ( let x = V.x; x < V.x + 1200; x += 4 ) {
		const s = F.shore.at( x, V.z );
		if ( s && ! s.sea && Math.hypot( s.x - x, s.z - V.z ) < 12 ) { out.shore = [ x, V.z, s.x, s.z ]; break; }
	}
	const h = a.hearths[ 0 ]; out.village = [ h.x + 4, h.z + 3, h.x, h.z ];
	let best = - 1;
	for ( let z = - 600; z <= 600; z += 32 ) for ( let x = - 600; x <= 600; x += 32 ) {
		const f = F.forest.at( x, z );
		if ( f > best && hf.heightAt( x, z ) > 3 ) { best = f; out.forest = [ x, z, x + 20, z + 10 ]; }
	}
	let top = - 1e9;
	for ( let z = - 900; z <= 900; z += 20 ) for ( let x = - 900; x <= 900; x += 20 ) { const y = hf.heightAt( x, z ); if ( y > top ) { top = y; out.peak = [ x, z, x + 50, z + 50 ]; } }
	for ( let x = 200; x < 1200; x += 10 ) if ( hf.heightAt( x, V.z ) < - 8 ) { out.under = [ x, V.z, x + 20, V.z ]; break; }
	for ( const r of a.rivers?.list ?? [] ) for ( const f of r.course.falls ) { const s = r.course.samples[ f.foot ]; out.falls = [ s.x + 15, s.z + 15, s.x, s.z ]; }
	out.forestScore = best;
	return out;
} );
console.log( 'spots', JSON.stringify( spots ) );

const results = [];
for ( const place of places ) {
	const base = place === 'night' ? spots.forest : place === 'rain' ? spots.village : spots[ place ];
	if ( ! base ) { console.log( place.padEnd( 8 ), 'no such place here' ); continue; }
	const r = await page.evaluate( async ( place, base, seconds ) => {
		const a = window.__app, amb = a.ambience, hf = a.hf;
		const [ x, z, tx, tz ] = base;
		const g = hf.heightAt( x, z );
		const y = place === 'under' ? - 3 : place === 'peak' ? g + 25 : g + 1.7;
		a.clock?.set( place === 'night' ? 23 : 8 );
		a.setRain?.( place === 'rain' ? 1 : 0 );
		if ( place === 'rain' ) a.weather.level = 1;
		else if ( a.weather ) a.weather.level = 0;
		a.views.push( { label: place, pos: [ x, y, z ], target: [ tx, place === 'under' ? - 3 : hf.heightAt( tx, tz ) + 1.5, tz ] } );
		a.setView( a.views.length - 1 );
		await new Promise( ( r ) => setTimeout( r, 2500 ) );
		// the rain recording is fetched the first time it rains
		if ( place === 'rain' ) { for ( let k = 0; k < 40 && ! amb.L.rainRec; k ++ ) await new Promise( ( r ) => setTimeout( r, 200 ) ); await new Promise( ( r ) => setTimeout( r, 3000 ) ); }
		// record the master bus
		const ctx = amb.ctx, n = Math.floor( seconds * ctx.sampleRate );
		const L = new Float32Array( n ), R = new Float32Array( n );
		let w = 0;
		const tap = ctx.createScriptProcessor( 4096, 2, 2 );
		tap.onaudioprocess = ( e ) => {
			const l = e.inputBuffer.getChannelData( 0 ), rr = e.inputBuffer.getChannelData( 1 );
			const k = Math.min( l.length, n - w );
			if ( k > 0 ) { L.set( l.subarray( 0, k ), w ); R.set( rr.subarray( 0, k ), w ); w += k; }
		};
		amb.master.connect( tap ); tap.connect( ctx.destination );
		const sink = ctx.createGain(); sink.gain.value = 0; tap.disconnect(); tap.connect( sink ); sink.connect( ctx.destination );
		while ( w < n ) await new Promise( ( r ) => setTimeout( r, 200 ) );
		amb.master.disconnect( tap ); tap.disconnect();
		let s2 = 0, peak = 0;
		for ( let i = 0; i < n; i ++ ) { s2 += L[ i ] * L[ i ] + R[ i ] * R[ i ]; peak = Math.max( peak, Math.abs( L[ i ] ), Math.abs( R[ i ] ) ); }
		// 16-bit WAV
		const sr = ctx.sampleRate, buf = new ArrayBuffer( 44 + n * 4 ), v = new DataView( buf );
		const str = ( o, s ) => { for ( let i = 0; i < s.length; i ++ ) v.setUint8( o + i, s.charCodeAt( i ) ); };
		str( 0, 'RIFF' ); v.setUint32( 4, 36 + n * 4, true ); str( 8, 'WAVE' ); str( 12, 'fmt ' ); v.setUint32( 16, 16, true ); v.setUint16( 20, 1, true ); v.setUint16( 22, 2, true );
		v.setUint32( 24, sr, true ); v.setUint32( 28, sr * 4, true ); v.setUint16( 32, 4, true ); v.setUint16( 34, 16, true ); str( 36, 'data' ); v.setUint32( 40, n * 4, true );
		for ( let i = 0; i < n; i ++ ) { v.setInt16( 44 + i * 4, Math.max( - 1, Math.min( 1, L[ i ] ) ) * 32767, true ); v.setInt16( 46 + i * 4, Math.max( - 1, Math.min( 1, R[ i ] ) ) * 32767, true ); }
		const u8 = new Uint8Array( buf ); let bin = '';
		for ( let k = 0; k < u8.length; k += 8192 ) bin += String.fromCharCode( ...u8.subarray( k, k + 8192 ) );
		const lv = {}; for ( const k in amb.levels ) lv[ k ] = + amb.levels[ k ].toFixed( 2 );
		return { levels: lv, rmsDb: + ( 10 * Math.log10( s2 / ( 2 * n ) + 1e-12 ) ).toFixed( 1 ), peak: + peak.toFixed( 2 ), wav: btoa( bin ) };
	}, place, base, seconds );
	fs.writeFileSync( `shots/${ prefix }_${ place }.wav`, Buffer.from( r.wav, 'base64' ) );
	const active = Object.entries( r.levels ).filter( ( [ , v ] ) => v > 0.02 ).map( ( [ k, v ] ) => k + ' ' + v ).join( ', ' );
	console.log( place.padEnd( 8 ), `rms ${ r.rmsDb } dB, peak ${ r.peak }`.padEnd( 26 ), active );
	results.push( { place, ...r } );
}
console.log( errors.length ? 'page errors:\n' + errors.join( '\n' ) : 'no page errors' );
await browser.close();
