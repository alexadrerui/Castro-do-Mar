import { createVegetation } from './vegetation.js';
import { createRocks, createRockMaterial } from './rocks.js';
import { createBuildingMaterials } from './materials.js';
import { createBuildings } from './buildings.js';
import { createFort } from './fort.js';
import { createSmoke } from './smoke.js';

// Populates the world with props, phase by phase.
export async function populate( app, progress ) {
	const veg = createVegetation( app, ( p ) => progress( p * 0.5 ) );
	app.scene.add( veg );
	app.layers.vegetation = { label: 'Vegetação', object: veg };
	console.info( 'vegetation', veg.userData.counts );
	const rocks = createRocks( app, ( p ) => progress( 0.5 + p * 0.3 ) );
	app.scene.add( rocks );
	app.layers.rocks = { label: 'Pedras', object: rocks };
	console.info( 'rocks', rocks.userData.counts );
	const mats = createBuildingMaterials();
	app.buildingMaterials = mats;
	const bld = createBuildings( app, mats, ( p ) => progress( 0.8 + p * 0.1 ) );
	app.scene.add( bld );
	app.layers.buildings = { label: 'Casas', object: bld };
	const fort = createFort( app, mats, createRockMaterial( 1.0, false, { tintScale: 0.62, jointScale: 0.22 } ) );
	app.scene.add( fort );
	app.layers.fort = { label: 'Castro', object: fort };
	const smoke = createSmoke( bld.userData.smoke );
	app.scene.add( smoke.mesh );
	app.smoke = smoke;
	app.layers.smoke = { label: 'Fumaça', object: smoke.mesh };
	progress( 1 );
}
