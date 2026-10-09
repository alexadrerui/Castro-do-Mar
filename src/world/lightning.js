// Lightning for the storm: a branching bolt from the clouds that reveals top-down and flickers with its
// return strokes, the sky and the land flashing with it, and, near the camera, the impact: a ground
// flash and shockwave ring, glowing cracks in the ground, sparks and shards thrown out, and a camera
// shake; thunder follows at the speed of sound.
// Port of Lightning-VFX (https://github.com/SahilK-027/Lightning-VFX, MIT, Copyright (c) 2026 Sahil K,
// licenses/LICENSE-LightningVFX.md): the fractal bolt path and its branches, the three camera-facing
// ribbon layers revealed by the strike, the crack branches, the spark and shockwave shaders, their
// parameters (scaled to a real strike: a bolt 450-750 m tall). Changes: the GLSL shaders rewritten in
// TSL; fixed buffers and materials built once per slot and refilled at every strike (the original
// built new meshes and shader materials per strike: new pipelines each time); the ribbons keep a
// minimum width in pixels so a bolt kilometres away still reads; the ground pieces lie on our relief;
// sparks and shards are one instanced draw with their motion in the vertex shader (WebGPU has no point
// sizes; the shards' physics ran on the CPU); the screen overlay became the sky and the hemisphere
// light flashing; the shake rotates the camera; the thunder is ours (WebAudio, filtered noise).
// app.lightning: strike( x, z ) (no arguments: somewhere 250 m - 2.5 km away), flash() (in the cloud),
// storm (0..1, strikes when > 0, driven by world/weather.js), sound, paused. QA: tools/lightning.mjs.
import * as THREE from 'three/webgpu';
import {
	attribute, cameraPosition, cross, float, mix, normalize, positionGeometry, smoothstep, uniform, uv, vec3, vec4, max, Fn
} from 'three/tsl';
import { WATER_LEVEL } from './layout.js';
import { motion } from '../core/motion.js';

const SLOTS = 2;
// bolt: up to 8 levels of the main path (257 points) and 7 branches of 6 levels, three layers
const MAIN_DEPTH = 8, ALT_DEPTH = 6, MAX_BRANCHES = 7;
const MAX_SEGS = ( ( 1 << MAIN_DEPTH ) + MAX_BRANCHES * ( 1 << ALT_DEPTH ) ) * 3;
const LAYERS = [ // the original's glow, mid and core, four to six times as thick (and the glow stronger)
	{ color: new THREE.Color( '#4764e1' ), thick: 2.2, alpha: 0.28 },
	{ color: new THREE.Color( '#1072bd' ), thick: 0.65, alpha: 0.6 },
	{ color: new THREE.Color( '#aceeff' ), thick: 0.2, alpha: 1.0 },
];
const P = {
	strikeDur: 0.15, fadeDur: 0.7, spread: 0.01, boltGain: 12,
	heightMin: 450, heightMax: 750, topJitter: 40, roughMin: 0.42, roughMax: 0.58,
	branchMin: 2, branchMax: 7, branchFF: [ 0.12, 0.67 ], branchLen: [ 0.22, 0.54 ], branchDrop: [ 0.55, 0.9 ],
	crackReveal: 0.22, crackFade: 2.8, crackCount: [ 4, 7 ], crackLen: [ 0.6, 5.5 ], crackSteps: [ 5, 9 ],
	sparks: [ 30, 40 ], shards: [ 3, 8 ], sparkGravity: 9.5, shardGravity: 18,
	ringDur: 0.55, flashDur: 0.5, discRadius: 9,
	nearEffects: 400, // m: the ground pieces only for strikes this close
};
const MAX_CRACK_SEGS = 900, MAX_PARTICLES = 64, DISC_N = 24;

const rnd = ( a, b ) => a + Math.random() * ( b - a );
const irnd = ( a, b ) => a + Math.floor( Math.random() * ( b - a + 1 ) );

