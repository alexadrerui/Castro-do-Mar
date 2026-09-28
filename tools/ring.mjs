// Skyline check: max / mean far-range height per 30 deg sector on rings.
import { farHeight } from '../src/world/horizon.js';
import { VILLAGE } from '../src/world/layout.js';

for ( const R of [ 3500, 5000, 7000, 10000 ] ) {
	const out = [];
	for ( let s = - 180; s < 180; s += 30 ) {
		let mx = - 1e9, sum = 0, n = 0;
		for ( let a = s; a < s + 30; a += 1 ) {
			const r = a * Math.PI / 180;
			const h = farHeight( VILLAGE.x + Math.sin( r ) * R, VILLAGE.z - Math.cos( r ) * R );
			mx = Math.max( mx, h ); sum += h; n ++;
		}
		out.push( `${s}:${Math.round( mx )}/${Math.round( sum / n )}` );
	}
	console.log( `r=${R}  ` + out.join( '  ' ) );
}
