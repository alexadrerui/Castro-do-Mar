// QA: nothing growing on the paths. Counts the plants, flowers and rocks standing on a path (the
// terrain mask's path channel, the one that paints the dirt track). Gravel is left out (loose stones
// on the track are intended), so is the ivy (anchored in the middle of the archways over the
// tracks: world/gate.js), and so is the grass: short, sparse grass on the track is intended
// (grass.js, the reference); its coarse density there is only reported.
//   node tools/pathclear.mjs [--on=0.5] [--shots=prefix]   -> exit code 1 if anything is on a path
import puppeteer from 'puppeteer-core';

const ON = Number( ( process.argv.find( ( a ) => a.startsWith( '--on=' ) ) || '--on=0.5' ).slice( 5 ) );
const shots = ( process.argv.find( ( a ) => a.startsWith( '--shots=' ) ) || '' ).slice( 8 );
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );

const out = await page.evaluate( async ( ON, shots ) => {
	const a = window.__app;
	const { sampleMask } = await import( '/src/world/vegetation.js' );
	const pathAt = ( x, z ) => sampleMask( a.mask, x, z )[ 0 ];
	const res = { layers: {}, worst: [] };
	for ( const key of [ 'vegetation', 'rocks', 'flora' ] ) {
		const root = a.layers[ key ]?.object;
		if ( ! root ) continue;
		root.traverse( ( o ) => {
			if ( ! o.tiles || /^gravel/.test( o.name ) || o.name === 'ivy' ) return;
			let n = 0, on = 0;
			for ( const t of o.tiles ) {
				const { matrices, count } = t.hi.userData.instances;
				for ( let i = 0; i < count; i ++ ) {
					const x = matrices[ i * 16 + 12 ], z = matrices[ i * 16 + 14 ];
					n ++;
					const p = pathAt( x, z );
					if ( p > ON ) { on ++; res.worst.push( [ o.name, + x.toFixed( 1 ), + z.toFixed( 1 ), + p.toFixed( 2 ) ] ); }
				}
			}
			res.layers[ key + '/' + o.name ] = { n, on };
		} );
	}
	// grass: the density mask (bilinear, as the shader reads it) at 0.5 m steps over the path cells
	const d = a.grass?.density ?? a.layers.grass?.object?.userData?.density;
	if ( d ) {
		const G = ( x, z ) => {
			const u = ( x - d.x0 ) / d.texel - 0.5, v = ( z - d.z0 ) / d.texel - 0.5;
			const i = Math.floor( u ), j = Math.floor( v ), fu = u - i, fv = v - j;
			const at = ( ii, jj ) => ( ii < 0 || jj < 0 || ii >= d.res || jj >= d.res ) ? 0 : d.data[ ( jj * d.res + ii ) * 4 + 1 ] / 255;
			return ( at( i, j ) * ( 1 - fu ) + at( i + 1, j ) * fu ) * ( 1 - fv ) + ( at( i, j + 1 ) * ( 1 - fu ) + at( i + 1, j + 1 ) * fu ) * fv;
		};
		let n = 0, grassy = 0, sum = 0;
		for ( let z = - 300; z < 340; z += 0.5 ) for ( let x = - 340; x < 300; x += 0.5 ) {
			if ( pathAt( x, z ) <= ON ) continue;
			n ++;
			const g = G( x, z );
			sum += g;
			if ( g > 0.1 ) grassy ++;
		}
		res.grass = { pathCells: n, withGrass: grassy, meanDensity: + ( sum / n ).toFixed( 3 ) };
	} else res.grass = 'no density';
	res.worst = res.worst.slice( 0, 40 );
	if ( shots ) {
		a.setFocus?.( false );
		const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
		// along the main road and the inner loop, at eye height
		const cams = [ [ 'road', [ 0, 0, 66 ], [ - 30, 0, 84 ] ], [ 'loop', [ - 60, 0, - 9 ], [ - 30, 0, - 8 ] ], [ 'east', [ 64, 0, 18 ], [ 60, 0, 40 ] ] ];
		for ( const [ name, p, t ] of cams ) {
			const pos = [ p[ 0 ], a.hf.heightAt( p[ 0 ], p[ 2 ] ) + 1.7, p[ 2 ] ], tgt = [ t[ 0 ], a.hf.heightAt( t[ 0 ], t[ 2 ] ) + 1.2, t[ 2 ] ];
			a.views.push( { label: 'qa', pos, target: tgt } ); a.setView( a.views.length - 1 ); a.views.pop();
			await sleep( 3000 ); // the grass cells stream in around the camera
			await a.capture( `${ shots }_${ name }` );
		}
	}
	return res;
}, ON, shots );
await browser.close();

let bad = 0;
for ( const [ k, v ] of Object.entries( out.layers ) ) { if ( v.on ) bad += v.on; console.log( `${ v.on ? 'FAIL' : 'ok  ' } ${ k.padEnd( 24 ) } ${ v.on } of ${ v.n } on a path` ); }
console.log( 'grass:', JSON.stringify( out.grass ) );
if ( out.worst.length ) console.log( 'on a path (name, x, z, path):\n' + out.worst.map( ( w ) => '  ' + w.join( ' ' ) ).join( '\n' ) );
process.exit( bad ? 1 : 0 );