function fractalPath( start, end, depth, roughness ) {
	if ( depth <= 0 ) return [ start.clone(), end.clone() ];
	const mid = start.clone().lerp( end, 0.45 + Math.random() * 0.1 );
	const dist = start.distanceTo( end );
	mid.x += ( Math.random() - 0.5 ) * dist * roughness;
	mid.z += ( Math.random() - 0.5 ) * dist * roughness;
	const L = fractalPath( start, mid, depth - 1, roughness * 0.88 );
	const R = fractalPath( mid, end, depth - 1, roughness * 0.88 );
	return [ ...L.slice( 0, - 1 ), ...R ];
}

// a quad strip of capacity n segments (4 vertices, 6 indices each)
function stripGeometry( segs, attrs ) {
	const g = new THREE.BufferGeometry();
	for ( const [ name, size ] of attrs ) g.setAttribute( name, new THREE.BufferAttribute( new Float32Array( segs * 4 * size ), size ).setUsage( THREE.DynamicDrawUsage ) );
	const idx = new Uint32Array( segs * 6 );
	for ( let i = 0; i < segs; i ++ ) idx.set( [ i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2 ], i * 6 );
	g.setIndex( new THREE.BufferAttribute( idx, 1 ) );
	g.setDrawRange( 0, 0 );
	g.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e5 );
	return g;
}

function additive( name ) {
	const m = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } );
	m.fog = false; m.name = name;
	return m;
}

class Slot {

	constructor( fx ) {
		this.fx = fx;
		this.group = new THREE.Group();
		this.t = uniform( 99 );     // s since the strike
		this.glow = uniform( 0 );   // the return strokes' flicker (CPU)
		this.origin = uniform( new THREE.Vector3() );
		this.active = false;
		this._bolt(); this._cracks(); this._disc(); this._particles();
		for ( const m of [ this.bolt, this.cracks, this.disc, this.parts ] ) {
			m.frustumCulled = false; m.visible = false; m.layers.set( 1 ); // not in the reflection
			this.group.add( m );
		}
	}

	_bolt() {
		const g = this.boltGeo = stripGeometry( MAX_SEGS, [ [ 'position', 3 ], [ 'dirSide', 4 ], [ 'info', 4 ], [ 'tint', 3 ] ] );
		const m = additive( 'LightningBolt' );
		const ds = attribute( 'dirSide', 'vec4' ), info = attribute( 'info', 'vec4' );
		const fadeT = this.t.sub( P.strikeDur ).div( P.fadeDur ).clamp( 0, 1 );
		const spread = positionGeometry.xz.sub( this.origin.xz ).mul( fadeT.mul( fadeT ) ).mul( P.spread );
		const p = positionGeometry.add( vec3( spread.x, 0, spread.y ) );
		const toCam = cameraPosition.sub( p );
		const tangent = normalize( cross( ds.xyz, normalize( toCam ) ) );
		// the layer's width, or 8 px per metre of it if wider: a bolt at 2 km is a line, not nothing
		const width = max( info.z, toCam.length().mul( this.fx.pixel ).mul( info.z ).mul( 8 ) );
		m.positionNode = p.add( tangent.mul( ds.w ).mul( width ) );
		const strikeT = this.t.div( P.strikeDur ).clamp( 0, 1 );
		const localT = strikeT.sub( info.y ).div( info.y.oneMinus().max( 0.001 ) ).clamp( 0, 1 );
		const reveal = localT.greaterThanEqual( info.x ).select( 1, 0 ); // revealed from the top down
		const edge = smoothstep( 0, 1, ds.w.abs().mul( 2 ).oneMinus() ).pow( 2 ); // soft across the ribbon
		const far = toCam.length().div( - 4000 ).exp();
		m.colorNode = attribute( 'tint', 'vec3' ).mul( P.boltGain );
		m.opacityNode = reveal.mul( fadeT.mul( fadeT ).oneMinus() ).mul( info.w ).mul( this.glow.mul( 0.8 ).add( 0.2 ) ).mul( edge ).mul( far );
		this.bolt = new THREE.Mesh( g, m );
		this.bolt.renderOrder = 4;
	}

