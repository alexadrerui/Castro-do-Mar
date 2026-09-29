const TIPS = [
	'Os castros eram povoados fortificados da Idade do Ferro no noroeste da Península Ibérica.',
	'As casas redondas tinham paredes de pedra seca e telhados cónicos de colmo.',
	'Arraste com o mouse para olhar ao redor e use WASD para voar pela vila.',
	'Segure Shift para voar mais rápido; a roda do mouse ajusta a velocidade.',
	'Na base do forte, duas bocas de mina levam ao interior da rocha.',
	'Todo o terreno, a água e as texturas são gerados proceduralmente em TSL.',
	'Os mesmos shaders TSL rodam em WebGPU ou WebGL 2 automaticamente.'
];

export class Loader {

	constructor( steps ) {
		this.el = document.getElementById( 'loader' );
		this.fill = this.el.querySelector( '.ld-fill' );
		this.bar = this.el.querySelector( '.ld-bar' );
		this.stageEl = document.getElementById( 'ld-stage' );
		this.pctEl = document.getElementById( 'ld-pct' );
		this.tipEl = document.getElementById( 'ld-tip' );
		this.listEl = document.getElementById( 'ld-steps' );
		this.steps = steps; // [{ id, label, weight }]
		this.total = steps.reduce( ( s, x ) => s + x.weight, 0 );
		this.done = 0;
		this.items = new Map();
		for ( const s of steps ) {
			const li = document.createElement( 'li' );
			li.textContent = s.label;
			this.listEl.appendChild( li );
			this.items.set( s.id, { li, s } );
		}
		let t = 0;
		this.tipEl.textContent = TIPS[ 0 ];
		this.tipTimer = setInterval( () => { t = ( t + 1 ) % TIPS.length; this.tipEl.textContent = TIPS[ t ]; }, 4200 );
	}

	backend( text ) { document.getElementById( 'ld-backend' ).textContent = text; }

	async run( id, fn ) {
		const it = this.items.get( id );
		it.li.classList.add( 'active' );
		this.stageEl.textContent = it.s.label + '…';
		await frame();
		const t0 = performance.now();
		// time spent outside the steps (module import, code between steps)
		const gap = Math.round( t0 - ( this.lastEnd ?? 0 ) );
		if ( gap > 50 ) ( this.times = this.times || {} )[ '(antes de ' + id + ')' ] = gap;
		const result = await fn( ( p ) => this._set( this.done + it.s.weight * Math.min( 1, p ) ) );
		( this.times = this.times || {} )[ id ] = Math.round( performance.now() - t0 );
		this.lastEnd = performance.now();
		this.done += it.s.weight;
		this._set( this.done );
		it.li.classList.remove( 'active' );
		it.li.classList.add( 'ok' );
		await frame();
		return result;
	}

	_set( v ) {
		const p = Math.round( v / this.total * 100 );
		this.fill.style.width = p + '%';
		this.pctEl.textContent = p + '%';
		this.bar.setAttribute( 'aria-valuenow', p );
	}

	finish( onEnter, auto = false ) {
		this.stageEl.textContent = 'O castro aguarda.';
		const gap = Math.round( performance.now() - this.lastEnd );
		if ( gap > 50 ) this.times[ '(após compile)' ] = gap;
		this.times.total = Math.round( performance.now() );
		console.info( 'load times (ms)', JSON.stringify( this.times ) );
		const btn = document.getElementById( 'ld-enter' );
		const go = () => { clearInterval( this.tipTimer ); this.el.classList.add( 'done' ); onEnter(); };
		if ( auto ) return go();
		btn.hidden = false;
		btn.focus();
		btn.addEventListener( 'click', go, { once: true } );
	}

	fail( err ) {
		this.stageEl.textContent = 'Falha: ' + ( err?.message || err );
		this.stageEl.style.color = '#ff9b85';
		console.error( err );
	}
}

export const frame = () => new Promise( ( r ) => setTimeout( r, 16 ) );
