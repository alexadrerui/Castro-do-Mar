// The dynamic resolution's rule (core/dynamicRes.js) with made-up frame times, no browser: a slow
// stretch steps down, a fast one steps back up, a step up that lands slow goes back and is blocked
// for 60 s, a stall throws its window away. Exits 1 on a failed check.
//   node tools/dynres.mjs
import { DynamicResolution } from '../src/core/dynamicRes.js';

const pass = { scale: 1, setResolutionScale( s ) { this.scale = s; } };
const d = new DynamicResolution( pass );
const fail = [];
const check = ( what, ok, extra = '' ) => { if ( ! ok ) fail.push( what ); console.log( ok ? '  ok  ' : '  FAIL', what, extra ); };
const run = ( fps, seconds ) => { for ( let t = 0; t < seconds; t += 1 / fps ) d.update( 1 / fps ); return d.scale; };

check( 'steady 60 fps: 100%', run( 60, 10 ) === 1 );
check( '30 fps for 10 s: steps down', run( 30, 10 ) < 1, `${ d.scale * 100 }%` );
check( '30 fps for long: floor at 50%', run( 30, 60 ) === 0.5 );
const low = d.scale;
check( '60 fps: steps back up', run( 60, 6 ) > low, `${ d.scale * 100 }%` );
check( '60 fps for long: back to 100%', run( 60, 60 ) === 1 );
// a level where the frame rate is just under the limit: down to 87.5%, the step up fails (48 fps) and
// 100% stays blocked for 60 s, even with good windows in between
run( 40, 6 );
const at = d.scale;
check( '40 fps: one step down', at === 0.875, `${ at * 100 }%` );
let ups = 0;
for ( let i = 0; i < 20; i ++ ) {
	const before = d.scale;
	// fast at 87.5%, slow at 100%
	run( before < 1 ? 60 : 48, 2.6 );
	if ( d.scale > before ) ups ++;
}
check( 'a failed step up is blocked for a minute (one try in 52 s)', ups === 1, `${ ups } tries` );
// stalls (a hidden tab): never a step down for them
const d2 = new DynamicResolution( pass );
for ( let i = 0; i < 40; i ++ ) { d2.update( 0.5 ); d2.update( 1 / 60 ); }
check( 'stalls are ignored', d2.scale === 1 );
// disabled: back to 100%
d.enabled = false; d.update( 1 / 60 );
check( 'disabled: 100%', d.scale === 1 && pass.scale === 1 );
console.log( fail.length ? 'FAILED: ' + fail.join( '; ' ) : 'all ok' );
process.exit( fail.length ? 1 : 0 );
