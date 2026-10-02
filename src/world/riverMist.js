// Spray mist rising from the plunge of every waterfall of the rivers (riverCourse.js findRiverFalls):
// camera-facing puffs animated on the GPU from each particle's constants, rising and slowing as they
// spread, drifting downstream, turning and fading over their life; lit as a sphere with a lit and a
// shaded side plus a forward-scattering lobe, so the spray glows against the sun. Port of
// water/WaterfallMist.js and of createSprayPuffTexture (water/waterfallTexture.js) of Drusniel: Gods'
// End (https://github.com/danielsobrado/drusniel-gods-end, MIT, Copyright (c) 2026 Daniel Sobrado,
// licenses/LICENSE-Drusniel.md; their spray shading is after Snowflow's, MIT). Changes: one instanced
// mesh (InstancedBufferGeometry, like the rest of the project) for every fall of every river; the
// ground under a puff from our height texture; the light from the sky's sun and a sky tint uniform;
// the mist is drawn while the camera is within DRAW_DISTANCE of a fall.
import * as THREE from 'three/webgpu';
import {
	attribute, cameraPosition, cameraViewMatrix, cameraWorldMatrix, color, cos, dot, fract, max, mix, normalize,
	positionGeometry, positionWorld, sin, smoothstep, texture, time, uv, vec2, vec3, vec4
} from 'three/tsl';
import { mulberry32 } from '../core/noise.js';

const DRAW_DISTANCE = 450;
const NEAR_COLLAPSE = 1.5, NEAR_FADE = 10; // puffs this close to the camera thin out (no white-out walking into it)
const SOFT_HEIGHT = 0.8;                   // a puff fades in over this height above the ground or the water
const DENSITY_COUNT = 48;
const MIE_G = 0.6, PHASE_GAIN = 0.9, SKY_GAIN = 0.35;
const TWO_PI = Math.PI * 2;

// gradient noise tiling every columns x rows lattice cells (theirs)
function hash( x, y, seed ) {
	let h = Math.imul( x, 0x27d4eb2d ) ^ Math.imul( y, 0x165667b1 ) ^ Math.imul( seed, 0x9e3779b9 );
	h = Math.imul( h ^ ( h >>> 15 ), 0x85ebca6b ); h = Math.imul( h ^ ( h >>> 13 ), 0xc2b2ae35 );
	return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;
}
function tiledNoise( columns, rows, seed ) {
	const gx = new Float32Array( columns * rows ), gy = new Float32Array( columns * rows );
	for ( let i = 0; i < gx.length; i ++ ) { const a = hash( i % columns, Math.floor( i / columns ), seed ) * Math.PI * 2; gx[ i ] = Math.cos( a ); gy[ i ] = Math.sin( a ); }
	const fade = ( t ) => t * t * t * ( t * ( t * 6 - 15 ) + 10 );
	return ( x, y ) => {
		const ix = Math.floor( x ), iy = Math.floor( y ), fx = x - ix, fy = y - iy;
		const corner = ( cx, cy, dx, dy ) => { const k = ( ( cy % rows ) + rows ) % rows * columns + ( ( cx % columns ) + columns ) % columns; return gx[ k ] * dx + gy[ k ] * dy; };
		const a = corner( ix, iy, fx, fy ), b = corner( ix + 1, iy, fx - 1, fy ), c = corner( ix, iy + 1, fx, fy - 1 ), d = corner( ix + 1, iy + 1, fx - 1, fy - 1 );
		const u = fade( fx );
		return THREE.MathUtils.lerp( a + ( b - a ) * u, c + ( d - c ) * u, fade( fy ) );
	};
}

// four puff shapes, one per channel: a ragged disc that is zero on the border
function sprayPuffTexture( size = 128, seed = 7723 ) {
	const data = new Uint8Array( size * size * 4 );
	for ( let ch = 0; ch < 4; ch ++ ) {
		const warp = tiledNoise( 3, 3, seed + ch * 11 );
		const noise = [ tiledNoise( 4, 4, seed + ch * 11 + 1 ), tiledNoise( 8, 8, seed + ch * 11 + 2 ), tiledNoise( 16, 16, seed + ch * 11 + 3 ) ];
		for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {
			const u = ( x + 0.5 ) / size, v = ( y + 0.5 ) / size, bend = warp( u * 3, v * 3 ) * 0.9;
			const detail = noise[ 0 ]( u * 4 + bend, v * 4 - bend ) * 0.55 + noise[ 1 ]( u * 8 + bend, v * 8 ) * 0.3 + noise[ 2 ]( u * 16, v * 16 + bend ) * 0.15;
			const radius = Math.hypot( u - 0.5, v - 0.5 ) * 2 * ( 1 - detail * 0.5 );
			const falloff = 1 - THREE.MathUtils.smoothstep( radius, 0.2, 0.95 );
			const border = 1 - THREE.MathUtils.smoothstep( Math.max( Math.abs( u - 0.5 ), Math.abs( v - 0.5 ) ) * 2, 0.84, 0.98 );
			data[ ( y * size + x ) * 4 + ch ] = Math.round( THREE.MathUtils.clamp( falloff * border * ( 0.72 + detail * 1.1 ), 0, 1 ) * 255 );
		}
	}
	const t = new THREE.DataTexture( data, size, size );
	t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
	t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
	t.needsUpdate = true;
	return t;
}

