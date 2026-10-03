// Off-main-thread generation of the heightfield, splat mask, macro noise and AO, one band of rows per
// message (world/genFields.js runs a few of these workers as a pool).
//   { cmd: 'height' | 'mask' | 'macro', j0, j1, world }  ->  the rows j0..j1
//   { cmd: 'ao', j0, j1, height, world }                  ->  the AO rows j0..j1 over the full relief
import { HeightField, buildMask, bakeAO, buildMacro } from './heightfield.js';
import { applyWorldEdits } from './worldEdits.js';

self.onmessage = async ( e ) => {
	const { cmd, j0, j1 } = e.data;
	// the edited village (moved / added / removed houses): pads in the relief, trampled ground
	applyWorldEdits( e.data.world || null );
	const progress = ( p ) => self.postMessage( { type: 'progress', p } );
	let data;
	if ( cmd === 'height' ) {
		const hf = new HeightField();
		await hf.build( progress, true, j0, j1 );
		data = hf.data.slice( j0 * hf.n, j1 * hf.n );
	} else if ( cmd === 'ao' ) {
		const hf = new HeightField();
		hf.data = e.data.height;
		data = bakeAO( hf, progress, j0, j1 );
	} else if ( cmd === 'macro' ) {
		data = buildMacro( progress, j0, j1 );
	} else if ( cmd === 'mask' ) {
		data = buildMask( progress, j0, j1 );
	}
	self.postMessage( { type: 'done', data }, [ data.buffer ] );
};
