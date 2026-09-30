// Times every WebGPU render pipeline built during two loads (cold, then warm) and lists the
// slowest ones and any shader-compilation errors: node tools/pipeprobe.mjs [extra url params]
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900', ...( process.env.EXTRA ? process.env.EXTRA.split( ' ' ) : [] ) ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
await page.evaluateOnNewDocument( () => {
	const log = window.__pipes = [];
	const D = GPUDevice.prototype;
	const mod = D.createShaderModule;
	D.createShaderModule = function ( desc ) {
		const m = mod.call( this, desc );
		m.__code = desc.code;
		m.getCompilationInfo?.().then( ( info ) => { for ( const e of info.messages ) if ( e.type === 'error' ) log.push( { error: e.message, code: desc.code.slice( 0, 200 ) } ); } );
		return m;
	};
	const hash = ( s ) => { let h = 0; for ( let i = 0; i < s.length; i ++ ) h = ( h * 31 + s.charCodeAt( i ) ) | 0; return ( h >>> 0 ).toString( 16 ); };
	const wrap = ( name, async ) => {
		const f = D[ name ];
		D[ name ] = function ( desc ) {
			const t0 = performance.now();
			const rec = { fcode: desc.fragment?.module.__code, name, vs: hash( desc.vertex.module.__code || '' ), fs: desc.fragment ? hash( desc.fragment.module.__code || '' ) : '-', fsLen: desc.fragment?.module.__code?.length, start: t0 };
			log.push( rec );
			const r = f.call( this, desc );
			if ( async ) r.then( () => { rec.ms = performance.now() - t0; }, ( e ) => { rec.error = String( e ); } );
			else rec.ms = performance.now() - t0;
			return r;
		};
	};
	wrap( 'createRenderPipelineAsync', true );
	wrap( 'createRenderPipeline', false );
} );
for ( let i = 0; i < 2; i ++ ) {
	await page.goto( 'http://localhost:5190/?auto' + ( process.argv[ 2 ] ? '&' + process.argv[ 2 ] : '' ), { waitUntil: 'domcontentloaded' } );
	if ( i === 0 ) await page.evaluate( () => new Promise( ( r ) => { const q = indexedDB.deleteDatabase( 'castro-do-mar' ); q.onsuccess = q.onerror = q.onblocked = r; } ) ).then( () => page.reload( { waitUntil: 'domcontentloaded' } ) );
	await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 250 } );
	await new Promise( ( r ) => setTimeout( r, Number( process.env.SETTLE || 25000 ) ) );
	const res = await page.evaluate( () => {
		const L = window.__pipes;
		const errs = L.filter( ( r ) => r.error );
		const pend = L.filter( ( r ) => ! r.error && r.ms === undefined );
		const slow = L.filter( ( r ) => r.ms > 300 ).sort( ( a, b ) => b.ms - a.ms ).slice( 0, 12 ).map( ( r ) => `${ r.name } vs ${ r.vs } fs ${ r.fs } (${ r.fsLen }) ${ Math.round( r.ms ) } ms @${ Math.round( r.start ) }` );
		const sync = L.filter( ( r ) => r.name === 'createRenderPipeline' ).map( ( r ) => `${ r.fs } (${ r.fsLen }) ${ Math.round( r.ms ) } ms @${ Math.round( r.start ) }` );
		window.__slowest = L.filter( ( r ) => r.ms > 3000 ).map( ( r ) => r.fcode ).join( ' ===== ' );
		const distinct = new Set( L.map( ( r ) => r.vs + ':' + r.fs ) ).size; const bytes = [ ...new Map( L.map( ( r ) => [ r.vs + ':' + r.fs, ( r.fsLen || 0 ) ] ) ).values() ].reduce( ( a, b ) => a + b, 0 );
		return { distinct, bytes, total: L.length, errors: errs.slice( 0, 5 ), pending: pend.length, slow, sync };
	} );
	console.log( i ? 'warm' : 'cold', JSON.stringify( res, null, 1 ).slice( 0, 3000 ) );
	if ( process.env.DUMP ) ( await import( 'fs' ) ).writeFileSync( process.env.DUMP, await page.evaluate( () => window.__slowest ) );
}
await browser.close();
