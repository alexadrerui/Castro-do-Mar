// The scene's depth convention (renderer option reversedDepthBuffer, three r186: depth 1 at the near
// plane and 0 at the far one, in a float32 depth buffer: even precision out to the far plane, where a
// 24-bit buffer with near 1 m / far 40 km had ~1.5 m steps at 5 km). The post passes that read the
// scene's depth texture test "nothing drawn here, the sky" through this; getViewPosition and the
// pass's viewZ already follow the camera's (reversed) projection.
let reversed = false;

export function setReversedDepth( on ) { reversed = !! on; }

// the sky (the cleared depth): 1 normally, 0 reversed
export const isSky = ( depth ) => ( reversed ? depth.lessThanEqual( 0.00001 ) : depth.greaterThanEqual( 0.99999 ) );
