// Cloud shadows on the ground, from the volumetric clouds themselves (post/clouds.js): a Beer shadow map
// (after takram's @takram/three-clouds, MIT, licenses/LICENSE-takram-clouds.md: the BSM of its
// shadow pass, one cascade here). The clouds render it (Clouds.renderShadow, before the scene pass): each
// texel is a point of the clouds' base plane, and a march toward the sun through the layers stores the
// distance to the first cloud (from the march's start, up sunward), the mean extinction past it and the
// total optical depth. The ground (terrain, grass, plants, distant canopies, rocks, buildings) projects
// each fragment along the sun onto the base plane and reads the total optical depth: the shadows are
// where the clouds in the sky are, and drift with them. The clouds read the front and the mean
// extinction for their own shadowing past their short march toward the sun.
// It replaced a two-octave value noise (port of Drusniel's rendering/cloudShadow.js, MIT): with ?clouds=0
// there are no cloud shadows.
// app.cloudShadow: { strength, opacity, sunFade } uniforms; strength 0 turns it off (the factor is 1).
import * as THREE from 'three/webgpu';
import { Fn, exp, float, positionWorld, smoothstep, texture, uniform, max } from 'three/tsl';

export const cloudShadowUniforms = {
	strength: uniform( 0.55 ), // the share of the light a thick cloud takes (the sky's light stays)
	opacity: uniform( 0.2 ),   // per unit optical depth: the edges' softness
	sunFade: uniform( 1 )      // 0 with the sun down
};

// the map: SIZE² texels over SPAN metres of the base plane, centred where the camera's ground projects
export const CLOUD_MAP = { size: 512, span: 20480, maxLen: 8000 };
export const cloudMap = {
	rt: new THREE.RenderTarget( CLOUD_MAP.size, CLOUD_MAP.size, { type: THREE.HalfFloatType, depthBuffer: false } ),
	centre: uniform( new THREE.Vector2() ),  // of the stored map (moves only when the map is rendered)
	sun: uniform( new THREE.Vector3( 0, 1, 0 ) ),
	base: uniform( 750 ), top: uniform( 2200 )
};
cloudMap.rt.texture.name = 'clouds.shadowMap';
cloudMap.rt.texture.minFilter = cloudMap.rt.texture.magFilter = THREE.LinearFilter;
cloudMap.tex = texture( cloudMap.rt.texture );

// the march toward the sun, shared by the map and its readers: the sun's height (kept off the horizon)
// and the length from the base plane up through the layers
export const sunUp = () => max( cloudMap.sun.y, 0.05 );
export const marchLength = () => cloudMap.top.sub( cloudMap.base ).div( sunUp() ).min( CLOUD_MAP.maxLen );

// where p, followed toward the sun, crosses the base plane: the map's uv, and how far inside it is (1 in
// the middle, 0 at the border)
export const mapLookup = ( p ) => {
	const s = cloudMap.sun;
	const q = p.xz.add( s.xz.mul( cloudMap.base.sub( p.y ).div( sunUp() ) ) );
	const st = q.sub( cloudMap.centre ).div( CLOUD_MAP.span ).add( 0.5 );
	const e = st.sub( 0.5 ).abs();
	const inside = smoothstep( 0.5, 0.42, max( e.x, e.y ) );
	return { st, inside };
};

// the shade factor (1 in the sun, 1 - strength under a thick cloud)
export const cloudShade = Fn( () => {
	const U = cloudShadowUniforms;
	const { st, inside } = mapLookup( positionWorld );
	const od = cloudMap.tex.sample( st ).z;
	const cloud = exp( od.mul( U.opacity ).negate() ).oneMinus().mul( inside );
	return float( 1 ).sub( cloud.mul( U.strength ).mul( U.sunFade ) );
} );

// the map's centre for a camera at (x, z): the base-plane point above it along the sun, snapped to a texel
const _c = new THREE.Vector2();
export function mapCentreFor( x, z, sun, base ) {
	const up = Math.max( sun.y, 0.05 );
	const texel = CLOUD_MAP.span / CLOUD_MAP.size;
	_c.set( x + sun.x * base / up, z + sun.z * base / up );
	return _c.set( Math.round( _c.x / texel ) * texel, Math.round( _c.y / texel ) * texel );
}

// an empty map (no clouds: no shadows)
export function clearCloudMap( renderer ) {
	const prev = renderer.getRenderTarget();
	const cc = renderer.getClearColor( new THREE.Color() ), ca = renderer.getClearAlpha();
	renderer.setRenderTarget( cloudMap.rt );
	renderer.setClearColor( 0x000000, 0 );
	renderer.clear( true, false, false );
	renderer.setClearColor( cc, ca );
	renderer.setRenderTarget( prev );
}

// the sun's direction (followed by reference); call before any material using cloudShade() is built
export function bindSky( sky ) {
	cloudMap.sun.value = sky.state.sunDir;
}

// the sun's height (degrees): full shadows from 12 degrees up
export function updateCloudSun( elevation ) {
	cloudShadowUniforms.sunFade.value = Math.min( 1, Math.max( 0, ( elevation - 2 ) / 10 ) );
}
