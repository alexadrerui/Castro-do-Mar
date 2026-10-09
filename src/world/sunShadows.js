// The sun's shadows as cascades (three's CSMShadowNode): a sharp shadow map near the camera and wider
// ones further out, out to MAX_FAR, cross-faded where one hands over to the next and at the end. One
// box around the camera (main.js placeShadow, until 03/10/2026) could not cover what a view from above
// sees: the long shadows of the hills over the bay stopped at its straight edge, which moved with the
// camera (shadows on the water switching on and off as it turned).
//
// Couplings with the rest of the app, all here:
//  · the cascades are initialised with the MAIN camera: the node otherwise takes the camera of its
//    first build, which can be the water reflection's mirrored one;
//  · they clone the sun's shadow (map size, bias, layers, manual updates): mapSize 2048 each, the
//    normal bias scaled with each cascade's texel, redrawn once per frame by markDirty() (the main
//    loop), not again for the reflection capture;
//  · intensity (the panel's shadows switch, the rain) and the layers the shadow cameras see (props in
//    layer 1, the proxies of core/proxies.js) go to every cascade;
//  · the cascade boxes come from the camera projection: redone when the aspect, the fov or the far
//    plane change (a resize, the dive: underwater the far plane drops to 90 m);
//  · core/chunked.js shadowSphere: the instanced trees and rocks cast within the reach of the camera
//    (PROP_REACH, or the quality's: setReach);
//  · the terrain casts through a coarse grid of its own on SHADOW_LAYER (world/terrainShadow.js), not
//    its chunks.
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { shadowSphere } from '../core/chunked.js';

const MAX_FAR = 900;       // m: shadows out to here
// 2 since 08/10/2026 (was 3): one shadow pass less (~1/3 of the shadow draw calls); ?cascades=3 for A/B
const CASCADES = Math.min( 4, Math.max( 1, Number( new URLSearchParams( location.search ).get( 'cascades' ) ) || 2 ) );
const MAP = 2048;          // per cascade
const MARGIN = 400;        // m behind each box along the light: casters up the hill from it
const NORMAL_BIAS = 0.85;  // texels
const PROP_REACH = 250;    // m: trees and rocks cast this far by default (the hills cast out to MAX_FAR;
                           // a tree shadow past this is lost in the haze, and drawing every far tile
                           // into the outer cascade cost several ms); the quality "Alta" sets 420
                           // (core/settings.js, setReach)

const _q = new URLSearchParams( location.search );
const LAMBDA = Number( _q.get( 'csmLambda' ) ) || ( CASCADES === 2 ? 0.7 : 0.5 );

// three's 'practical' split (a mix of the uniform and the logarithmic ones) with a lambda of our own:
// the plain 0.5 put the only break of 2 cascades at ~240 m, a near map ~460 m wide (0.22 m texels)
// where the tree canopies' shadows on the ground near the camera washed out; 0.7 breaks at ~155 m
// (~205 m wide, as the first of the 3 cascades before 08/10/2026)
function practicalSplit( n, near, far, out ) {
	for ( let i = 1; i < n; i ++ ) {
		const uni = ( near + ( far - near ) * i / n ) / far;
		const log = near * ( far / near ) ** ( i / n ) / far;
		out.push( uni + ( log - uni ) * LAMBDA );
	}
	out.push( 1 );
}

export function createSunShadows( { sun, camera, renderer } ) {
	sun.shadow.mapSize.set( MAP, MAP );
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = MARGIN + 2 * MAX_FAR + 200;
	sun.shadow.camera.updateProjectionMatrix();
	const csm = new CSMShadowNode( sun, { cascades: CASCADES, maxFar: MAX_FAR, mode: 'custom', lightMargin: MARGIN } );
	csm.customSplitsCallback = practicalSplit;
	csm.fade = true;
	sun.shadow.shadowNode = csm;
	csm._init( { camera, renderer } ); // three r186 internals: before any build picks another camera
	const shadows = () => [ sun.shadow, ...csm.lights.map( ( l ) => l.shadow ) ];
	const biasByTexel = () => {
		for ( const l of csm.lights ) {
			const c = l.shadow.camera;
			l.shadow.normalBias = NORMAL_BIAS * ( c.right - c.left ) / MAP;
		}
	};
	for ( const s of shadows() ) s.autoUpdate = false;
	biasByTexel();
	let aspect = camera.aspect, far = camera.far, fov = camera.fov, reach = PROP_REACH;
	return {
		csm,
		// redraw the maps on the next render (once a frame, from the main loop)
		markDirty() { for ( const s of shadows() ) s.needsUpdate = true; },
		setIntensity( v ) { for ( const s of shadows() ) s.intensity = v; },
		enableLayer( n ) { for ( const s of shadows() ) s.camera.layers.enable( n ); },
		// how far trees and rocks cast (m)
		setReach( m ) { reach = m; },
		get reach() { return reach; },
		update() {
			if ( camera.aspect !== aspect || camera.far !== far || camera.fov !== fov ) {
				aspect = camera.aspect; far = camera.far; fov = camera.fov;
				csm.updateFrustums();
				biasByTexel();
			}
			shadowSphere.center.copy( camera.position );
			shadowSphere.radius = reach;
		}
	};
}
