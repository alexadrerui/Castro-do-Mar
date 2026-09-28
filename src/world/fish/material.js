// Adapted from Tidewater (https://github.com/dgreenheck/tidewater, src/world/fish/FishMaterial.js,
// three.js version at d32799f). MIT License, Copyright (c) 2026 DRG Software Solutions LLC.
// Changes: swimming fish only (no market props: no dead pose, flesh, ice, leaves), no turtle,
// no LOD cross-fade and no motion vectors (no TAA here), translucency as an emissive term, and
// the markings of the Galician coast species (species.js).
import * as THREE from 'three/webgpu';
import {
	Fn, If, float, vec2, vec3, vec4, attribute, positionLocal, normalLocal, positionView, varyingProperty,
	sin, mix, smoothstep, abs, fract, floor, length, max, select, uniformArray, int, fwidth, dot,
	normalView, positionViewDirection, sign, clamp, pow, atan, step, saturate, normalWorldGeometry, faceDirection,
} from 'three/tsl';
import { rotateQ, bumpNormal } from '../seabed/materials.js';
import { SPECIES, SKIN, PATTERN } from './species.js';
import { PART } from './geometry.js';

// The fish material (TSL). Everything is procedural: a per-species table of colours and anatomy
// landmarks (eye, gill cover, lateral line, jaw hinge) and the species' markings in the fragment
// stage. Body skin: counter-shading from the dark back to the pale belly, overlapping scales in
// rows (colour and relief, faded out when smaller than a pixel), the lateral line, the edge of
// the gill cover, silvery guanine reflection with an iridescent sheen, wet specular. Fins:
// ray-striped membranes, darker and thinner toward the edge, lit through from behind. Eyes:
// pupil, iris with radial streaks and a glossy cornea (a dome at the nearest level of detail,
// painted further away). The vertex stage poses the model: a travelling swimming wave with
// pectoral sculling; the ray's disc margins undulate.

const aData = attribute( 'aData', 'vec4' );
const ROWS = 8; // vec4 rows per species in the table

// species order = pattern ids
const NAMES = Object.keys( PATTERN ).sort( ( a, b ) => PATTERN[ a ] - PATTERN[ b ] );

function buildTable() {

	const rows = [];
	const lin = ( hex ) => new THREE.Color( hex );
	for ( const name of NAMES ) {

		const S = SPECIES[ name ], K = SKIN[ name ];
		const b = lin( K.back ), f = lin( K.flank ), be = lin( K.belly ), fi = lin( K.fin ), e = lin( K.edge ), ir = lin( S.iris );
		const L = S.body;
		rows.push(
			// guanine reflection: a metal-like specular layer, kept moderate so that silvery fish
			// stay bright in the dim underwater environment lighting
			new THREE.Vector4( b.r, b.g, b.b, S.metal * 0.55 ),
			new THREE.Vector4( f.r, f.g, f.b, S.irid ),
			new THREE.Vector4( be.r, be.g, be.b, K.rough ),
			new THREE.Vector4( fi.r, fi.g, fi.b, S.mouth.tip ),
			new THREE.Vector4( e.r, e.g, e.b, S.scales ),
			new THREE.Vector4( ir.r, ir.g, ir.b, S.scaleVis ),
			new THREE.Vector4( 0.5 - S.eye.u * L, S.eye.y, S.eye.r, 0.5 - S.opercle * L ),
			new THREE.Vector4( S.lateral, S.arch, 0.5 - S.mouth.corner * L, S.mouth.y ),
		);

	}

	return uniformArray( rows, 'vec4' );

}

let _table = null;
export const skinTable = () => _table || ( _table = buildTable() );

// varyings shared by the vertex and fragment stages
function varyings() {

	return {
		local: varyingProperty( 'vec3', 'vFishLocal' ), // rest pose position (model units)
		data: varyingProperty( 'vec4', 'vFishData' ), // aData
		info: varyingProperty( 'vec4', 'vFishInfo' ), // pattern, seed, length (m), 0
	};

}

