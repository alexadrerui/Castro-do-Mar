// The terrain's shadow, from a coarse mesh drawn only into the sun's shadow maps. Drawing the terrain
// itself into the three cascades cost ~180 draw calls and ~1.6 ms a frame and took the real window
// from 60 to ~55 FPS (03/10/2026: the sun's shadows were switched off by default for it). Here the
// terrain's chunks cast nothing and this grid stands in for them: GRID x GRID quads SPACING m apart
// around the camera, its heights read from the terrain's height texture in the vertex stage (the shadow
// pass copies the positionNode), recentred in whole grid steps (every vertex lands on the same world
// point: the shadows do not swim), sunk SINK m (the coarse surface bridges the hollows of the real one,
// above it there, and would shade the ground it stands for), outside the heightfield dropped far below.
// It lives on a layer of its own (SHADOW_LAYER) that only the cascades' cameras see (sunShadows.js
// enableLayer): neither the view nor the water's reflection draws it. One draw per cascade.
// The relief's own small shadows near the camera (a bank, a ditch) are below its resolution: the long
// shadows of the hills over the valleys and the bay with a low sun are what it is for.
// The idea of a cheaper caster than the terrain comes from offroad's renderer (https://github.com/
// alexadrerui/offroad, MIT, licenses/LICENSE-offroad.md), where the terrain casts no shadow at all.
import * as THREE from 'three/webgpu';
import { Fn, mix, positionGeometry, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';

export const SHADOW_LAYER = 4;
const SPACING = 10;   // m
const GRID = 280;     // quads per side: 2.8 km
const SINK = 1.2;     // m

export function createTerrainShadow( heightTex ) {
	const hd = heightTex.userData;
	const geo = new THREE.PlaneGeometry( GRID * SPACING, GRID * SPACING, GRID, GRID );
	geo.rotateX( - Math.PI / 2 );
	const centre = uniform( new THREE.Vector2() );
	const mat = new THREE.MeshBasicNodeMaterial();
	mat.name = 'TerrainShadowCaster';
	mat.side = THREE.DoubleSide; // the sun's shadow pass draws the back faces (as the water's plane)
	mat.positionNode = Fn( () => {
		const xz = positionGeometry.xz.add( centre );
		// texel-centre lookup, as the water's (water.js)
		const uv = xz.sub( vec2( hd.x0, hd.z0 ) ).div( hd.cell ).add( 0.5 ).div( hd.n );
		const inside = smoothstep( 0.0, 0.002, uv.x ).mul( smoothstep( 0.998, 1.0, uv.x ).oneMinus() ).mul( smoothstep( 0.0, 0.002, uv.y ) ).mul( smoothstep( 0.998, 1.0, uv.y ).oneMinus() );
		const h = texture( heightTex, uv ).level( 0 ).r;
		return vec3( xz.x, mix( - 500, h.sub( SINK ), inside ), xz.y );
	} )();
	const mesh = new THREE.Mesh( geo, mat );
	mesh.name = 'terrainShadowCaster';
	mesh.castShadow = true;
	mesh.receiveShadow = false;
	mesh.frustumCulled = false; // placed by the positionNode
	mesh.layers.set( SHADOW_LAYER );
	return {
		mesh,
		// follow the camera in whole grid steps
		update( camera ) {
			centre.value.set( Math.round( camera.position.x / SPACING ) * SPACING, Math.round( camera.position.z / SPACING ) * SPACING );
		}
	};
}
