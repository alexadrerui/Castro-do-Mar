// How big are the compiled shaders? Records every shader module and render pipeline created during
// one load (+ settle ms) and reports the WGSL size per pipeline (vertex + fragment), the total of the
// distinct modules and the biggest ones, labelled by their vertex inputs. The browser's shader cache
// fills with compiled code, so its size (not the number of pipelines alone) is what counts.
//   node tools/shadersize.mjs [settle ms=8000] [extra url params]
import puppeteer from 'puppeteer-core';

const settle = Number( process.argv[ 2 ] ) || 8000;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
await page.evaluateOnNewDocument( () => {
	const D = GPUDevice.prototype, mod = D.createShaderModule;
	let n = 0;
	window.__mods = new Map(); window.__pipes = [];
	D.createShaderModule = function ( desc ) { const m = mod.call( this, desc ); m.__id = n ++; window.__mods.set( m.__id, desc.code ); return m; };
	for ( const name of [ 'createRenderPipeline', 'createRenderPipelineAsync' ] ) {
		const f = D[ name ];
		D[ name ] = function ( desc ) { window.__pipes.push( { vs: desc.vertex.module.__id, fs: desc.fragment?.module.__id } ); return f.call( this, desc ); };
	}
} );
await page.goto( 'http://localhost:5190/?auto' + ( process.argv[ 3 ] ? '&' + process.argv[ 3 ] : '' ), { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );
await new Promise( ( r ) => setTimeout( r, settle ) );
const res = await page.evaluate( () => {
	const code = ( id ) => window.__mods.get( id ) || '';
	const inputs = ( id ) => ( code( id ).match( /@location\( ?\d+ ?\) +(\w+)/g ) || [] ).map( ( m ) => m.split( /\s+/ ).pop() ).filter( ( s ) => ! /^(v_|nodeVarying)/.test( s ) ).join( ',' );
	let distinct = 0; const seen = new Set();
	for ( const [ id, c ] of window.__mods ) if ( ! seen.has( c ) ) { seen.add( c ); distinct += c.length; }
	const rows = window.__pipes.map( ( p ) => ( { kb: ( code( p.vs ).length + code( p.fs ).length ) / 1024, vs: inputs( p.vs ) || '(screen)', fsKb: code( p.fs ).length / 1024 } ) );
	rows.sort( ( a, b ) => b.kb - a.kb );
	return { pipelines: rows.length, modules: window.__mods.size, distinctModuleKb: distinct / 1024, sumPipelineKb: rows.reduce( ( s, r ) => s + r.kb, 0 ), top: rows.slice( 0, 15 ) };
} );
await browser.close();
console.log( `pipelines ${ res.pipelines }, shader modules ${ res.modules }, distinct WGSL ${ res.distinctModuleKb.toFixed( 0 ) } KB, sum over pipelines ${ res.sumPipelineKb.toFixed( 0 ) } KB` );
for ( const r of res.top ) console.log( `  ${ r.kb.toFixed( 1 ).padStart( 6 ) } KB (fs ${ r.fsKb.toFixed( 1 ) })  ${ r.vs.slice( 0, 90 ) }` );