const partOf = ( d ) => floor( d.y.add( 0.01 ) );

// ---------------------------------------------------------------------------
// vertex stage

// Swimming fish. Record: r0 = ( position, length ), r1 = orientation, r2 = ( wave phase,
// amplitude, turning bend, pattern + seed * 0.9 ), r3 = unused
function swimVertex( batch, V ) {

	return Fn( () => {

		const rec = batch.record( batch.recordIndex() );
		const r0 = rec[ 0 ], q = rec[ 1 ], r2 = rec[ 2 ];
		const u = aData.x;
		const part = partOf( aData );
		const p = positionLocal.toVar();
		V.local.assign( p );
		V.data.assign( aData );
		V.info.assign( vec4( floor( r2.w ), fract( r2.w ), r0.w, 0 ) );
		// fish: travelling body wave (amplitude grows toward the tail) plus the turning bend,
		// sculling pectorals; the ray: the disc margins undulate
		const env = u.mul( u ).mul( 0.85 ).add( 0.08 ).mul( smoothstep( 0.0, 0.25, u ).mul( 0.7 ).add( 0.3 ) );
		const bend = r2.z.mul( u.mul( u ) );
		const isDisc = part.equal( PART.DISC );
		const side = aData.z; // ray: distance from the midline
		const ph = r2.x;
		const lat = sin( ph.sub( u.mul( 5.6 ) ) ).mul( env ).mul( r2.y ).add( bend );
		const flap = select( part.equal( PART.PECTORAL ), sin( ph.mul( 0.7 ).add( 1.3 ) ).mul( aData.z ).mul( 0.035 ), 0 );
		const fish = vec3( lat.add( flap.mul( sign( p.x ) ) ), 0, 0 );
		const disc = vec3( 0, sin( ph.sub( u.mul( 8.0 ) ) ).mul( pow( side, 1.6 ) ).mul( r2.y ), 0 );
		p.addAssign( select( isDisc, disc, select( part.equal( PART.WHIP ), vec3( 0 ), fish ) ) );
		normalLocal.assign( rotateQ( q, normalLocal ) );
		return rotateQ( q, p.mul( r0.w ) ).add( r0.xyz );

	} )();

}

// ---------------------------------------------------------------------------
// fragment stage

const hash = ( p ) => fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ).mul( 43758.5453 ) );

// value noise 2D (cheap, for blotches and skin variation)
const vnoise = ( p ) => {

	const i = floor( p ), f = fract( p );
	const w = f.mul( f ).mul( float( 3 ).sub( f.mul( 2 ) ) );
	const a = hash( i ), b = hash( i.add( vec2( 1, 0 ) ) ), c = hash( i.add( vec2( 0, 1 ) ) ), d = hash( i.add( vec2( 1, 1 ) ) );
	return mix( mix( a, b, w.x ), mix( c, d, w.x ), w.y );

};

// posterior edge of the gill cover (local z) at height fraction h: convex backward, sweeping
// forward under the throat
const opercleEdge = ( zOp, h ) => zOp.sub( float( 0.028 ).mul( float( 1 ).sub( h.mul( h ) ) ) ).add( smoothstep( - 0.35, - 1.0, h ).mul( 0.07 ) );
const opercleMask = ( h ) => smoothstep( - 0.98, - 0.9, h ).mul( float( 1 ).sub( smoothstep( 0.45, 0.62, h ) ) );

const band = ( x, center, width, soft ) => float( 1 ).sub( smoothstep( width, width.add( soft ), abs( x.sub( center ) ) ) );

