// Visiting together: friends join a room from an invite link (?sala=<id>) and see each other in the
// village as a lantern carried at eye height, with the name over it; the hour, the time passing, the
// clouds, the rain and the fog are shared. Peer to peer (WebRTC through Trystero,
// https://github.com/dmotz/trystero, MIT, Copyright (c) 2021 Dan Motzenbecker, licenses/LICENSE-trystero.md):
// public Nostr relays only introduce the browsers to each other, there is no server of our own, so it
// works on the static site (GitHub Pages). Without a TURN server, two peers both behind a symmetric NAT
// (some mobile and corporate networks) cannot connect.
//
// The scheme follows offroad's multiplayer.js (https://github.com/alexadrerui/offroad, MIT, Copyright (c)
// 2026 Arz-Gev, licenses/LICENSE-offroad.md): each visitor sends its own state (here the camera: position,
// yaw, pitch) as a flat JSON array; the receiver keeps a short buffer, estimates the clock offset as the
// smallest `now - senderTime` seen (creeping up for drift), plays back DELAY behind and extrapolates a
// moment when packets are late. Rewritten for a free camera instead of a truck; the shared world is ours.
//
// Nothing is built at load: Trystero is imported on the first join (its own chunk) and the lantern's two
// materials are compiled then, so a visit alone costs no pipeline (verify unchanged). No light per
// lantern: a light changes the lights' hash and recompiles every lit material; the glow is an HDR colour
// that the bloom picks up.

import * as THREE from 'three/webgpu';
import { color, float, sin, time, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Clock } from '../world/clock.js';

const APP_ID = 'castro-do-mar-alexadrerui';
const SEND_HZ = 10;          // a camera moves smoothly: 10 states a second are plenty
const DELAY = 0.15;          // playback behind the newest snapshot (s)
const EXTRAP = 0.4;          // longest extrapolation when packets are late (s)
const BUF = 24;              // snapshots kept per friend
const WORLD_POLL = 0.25;     // s between checks of the shared world for a local change
const LANTERN_DROP = 0.45;   // the lantern hangs this far below the visitor's eye (m)

export const roomFromURL = () => {
	const r = new URLSearchParams( location.search ).get( 'sala' );
	return r && /^[a-z0-9-]{3,40}$/i.test( r ) ? r : null;
};
const newRoomId = () => Array.from( crypto.getRandomValues( new Uint8Array( 6 ) ), ( b ) => 'abcdefghjkmnpqrstuvwxyz23456789'[ b % 31 ] ).join( '' );
const inviteURL = ( id ) => `${ location.origin }${ location.pathname }?sala=${ id }`;
const r2 = ( x ) => Math.round( x * 100 ) / 100;
const r3 = ( x ) => Math.round( x * 1000 ) / 1000;
const wrapPi = ( a ) => a - Math.round( a / ( 2 * Math.PI ) ) * 2 * Math.PI;
const escapeHTML = ( s ) => String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ c ] );

// the lantern: an iron frame (base, cap, four posts, a ring to hold it) around a glowing pane and flame
function lanternGeometry() {
	const frame = [], glow = [];
	const box = ( w, h, d, y ) => new THREE.BoxGeometry( w, h, d ).translate( 0, y, 0 );
	frame.push( box( 0.17, 0.025, 0.17, - 0.12 ), box( 0.15, 0.02, 0.15, 0.115 ) );
	frame.push( new THREE.ConeGeometry( 0.1, 0.07, 4, 1 ).rotateY( Math.PI / 4 ).translate( 0, 0.16, 0 ) );
	frame.push( new THREE.TorusGeometry( 0.03, 0.006, 4, 10 ).translate( 0, 0.215, 0 ) );
	for ( const [ x, z ] of [ [ 1, 1 ], [ 1, - 1 ], [ - 1, 1 ], [ - 1, - 1 ] ] ) frame.push( box( 0.012, 0.23, 0.012, 0 ).translate( x * 0.07, 0, z * 0.07 ) );
	glow.push( box( 0.125, 0.2, 0.125, 0 ) );
	const strip = ( g ) => { g.deleteAttribute( 'uv' ); return g.index ? g.toNonIndexed() : g; };
	return { frame: mergeGeometries( frame.map( strip ) ), glow: mergeGeometries( glow.map( strip ) ) };
}

