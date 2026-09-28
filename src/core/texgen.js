// Procedural texture generation on the CPU (tileable), used as TSL texture
// nodes so the fragment shaders sample instead of evaluating noise.

import { mulberry32 } from './noise.js';

// Periodic value noise on an integer lattice of `period` cells.
function makePeriodicValue( period, seed ) {
	const rnd = mulberry32( seed );
	const lat = new Float32Array( period * period );
	for ( let i = 0; i < lat.length; i ++ ) lat[ i ] = rnd();
	const at = ( x, y ) => lat[ ( ( y % period + period ) % period ) * period + ( ( x % period + period ) % period ) ];
	return ( u, v ) => { // u,v in lattice units
		const x0 = Math.floor( u ), y0 = Math.floor( v );
		const fx = u - x0, fy = v - y0;
		const sx = fx * fx * ( 3 - 2 * fx ), sy = fy * fy * ( 3 - 2 * fy );
		const a = at( x0, y0 ), b = at( x0 + 1, y0 ), c = at( x0, y0 + 1 ), d = at( x0 + 1, y0 + 1 );
		return ( a + ( b - a ) * sx ) + ( ( c + ( d - c ) * sx ) - ( a + ( b - a ) * sx ) ) * sy;
	};
}

// Periodic Worley: returns F2 - F1 (0 on cell borders).
function makePeriodicWorley( period, seed ) {
	const rnd = mulberry32( seed );
	const pts = new Float32Array( period * period * 2 );
	for ( let i = 0; i < pts.length; i ++ ) pts[ i ] = 0.1 + rnd() * 0.8;
	return ( u, v ) => {
		const cx = Math.floor( u ), cy = Math.floor( v );
		let f1 = 9, f2 = 9;
		for ( let j = - 1; j <= 1; j ++ ) for ( let i = - 1; i <= 1; i ++ ) {
			const gx = cx + i, gy = cy + j;
			const k = ( ( ( gy % period ) + period ) % period ) * period + ( ( ( gx % period ) + period ) % period );
			const px = gx + pts[ k * 2 ], py = gy + pts[ k * 2 + 1 ];
			const d = Math.hypot( px - u, py - v );
			if ( d < f1 ) { f2 = f1; f1 = d; } else if ( d < f2 ) f2 = d;
		}
		return f2 - f1;
	};
}

// Tileable fbm: every octave uses a lattice whose period equals its frequency.
function makeFbm( base, oct, seed ) {
	const fns = [];
	for ( let o = 0; o < oct; o ++ ) fns.push( { f: base << o, fn: makePeriodicValue( base << o, seed + o * 17 ) } );
	return ( u, v ) => {
		let s = 0, a = 1, n = 0;
		for ( const { f, fn } of fns ) { s += a * fn( u * f, v * f ); n += a; a *= 0.5; }
		return s / n;
	};
}

// RGBA8 tileable detail texture:
//  R: fine value-noise fbm   G: Worley borders (large cells)
//  B: mid fbm                A: Worley borders (small cells)
export function makeDetailTexture( size = 512, seed = 7 ) {
	const fA = makeFbm( 16, 3, seed ), fB = makeFbm( 4, 4, seed + 100 );
	const wA = makePeriodicWorley( 8, seed + 2 ), wB = makePeriodicWorley( 24, seed + 3 );
	const data = new Uint8Array( size * size * 4 );
	for ( let j = 0; j < size; j ++ ) for ( let i = 0; i < size; i ++ ) {
		const u = i / size, v = j / size;
		const k = ( j * size + i ) * 4;
		data[ k ] = fA( u, v ) * 255;
		data[ k + 1 ] = Math.min( 1, wA( u * 8, v * 8 ) * 1.4 ) * 255;
		data[ k + 2 ] = fB( u, v ) * 255;
		data[ k + 3 ] = Math.min( 1, wB( u * 24, v * 24 ) * 1.4 ) * 255;
	}
	return data;
}