	_cracks() {
		const g = this.crackGeo = stripGeometry( MAX_CRACK_SEGS, [ [ 'position', 3 ], [ 'crack', 4 ] ] );
		const m = additive( 'LightningCrack' );
		const c = attribute( 'crack', 'vec4' ); // ratio, side, alpha, fade multiplier
		const t = this.t.sub( P.strikeDur ).max( 0 );
		const revealT = t.div( P.crackReveal ).clamp( 0, 1 );
		const fadeT = t.sub( P.crackReveal ).div( c.w.mul( P.crackFade ) ).clamp( 0, 1 );
		const edge = c.y.abs().oneMinus();
		const core = smoothstep( 0, 0.25, edge ), glow = smoothstep( 0, 0.85, edge );
		m.colorNode = mix( vec3( 0.28, 0.57, 0.88 ), mix( vec3( 0.06, 0.53, 0.74 ), vec3( 0.06, 0.53, 0.76 ), core ), glow ).mul( 3 );
		m.opacityNode = revealT.greaterThanEqual( c.x ).select( 1, 0 ).mul( glow ).mul( fadeT.mul( fadeT ).oneMinus() ).mul( c.z );
		this.cracks = new THREE.Mesh( g, m );
		this.cracks.renderOrder = 3;
	}

	// the ground flash and the shockwave ring on one disc lying on the relief
	_disc() {
		const n = DISC_N, g = new THREE.BufferGeometry();
		const pos = new Float32Array( ( n + 1 ) * ( n + 1 ) * 3 ), uvs = new Float32Array( ( n + 1 ) * ( n + 1 ) * 2 ), idx = [];
		for ( let j = 0; j <= n; j ++ ) for ( let i = 0; i <= n; i ++ ) {
			const k = j * ( n + 1 ) + i;
			uvs[ k * 2 ] = i / n; uvs[ k * 2 + 1 ] = j / n;
			if ( i < n && j < n ) idx.push( k, k + n + 1, k + 1, k + 1, k + n + 1, k + n + 2 );
		}
		g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		g.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
		g.setIndex( idx );
		g.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e5 );
		this.discGeo = g;
		const m = additive( 'LightningDisc' );
		const r = uv().sub( 0.5 ).length().mul( 2 );
		const tf = this.t.sub( P.strikeDur ).add( 0.13 ).div( P.flashDur ).clamp( 0, 1 );
		const flash = r.oneMinus().max( 0 ).pow( 2.2 ).mul( tf.oneMinus().pow( 1.6 ) ).mul( 1.2 );
		const tr = this.t.sub( P.strikeDur ).div( P.ringDur ).clamp( 0, 1 );
		const ring = smoothstep( 0, 0.12, r.sub( tr ).abs() ).oneMinus().mul( tr.oneMinus().pow( 2 ) ).mul( 0.4 );
		const flashCol = vec3( 0.45, 0.62, 1.0 ).mul( 4 );
		const ringCol = mix( vec3( 1.0, 0.69, 0.38 ), vec3( 0.4, 0.7, 1.0 ), tr ).mul( 3 );
		m.colorNode = flashCol.mul( flash ).add( ringCol.mul( ring ) ).div( flash.add( ring ).max( 1e-4 ) );
		m.opacityNode = flash.add( ring ).mul( this.t.lessThan( P.strikeDur - 0.13 ).select( 0, 1 ) );
		this.disc = new THREE.Mesh( g, m );
		this.disc.renderOrder = 3;
	}

	// sparks (kind 0) and shards (kind 1): camera-facing quads thrown from the impact
	_particles() {
		const quad = new THREE.PlaneGeometry( 1, 1 );
		const g = this.partGeo = new THREE.InstancedBufferGeometry();
		g.index = quad.index;
		g.setAttribute( 'position', quad.attributes.position );
		g.setAttribute( 'uv', quad.attributes.uv );
		for ( const name of [ 'pA', 'pV', 'pS' ] ) g.setAttribute( name, new THREE.InstancedBufferAttribute( new Float32Array( MAX_PARTICLES * 4 ), 4 ).setUsage( THREE.DynamicDrawUsage ) );
		g.instanceCount = 0;
		const m = additive( 'LightningSparks' );
		const pA = attribute( 'pA', 'vec4' ), pV = attribute( 'pV', 'vec4' ), pS = attribute( 'pS', 'vec4' ); // x y z life | v kind | size, seed, spin
		const shard = pV.w;
		const t = this.t.sub( P.strikeDur ).max( 0 );
		const age = t.div( pA.w ).clamp( 0, 1.5 );
		const grav = mix( float( P.sparkGravity ), float( P.shardGravity * 0.5 ), shard );
		const q = pA.xyz.add( pV.xyz.mul( t ) ).sub( vec3( 0, grav.mul( t ).mul( t ), 0 ) );
		const p = vec3( q.x, q.y.max( pA.y.sub( 0.08 ) ), q.z );
		// spark: shrinks with age; shard: spins in the view plane and tumbles (squashed)
		const ang = pS.w.mul( t ).add( pS.z.mul( 6.283 ) );
		const ca = ang.cos(), sa = ang.sin();
		const tumble = mix( float( 1 ), pS.w.mul( 0.7 ).mul( t ).add( pS.z.mul( 3 ) ).cos().abs().max( 0.15 ), shard );
		const lx = positionGeometry.x.mul( pS.x ), ly = positionGeometry.y.mul( pS.y ).mul( tumble );
		const rx = mix( lx, lx.mul( ca ).sub( ly.mul( sa ) ), shard ), ry = mix( ly, lx.mul( sa ).add( ly.mul( ca ) ), shard );
		const size = mix( age.mul( 0.8 ).oneMinus().max( 0 ), float( 1 ), shard );
		m.positionNode = p.add( this.fx.camRight.mul( rx.mul( size ) ) ).add( this.fx.camUp.mul( ry.mul( size ) ) );
		const r = uv().sub( 0.5 ).length();
		const core = r.mul( 5 ).oneMinus().max( 0 ), glow = r.mul( 2.2 ).oneMinus().max( 0 );
		const sparkCol = mix( vec3( 0.7, 0.1, 0 ), mix( vec3( 1, 0.42, 0.05 ), vec3( 1, 0.92, 0.55 ), core ), glow ).mul( 4 );
		const sparkA = core.add( glow.mul( 0.45 ) ).mul( age.mul( age ).oneMinus().max( 0 ) ).mul( r.lessThan( 0.5 ).select( 1, 0 ) );
		const shardA = age.pow( 2 ).oneMinus().max( 0 ).mul( 0.85 );
		const shardCol = Fn( () => {
			const s = pS.z;
			return s.lessThan( 0.65 ).select( mix( vec3( 0.35, 0.5, 1.0 ), vec3( 0.65, 0.78, 1.0 ), s.div( 0.65 ) ), vec3( 0.45, 0.4, 0.38 ) ).mul( 2.5 );
		} )();
		m.colorNode = mix( sparkCol, shardCol, shard );
		m.opacityNode = mix( sparkA, shardA, shard ).mul( t.greaterThan( 0 ).select( 1, 0 ) );
		this.parts = new THREE.Mesh( g, m );
		this.parts.renderOrder = 5;
	}

	// fills the buffers for a strike at ground point (x, gy, z); near: the ground pieces too
	fill( x, gy, z, near, onWater ) {
		this.origin.value.set( x, gy, z );
		const height = rnd( P.heightMin, P.heightMax ), rough = rnd( P.roughMin, P.roughMax );
		const top = new THREE.Vector3( x + ( Math.random() - 0.5 ) * P.topJitter, gy + height, z + ( Math.random() - 0.5 ) * P.topJitter );
		const main = fractalPath( top, new THREE.Vector3( x, gy, z ), MAIN_DEPTH, rough );
		const strands = [ { pts: main, off: 0, thick: 1.5, alpha: 1 } ];
		const bc = irnd( P.branchMin, P.branchMax );
		for ( let b = 0; b < bc; b ++ ) {
			const ff = rnd( ...P.branchFF ), fp = main[ Math.floor( ff * ( main.length - 1 ) ) ].clone();
			const ba = Math.random() * Math.PI * 2, bl = ( 1 - ff ) * height * rnd( ...P.branchLen );
			const be = fp.clone();
			be.x += Math.cos( ba ) * bl * 0.65; be.z += Math.sin( ba ) * bl * 0.45;
			be.y = Math.max( be.y - bl * rnd( ...P.branchDrop ), gy + 5 + Math.random() * 30 );
			strands.push( { pts: fractalPath( fp, be, ALT_DEPTH, rough * 0.85 ), off: ff, thick: 0.55, alpha: 0.75 } );
		}
		const a = this.boltGeo.attributes, pos = a.position.array, ds = a.dirSide.array, info = a.info.array, tint = a.tint.array;
		const dir = new THREE.Vector3();
		let s = 0;
		for ( const st of strands ) for ( const L of LAYERS ) {
			const n = st.pts.length - 1;
			for ( let i = 0; i < n && s < MAX_SEGS; i ++, s ++ ) {
				const pa = st.pts[ i ], pb = st.pts[ i + 1 ];
				dir.subVectors( pb, pa ).normalize();
				const v = [ [ pa, i / n, - 0.5 ], [ pa, i / n, 0.5 ], [ pb, ( i + 1 ) / n, - 0.5 ], [ pb, ( i + 1 ) / n, 0.5 ] ];
				for ( let j = 0; j < 4; j ++ ) {
					const k = s * 4 + j, [ p, r, side ] = v[ j ];
					pos.set( [ p.x, p.y, p.z ], k * 3 );
					ds.set( [ dir.x, dir.y, dir.z, side ], k * 4 );
					info.set( [ r, st.off, L.thick * st.thick, L.alpha * st.alpha ], k * 4 );
					tint.set( [ L.color.r, L.color.g, L.color.b ], k * 3 );
				}
			}
		}
		for ( const k of [ 'position', 'dirSide', 'info', 'tint' ] ) { a[ k ].clearUpdateRanges(); a[ k ].addUpdateRange( 0, s * 4 * a[ k ].itemSize ); a[ k ].needsUpdate = true; }
		this.boltGeo.setDrawRange( 0, s * 6 );
		this.bolt.visible = true;
		this.cracks.visible = this.disc.visible = this.parts.visible = near;
		if ( ! near ) return;
		this._fillDisc( x, gy, z, onWater );
		if ( onWater ) { this.crackGeo.setDrawRange( 0, 0 ); this.cracks.visible = false; } else this._fillCracks( x, gy, z );
		this._fillParticles( x, gy, z, onWater );
	}

	_ground( x, z ) { return Math.max( this.fx.heightAt( x, z ), WATER_LEVEL ); }

	_fillDisc( x, gy, z, onWater ) {
		const n = DISC_N, R = P.discRadius, pos = this.discGeo.attributes.position;
		for ( let j = 0; j <= n; j ++ ) for ( let i = 0; i <= n; i ++ ) {
			const px = x + ( i / n - 0.5 ) * 2 * R, pz = z + ( j / n - 0.5 ) * 2 * R;
			pos.setXYZ( j * ( n + 1 ) + i, px, ( onWater ? WATER_LEVEL : this._ground( px, pz ) ) + 0.12, pz );
		}
		pos.needsUpdate = true;
	}

	_fillCracks( x, gy, z ) {
		const lines = [];
		const branch = ( o, angle, len, depth, rough ) => {
			const steps = irnd( ...P.crackSteps ), pts = [ o.clone() ];
			let cx = o.x, cz = o.z;
			for ( let i = 0; i < steps; i ++ ) {
				angle += ( Math.random() - 0.5 ) * rough;
				const st = ( len / steps ) * ( 0.6 + Math.random() * 0.8 );
				cx += Math.cos( angle ) * st; cz += Math.sin( angle ) * st;
				pts.push( new THREE.Vector3( cx, 0, cz ) );
			}
			lines.push( pts );
			if ( depth > 0 && Math.random() < 0.72 ) {
				const fi = 1 + Math.floor( Math.random() * ( pts.length - 2 ) );
				branch( pts[ fi ], angle + ( Math.random() > 0.5 ? 1 : - 1 ) * rnd( 0.55, 1.45 ), len * rnd( 0.3, 0.7 ), depth - 1, rough * 0.9 );
			}
		};
		const n = irnd( ...P.crackCount );
		for ( let m = 0; m < n; m ++ ) branch( new THREE.Vector3( x, 0, z ), ( m / n ) * Math.PI * 2 + ( Math.random() - 0.5 ) * 0.8, rnd( ...P.crackLen ), 2, 0.725 );
		const a = this.crackGeo.attributes, pos = a.position.array, cr = a.crack.array;
		let s = 0;
		// a glow pass (thin, dimmer, slower) and a core pass (wide, full, faster), as the original
		for ( const pts of lines ) for ( const [ hw, alpha, fade ] of [ [ 0.04, 0.55, 1 ], [ 0.12, 1, 0.6 ] ] ) {
			const n2 = pts.length - 1;
			for ( let i = 0; i < n2 && s < MAX_CRACK_SEGS; i ++, s ++ ) {
				const pa = pts[ i ], pb = pts[ i + 1 ];
				const dx = pb.x - pa.x, dz = pb.z - pa.z, l = Math.hypot( dx, dz ) || 1;
				const px = - dz / l * hw, pz = dx / l * hw;
				const v = [ [ pa, i / n2, - 1 ], [ pa, i / n2, 1 ], [ pb, ( i + 1 ) / n2, - 1 ], [ pb, ( i + 1 ) / n2, 1 ] ];
				for ( let j = 0; j < 4; j ++ ) {
					const k = s * 4 + j, [ p, r, side ] = v[ j ];
					const vx = p.x + px * side, vz = p.z + pz * side;
					pos.set( [ vx, this._ground( vx, vz ) + 0.05, vz ], k * 3 );
					cr.set( [ r, side, alpha, fade ], k * 4 );
				}
			}
		}
		for ( const k of [ 'position', 'crack' ] ) { a[ k ].clearUpdateRanges(); a[ k ].addUpdateRange( 0, s * 4 * a[ k ].itemSize ); a[ k ].needsUpdate = true; }
		this.crackGeo.setDrawRange( 0, s * 6 );
	}

	_fillParticles( x, gy, z, onWater ) {
		const a = this.partGeo.attributes, A = a.pA.array, V = a.pV.array, S = a.pS.array;
		const ns = irnd( ...P.sparks ), nd = onWater ? 0 : irnd( ...P.shards );
		const n = Math.min( MAX_PARTICLES, ns + nd );
		for ( let i = 0; i < n; i ++ ) {
			const shard = i >= ns, ang = Math.random() * Math.PI * 2;
			const spd = shard ? rnd( 1, 3.5 ) : rnd( 1, 6 ), up = shard ? rnd( 1, 4 ) : rnd( 1, 7 );
			const px = x + ( Math.random() - 0.5 ) * 0.3, pz = z + ( Math.random() - 0.5 ) * 0.3;
			A.set( [ px, gy + ( shard ? 0.15 : 0.1 ), pz, shard ? rnd( 1, 2.2 ) : rnd( 0.3, 1.3 ) ], i * 4 );
			V.set( [ Math.cos( ang ) * spd, up, Math.sin( ang ) * spd, shard ? 1 : 0 ], i * 4 );
			S.set( shard ? [ rnd( 0.08, 0.33 ), rnd( 0.04, 0.16 ), Math.random(), ( Math.random() - 0.5 ) * 8 ] : [ 0.4, 0.4, Math.random(), 0 ], i * 4 );
		}
		for ( const k of [ 'pA', 'pV', 'pS' ] ) a[ k ].needsUpdate = true;
		this.partGeo.instanceCount = n;
	}

	hide() { for ( const m of this.group.children ) m.visible = false; this.active = false; }
}

