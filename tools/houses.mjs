// Review sheet for the buildings (after Makone's skills/object/review.md, MIT): one house of each
// type, seen from several sides, plus its measurements in metres against reference ranges, so a
// judgement like "the roof looks too low" becomes a number.
//   node tools/houses.mjs [types...] [--pick=<index in BUILDINGS>] [--context]
//   types: round long granary hut lookout (default: all)
// Per type it picks the house standing furthest from the others (least occluded) and writes
// shots/houses_<type>.png: front and back at eye level, a raised three-quarter view, the plan from
// above and the same house at 60 m (the silhouette test: does it still read?). Vegetation, rocks,
// grass, smoke and birds are hidden unless --context.
// Measurements come from horizontal raycasts against the buildings at 0.2 m steps (the profile
// r(h) of the house around its centre, median over many directions so the clutter by the door
// does not count) and from the centre outwards (the inner face of the wall: a roof that comes down
// over the wall hides it from outside): visible wall height, overhang, roof pitch, apex height.
// The outer size assumes 0.5 m walls.
import puppeteer from 'puppeteer-core';

const args = process.argv.slice( 2 );
const TYPES = [ 'round', 'long', 'granary', 'hut', 'lookout' ];
const types = args.filter( ( a ) => TYPES.includes( a ) );
const pick = args.find( ( a ) => a.startsWith( '--pick=' ) );
const context = args.includes( '--context' );
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// Reference ranges (approximate; European Iron Age; Galician castro houses are small round stone
// houses, mostly 4-6 m across). A guide for the review, not a rule: edit to taste.
//   [ min, max ] in metres / degrees
const REF = {
	round: { diameter: [ 4, 10 ], wall: [ 1.5, 2.3 ], pitch: [ 40, 55 ], overhang: [ 0.3, 1.0 ], roofShare: [ 0.45, 0.7 ] },
	long: { width: [ 5, 8 ], wall: [ 1.8, 2.6 ], pitch: [ 45, 55 ], overhang: [ 0.3, 0.9 ], roofShare: [ 0.45, 0.7 ] },
	hut: { diameter: [ 3, 6 ], wall: [ 1.0, 2.0 ], pitch: [ 45, 60 ], overhang: [ 0.2, 0.8 ] },
	granary: { pitch: [ 40, 55 ] },
	lookout: {}
};

const browser = await puppeteer.launch( {
	executablePath: EDGE, headless: 'new', protocolTimeout: 900000,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,900' ],
	defaultViewport: { width: 1600, height: 900 }
} );
const page = await browser.newPage();
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', String( e ).slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5190/?auto', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__app && window.__app.ready, { timeout: 300000, polling: 500 } );

