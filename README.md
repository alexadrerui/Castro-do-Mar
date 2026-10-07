# Castro do Mar — Vila Celta 890

Recriação procedural de um castro celta da costa galega, à beira de um lago, feita em **three.js r186** com **WebGPU** e **TSL** (Three.js Shading Language). Relevo, texturas, casas, vegetação, água e céu são gerados por código, sem modelos nem texturas prontos. Os mesmos shaders rodam em WebGPU e em WebGL 2 (`?webgl`).

**No ar:** https://alexadrerui.github.io/Castro-do-Mar/

## Rodar

```bash
npm install
npm run dev
```

Abra http://localhost:5190 (`?auto` pula o botão de entrada). Pede um navegador com WebGPU (Chrome ou Edge recentes); sem ele, use `?webgl`.

A primeira visita leva ~15 s: o navegador compila os shaders e o relevo é gerado em workers. Da segunda em diante, ~5 s, porque relevo, horizonte, texturas e bakes ficam em cache no IndexedDB e os shaders no cache do navegador.

## Controles

| Tecla | Ação |
|---|---|
| Arrastar | olhar |
| WASD / setas | voar |
| Q / E | descer e subir |
| Shift | voo rápido |
| Roda do mouse | velocidade |
| 1–6 | vistas: Panorâmica, Aérea, Vila, Minas, Lago, Montanhas |
| F | enquadra o ponto em volta do qual a câmera gira |
| Clique | foca no ponto clicado (clique no céu volta ao foco automático) |
| B | liga e desliga a profundidade de campo |
| L | raio |
| H | painel |
| P | foto (salva em `shots/`) |
| M | liga e desliga o som |
| U | esconde a HUD |

No topo do painel ficam as **Opções**: qualidade (Baixa, Média, Alta), áudio e volume, o renderizador em uso (WebGPU ou WebGL 2, com troca), o botão que abre o editor na mesma vista e **Amigos** (visita junto, abaixo). Qualidade, som e o seu nome ficam guardados no navegador. O painel controla o sol (elevação e azimute), nuvens, chuva, névoa, brilho e as camadas (água, horizonte, vegetação, grama, flores, pedras, casas, aves, peixes...).

## O que tem

**Mundo**
- Maciço de granito de 2,8 km com costa, crista rochosa, ilhas e cordilheiras distantes nevadas. O terreno é dividido em chunks com LOD, com material triplanar, lodo e faixa úmida nas margens.
- A vila: casas redondas e longas de pedra e colmo, a casa composta do castro, mercado com barracas e toldos vermelhos, bandeirolas, celeiros e vigias.
- Toldos, barracas e bandeirolas balançando ao vento.
- Vielas com cercas de vime e de varas, postes com lanterna, degraus de tronco e pedras nas bordas, além de janelas acesas nas casas longas.
- O forte em anel, a torre de vigia, o muro e o penhasco da mina, com andaime e duas bocas escavadas.

**Vegetação**
- Carvalhos e pinheiros com impostores octaédricos ao longe, bétulas, tojo e fento.
- Grama de prado e de duna em volta da câmera, com vento em rajadas.
- Flores do prado: margaridas, botões-de-ouro, espigas, dedaleiras e folhas secas sob os carvalhos.
- Pedras de granito por ambiente (colinas, costa, pé do penhasco), com líquen, musgo e cracas.

**Água**
- O lago-mar tem reflexo planar com orçamento (refeito a cada 100 ms ou 2 m de deslocamento, reprojetado entre capturas), zonas de vento, espuma e sombra do sol na superfície.
- Embaixo d'água: absorção por canal, cáusticas, janela de Snell, neve marinha e gotas na lente ao voltar à superfície.
- No fundo do mar há algas, pedras, ouriços, anêmonas e mexilhões, e cardumes de 10 espécies galegas (sardinha, xarda, robaliza, raia...).
- Lagos e rios criados no editor, com cachoeiras, spray, pedras nas margens, taboas, plantas submersas, carpas koi e lótus.

**Céu e clima**
- Céu de Preetham com nuvens 2D altas e cúmulos volumétricos em raymarch, que se deslocam com o vento e mudam de forma.
- Sombra das nuvens no chão, god rays, bloom e espalhamento na névoa.
- Brétema baixa sobre a água e névoa que deita nos vales.
- Chuva com chão e telhados molhados, poças com os anéis das gotas, anéis na água e brilhos dos impactos, tempo fechado e tempestade com raios e trovão.

