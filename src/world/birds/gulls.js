import * as THREE from 'three/webgpu';
import {
	Fn, attribute, uniform, normalLocal, positionGeometry, normalGeometry,
	vec2, vec3, float, sin, cos, abs, sign, mix, select, smoothstep, length, color, mx_noise_float
} from 'three/tsl';
import { SPECIES, BIRD, buildBird, wingJoints } from './shapes.js';

// Yellow-legged gulls (Larus michahellis, the common gull of the Galician coast) soaring over the
// bay. The flight follows Tidewater's Gulls.js (MIT, https://github.com/dgreenheck/tidewater):
// every bird circles its own thermal, banks into the turn and alternates gliding (wings in the
// gull's "M": arm raised, hand drooping) with bursts of wing beats. The body is Tidewater's gull
// template (shapes.js) scaled up to a 1.4 m wingspan, its three-bone wings flapped here with
// rolls about the body axis at the shoulder, elbow and wrist. Everything is animated in the
// vertex shader from time and per-instance parameters: no CPU work per frame (update() only
// advances the clock; paused = true freezes the flight for QA, see tools/gulls.mjs).

const GULL = SPECIES[ BIRD.GULL ];
// plumage colours are given in sRGB (as picked from photos) and converted to linear
const srgb = ( r, g, b ) => color( new THREE.Color().setRGB( r, g, b, THREE.SRGBColorSpace ) );
const SCALE = 1.36; // laughing gull template (1.03 m span) -> yellow-legged gull (~1.4 m)

export class Gulls {

