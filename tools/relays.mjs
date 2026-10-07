// The Nostr relays of the shared visit (core/multiplayer.js RELAYS) one by one: two visitors in two
// browser profiles join a room through only that relay (review/relays.html) and must meet within 25 s.
// Prints the time each relay took, or "no".
// --late=s: instead, all the relays together, and the first visitor alone in the room for s seconds
// before the second comes (--n rooms at once; --refresh=s leaves and joins again every s seconds while
// alone, as the app does). Without the refresh, 1 in 3-4 rooms left alone 4-5 min never met.
//   node tools/relays.mjs [host ...]   (default: the list in src/core/multiplayer.js)
//   node tools/relays.mjs --late=300 [--refresh=90] [--n=4]
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const opt = ( k ) => ( process.argv.find( ( a ) => a.startsWith( `--${ k }=` ) ) || '' ).split( '=' )[ 1 ];
let hosts = process.argv.slice( 2 ).filter( ( a ) => ! a.startsWith( '--' ) );
if ( ! hosts.length ) {
	const src = fs.readFileSync( new URL( '../src/core/multiplayer.js', import.meta.url ), 'utf8' );
	hosts = [ ...src.match( /const RELAYS = \[([\s\S]*?)\]/ )[ 1 ].matchAll( /'wss:\/\/([^']+)'/g ) ].map( ( m ) => m[ 1 ] );
}
const browser = await puppeteer.launch( { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' } );
const test = async ( host ) => {
	const room = 'r' + Math.random().toString( 36 ).slice( 2, 8 );
	const ctx = [ await browser.createBrowserContext(), await browser.createBrowserContext() ];
	const pages = await Promise.all( ctx.map( ( c ) => c.newPage() ) );
	const t0 = Date.now();
	await Promise.all( pages.map( ( p ) => p.goto( `http://localhost:5190/review/relays.html?relay=${ encodeURIComponent( host ) }&room=${ room }` ) ) );
	let ok = false;
	try { await pages[ 1 ].waitForFunction( () => window.peers > 0, { timeout: 25000, polling: 200 } ); ok = true; } catch ( e ) { /* no */ }
	const s = ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 );
	await Promise.all( ctx.map( ( c ) => c.close() ) );
	return ok ? s + ' s' : 'no';
};
const late = +opt( 'late' ) || 0;
if ( late ) {
	const refresh = opt( 'refresh' ) || '', n = +opt( 'n' ) || 4;
	const one = async () => {
		const room = 'r' + Math.random().toString( 36 ).slice( 2, 8 );
		const url = `http://localhost:5190/review/relays.html?relay=${ hosts.join( ',' ) }&room=${ room }${ refresh ? '&refresh=' + refresh : '' }`;
		const open = async () => { const c = await browser.createBrowserContext(); const p = await c.newPage(); await p.goto( url ); return p; };
		const A = await open();
		await new Promise( ( r ) => setTimeout( r, late * 1000 ) );
		const t0 = Date.now();
		await open();
		try { await A.waitForFunction( () => window.peers >= 1, { timeout: 90000, polling: 250 } ); return ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ) + ' s'; } catch ( e ) { return 'NEVER'; }
	};
	const res = await Promise.all( Array.from( { length: n }, one ) );
	console.log( `alone ${ late } s${ refresh ? `, refreshing every ${ refresh } s` : '' }: ` + res.join( ', ' ) );
} else {
	const res = await Promise.all( hosts.map( async ( h ) => [ h, await test( h ) ] ) );
	for ( const [ h, r ] of res ) console.log( h.padEnd( 30 ), r );
}
await browser.close();