export class Lightning {

	// scene; camera; heightAt( x, z ); sky (world/sky.js: hemi, gain); renderer (for the warm-up)
	constructor( { scene, camera, heightAt, sky } ) {
		this.scene = scene; this.camera = camera; this.heightAt = heightAt; this.sky = sky;
		this.pixel = uniform( 0.001 );                  // 2 tan( fov / 2 ) / screen height
		this.camRight = uniform( new THREE.Vector3( 1, 0, 0 ) );
		this.camUp = uniform( new THREE.Vector3( 0, 1, 0 ) );
		this.group = new THREE.Group();
		this.group.name = 'lightning';
		scene.add( this.group );
		this.slots = [];
		this.events = [];   // flashes: { t, strokes: [ [ at, amp ] ], scale }
		this.storm = 0;     // 0..1: strikes now and then (world/weather.js)
		this.nextStrike = 4;
		this.sound = true;
		this.volume = 1; // the panel's volume (core/settings.js)
		this.output = null; // () => { ctx, destination }: the ambience's bus (audio/ambience.js), else its own context
		this.shake = 0; this.shakeDecay = 7.5;
		this.flashing = false;
		this.count = 0;
		this.paused = false; // QA: the strikes' clocks stand still (tools/lightning.mjs)
	}

	_slots() {
		// built at the first strike or warm-up: no pipelines at load
		if ( ! this.slots.length ) for ( let i = 0; i < SLOTS; i ++ ) { const s = new Slot( this ); this.slots.push( s ); this.group.add( s.group ); }
		return this.slots;
	}

