// The object editor's library (editor/objectEditor.js; the idea of the Habitat Creator's decoration
// catalogue): every object the village can hold, in categories, with sizes the builders already
// take (a round house of 4 or 8.8 m, an undyed stall...). Each item's thumbnail is a picture of the
// object itself, made by tools/thumbs.mjs into public/editor/thumbs/<id>.webp, with its measured
// footprint and height in public/editor/thumbs.json (the cards' "≈ w × d m" and the drop preview).
// kind and entry are what objectEditor.place() builds: the layout.js form of BUILDINGS / STALLS / PROPS,
// or a plant / rock of the scatter (kinds 'plant' / 'rock', world/placed.js).

export const CATEGORIES = [
	{ id: 'casas', label: 'Moradias' },
	{ id: 'campo', label: 'Campo e armazéns' },
	{ id: 'mercado', label: 'Mercado e ofícios' },
	{ id: 'entradas', label: 'Defesa e entradas' },
	{ id: 'arvores', label: 'Árvores e arbustos' },
	{ id: 'flores', label: 'Flores do campo' },
	{ id: 'pedras', label: 'Pedras' }
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
	{ id: 'ruin', label: 'Ruína de pedra', cat: 'casas', kind: 'prop', entry: { type: 'ruin', rot: 0 }, desc: 'Casa abandonada, paredes caídas e chaminé (do offroad)' },
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
	{ id: 'arch', label: 'Arco rústico', cat: 'entradas', kind: 'prop', entry: { type: 'arch', rot: 0 }, desc: 'Galhos e hera (a hera cresce ao salvar)' },
	// trees and shrubs: one plant of the scatter's species (world/placed.js; s = its size, ~1 the scatter's mean)
	{ id: 'oak', label: 'Carvalho', cat: 'arvores', kind: 'plant', entry: { species: 'oak', s: 1.1 }, desc: 'Carvalho-alvarinho, copa larga' },
	{ id: 'pine', label: 'Pinheiro', cat: 'arvores', kind: 'plant', entry: { species: 'pine', s: 1.1 }, desc: 'Pinheiro-silvestre, alto' },
	{ id: 'birch', label: 'Bétula', cat: 'arvores', kind: 'plant', entry: { species: 'birch', s: 1 }, desc: 'Tronco branco, folha miúda' },
	{ id: 'birch-gold', label: 'Bétula dourada', cat: 'arvores', kind: 'plant', entry: { species: 'gold', s: 1.05 }, desc: 'A árvore amarela das referências' },
	{ id: 'snag', label: 'Árvore seca', cat: 'arvores', kind: 'plant', entry: { species: 'snag', s: 1.1 }, desc: 'Tronco morto, de pé' },
	{ id: 'log', label: 'Tronco caído', cat: 'arvores', kind: 'plant', entry: { species: 'log', s: 1 }, desc: 'Deitado no chão da mata' },
	{ id: 'holly', label: 'Azevinho', cat: 'arvores', kind: 'plant', entry: { species: 'holly', s: 0.9 }, desc: 'Arbusto verde-escuro' },
	{ id: 'gorse', label: 'Tojo', cat: 'arvores', kind: 'plant', entry: { species: 'bush', s: 1 }, desc: 'Arbusto dos montes' },
	{ id: 'fern', label: 'Feto', cat: 'arvores', kind: 'plant', entry: { species: 'fern', s: 1 }, desc: 'Feto-ordinário, rasteiro' },
	{ id: 'spruce', label: 'Abeto', cat: 'arvores', kind: 'plant', entry: { species: 'spruce', s: 1 }, desc: 'Cone escuro de ramos caídos (do offroad; não nasce sozinho no mapa)' },
	// meadow flowers (world/meadowFlora.js): a clump of the scatter's
	{ id: 'daisy', label: 'Margaridas', cat: 'flores', kind: 'plant', entry: { species: 'flora_daisy', s: 0.75 }, desc: 'Tufo de margaridas' },
	{ id: 'buttercup', label: 'Botões-de-ouro', cat: 'flores', kind: 'plant', entry: { species: 'flora_buttercup', s: 0.85 }, desc: 'Tufo amarelo' },
	{ id: 'foxglove', label: 'Dedaleira', cat: 'flores', kind: 'plant', entry: { species: 'flora_foxglove', s: 1 }, desc: 'Espiga de flores roxas, da orla da mata' },
	// rocks: the scatter's granite styles (world/rocks.js), s = size in m
	{ id: 'rock-tor', label: 'Penedo de granito', cat: 'pedras', kind: 'rock', entry: { rock: 'tor0', s: 2.4 }, desc: 'Arredondado, dos montes' },
	{ id: 'rock-tor-large', label: 'Penedo grande', cat: 'pedras', kind: 'rock', entry: { rock: 'tor0', s: 5 }, desc: 'Um afloramento inteiro' },
	{ id: 'rock-boulder', label: 'Matacão', cat: 'pedras', kind: 'rock', entry: { rock: 'tor1', s: 1.8 }, desc: 'Bloco solto, rolado' },
	{ id: 'rock-block', label: 'Bloco anguloso', cat: 'pedras', kind: 'rock', entry: { rock: 'talus0', s: 1.6 }, desc: 'Arestas vivas, do pé da escarpa' },
	{ id: 'rock-slab', label: 'Laje de granito', cat: 'pedras', kind: 'rock', entry: { rock: 'talus1', s: 2 }, desc: 'Chata e larga' },
	// offroad's faceted boulders (granite style 'facet', world/rocks.js)
	{ id: 'rock-facet', label: 'Pedra facetada', cat: 'pedras', kind: 'rock', entry: { rock: 'facet0', s: 1.4 }, desc: 'Arestas vivas, poucas faces (do offroad)' },
	{ id: 'rock-facet-large', label: 'Bloco facetado', cat: 'pedras', kind: 'rock', entry: { rock: 'facet0', s: 3.4 }, desc: 'Bloco grande de encosta (do offroad)' },
	{ id: 'rock-group', label: 'Pedras soltas', cat: 'pedras', kind: 'rock', entry: { rock: 'facetGroup', s: 0.7 }, desc: 'Um grupo de cinco pedras (do offroad)' }
];

// the catalogue item an object already in the village counts as (the cards' "na vila"): its type,
// and for the types with several sizes the nearest one (scale included)
export function itemOf( kind, entry ) {
	if ( kind === 'stall' ) return entry.red === false ? 'stall-plain' : 'stall';
	if ( kind === 'plant' ) return { gold: 'birch-gold', bush: 'gorse', flora_daisy: 'daisy', flora_buttercup: 'buttercup', flora_foxglove: 'foxglove' }[ entry.species ] ?? entry.species;
	const size = ( entry.s || 1 ) * ( entry.scale || 1 );
	if ( kind === 'rock' ) return { tor0: size > 3.5 ? 'rock-tor-large' : 'rock-tor', tor1: 'rock-boulder', talus0: 'rock-block', talus1: 'rock-slab', facet0: size > 2.4 ? 'rock-facet-large' : 'rock-facet', facetGroup: 'rock-group' }[ entry.rock ];
	const s = entry.scale || 1;
	switch ( entry.type ) {
		case 'round': { const r = entry.r * s; return r >= 7 ? 'round-chief' : r < 4.6 ? 'round-small' : 'round'; }
		case 'long': return entry.w * entry.l * s * s < 60 ? 'long-small' : 'long';
		case 'pen': return entry.w * entry.d * s * s >= 55 ? 'pen-large' : 'pen';
		default: return entry.type;
	}
}
