# Avisos de terceiros

O código próprio do Castro do Mar está sob a licença MIT (`LICENSE`). Partes do projeto vêm de outros trabalhos e **continuam sob as licenças deles**. Quem reutilizar estes arquivos precisa manter os avisos de copyright e as licenças abaixo (os textos completos estão em `licenses/`). Cada arquivo portado traz no cabeçalho a origem, o commit e o que foi mudado.

Resumo para quem vai reutilizar:

- Quase tudo é **MIT**: pode usar, modificar e vender, desde que mantenha os avisos.
- As carpas e o lótus (`src/world/koi/koi.js`, `lotus.js`) são **Apache 2.0**: além do aviso, é preciso indicar as mudanças feitas nos arquivos.

## Código portado ou adaptado

| Origem | Licença e copyright | Onde está aqui | Texto da licença |
|---|---|---|---|
| [Tidewater](https://github.com/dgreenheck/tidewater) (versão three.js, commit d32799f) | MIT, Copyright (c) 2026 DRG Software Solutions LLC | `src/world/fish/`, `seabed/`, `granite/`, `birds/`, `trees.js`, `leafAtlas.js`, `impostors.js`, `grass.js`, `src/post/lensDroplets.js`, `marineSnow.js` | `licenses/LICENSE-Tidewater.md` |
| [Drusniel: Gods' End](https://github.com/danielsobrado/drusniel-gods-end) | MIT, Copyright (c) 2026 Daniel Sobrado | `src/world/lakeFill.js`, `lakeWater.js`, `lakeFlora.js`, `riverCourse.js`, `rivers.js`, `riverMist.js`, `planarReprojection.js`, `weather.js`, `meadowFlora.js`, `src/post/valleyFog.js`, `src/core/recovery.js`, `prepareDive` em `src/main.js`, pedras do rio em `rocks.js` | `licenses/LICENSE-Drusniel.md` |
| Snowflow, de Maksymilian Dendura (via Drusniel) | MIT | ruído de gradiente de `src/post/valleyFog.js`, sombreamento do spray em `riverMist.js` | crédito nos cabeçalhos; chegou por meio do código do Drusniel |
| [Stylized Premium Scenes](https://github.com/CortizLabs/stylized-premium-patreon) (Cortiz) | MIT, Copyright (c) 2026 Christian Ortiz (Cortiz) | `src/world/rainImpacts.js` (anéis, marcas e escorrimentos), riscos da chuva em `src/world/weather.js`, a sombra em anel, a contraluz e a grama amassada nas pedras (`src/world/grass.js`), `src/post/kuwahara.js`, `clothMaterial` em `src/world/materials.js` | `licenses/LICENSE-Cortiz.md` |
| [@takram/three-clouds](https://github.com/takram-design-engineering/three-geospatial) | MIT, Copyright (c) 2024 Shota Matsuda | `src/post/clouds.js`, `src/world/cloudShadow.js` | `licenses/LICENSE-takram-clouds.md` |
| [@takram/three-atmosphere](https://github.com/takram-design-engineering/three-geospatial) | MIT, Copyright (c) 2024 Shota Matsuda | estrelas (`src/world/stars.js`) e lua (`createMoon` em `src/world/sky.js`) | `licenses/LICENSE-takram-atmosphere.md` |
| [Folio 2025](https://github.com/brunosimon/folio-2025) (Bruno Simon) | MIT, Copyright (c) 2025 Bruno Simon | organização das opções do painel: `src/core/settings.js`, `bindOptions` em `src/ui/hud.js`; o painel de depuração `src/ui/debug.js` (de `Debug.js`/`Monitoring.js`) | `licenses/LICENSE-folio-2025.md` |
| [offroad](https://github.com/alexadrerui/offroad) | MIT, Copyright (c) 2026 Arz-Gev | esquema da visita junto em `src/core/multiplayer.js` (reescrito para a câmera livre) da exposição automática em `src/post/autoExposure.js` (reescrita em TSL) dos quadros-chave por hora em `src/world/look.js`, da resolução dinâmica em `src/core/dynamicRes.js`, dos controles de toque em `src/controls/touch.js` do fundo visível no raso em `src/world/water.js` e da árvore seca, do tronco caído e do arbusto de folha larga em `src/world/trees.js` (`deadTree`, `fallenLog`, `hollyBush`) | `licenses/LICENSE-offroad.md` |
| [Lightning-VFX](https://github.com/SahilK-027/Lightning-VFX) | MIT, Copyright (c) 2026 Sahil K | `src/world/lightning.js` | `licenses/LICENSE-LightningVFX.md` |
| [AndyLe Pool](https://github.com/AndyLeAI/Andy_KOI_Pool) (commit dc3b205) | Apache License 2.0, AndyLeAI | `src/world/koi/koi.js`, `lotus.js` (as mudanças estão descritas nos cabeçalhos) | `src/world/koi/LICENSE-AndyLePool` |
| [shader-studio](https://github.com/void032/shader-studio) | MIT, Copyright (c) 2025 Vineet Kumar (void032) | ferramenta "Gerar" de `src/editor/terrainEditor.js` | `licenses/LICENSE-shader-studio.md` |
| "Hash without Sine", de David Hoskins | MIT, Copyright (c) 2014 David Hoskins | hashes de `src/world/rainImpacts.js` | MIT (aviso no cabeçalho do arquivo) |
| Exemplos do three.js (`webgpu_sculpt`, `webgpu_custom_fog_scattering`, `webgpu_postprocessing_fog`) | MIT, Copyright © 2010-2026 three.js authors | `src/editor/terrainEditor.js`, `src/post/mist.js`, `src/main.js` | `licenses/LICENSE-three.md` |

## Bibliotecas (npm, incluídas no build)

| Pacote | Licença e copyright | Texto |
|---|---|---|
| [three](https://github.com/mrdoob/three.js) | MIT, Copyright © 2010-2026 three.js authors | `licenses/LICENSE-three.md` |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT, Copyright (c) 2018 Garrett Johnson | `licenses/LICENSE-three-mesh-bvh.md` |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | MIT, Copyright (c) 2022 Garrett Johnson | `licenses/LICENSE-three-bvh-csg.md` |
| [tweakpane](https://github.com/cocopon/tweakpane) e [@tweakpane/plugin-essentials](https://github.com/tweakpane/plugin-essentials) (só no `#debug`) | MIT, Copyright (c) 2016 / 2021 cocopon | `licenses/LICENSE-tweakpane.md`, `licenses/LICENSE-tweakpane-essentials.md` |
| [stats-gl](https://github.com/RenaudRohlinger/stats-gl) (só no `#debug`) | MIT, Renaud Rohlinger (declarada no `package.json`; o pacote não traz o arquivo) | `licenses/LICENSE-stats-gl.md` |
| [trystero](https://github.com/dmotz/trystero) (com `@trystero-p2p/core` e `@trystero-p2p/nostr`) | MIT, Copyright (c) 2021 Dan Motzenbecker | `licenses/LICENSE-trystero.md` |
| [@noble/secp256k1](https://github.com/paulmillr/noble-secp256k1) (dependência do Trystero) | MIT, Copyright (c) 2019 Paul Miller | `licenses/LICENSE-noble-secp256k1.md` |

As ferramentas de desenvolvimento (Vite, puppeteer-core) não entram no site publicado.

## Dados e imagens

| Arquivo | Origem | Licença |
|---|---|---|
| `public/clouds/` (forma, detalhe e clima das nuvens) | @takram/three-clouds | MIT, `licenses/LICENSE-takram-clouds.md` |
| `public/sky/stars.bin` | Yale Bright Star Catalog, 5ª ed. revisada (dados astronômicos de domínio público), no empacotamento do @takram/three-atmosphere | MIT para o empacotamento, `licenses/LICENSE-takram-atmosphere.md` |
| `public/sky/moon_color.webp` | NASA CGI Moon Kit (LROC), https://svs.gsfc.nasa.gov/4720/, na cópia de 1k do takram | imagem da NASA, de uso livre com crédito: "NASA's Scientific Visualization Studio" |
| Cores das estrelas pelo índice B−V | tabela de Mitchell Charity (vendian.org) | dados factuais, crédito no cabeçalho de `src/world/stars.js` |
| `ref/` | imagens de referência do autor | MIT, como o resto do projeto |
| `public/audio/light-rain.mp3` | gravação de chuva gerada pelo autor com o ChatGPT (laço de 45 s recortado do original) | MIT, como o resto do projeto |

## Só ideias ou referência visual (nenhum código copiado)

Não exigem licença, mas ficam os créditos:

- Makone: a ideia das ferramentas `tools/verify.mjs` e `tools/houses.mjs`.
- O jogo Habitat Creator: as ferramentas de margem de água, o editor de objetos e o pincel de natureza.
- A demo Three.js Sky Pro (preset "Moonlit Night"): só a paleta da noite. É um produto pago e nenhum código dele foi usado.
