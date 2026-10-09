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
import { reloadKeepingView } from './recovery.js';

const APP_ID = 'castro-do-mar-alexadrerui';
const SEND_HZ = 10;          // a camera moves smoothly: 10 states a second are plenty
const DELAY = 0.15;          // playback behind the newest snapshot (s)
const EXTRAP = 0.4;          // longest extrapolation when packets are late (s)
const BUF = 24;              // snapshots kept per friend
const WORLD_POLL = 0.25;     // s between checks of the shared world for a local change
const LANTERN_DROP = 0.45;   // the lantern hangs this far below the visitor's eye (m)

// The Nostr relays that introduce the visitors. Trystero's default is 5 of its list drawn by the app id,
// and for ours 3 of those 5 were down and the other 2 slow (07/10/2026: two friends never met). These 8
// each carried a test room on their own in 3-5 s (node tools/relays.mjs checks them again); every
// visitor talks to all of them, so a few going down does not keep anyone apart. ?relays=a,b overrides.
const RELAYS = [
	'wss://nos.lol',
	'wss://relay.primal.net',
	'wss://nostr.mom',
	'wss://nostr.oxtr.dev',
	'wss://basspistol.org',
	'wss://nostr-01.uid.ovh',
	'wss://bucket.coracle.social',
	'wss://nostr-relay.corb.net'
];
const relayList = () => {
	const q = new URLSearchParams( location.search ).get( 'relays' );
	return q ? q.split( ',' ).map( ( h ) => h.trim() ).filter( Boolean ).map( ( h ) => ( h.startsWith( 'wss://' ) ? h : 'wss://' + h ) ) : RELAYS;
};
// Alone in a room, the visitor leaves and joins it again this often: after a few minutes alone a
// Trystero room sometimes stopped hearing newcomers through the relays (tools/relays.mjs --late=300: 1
// in 3-4 rooms left alone 4-5 min never met the next visitor; refreshing every 90 s, 6 of 6 met, 4 of
// them only at the next refresh, ~26 s later: hence a shorter period).
const REFRESH = 45;          // s
const WAIT_HELP = 40;         // s alone in a room before the panel explains what to check
// A friend's connection lost (Trystero closes a peer after 5 s in ICE "disconnected": a Wi-Fi hiccup,
// a machine stalling while another window opens a heavy page): nothing joined the pair again unless
// one of them was left alone in the room, so in a group of three the two stayed apart for good ("he
// left" while still there). Now the friend is kept, frozen and marked "reconectando", for GRACE s, and
// HEAL s later this visitor leaves and joins the room again, and again every HEAL_GAP s while a friend
// is missing; Trystero keeps the same peer id within a page, so the friend comes back as the same
// visitor, without a "saiu" / "entrou". Only one side goes first (the larger peer id): both refreshing
// together, one left as the other came back and they missed each other (1 test in 2); the other side
// goes after HEAL_SLOW s in case the first is frozen (a hidden tab). At once on coming back to the tab.
const GRACE = 60;             // s
// beside a friend's name when they draw with WebGL 2: they see no seabed, fish or flock (main.js)
const WEBGL_MARK = ' <span class="mp-webgl" title="Sem WebGPU neste navegador: não vê o fundo do mar, os peixes nem as aves. Chrome ou Edge atualizados resolvem.">(WebGL)</span>';
const HEAL = 3, HEAL_JITTER = 2, HEAL_SLOW = 15, HEAL_GAP = 20; // s
// An optional TURN relay (none by default: the free public ones no longer answer, tested 07/10/2026):
// with it, two visitors behind strict NATs (some mobile and corporate networks) still connect, through
// it. Build-time variables (.env.local, or the repository's Actions variables in the deploy workflow):
// VITE_TURN_URLS (comma separated), VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL; a free account at
// metered.ca or Cloudflare's TURN gives them. They end up in the public site, as with any client TURN.
const TURN = ( () => {
	const env = import.meta.env || {};
	const urls = String( env.VITE_TURN_URLS || '' ).split( ',' ).map( ( u ) => u.trim() ).filter( Boolean );
	return urls.length ? [ { urls, username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL } ] : null;
} )();

