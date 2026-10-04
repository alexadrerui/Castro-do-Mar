import { createVegetation } from './vegetation.js';
import { GrassField } from './grass.js';
import { createRocks, createRockMaterial } from './rocks.js';
import { createBuildingMaterials } from './materials.js';
import { surfaceTextures } from './surfaceBake.js';
import { createBuildings } from './buildings.js';
import { createFort } from './fort.js';
import { addProxies } from '../core/proxies.js';
import { createSmoke } from './smoke.js';
import { buildPickBVH } from '../controls/focus.js';
import { loadDetailTexture } from './granite/detail.js';
import { createMeadowFlora } from './meadowFlora.js';

// Populates the world with props, phase by phase.
export async function populate( app, progress ) {
	const veg = await createVegetation( app, ( p ) => progress( p * 0.5 ) );
	app.scene.add( veg );
	app.layers.vegetation = { label: 'Vegetação', object: veg };
	console.info( 'vegetation', veg.userData.counts );
	// meadow and dune grass in cells around the camera (Tidewater's GrassField)
	const grass = new GrassField( app );
	app.scene.add( grass.group );
	app.grass = grass;
	app.layers.grass = { label: 'Grama', object: grass.group };
	app.onFrame.push( () => grass.update( app.camera ) );
	// flowers, seed heads, foxgloves and leaf litter among the grass (Drusniel's meadow plants)
	// (?flora=0 leaves them out)
	if ( new URLSearchParams( location.search ).get( 'flora' ) !== '0' ) {
		const flora = createMeadowFlora( app, grass.density, veg );
		app.scene.add( flora );
		app.layers.flora = { label: 'Flores', object: flora };
		console.info( 'meadow flora', JSON.stringify( flora.userData.counts ) );
	}
	await loadDetailTexture(); // the granite's detail texels, from the cache after the first load
	const rocks = createRocks( app, ( p ) => progress( 0.5 + p * 0.3 ) );
	app.scene.add( rocks );
	app.layers.rocks = { label: 'Pedras', object: rocks };
	console.info( 'rocks', rocks.userData.counts );
	// the house surfaces, baked (world/surfaceBake.js; started by main.js at the start of the load)
	const surf = surfaceTextures( await app.surfaces );
	app.surfaceTextures = surf;
	const mats = createBuildingMaterials( surf );
	app.buildingMaterials = mats;
	// in the editor (?edit) every house / stall / prop is its own group, so it can be selected
	const bld = createBuildings( app, mats, ( p ) => progress( 0.8 + p * 0.1 ), { separate: new URLSearchParams( location.search ).has( 'edit' ) } );
	app.scene.add( bld );
	app.layers.buildings = { label: 'Casas', object: bld };
	const fort = createFort( app, mats, createRockMaterial( 1.0, false, { tintScale: 0.62, jointScale: 0.22 }, surf ) );
	app.scene.add( fort );
	app.layers.fort = { label: 'Castro', object: fort };
	// cheap stand-ins in the water reflection and the shadow pass
	addProxies( bld ); addProxies( fort );
	// raycasts on them (bird perches now, the focus later) through a BVH
	buildPickBVH( bld ); buildPickBVH( fort );
	const smoke = createSmoke( bld.userData.smoke );
	app.scene.add( smoke.mesh );
	app.smoke = smoke;
	app.hearths = bld.userData.smoke; // the hearths (Vector3s), for the fire's crackle (audio/ambience.js)
	app.layers.smoke = { label: 'Fumaça', object: smoke.mesh };
	progress( 1 );
}
