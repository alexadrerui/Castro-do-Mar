// QA of the GPU device-loss recovery (core/recovery.js): a simulated loss reloads the page and brings
// back the camera and the sun; a second loss right after shows the message instead of looping.
//   node tools/gpulost.mjs
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch( { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 600000, args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ], defaultViewport: { width: 1600, height: 900 } } );
const p = await b.newPage();
const check = ( ok, msg ) => { console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ msg }` ); if ( ! ok ) process.exitCode = 1; };
const ready = () => p.waitForFunction( () => window.__app?.ready, { timeout: 300000, polling: 250 } );
await p.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await ready();
const before = await p.evaluate( () => {
	const a = window.__app;
	a.views.push( { label: 't', pos: [ - 30, 45, 40 ], target: [ 0, 28, 0 ] } ); a.setView( a.views.length - 1 );
	a.sky.state.elevation = 33; a.sky.state.azimuth = 200; a.onSunChanged();
	return { pos: a.camera.position.toArray(), elev: a.sky.state.elevation };
} );
const nav = p.waitForNavigation( { timeout: 60000 } );
await p.evaluate( () => window.__app.renderer.onDeviceLost( { api: 'WebGPU', message: 'teste', reason: 'unknown' } ) );
await nav;
await ready();
await new Promise( ( r ) => setTimeout( r, 1500 ) );
const after = await p.evaluate( () => { const a = window.__app; return { pos: a.camera.position.toArray(), elev: a.sky.state.elevation, azi: a.sky.state.azimuth, ui: document.getElementById( 'o-elev' )?.textContent }; } );
const dist = Math.hypot( ...after.pos.map( ( v, i ) => v - before.pos[ i ] ) );
check( dist < 0.5 && after.elev === 33 && after.azi === 200 && after.ui === '33.0°', `perda 1: recarregou e voltou à vista (distância ${ dist.toFixed( 2 ) } m, sol ${ after.elev }°/${ after.azi }°, painel ${ after.ui })` );
// second loss within the window: message, no reload
let reloaded = false;
p.once( 'framenavigated', () => { reloaded = true; } );
await p.evaluate( () => window.__app.renderer.onDeviceLost( { api: 'WebGPU', message: 'teste 2', reason: 'unknown' } ) );
await new Promise( ( r ) => setTimeout( r, 2500 ) );
const msg = await p.evaluate( () => !! document.getElementById( 'gpu-lost' ) );
check( msg && ! reloaded, `perda 2 logo depois: aviso na tela, sem recarregar (aviso ${ msg }, recarregou ${ reloaded })` );
await p.screenshot( { path: 'shots/gpulost_msg.png' } );
await b.close();