// Their particles: spawn (xyz + the water level there), motion (drift x / z, rise, phase), shape (start
// and end size, lifetime, peak opacity). Most rise from the plunge and drift downstream; a quarter lift
// off the lower face of the fall.
function mistParticles( courses, seed = 6089 ) {
	const random = mulberry32( seed );
	const particles = [], sites = [];
	for ( const course of courses ) {
		const S = course.samples;
		for ( const fall of course.falls ) {
			const foot = S[ fall.foot ];
			const strength = THREE.MathUtils.clamp( fall.drop / 25, 0.35, 1.5 );
			const count = Math.round( THREE.MathUtils.clamp( 12 + fall.drop * 0.9, 12, 64 ) );
			const thin = Math.min( 1, Math.sqrt( DENSITY_COUNT / count ) );
			const faceStart = Math.round( fall.lip + ( fall.foot - fall.lip ) * 0.35 );
			// smaller puffs on our narrow streams (theirs were sized for a 10-30 m river)
			const k = THREE.MathUtils.clamp( foot.width / 8, 0.45, 1 );
			for ( let n = 0; n < count; n ++ ) {
				const face = random() < 0.25;
				const p = face ? S[ Math.round( THREE.MathUtils.lerp( faceStart, fall.foot, random() ) ) ] : foot;
				const across = ( random() - 0.5 ) * ( face ? 0.8 : 0.9 ) * p.width;
				const along = face ? 0 : - 0.5 + random() * 3.5;
				const start = ( 1.6 + random() * 1.4 ) * ( 0.7 + 0.3 * strength ) * ( face ? 0.7 : 1 ) * k;
				const lift = start * 0.5 + ( face ? 0.3 + random() * 0.8 : random() * 0.8 );
				const drift = 0.25 + random() * 0.65, lateral = ( random() - 0.5 ) * 0.8;
				const rise = ( 0.45 + random() * 0.9 ) * ( 0.6 + 0.4 * strength ) * ( face ? 0.6 : 1 );
				const lifetime = face ? 2.5 + random() * 2 : 3.5 + random() * 3;
				const grow = 2 + random() * 1.2;
				const opacity = ( 0.24 + random() * 0.18 ) * thin * ( face ? 0.6 : 1 );
				particles.push( {
					spawn: [ p.x - p.dz * across + p.dx * along, p.y + lift, p.z + p.dx * across + p.dz * along, p.y ],
					motion: [ p.dx * drift - p.dz * lateral, rise, p.dz * drift + p.dx * lateral, random() ],
					shape: [ start, start * grow, lifetime, opacity ]
				} );
			}
			const top = S[ faceStart ];
			const c = new THREE.Vector3( ( top.x + foot.x ) / 2, ( top.y + foot.y ) / 2 + 3, ( top.z + foot.z ) / 2 );
			sites.push( new THREE.Sphere( c, c.distanceTo( new THREE.Vector3( foot.x, foot.y, foot.z ) ) + 18 ) );
		}
	}
	const pack = ( key ) => Float32Array.from( particles.flatMap( ( q ) => q[ key ] ) );
	return { count: particles.length, spawn: pack( 'spawn' ), motion: pack( 'motion' ), shape: pack( 'shape' ), sites };
}

export class RiverMist {
	// courses: RiverCourse[]; heightTex: the terrain's height texture; light: { sunDir (vector uniform
	// value), sunColor, skyColor } uniforms
	constructor( courses, heightTex, light ) {
		const P = mistParticles( courses );
		this.sites = P.sites;
		this.count = P.count;
		this.mesh = null;
		if ( ! P.count ) return;
		const geo = new THREE.InstancedBufferGeometry();
		const quad = new THREE.PlaneGeometry( 1, 1 );
		geo.index = quad.index;
		geo.setAttribute( 'position', quad.attributes.position );
		geo.setAttribute( 'uv', quad.attributes.uv );
		geo.setAttribute( 'mistSpawn', new THREE.InstancedBufferAttribute( P.spawn, 4 ) );
		geo.setAttribute( 'mistMotion', new THREE.InstancedBufferAttribute( P.motion, 4 ) );
		geo.setAttribute( 'mistShape', new THREE.InstancedBufferAttribute( P.shape, 4 ) );
		geo.instanceCount = P.count;
		this.puffs = sprayPuffTexture();
		const mat = this._material( heightTex, light );
		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.name = 'riverMist';
		this.mesh.frustumCulled = false; // every puff is placed by the positionNode
		this.mesh.renderOrder = 2;       // after the water
		this.mesh.layers.set( 1 );       // not in the reflection
	}

