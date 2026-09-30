// QA for the grass field (world/grass.js): finds a meadow spot and a dune spot in the density
// mask and frames each at eye level and from 12 m, with the depth of field off; also reports the
// grass cells and triangles drawn.
//   node tools/grass.mjs [prefix]   -> shots/<prefix>_<meadow|dune>_<eye|high>.png
import puppeteer from 'puppeteer-core';

const prefix = process.argv[ 2 ] || 'grass';
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

const out = await page.evaluate( async ( prefix ) => {
	const a = window.__app, g = a.grass, hf = a.hf;
	a.dynamicRes = false;
	a.setFocus?.( false );
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	const view = async ( pos, target, name ) => {
		a.views.push( { label: 'qa', pos, target } ); a.setView( a.views.length - 1 ); a.views.pop();
		await sleep( 500 );
		await a.capture( `${ prefix }_${ name }` );
		return { name, tris: g.triangles, cells: g.levels.map( ( l ) => l.count ) };
	};
	// the texel of the density mask with the most of a channel (in a 16 m disc), nearest the village
	const { data, width: res } = g.maskTex.image;
	const T = hf.size / res;
	const find = ( ch, min ) => {
		let best = null, bestD = Infinity;
		for ( let j = 2; j < res - 2; j ++ ) for ( let i = 2; i < res - 2; i ++ ) {
			let s = 0;
			for ( let dj = - 2; dj <= 2; dj ++ ) for ( let di = - 2; di <= 2; di ++ ) s += data[ ( ( j + dj ) * res + i + di ) * 4 + ch ];
			if ( s / 25 < min ) continue;
			const x = hf.x0 + ( i + 0.5 ) * T, z = hf.z0 + ( j + 0.5 ) * T;
			const d = Math.hypot( x + 15, z - 60 );
			if ( d < bestD ) { bestD = d; best = { x, z }; }
		}
		return best;
	};
	const sd = a.sky.state.sunDir, sl = Math.hypot( sd.x, sd.z ) || 1;
	const res2 = [];
	await view( [ 0, 60, 0 ], [ 10, 30, 10 ], 'warm' );
	for ( const [ name, ch, min ] of [ [ 'meadow', 1, 220 ], [ 'dune', 0, 150 ] ] ) {
		const p = find( ch, min );
		if ( ! p ) { res2.push( { name, found: false } ); continue; }
		// camera on the sun's side, looking at the spot
		const cx = p.x + sd.x / sl * 7, cz = p.z + sd.z / sl * 7;
		const y = hf.heightAt( p.x, p.z );
		res2.push( { at: [ p.x, y, p.z ].map( ( v ) => +v.toFixed( 1 ) ), ...await view( [ cx, hf.heightAt( cx, cz ) + 1.6, cz ], [ p.x, y + 0.2, p.z ], name + '_eye' ) } );
		res2.push( await view( [ p.x + sd.x / sl * 14, y + 12, p.z + sd.z / sl * 14 ], [ p.x, y, p.z ], name + '_high' ) );
	}
	return res2;
}, prefix );
console.log( JSON.stringify( out ) );
await browser.close();