	// draws every piece once, invisible (t far past its end), so the storm's first strike does not stall
	warm() {
		if ( this.slots.length ) return;
		for ( const s of this._slots() ) {
			s.t.value = 99;
			s.boltGeo.setDrawRange( 0, 6 ); s.crackGeo.setDrawRange( 0, 6 ); s.partGeo.instanceCount = 1;
			for ( const m of s.group.children ) m.visible = true;
			s.warming = 2; // frames
		}
	}

	// a bolt to the ground at (x, z); without arguments, somewhere 250 m - 2.5 km from the camera
	strike( x, z ) {
		const cam = this.camera.position;
		if ( x === undefined ) {
			const d = 250 + Math.pow( Math.random(), 0.7 ) * 2250, a = Math.random() * Math.PI * 2;
			x = cam.x + Math.cos( a ) * d; z = cam.z + Math.sin( a ) * d;
		}
		const h = this.heightAt( x, z ), onWater = h < WATER_LEVEL, gy = Math.max( h, WATER_LEVEL );
		const slots = this._slots();
		const slot = slots.find( ( s ) => ! s.active ) || slots.reduce( ( a, b ) => ( a.t.value > b.t.value ? a : b ) );
		slot.hide();
		const dist = Math.hypot( x - cam.x, z - cam.z );
		slot.fill( x, gy, z, dist < P.nearEffects, onWater );
		slot.t.value = 0; slot.active = true; slot.warming = 0;
		slot.event = this._flash( 1 / ( 1 + dist / 1500 ) );
		this.count ++;
		if ( dist < 250 && ! motion.reduced ) this.shake = Math.max( this.shake, 0.014 * Math.pow( 1 - dist / 250, 2 ) + 0.002 );
		this._thunder( dist );
		return { x, z, dist: Math.round( dist ) };
	}

