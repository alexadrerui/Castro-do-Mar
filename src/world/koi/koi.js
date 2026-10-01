// Koi carp. Port of the Koi of AndyLe Pool (https://github.com/AndyLeAI/Andy_KOI_Pool, commit dc3b205,
// Copyright AndyLeAI, Apache License 2.0: see LICENSE-AndyLePool in this folder). Changes from the
// original: node materials (WebGPU), a free-form lake (steering by the distance to the shore of
// lakes.js instead of the round pond), real sizes (0.55-0.95 m instead of 2-3 m, speeds scaled with
// the length), a seeded generator per lake, the fish flee the camera; no food pellets, no jumps (the
// original's splashes need its ripple system).
// The body is a tube of RS rings x RD sides along a 12-node spine that follows the head (a chain);
// the swimming wave bends it, and the vertices are rewritten on the CPU every frame.
import * as THREE from 'three/webgpu';

const TAU = Math.PI * 2;
const lerp = ( a, b, t ) => a + ( b - a ) * t;
const clamp = ( x, a, b ) => Math.min( b, Math.max( a, x ) );
const smooth = ( a, b, x ) => { const t = clamp( ( x - a ) / ( b - a ), 0, 1 ); return t * t * ( 3 - 2 * t ); };
const wrap = ( a ) => { a = ( a + Math.PI ) % TAU; if ( a < 0 ) a += TAU; return a - Math.PI; };
function hash2( x, y ) { const h = Math.sin( x * 127.1 + y * 311.7 ) * 43758.5453; return h - Math.floor( h ); }
function vnoise( x, y ) {
	const xi = Math.floor( x ), yi = Math.floor( y ), xf = x - xi, yf = y - yi;
	const u = xf * xf * ( 3 - 2 * xf ), v = yf * yf * ( 3 - 2 * yf );
	const a = hash2( xi, yi ), b = hash2( xi + 1, yi ), c = hash2( xi, yi + 1 ), d = hash2( xi + 1, yi + 1 );
	return a + ( b - a ) * u + ( c - a ) * v + ( a - b - c + d ) * u * v;
}
const fbm = ( x, y ) => ( vnoise( x, y ) * 0.5 + vnoise( x * 2.03, y * 2.03 ) * 0.25 + vnoise( x * 4.1, y * 4.1 ) * 0.125 ) / 0.875;
const srgb = ( r, g, b ) => new THREE.Color().setRGB( r, g, b, THREE.SRGBColorSpace );

const RS = 26, RD = 16, NODES = 12, TK = 9;
const COL = {
	white: srgb( 0.97, 0.95, 0.91 ), red: srgb( 0.86, 0.2, 0.06 ), orange: srgb( 0.96, 0.46, 0.1 ),
	black: srgb( 0.05, 0.05, 0.06 ), gold: srgb( 0.98, 0.74, 0.26 ), yellow: srgb( 0.97, 0.84, 0.32 ),
	bronze: srgb( 0.52, 0.36, 0.2 ), blue: srgb( 0.46, 0.56, 0.63 ), cream: srgb( 0.99, 0.96, 0.88 )
};
// the original's patterns were tuned on 2-3 m fish: they are laid out on that length
const PATTERN_L = 2.5;

