// Stones floating over the distant terrain: for every rock instance, the gap between the ground it
// was placed on (the full-res heightfield) and the ground drawn by each terrain LOD (strides 1..16,
// the same triangulation as terrain.js buildChunks). "float" = the rock's base (y - 0.35 sy, see
// rocks.js graniteGeometry) is above the drawn ground there.
// --layer=vegetation: the plants instead (base = the anchor, at the ground).
//   node tools/rockfloat.mjs [--layer=rocks|vegetation] [--params=...]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const layer = ( args.find( ( x ) => x.startsWith( '--layer=' ) ) || '--layer=rocks' ).slice( 8 );
const extra = ( args.find( ( x ) => x.startsWith( '--params=' ) ) || '--params=' ).slice( 9 );
const browser = await puppeteer.launch( {
	executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5190/?auto' + ( extra ? '&' + extra : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
const out = await page.evaluate( ( layer ) => {
	const a = window.__app, hf = a.hf, n = hf.n, d = hf.data;
	const H = ( i, j ) => d[ Math.min( n - 1, j ) * n + Math.min( n - 1, i ) ];
	const coarse = ( x, z, st ) => {
		const fx = ( x - hf.x0 ) / ( hf.cell * st ), fz = ( z - hf.z0 ) / ( hf.cell * st );
		const i = Math.floor( fx ), j = Math.floor( fz ), u = fx - i, v = fz - j;
		const A = H( i * st, j * st ), B = H( i * st, ( j + 1 ) * st ), C = H( ( i + 1 ) * st, j * st ), D = H( ( i + 1 ) * st, ( j + 1 ) * st );
		return u + v <= 1 ? A + u * ( C - A ) + v * ( B - A ) : D + ( 1 - u ) * ( B - D ) + ( 1 - v ) * ( C - D );
	};
	const rows = [];
	const seen = new Set();
	const sink = layer === 'rocks' ? 0.35 : 0;
	a.layers[ layer ].object.traverse( ( o ) => {
		const ins = o.userData?.instances;
		if ( ! ins || seen.has( ins.matrices ) || o.name?.startsWith?.( 'gravel' ) ) return;
		if ( o.parent?.name?.startsWith( 'gravel' ) ) return;
		seen.add( ins.matrices );
		const m = ins.matrices;
		for ( let k = 0; k < ins.count; k ++ ) {
			const o16 = k * 16, x = m[ o16 + 12 ], y = m[ o16 + 13 ], z = m[ o16 + 14 ];
			const sy = Math.hypot( m[ o16 + 4 ], m[ o16 + 5 ], m[ o16 + 6 ] );
			rows.push( { x, y, z, sy, base: y - sink * sy } );
		}
	} );
	const res = {};
	for ( const st of [ 1, 2, 4, 8, 16 ] ) {
		const gaps = rows.map( ( r ) => r.base - coarse( r.x, r.z, st ) );
		const sorted = gaps.slice().sort( ( p, q ) => p - q );
		const q = ( f ) => +sorted[ Math.floor( f * ( sorted.length - 1 ) ) ].toFixed( 2 );
		res[ 'stride' + st ] = { floating: +( gaps.filter( ( g ) => g > 0.05 ).length / gaps.length ).toFixed( 3 ), over1m: +( gaps.filter( ( g ) => g > 1 ).length / gaps.length ).toFixed( 3 ), p50: q( 0.5 ), p90: q( 0.9 ), p99: q( 0.99 ), max: q( 1 ) };
	}
	// examples: big rocks hanging well clear of the stride-8 ground (900-1700 m away)
	const worst = rows.map( ( r ) => ( { ...r, gap: r.base - coarse( r.x, r.z, 8 ) } ) ).filter( ( r ) => r.sy > 2.5 && r.gap > 3 )
		.sort( ( p, q ) => q.gap - p.gap ).slice( 0, 6 ).map( ( r ) => [ r.x, r.y, r.z, r.sy, r.gap ].map( ( v ) => +v.toFixed( 1 ) ) );
	return { layer, instances: rows.length, ...res, worst8: worst };
}, layer );
console.log( JSON.stringify( out, null, 1 ) );
await browser.close();