	// a flash inside the clouds (no bolt), or the sky flash of a strike: scale 0..1
	flash( scale = 0.45 ) { const e = this._flash( scale ); this._thunder( 1500 + Math.random() * 3000, 0.6 ); return e; }

	_flash( scale ) {
		// the leader, the return stroke at strikeDur and 1-3 restrokes
		const strokes = [ [ 0, 0.25 ], [ P.strikeDur, 1 ] ];
		let at = P.strikeDur;
		for ( let k = irnd( 1, 3 ); k > 0; k -- ) { at += rnd( 0.04, 0.22 ); strokes.push( [ at, rnd( 0.45, 1 ) ] ); }
		const e = { t: 0, strokes, scale };
		this.events.push( e );
		return e;
	}

	static glowAt( e ) {
		let g = 0;
		for ( const [ at, amp ] of e.strokes ) if ( e.t >= at ) g = Math.max( g, amp * Math.exp( - ( e.t - at ) * ( at === 0 ? 30 : 11 ) ) );
		return g;
	}

	_thunder( dist, gain = 1 ) {
		if ( ! this.sound || this.volume <= 0 || typeof AudioContext === 'undefined' ) return;
		try {
			const out = this.output?.();
			const ctx = out?.ctx ?? ( this.audio || ( this.audio = new AudioContext() ) );
			if ( ! out && ctx.state === 'suspended' ) ctx.resume();
			const dur = 3 + Math.min( 5, dist / 600 ), sr = ctx.sampleRate;
			const buf = ctx.createBuffer( 1, Math.floor( dur * sr ), sr ), d = buf.getChannelData( 0 );
			// brown noise under an envelope: a crack when close, then rolling rumbles
			let last = 0;
			const bumps = [];
			for ( let k = irnd( 3, 6 ); k > 0; k -- ) bumps.push( [ Math.random() * dur * 0.6, rnd( 0.4, 1 ), rnd( 0.4, 1.2 ) ] );
			const crack = Math.max( 0, 1 - dist / 800 );
			for ( let i = 0; i < d.length; i ++ ) {
				const t = i / sr, w = Math.random() * 2 - 1;
				last = ( last + 0.02 * w ) / 1.02;
				let env = Math.exp( - t * 1.2 ) * 0.5;
				for ( const [ at, a, len ] of bumps ) if ( t > at ) env += a * Math.exp( - ( t - at ) / len ) * Math.min( 1, ( t - at ) * 20 );
				d[ i ] = last * 3.5 * env + w * crack * Math.exp( - t * 9 ) * 0.5;
			}
			const src = ctx.createBufferSource(); src.buffer = buf;
			const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 / ( 1 + dist / 700 ) + 120;
			const g = ctx.createGain(); g.gain.value = 0.9 * gain * this.volume / ( 1 + dist / 500 );
			src.connect( lp ).connect( g ).connect( out?.destination ?? ctx.destination );
			src.start( ctx.currentTime + dist / 343 );
		} catch ( err ) { /* no audio */ }
	}

