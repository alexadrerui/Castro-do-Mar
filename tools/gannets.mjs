// The gannets (world/birds/flock.js) and the splashes (world/birds/splash.js): lists the gannets'
// fishing grounds and states, then frames one circling, waits for a plunge and freezes the flock just
// after it hits the water (the splash), then the bird floating and a tern's smaller splash.
// Captures shots/<prefixo>_<fly|dive|splash|float|tern>.png.
//   node tools/gannets.mjs [prefixo]
import puppeteer from 'puppeteer-core';

const prefix = process.argv.slice( 2 ).find( ( x ) => ! x.startsWith( '--' ) ) || 'gannets';
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( String( e ).slice( 0, 300 ) ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /404|Failed to load resource/.test( m.text() ) ) errors.push( m.text().slice( 0, 300 ) ); } );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app?.ready && window.__app.flock, { timeout: 300000, polling: 500 } );
const fail = [];
const check = ( what, ok, extra = '' ) => { if ( ! ok ) fail.push( what ); console.log( ok ? '  ok  ' : '  FAIL', what, extra ); };

const info = await page.evaluate( () => {
	const F = window.__app.flock;
	const g = F.agents.filter( ( a ) => a.kind === 'gannet' );
	return { seas: F.seas.map( ( s ) => [ Math.round( s.x ), Math.round( s.z ) ] ), gannets: g.map( ( a ) => [ a.state, Math.round( a.f.y ) ] ) };
} );
console.log( 'fishing grounds', JSON.stringify( info.seas ), 'gannets', JSON.stringify( info.gannets ) );
check( 'gannets over deep water', info.gannets.length > 0 && info.seas.length > 0 );

// watch the first gannet: the camera beside it, following, until it dives
const shot = ( name, js ) => page.evaluate( async ( name, js ) => {
	const a = window.__app;
	new Function( 'a', js )( a );
	// (twice: a capture right after a change returns the frame before it, see tools/lightning.mjs)
	await a.capture( '_gannets_tmp', 1600, 900 );
	await a.capture( name, 1600, 900 );
}, `${ prefix }_${ name }`, js );
// the camera at a side of the bird (d m away, h m up), looking at it
const frame = ( id, d, h ) => `const b = a.flock.agents.filter( ( q ) => q.kind === 'gannet' )[ ${ id } ], f = b.f, V = a.camera.position.constructor;
	const s = Math.sin( f.yaw + 1.6 ), c = Math.cos( f.yaw + 1.6 );
	const g = Math.max( a.freecam.groundFn( f.x + s * ${ d }, f.z + c * ${ d } ), 0 );
	a.freecam.jumpTo( new V( f.x + s * ${ d }, Math.max( f.y + ${ h }, g + 2 ), f.z + c * ${ d } ), new V( f.x, f.y, f.z ) );`;

await page.evaluate( () => { window.__app.flock.paused = true; } );
await shot( 'fly', frame( 0, 7, 1 ) );
await page.evaluate( () => { window.__app.flock.paused = false; } );

