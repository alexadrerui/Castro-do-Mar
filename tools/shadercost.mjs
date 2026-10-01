// Cold compile cost of every pipeline the app builds, one at a time.
//   1. loads the app and records each render / compute pipeline (shader code, bind group layouts,
//      descriptor) labelled with the three.js object and material that asked for it;
//   2. in a fresh browser (empty shader cache) rebuilds them one after the other and times each.
// node tools/shadercost.mjs [settle ms=20000] [extra url params]   -> shots/shadercost.json
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const settle = Number( process.argv[ 2 ] ) || 20000;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const launch = () => puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 1800000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );

// ---- 1. record
let browser = await launch();
let page = await browser.newPage();
await page.evaluateOnNewDocument( () => {
	const R = window.__rec = { modules: [], bgls: [], layouts: [], pipes: [] };
	const D = GPUDevice.prototype;
	const wrap = ( name, fn ) => { const f = D[ name ]; D[ name ] = function ( desc ) { const o = f.call( this, desc ); fn( o, desc ); return o; }; };
	wrap( 'createShaderModule', ( o, d ) => { o.__id = R.modules.push( d.code ) - 1; } );
	wrap( 'createBindGroupLayout', ( o, d ) => { o.__id = R.bgls.push( JSON.parse( JSON.stringify( d.entries ) ) ) - 1; } );
	wrap( 'createPipelineLayout', ( o, d ) => { o.__id = R.layouts.push( d.bindGroupLayouts.map( ( b ) => b.__id ) ) - 1; } );
	const stage = ( s ) => s && { ...s, module: s.module.__id };
	const rec = ( kind ) => ( o, d ) => R.pipes.push( {
		kind, label: window.__label || '?', t: performance.now(),
		desc: JSON.parse( JSON.stringify( { ...d, layout: d.layout === 'auto' ? 'auto' : d.layout.__id, vertex: stage( d.vertex ), fragment: stage( d.fragment ), compute: stage( d.compute ) } ) )
	} );
	for ( const n of [ 'createRenderPipeline', 'createRenderPipelineAsync' ] ) wrap( n, rec( 'render' ) );
	for ( const n of [ 'createComputePipeline', 'createComputePipelineAsync' ] ) wrap( n, rec( 'compute' ) );
} );
await page.goto( 'http://localhost:5190/?auto&nocache' + ( process.argv[ 3 ] ? '&' + process.argv[ 3 ] : '' ), { waitUntil: 'domcontentloaded' } );
// label the pipelines with the render object that asks for them
await page.waitForFunction( () => window.__app?.renderer?.backend?.createRenderPipeline, { timeout: 300000, polling: 50 } );
await page.evaluate( () => {
	const b = window.__app.renderer.backend;
	const name = ( ro ) => `${ ro.object.name || ( ro.object.parent?.name ? ro.object.parent.name + '>' : '' ) + ro.object.type } / ${ ro.material.name || ro.material.type }${ ro.material.isShadowPassMaterial ? ' (shadow)' : '' }`;
	const f = b.createRenderPipeline.bind( b );
	b.createRenderPipeline = ( ro, p ) => { window.__label = name( ro ); try { return f( ro, p ); } finally { window.__label = null; } };
	const g = b.createComputePipeline?.bind( b );
	if ( g ) b.createComputePipeline = ( cp, bs ) => { window.__label = 'compute ' + ( cp.name || cp.computeProgram?.name || '' ); try { return g( cp, bs ); } finally { window.__label = null; } };
} );
await page.waitForFunction( () => window.__app.ready, { timeout: 300000, polling: 250 } );
await new Promise( ( r ) => setTimeout( r, settle ) );
const rec = await page.evaluate( () => window.__rec );
await browser.close();
console.log( `recorded ${ rec.pipes.length } pipelines, ${ rec.modules.length } shader modules` );

// dedupe identical descriptors
const seen = new Map();
for ( const p of rec.pipes ) {
	const key = p.kind + JSON.stringify( p.desc ) + ( p.desc.layout === 'auto' ? '' : JSON.stringify( rec.layouts[ p.desc.layout ].map( ( b ) => rec.bgls[ b ] ) ) );
	if ( ! seen.has( key ) ) seen.set( key, p );
}
const pipes = [ ...seen.values() ];