	// hf: heightfield (the birds circle above the highest ground under their circle)
	constructor( { hf, waterLevel = 0, count = 26, center = new THREE.Vector2( 95, - 30 ), size = new THREE.Vector2( 300, 240 ), seed = 7 } ) {

		let s = seed >>> 0;
		const rand = () => ( ( s = Math.imul( s ^ ( s >>> 15 ), 2246822519 ) + 0x6D2B79F5 >>> 0 ) / 4294967296 );

		const geo = gullGeometry();
		// per instance: gA (cx, cz, radius, height)  gB (phase, speed, flap seed, turn direction)
		const a = new Float32Array( count * 4 ), b = new Float32Array( count * 4 ), c = new Float32Array( count );
		for ( let i = 0; i < count; i ++ ) {

			const cx = center.x + ( rand() - 0.5 ) * size.x, cz = center.y + ( rand() - 0.5 ) * size.y;
			const R = 14 + rand() * 38;
			let ground = waterLevel;
			for ( let k = 0; k < 16; k ++ ) {

				const t = k / 16 * Math.PI * 2;
				ground = Math.max( ground, hf.heightAt( cx + Math.cos( t ) * R, cz + Math.sin( t ) * R ) );

			}
			a.set( [ cx, cz, R, ground + 10 + rand() * 32 ], i * 4 );
			b.set( [ rand() * Math.PI * 2, 8 + rand() * 4, rand() * 100, rand() < 0.5 ? - 1 : 1 ], i * 4 );
			c[ i ] = SCALE * ( 0.92 + rand() * 0.16 );

		}
		geo.setAttribute( 'gA', new THREE.InstancedBufferAttribute( a, 4 ) );
		geo.setAttribute( 'gB', new THREE.InstancedBufferAttribute( b, 4 ) );
		geo.setAttribute( 'gS', new THREE.InstancedBufferAttribute( c, 1 ) );
		geo.instanceCount = count;

		this.time = uniform( 0 );
		this.paused = false;
		const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.72, metalness: 0 } );
		mat.name = 'Gull';
		const gA = attribute( 'gA', 'vec4' ), gB = attribute( 'gB', 'vec4' ), gS = attribute( 'gS', 'float' );
		const info = attribute( 'bInfo', 'vec4' ); // part, blend weight, u, v

		// wing joints of the left wing (+x); the right wing mirrors them
		const J = wingJoints( GULL );
		const S = vec2( J.S[ 0 ], J.S[ 1 ] ), E = vec2( J.E[ 0 ], J.E[ 1 ] ), W = vec2( J.W[ 0 ], J.W[ 1 ] );
		const rot = ( v, a ) => vec2( v.x.mul( cos( a ) ).sub( v.y.mul( sin( a ) ) ), v.x.mul( sin( a ) ).add( v.y.mul( cos( a ) ) ) );

		mat.positionNode = Fn( () => {

			const t = this.time;
			const R = gA.z, dir = gB.w;
			const th = gB.x.add( t.mul( gB.y ).div( R ).mul( dir ) );
			const centre = vec3( gA.x.add( cos( th ).mul( R ) ), gA.w.add( sin( th.mul( 2 ).add( gB.z ) ).mul( 3 ) ), gA.y.add( sin( th ).mul( R ) ) );
			const fwd = vec3( sin( th ).negate().mul( dir ), 0, cos( th ).mul( dir ) );
			const bank = dir.mul( - 0.45 );

			// flapping bursts: a slow gate turns the wing beats (~3 Hz) on and off; gliding otherwise
			const gate = smoothstep( 0.55, 0.8, sin( t.mul( 0.23 ).add( gB.z ) ).mul( 0.5 ).add( 0.5 ) );
			const ph = t.mul( 3.1 * 2 * Math.PI ).add( gB.z.mul( 7 ) );
			const beat = sin( ph ), lag = sin( ph.sub( 0.9 ) );
			// shoulder, elbow, wrist rolls (radians, + = up): the glide "M" (arm up, hand down)
			// blends into the beat, the hand lagging behind the arm
			const a1 = mix( float( 0.14 ), beat.mul( 0.62 ).add( 0.08 ), gate );
			const a2 = mix( float( - 0.06 ), lag.mul( 0.22 ), gate );
			const a3 = mix( float( - 0.3 ), lag.mul( 0.45 ).sub( 0.05 ), gate );

			const part = info.x, w = info.y;
			const side = sign( positionGeometry.x );
			const P = positionGeometry.toVar(), N = normalGeometry.toVar();
			const isWing = part.greaterThan( 4.5 ).and( part.lessThan( 7.5 ) );
			// wing chain in the (x, y) plane of the left wing (the right wing is mirrored in x)
			const q = vec2( P.x.mul( side ), P.y ), n = vec2( N.x.mul( side ), N.y );
			const Ep = S.add( rot( E.sub( S ), a1 ) );
			const Wp = Ep.add( rot( W.sub( E ), a1.add( a2 ) ) );
			const pa = S.add( rot( q.sub( S ), a1 ) );
			const pb = Ep.add( rot( q.sub( E ), a1.add( a2 ) ) );
			const pc = Wp.add( rot( q.sub( W ), a1.add( a2 ).add( a3 ) ) );
			const seg = part.sub( 5 );
			const pw = select( seg.lessThan( 0.5 ), pa, select( seg.lessThan( 1.5 ), mix( pb, pa, w ), mix( pc, pb, w ) ) );
			const na = rot( n, a1 ), nb = rot( n, a1.add( a2 ) ), nc = rot( n, a1.add( a2 ).add( a3 ) );
			const nw = select( seg.lessThan( 0.5 ), na, select( seg.lessThan( 1.5 ), mix( nb, na, w ), mix( nc, nb, w ) ) );
			P.assign( select( isWing, vec3( pw.x.mul( side ), pw.y, P.z ), P ) );
			N.assign( select( isWing, vec3( nw.x.mul( side ), nw.y, N.z ), N ) );

			// bank (roll about the flight axis), then orient along the flight direction
			const cb = cos( bank ), sb = sin( bank );
			const roll = ( v ) => vec3( v.x.mul( cb ).sub( v.y.mul( sb ) ), v.x.mul( sb ).add( v.y.mul( cb ) ), v.z );
			const r = vec3( fwd.z, 0, fwd.x.negate() );
			const toWorld = ( v ) => r.mul( v.x ).add( vec3( 0, v.y, 0 ) ).add( fwd.mul( v.z ) );
			normalLocal.assign( toWorld( roll( N ) ) );
			return centre.add( toWorld( roll( P.mul( gS ) ) ) );

		} )();

		// ---- plumage (adult yellow-legged gull), in the rest frame of the template
		// (smoothstep edges always ascending: Tidewater's reversed ones are undefined in WGSL)
		mat.colorNode = Fn( () => {

			const part = info.x.add( 0.5 ).floor(), u = info.z, v = abs( info.w );
			const P = positionGeometry, N = normalGeometry;
			const isBill = part.equal( 3 ), isTail = part.equal( 4 ), isWing = part.greaterThan( 4.5 ).and( part.lessThan( 7.5 ) );
			const top = N.y.greaterThan( 0 );
			const white = srgb( 0.93, 0.93, 0.92 ), grey = srgb( 0.45, 0.48, 0.52 ), black = srgb( 0.05, 0.05, 0.055 );
			// mantle: the back between the wings
			const mantle = smoothstep( 0.1, 0.45, N.y ).mul( smoothstep( - 0.1, - 0.07, P.z ) ).mul( smoothstep( 0.075, 0.1, P.z ).oneMinus() );
			const body = mix( white, grey, mantle );
			// upperwing: grey, white trailing edge, black primaries with a white mirror near the tip
			const tipK = smoothstep( 0.66, 0.74, u ).toVar();
			const edge = smoothstep( 0.93, 0.99, v ).mul( tipK.oneMinus() );
			const mirror = smoothstep( 0.02, 0.035, length( vec2( u.sub( 0.93 ), v.sub( 0.35 ).mul( 0.5 ) ) ) ).oneMinus();
			const wingTop = mix( mix( mix( grey, white, edge ), black, tipK ), white, mirror );
			const wingBot = mix( mix( white, srgb( 0.78, 0.79, 0.8 ), smoothstep( 0.4, 0.9, u ).mul( 0.5 ) ), black, smoothstep( 0.82, 0.92, u ).mul( mirror.oneMinus() ) );
			let c = select( isWing, select( top, wingTop, wingBot ), select( isTail, white, body ) );
			// bill: yellow with the red gonys spot near the tip of the lower mandible
			const b = GULL.bill;
			const spot = smoothstep( b.z + b.len * 0.62, b.z + b.len * 0.72, P.z ).mul( smoothstep( b.y - 0.004, b.y + 0.002, P.y ).oneMinus() );
			c = select( isBill, mix( srgb( 0.93, 0.78, 0.18 ), srgb( 0.8, 0.12, 0.08 ), spot ), c );
			// eye: pale yellow iris, dark pupil
			const e = GULL.eye;
			const ed = length( vec2( P.z.sub( e[ 0 ] ), P.y.sub( e[ 1 ] ) ) );
			const onHead = part.lessThan( 2.5 ).and( abs( P.x ).greaterThan( 0.004 ) );
			const iris = smoothstep( e[ 2 ] * 0.8, e[ 2 ], ed ).oneMinus().mul( select( onHead, 1, 0 ) );
			const pupil = smoothstep( e[ 2 ] * 0.4, e[ 2 ] * 0.55, ed ).oneMinus().mul( select( onHead, 1, 0 ) );
			c = mix( mix( c, srgb( 0.85, 0.75, 0.3 ), iris ), srgb( 0.01, 0.01, 0.01 ), pupil );
			// fine feather texture
			return c.mul( mx_noise_float( P.mul( 160 ) ).mul( 0.06 ).add( 1 ) );

		} )();

		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.name = 'gulls';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.layers.enable( 2 ); // seen in the water reflection
		this.count = count;

	}

	update( dt ) {

		if ( ! this.paused ) this.time.value += dt;

	}

}

