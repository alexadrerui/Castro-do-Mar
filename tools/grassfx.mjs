// The grass's backlight and the grass pressed down around the rocks (grass.js): a meadow looking into
// the low sun with the backlight off and on (shots/<prefixo>_back0.png, _back.png), and a rock in the
// meadow near the village without and with the trampling (_rock0.png, _rock.png).
//   node tools/grassfx.mjs [prefixo] [--hour=17.2] [--params=shadows=1] [--strength=]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const args = process.argv.slice( 2 );
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) ) || 'grassfx';
const hour = + ( ( args.find( ( x ) => x.startsWith( '--hour=' ) ) || '--hour=17.2' ).slice( 7 ) );
const extra = ( args.find( ( x ) => x.startsWith( '--params=' ) ) || '--params=' ).slice( 9 );
const strength = ( args.find( ( x ) => x.startsWith( '--strength=' ) ) || '--strength=' ).slice( 11 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
const out = await page.evaluate( async ( prefix, hour, strength ) => {
	const a = window.__app, hf = a.hf, G = a.grass, D = G.density, sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	const meadow = ( x, z ) => { const i = Math.floor( ( x - D.x0 ) / D.texel ), j = Math.floor( ( z - D.z0 ) / D.texel ); return i < 0 || j < 0 || i >= D.res || j >= D.res ? 0 : D.data[ ( j * D.res + i ) * 4 + 1 ] / 255; };
	const shot = async ( n ) => { await a.capture( `${ prefix }_${ n }` ); await a.capture( `${ prefix }_${ n }` ); };
	a.setFocus( false ); a.clock.set( hour );
	await sleep( 500 );
	// 1) a meadow looking into the sun: the densest meadow within 260 m of the village, with open meadow
	// towards the sun
	const L = a.sky.state.lightDir, lx = L.x / Math.hypot( L.x, L.z ), lz = L.z / Math.hypot( L.x, L.z );
	let best = null;
	for ( let z = - 260; z <= 260; z += 6 ) for ( let x = - 280; x <= 240; x += 6 ) {
		let m = 0; for ( let k = 0; k <= 30; k += 6 ) m += meadow( x + lx * k, z + lz * k );
		if ( hf.heightAt( x, z ) > 3 && ( ! best || m > best.m ) ) best = { x, z, m };
	}
	const gy = hf.heightAt( best.x, best.z );
	a.views.push( { label: 'back', pos: [ best.x, gy + 1.1, best.z ], target: [ best.x + lx * 25, hf.heightAt( best.x + lx * 25, best.z + lz * 25 ) + 0.3, best.z + lz * 25 ] } );
	a.setView( a.views.length - 1 );
	await sleep( 2000 );
	if ( strength ) G.trans.strength.value = + strength;
	const s0 = G.trans.strength.value;
	G.trans.strength.value = 0; await shot( 'back0' );
	G.trans.strength.value = s0; await shot( 'back' );
	// 2) a rock in the meadow near the village (radius 0.8-3 m)
	const R = G.rocks; let rk = null;
	for ( let k = 0; k < R.xs.length; k ++ ) {
		const d = Math.hypot( R.xs[ k ] + 15, R.zs[ k ] - 5 );
		if ( d > 300 || R.rs[ k ] < 0.8 || R.rs[ k ] > 3 ) continue;
		const m = meadow( R.xs[ k ] + 2, R.zs[ k ] ) + meadow( R.xs[ k ] - 2, R.zs[ k ] ) + meadow( R.xs[ k ], R.zs[ k ] + 2 ) + meadow( R.xs[ k ], R.zs[ k ] - 2 );
		if ( ! rk || m > rk.m || ( m === rk.m && d < rk.d ) ) rk = { k, m, d, x: R.xs[ k ], z: R.zs[ k ], r: R.rs[ k ] };
	}
	a.clock.set( 13 );
	const cd = rk.r * 2 + 3, cx = rk.x - lz * cd, cz = rk.z + lx * cd; // the sun from the side (across the view)
	a.views.push( { label: 'rock', pos: [ cx, hf.heightAt( cx, cz ) + 2.2, cz ], target: [ rk.x, hf.heightAt( rk.x, rk.z ) + 0.3, rk.z ] } );
	a.setView( a.views.length - 1 );
	await sleep( 2500 );
	const f0 = G.trample.flatten.value, b0 = G.trample.bend.value;
	G.trample.flatten.value = 0; G.trample.bend.value = 0; await shot( 'rock0' );
	G.trample.flatten.value = f0; G.trample.bend.value = b0; await shot( 'rock' );
	return { meadow: best, rock: rk, rocksInWindow: G.trampleRocks, rocksTotal: R.xs.length };
}, prefix, hour, strength );
console.log( JSON.stringify( out ) );
console.log( errors.length ? 'page errors:\n' + errors.join( '\n' ) : 'no page errors' );
await browser.close();
