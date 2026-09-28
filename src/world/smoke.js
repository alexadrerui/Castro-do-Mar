import * as THREE from 'three/webgpu';
import {
	Fn, uniform, uniformArray, instanceIndex, time, hash, float, vec3, vec4, color, mix, smoothstep, fract, sin, uv, length
} from 'three/tsl';

// Hearth smoke seeping through the thatch (round houses have no chimney):
// one instanced sprite batch, every puff animated in the vertex stage.
export function createSmoke( sources, sunColor ) {
	const PER = 12;
	const src = uniformArray( sources.map( ( v ) => v.clone() ), 'vec3' );
	const wind = uniform( new THREE.Vector3( 5.5, 0, 1.8 ) );
	const tint = uniform( sunColor || new THREE.Color( 1, 0.95, 0.88 ) );

	const mat = new THREE.SpriteNodeMaterial( { transparent: true, depthWrite: false } );
	const house = instanceIndex.div( PER );
	const k = instanceIndex.mod( PER ).toFloat();
	const seed = hash( house.toFloat().mul( 13.1 ) );
	const t = fract( time.mul( 0.035 ).add( k.div( PER ) ).add( seed ) );

	mat.positionNode = Fn( () => {
		const base = src.element( house );
		const rise = t.mul( 17.0 );
		const drift = wind.mul( t.mul( t ).mul( 1.6 ) );
		const wob = vec3( sin( t.mul( 9.0 ).add( seed.mul( 40.0 ) ) ).mul( 0.7 ), 0, sin( t.mul( 7.0 ).add( seed.mul( 21.0 ) ) ).mul( 0.5 ) );
		return base.add( vec3( 0, rise, 0 ) ).add( drift ).add( wob.mul( t ) );
	} )();
	mat.scaleNode = float( 1.0 ).add( t.mul( 6.0 ) );

	const d = length( uv().sub( 0.5 ) ).mul( 2.0 );
	const soft = smoothstep( 0.2, 1.0, d ).oneMinus();
	const life = smoothstep( 0.0, 0.12, t ).mul( t.oneMinus() );
	mat.colorNode = mix( color( 0xd8d4cc ), color( 0x9c9ea4 ), t ).mul( tint );
	mat.opacityNode = soft.mul( life ).mul( 0.33 );

	const sprite = new THREE.Sprite( mat );
	sprite.count = sources.length * PER;
	sprite.frustumCulled = false;
	sprite.renderOrder = 3;
	sprite.name = 'smoke';
	return { mesh: sprite, uniforms: { wind, tint } };
}

export { vec4 };
