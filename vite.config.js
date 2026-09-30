import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

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

export default defineConfig( {
	plugins: [ captureEndpoint() ],
	// single three.js instance: addons and three-bvh-csg import "three"
	resolve: { alias: [ { find: /^three$/, replacement: 'three/webgpu' } ] },
	server: { port: 5190, strictPort: true },
	build: { target: 'esnext' },
	optimizeDeps: { rolldownOptions: { transform: { target: 'esnext' } } }
} );