const out = await page.evaluate( async ( types, pickIndex, context, REF ) => {
	const a = window.__app, T = a.THREE;
	const { BUILDINGS, FORT } = await import( '/src/world/layout.js' );
	const { doorAngle } = await import( '/src/world/buildings.js' );
	const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
	a.dynamicRes = false;
	a.setFocus?.( false );
	if ( ! context ) for ( const k of [ 'vegetation', 'grass', 'rocks', 'smoke', 'gulls', 'birds' ] ) if ( a.layers[ k ] ) a.layers[ k ].object.visible = false;
	const houses = a.layers.buildings.object;
	const ray = new T.Raycaster();
	const v = ( x, y, z ) => new T.Vector3( x, y, z );
	const size = ( b ) => b.r ?? ( b.l ? Math.max( b.w, b.l ) / 2 : 2.5 );

	// the house of a type standing furthest from the others
	const choose = ( type ) => {
		if ( pickIndex !== null && BUILDINGS[ pickIndex ]?.type === type ) return BUILDINGS[ pickIndex ];
		let best = null, bestD = - Infinity;
		for ( const b of BUILDINGS ) {
			if ( b.type !== type ) continue;
			let d = Infinity;
			for ( const o of BUILDINGS ) if ( o !== b ) d = Math.min( d, Math.hypot( o.x - b.x, o.z - b.z ) - size( o ) - size( b ) );
			// and away from the castro's walls (inside them every low view is blocked)
			d = Math.min( d, Math.abs( Math.hypot( FORT.x - b.x, FORT.z - b.z ) - FORT.radius ) - size( b ) - 3 );
			if ( d > bestD ) { bestD = d; best = b; }
		}
		return best;
	};

	// distance from the centre of the first surface met coming in from outside, at height h
	const reach = ( C, g, u, h, S ) => {
		const R0 = S + 4;
		ray.set( v( C.x + u.x * R0, g + h, C.z + u.z * R0 ), v( - u.x, 0, - u.z ) );
		ray.far = R0;
		const hit = ray.intersectObject( houses, true )[ 0 ];
		return hit ? R0 - hit.distance : null;
	};
	const median = ( xs ) => { const s = xs.filter( ( x ) => x !== null ).sort( ( p, q ) => p - q ); return s.length ? s[ s.length >> 1 ] : null; };
	// profile r(h) along a set of directions
	const profile = ( C, g, dirs, S, Hmax ) => {
		const rows = [];
		for ( let h = 0.2; h <= Hmax; h += 0.2 ) rows.push( { h: +h.toFixed( 1 ), r: median( dirs.map( ( u ) => reach( C, g, u, h, S ) ) ) } );
		return rows;
	};
	const topAt = ( x, z ) => {
		ray.set( v( x, 500, z ), v( 0, - 1, 0 ) ); ray.far = 1000;
		const hit = ray.intersectObject( houses, true )[ 0 ];
		return hit ? hit.point.y : null;
	};
	// from the centre outwards at height h: the inner face of the wall
	const inner = ( C, g, u, h, S ) => {
		ray.set( v( C.x, g + h, C.z ), u ); ray.far = S + 4;
		const hit = ray.intersectObject( houses, true )[ 0 ];
		return hit ? hit.distance : null;
	};
	// wall, eave, overhang and pitch. The wall is measured from inside (the roof can come down over
	// it, and then every ray from outside meets the thatch first); the visible wall ends where the
	// rays from outside start meeting something further out than the wall: the roof.
	const WALL_T = 0.5; // typical wall thickness, for the outer size
	const analyse = ( rows, C, g, dirs, S ) => {
		const rin = median( dirs.map( ( u ) => inner( C, g, u, 1.0, S ) ) );
		const wallOut = rin !== null ? rin + WALL_T : null;
		const maxRow = rows.reduce( ( m, r ) => ( r.r ?? - 1 ) > ( m?.r ?? - 1 ) ? r : m, null );
		const maxR = maxRow?.r ?? null;
		// lowest height where the profile reaches past the wall: the lower edge of the roof
		const edge = wallOut !== null ? rows.find( ( r ) => r.r !== null && r.r > wallOut + 0.2 ) : null;
		const wall = edge ? Math.max( 0, edge.h - 0.2 ) : null;
		// pitch: the roof slope between 80 % and 35 % of its reach, above its widest point
		const above = rows.filter( ( r ) => maxRow && r.h >= maxRow.h && r.r !== null );
		const p1 = above.find( ( r ) => r.r <= maxR * 0.8 ), p2 = above.find( ( r ) => r.r <= maxR * 0.35 );
		const pitch = p1 && p2 && p1.r > p2.r ? Math.atan2( p2.h - p1.h, p1.r - p2.r ) * 180 / Math.PI : null;
		return { rin, wallOut, wall, maxR, overhang: wallOut !== null && maxR !== null ? maxR - wallOut : null, pitch };
	};

	const results = [];
	for ( const type of types ) {
		const b = choose( type );
		if ( ! b ) continue;
		const C = v( b.x, 0, b.z ), g = a.hf.heightAt( b.x, b.z ), S = size( b );
		const top = topAt( b.x, b.z );
		const apex = top !== null ? top - g : null;
		const Hmax = ( apex ?? 10 ) + 0.6;
		const facts = { type, index: BUILDINGS.indexOf( b ), at: [ b.x, b.z ], ground: +g.toFixed( 1 ), apex: apex !== null ? +apex.toFixed( 2 ) : null };
		let front;
		if ( type === 'long' ) {
			const c = Math.cos( b.rot ), s = Math.sin( b.rot );
			const across = [ v( c, 0, - s ), v( - c, 0, s ) ], along = [ v( s, 0, c ), v( - s, 0, - c ) ];
			const pa = analyse( profile( C, g, across, S, Hmax ), C, g, across, S ), pl = analyse( profile( C, g, along, S, Hmax ), C, g, along, S );
			Object.assign( facts, { width: pa.wallOut * 2, interior: pa.rin * 2, wall: pa.wall, overhang: pa.overhang, pitch: pa.pitch, length: pl.wallOut * 2, roofLength: pl.maxR * 2 } );
			front = across[ 0 ]; // the door side
		} else {
			const dirs = [];
			for ( let k = 0; k < 24; k ++ ) { const t = k / 24 * Math.PI * 2; dirs.push( v( Math.cos( t ), 0, Math.sin( t ) ) ); }
			const p = analyse( profile( C, g, dirs, S, Hmax ), C, g, dirs, S );
			Object.assign( facts, { diameter: p.wallOut * 2, interior: p.rin * 2, wall: p.wall, overhang: p.overhang, pitch: p.pitch, roofDiameter: p.maxR * 2 } );
			const d = type === 'round' || type === 'hut' ? doorAngle( b ) : 0.6;
			front = v( Math.cos( d ), 0, Math.sin( d ) );
		}
		if ( facts.apex && facts.wall !== null ) facts.roofShare = 1 - facts.wall / facts.apex;
		for ( const k of Object.keys( facts ) ) if ( typeof facts[ k ] === 'number' ) facts[ k ] = +facts[ k ].toFixed( 2 );
		// against the reference ranges
		const flags = [];
		for ( const [ k, [ lo, hi ] ] of Object.entries( REF[ type ] || {} ) ) {
			const x = facts[ k ];
			if ( x === null || x === undefined ) flags.push( `${ k }: not measured` );
			else if ( x < lo || x > hi ) flags.push( `${ k } ${ x } outside ${ lo }-${ hi }` );
		}
		facts.flags = flags;

		// views (camera stands on the ground or above it). Each one keeps a clear line of sight:
		// if the ground, the fort or another building is in the way, the camera turns around the
		// house until it is not.
		const H = apex ?? 6;
		const fort = a.layers.fort.object;
		const midY = g + H * 0.45;
		const mid = [ b.x, midY, b.z ];
		// the camera sees five points of the house: centre, both sides, top and foot
		const sees = ( p, to ) => {
			const dir = to.clone().sub( p ), dist = dir.length();
			for ( let k = 1; k < 40; k ++ ) {
				const q = p.clone().addScaledVector( dir, k / 40 );
				if ( Math.hypot( q.x - b.x, q.z - b.z ) < S + 1 ) break;
				if ( q.y < a.hf.heightAt( q.x, q.z ) + 0.2 ) return false;
			}
			ray.set( p, dir.normalize() ); ray.far = dist;
			const hit = ray.intersectObjects( [ houses, fort ], true )[ 0 ];
			return ! hit || hit.distance > dist - ( S + 1.5 );
		};
		// score of a camera position: house points in sight (0..5), minus clutter right in front of
		// the lens (anything closer than 5 m within the view) and minus looking into the sun
		const score = ( p ) => {
			// never inside another building (rays from within a roof see nothing) or on the castro wall
			for ( const o of BUILDINGS ) if ( o !== b && Math.hypot( o.x - p.x, o.z - p.z ) < size( o ) + 2.5 ) return - 10;
			if ( Math.abs( Math.hypot( FORT.x - p.x, FORT.z - p.z ) - FORT.radius ) < 4 ) return - 10;
			const u = v( b.x - p.x, 0, b.z - p.z ).normalize(), sd = v( - u.z, 0, u.x ).multiplyScalar( S * 0.8 );
			const c = v( b.x, midY, b.z );
			let n = [ c, c.clone().add( sd ), c.clone().sub( sd ), v( b.x, g + H * 0.85, b.z ), v( b.x, g + 0.8, b.z ) ].filter( ( t ) => sees( p, t ) ).length;
			const look = v( b.x, midY, b.z ).sub( p ).normalize();
			// against the sun the house is a glare-washed silhouette: look elsewhere if possible
			const sun = a.sky.state.sunDir, sl = Math.hypot( sun.x, sun.z ) || 1, ll = Math.hypot( look.x, look.z ) || 1;
			if ( ( look.x * sun.x + look.z * sun.z ) / ( sl * ll ) > 0.45 ) n -= 2;
			for ( const yaw of [ - 0.6, - 0.3, 0, 0.3, 0.6 ] ) for ( const pitch of [ - 0.25, 0.1 ] ) {
				const d = look.clone().applyAxisAngle( v( 0, 1, 0 ), yaw ); d.y += pitch; d.normalize();
				ray.set( p, d ); ray.far = 5;
				if ( ray.intersectObjects( [ houses, fort ], true ).length ) { n -= 1; break; }
			}
			return n;
		};
		// around the house (and, for the far view, also higher up), the best position
		const place = ( u, dist, y, ys = [ 0 ] ) => {
			const base = Math.atan2( u.z, u.x );
			let best = null, bestS = - Infinity;
			for ( const dy of ys ) for ( const off of [ 0, 25, - 25, 50, - 50, 75, - 75, 105, - 105, 135, - 135, 180 ] ) {
				const t = base + off * Math.PI / 180;
				const p = v( b.x + Math.cos( t ) * dist, y + dy, b.z + Math.sin( t ) * dist );
				p.y = Math.max( p.y, a.hf.heightAt( p.x, p.z ) + 1.7 + dy );
				const sc = score( p );
				if ( sc > bestS ) { bestS = sc; best = p; }
				if ( sc === 5 ) return p.toArray();
			}
			return best.toArray();
		};
		const side = v( - front.z, 0, front.x );
		const D = S * 2.4 + 5;
		const views = [
			[ 'frente', place( front, D, g + 1.7, [ 0, 2 ] ), mid ],
			[ 'trás', place( front.clone().negate(), D, g + 1.7, [ 0, 2 ] ), mid ],
			[ '3/4 alto', place( front.clone().add( side ).normalize(), D * 1.1, g + H + S * 1.2 + 3 ), mid ],
			[ 'planta', [ b.x + 0.01, g + H + S * 3.2 + 12, b.z + 0.01 ], [ b.x, g, b.z ] ],
			[ 'a 60 m', place( front.clone().add( side.clone().multiplyScalar( - 0.5 ) ).normalize(), 60, g + 4, [ 0, 8, 18 ] ), mid ]
		];
		const blobs = [];
		for ( const [ label, pos, target ] of views ) {
			a.views.push( { label: 'qa', pos, target } ); a.setView( a.views.length - 1 ); a.views.pop();
			await sleep( 700 );
			await a.capture( `houses_${ type }_${ blobs.length }`, 800, 450 );
			blobs.push( [ label, a.lastCaptureBlob ] );
		}
		// contact sheet: 3 x 2, the sixth cell holds the facts
		const W = 800, Hc = 450, sheet = new OffscreenCanvas( W * 3, Hc * 2 ), c2 = sheet.getContext( '2d' );
		c2.fillStyle = '#16191d'; c2.fillRect( 0, 0, W * 3, Hc * 2 );
		for ( let i = 0; i < blobs.length; i ++ ) {
			const [ label, blob ] = blobs[ i ];
			const x = ( i % 3 ) * W, y = Math.floor( i / 3 ) * Hc;
			c2.drawImage( await createImageBitmap( blob ), x, y, W, Hc );
			c2.fillStyle = 'rgba(0,0,0,0.55)'; c2.fillRect( x, y, 150, 34 );
			c2.fillStyle = '#fff'; c2.font = '20px sans-serif'; c2.fillText( label, x + 10, y + 24 );
		}
		const lines = [ `${ type } #${ facts.index } em (${ facts.at })`, '' ];
		const show = [ [ 'altura total', 'apex', 'm' ], [ 'diâmetro (parede)', 'diameter', 'm' ], [ type === 'long' ? 'largura interna' : 'diâmetro interno', 'interior', 'm' ], [ 'diâmetro do telhado', 'roofDiameter', 'm' ], [ 'largura (parede)', 'width', 'm' ], [ 'comprimento', 'length', 'm' ], [ 'comprim. do telhado', 'roofLength', 'm' ],
			[ 'parede visível', 'wall', 'm' ], [ 'beiral', 'overhang', 'm' ], [ 'inclinação', 'pitch', '°' ], [ 'telhado / altura', 'roofShare', '' ] ];
		for ( const [ name, k, unit ] of show ) {
			if ( facts[ k ] === undefined ) continue;
			const ref = REF[ type ]?.[ k ];
			const x = facts[ k ];
			const bad = ref && ( x === null || x < ref[ 0 ] || x > ref[ 1 ] );
			lines.push( `${ bad ? '✗' : '·' } ${ name }: ${ x ?? '—' } ${ unit }${ ref ? `   (ref. ${ ref[ 0 ] }–${ ref[ 1 ] })` : '' }` );
		}
		c2.font = '22px monospace';
		lines.forEach( ( t, i ) => { c2.fillStyle = t.startsWith( '✗' ) ? '#ff8a6a' : '#e8e4da'; c2.fillText( t, W * 2 + 24, Hc + 44 + i * 34 ); } );
		const png = await sheet.convertToBlob( { type: 'image/png' } );
		await fetch( '/__capture?name=' + encodeURIComponent( `houses_${ type }` ), { method: 'POST', body: png } );
		results.push( facts );
	}
	return results;
}, types.length ? types : TYPES, pick ? Number( pick.slice( 7 ) ) : null, context, REF );

for ( const f of out ) {
	console.log( `\n${ f.type } #${ f.index } (${ f.at }) -> shots/houses_${ f.type }.png` );
	const { type, index, at, flags, ...rest } = f;
	console.log( '  ' + Object.entries( rest ).map( ( [ k, x ] ) => `${ k } ${ x }` ).join( ' | ' ) );
	for ( const fl of flags ) console.log( '  ✗ ' + fl );
}
await browser.close();