	update( dt, renderer ) {
		const cam = this.camera;
		if ( this.paused ) dt = 0;
		this.pixel.value = 2 * Math.tan( THREE.MathUtils.degToRad( cam.fov ) / 2 ) / Math.max( 1, renderer?.domElement.height || innerHeight );
		this.camRight.value.setFromMatrixColumn( cam.matrixWorld, 0 );
		this.camUp.value.setFromMatrixColumn( cam.matrixWorld, 1 );
		// the storm: a strike every 5-25 s at full rain, rarer at its edge; a third flash in the clouds
		if ( this.storm > 0 ) {
			this.nextStrike -= dt * this.storm;
			if ( this.nextStrike <= 0 ) {
				this.nextStrike = rnd( 5, 25 );
				if ( Math.random() < 0.33 ) this.flash(); else this.strike();
			}
		}
		// the flicker and the sky / hemisphere flash
		let f = 0;
		for ( let i = this.events.length - 1; i >= 0; i -- ) {
			const e = this.events[ i ];
			e.t += dt;
			e.glow = Lightning.glowAt( e );
			f += e.glow * e.scale;
			if ( e.t > 2 ) this.events.splice( i, 1 );
		}
		const sky = this.sky;
		if ( f > 1e-3 ) {
			if ( ! this.flashing ) { this.flashing = true; this.base = { hemi: sky.hemi.intensity, gain: sky.gain.value }; }
			sky.hemi.intensity = this.base.hemi + 2.4 * f;
			sky.gain.value = this.base.gain * ( 1 + 2.5 * f );
		} else if ( this.flashing ) {
			this.flashing = false;
			sky.hemi.intensity = this.base.hemi; sky.gain.value = this.base.gain;
		}
		for ( const s of this.slots ) {
			if ( s.warming > 0 && -- s.warming === 0 ) s.hide();
			if ( ! s.active ) continue;
			s.t.value += dt;
			s.glow.value = s.event ? s.event.glow ?? 0 : 0;
			if ( s.t.value > P.strikeDur + P.crackReveal + P.crackFade + 0.5 ) s.hide();
			else if ( s.t.value > P.strikeDur + P.fadeDur + 0.15 ) s.bolt.visible = false;
		}
		// the shake: small rotations, decaying (the free camera rebuilds its rotation every frame)
		if ( this.shake > 1e-4 ) {
			cam.rotateX( ( Math.random() - 0.5 ) * this.shake );
			cam.rotateY( ( Math.random() - 0.5 ) * this.shake );
			this.shake *= Math.exp( - dt * this.shakeDecay );
		}
	}
}
