// Flicker of a still view: the camera held at one spot, frames of the live loop one after the other,
// and the per-pixel change between consecutive frames (mean absolute luma difference, x 8, in
// shots/<prefixo>_flicker_<step>.png; the first frame in shots/<prefixo>_frame_<step>.png). Steps are
// JS snippets as in tools/variants.mjs (cumulative), e.g. "semvento::a.foliageMaterial.userData.foliage.wind.value=0".
//   node tools/flicker.mjs <prefixo> --at=x,z[,alturaOlho] --look=x,z [--frames=8] [--params=...] [--keep] "nome::js" ...
// --keep leaves the frames in shots/.flk*/
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice( 2 );
const prefix = args.find( ( x ) => ! x.startsWith( '--' ) && ! x.includes( '::' ) ) || 'flicker';
const opt = ( k, d ) => ( args.find( ( x ) => x.startsWith( `--${ k }=` ) ) || `--${ k }=${ d }` ).split( '=' ).slice( 1 ).join( '=' );
const at = opt( 'at', '-240,150,1.6' ).split( ',' ).map( Number );
const look = opt( 'look', '-228,160' ).split( ',' ).map( Number );
const frames = + opt( 'frames', 8 );
const extra = opt( 'params', '' );
const steps = [ [ 'base', '' ], ...args.filter( ( x ) => x.includes( '::' ) ).map( ( x ) => { const i = x.indexOf( '::' ); return [ x.slice( 0, i ), x.slice( i + 2 ) ]; } ) ];
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1280,720' ],
	defaultViewport: { width: 1280, height: 720 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) console.log( '[page]', m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
await page.evaluate( ( at, look ) => {
	const a = window.__app;
	a.dynamicRes = false;
	const y = a.hf.heightAt( at[ 0 ], at[ 1 ] ) + ( at[ 2 ] ?? 1.6 ), ty = a.hf.heightAt( look[ 0 ], look[ 1 ] ) + 0.3;
	a.views.push( { label: 'flicker', pos: [ at[ 0 ], y, at[ 1 ] ], target: [ look[ 0 ], ty, look[ 1 ] ] } );
	a.setView( a.views.length - 1 );
	a.focus && ( a.focus.enabled = false );
	document.querySelectorAll( '.hud, #hud, .panel' ).forEach( ( e ) => { e.style.display = 'none'; } );
}, at, look );
await new Promise( ( r ) => setTimeout( r, 2500 ) );
const tmp = fs.mkdtempSync( 'shots/.flk' );
for ( const [ name, js ] of steps ) {
	if ( js ) await page.evaluate( async ( js ) => { await ( 0, eval )( `(async (a) => { ${ js } })` )( window.__app ); }, js );
	await new Promise( ( r ) => setTimeout( r, 1200 ) );
	const files = [];
	for ( let k = 0; k < frames; k ++ ) {
		const f = `${ tmp }/${ name }_${ k }.png`;
		await page.screenshot( { path: f } );
		files.push( f );
	}
	const out = execFileSync( 'python', [ '-c', `
import sys
from PIL import Image, ImageChops
fs=sys.argv[1:-2]; outF=sys.argv[-2]; outI=sys.argv[-1]
ims=[Image.open(f).convert('L') for f in fs]
acc=None
for a,b in zip(ims,ims[1:]):
  d=ImageChops.difference(a,b)
  acc=d if acc is None else ImageChops.add(acc,d)
n=len(ims)-1
m=acc.point(lambda v: min(255, v*8//n))
m.save(outF); Image.open(fs[0]).save(outI)
h=m.histogram(); tot=sum(h)
print(round(sum(i*c for i,c in enumerate(h))/tot/8,2), round(sum(h[64:])/tot*100,2))
`, ...files, `shots/${ prefix }_flicker_${ name }.png`, `shots/${ prefix }_frame_${ name }.png` ] ).toString().trim().split( ' ' );
	console.log( name.padEnd( 12 ), 'mean |dL|', out[ 0 ], ' pixels > 8:', out[ 1 ] + '%' );
}
if ( args.includes( '--keep' ) ) console.log( 'frames in', tmp ); else fs.rmSync( tmp, { recursive: true } );
await browser.close();
