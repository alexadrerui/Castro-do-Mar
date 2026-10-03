# Castro do Mar — Vila Celta 890

Recriação procedural de um castro celta à beira de um lago, em **three.js r186** com **WebGPU** e **TSL** (Three.js Shading Language). Os mesmos shaders rodam em WebGPU e em WebGL 2 (`?webgl`).

## Rodar

```bash
npm install
npm run dev
```

Abra http://localhost:5190 (`?auto` pula o botão de entrada).

## Controles

- **Arrastar:** olhar
- **WASD / setas:** voar
- **Q / E:** descer e subir
- **Shift:** voo rápido
- **Roda do mouse:** muda a velocidade
- **1–6:** vistas pré-definidas
- **H:** painel
- **P:** foto (salva em `shots/`)
- **U:** esconde a HUD

## Estrutura

- `src/world/heightfield.js` + `gen.worker.js` — relevo, costa, crista, trilhas e AO, gerados num Web Worker.
- `src/world/terrain.js` — terreno em chunks com LOD e material TSL (texturas de ruído pré-geradas, triplanar, bump procedural).
- `src/world/water.js`, `horizon.js`, `sky.js` — lago com reflexo, montanhas distantes e céu `SkyMesh` com nuvens.
- `src/world/vegetation.js`, `plants.js`, `rocks.js` — vegetação e pedras instanciadas em tiles com LOD (`src/core/chunked.js`).
- `src/world/buildings.js`, `fort.js`, `materials.js` — vila, forte e minas escavadas por CSG, com materiais TSL.
- `tools/shoot.mjs` — captura headless (Edge + WebGPU) usada no loop de QA.

## Créditos

- **[Tidewater](https://github.com/dgreenheck/tidewater)** (MIT, Copyright (c) 2026 DRG Software Solutions LLC): peixes, fundo do mar, pedras de granito, gaivotas, árvore/arbusto/fento, atlas de folhas, impostores, gotas na lente e neve marinha, adaptados (cada arquivo portado traz o cabeçalho de origem).
- **[AndyLe Pool](https://github.com/AndyLeAI/Andy_KOI_Pool)** (Apache License 2.0, AndyLeAI): carpas koi e lótus de `src/world/koi/` (`koi.js`, `lotus.js`), adaptados; a licença vai junto em `src/world/koi/LICENSE-AndyLePool`.
- **[Drusniel: Gods' End](https://github.com/danielsobrado/drusniel-gods-end)** (MIT, Copyright (c) 2026 Daniel Sobrado: ideia do lago com nível e superfície próprios (`src/world/lakeFill.js`, `lakeWater.js`) a sombra de nuvens (`src/world/cloudShadow.js`) o reflexo da água com orçamento e reprojeção (`src/world/planarReprojection.js`) a preparação dos draws do mergulho (`prepareDive` em `src/main.js`) a recuperação da perda da GPU (`src/core/recovery.js`) a flora de lago com a taboa (`src/world/lakeFlora.js`) o rio com cachoeiras e spray (`src/world/riverCourse.js`, `rivers.js`, `riverMist.js`) a névoa de vale (`src/post/valleyFog.js`) a chuva com chão molhado (`src/world/weather.js`) e as plantas do prado (`src/world/meadowFlora.js`), adaptados.
- **[Lightning-VFX](https://github.com/SahilK-027/Lightning-VFX)** (MIT, Copyright (c) 2026 Sahil K, em `licenses/LICENSE-LightningVFX.md`): o raio com ramos, as rachaduras, as faíscas e a onda de choque (`src/world/lightning.js`), portados para TSL e adaptados.