// a room code from the address, or from what a visitor typed or pasted (the code, or the whole link)
export const parseRoom = ( text ) => {
	const t = String( text || '' ).trim();
	const m = t.match( /[?&]sala=([a-z0-9-]{3,40})/i );
	const r = m ? m[ 1 ] : t;
	return /^[a-z0-9-]{3,40}$/i.test( r ) ? r.toLowerCase() : null;
};
export const roomFromURL = () => parseRoom( new URLSearchParams( location.search ).get( 'sala' ) );
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
		this.relays = { open: 0, total: 0 };   // the Nostr relays that introduce the visitors
		this._relayAcc = 0;
		this.banner = document.createElement( 'div' );
		this.banner.id = 'mp-banner';
		this.banner.hidden = true;
		document.body.appendChild( this.banner );
		this._title = document.title;
		addEventListener( 'visibilitychange', () => { if ( ! document.hidden ) document.title = this._title; } );
		this.group = new THREE.Group();
		this.group.name = 'visitors';
		this.tags = document.createElement( 'div' );
		this.tags.id = 'mp-tags';
		document.body.appendChild( this.tags );
		addEventListener( 'pagehide', () => { try { this.bye?.send( 1 ); } catch ( e ) { /* closing */ } this.room?.leave(); } );
		// alone for a while: join the room again (see REFRESH). By the wall clock, not the frames: the one
		// who invites switches to another app to send the link, and the page stops drawing meanwhile; and at
		// once on coming back after 30 s alone
		const alone = ( s ) => this.room && ! this.peers.size && ! this._refreshing && performance.now() - this._enteredAt > s * 1000;
		setInterval( () => {
			if ( alone( REFRESH ) ) this._refresh();
			// friends lost for longer than the grace: gone
			const t = performance.now();
			for ( const [ id, p ] of this.peers ) if ( p.lost && t - p.lost > GRACE * 1000 ) this._drop( id );
		}, 5000 );
		addEventListener( 'visibilitychange', () => {
			if ( document.hidden ) return;
			if ( alone( 30 ) ) this._refresh();
			else if ( this._anyLost() ) this._heal( 0 );
		} );
		app.onFrame.push( ( dt ) => this.update( dt ) );
	}

	get name() {
		const s = this.app.settings;
		if ( ! s.name ) s.setName( 'Visitante ' + ( 10 + Math.floor( Math.random() * 90 ) ) );
		return s.name;
	}
	get count() { return this.peers.size; }

	// the panel's status line: the room's code, who is here, and while alone what is going on
	get note() {
		if ( ! this.room ) return '';
		const names = [ ...this.peers.values() ].filter( ( p ) => p.name ).map( ( p ) => escapeHTML( p.name ) + ( p.webgl ? WEBGL_MARK : '' ) + ( p.lost ? ' <span class="mp-warn">(reconectando…)</span>' : '' ) );
		const head = `Sala <b class="mp-code">${ this.roomId }</b> · `;
		if ( names.length ) return head + 'com ' + names.join( ', ' );
		const alone = ( performance.now() - this.joinedAt ) / 1000;
		const { open, total } = this.relays;
		if ( ! open ) {
			return head + ( alone < 12 ? 'conectando aos servidores de encontro…'
				: '<span class="mp-warn">sem acesso aos servidores de encontro</span>: esta rede pode estar bloqueando a conexão (tente outra rede ou desligue a VPN).' );
		}
		let t = head + `esperando alguém (${ open } de ${ total } servidores de encontro)`;
		if ( alone > WAIT_HELP ) {
			t += `<br><span class="mp-warn">Ninguém ainda?</span> Confiram se os dois estão na sala <b>${ this.roomId }</b> (quem não abriu o link pode entrar com o código, abaixo).`
				+ ( TURN ? '' : ' Em redes diferentes, dados móveis ou Wi-Fi de empresa às vezes bloqueiam a conexão direta: tentem os dois no mesmo Wi-Fi ou num Wi-Fi de casa.' );
		}
		return t;
	}

	_changed() { for ( const f of this.listeners ) f(); }

	async join( id, { follow = false } = {} ) {
		if ( this.room ) return;
		this.roomId = id;
		this.follow = follow;
		this.joinedAt = performance.now();
		this._buildLanternMaterials();
		this._mod = this._mod || await import( 'trystero' );
		this._enter( id );
		this.expected = this._worldNow();
		this._changed();
	}

	// the Trystero room and its actions (again on each refresh while alone)
	_enter( id ) {
		const config = { appId: APP_ID, relayConfig: { urls: relayList() } };
		if ( TURN ) config.turnConfig = TURN;
		const room = this.room = this._mod.joinRoom( config, id, {
			onJoinError: ( d ) => { console.warn( 'multiplayer: join error', d ); this.app.hud?.toast( 'Falha ao conectar com um visitante: ' + d.error, 4000 ); }
		} );
		this._enteredAt = performance.now();
		this.hello = room.makeAction( 'hi' );
		this.state = room.makeAction( 'st' );
		this.world = room.makeAction( 'w' );
		// a goodbye before leaving on purpose (Sair da sala, closing the tab): dropped at once, not kept
		// for the grace of a lost connection
		this.bye = room.makeAction( 'by' );
		this.bye.onMessage = ( _, { peerId } ) => this._drop( peerId );
		room.onPeerJoin = ( peerId ) => {
			const p = this._peer( peerId );
			if ( p.lost ) { p.lost = 0; this._changed(); } // back after a lost connection: the same visitor
			this.hello.send( this._helloData(), { target: peerId } );
		};
		room.onPeerLeave = ( peerId ) => this._lose( peerId );
		this.hello.onMessage = ( h, { peerId } ) => this._onHello( peerId, h );
		this.state.onMessage = ( s, { peerId } ) => this._onState( peerId, s );
		this.world.onMessage = ( w, { peerId } ) => this._onWorld( peerId, w );
	}

	async _refresh() {
		const old = this.room, id = this.roomId;
		this._refreshing = true;
		try { await old.leave(); } catch ( e ) { /* gone already */ }
		this._refreshing = false;
		if ( this.room !== old || this.roomId !== id ) return; // left or moved meanwhile
		this._enter( id );
		// a friend still missing: try again (the heal's own pace)
		if ( this._anyLost() ) this._heal( HEAL_GAP * 1000 );
	}

	// a friend's connection closed: kept (frozen, "reconectando") for GRACE s while the room is joined
	// again (see GRACE); while this visitor is the one refreshing, every friend goes and comes back
	_lose( peerId ) {
		const p = this.peers.get( peerId );
		if ( ! p ) return;
		if ( ! p.lost ) p.lost = performance.now();
		this._changed();
		if ( this._refreshing ) return;
		const first = String( this._mod?.selfId ?? '' ) > String( peerId );
		this._heal( ( first ? HEAL + Math.random() * HEAL_JITTER : HEAL_SLOW ) * 1000 );
	}

	_anyLost() { for ( const p of this.peers.values() ) if ( p.lost ) return true; return false; }

	// join the room again in `ms` if a friend is still missing then (a friend's own refresh brings them
	// back within a couple of seconds: nothing to do); at most once per HEAL_GAP
	_heal( ms ) {
		clearTimeout( this._healT );
		this._healT = setTimeout( () => {
			this._healT = null;
			if ( ! this.room || this._refreshing || ! this._anyLost() ) return;
			const since = performance.now() - ( this._healedAt || - 1e9 );
			if ( since < HEAL_GAP * 1000 ) { this._heal( HEAL_GAP * 1000 - since ); return; }
			this._healedAt = performance.now();
			console.info( 'multiplayer: a friend lost, joining the room again' );
			this._refresh();
		}, ms );
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

	// Entrar com código: the code or the link a friend sent; leaves the room this visitor is in first
	async joinCode( text ) {
		const id = parseRoom( text );
		if ( ! id ) { this.app.hud?.toast( 'Código de sala inválido' ); return false; }
		if ( id === this.roomId ) { this.app.hud?.toast( 'Você já está nessa sala' ); return true; }
		const url = new URL( location.href ); url.searchParams.set( 'sala', id );
		// a page that was in a room already keeps Trystero's peer id, and the others ignored it when it came
		// back: a reload keeping the view (as opening the editor) gives a fresh one
		if ( this.room || this._left ) {
			url.searchParams.set( 'auto', '' );
			reloadKeepingView( this.app, url.href.replace( /=(?=&|$)/g, '' ), 'Entrando na sala ' + id );
			return true;
		}
		history.replaceState( null, '', url.href.replace( /=(?=&|$)/g, '' ) );
		await this.join( id, { follow: true } );
		this.app.hud?.toast( 'Na sala ' + id );
		return true;
	}

	async leave() {
		if ( ! this.room ) return;
		const room = this.room;
		try { await this.bye.send( 1 ); } catch ( e ) { /* gone already */ }
		this.room = null;
		this._left = true;
		clearTimeout( this._healT );
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

	// webgl: this visitor draws with WebGL 2 (no WebGPU in the browser): no seabed, fish or flock there
	// (main.js), shown beside the name so the others know why they see less
	_helloData() {
		return { name: this.name, since: performance.now() - this.joinedAt, world: this.shareWorld ? this._worldNow() : null, webgl: this.app.backendName !== 'WebGPU' };
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
		p.webgl = !! h?.webgl;
		p._d = null; // the tag is redrawn with the renderer mark
		p.tag.textContent = p.name;
		if ( first ) this._arrived( peerId, p.name );
		// the newcomer takes the world of whoever has been in the room longer
		if ( first && this.shareWorld && h?.world && p.since > performance.now() - this.joinedAt ) this._applyWorld( h.world );
		this._changed();
	}

	// A friend arrived: a banner at the top with a button to fly there, a soft chime (through the
	// ambience's bus: the mute and volume of the options apply), and the tab's title when it is hidden.
	_arrived( peerId, name ) {
		const b = this.banner;
		b.innerHTML = `<span class="mp-bell">✦</span> <b>${ escapeHTML( name ) }</b> entrou na visita <button type="button">Ir até</button><button type="button" class="mp-x" aria-label="Fechar">×</button>`;
		b.querySelector( 'button' ).onclick = () => { this.goTo( peerId ); b.hidden = true; };
		b.querySelector( '.mp-x' ).onclick = () => { b.hidden = true; };
		b.hidden = false;
		b.classList.remove( 'show' ); void b.offsetWidth; b.classList.add( 'show' );
		clearTimeout( this._bannerT ); this._bannerT = setTimeout( () => { b.hidden = true; }, 9000 );
		if ( document.hidden ) document.title = `✦ ${ name } entrou · ${ this._title }`;
		this._chime();
	}

	_chime() {
		const out = this.app.ambience?.output?.();
		if ( ! out || this.app.settings?.muted ) return;
		const { ctx, destination } = out, t = ctx.currentTime;
		for ( const [ f, d ] of [ [ 784, 0 ], [ 1175, 0.14 ] ] ) {
			const o = ctx.createOscillator(), g = ctx.createGain();
			o.type = 'sine'; o.frequency.value = f;
			g.gain.setValueAtTime( 0, t + d );
			g.gain.linearRampToValueAtTime( 0.12, t + d + 0.02 );
			g.gain.exponentialRampToValueAtTime( 0.0001, t + d + 1.2 );
			o.connect( g ).connect( destination );
			o.start( t + d ); o.stop( t + d + 1.3 );
		}
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
		// the relays' sockets, once a second, for the panel (and its status while alone)
		this._relayAcc += dt;
		if ( this._relayAcc > 1 ) {
			this._relayAcc = 0;
			let open = 0, total = 0;
			try { for ( const ws of Object.values( this._mod?.getRelaySockets?.() || {} ) ) { total ++; if ( ws?.readyState === 1 ) open ++; } } catch ( e ) { /* another Trystero */ }
			const changed = open !== this.relays.open || total !== this.relays.total;
			this.relays = { open, total };
			// alone: the status line moves on with the time (connecting, waiting, the help)
			if ( changed || ! this.peers.size ) this._changed();
		}
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
				if ( p._d !== d ) { p._d = d; p.tag.innerHTML = `${ escapeHTML( p.name ) }${ p.webgl ? ' <small>WebGL</small>' : '' }<small>${ d }</small>`; }
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
