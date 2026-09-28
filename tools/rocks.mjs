// QA for the granite rocks: frames one large rock of each set (tors on the hills, shore boulders,
// talus blocks) and a patch of gravel, side-on, with the depth of field off.
//   node tools/rocks.mjs [prefix]   -> shots/<prefix>_<set>.png
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'rocks';
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

const out = await page.evaluate( async ( prefix ) => {
	const a = window.__app;
	a.dynamicRes = false;
	a.setFocus?.( false );
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	const view = ( pos, target ) => { a.views.push( { label: 'qa', pos, target } ); a.setView( a.views.length - 1 ); a.views.pop(); };
	const THREEm = a.camera.matrixWorld.constructor;
	const m = new THREEm(), p = a.camera.position.clone(), q = a.camera.quaternion.clone(), s = a.camera.scale.clone();
	const res = {};
	const root = a.layers.rocks.object;
	const wanted = { tor: [ 3, 6 ], shore: [ 1.2, 3 ], talus: [ 1.5, 4 ], gravel: [ 0.15, 0.4 ] };
	for ( const [ set, [ smin, smax ] ] of Object.entries( wanted ) ) {
		// the instance of this set closest to the village with a scale in range
		let best = null, bestD = Infinity;
		for ( const chunk of root.children ) {
			if ( ! chunk.name.startsWith( set ) ) continue;
			for ( const tile of chunk.tiles ) {
				const im = tile.hi;
				for ( let i = 0; i < im.count; i ++ ) {
					im.getMatrixAt( i, m );
					m.decompose( p, q, s );
					if ( s.x < smin || s.x > smax ) continue;
					const d = Math.hypot( p.x + 15, p.z - 5 );
					if ( d < bestD ) { bestD = d; best = { x: p.x, y: p.y, z: p.z, s: s.x }; }
				}
			}
		}
		if ( ! best ) { res[ set ] = null; continue; }
		const d = best.s * ( set === 'gravel' ? 6 : 2.6 );
		// the lower side (on slopes the uphill side is inside the ground)
		let bx = 1, bz = 0, low = Infinity;
		for ( let k = 0; k < 8; k ++ ) {
			const an = k / 8 * Math.PI * 2, x = best.x + Math.cos( an ) * d, z = best.z + Math.sin( an ) * d;
			const h = a.hf.heightAt( x, z );
			if ( h < low ) { low = h; bx = Math.cos( an ); bz = Math.sin( an ); }
		}
		const cx = best.x + bx * d, cz = best.z + bz * d;
		const cy = Math.max( a.hf.heightAt( cx, cz ) + 1.6, best.y + best.s * 0.5 );
		view( [ cx, cy, cz ], [ best.x, best.y + best.s * 0.2, best.z ] );
		await sleep( 800 );
		await a.capture( prefix + '_' + set );
		res[ set ] = { at: [ +best.x.toFixed( 1 ), +best.y.toFixed( 1 ), +best.z.toFixed( 1 ) ], scale: +best.s.toFixed( 2 ) };
	}
	return res;
}, prefix );
console.log( JSON.stringify( out ) );
await browser.close();
