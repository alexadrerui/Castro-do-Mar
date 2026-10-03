// Why are there so many render pipelines? Records every render pipeline built during one load
// (+ `settle` ms of frames) with its full descriptor (shaders hashed), then reports:
//   - identical descriptors built more than once (three.js cache misses),
//   - for a shader pair built with several descriptors, which fields differ,
//   - call stacks of the pipelines built after the first frame, and their vertex inputs.
// node tools/pipedup.mjs [settle ms=15000] [extra url params]
import puppeteer from 'puppeteer-core';

const settle = Number( process.argv[ 2 ] ) || 15000;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'console', ( m ) => { if ( /^(first frame|bakes:|precompile)/.test( m.text() ) || m.type() === 'error' ) console.log( '[page]', m.text() ); } );
await page.evaluateOnNewDocument( () => {
	const log = window.__pipes = [];
	const hash = ( s ) => { let h = 0; for ( let i = 0; i < s.length; i ++ ) h = ( h * 31 + s.charCodeAt( i ) ) | 0; return ( h >>> 0 ).toString( 16 ); };
	const D = GPUDevice.prototype;
	const mod = D.createShaderModule;
	window.__code = {};
	D.createShaderModule = function ( desc ) { const m = mod.call( this, desc ); m.__h = hash( desc.code ); window.__code[ m.__h ] = desc.code; return m; };
	const layouts = new WeakMap(); let nLayout = 0;
	const lay = D.createPipelineLayout;
	D.createPipelineLayout = function ( desc ) { const l = lay.call( this, desc ); layouts.set( l, 'L' + ( nLayout ++ ) ); return l; };
	const describe = ( d ) => ( {
		vs: d.vertex.module.__h, fs: d.fragment ? d.fragment.module.__h : '-',
		buffers: JSON.stringify( d.vertex.buffers ),
		primitive: JSON.stringify( d.primitive ),
		depth: JSON.stringify( d.depthStencil ),
		ms: JSON.stringify( d.multisample ),
		targets: JSON.stringify( d.fragment?.targets ),
		layout: d.layout === 'auto' ? 'auto' : ( layouts.get( d.layout ) || '?' ),
	} );
	for ( const name of [ 'createRenderPipeline', 'createRenderPipelineAsync' ] ) {
		const f = D[ name ];
		D[ name ] = function ( desc ) {
			const rec = describe( desc );
			rec.t = performance.now();
			rec.after = !! window.__firstFrameDone;
			if ( rec.after ) rec.stack = new Error().stack.split( '\n' ).slice( 2, 14 ).map( ( s ) => s.trim().replace( /https?:\/\/localhost:\d+/, '' ) ).join( ' | ' );
			log.push( rec );
			return f.call( this, desc );
		};
	}
} );
await page.goto( 'http://localhost:5190/?auto' + ( process.argv[ 3 ] ? '&' + process.argv[ 3 ] : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 250 } );
await page.evaluate( () => { window.__firstFrameDone = true; } );
await new Promise( ( r ) => setTimeout( r, settle ) );
const res = await page.evaluate( () => {
	const L = window.__pipes;
	const FIELDS = [ 'buffers', 'primitive', 'depth', 'ms', 'targets', 'layout' ];
	const full = ( r ) => [ r.vs, r.fs, ...FIELDS.map( ( k ) => r[ k ] ) ].join( '#' );
	const byFull = new Map();
	for ( const r of L ) byFull.set( full( r ), ( byFull.get( full( r ) ) || 0 ) + 1 );
	const dupes = [ ...byFull.values() ].filter( ( n ) => n > 1 );
	// per shader pair: how many descriptors, and which fields vary
	const byPair = new Map();
	for ( const r of L ) { const k = r.vs + ':' + r.fs; if ( ! byPair.has( k ) ) byPair.set( k, [] ); byPair.get( k ).push( r ); }
	const vary = {};
	const pairs = [];
	for ( const [ k, rs ] of byPair ) {
		const v = FIELDS.filter( ( f ) => new Set( rs.map( ( r ) => r[ f ] ) ).size > 1 );
		for ( const f of v ) vary[ f ] = ( vary[ f ] || 0 ) + 1;
		pairs.push( { k, n: rs.length, distinct: new Set( rs.map( full ) ).size, vary: v.map( ( f ) => f + ':' + new Set( rs.map( ( r ) => r[ f ] ) ).size ).join( ' ' ) } );
	}
	pairs.sort( ( a, b ) => b.n - a.n );
	const after = L.filter( ( r ) => r.after );
	const stacks = new Map();
	for ( const r of after ) stacks.set( r.stack, ( stacks.get( r.stack ) || 0 ) + 1 );
	return {
		total: L.length, distinctDescriptors: byFull.size, shaderPairs: byPair.size,
		identicalRebuilt: { descriptors: dupes.length, extraBuilds: dupes.reduce( ( a, n ) => a + n - 1, 0 ) },
		fieldsVaryingInPairs: vary,
		topPairs: pairs.slice( 0, 12 ),
		afterReady: after.length,
		topStacks: [ ...stacks ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 4 ).map( ( [ s, n ] ) => n + ' × ' + s ),
		// the late ones by their vertex inputs (the stacks are three.js internals only)
		afterInputs: after.map( ( r ) => ( window.__code[ r.vs ] || '' ).match( /@location\( ?\d+ ?\) +(\w+)/g )?.map( ( m ) => m.split( /\s+/ ).pop() ).join( ',' ) + ' | ms ' + r.ms + ' | ' + ( r.targets || '' ).slice( 0, 60 ) ),
		layouts: new Set( L.map( ( r ) => r.layout ) ).size,
	};
} );
console.log( JSON.stringify( res, null, 1 ) );
if ( process.env.DUMP ) { const [ vs, fs ] = res.topPairs[ 0 ].k.split( ':' ); ( await import( 'fs' ) ).writeFileSync( process.env.DUMP, await page.evaluate( ( a, b ) => window.__code[ a ] + '\n// ===== fragment\n' + window.__code[ b ], vs, fs ) ); }
await browser.close();
