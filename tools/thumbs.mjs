// The object editor library's pictures (editor/catalogue.js): each item is built by the editor itself
// (?edit, tab Objetos: the same objectEditor.place() a click does) on a flat field away from the
// village, measured (footprint and height, its bounding box), photographed alone in a studio scene
// of its own (a key light and a sky fill, transparent background, three quarters from above) and
// removed again (nothing is saved). Writes public/editor/thumbs/<id>.webp (256², ~10 KB) and
// public/editor/thumbs.json ({ id: { w, d, h } } in m). Run again when an object's look changes.
//   node tools/thumbs.mjs [ids...]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const only = process.argv.slice( 2 ).filter( ( a ) => ! a.startsWith( '--' ) );
const OUT = 'public/editor/thumbs';
fs.mkdirSync( OUT, { recursive: true } );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto&edit', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready && window.__app.objectEditor, { timeout: 300000, polling: 250 } );
await page.click( '#editor-tabs [data-tab=objects]' );

const res = await page.evaluate( async ( only ) => {
	const a = window.__app, oe = a.objectEditor, hf = a.hf, V = a.camera.position.constructor;
	const { CATALOGUE } = await import( '/src/editor/catalogue.js' ); // data only: a second copy is harmless
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	// the flattest open field on land, away from the village (the largest step over 12 m around it)
	let spot = null, best = 1e9;
	for ( let r = 150; r < 700; r += 15 ) {
		for ( let k = 0; k < 48; k ++ ) {
			const x = Math.cos( k / 48 * Math.PI * 2 ) * r, z = Math.sin( k / 48 * Math.PI * 2 ) * r;
			const h = hf.heightAt( x, z );
			if ( h < 4 ) continue;
			let step = 0;
			for ( const [ dx, dz ] of [ [ 12, 0 ], [ - 12, 0 ], [ 0, 12 ], [ 0, - 12 ], [ 8, 8 ], [ - 8, - 8 ] ] ) step = Math.max( step, Math.abs( hf.heightAt( x + dx, z + dz ) - h ) );
			if ( step < best ) { best = step; spot = { x, z, step: +step.toFixed( 2 ) }; }
		}
	}
	const out = { spot, sizes: {}, pics: {} };
	for ( const item of CATALOGUE ) {
		if ( only.length && ! only.includes( item.id ) ) continue;
		oe.arm( item );
		oe.place( { x: spot.x, y: hf.heightAt( spot.x, spot.z ), z: spot.z } );
		const g = oe.selected;
		oe.select( null ); oe.ghost.visible = false;
		g.updateMatrixWorld( true );
		// the bounding box in world space: the editor's selection box helper measures it
		oe.box.setFromObject( g ); oe.box.geometry.computeBoundingBox(); oe.box.visible = false;
		const b = oe.box.geometry.boundingBox, w = b.max.x - b.min.x, d = b.max.z - b.min.z, h = b.max.y - b.min.y;
		out.sizes[ item.id ] = { w: +w.toFixed( 2 ), d: +d.toFixed( 2 ), h: +h.toFixed( 2 ) };
		// a studio of its own: the object alone under a key light and a sky fill, on a clear background
		// (the world's haze, exposure and grass hid the small ones). The classes come from the app's own
		// objects (a second copy of three would not render with its renderer).
		const R = a.renderer, cam = new a.camera.constructor( 28, 1, 0.1, 2000 );
		const c = b.getCenter( new V() ), rad = Math.max( 0.6, b.getSize( new V() ).length() / 2 );
		const dist = rad / Math.sin( 14 * Math.PI / 180 ) * 1.02;
		const dir = new V( 0.7, 0.42, 0.58 ).normalize();
		cam.position.copy( c ).addScaledVector( dir, dist ); cam.lookAt( c ); cam.updateMatrixWorld();
		const studio = new a.scene.constructor();
		const key = new a.sky.sun.constructor( 0xfff1dc, 4.2 ); key.position.copy( c ).add( new V( 30, 50, 10 ) ); key.target.position.copy( c );
		const fill = new a.sky.hemi.constructor( 0xcfe0f5, 0x6a5a40, 2.6 );
		studio.add( key, key.target, fill );
		const parent = g.parent; studio.add( g );
		const rt = new a.scenePass.renderTarget.constructor( 512, 512, { samples: 4 } );
		rt.texture.colorSpace = 'srgb';
		const cc = R.getClearColor( new a.sky.hemi.color.constructor() ), ca = R.getClearAlpha();
		R.setClearColor( 0x000000, 0 );
		R.setRenderTarget( rt ); R.render( studio, cam ); R.setRenderTarget( null );
		R.setClearColor( cc, ca );
		parent.add( g );
		const px = await R.readRenderTargetPixelsAsync( rt, 0, 0, 512, 512 );
		const img = new ImageData( new Uint8ClampedArray( px.buffer, px.byteOffset, 512 * 512 * 4 ), 512, 512 );
		const big = new OffscreenCanvas( 512, 512 ); big.getContext( '2d' ).putImageData( img, 0, 0 );
		const cv = new OffscreenCanvas( 256, 256 ); cv.getContext( '2d' ).drawImage( big, 0, 0, 256, 256 );
		const webp = await cv.convertToBlob( { type: 'image/webp', quality: 0.85 } );
		out.pics[ item.id ] = btoa( String.fromCharCode( ...new Uint8Array( await webp.arrayBuffer() ) ) );
		rt.dispose();
		oe.select( g ); oe.remove(); // gone again (the edit is never saved)
	}
	return out;
}, only );
console.log( 'spot', JSON.stringify( res.spot ) );
const file = 'public/editor/thumbs.json';
const sizes = Object.assign( fs.existsSync( file ) ? JSON.parse( fs.readFileSync( file, 'utf8' ) ) : {}, res.sizes );
fs.writeFileSync( file, JSON.stringify( sizes, null, '\t' ) + '\n' );
for ( const [ id, b64 ] of Object.entries( res.pics ) ) {
	fs.writeFileSync( `${ OUT }/${ id }.webp`, Buffer.from( b64, 'base64' ) );
	console.log( id.padEnd( 14 ), JSON.stringify( res.sizes[ id ] ), ( Buffer.from( b64, 'base64' ).length / 1024 ).toFixed( 1 ) + ' KB' );
}
if ( errors.length ) { console.log( 'page errors:' ); for ( const e of errors ) console.log( '  ', e ); }
await browser.close();
process.exit( errors.length ? 1 : 0 );
