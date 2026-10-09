// The object editor's library (editor/objectEditor.js; the idea of the Habitat Creator's decoration
// catalogue): every object the village can hold, in categories, with sizes the builders already
// take (a round house of 4 or 8.8 m, an undyed stall...). Each item's thumbnail is a picture of the
// object itself, made by tools/thumbs.mjs into public/editor/thumbs/<id>.webp, with its measured
// footprint and height in public/editor/thumbs.json (the cards' "≈ w × d m" and the drop preview).
// kind and entry are what objectEditor.place() builds (the layout.js form of BUILDINGS / STALLS / PROPS).

export const CATEGORIES = [
	{ id: 'casas', label: 'Moradias' },
	{ id: 'campo', label: 'Campo e armazéns' },
	{ id: 'mercado', label: 'Mercado e ofícios' },
	{ id: 'entradas', label: 'Defesa e entradas' }
];

export const CATALOGUE = [
	// homes
	{ id: 'round', label: 'Casa redonda', cat: 'casas', kind: 'building', entry: { type: 'round', r: 5.2, awning: true }, desc: 'Pedra seca e colmo, com toldo' },
	{ id: 'round-small', label: 'Casa redonda pequena', cat: 'casas', kind: 'building', entry: { type: 'round', r: 4 }, desc: 'Pedra seca e colmo' },
	{ id: 'round-chief', label: 'Casa do chefe', cat: 'casas', kind: 'building', entry: { type: 'round', r: 8.8, awning: true }, desc: 'A maior casa redonda, com toldo' },
	{ id: 'long', label: 'Casa longa', cat: 'casas', kind: 'building', entry: { type: 'long', w: 8, l: 13, rot: 0, awning: true }, desc: 'Paredes de pedra, telhado de duas águas' },
	{ id: 'long-small', label: 'Casa longa pequena', cat: 'casas', kind: 'building', entry: { type: 'long', w: 5, l: 8, rot: 0 }, desc: 'Para uma família' },
	{ id: 'hut', label: 'Cabana', cat: 'casas', kind: 'building', entry: { type: 'hut', r: 2.5 }, desc: 'Redonda e baixa' },
	{ id: 'castro', label: 'Casa do castro', cat: 'casas', kind: 'building', entry: { type: 'castro', r: 9.5, rot: 0 }, desc: 'Muro circular com o pátio e as casas dentro' },
	// fields and stores
	{ id: 'granary', label: 'Celeiro', cat: 'campo', kind: 'building', entry: { type: 'granary', r: 1.6 }, desc: 'Sobre pilares, longe dos ratos' },
	{ id: 'hay', label: 'Palheiro', cat: 'campo', kind: 'prop', entry: { type: 'hay', r: 1.2 }, desc: 'Meda de feno' },
	{ id: 'pen', label: 'Cercado', cat: 'campo', kind: 'prop', entry: { type: 'pen', w: 6, d: 5, rot: 0 }, desc: 'Para os animais' },
	{ id: 'pen-large', label: 'Cercado grande', cat: 'campo', kind: 'prop', entry: { type: 'pen', w: 10, d: 7, rot: 0 }, desc: 'Para os animais' },
	{ id: 'skep', label: 'Colmeia', cat: 'campo', kind: 'prop', entry: { type: 'skep' }, desc: 'Cesto de palha trançada' },
	{ id: 'rack', label: 'Varal', cat: 'campo', kind: 'prop', entry: { type: 'rack', rot: 0 }, desc: 'Para secar peixe e panos' },
	{ id: 'wood', label: 'Lenha', cat: 'campo', kind: 'prop', entry: { type: 'wood', rot: 0 }, desc: 'Pilha de toras' },
	// market and crafts
	{ id: 'stall', label: 'Barraca', cat: 'mercado', kind: 'stall', entry: { red: true }, desc: 'Toldo tingido de vermelho' },
	{ id: 'stall-plain', label: 'Barraca de lona crua', cat: 'mercado', kind: 'stall', entry: { red: false }, desc: 'Toldo sem tingir' },
	{ id: 'cart', label: 'Carroça', cat: 'mercado', kind: 'prop', entry: { type: 'cart', rot: 0 }, desc: 'Duas rodas, varais de tração' },
	{ id: 'well', label: 'Poço', cat: 'mercado', kind: 'prop', entry: { type: 'well' }, desc: 'Bocal de pedra e sarilho' },
	// defence and gateways
	{ id: 'lookout', label: 'Torre de vigia', cat: 'entradas', kind: 'building', entry: { type: 'lookout' }, desc: 'Madeira, com plataforma no alto' },
	{ id: 'gate', label: 'Pórtico', cat: 'entradas', kind: 'prop', entry: { type: 'gate', rot: 0 }, desc: 'Entrada na estrada principal' },
	{ id: 'arch', label: 'Arco rústico', cat: 'entradas', kind: 'prop', entry: { type: 'arch', rot: 0 }, desc: 'Galhos e hera (a hera cresce ao salvar)' }
];

// the catalogue item an object already in the village counts as (the cards' "na vila"): its type,
// and for the types with several sizes the nearest one (scale included)
export function itemOf( kind, entry ) {
	if ( kind === 'stall' ) return entry.red === false ? 'stall-plain' : 'stall';
	const s = entry.scale || 1;
	switch ( entry.type ) {
		case 'round': { const r = entry.r * s; return r >= 7 ? 'round-chief' : r < 4.6 ? 'round-small' : 'round'; }
		case 'long': return entry.w * entry.l * s * s < 60 ? 'long-small' : 'long';
		case 'pen': return entry.w * entry.d * s * s >= 55 ? 'pen-large' : 'pen';
		default: return entry.type;
	}
}