export class Multiplayer {

	// app: camera, scene, freecam, clock, settings, hud
	constructor( app ) {
		this.app = app;
		this.room = null;
		this.roomId = null;
		this.peers = new Map();       // peerId -> { name, buf, lantern, tag, off, since }
		this.sendAcc = 0;
		this.worldAcc = 0;
		this.shareWorld = true;       // the panel's "Hora e tempo juntos"
		this.follow = false;          // joined from a link: fly to the first friend heard from
		this.listeners = [];          // the panel follows the room
		this.joinedAt = 0;
		this.group = new THREE.Group();
		this.group.name = 'visitors';
		this.tags = document.createElement( 'div' );
		this.tags.id = 'mp-tags';
		document.body.appendChild( this.tags );
		addEventListener( 'pagehide', () => this.room?.leave() );
		app.onFrame.push( ( dt ) => this.update( dt ) );
	}

	get name() {
		const s = this.app.settings;
		if ( ! s.name ) s.setName( 'Visitante ' + ( 10 + Math.floor( Math.random() * 90 ) ) );
		return s.name;
	}
	get count() { return this.peers.size; }

	// the panel's status line
	get note() {
		if ( ! this.room ) return '';
		const names = [ ...this.peers.values() ].map( ( p ) => p.name ).filter( Boolean );
		return `Sala <b>${ this.roomId }</b> · ` + ( names.length ? 'com ' + names.map( escapeHTML ).join( ', ' ) : 'esperando alguém abrir o link' );
	}

	_changed() { for ( const f of this.listeners ) f(); }

	async join( id, { follow = false } = {} ) {
		if ( this.room ) return;
		this.roomId = id;
		this.follow = follow;
		this.joinedAt = performance.now();
		this._buildLanternMaterials();
		const { joinRoom } = await import( 'trystero' );
		const room = this.room = joinRoom( { appId: APP_ID }, id );
		this.hello = room.makeAction( 'hi' );
		this.state = room.makeAction( 'st' );
		this.world = room.makeAction( 'w' );
		room.onPeerJoin = ( peerId ) => { this._peer( peerId ); this.hello.send( this._helloData(), { target: peerId } ); };
		room.onPeerLeave = ( peerId ) => this._drop( peerId );
		this.hello.onMessage = ( h, { peerId } ) => this._onHello( peerId, h );
		this.state.onMessage = ( s, { peerId } ) => this._onState( peerId, s );
		this.world.onMessage = ( w, { peerId } ) => this._onWorld( peerId, w );
		this.expected = this._worldNow();
		this._changed();
	}

	// Convidar: open a room if there is none (its id goes into the address), then copy its link
	async invite() {
		if ( ! this.room ) {
			const id = newRoomId();
			const url = new URL( location.href ); url.searchParams.set( 'sala', id );
			history.replaceState( null, '', url.href.replace( /=(?=&|$)/g, '' ) );
			await this.join( id );
		}
		const link = inviteURL( this.roomId );
		try {
			await navigator.clipboard.writeText( link );
			this.app.hud?.toast( 'Link copiado: mande para quem vai visitar junto', 2600 );
		} catch ( e ) {
			window.prompt( 'Copie o link e mande para quem vai visitar junto:', link );
		}
		return link;
	}