// wait for a dive (any gannet), then follow that one
const diver = await page.evaluate( async () => {
	const F = window.__app.flock, t0 = performance.now();
	while ( performance.now() - t0 < 120000 ) {
		const i = F.agents.filter( ( q ) => q.kind === 'gannet' ).findIndex( ( q ) => q.state === 'dive' );
		if ( i >= 0 ) return i;
		await new Promise( ( r ) => setTimeout( r, 100 ) );
	}
	return - 1;
} );
check( 'a gannet dives within 2 min', diver >= 0 );
if ( diver >= 0 ) {
	// the dive half way down
	await page.evaluate( ( i ) => new Promise( ( r ) => { const b = window.__app.flock.agents.filter( ( q ) => q.kind === 'gannet' )[ i ]; const w = () => ( b.f.y < 9 || b.state !== 'dive' ? r() : setTimeout( w, 16 ) ); w(); } ), diver );
	await page.evaluate( () => { window.__app.flock.paused = true; } );
	const dv = await page.evaluate( ( i ) => { const b = window.__app.flock.agents.filter( ( q ) => q.kind === 'gannet' )[ i ]; return [ b.state, +b.f.y.toFixed( 1 ), +b.f.speed.toFixed( 1 ) ]; }, diver );
	console.log( '  diving:', JSON.stringify( dv ) );
	await shot( 'dive', frame( diver, 14, - 2 ) );
	// on to the impact, then freeze 0.25 s after it (the splash)
	await page.evaluate( () => { window.__app.flock.paused = false; } );
	await page.evaluate( ( i ) => new Promise( ( r ) => { const b = window.__app.flock.agents.filter( ( q ) => q.kind === 'gannet' )[ i ]; const w = () => ( b.state !== 'dive' ? setTimeout( r, 250 ) : setTimeout( w, 8 ) ); w(); } ), diver );
	await page.evaluate( () => { window.__app.flock.paused = true; } );
	const sp = await page.evaluate( () => { const S = window.__app.splashes; return { count: S.count, last: S.ev.array[ ( S.next + 11 ) % 12 ].toArray().map( ( v ) => +v.toFixed( 2 ) ), time: +S.time.toFixed( 2 ) }; } );
	console.log( '  splash:', JSON.stringify( sp ) );
	check( 'the plunge made a splash', sp.count > 0 );
	await shot( 'splash', `const S = a.splashes, e = S.ev.array[ ( S.next + 11 ) % 12 ], V = a.camera.position.constructor;
		a.freecam.jumpTo( new V( e.x + 9, e.y + 2.2, e.z + 5 ), new V( e.x, e.y + 0.8, e.z ) );` );
	// floating a moment later (the camera 25 m off, or it takes off at once)
	await page.evaluate( () => { const a = window.__app, S = a.splashes, e = S.ev.array[ ( S.next + 11 ) % 12 ], V = a.camera.position.constructor; a.freecam.jumpTo( new V( e.x + 25, e.y + 4, e.z ), new V( e.x, e.y, e.z ) ); a.flock.paused = false; } );
	const fl = await page.evaluate( ( i ) => new Promise( ( r ) => { const b = window.__app.flock.agents.filter( ( q ) => q.kind === 'gannet' )[ i ], t0 = performance.now(); const w = () => ( b.state === 'float' && b.t > 0.8 ? r( true ) : performance.now() - t0 > 15000 ? r( false ) : setTimeout( w, 50 ) ); w(); } ), diver );
	check( 'it comes up and floats', fl );
	await page.evaluate( () => { window.__app.flock.paused = true; } );
	await shot( 'float', frame( diver, 4, 0.8 ) );
	await page.evaluate( () => { window.__app.flock.paused = false; } );
}

// a tern's splash, for scale
const tern = await page.evaluate( async () => {
	const F = window.__app.flock, t0 = performance.now();
	const terns = F.agents.filter( ( q ) => q.kind === 'tern' );
	while ( performance.now() - t0 < 90000 ) {
		const b = terns.find( ( q ) => q.state === 'under' );
		if ( b ) { F.paused = true; return [ b.f.x, b.f.z ]; }
		await new Promise( ( r ) => setTimeout( r, 30 ) );
	}
	return null;
} );
check( 'a tern dives and splashes', !! tern );
if ( tern ) await shot( 'tern', `const V = a.camera.position.constructor; a.freecam.jumpTo( new V( ${ tern[ 0 ] } + 6, 1.8, ${ tern[ 1 ] } + 3 ), new V( ${ tern[ 0 ] }, 0.4, ${ tern[ 1 ] } ) );` );

check( 'no errors', errors.length === 0, errors.join( ' | ' ) );
await browser.close();
console.log( fail.length ? 'FAILED: ' + fail.join( '; ' ) : 'all ok' );
process.exit( fail.length ? 1 : 0 );