// Foliage atlas (2x2 tiles, RGBA, drawn on a canvas):
//  tile 0 (0,0): broadleaf spray (oak)    tile 1 (1,0): needle spray (pine)
//  tile 2 (0,1): small round leaves (birch/bush)   tile 3 (1,1): grass blades
// RGB is a grey luminance/variation map (tinted per instance in TSL), A = mask.
export function makeFoliageAtlas( size = 1024, seed = 11 ) {
	const rnd = mulberry32( seed );
	const cv = document.createElement( 'canvas' );
	cv.width = cv.height = size;
	const g = cv.getContext( '2d' );
	g.clearRect( 0, 0, size, size );
	const T = size / 2;
	const leaf = ( x, y, len, wid, ang, lum ) => {
		g.save(); g.translate( x, y ); g.rotate( ang );
		const c = Math.round( lum * 255 );
		g.fillStyle = `rgb(${c},${c},${c})`;
		g.beginPath();
		g.moveTo( 0, 0 );
		g.bezierCurveTo( wid, len * 0.25, wid * 0.9, len * 0.75, 0, len );
		g.bezierCurveTo( - wid * 0.9, len * 0.75, - wid, len * 0.25, 0, 0 );
		g.fill();
		// midrib
		g.strokeStyle = `rgba(${Math.round( c * 0.7 )},${Math.round( c * 0.7 )},${Math.round( c * 0.7 )},0.8)`;
		g.lineWidth = Math.max( 1, wid * 0.12 );
		g.beginPath(); g.moveTo( 0, 0 ); g.lineTo( 0, len * 0.92 ); g.stroke();
		g.restore();
	};
	const twig = ( x0, y0, x1, y1, w ) => {
		g.strokeStyle = 'rgb(70,60,45)'; g.lineWidth = w; g.lineCap = 'round';
		g.beginPath(); g.moveTo( x0, y0 ); g.lineTo( x1, y1 ); g.stroke();
	};
	// tile 0: oak spray — many lobed leaves radiating from twigs
	g.save(); g.beginPath(); g.rect( 0, 0, T, T ); g.clip();
	for ( let b = 0; b < 5; b ++ ) {
		const a = - Math.PI / 2 + ( b - 2 ) * 0.5;
		const x1 = T / 2 + Math.cos( a ) * T * 0.42, y1 = T * 0.95 + Math.sin( a ) * T * 0.8;
		twig( T / 2, T * 0.98, x1, y1, 3 );
		for ( let k = 0; k < 16; k ++ ) {
			const t = 0.25 + rnd() * 0.75;
			const x = T / 2 + ( x1 - T / 2 ) * t, y = T * 0.98 + ( y1 - T * 0.98 ) * t;
			leaf( x, y, T * ( 0.1 + rnd() * 0.07 ), T * ( 0.035 + rnd() * 0.02 ), a + Math.PI / 2 + ( rnd() - 0.5 ) * 2.4, 0.55 + rnd() * 0.45 );
		}
	}
	g.restore();
	// tile 1: needle sprays
	g.save(); g.beginPath(); g.rect( T, 0, T, T ); g.clip();
	for ( let b = 0; b < 7; b ++ ) {
		const y = T * ( 0.12 + b * 0.12 ), x0 = T + T * 0.08, x1 = T + T * 0.92;
		twig( x0, y + T * 0.05, x1, y, 2 );
		for ( let k = 0; k < 70; k ++ ) {
			const t = rnd();
			const x = x0 + ( x1 - x0 ) * t, yy = y + T * 0.05 * ( 1 - t );
			const s = rnd() < 0.5 ? - 1 : 1;
			const L = T * ( 0.05 + rnd() * 0.035 ) * ( 1 - t * 0.4 );
			const c = Math.round( ( 0.5 + rnd() * 0.5 ) * 255 );
			g.strokeStyle = `rgb(${c},${c},${c})`; g.lineWidth = 1.6;
			g.beginPath(); g.moveTo( x, yy ); g.lineTo( x + L * 0.5, yy + s * L ); g.stroke();
		}
	}
	g.restore();
	// tile 2: small round leaves
	g.save(); g.beginPath(); g.rect( 0, T, T, T ); g.clip();
	for ( let k = 0; k < 150; k ++ ) {
		const a = rnd() * Math.PI * 2, r = Math.sqrt( rnd() ) * T * 0.44;
		leaf( T / 2 + Math.cos( a ) * r, T * 1.5 + Math.sin( a ) * r, T * ( 0.06 + rnd() * 0.04 ), T * ( 0.03 + rnd() * 0.02 ), rnd() * Math.PI * 2, 0.5 + rnd() * 0.5 );
	}
	g.restore();
	// tile 3: grass blades rooted at the bottom edge
	g.save(); g.beginPath(); g.rect( T, T, T, T ); g.clip();
	for ( let k = 0; k < 90; k ++ ) {
		const x = T + T * ( 0.08 + rnd() * 0.84 ), H = T * ( 0.45 + rnd() * 0.5 ), bend = ( rnd() - 0.5 ) * T * 0.35, w = T * ( 0.012 + rnd() * 0.012 );
		const c = Math.round( ( 0.45 + rnd() * 0.55 ) * 255 );
		g.fillStyle = `rgb(${c},${c},${c})`;
		g.beginPath();
		g.moveTo( x - w, 2 * T );
		g.quadraticCurveTo( x - w * 0.5 + bend * 0.5, 2 * T - H * 0.6, x + bend, 2 * T - H );
		g.quadraticCurveTo( x + w * 0.5 + bend * 0.5, 2 * T - H * 0.6, x + w, 2 * T );
		g.fill();
	}
	g.restore();
	return cv;
}