	async leave() {
		if ( ! this.room ) return;
		const room = this.room;
		this.room = null;
		for ( const id of [ ...this.peers.keys() ] ) this._drop( id, true );
		const url = new URL( location.href ); url.searchParams.delete( 'sala' );
		history.replaceState( null, '', url.href.replace( /=(?=&|$)/g, '' ) );
		this.roomId = null;
		this._changed();
		// the relays' goodbye can take a while: the room is already gone here
		await room.leave().catch( () => {} );
	}

	rename( name ) {
		name = String( name ).trim().slice( 0, 24 );
		if ( ! name ) return;
		this.app.settings.setName( name );
		if ( this.room ) this.hello.send( this._helloData() );
	}

	// fly to a friend: a few metres behind and above their lantern, looking at it
	goTo( peerId ) {
		const p = this.peers.get( peerId );
		if ( ! p || ! p.lantern ) return;
		const at = p.lantern.position, yaw = p.yaw ?? 0;
		const back = new THREE.Vector3( Math.sin( yaw ), 0, Math.cos( yaw ) ).multiplyScalar( 6 );
		const pos = at.clone().add( back ); pos.y += 1.6;
		const ground = this.app.freecam.groundFn?.( pos.x, pos.z );
		if ( ground !== undefined ) pos.y = Math.max( pos.y, ground + 1.7 );
		this.app.freecam.flyTo( pos, at.clone(), 2.2 );
	}

	// ---------------------------------------------------------------- peers

	_helloData() {
		return { name: this.name, since: performance.now() - this.joinedAt, world: this.shareWorld ? this._worldNow() : null };
	}

	_peer( peerId ) {
		let p = this.peers.get( peerId );
		if ( p ) return p;
		p = { name: '', buf: [], off: Infinity, lantern: null, tag: null, yaw: 0, since: 0 };
		this.peers.set( peerId, p );
		const lantern = new THREE.Group();
		lantern.add( new THREE.Mesh( this.geo.frame, this.frameMat ), new THREE.Mesh( this.geo.glow, this.glowMat ) );
		lantern.visible = false;   // until its first state
		this.group.add( lantern );
		p.lantern = lantern;
		p.tag = document.createElement( 'div' );
		p.tag.className = 'mp-tag';
		p.tag.hidden = true;
		this.tags.appendChild( p.tag );
		if ( ! this.group.parent ) this.app.scene.add( this.group );
		this._changed();
		return p;
	}

	_drop( peerId, quiet = false ) {
		const p = this.peers.get( peerId );
		if ( ! p ) return;
		this.group.remove( p.lantern );
		p.tag.remove();
		this.peers.delete( peerId );
		if ( p.name && ! quiet ) this.app.hud?.toast( p.name + ' saiu' );
		this._changed();
	}

	_onHello( peerId, h ) {
		const p = this._peer( peerId );
		const first = ! p.name;
		p.name = String( h?.name ?? '' ).slice( 0, 24 ) || 'Visitante';
		p.since = +h?.since || 0;
		p.tag.textContent = p.name;
		if ( first ) this.app.hud?.toast( p.name + ' entrou na visita' );
		// the newcomer takes the world of whoever has been in the room longer
		if ( first && this.shareWorld && h?.world && p.since > performance.now() - this.joinedAt ) this._applyWorld( h.world );
		this._changed();
	}

	_onState( peerId, s ) {
		if ( ! Array.isArray( s ) || s.length < 6 ) return;
		const p = this._peer( peerId );
		const now = performance.now() / 1000;
		// clock offset: the smallest now − sender time seen, allowed to creep up slowly (drift, a jump)
		p.off = Math.min( p.off + 0.002, now - s[ 0 ] );
		const last = p.buf[ p.buf.length - 1 ];
		if ( last && s[ 0 ] <= last[ 0 ] ) return;
		p.buf.push( s );
		if ( p.buf.length > BUF ) p.buf.shift();
	}