// The gull template in flight posture, without the legs (tucked in flight).
function gullGeometry() {

	const B = buildBird( GULL );
	const keep = new Int32Array( B.count ).fill( - 1 );
	const pos = [], nrm = [], info = [];
	for ( let i = 0; i < B.count; i ++ ) {

		if ( B.A[ i * 4 + 3 ] === 8 ) continue; // leg
		keep[ i ] = pos.length / 3;
		pos.push( B.A[ i * 4 ], B.A[ i * 4 + 1 ], B.A[ i * 4 + 2 ] );
		nrm.push( B.B[ i * 4 ], B.B[ i * 4 + 1 ], B.B[ i * 4 + 2 ] );
		info.push( B.A[ i * 4 + 3 ], B.B[ i * 4 + 3 ], B.C[ i * 4 + 3 ], B.D[ i * 4 + 3 ] );

	}
	const idx = [];
	for ( let k = 0; k < B.index.length; k += 3 ) {

		const a = keep[ B.index[ k ] ], b = keep[ B.index[ k + 1 ] ], c = keep[ B.index[ k + 2 ] ];
		if ( a >= 0 && b >= 0 && c >= 0 ) idx.push( a, b, c );

	}
	const g = new THREE.InstancedBufferGeometry();
	g.setIndex( idx );
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( nrm, 3 ) );
	g.setAttribute( 'bInfo', new THREE.Float32BufferAttribute( info, 4 ) );
	return g;

}
