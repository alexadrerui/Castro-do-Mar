// QA for the fish: dives off the coast, lets the fish cells spawn, prints the groups and captures
// a close-up of one group of each species.
//   node tools/fish.mjs [prefix] [species...]   -> shots/<prefix>_<species>.png
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'fish';
const only = process.argv.slice( 3 );
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE,
	headless: 'new',
	protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( m.type() === 'error' || ( m.type() === 'warn' && ! /maxLeafSize|powerPreference/.test( m.text() ) ) ) console.log( '[page]', m.type(), m.text().slice( 0, 600 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 600 ) ) );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 240000, polling: 1000 } );

const out = await page.evaluate( async ( prefix, only ) => {
	const a = window.__app;
	a.dynamicRes = false;
	a.setFocus?.( false ); // sharp close-ups
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	const view = ( pos, target ) => { a.views.push( { label: 'qa', pos, target } ); a.setView( a.views.length - 1 ); a.views.pop(); };
	// open water off the coast, 6+ m deep
	let x = 0, z = 0;
	for ( x = 40; x < 2000; x += 10 ) if ( a.hf.heightAt( x, z ) < - 6 ) break;
	const res = { spot: [ x, z ] };
	view( [ x, - 3, z ], [ x - 30, - 3, z ] );
	await sleep( 6000 ); // cells spawn one per frame
	res.stats = { ...a.fish.stats };
	res.groups = {};
	for ( const g of a.fish.groups ) res.groups[ g.sp.name ] = ( res.groups[ g.sp.name ] || 0 ) + 1;
	await a.capture( prefix + '_wide' );
	// a close-up of one fish per species, side-on, with the simulation paused
	a.fish.paused = true;
	const seen = new Set();
	for ( const g of a.fish.groups.slice() ) {
		const name = g.sp.name;
		if ( seen.has( name ) || ( only.length && ! only.includes( name ) ) ) continue;
		if ( ! a.fish.groups.includes( g ) ) continue; // its cell was dropped after an earlier jump
		seen.add( name );
		const i = g.offset, P = a.fish.pos, H = a.fish.head;
		const fx = P[ i * 3 ], fy = P[ i * 3 + 1 ], fz = P[ i * 3 + 2 ];
		const hx = H[ i * 3 ], hz = H[ i * 3 + 2 ], hl = Math.hypot( hx, hz ) || 1;
		const L = a.fish.size[ i ];
		const d = name === 'ray' ? L * 2.2 : g.count > 150 ? 6 : L * 2.6 + 0.3;
		// beside the fish (perpendicular to its heading), a little above for the ray
		// the side with the lower ground (on slopes the other side is inside the hill), from a
		// little above
		const sx = - hz / hl, sz = hx / hl;
		const side = a.hf.heightAt( fx + sx * d, fz + sz * d ) < a.hf.heightAt( fx - sx * d, fz - sz * d ) ? 1 : - 1;
		const cx = fx + sx * d * side, cz = fz + sz * d * side;
		const cy = Math.max( fy + ( name === 'ray' ? L * 1.4 : d * 0.35 ), a.hf.heightAt( cx, cz ) + 0.7 );
		view( [ cx, cy, cz ], [ fx, fy, fz ] );
		await sleep( 400 );
		await a.capture( prefix + '_' + name );
	}
	a.fish.paused = false;
	res.captured = [ ...seen ];
	return res;
}, prefix, only );
console.log( JSON.stringify( out ) );
await browser.close();