function surface( V, table ) {

	const albedo = vec3( 0.5 ).toVar( 'fishAlbedo' );
	const rough = float( 0.4 ).toVar( 'fishRough' );
	const metal = float( 0 ).toVar( 'fishMetal' );
	const transl = float( 0 ).toVar( 'fishTransl' );
	const spec = float( 0.5 ).toVar( 'fishSpec' );
	const row = ( pattern, k ) => table.element( int( pattern ).mul( ROWS ).add( k ) );

	// shared by colour and relief
	const common = () => {

		const D = V.data, Lp = V.local, I = V.info;
		const pattern = I.x.add( 0.5 ).floor();
		const part = partOf( D );
		const scaleSize = row( pattern, 4 ).w, scaleVis = row( pattern, 5 ).w;
		// scale rows: posterior margins are arcs, rows offset by half a scale
		const ss = max( scaleSize, 0.004 );
		const warp = sin( Lp.z.mul( 23 ).add( D.z.mul( 31 ) ) ).mul( 0.35 ).add( sin( Lp.z.mul( 41 ).sub( D.z.mul( 17 ) ) ).mul( 0.25 ) );
		const a = float( 0.5 ).sub( Lp.z ).div( ss ).add( warp ), b = D.z.div( ss.mul( 0.8 ) ).add( warp.mul( 0.6 ) );
		const rowI = floor( b );
		const fb = fract( b ).mul( 2 ).sub( 1 );
		const f = fract( a.add( rowI.mul( 0.5 ) ).add( fb.mul( fb ).mul( 0.32 ) ) );
		// pixel footprint (m) against the scale size (m): fade out sub-pixel detail
		const px = length( fwidth( positionView ) );
		const fade = float( 1 ).sub( smoothstep( 0.25, 0.7, px.div( ss.mul( I.z ) ) ) ).mul( select( scaleSize.greaterThan( 0.001 ), 1, 0 ) );
		return { D, Lp, I, pattern, part, a, b, f, px, fade, scaleVis };

	};

	const height = Fn( () => {

		const { D, Lp, I, pattern, part, f, fade, scaleVis } = common();
		const isBody = part.equal( PART.BODY );
		const L = I.z;
		// scales: each rises toward its free posterior margin
		const sc = smoothstep( 0.0, 0.9, f ).mul( float( 1 ).sub( smoothstep( 0.9, 1.0, f ) ) ).mul( fade ).mul( scaleVis );
		// gill cover: raised in front of its edge
		const eyeOp = row( pattern, 6 );
		const h = D.w;
		const zE = opercleEdge( eyeOp.w, h );
		const onOp = opercleMask( h );
		const op = smoothstep( - 0.004, 0.004, Lp.z.sub( zE ) ).mul( onOp );
		const bodyH = sc.mul( 0.0007 ).add( op.mul( 0.0025 ) );
		// fin rays: ridges
		const isFin = part.greaterThan( 0.5 ).and( part.lessThan( 7.5 ) );
		const rd = abs( fract( D.w.add( 0.5 ) ).sub( 0.5 ) );
		const ray = float( 1 ).sub( smoothstep( 0.0, 0.25, rd ) ).mul( 0.0004 );
		return select( isBody, bodyH, select( isFin, ray, 0 ) ).mul( L );

	} )();

	const color = Fn( () => {

		const { D, Lp, I, pattern, part, a, b, f, fade, scaleVis } = common();
		const seed = I.y.toVar();
		const pat = pattern.toVar();
		const P = part.toVar();
		const u = D.x.toVar(), h = D.w.toVar(), s = D.z.toVar();
		const z = Lp.z.toVar(), y = Lp.y.toVar();
		const t = D.z.toVar(), w = D.w.toVar(); // fins: along / across the rays
		const isBody = P.equal( PART.BODY ).toVar();
		const isFin = P.greaterThan( 0.5 ).and( P.lessThan( 7.5 ) ).toVar();
		const bodyK = select( isBody, 1, 0 ).toVar();
		const r0 = row( pat, 0 ), r1 = row( pat, 1 ), r2 = row( pat, 2 ), r3 = row( pat, 3 ), r4 = row( pat, 4 ), r5 = row( pat, 5 ), r6 = row( pat, 6 ), r7 = row( pat, 7 );
		const back = r0.xyz.toVar(), flank = r1.xyz.toVar(), belly = r2.xyz.toVar();
		const finC = r3.xyz.toVar(), edgeC = r4.xyz.toVar(), irisC = r5.xyz.toVar();
		const eye = r6.toVar(), lat = r7.toVar();
		const n1 = vnoise( vec2( z, y ).mul( 38 ).add( seed.mul( 17 ) ) ).toVar();
		const n2 = vnoise( vec2( z, s ).mul( 11 ).add( seed.mul( 5 ) ) ).toVar();
		const fwW = fwidth( w ).toVar(), fwH = fwidth( h ).toVar();

		// ---- counter-shading
		const tBack = smoothstep( 0.2, 0.75, h ).toVar();
		const tBelly = float( 1 ).sub( smoothstep( - 0.7, - 0.1, h ) ).toVar();
		const c = mix( mix( flank, back, tBack ), belly, tBelly ).toVar();
		const silver = float( 1 ).sub( tBack.mul( 0.75 ) ).toVar(); // guanine reflection weight
		metal.assign( r0.w.mul( silver ).mul( bodyK ) );
		rough.assign( r2.w );
		// scales: a thin shadow line under each free margin, the exposed field slightly brighter
		// toward the margin
		const scaleShade = smoothstep( 0.3, 0.9, f ).mul( fade ).mul( scaleVis ).toVar();
		const pocket = smoothstep( 0.88, 0.97, f ).mul( float( 1 ).sub( smoothstep( 0.97, 1.0, f ) ) ).mul( fade ).mul( scaleVis );
		const cellK = hash( vec2( floor( a.add( floor( b ).mul( 0.5 ) ) ), floor( b ) ) ).sub( 0.5 ).mul( 0.1 ).mul( fade ).mul( scaleVis );
		c.mulAssign( mix( float( 1 ), float( 0.96 ).add( scaleShade.mul( 0.07 ) ).sub( pocket.mul( 0.14 ) ).add( cellK ), bodyK ) );
		c.mulAssign( mix( 1, n1.mul( 0.14 ).add( 0.93 ), bodyK ) );

		// ---- fins: ray-striped membranes, darker and thinner toward the edge
		If( isFin.and( P.notEqual( PART.FINLET ) ), () => {

			const fin = mix( finC, edgeC, smoothstep( 0.4, 1.0, t ) ).toVar();
			const rd = abs( fract( w.add( 0.5 ) ).sub( 0.5 ) );
			const rayW = select( P.equal( PART.DORSAL1 ), 0.1, 0.06 );
			const ray = float( 1 ).sub( smoothstep( rayW, fwW.mul( 1.2 ).add( rayW ).add( 0.04 ), rd ) ).mul( float( 1 ).sub( smoothstep( 0.2, 0.6, fwW ) ) );
			fin.mulAssign( mix( 0.9, 1.06, ray ) );
			// thicker and darker where the fin joins the body, thinnest at the edge
			fin.mulAssign( smoothstep( 0.0, 0.15, t ).mul( 0.2 ).add( 0.8 ) );
			c.assign( fin );
			transl.assign( mix( 0.8, 0.55, ray ).mul( smoothstep( 0.0, 0.3, t ).mul( 0.4 ).add( 0.6 ) ) );
			// paired fins are pale and nearly clear
			const paired = P.equal( PART.PECTORAL ).or( P.equal( PART.PELVIC ) );
			c.assign( select( paired, mix( c, flank.mul( 1.1 ).add( 0.05 ), 0.45 ), c ) );
			rough.assign( 0.4 );

		} );

		// ---- species markings (body; some on fins)
		If( pat.equal( PATTERN.sandSmelt ), () => {

			// silver lateral band with a dark upper edge; translucent green back
			const bandK = band( h, float( 0.02 ), float( 0.1 ), fwH.add( 0.05 ) ).mul( bodyK );
			c.assign( mix( c, vec3( 0.78, 0.82, 0.84 ), bandK.mul( 0.8 ) ) );
			c.assign( mix( c, vec3( 0.12, 0.2, 0.2 ), band( h, float( 0.14 ), float( 0.015 ), fwH.add( 0.02 ) ).mul( bodyK ).mul( 0.6 ) ) );
			metal.addAssign( bandK.mul( 0.25 ) );

		} ).ElseIf( pat.equal( PATTERN.sardine ), () => {

			// blue-green back with a sharp edge to the silver flank, a row of dark spots along the
			// upper flank behind the gill cover
			c.assign( mix( c, back, smoothstep( 0.38, 0.45, h ).mul( bodyK ).mul( 0.7 ) ) );
			const q = vec2( z.mul( 45 ).add( seed.mul( 3 ) ), h.sub( 0.28 ).mul( 7 ) );
			const spots = float( 1 ).sub( smoothstep( 0.18, 0.32, length( vec2( fract( q.x ).sub( 0.5 ), q.y ) ) ) )
				.mul( step( 0.35, hash( vec2( floor( q.x ), seed ) ) ) ).mul( smoothstep( eye.w.sub( 0.01 ), eye.w.sub( 0.04 ), z ) ).mul( smoothstep( - 0.1, 0.05, z ) ).mul( bodyK );
			c.assign( mix( c, vec3( 0.05, 0.08, 0.1 ), spots.mul( 0.75 ) ) );

		} ).ElseIf( pat.equal( PATTERN.horseMackerel ), () => {

			// bony scutes along the lateral line (a raised, darker ridge, widest on the rear half), a
			// black spot at the upper edge of the gill cover
			const hl = lat.x.add( lat.y.mul( float( 1 ).sub( smoothstep( 0.12, 0.45, u ) ) ) );
			const wS = mix( 0.03, 0.09, smoothstep( 0.3, 0.8, u ) );
			const scute = band( h, hl, wS, fwH.add( 0.03 ) ).mul( bodyK ).mul( smoothstep( 0.2, 0.28, u ) );
			const teeth = smoothstep( 0.3, 0.7, sin( z.mul( 520 ) ) ).mul( 0.3 ).add( 0.7 );
			c.assign( mix( c, vec3( 0.28, 0.33, 0.36 ).mul( teeth ), scute.mul( 0.55 ) ) );
			const opSpot = float( 1 ).sub( smoothstep( 0.008, 0.014, length( vec2( z.sub( eye.w ).add( 0.008 ), y.sub( eye.y ).sub( 0.01 ) ) ) ) ).mul( bodyK );
			c.assign( mix( c, vec3( 0.03, 0.04, 0.05 ), opSpot ) );

		} ).ElseIf( pat.equal( PATTERN.mackerel ), () => {

			// green-blue back with wavy black tiger bars, iridescent silver-white flanks and belly
			const wav = sin( z.mul( 75 ).add( sin( h.mul( 9 ).add( seed.mul( 6 ) ) ).mul( 1.8 ) ).add( n1.mul( 2 ) ) );
			const bars = smoothstep( 0.35, 0.75, wav ).mul( smoothstep( 0.3, 0.45, h ) ).mul( smoothstep( 0.42, 0.3, z ) ).mul( bodyK );
			c.assign( mix( c, vec3( 0.02, 0.03, 0.04 ), bars.mul( 0.9 ) ) );
			c.assign( mix( c, vec3( 0.35, 0.4, 0.3 ), select( P.equal( PART.FINLET ), 0.7, 0 ) ) );

		} ).ElseIf( pat.equal( PATTERN.mullet ), () => {

			// faint dark stripes along the scale rows of the upper flank
			const lines = smoothstep( 0.7, 0.95, sin( s.mul( 280 ) ) ).mul( smoothstep( - 0.1, 0.3, h ) ).mul( bodyK ).mul( 0.25 );
			c.mulAssign( float( 1 ).sub( lines ) );

		} ).ElseIf( pat.equal( PATTERN.bass ), () => {

			// silver-grey, a dark blotch at the upper edge of the gill cover, fine dark speckles on
			// young fish
			const opSpot = float( 1 ).sub( smoothstep( 0.01, 0.018, length( vec2( z.sub( eye.w ).add( 0.01 ), y.sub( eye.y ).sub( 0.004 ) ) ) ) ).mul( bodyK );
			c.assign( mix( c, vec3( 0.12, 0.14, 0.16 ), opSpot.mul( 0.7 ) ) );
			const young = fract( seed.mul( 5.3 ) ).lessThan( 0.3 );
			const speck = smoothstep( 0.8, 0.9, vnoise( vec2( z, y ).mul( 140 ).add( seed.mul( 9 ) ) ) ).mul( smoothstep( - 0.2, 0.4, h ) ).mul( bodyK );
			c.assign( mix( c, vec3( 0.1, 0.12, 0.14 ), speck.mul( select( young, 0.6, 0 ) ) ) );

		} ).ElseIf( pat.equal( PATTERN.seabream ), () => {

			// white seabream: alternating dark and faint vertical bars, a black saddle on the tail
			// stalk, dark fin edges
			const zz = float( 0.5 ).sub( z );
			const k = zz.sub( 0.26 ).mul( 36 );
			const bars = smoothstep( 0.55, 0.85, sin( k ) ).mul( select( fract( floor( k.div( Math.PI * 2 ).add( 0.5 ) ).mul( 0.5 ) ).lessThan( 0.25 ), 0.55, 0.25 ) );
			const onBody = smoothstep( 0.26, 0.3, zz ).mul( smoothstep( 0.76, 0.7, zz ) ).mul( float( 1 ).sub( tBelly.mul( 0.9 ) ) ).mul( bodyK );
			c.assign( mix( c, vec3( 0.12, 0.13, 0.13 ), bars.mul( onBody ) ) );
			const saddle = band( zz, float( 0.79 ), float( 0.02 ), float( 0.01 ) ).mul( smoothstep( - 0.6, 0.2, h ) ).mul( bodyK );
			c.assign( mix( c, vec3( 0.02, 0.02, 0.025 ), saddle.mul( 0.9 ) ) );

		} ).ElseIf( pat.equal( PATTERN.wrasse ), () => {

			// ballan wrasse: green-brown to red-brown (per fish), densely mottled with pale spots
			// in a net pattern, spots on the fins too
			const redK = fract( seed.mul( 7.1 ) ).lessThan( 0.35 );
			const base = select( redK, vec3( 0.32, 0.14, 0.07 ), vec3( 0.18, 0.2, 0.08 ) );
			c.assign( mix( c, base.mul( mix( 0.8, 1.15, n1 ) ), bodyK.add( select( isFin, 0.5, 0 ) ).min( 1 ).mul( float( 1 ).sub( tBelly.mul( 0.4 ) ) ) ) );
			const q = vec2( z, y ).mul( 120 );
			const cell = floor( q );
			const jit = vec2( hash( cell.add( 1.7 ) ), hash( cell.add( 5.3 ) ) ).sub( 0.5 ).mul( 0.5 );
			const spot = float( 1 ).sub( smoothstep( 0.18, 0.32, length( fract( q ).sub( 0.5 ).sub( jit ) ) ) ).mul( select( isBody.or( isFin ), 1, 0 ) );
			c.assign( mix( c, select( redK, vec3( 0.62, 0.42, 0.26 ), vec3( 0.55, 0.52, 0.3 ) ), spot.mul( 0.55 ) ) );

		} ).ElseIf( pat.equal( PATTERN.garfish ), () => {

			// green-blue back and a dark beak
			const stripe = band( h, float( 0.0 ), float( 0.06 ), fwH.add( 0.05 ) ).mul( bodyK );
			c.assign( mix( c, vec3( 0.1, 0.3, 0.3 ), stripe.mul( 0.5 ) ) );
			c.assign( mix( c, vec3( 0.12, 0.16, 0.16 ), smoothstep( 0.32, 0.36, z ).mul( bodyK ).mul( 0.7 ) ) );

		} );

		// ---- lateral line (a row of pores along a dark line)
		const hl = lat.x.add( lat.y.mul( float( 1 ).sub( smoothstep( 0.12, 0.55, u ) ) ) );
		const lineK = band( h, hl, fwH.mul( 0.5 ).add( 0.012 ), fwH.add( 0.008 ) ).mul( bodyK ).mul( smoothstep( 0.18, 0.25, u ) ).mul( smoothstep( 0.9, 0.8, u ) );
		c.mulAssign( float( 1 ).sub( lineK.mul( 0.3 ) ) );

		// ---- gill cover edge and the preopercle (dark creases)
		const zE = opercleEdge( eye.w, h );
		const dOp = z.sub( zE );
		const onOp = opercleMask( h ).mul( bodyK );
		const crease = float( 1 ).sub( smoothstep( 0.0015, 0.004, abs( dOp ) ) ).mul( onOp );
		c.mulAssign( float( 1 ).sub( crease.mul( 0.45 ) ) );
		const pre = float( 1 ).sub( smoothstep( 0.001, 0.003, abs( dOp.sub( 0.04 ) ) ) ).mul( onOp ).mul( smoothstep( 0.6, 0.2, h ) );
		c.mulAssign( float( 1 ).sub( pre.mul( 0.2 ) ) );

		// ---- lips (the mouth line from the snout to the corner), the edge of the upper jaw bone
		// and the nostrils
		const hz = lat.z, hy = lat.w, tipY = r3.w;
		const mt = clamp( z.sub( hz ).div( float( 0.5 ).sub( hz ) ), 0, 1 );
		const yLip = mix( hy, tipY, mt );
		const lips = float( 1 ).sub( smoothstep( 0.0015, 0.0035, abs( y.sub( yLip ) ) ) ).mul( step( hz.sub( 0.004 ), z ) ).mul( bodyK );
		c.mulAssign( float( 1 ).sub( lips.mul( 0.55 ) ) );
		const maxZ = hz.add( 0.006 ).sub( y.sub( hy ).mul( 0.35 ) );
		const maxilla = float( 1 ).sub( smoothstep( 0.001, 0.0025, abs( z.sub( maxZ ) ) ) ).mul( smoothstep( hy.sub( 0.002 ), hy.add( 0.002 ), y ) ).mul( smoothstep( hy.add( 0.04 ), hy.add( 0.025 ), y ) ).mul( bodyK );
		c.mulAssign( float( 1 ).sub( maxilla.mul( 0.3 ) ) );
		const nostril = float( 1 ).sub( smoothstep( 0.1, 0.2, length( vec2( z.sub( eye.x ).sub( eye.z.mul( 1.7 ) ), y.sub( eye.y ).sub( eye.z.mul( 0.25 ) ) ) ).div( eye.z ) ) ).mul( bodyK );
		c.mulAssign( float( 1 ).sub( nostril.mul( 0.6 ) ) );

		// ---- painted eye (under the dome where there is one)
		const er = length( vec2( z.sub( eye.x ), y.sub( eye.y ) ) ).div( eye.z );
		const eyeCol = ( r, ang ) => {

			const streak = sin( ang.mul( 26 ) ).mul( 0.5 ).add( 0.5 );
			const iris = irisC.mul( mix( 0.65, 1.15, streak ) ).mul( smoothstep( 0.4, 0.6, r ).mul( 0.5 ).add( 0.5 ) );
			const ring = smoothstep( 0.78, 0.95, r );
			const e = mix( iris, vec3( 0.03, 0.03, 0.03 ), ring ).toVar();
			e.assign( mix( e, vec3( 0.005, 0.006, 0.008 ), float( 1 ).sub( smoothstep( 0.4, 0.46, r ) ) ) );
			return e;

		};

		const painted = float( 1 ).sub( smoothstep( 0.95, 1.1, er ) ).mul( bodyK );
		c.assign( mix( c, eyeCol( er, atan( y.sub( eye.y ), z.sub( eye.x ) ) ), painted ) );
		metal.mulAssign( float( 1 ).sub( painted ) );

		// ---- eye dome: pupil, iris, glossy cornea
		If( P.equal( PART.EYE ), () => {

			const r = length( vec2( t, w ) );
			c.assign( eyeCol( r, atan( w, t ) ) );
			c.assign( mix( c, flank.mul( 0.6 ), smoothstep( 0.93, 1.0, r ) ) );
			rough.assign( 0.04 );
			spec.assign( 1.0 );
			metal.assign( 0 );

		} ).ElseIf( P.equal( PART.MOUTH ), () => {

			// inside of the mouth: pale pink lips to a dark throat
			c.assign( mix( vec3( 0.5, 0.3, 0.3 ), vec3( 0.03, 0.012, 0.012 ), smoothstep( 0.05, 0.85, t ) ) );
			metal.assign( 0 );
			rough.assign( 0.35 );

		} ).ElseIf( P.equal( PART.DISC ).or( P.equal( PART.WHIP ) ), () => {

			// thornback ray: brown back, finely mottled, with scattered pale spots ringed darker;
			// white belly
			const top = w.greaterThan( 0 );
			const q = vec2( Lp.x, Lp.z ).mul( 20 );
			const cell = floor( q );
			const jit = vec2( hash( cell.add( 1.7 ) ), hash( cell.add( 5.3 ) ) ).sub( 0.5 ).mul( 0.4 );
			const rad = hash( cell.add( 9.1 ) ).mul( 0.1 ).add( 0.08 );
			const d = length( fract( q ).sub( 0.5 ).sub( jit ) );
			const on = step( 0.55, hash( cell ) );
			const spot = float( 1 ).sub( smoothstep( rad, rad.add( 0.04 ), d ) ).mul( on );
			const ring = float( 1 ).sub( smoothstep( 0.02, 0.05, abs( d.sub( rad.add( 0.05 ) ) ) ) ).mul( on );
			const mottle = vnoise( vec2( Lp.x, Lp.z ).mul( 60 ) ).mul( 0.25 ).add( n2.mul( 0.2 ) ).add( 0.7 );
			const dorsal = back.mul( mottle ).mul( float( 1 ).sub( ring.mul( 0.35 ) ) ).toVar();
			dorsal.assign( mix( dorsal, vec3( 0.72, 0.62, 0.46 ), spot.mul( 0.7 ) ) );
			dorsal.assign( mix( dorsal, edgeC, smoothstep( 0.8, 1.0, t ).mul( 0.4 ) ) );
			c.assign( select( top, dorsal, belly ) );
			c.assign( select( P.equal( PART.WHIP ), finC, c ) );
			metal.assign( 0 );
			rough.assign( r2.w );

		} );

		// iridescent sheen on silvery skin at grazing angles
		const cosV = abs( dot( normalView, positionViewDirection ) );
		const irid = r1.w.mul( bodyK ).mul( silver ).mul( float( 1 ).sub( cosV ) );
		const hueA = vec3( 0.55, 0.95, 0.8 ), hueB = vec3( 0.95, 0.6, 1.0 );
		c.assign( mix( c, c.mul( mix( hueA, hueB, cosV ) ).mul( 1.25 ), irid.mul( 0.6 ) ) );
		albedo.assign( c );
		return c;

	} )();

	return { color, height, albedo, rough, metal, transl, spec };

}

// ---------------------------------------------------------------------------

// Material of the swimming fish (batch: SeabedBatch with the fish kinds). sun: { dir, color }
// uniforms for the light through the fins (as an emissive term).
export function createSwimMaterial( batch, sun ) {

	const V = varyings();
	const table = skinTable();
	const mat = new THREE.MeshPhysicalNodeMaterial( { roughness: 0.4, metalness: 0 } );
	mat.name = 'Fish';
	mat.positionNode = swimVertex( batch, V );
	const S = surface( V, table );
	mat.colorNode = S.color;
	mat.roughnessNode = S.rough;
	mat.metalnessNode = S.metal;
	mat.normalNode = bumpNormal( S.height );
	mat.specularIntensityNode = S.spec;
	mat.emissiveNode = Fn( () => {

		const back = saturate( dot( normalWorldGeometry.mul( faceDirection ).negate(), sun.dir ) );
		return vec3( sun.color ).mul( S.albedo ).mul( S.transl.mul( 0.5 ).mul( back ) ).mul( 1 / Math.PI );

	} )();
	return mat;

}