// ---- 2. replay in a fresh browser (empty cache), one pipeline at a time
browser = await launch();
page = await browser.newPage();
await page.goto( 'http://localhost:5190/package.json', { waitUntil: 'domcontentloaded' } );
const times = await page.evaluate( async ( rec, pipes ) => {
	const adapter = await navigator.gpu.requestAdapter( { featureLevel: 'compatibility' } ) || await navigator.gpu.requestAdapter();
	const features = [ ...adapter.features ].filter( ( f ) => [ 'float32-filterable', 'depth32float-stencil8', 'timestamp-query', 'rg11b10ufloat-renderable', 'float32-blendable', 'texture-compression-bc', 'clip-distances', 'dual-source-blending', 'subgroups', 'core-features-and-limits' ].includes( f ) );
	const limits = {};
	for ( const k of [ 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxColorAttachmentBytesPerSample', 'maxStorageBuffersPerShaderStage', 'maxUniformBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxSampledTexturesPerShaderStage', 'maxInterStageShaderVariables', 'maxVertexBuffers', 'maxVertexAttributes' ] ) limits[ k ] = adapter.limits[ k ];
	const device = await adapter.requestDevice( { requiredFeatures: features, requiredLimits: limits } );
	const errors = [];
	device.addEventListener( 'uncapturederror', ( e ) => errors.push( e.error.message.slice( 0, 200 ) ) );
	const modules = [], bgls = [], layouts = [];
	const mod = ( i ) => modules[ i ] ??= device.createShaderModule( { code: rec.modules[ i ] } );
	const bgl = ( i ) => bgls[ i ] ??= device.createBindGroupLayout( { entries: rec.bgls[ i ] } );
	const layout = ( i ) => i === 'auto' ? 'auto' : ( layouts[ i ] ??= device.createPipelineLayout( { bindGroupLayouts: rec.layouts[ i ].map( bgl ) } ) );
	const out = [];
	for ( const p of pipes ) {
		const d = { ...p.desc, layout: layout( p.desc.layout ) };
		for ( const s of [ 'vertex', 'fragment', 'compute' ] ) if ( d[ s ] ) d[ s ] = { ...d[ s ], module: mod( d[ s ].module ) };
		const t0 = performance.now();
		let err = null;
		try {
			if ( p.kind === 'render' ) await device.createRenderPipelineAsync( d ); else await device.createComputePipelineAsync( d );
		} catch ( e ) { err = String( e.message || e ).slice( 0, 160 ); }
		out.push( {
			label: p.label, kind: p.kind, ms: performance.now() - t0, err,
			vs: p.desc.vertex?.module ?? p.desc.compute?.module, fs: p.desc.fragment?.module,
			fsLen: p.desc.fragment ? rec.modules[ p.desc.fragment.module ].length : 0,
			vsLen: rec.modules[ p.desc.vertex?.module ?? p.desc.compute?.module ].length,
			pass: p.kind === 'compute' ? 'compute' : ! p.desc.fragment?.targets?.length ? 'shadow/depth' : p.desc.fragment.targets.length > 1 ? 'scene (MRT)' : ( p.desc.multisample?.count || 1 ) > 1 ? 'msaa x1 target' : 'single target',
		} );
	}
	return { out, errors: errors.slice( 0, 5 ) };
}, rec, pipes );
await browser.close();

const rows = times.out.sort( ( a, b ) => b.ms - a.ms );
const total = rows.reduce( ( a, r ) => a + r.ms, 0 );
fs.writeFileSync( 'shots/shadercost.json', JSON.stringify( { total, rows }, null, 1 ) );
console.log( `${ rows.length } distinct pipelines, ${ ( total / 1000 ).toFixed( 1 ) } s of compile one at a time` );
if ( times.errors.length ) console.log( 'errors:', times.errors );
const failed = rows.filter( ( r ) => r.err );
if ( failed.length ) console.log( 'failed:', failed.length, failed[ 0 ].err );
// by label (material)
const by = new Map();
for ( const r of rows ) { const k = r.label.replace( /#\d+/g, '' ); const e = by.get( k ) || { ms: 0, n: 0 }; e.ms += r.ms; e.n ++; by.set( k, e ); }
console.log( '\nby object / material (top 25):' );
for ( const [ k, e ] of [ ...by ].sort( ( a, b ) => b[ 1 ].ms - a[ 1 ].ms ).slice( 0, 25 ) ) console.log( `${ String( Math.round( e.ms ) ).padStart( 6 ) } ms  ${ String( e.n ).padStart( 3 ) }×  ${ k }` );
console.log( '\nslowest pipelines:' );
for ( const r of rows.slice( 0, 15 ) ) console.log( `${ String( Math.round( r.ms ) ).padStart( 6 ) } ms  ${ r.label }  [${ r.pass }]  (vs ${ r.vsLen }, fs ${ r.fsLen } chars)` );
