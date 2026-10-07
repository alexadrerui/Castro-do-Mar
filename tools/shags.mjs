// The line of shags (world/birds/flock.js): the loop found along the coast (length, its lowest and
// highest points, the clearance over the water and the land along it), the line spacing, then
// (flock paused) the line from the side at water level, from ahead, and a wide view of it over the
// bay. Captures shots/<prefixo>_<side|ahead|wide>.png.
//   node tools/shags.mjs [prefixo]
import puppeteer from 'puppeteer-core';

const prefix = process.argv.slice( 2 ).find( ( x ) => ! x.startsWith( '--' ) ) || 'shags';
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
	const F = window.__app.flock, P = F.shagPath, g = window.__app.freecam.groundFn;
	if ( ! P ) return null;
	// clearance along the loop: over the water and over the land
	let minWater = 1e9, minLand = 1e9, maxY = 0;
	const v = P.pt;
	for ( let i = 0; i < 2000; i ++ ) {
		P.curve.getPointAt( i / 2000, v );
		const gr = g( v.x, v.z );
		if ( gr < 0 ) minWater = Math.min( minWater, v.y ); else minLand = Math.min( minLand, v.y - gr );
		maxY = Math.max( maxY, v.y );
	}
	const shags = F.agents.filter( ( a ) => a.kind === 'shag' );
	const gaps = shags.slice( 1 ).map( ( a, i ) => +Math.hypot( a.f.x - shags[ i ].f.x, a.f.z - shags[ i ].f.z ).toFixed( 1 ) );
	return { length: Math.round( P.length ), points: P.points.length, minWater: +minWater.toFixed( 2 ), minLand: minLand === 1e9 ? null : +minLand.toFixed( 1 ), maxY: +maxY.toFixed( 1 ), n: shags.length, gaps, at: [ shags[ 0 ].f.x, shags[ 0 ].f.y, shags[ 0 ].f.z ].map( ( x ) => +x.toFixed( 1 ) ) };
} );
console.log( JSON.stringify( info ) );
check( 'a loop along the coast', !! info && info.length > 800 );
check( 'five shags in a line, 2-6 m apart', info?.n === 5 && info.gaps.every( ( d ) => d > 2 && d < 6 ), JSON.stringify( info?.gaps ) );
check( 'low over the water (~1 m), never under it', info && info.minWater >= 0.9 && info.minWater < 1.6, info?.minWater );
check( 'clear of the land (>= 2.5 m)', info && ( info.minLand === null || info.minLand >= 2.5 ), info?.minLand );

// wait for the leader on the near (skimming) leg, close to the village side
await page.evaluate( () => new Promise( ( r ) => { const F = window.__app.flock; const w = () => { const a = F.agents.find( ( q ) => q.kind === 'shag' && q.slot === 2 ); return a.f.y < 1.6 ? r() : setTimeout( w, 200 ); }; w(); } ) );
await page.evaluate( () => { window.__app.flock.paused = true; } );
const shot = ( name, js ) => page.evaluate( async ( name, js ) => {
	const a = window.__app;
	a.setFocus( false ); // sharp: the depth of field focused on the water in front
	new Function( 'a', js )( a );
	await a.capture( '_shags_tmp', 1600, 900 );
	await a.capture( name, 1600, 900 );
	const m = a.flock.agents.find( ( q ) => q.kind === 'shag' && q.slot === 2 ).f, c = a.camera.position;
	return { cam: [ c.x, c.y, c.z ].map( ( v ) => +v.toFixed( 1 ) ), bird: [ m.x, m.y, m.z ].map( ( v ) => +v.toFixed( 1 ) ), d: +Math.hypot( c.x - m.x, c.y - m.y, c.z - m.z ).toFixed( 1 ) };
}, `${ prefix }_${ name }`, js ).then( ( r ) => console.log( '  ', name, JSON.stringify( r ) ) );
const mid = `const F = a.flock, m = F.agents.find( ( q ) => q.kind === 'shag' && q.slot === 2 ).f, V = a.camera.position.constructor; const fx = Math.sin( m.yaw ), fz = Math.cos( m.yaw );`;
// from the sea side (east): against the land the dark birds were lost in the dark cliffs;
// three quarters from behind and above (straight from the side a bird in flight is its body only)
await shot( 'side', mid + `const k = fz > 0 ? 5 : - 5; a.freecam.jumpTo( new V( m.x + fz * k - fx * 4, m.y + 2, m.z - fx * k - fz * 4 ), new V( m.x, m.y, m.z ) );` );
await shot( 'ahead', mid + `a.freecam.jumpTo( new V( m.x + fx * 22 + fz * 3, 1.6, m.z + fz * 22 - fx * 3 ), new V( m.x, m.y, m.z ) );` );
await shot( 'wide', mid + `a.freecam.jumpTo( new V( m.x + fz * 70 - fx * 30, 14, m.z - fx * 70 - fz * 30 ), new V( m.x, m.y, m.z ) );` );

check( 'no errors', errors.length === 0, errors.join( ' | ' ) );
await browser.close();
console.log( fail.length ? 'FAILED: ' + fail.join( '; ' ) : 'all ok' );
process.exit( fail.length ? 1 : 0 );