function profile( t ) {
	if ( t < 0.18 ) { const k = t / 0.18; return Math.sqrt( 1 - ( 1 - k ) * ( 1 - k ) ) * ( 0.82 + 0.18 * k ); }
	return 1 - 0.88 * Math.pow( ( t - 0.18 ) / 0.82, 1.2 );
}
function koiColor( variety, t, side, top, seed, L, out ) {
	const u = t * L;
	const n1 = fbm( u * 1.5 + seed, side * 1.1 + seed * 0.7 );
	const n2 = fbm( u * 2.6 + seed * 3.1, side * 1.8 - seed );
	const back = top > - 0.25 && t > 0.05 && t < 0.88;
	switch ( variety ) {
		case 'kohaku': out.copy( back && n1 > 0.5 ? COL.red : COL.white ); if ( t > 0.05 && t < 0.2 && top > 0.25 && n1 > 0.36 ) out.copy( COL.red ); break;
		case 'sanke':
			out.copy( back && n1 > 0.52 ? COL.red : COL.white );
			if ( top > - 0.1 && t > 0.2 && t < 0.9 && n2 > 0.64 ) out.copy( COL.black );
			break;
		case 'showa':
			out.copy( COL.white );
			if ( back && n1 > 0.5 ) out.copy( COL.red );
			if ( n2 > 0.52 && t > 0.03 ) out.copy( COL.black );
			break;
		case 'tancho': {
			out.copy( COL.white );
			const k = Math.pow( ( t - 0.11 ) / 0.075, 2 ) + Math.pow( side / 0.55, 2 );
			if ( k < 1 && top > 0.3 ) out.copy( COL.red );
			break;
		}
		case 'ogon': out.copy( COL.gold ).lerp( COL.cream, clamp( top, 0, 1 ) * 0.35 ); break;
		case 'kigoi': out.copy( COL.yellow ); break;
		case 'chagoi': out.copy( COL.bronze ).multiplyScalar( 0.82 + 0.18 * Math.abs( Math.sin( u * 20 ) * Math.sin( side * 12 + u * 6 ) ) ); break;
		case 'asagi':
			if ( top > 0.15 && t > 0.1 ) out.copy( COL.blue ).multiplyScalar( 0.8 + 0.2 * Math.abs( Math.sin( u * 18 + side * 9 ) * Math.sin( u * 18 - side * 9 ) ) );
			else if ( t <= 0.1 ) out.copy( COL.cream ).lerp( COL.blue, 0.3 );
			else out.copy( COL.orange ).lerp( COL.red, 0.35 );
			break;
		case 'butterfly':
			out.copy( COL.orange ).lerp( COL.cream, smooth( 0.45, 0.7, n1 ) * 0.8 );
			if ( n2 > 0.66 && top > 0 ) out.copy( COL.black );
			break;
	}
	if ( top < - 0.35 && variety !== 'ogon' && variety !== 'chagoi' ) out.lerp( COL.cream, 0.55 );
	out.multiplyScalar( 0.94 + 0.06 * n2 );
	return out;
}
const FIN_COLORS = {
	kohaku: [ COL.white, COL.white ], sanke: [ COL.white, COL.white ], tancho: [ COL.white, COL.white ],
	showa: [ COL.black, COL.white ], ogon: [ COL.gold, COL.cream ], kigoi: [ COL.yellow, COL.cream ],
	chagoi: [ COL.bronze, COL.cream ], asagi: [ COL.orange, COL.cream ], butterfly: [ COL.orange, COL.cream ]
};
export const VARIETIES = [ 'kohaku', 'sanke', 'showa', 'tancho', 'ogon', 'kohaku', 'asagi', 'chagoi', 'kigoi', 'sanke', 'butterfly', 'kohaku', 'showa', 'ogon' ];

// shared by every koi (one shader each)
let MATS = null;
function materials() {
	if ( MATS ) return MATS;
	const body = ( rough, metal ) => new THREE.MeshStandardNodeMaterial( { vertexColors: true, roughness: rough, metalness: metal, side: THREE.DoubleSide } );
	MATS = {
		body: body( 0.38, 0.06 ),
		ogon: body( 0.28, 0.55 ),
		fins: new THREE.MeshStandardNodeMaterial( { vertexColors: true, transparent: true, opacity: 0.78, roughness: 0.5, side: THREE.DoubleSide, depthWrite: false } ),
		eye: new THREE.MeshStandardNodeMaterial( { color: 0x0b0b0c, roughness: 0.15, metalness: 0.2 } )
	};
	return MATS;
}
const eyeGeo = new THREE.SphereGeometry( 1, 10, 8 );
const _in = { x: 0, z: 0 };

