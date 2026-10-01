// Captures the castro house review page (review/castro.html) from the five reference viewpoints:
// node tools/castroreview.mjs [prefix] [--detail=0|1|2] [--flat] [--unlit] [--mat] [--plain] [--close]
// Writes shots/<prefix>_ref<k>.png and shots/<prefix>_sheet.png (reference above, render below).
import puppeteer from 'puppeteer-core';

const prefix = process.argv.slice( 2 ).find( ( a ) => ! a.startsWith( '--' ) ) || 'castro';
const detail = ( process.argv.find( ( a ) => a.startsWith( '--detail=' ) ) || '--detail=2' ).slice( 9 );
const flat = process.argv.includes( '--flat' );
const unlit = process.argv.includes( '--unlit' );
const real = process.argv.includes( '--mat' );
const plain = process.argv.includes( '--plain' ); // flat backdrop for the skill's Tier 1 masks
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await puppeteer.launch( {
	executablePath: EDGE,
	headless: 'new',
	protocolTimeout: 300000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1200,700' ],
	defaultViewport: { width: 1200, height: 700 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( [ 'error', 'warn' ].includes( m.type() ) ) console.log( '[page]', m.type(), m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
await page.goto( `http://localhost:5190/review/castro.html?detail=${ detail }${ flat ? '&flat' : '' }${ plain ? '&plain' : '' }${ unlit ? '&unlit' : '' }${ real ? '&mat' : '' }`, { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__review && window.__review.ready, { timeout: 120000 } );
await page.evaluate( ( p ) => window.__review.shoot( p ), prefix );
// --close: the grazing close-ups of the surface pass, shots/<prefix>_close_<name>.png
if ( process.argv.includes( '--close' ) ) {
	await page.evaluate( ( p ) => window.__review.shootClose( p ), prefix );
	console.log( 'shots/' + prefix + '_close_*.png' );
}

// comparison sheet: one column per view, reference on top, render below, all at 420 px wide
const sheet = await page.evaluate( async ( p ) => {
	const W = 420, cols = window.__review.VIEWS;
	const load = ( src ) => new Promise( ( r, e ) => { const i = new Image(); i.onload = () => r( i ); i.onerror = e; i.src = src; } );
	const H = Math.max( ...cols.map( ( v ) => v.h * W / v.w ) );
	const c = document.createElement( 'canvas' );
	c.width = W * cols.length; c.height = Math.ceil( H * 2 );
	const g = c.getContext( '2d' );
	g.fillStyle = '#222'; g.fillRect( 0, 0, c.width, c.height );
	for ( let k = 0; k < cols.length; k ++ ) {
		const v = cols[ k ], h = v.h * W / v.w;
		g.drawImage( await load( `/ref/casa_castro/ref_${ v.ref }.png` ), k * W, 0, W, h );
		g.drawImage( await load( `/shots/${ p }_ref${ v.ref }.png?t=${ Date.now() }` ), k * W, H, W, h );
	}
	const blob = await new Promise( ( r ) => c.toBlob( r, 'image/png' ) );
	await fetch( `/__capture?name=${ p }_sheet`, { method: 'POST', body: blob } );
	return c.width + 'x' + c.height;
}, prefix );
console.log( 'shots/' + prefix + '_ref1..5.png, sheet', sheet );
await browser.close();