	// the friend's pose DELAY behind their newest state: interpolated, or extrapolated a moment
	_pose( p, now, out ) {
		const b = p.buf;
		if ( ! b.length ) return false;
		const t = now - p.off - DELAY;
		let i = b.length - 1;
		while ( i > 0 && b[ i - 1 ][ 0 ] > t ) i --;
		let a, c, k;
		if ( t >= b[ b.length - 1 ][ 0 ] ) {
			a = b[ Math.max( 0, b.length - 2 ) ]; c = b[ b.length - 1 ];
			const dt = c[ 0 ] - a[ 0 ];
			k = dt > 0 ? 1 + Math.min( t - c[ 0 ], EXTRAP ) / dt : 1;
		} else if ( i === 0 ) {
			a = c = b[ 0 ]; k = 0;
		} else {
			a = b[ i - 1 ]; c = b[ i ];
			k = ( t - a[ 0 ] ) / ( c[ 0 ] - a[ 0 ] );
		}
		out.x = a[ 1 ] + ( c[ 1 ] - a[ 1 ] ) * k;
		out.y = a[ 2 ] + ( c[ 2 ] - a[ 2 ] ) * k;
		out.z = a[ 3 ] + ( c[ 3 ] - a[ 3 ] ) * k;
		out.yaw = a[ 4 ] + wrapPi( c[ 4 ] - a[ 4 ] ) * Math.min( k, 1 );
		return true;
	}

	// ---------------------------------------------------------------- the shared world

	// read from the panel's own controls: the rain takes the clouds and the fog over while it lasts,
	// so the sliders (what the visitor asked for) are what is shared, not the uniforms
	_worldNow() {
		const c = this.app.clock, val = ( id ) => + document.getElementById( id ).value;
		return { hour: r3( c.hour ), playing: c.playing, speed: c.speed, clouds: val( 'r-cloud' ), rain: val( 'r-rain' ), fog: val( 'r-fog' ) };
	}

	_applyWorld( w ) {
		const app = this.app, hud = app.hud, c = app.clock;
		if ( Number.isFinite( w.speed ) ) hud.setRange( 'r-speed', w.speed );
		if ( Number.isFinite( w.clouds ) ) hud.setRange( 'r-cloud', w.clouds );
		if ( Number.isFinite( w.rain ) ) hud.setRange( 'r-rain', w.rain );
		if ( Number.isFinite( w.fog ) ) hud.setRange( 'r-fog', w.fog );
		if ( Number.isFinite( w.hour ) && Math.abs( wrap12( w.hour - c.hour ) ) > 0.005 ) c.set( w.hour );
		if ( typeof w.playing === 'boolean' && w.playing !== c.playing ) hud.setPlaying( w.playing );
		this.expected = this._worldNow();
	}

	_onWorld( peerId, w ) {
		if ( ! this.shareWorld || ! w ) return;
		const p = this.peers.get( peerId );
		this._applyWorld( w );
		if ( p?.name && w.say ) this.app.hud?.toast( p.name + ': ' + w.say );
	}

	// a change made here (a slider, a preset, the play button) goes to everyone; the hour running on its
	// own does not (every visitor's clock runs at the same speed)
	_checkWorld( dt ) {
		const e = this.expected, now = this._worldNow();
		if ( e.playing ) e.hour = ( e.hour + dt * e.speed / 60 ) % 24;
		const diff = [];
		if ( Math.abs( wrap12( now.hour - e.hour ) ) > 0.02 ) diff.push( 'hora ' + Clock.format( now.hour ) );
		if ( now.playing !== e.playing ) diff.push( now.playing ? 'o tempo passando' : 'o tempo parado' );
		const moved = ( k ) => Math.abs( now[ k ] - e[ k ] ) > 1e-3;
		if ( moved( 'speed' ) ) diff.push( 'velocidade do tempo' );
		if ( moved( 'clouds' ) ) diff.push( 'nuvens ' + Math.round( now.clouds * 100 ) + '%' );
		if ( moved( 'rain' ) ) diff.push( 'chuva ' + Math.round( now.rain * 100 ) + '%' );
		if ( moved( 'fog' ) ) diff.push( 'névoa ' + now.fog.toFixed( 2 ) + '×' );
		this.expected = now;
		if ( diff.length ) this.world.send( { ...now, say: diff[ 0 ] } );
	}