	_material( heightTex, light ) {
		const spawn = attribute( 'mistSpawn', 'vec4' ), motion = attribute( 'mistMotion', 'vec4' ), shape = attribute( 'mistShape', 'vec4' );
		const age = fract( time.div( shape.z ).add( motion.w ) );
		const seconds = age.mul( shape.z );
		// height: the integral of a rise speed that falls to zero at the end of life
		const rise = motion.y.mul( seconds ).mul( age.mul( - 0.5 ).add( 1 ) );
		const center = vec3( spawn.x.add( motion.x.mul( seconds ) ), spawn.y.add( rise ), spawn.z.add( motion.z.mul( seconds ) ) );
		const turn = motion.w.mul( TWO_PI ).add( age.mul( motion.w.sub( 0.5 ) ).mul( 1.2 ) );
		const spin = vec2( cos( turn ), sin( turn ) );
		const size = mix( shape.x, shape.y, age.sqrt() ).mul( smoothstep( NEAR_COLLAPSE, NEAR_COLLAPSE * 1.6, cameraPosition.distance( center ) ) );
		const corner = positionGeometry.xy;
		const screen = vec2( corner.x.mul( spin.x ).sub( corner.y.mul( spin.y ) ), corner.x.mul( spin.y ).add( corner.y.mul( spin.x ) ) );
		const right = cameraWorldMatrix.element( 0 ).xyz, up = cameraWorldMatrix.element( 1 ).xyz;
		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, side: THREE.DoubleSide } );
		mat.name = 'RiverMist';
		mat.positionNode = center.add( right.mul( screen.x.mul( size ) ) ).add( up.mul( screen.y.mul( size ) ) );
		const puff = texture( this.puffs, uv() );
		const variant = fract( motion.w.mul( 7.31 ) ).mul( 4 ).floor();
		const density = variant.lessThan( 1 ).select( puff.r, variant.lessThan( 2 ).select( puff.g, variant.lessThan( 3 ).select( puff.b, puff.a ) ) );
		const life = smoothstep( 0, 0.1, age ).mul( smoothstep( 0.5, 1, age ).oneMinus() );
		const hd = heightTex.userData;
		const ground = texture( heightTex, positionWorld.xz.sub( vec2( hd.x0, hd.z0 ) ).div( hd.cell ).add( 0.5 ).div( hd.n ) ).r;
		const soft = smoothstep( 0, SOFT_HEIGHT, positionWorld.y.sub( max( ground, spawn.w ) ) );
		const near = smoothstep( NEAR_COLLAPSE * 1.6, NEAR_FADE, cameraPosition.distance( positionWorld ) );
		mat.opacityNode = density.mul( shape.w ).mul( life ).mul( soft ).mul( near );
		// the quad turns on screen, so its corner turns with it to give the sphere normal in view space
		const local = uv().sub( 0.5 ).mul( 2 );
		const facing = vec2( local.x.mul( spin.x ).sub( local.y.mul( spin.y ) ), local.x.mul( spin.y ).add( local.y.mul( spin.x ) ) );
		const nView = normalize( vec3( facing.x, facing.y, dot( facing, facing ).oneMinus().max( 0 ).sqrt() ) );
		const lView = normalize( cameraViewMatrix.mul( vec4( light.sunDir, 0 ) ).xyz );
		const diffuse = dot( nView, lView ).mul( 0.5 ).add( 0.5 );
		// Cornette-Shanks phase; mu is 1 looking straight into the sun
		const mu = lView.z.negate(), g2 = MIE_G * MIE_G;
		const phase = mu.mul( mu ).add( 1 ).mul( ( 3 / ( 8 * Math.PI ) ) * ( 1 - g2 ) / ( 2 + g2 ) ).div( mu.mul( - 2 * MIE_G ).add( 1 + g2 ).pow( 1.5 ) );
		mat.colorNode = color( '#dcebf2' ).mul( light.sunColor.mul( diffuse.mul( 0.6 ).add( phase.mul( PHASE_GAIN ) ) ).add( light.skyColor.mul( SKY_GAIN ) ) );
		return mat;
	}

	// drawn only while a fall is near enough
	update( camera ) {
		if ( ! this.mesh ) return;
		const c = camera.position;
		this.mesh.visible = this.sites.some( ( s ) => s.distanceToPoint( c ) < DRAW_DISTANCE );
	}
}
