import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { TERRAIN } from './src/world/layout.js';
import { NATURE_BYTES } from './src/world/natureEdits.js';

// Dev-only endpoint: the page POSTs canvas captures here so the QA agents can
// read them from disk (shots/<name>.png).
function captureEndpoint() {
	return {
		name: 'capture-endpoint',
		configureServer( server ) {
			server.middlewares.use( '/__capture', ( req, res ) => {
				if ( req.method !== 'POST' ) { res.statusCode = 405; return res.end(); }
				const url = new URL( req.url, 'http://x' );
				const name = ( url.searchParams.get( 'name' ) || 'shot' ).replace( /[^\w.-]/g, '_' );
				const chunks = [];
				req.on( 'data', ( c ) => chunks.push( c ) );
				req.on( 'end', () => {
					const dir = path.resolve( 'shots' );
					fs.mkdirSync( dir, { recursive: true } );
					fs.writeFileSync( path.join( dir, name + '.png' ), Buffer.concat( chunks ) );
					res.end( 'ok' );
				} );
			} );
		}
	};
}

// Dev-only endpoint: the terrain editor (?edit, src/editor/terrainEditor.js) POSTs its edit
// layer here; it is written to public/terrain-edits.bin (raw float32, one value per heightfield
// vertex) and becomes part of the project.
function terrainEditsEndpoint() {
	// exactly one float32 per heightfield vertex (src/world/layout.js TERRAIN)
	const SIZE = ( TERRAIN.segments + 1 ) ** 2 * 4;
	return {
		name: 'terrain-edits-endpoint',
		configureServer( server ) {
			const file = path.join( server.config.publicDir, 'terrain-edits.bin' );
			server.middlewares.use( '/__terrain-edits', ( req, res ) => {
				const fail = ( code, msg ) => { res.statusCode = code; res.end( msg ); };
				// GET: read straight from disk (the file watcher ignores it, so Vite's own list of
				// public files may not know a file written after the server started)
				if ( req.method === 'GET' ) {
					if ( ! fs.existsSync( file ) ) return fail( 204 ); // no edits (204: not an error in the console)
					res.setHeader( 'Content-Type', 'application/octet-stream' );
					res.setHeader( 'Cache-Control', 'no-store' );
					return res.end( fs.readFileSync( file ) );
				}
				if ( req.method !== 'POST' ) return fail( 405 );
				// only the editor's own request: binary body, same origin (a page elsewhere cannot
				// send a non-simple request without a CORS preflight, which this does not answer)
				if ( ! /application\/octet-stream/.test( req.headers[ 'content-type' ] || '' ) ) return fail( 415, 'octet-stream only' );
				const origin = req.headers.origin;
				if ( origin && new URL( origin ).host !== req.headers.host ) return fail( 403, 'other origin' );
				const chunks = [];
				let len = 0;
				req.on( 'data', ( c ) => { len += c.length; if ( len <= SIZE ) chunks.push( c ); } );
				req.on( 'error', () => fail( 400, 'read error' ) );
				req.on( 'end', () => {
					if ( len !== SIZE ) return fail( 400, `expected ${ SIZE } bytes, got ${ len }` );
					const buf = Buffer.concat( chunks );
					const f32 = new Float32Array( buf.buffer, buf.byteOffset, buf.length / 4 );
					for ( let k = 0; k < f32.length; k ++ ) if ( ! Number.isFinite( f32[ k ] ) ) return fail( 400, 'non-finite value' );
					// atomic: a crash mid-write never leaves a half file
					fs.mkdirSync( path.dirname( file ), { recursive: true } );
					fs.writeFileSync( file + '.tmp', buf );
					fs.renameSync( file + '.tmp', file );
					res.end( 'ok' );
				} );
			} );
		}
	};
}