	// ---------------------------------------------------------------- per frame

	update( dt ) {
		if ( ! this.room ) return;
		const app = this.app, cam = app.camera;
		// our state
		this.sendAcc += dt;
		if ( this.sendAcc >= 1 / SEND_HZ && this.peers.size ) {
			this.sendAcc = 0;
			const e = this._euler || ( this._euler = new THREE.Euler() );
			e.setFromQuaternion( cam.quaternion, 'YXZ' );
			const p = cam.position;
			this.state.send( [ r3( performance.now() / 1000 ), r2( p.x ), r2( p.y ), r2( p.z ), r3( e.y ), r3( e.x ) ] );
		}
		this.worldAcc += dt;
		if ( this.worldAcc >= WORLD_POLL ) {
			if ( this.shareWorld && this.peers.size ) this._checkWorld( this.worldAcc );
			else this.expected = this._worldNow();
			this.worldAcc = 0;
		}
		// friends
		const now = performance.now() / 1000, pose = this._p || ( this._p = {} ), v = this._v || ( this._v = new THREE.Vector3() );
		const w = innerWidth, h = innerHeight;
		for ( const [ id, p ] of this.peers ) {
			if ( ! this._pose( p, now, pose ) ) continue;
			const L = p.lantern;
			L.visible = true;
			L.position.set( pose.x, pose.y - LANTERN_DROP, pose.z );
			L.rotation.set( 0, pose.yaw, 0 );
			p.yaw = pose.yaw;
			L.updateMatrixWorld();
			if ( this.follow && p.name ) { this.follow = false; this.goTo( id ); }
			// the name over the lantern; distance under it
			v.copy( L.position ); v.y += 0.35;
			const dist = v.distanceTo( cam.position );
			v.project( cam );
			const show = v.z < 1 && Math.abs( v.x ) < 1.1 && Math.abs( v.y ) < 1.1;
			p.tag.hidden = ! show || ! p.name;
			if ( show ) {
				p.tag.style.transform = `translate(${ ( ( v.x * 0.5 + 0.5 ) * w ).toFixed( 1 ) }px, ${ ( ( 0.5 - v.y * 0.5 ) * h ).toFixed( 1 ) }px) translate(-50%, -100%)`;
				p.tag.style.opacity = ( 1 - 0.6 * THREE.MathUtils.smoothstep( dist, 60, 600 ) ).toFixed( 2 );
				const d = dist < 1000 ? Math.round( dist ) + ' m' : ( dist / 1000 ).toFixed( 1 ) + ' km';
				if ( p._d !== d ) { p._d = d; p.tag.innerHTML = `${ escapeHTML( p.name ) }<small>${ d }</small>`; }
			}
		}
	}

	_buildLanternMaterials() {
		if ( this.geo ) return;
		this.geo = lanternGeometry();
		this.frameMat = new THREE.MeshStandardNodeMaterial( { color: 0x2b2722, roughness: 0.55, metalness: 0.6 } );
		// warm flame light, HDR so the bloom catches it, flickering a little
		this.glow = uniform( 3.2 );
		this.glowMat = new THREE.MeshBasicNodeMaterial();
		this.glowMat.colorNode = color( 1.0, 0.62, 0.28 ).mul( this.glow ).mul( float( 0.9 ).add( sin( time.mul( 13.0 ) ).mul( sin( time.mul( 7.3 ) ) ).mul( 0.1 ) ) );
	}

}

// a difference in hours folded to -12..12
function wrap12( d ) { return d - Math.round( d / 24 ) * 24; }
