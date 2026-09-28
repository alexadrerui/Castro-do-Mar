// Prints terrain height profiles along compass bearings (0 = north, 90 = east).
// node tools/profile.mjs [--from=x,z] [bearingDeg ...]
import { heightAnalytic } from '../src/world/heightfield.js';
import { farHeight } from '../src/world/horizon.js';
import { VILLAGE, TERRAIN } from '../src/world/layout.js';

const fromArg = process.argv.find( ( a ) => a.startsWith( '--from=' ) );
const [ ox, oz ] = fromArg ? fromArg.slice( 7 ).split( ',' ).map( Number ) : [ VILLAGE.x, VILLAGE.z ];
const bearings = process.argv.slice( 2 ).filter( ( a ) => ! a.startsWith( '--' ) ).map( Number );
const list = bearings.length ? bearings : [ - 90, - 60, - 30, 0, 30, 60 ];
const dists = [ 50, 100, 150, 200, 300, 400, 600, 800, 1000, 1300, 1600, 2000, 3000, 4000, 6000, 9000 ];
const half = TERRAIN.size / 2;
const inside = ( x, z ) => Math.abs( x - TERRAIN.centerX ) < half && Math.abs( z - TERRAIN.centerZ ) < half;
for ( const b of list ) {
	const r = b * Math.PI / 180;
	const row = dists.map( ( d ) => {
		const x = ox + Math.sin( r ) * d, z = oz - Math.cos( r ) * d;
		const h = inside( x, z ) ? heightAnalytic( x, z ) : farHeight( x, z );
		return `${d}:${Math.round( h )}`;
	} );
	console.log( `bearing ${b}°  ` + row.join( '  ' ) );
}