// Dev-only endpoint: the object editor (?edit, src/editor/objectEditor.js) saves the village object
// edits here: public/world-edits.json (see src/world/worldEdits.js). GET answers 204 without a file.
function worldEditsEndpoint() {
	return {
		name: 'world-edits-endpoint',
		configureServer( server ) {
			const file = path.join( server.config.publicDir, 'world-edits.json' );
			server.middlewares.use( '/__world-edits', ( req, res ) => {
				const fail = ( code, msg ) => { res.statusCode = code; res.end( msg ); };
				if ( req.method === 'GET' ) {
					if ( ! fs.existsSync( file ) ) return fail( 204 );
					res.setHeader( 'Content-Type', 'application/json' );
					res.setHeader( 'Cache-Control', 'no-store' );
					return res.end( fs.readFileSync( file ) );
				}
				if ( req.method !== 'POST' ) return fail( 405 );
				if ( ! /application\/json/.test( req.headers[ 'content-type' ] || '' ) ) return fail( 415, 'json only' );
				const origin = req.headers.origin;
				if ( origin && new URL( origin ).host !== req.headers.host ) return fail( 403, 'other origin' );
				const chunks = [];
				let len = 0;
				req.on( 'data', ( c ) => { len += c.length; if ( len <= 2e6 ) chunks.push( c ); } );
				req.on( 'error', () => fail( 400, 'read error' ) );
				req.on( 'end', () => {
					if ( len > 2e6 ) return fail( 413, 'too big' );
					let data;
					try { data = JSON.parse( Buffer.concat( chunks ).toString( 'utf8' ) ); } catch ( e ) { return fail( 400, 'bad json' ); }
					if ( ! data || typeof data !== 'object' || typeof data.objects !== 'object' || ! Array.isArray( data.added ) ) return fail( 400, 'bad shape' );
					fs.mkdirSync( path.dirname( file ), { recursive: true } );
					fs.writeFileSync( file + '.tmp', JSON.stringify( data, null, '\t' ) + '\n' );
					fs.renameSync( file + '.tmp', file );
					res.end( 'ok' );
				} );
			} );
		}
	};
}

// Dev-only endpoint: the nature brush (?edit, src/editor/natureEditor.js) saves its painted grid
// here: public/nature-edits.bin (src/world/natureEdits.js: signed bytes, NATURE_BYTES exactly).
function natureEditsEndpoint() {
	return {
		name: 'nature-edits-endpoint',
		configureServer( server ) {
			const file = path.join( server.config.publicDir, 'nature-edits.bin' );
			server.middlewares.use( '/__nature-edits', ( req, res ) => {
				const fail = ( code, msg ) => { res.statusCode = code; res.end( msg ); };
				if ( req.method === 'GET' ) {
					if ( ! fs.existsSync( file ) ) return fail( 204 );
					res.setHeader( 'Content-Type', 'application/octet-stream' );
					res.setHeader( 'Cache-Control', 'no-store' );
					return res.end( fs.readFileSync( file ) );
				}
				if ( req.method !== 'POST' ) return fail( 405 );
				if ( ! /application\/octet-stream/.test( req.headers[ 'content-type' ] || '' ) ) return fail( 415, 'octet-stream only' );
				const origin = req.headers.origin;
				if ( origin && new URL( origin ).host !== req.headers.host ) return fail( 403, 'other origin' );
				const chunks = [];
				let len = 0;
				req.on( 'data', ( c ) => { len += c.length; if ( len <= NATURE_BYTES ) chunks.push( c ); } );
				req.on( 'error', () => fail( 400, 'read error' ) );
				req.on( 'end', () => {
					if ( len !== NATURE_BYTES ) return fail( 400, `expected ${ NATURE_BYTES } bytes, got ${ len }` );
					fs.mkdirSync( path.dirname( file ), { recursive: true } );
					fs.writeFileSync( file + '.tmp', Buffer.concat( chunks ) );
					fs.renameSync( file + '.tmp', file );
					res.end( 'ok' );
				} );
			} );
		}
	};
}

// Which edit files public/ holds, for a build (src/world/editFiles.js): the published page asks only
// for those. In development the endpoints above answer instead (null).
const EDIT_FILES = [ 'terrain-edits.bin', 'world-edits.json', 'nature-edits.bin' ];
function editFilesDefine() {
	return {
		name: 'edit-files-define',
		config( _, { command } ) {
			const list = command === 'build' ? EDIT_FILES.filter( ( f ) => fs.existsSync( path.resolve( 'public', f ) ) ) : null;
			return { define: { __EDIT_FILES__: JSON.stringify( list ) } };
		}
	};
}

export default defineConfig( {
	plugins: [ editFilesDefine(), captureEndpoint(), terrainEditsEndpoint(), worldEditsEndpoint(), natureEditsEndpoint() ],
	// single three.js instance: addons and three-bvh-csg import "three"
	resolve: { alias: [ { find: /^three$/, replacement: 'three/webgpu' } ] },
	// the editor reloads by itself after saving the edits: no reload from the file watcher
	server: { port: 5190, strictPort: true, watch: { ignored: [ '**/public/terrain-edits.bin', '**/public/terrain-edits.bin.tmp', '**/public/world-edits.json', '**/public/world-edits.json.tmp', '**/public/nature-edits.bin', '**/public/nature-edits.bin.tmp' ] } },
	build: { target: 'esnext' },
	optimizeDeps: { rolldownOptions: { transform: { target: 'esnext' } } }
} );