export class Koi {
	// lake: lakes.js; rnd: the lake's generator; water: the water level
	constructor( variety, lake, rnd, water ) {
		const rand = ( a, b ) => a + ( b - a ) * rnd();
		this.rnd = rnd; this.rand = rand; this.lake = lake; this.water = water;
		this.variety = variety;
		this.L = rand( 0.55, 0.95 ) * ( variety === 'butterfly' ? 0.95 : 1 );
		const S = this.L / PATTERN_L; // speeds and ranges of the original, scaled with the length
		this.S = S;
		this.W = this.L * 0.115;
		this.seg = this.L / ( NODES - 1 );
		// start somewhere in the open water around the middle of the lake
		for ( let k = 0; k < 40; k ++ ) {
			const a = rand( 0, TAU ), r = rand( 0, lake.maxShore );
			this.x = lake.cx + Math.cos( a ) * r; this.z = lake.cz + Math.sin( a ) * r;
			if ( lake.shore( this.x, this.z ) > Math.min( 1.5, lake.maxShore * 0.5 ) ) break;
		}
		this.h = rand( - Math.PI, Math.PI ); this.av = 0;
		this.cruise = rand( 0.6, 0.95 ) * Math.sqrt( S ) * 0.8; this.speed = this.cruise; this.turn = rand( 1.1, 1.6 );
		this.phase = rand( 0, TAU ); this.effort = 0.5; this.seed = rand( 0, 100 );
		this.depth = rand( - 1.2, - 0.3 ); this.tDepth = this.depth; this.depthTimer = rand( 3, 10 );
		this.state = 0; this.stateT = rand( 1, 4 ); this.flee = 0;
		this.nodes = Array.from( { length: NODES }, ( _, i ) => ( { x: this.x - Math.cos( this.h ) * this.seg * i, z: this.z - Math.sin( this.h ) * this.seg * i } ) );
		this.ny = new Float32Array( NODES ).fill( this.depth );
		this.rs = this.nodes.map( () => ( { x: 0, y: 0, z: 0 } ) );
		this.depth = Math.max( this.depth, this.bed( this.x, this.z ) );

		const M = materials();
		const bodyPos = new Float32Array( RS * RD * 3 ), bodyCol = new Float32Array( RS * RD * 3 ), idx = [];
		const c = new THREE.Color();
		for ( let r = 0; r < RS; r ++ ) {
			const t = r / ( RS - 1 );
			for ( let a = 0; a < RD; a ++ ) {
				const ang = ( a / RD ) * TAU;
				koiColor( variety, t, Math.sin( ang ), Math.cos( ang ), this.seed, PATTERN_L, c );
				const k = ( r * RD + a ) * 3; bodyCol[ k ] = c.r; bodyCol[ k + 1 ] = c.g; bodyCol[ k + 2 ] = c.b;
			}
		}
		for ( let r = 0; r < RS - 1; r ++ ) for ( let a = 0; a < RD; a ++ ) {
			const a1 = ( a + 1 ) % RD, i0 = r * RD + a, i1 = r * RD + a1, i2 = ( r + 1 ) * RD + a, i3 = ( r + 1 ) * RD + a1;
			idx.push( i0, i2, i1, i1, i2, i3 );
		}
		const bg = new THREE.BufferGeometry();
		bg.setAttribute( 'position', new THREE.BufferAttribute( bodyPos, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		bg.setAttribute( 'color', new THREE.BufferAttribute( bodyCol, 3 ) );
		bg.setIndex( idx );
		this.body = new THREE.Mesh( bg, variety === 'ogon' ? M.ogon : M.body );
		this.body.name = 'koi_' + variety;

		const FV = TK * 2 + 14 + 14;
		const finPos = new Float32Array( FV * 3 ), finCol = new Float32Array( FV * 3 ), fidx = [];
		const [ rootC, tipC ] = FIN_COLORS[ variety ];
		const setC = ( i, col ) => { finCol[ i * 3 ] = col.r; finCol[ i * 3 + 1 ] = col.g; finCol[ i * 3 + 2 ] = col.b; };
		for ( let j = 0; j < TK; j ++ ) { setC( j, rootC ); setC( TK + j, c.copy( rootC ).lerp( tipC, 0.75 ) ); }
		for ( let j = 0; j < TK - 1; j ++ ) { const a = j, b = j + 1, cc = TK + j, d = TK + j + 1; fidx.push( a, cc, b, b, cc, d ); }
		for ( const base of [ TK * 2, TK * 2 + 7 ] ) {
			setC( base, rootC );
			for ( let k = 1; k <= 6; k ++ ) setC( base + k, c.copy( rootC ).lerp( tipC, 0.8 ) );
			for ( let k = 1; k < 6; k ++ ) fidx.push( base, base + k, base + k + 1 );
		}
		const db = TK * 2 + 14;
		for ( let k = 0; k < 7; k ++ ) { setC( db + k, rootC ); setC( db + 7 + k, c.copy( rootC ).lerp( tipC, 0.6 ) ); }
		for ( let k = 0; k < 6; k ++ ) fidx.push( db + k, db + 7 + k, db + k + 1, db + k + 1, db + 7 + k, db + 8 + k );
		const fg = new THREE.BufferGeometry();
		fg.setAttribute( 'position', new THREE.BufferAttribute( finPos, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		fg.setAttribute( 'color', new THREE.BufferAttribute( finCol, 3 ) );
		fg.setIndex( fidx );
		this.fins = new THREE.Mesh( fg, M.fins );
		this.fins.name = 'koi_fins';

		this.eyes = [ new THREE.Mesh( eyeGeo, M.eye ), new THREE.Mesh( eyeGeo, M.eye ) ];
		this.eyes.forEach( ( e ) => e.scale.setScalar( this.L * 0.02 ) );
		this.meshes = [ this.body, this.fins, ...this.eyes ];
		for ( const m of this.meshes ) { m.frustumCulled = false; m.layers.set( 1 ); } // under water: not in the reflection
		this.fr = { x: 0, y: 0, z: 0, tx: 1, ty: 0, tz: 0, sx: 0, sz: 1, ux: 0, uy: 1, uz: 0, w: 0, h: 0 };
	}

	// lowest the fish swims at a point (depth below the water, negative)
	bed( x, z ) { return Math.min( this.lake.hf.heightAt( x, z ) - this.water + this.L * 0.17, - this.L * 0.12 ); }

	frameAt( t ) {
		const f = t * ( NODES - 1 ), i0 = Math.min( Math.floor( f ), NODES - 2 ), fr = f - i0;
		const a = this.rs[ i0 ], b = this.rs[ i0 + 1 ], o = this.fr;
		o.x = lerp( a.x, b.x, fr ); o.y = lerp( a.y, b.y, fr ); o.z = lerp( a.z, b.z, fr );
		let tx = a.x - b.x, ty = a.y - b.y, tz = a.z - b.z;
		const l = Math.hypot( tx, ty, tz ) || 1; tx /= l; ty /= l; tz /= l;
		const hl = Math.hypot( tx, tz );
		if ( hl > 1e-3 ) { o.sx = - tz / hl; o.sz = tx / hl; }
		o.tx = tx; o.ty = ty; o.tz = tz;
		o.ux = - o.sz * ty; o.uy = o.sz * tx - o.sx * tz; o.uz = o.sx * ty;
		o.w = this.W * profile( t ); o.h = o.w * 0.92;
		return o;
	}

	// fishes: the koi of the lake; time: the clock; cam: camera position (they flee when it comes close)
	update( dt, fishes, time, cam ) {
		const rnd = this.rnd, rand = this.rand, S = this.S, lake = this.lake;
		this.stateT -= dt;
		if ( this.stateT <= 0 ) {
			const r = rnd();
			this.state = r < 0.55 ? 0 : r < 0.76 ? 1 : r < 0.88 ? 2 : 3;
			this.stateT = [ rand( 2, 5 ), rand( 1, 2.5 ), rand( 0.8, 2.4 ), rand( 0.4, 0.9 ) ][ this.state ];
		}
		let spd = [ 1, 0.55, 0.2, 2.2 ][ this.state ];
		let ax = 0, az = 0;
		const wander = this.h + ( vnoise( time * 0.23 + this.seed, this.seed ) - 0.5 ) * 2.6;
		ax += Math.cos( wander ); az += Math.sin( wander );
		let cx = 0, cz = 0, hx = 0, hz = 0, n = 0;
		const near = 4.5 * Math.max( S, 0.4 );
		for ( const o of fishes ) {
			if ( o === this ) continue;
			const dx = this.x - o.x, dz = this.z - o.z, d = Math.hypot( dx, dz ), sep = ( this.L + o.L ) * 0.5;
			if ( d < sep && d > 1e-4 && Math.abs( this.depth - o.depth ) < 0.7 * S + 0.1 ) { const k = ( ( sep - d ) / sep ) * 2.4; ax += ( dx / d ) * k; az += ( dz / d ) * k; }
			if ( d < near ) { cx += o.x; cz += o.z; hx += Math.cos( o.h ); hz += Math.sin( o.h ); n ++; }
		}
		if ( n ) {
			const dx = cx / n - this.x, dz = cz / n - this.z, d = Math.hypot( dx, dz ) || 1;
			ax += ( dx / d ) * 0.22 + ( hx / n ) * 0.3; az += ( dz / d ) * 0.22 + ( hz / n ) * 0.3;
		}
		// the shore: look ahead and turn back toward open water
		const margin = Math.min( this.L * 1.6, lake.maxShore * 0.6 );
		const lx = this.x + Math.cos( this.h ) * this.L * 1.2, lz = this.z + Math.sin( this.h ) * this.L * 1.2, ls = lake.shore( lx, lz );
		if ( ls < margin ) { const k = ( margin - ls ) / margin * 4; lake.inward( lx, lz, _in ); ax += _in.x * k; az += _in.z * k; }
		// the camera: under the water or low over it, close by
		if ( cam && Math.hypot( cam.x - this.x, cam.z - this.z ) < 3 + this.L * 2 && cam.y - this.water < 2.5 ) this.flee = rand( 1.5, 3 );
		if ( this.flee > 0 ) {
			this.flee -= dt;
			const dx = this.x - cam.x, dz = this.z - cam.z, d = Math.hypot( dx, dz ) || 1;
			ax += ( dx / d ) * 5; az += ( dz / d ) * 5; spd = 2.8; this.tDepth = - 2.4;
		}
		const diff = wrap( Math.atan2( az, ax ) - this.h );
		const maxAv = this.turn * ( spd > 1.5 ? 1.9 : 1 );
		this.av = lerp( this.av, clamp( diff * 2.2, - maxAv, maxAv ), 1 - Math.exp( - dt * 4 ) );
		this.h += this.av * dt;
		const tgt = this.cruise * spd;
		this.speed = lerp( this.speed, tgt, 1 - Math.exp( - dt * ( tgt > this.speed ? 2.5 : 1.1 ) ) );
		this.effort = lerp( this.effort, clamp( this.speed / this.cruise, 0.15, 2.4 ) * 0.5 + Math.abs( this.av ) * 0.25, 1 - Math.exp( - dt * 3 ) );
		this.phase += dt * ( 2.0 + this.speed / Math.sqrt( S ) * 3.4 );
		const nx = this.x + Math.cos( this.h ) * this.speed * dt, nz = this.z + Math.sin( this.h ) * this.speed * dt;
		// never onto the bank
		if ( lake.shore( nx, nz ) > this.L * 0.3 ) { this.x = nx; this.z = nz; } else this.h += Math.PI * dt * 2;

		this.depthTimer -= dt;
		if ( this.flee <= 0 && this.depthTimer <= 0 ) {
			this.depthTimer = rand( 5, 14 );
			this.tDepth = Math.min( rnd() < 0.4 ? rand( - 0.55, - 0.3 ) : rand( - 1.9, - 0.7 ), - 0.3 ) * Math.max( S, 0.5 );
		}
		const bed = this.bed( this.x, this.z );
		this.depth = Math.max( lerp( this.depth, Math.max( this.tDepth, bed ), 1 - Math.exp( - dt * ( this.flee > 0 ? 1.4 : 0.6 ) ) ), bed );
		this.depth = Math.min( this.depth, - this.L * 0.12 );

		const N = this.nodes; N[ 0 ].x = this.x; N[ 0 ].z = this.z;
		for ( let i = 1; i < NODES; i ++ ) {
			const dx = N[ i ].x - N[ i - 1 ].x, dz = N[ i ].z - N[ i - 1 ].z, l = Math.hypot( dx, dz ) || 1;
			N[ i ].x = N[ i - 1 ].x + ( dx / l ) * this.seg; N[ i ].z = N[ i - 1 ].z + ( dz / l ) * this.seg;
		}
		const k = 1 - Math.exp( - dt * 3.5 );
		this.ny[ 0 ] = this.depth;
		for ( let i = 1; i < NODES; i ++ ) this.ny[ i ] = lerp( this.ny[ i ], this.ny[ i - 1 ], k );
	}

	draw( time ) {
		const N = this.nodes, rs = this.rs, amp = this.L * 0.07 * ( 0.35 + this.effort * 0.9 );
		for ( let i = 0; i < NODES; i ++ ) {
			const t = i / ( NODES - 1 ), j0 = Math.max( i - 1, 0 ), j1 = Math.min( i + 1, NODES - 1 );
			let tx = N[ j0 ].x - N[ j1 ].x, tz = N[ j0 ].z - N[ j1 ].z; const l = Math.hypot( tx, tz ) || 1; tx /= l; tz /= l;
			const off = Math.sin( this.phase - t * 4.8 ) * amp * Math.pow( t, 1.6 ) + Math.sin( this.phase ) * amp * 0.06 * ( 1 - t );
			rs[ i ].x = N[ i ].x - tz * off; rs[ i ].z = N[ i ].z + tx * off; rs[ i ].y = this.water + this.ny[ i ];
		}
		const bp = this.body.geometry.attributes.position.array;
		for ( let r = 0; r < RS; r ++ ) {
			const f = this.frameAt( r / ( RS - 1 ) );
			for ( let a = 0; a < RD; a ++ ) {
				const ang = ( a / RD ) * TAU, sa = Math.sin( ang ), ca = Math.cos( ang );
				const vert = ca >= 0 ? ca * f.h : ca * f.h * 0.72, lat = sa * f.w, k = ( r * RD + a ) * 3;
				bp[ k ] = f.x + f.sx * lat + f.ux * vert; bp[ k + 1 ] = f.y + f.uy * vert; bp[ k + 2 ] = f.z + f.sz * lat + f.uz * vert;
			}
		}
		this.body.geometry.attributes.position.needsUpdate = true;
		this.body.geometry.computeVertexNormals();

		const fp = this.fins.geometry.attributes.position.array, L = this.L;
		const put = ( i, x, yy, z ) => { fp[ i * 3 ] = x; fp[ i * 3 + 1 ] = yy; fp[ i * 3 + 2 ] = z; };
		let f = this.frameAt( 1 );
		const tailLen = L * 0.34, span = L * 0.2;
		for ( let j = 0; j < TK; j ++ ) {
			const s = ( j / ( TK - 1 ) ) * 2 - 1, fork = 0.7 + 0.4 * Math.pow( Math.abs( s ), 1.3 );
			const lag = Math.sin( this.phase - 5.6 - Math.abs( s ) * 0.5 ) * L * 0.07 * ( 0.4 + this.effort );
			const wob = Math.sin( this.phase * 0.5 + s * 2 ) * 0.02 * L / PATTERN_L;
			put( j, f.x + f.sx * s * L * 0.02, f.y, f.z + f.sz * s * L * 0.02 );
			const lat = s * span + lag, back = tailLen * fork;
			put( TK + j, f.x - f.tx * back + f.sx * lat + f.ux * wob, f.y - f.ty * back + f.uy * wob, f.z - f.tz * back + f.sz * lat + f.uz * wob );
		}
		f = this.frameAt( 0.24 );
		const fold = clamp( this.speed / this.cruise, 0, 2 ) * 0.35 + Math.sin( time * 2.4 + this.seed ) * 0.12;
		const a = lerp( 0.35, 1.1, clamp( fold, 0, 1 ) ), ca = Math.cos( a ), sa = Math.sin( a );
		const sink = 0.04 * L / PATTERN_L;
		[ - 1, 1 ].forEach( ( sg, si ) => {
			const base = TK * 2 + si * 7;
			const rx = f.x + f.sx * f.w * 0.8 * sg - f.ux * f.h * 0.35;
			const ry = f.y - f.uy * f.h * 0.35;
			const rz = f.z + f.sz * f.w * 0.8 * sg - f.uz * f.h * 0.35;
			put( base, rx, ry, rz );
			const dx = f.sx * sg * ca - f.tx * sa, dy = - f.ty * sa, dz = f.sz * sg * ca - f.tz * sa;
			const cx = f.uy * dz - f.uz * dy, cy = f.uz * dx - f.ux * dz, cz = f.ux * dy - f.uy * dx;
			for ( let k = 1; k <= 6; k ++ ) {
				const off = ( ( k - 1 ) / 5 - 0.5 ) * 0.9, co = Math.cos( off ), so = Math.sin( off );
				const len = L * 0.19 * ( 0.8 + 0.2 * Math.sin( ( ( k - 1 ) / 5 ) * Math.PI ) );
				put( base + k, rx + ( dx * co + cx * so ) * len - f.ux * sink, ry + ( dy * co + cy * so ) * len - f.uy * sink, rz + ( dz * co + cz * so ) * len - f.uz * sink );
			}
		} );
		const db = TK * 2 + 14, lift = 0.01 * L / PATTERN_L;
		for ( let k = 0; k < 7; k ++ ) {
			const t = 0.3 + ( k / 6 ) * 0.3; f = this.frameAt( t );
			const fh = L * 0.06 * Math.pow( Math.sin( ( Math.PI * ( k + 0.5 ) ) / 7 ), 0.5 );
			put( db + k, f.x + f.ux * ( f.h - lift ), f.y + f.uy * ( f.h - lift ), f.z + f.uz * ( f.h - lift ) );
			put( db + 7 + k, f.x - f.tx * L * 0.05 + f.ux * ( f.h + fh ), f.y - f.ty * L * 0.05 + f.uy * ( f.h + fh ), f.z - f.tz * L * 0.05 + f.uz * ( f.h + fh ) );
		}
		this.fins.geometry.attributes.position.needsUpdate = true;
		this.fins.geometry.computeVertexNormals();

		f = this.frameAt( 0.075 );
		this.eyes.forEach( ( e, i ) => {
			const s = i ? 1 : - 1;
			e.position.set( f.x + f.sx * f.w * 0.8 * s + f.ux * f.h * 0.3, f.y + f.uy * f.h * 0.3, f.z + f.sz * f.w * 0.8 * s + f.uz * f.h * 0.3 );
		} );
	}
}
