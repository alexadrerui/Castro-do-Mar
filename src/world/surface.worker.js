// Off-main-thread bake of the building surfaces (world/surfaceBake.js).
import { bakeSurfaces } from './surfaceBake.js';

self.onmessage = () => {
	const out = bakeSurfaces();
	const transfer = [ 'stone', 'slab', 'thatch', 'wood', 'daub', 'world' ].map( ( k ) => out[ k ].data.buffer );
	self.postMessage( out, transfer );
};