**Vida**
- Gaivotas que planam sobre a baía, gaivotas que pousam nos telhados, no muro e nas pedras (e decolam quando a câmera chega perto) e charrões que pairam e mergulham.
- Fumaça nas chaminés.

**Som**
- Som ambiente sintetizado na hora (sem arquivos de áudio): mar quebrando na costa, vento que cresce nos cumes e na tempestade, folhas, chuva, rios e cachoeiras, fogueiras das casas, gaivotas e pássaros de dia (com coro ao amanhecer), grilos e coruja à noite, e tudo abafado embaixo d'água. Começa no primeiro clique; volume e mudo (M) nas Opções.

**Visita junto**
- **Amigos → Convidar** abre uma sala e copia o link (`?sala=<id>`); quem abrir o link entra na mesma vila, voa até você e vê a sua lanterna, com o nome e a distância (e você vê a dele). A hora, o tempo passando, as nuvens, a chuva e a névoa ficam iguais para todos ("Hora e tempo juntos"). Um clique no nome de um amigo voa até ele.
- Direto entre os navegadores (WebRTC, pelo [Trystero](https://github.com/dmotz/trystero)), sem servidor próprio: funciona no site estático. Redes com NAT simétrico (algumas móveis e corporativas) podem não conectar.

**Câmera e imagem**
- Voo livre e mergulho.
- Profundidade de campo com foco automático (raycast com BVH) ou pelo clique.
- Gradação de cor de fim de tarde e, como opção, o modo pintura a óleo.

## Editor (`?edit`)

Três abas compartilham o botão "Salvar e aplicar". No servidor de desenvolvimento ele grava em `public/`; no site publicado, baixa os arquivos.

- **Relevo:** elevar, baixar, suavizar, aplanar, ruído, restaurar e gerar (fbm ou ilha). Também cavar e aterrar margens de água, encher uma depressão com um lago de nível próprio e traçar um rio da nascente à foz. A tecla T alterna a vista de cima, e Ctrl+Z / Ctrl+Y desfazem e refazem. As edições ficam em `public/terrain-edits.bin` e `world-edits.json`.
- **Objetos:** selecionar, mover, girar, escalar e remover casas, barracas e adereços, e adicionar novos pelo catálogo. Objetos novos abrem clareira na vegetação. Grava em `public/world-edits.json`.
- **Natureza:** pincel que pinta ou apaga carvalho, pinheiro, bétula, tojo, fento, pedras e grama. Grava em `public/nature-edits.bin`.

## Parâmetros de URL

| Parâmetro | Efeito |
|---|---|
| `?auto` | pula o botão de entrada |
| `?view=N` | começa na vista N (0–5) |
| `?edit` | abre o editor |
| `?sala=<id>` | entra na sala de uma visita junto (o link do Convidar) |
| `?webgl` | força WebGL 2 |
| `?nocache` | ignora o cache do IndexedDB |
| `?rain=1` | começa chovendo (0 a 1) |
| `?paint=1` | começa com a pintura a óleo |
| `?clouds=0`, `?mist=0`, `?valley=0`, `?godrays=0`, `?scatter=0`, `?cloudshadow=0`, `?flora=0` | desligam nuvens volumétricas, brétema, névoa de vale, god rays, espalhamento na névoa, sombra das nuvens e flores do prado |
| `?reflectms=0` | reflexo da água capturado a cada quadro |
| `?perf` | timestamps de GPU |

## Estrutura

- `src/main.js`: carga em etapas, renderer, pós-processamento e pré-compilação dos shaders nos contextos reais.
- `src/world/heightfield.js`, `gen.worker.js`, `genFields.js`: relevo, máscara, ruído e AO, gerados em faixas num pool de workers.
- `src/world/terrain.js`, `horizon.js`, `sky.js`, `water.js`: terreno, cordilheiras distantes, céu e água.
- `src/world/vegetation.js`, `trees.js`, `plants.js`, `grass.js`, `meadowFlora.js`, `rocks.js`, `granite/`: vegetação e pedras em tiles instanciados com LOD (`src/core/chunked.js`).
- `src/world/layout.js`, `buildings.js`, `castroHouse.js`, `fort.js`, `materials.js`, `surfaceBake.js`: o plano da vila, as construções e os materiais, cujas superfícies são pré-geradas em textura.
- `src/world/seabed/`, `fish/`, `birds/`, `koi/`: fundo do mar, peixes, aves e carpas.
- `src/world/lakeWater.js`, `rivers.js`, `riverCourse.js`, `weather.js`, `lightning.js`, `cloudShadow.js`: lagos, rios, chuva, raios e sombra das nuvens.
- `src/post/`: profundidade de campo, nuvens volumétricas, brétema, névoa de vale, god rays e efeitos embaixo d'água.
- `src/editor/`: editores de relevo, objetos e natureza.
- `src/core/`: instâncias em tiles, cache no IndexedDB, cópias leves para reflexo e sombra, recuperação da perda da GPU.

## Ferramentas (QA)

Rodam no Edge headless com WebGPU, com o servidor de desenvolvimento no ar (`npm run dev`):

- `node tools/verify.mjs`: checagem de regressão da imagem em carga fria e com cache, comparada com `tools/verify.baseline.json`. Rode antes de publicar mudanças visuais.
- `node tools/shoot.mjs <prefixo> [vistas]`: capturas em `shots/`.
- `node tools/loadtime.mjs`, `shadercost.mjs`, `pipedup.mjs`, `abtest.mjs`: tempo de carga, custo de compilação de cada shader, pipelines criados depois da carga e A/B de tempo de quadro.
- Testes específicos: `houses.mjs`, `trees.mjs`, `grass.mjs`, `rocks.mjs`, `birds.mjs`, `fish.mjs`, `dive.mjs`, `koi.mjs`, `river.mjs`, `lightning.mjs`, `multiplayer.mjs`, `terrainedit.mjs`, `objectedit.mjs`, `natureedit.mjs`, `clearing.mjs`.

O `CLAUDE.md` tem as notas técnicas: decisões, armadilhas do three r186 e do WebGPU, e pendências.

## Publicação

A cada push no `main`, o GitHub Actions (`.github/workflows/deploy.yml`) gera o build e publica no GitHub Pages.

## Créditos

- **[Tidewater](https://github.com/dgreenheck/tidewater)** (MIT, Copyright (c) 2026 DRG Software Solutions LLC, em `licenses/LICENSE-Tidewater.md`): peixes, fundo do mar, pedras de granito, gaivotas e aves pousadas, carvalho, tojo e fento, atlas de folhas, impostores, grama, gotas na lente e neve marinha, adaptados. Cada arquivo portado traz o cabeçalho de origem.
- **[Drusniel: Gods' End](https://github.com/danielsobrado/drusniel-gods-end)** (MIT, Copyright (c) 2026 Daniel Sobrado, em `licenses/LICENSE-Drusniel.md`), adaptados:
  - o lago com nível e superfície próprios (`src/world/lakeFill.js`, `lakeWater.js`);
  - a sombra de nuvens (`src/world/cloudShadow.js`);
  - o reflexo da água com orçamento e reprojeção (`src/world/planarReprojection.js`);
  - a preparação dos draws do mergulho (`prepareDive` em `src/main.js`);
  - a recuperação da perda da GPU (`src/core/recovery.js`);
  - a flora de lago com a taboa (`src/world/lakeFlora.js`);
  - o rio com cachoeiras e spray (`src/world/riverCourse.js`, `rivers.js`, `riverMist.js`);
  - a névoa de vale (`src/post/valleyFog.js`);
  - a chuva com chão molhado (`src/world/weather.js`);
  - as plantas do prado (`src/world/meadowFlora.js`).
- **[Stylized Premium Scenes](https://github.com/CortizLabs/stylized-premium-patreon)** (MIT, Copyright (c) 2026 Christian Ortiz "Cortiz", em `licenses/LICENSE-Cortiz.md`): as gotas de chuva batendo, com anéis nas poças e na água e brilhos dos impactos (`src/world/rainImpacts.js`), a partir do `wetSurface.ts`, portado para TSL e adaptado; a ideia dos panos ao vento (`clothMaterial` em `src/world/materials.js`), do `windSway.ts`; e o modo pintura a óleo (`src/post/kuwahara.js`, Kuwahara anisotrópico, que ele adapta de Maxime Heckel).
- **[three-geospatial / @takram/three-clouds](https://github.com/takram-design-engineering/three-geospatial/tree/main/packages/clouds)** (MIT, Copyright (c) 2024 Shota Matsuda, em `licenses/LICENSE-takram-clouds.md`): o modelo das nuvens volumétricas (camadas pelo mapa de clima, forma e detalhe, espalhamento múltiplo, integração por passo, filtro temporal), portado para TSL em `src/post/clouds.js`, e as texturas de forma, detalhe e clima (`public/clouds/`).
- **[Folio 2025](https://github.com/brunosimon/folio-2025)** (MIT, Copyright (c) 2025 Bruno Simon, em `licenses/LICENSE-folio-2025.md`): a organização das opções do painel (qualidade, áudio, renderizador), em `src/core/settings.js`.
- **[offroad](https://github.com/alexadrerui/offroad)** (MIT, Copyright (c) 2026 Arz-Gev, em `licenses/LICENSE-offroad.md`): o esquema da visita junto (sala pelo link, estados a 10 Hz, buffer com atraso, relógio estimado pelo menor atraso, extrapolação), em `src/core/multiplayer.js`.
- **[Lightning-VFX](https://github.com/SahilK-027/Lightning-VFX)** (MIT, Copyright (c) 2026 Sahil K, em `licenses/LICENSE-LightningVFX.md`): o raio com ramos, as rachaduras, as faíscas e a onda de choque (`src/world/lightning.js`), portados para TSL e adaptados.
- **[AndyLe Pool](https://github.com/AndyLeAI/Andy_KOI_Pool)** (Apache License 2.0, AndyLeAI): carpas koi e lótus de `src/world/koi/` (`koi.js`, `lotus.js`), adaptados. A licença está em `src/world/koi/LICENSE-AndyLePool`.
- **[shader-studio](https://github.com/void032/shader-studio)** (MIT, Copyright (c) 2025 Vineet Kumar "void032", em `licenses/LICENSE-shader-studio.md`): o carimbo de relevo procedural (fbm e ilha) da ferramenta "Gerar" do editor.
- **Makone** (MIT): ideias das ferramentas `tools/verify.mjs` e `tools/houses.mjs`.
- **[@takram/three-atmosphere](https://github.com/takram-design-engineering/three-geospatial)** (MIT, Copyright (c) 2024 Shota Matsuda, em `licenses/LICENSE-takram-atmosphere.md`): as estrelas (`src/world/stars.js`, com o Yale Bright Star Catalog empacotado em `public/sky/stars.bin`) e a lua (`src/world/sky.js`).
- Mapa de cor da lua: NASA CGI Moon Kit (LROC), crédito NASA's Scientific Visualization Studio.
- Cáusticas embaixo d'água a partir do "Tileable Water Caustic" de Dave Hoskins (ver a ressalva em `THIRD_PARTY_NOTICES.md`); hashes sem seno do "Hash without Sine" de Dave Hoskins (MIT).
- [three.js](https://github.com/mrdoob/three.js) e seus exemplos (`webgpu_custom_fog_scattering`, `webgpu_postprocessing_fog`, `webgpu_sculpt`), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) para os raycasts e [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg), todos MIT (`licenses/`).
- Ideias de ferramentas do editor (margens de água, decorações, pincel de natureza) inspiradas no jogo Habitat Creator.

## Licença

O código e as imagens do Castro do Mar estão sob a licença **MIT** (`LICENSE`): pode usar, modificar, redistribuir e vender, desde que mantenha o aviso de copyright.

As partes vindas de outros projetos (listadas em Créditos) continuam sob as licenças delas, quase todas MIT; as carpas e o lótus são Apache 2.0. Os textos completos estão em `licenses/`, e o `THIRD_PARTY_NOTICES.md` mostra o que veio de onde, as regras de cada licença e uma ressalva: a cáustica embaixo d'água pode ser não comercial (CC BY-NC-SA, o padrão do Shadertoy) e deve ser trocada antes de um uso comercial.
