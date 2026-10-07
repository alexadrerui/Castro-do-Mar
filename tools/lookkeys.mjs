// The look's key frames (world/look.js) against the old curves of the sun's height they replaced:
// samples every minute of the day, prints each column's largest error (as a share of its range) and
// where it is. With --write, builds the table again from the old curves: the presets (9:00, 15:32,
// 23:00) and midnight first, then a key at the minute with the largest error until every column is
// within --tol (default 1.5%), and rewrites the KEYS block of src/world/look.js.
//   node tools/lookkeys.mjs [--write] [--tol=0.015]
import fs from 'node:fs';
import { sunAt, PRESETS } from '../src/world/clock.js';
import { LOOK_COLUMNS, KEYS, lookAt } from '../src/world/look.js';

const args = process.argv.slice( 2 );
const tol = +( ( args.find( ( a ) => a.startsWith( '--tol=' ) ) || '--tol=0.015' ).split( '=' )[ 1 ] );
const ss = ( x, a, b ) => { if ( x <= a ) return 0; if ( x >= b ) return 1; x = ( x - a ) / ( b - a ); return x * x * ( 3 - 2 * x ); };

// the curves as they were in main.js and sky.js before the table (03/10/2026 .. 07/10/2026)
function legacy( hour ) {
	const e = sunAt( hour ).elevation, ec = Math.max( 0, e );
	const adapt = ss( - e, - 8, 6 );
	const dusk = ss( - e, - 6, 1 ) * ( 1 - ss( - e, 4, 12 ) );
	const n = ss( - e, - 2, 10 );
	const dawn = hour > 4 && hour < 12 ? 1 - ss( hour, 6.5, 8 ) : 0;
	return {
		exposure: 0.8 * ( 1 + 1.5 * adapt ),
		auto: adapt,
		ambient: 0.08 + 0.09 * ss( ec, - 5, 30 ) + 0.1 * dusk,
		haze: 0.35 + 0.65 * ss( e, - 4, 12 ),
		warm: ss( e, 0, 22 ),
		sunset: ss( - e, - 6, 0 ) * 0.8,
		afterglow: 0.45 * ss( e, - 5, - 0.5 ) * ( 1 - ss( e, 3, 10 ) ),
		nightFog: Math.max( n, dawn ),
		calm: 1 - 0.7 * n,
		cool: 1 - 0.7 * n
	};
}

const MIN = 24 * 60;
const truth = Array.from( { length: MIN }, ( _, m ) => legacy( m / 60 ) );
const range = {};
for ( const c of LOOK_COLUMNS ) { const v = truth.map( ( t ) => t[ c ] ); range[ c ] = Math.max( 1e-6, Math.max( ...v ) - Math.min( ...v ) ); }

const round = ( x ) => Math.round( x * 1e5 ) / 1e5;
const keyAt = ( m ) => { const k = { h: m / 60, m }; const t = legacy( m / 60 ); for ( const c of LOOK_COLUMNS ) k[ c ] = round( t[ c ] ); return k; };

function errors( keys ) {
	const worst = {};
	let top = { e: 0, m: 0 };
	const out = {};
	for ( let m = 0; m < MIN; m ++ ) {
		lookAt( m / 60, keys, out );
		let rowWorst = 0;
		for ( const c of LOOK_COLUMNS ) {
			const e = Math.abs( out[ c ] - truth[ m ][ c ] ) / range[ c ];
			if ( ! worst[ c ] || e > worst[ c ].e ) worst[ c ] = { e, m };
			rowWorst = Math.max( rowWorst, e );
		}
		if ( rowWorst > top.e ) top = { e: rowWorst, m };
	}
	return { worst, top };
}

const fmt = ( m ) => String( Math.floor( m / 60 ) ).padStart( 2, '0' ) + ':' + String( m % 60 ).padStart( 2, '0' );
let keys = KEYS;
if ( args.includes( '--write' ) ) {
	const mins = new Set( [ 0, Math.round( PRESETS.manha * 60 ), Math.round( PRESETS.tarde * 60 ), Math.round( PRESETS.noite * 60 ) ] );
	for ( ;; ) {
		keys = [ ...mins ].sort( ( a, b ) => a - b ).map( keyAt );
		const { top } = errors( keys );
		if ( top.e <= tol || mins.size > 80 ) break;
		mins.add( top.m );
	}
	// the presets' hours are exactly the clock's (15:32 = 15 + 32/60)
	const rows = keys.map( ( k ) => `\t{ h: hm( '${ fmt( k.m ) }' ), ${ LOOK_COLUMNS.map( ( c ) => `${ c }: ${ k[ c ] }` ).join( ', ' ) } }` );
	const block = `// KEYS:BEGIN (tools/lookkeys.mjs --write rewrites this block from the old curves)\nexport const KEYS = [\n${ rows.join( ',\n' ) }\n];\n// KEYS:END`;
	const p = new URL( '../src/world/look.js', import.meta.url );
	const src = fs.readFileSync( p, 'utf8' ).replace( /\/\/ KEYS:BEGIN[\s\S]*?\/\/ KEYS:END/, block );
	fs.writeFileSync( p, src );
	keys = keys.map( ( k ) => ( { ...k, h: Math.floor( k.m / 60 ) + ( k.m % 60 ) / 60 } ) );
	console.log( `${ keys.length } keys written` );
}
if ( ! keys.length ) { console.log( 'no keys yet: run with --write' ); process.exit( 1 ); }
const { worst } = errors( keys );
for ( const c of LOOK_COLUMNS ) console.log( c.padEnd( 10 ), ( worst[ c ].e * 100 ).toFixed( 2 ).padStart( 6 ) + '% of its range', 'at', fmt( worst[ c ].m ) );
// the presets render exactly their keys
for ( const [ name, h ] of Object.entries( PRESETS ) ) {
	const a = lookAt( h, keys ), b = legacy( h );
	const d = Math.max( ...LOOK_COLUMNS.map( ( c ) => Math.abs( a[ c ] - b[ c ] ) ) );
	console.log( `${ name } (${ h.toFixed( 3 ) } h): largest difference ${ d.toExponential( 1 ) }` );
}
