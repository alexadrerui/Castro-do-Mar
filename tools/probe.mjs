// node tools/probe.mjs "<js expression evaluated in the page after ready>"
import puppeteer from 'puppeteer-core';
const expr = process.argv[ 2 ];
const browser = await puppeteer.launch( { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: [ '--enable-unsafe-webgpu', '--ignore-gpu-blocklist' ] } );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) console.log( '[page]', m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 240000, polling: 1000 } );
console.log( JSON.stringify( await page.evaluate( expr ), null, 1 ) );
await browser.close();
