// Off-main-thread generation of the heightfield and splat mask.
import { HeightField, buildMask, bakeAO, buildMacro } from './heightfield.js';

let hf = null;

self.onmessage = async ( e ) => {
	if ( e.data.cmd === 'height' ) {
		hf = new HeightField();
		await hf.build( ( p ) => self.postMessage( { type: 'progress', p } ), true );
		self.postMessage( { type: 'height', data: hf.data.slice() } );
	} else if ( e.data.cmd === 'ao' ) {
		const data = bakeAO( hf, ( p ) => self.postMessage( { type: 'progress', p } ) );
		self.postMessage( { type: 'ao', data }, [ data.buffer ] );
	} else if ( e.data.cmd === 'macro' ) {
		const data = buildMacro( ( p ) => self.postMessage( { type: 'progress', p } ) );
		self.postMessage( { type: 'macro', data }, [ data.buffer ] );
	} else if ( e.data.cmd === 'mask' ) {
		const data = buildMask( ( p ) => self.postMessage( { type: 'progress', p } ) );
		self.postMessage( { type: 'mask', data }, [ data.buffer ] );
	}
};
