# Castro do Mar — notas para o Claude

Recriação procedural (three.js r186, WebGPU + TSL) da vila celta das imagens em `ref/`.
Idioma do usuário: português. Todo o conteúdo (terreno, texturas, casas) é procedural.

## Rodar e verificar
- `npm run dev`: Vite na porta 5190 (`?auto` pula o botão de entrada, `?webgl` força WebGL 2).
- `node tools/shoot.mjs <prefixo> [vistas...]`: captura headless (Edge + WebGPU) em `shots/`.
  Use `--cam=x,y,z,tx,ty,tz` para uma câmera avulsa. Capturas de várias vistas podem passar de 7 min.
- `node tools/profile.mjs [--from=x,z] [rumos]`: perfil de alturas do relevo por rumo da bússola.
- `node tools/ring.mjs`: altura máxima e média do horizonte por setor.
- O painel do navegador do app pausa o render quando está oculto; prefira o `shoot.mjs`.

## Convenções
- Eixos: +X leste (mar), +Z sul, +Y cima; 1 unidade = 1 m. O layout fica em `src/world/layout.js`.
- **Relevo:** lógica em `heightfield.js`, calculada no worker (`gen.worker.js`). O horizonte distante (`horizon.js`) reutiliza `rawHeight`.
- **Instâncias:** `src/core/chunked.js`, com lotes de capacidade fixa 256 para manter um único shader por espécie.
- **Layers:** 1 = props que não entram no reflexo; 2 = objetos que o reflexo da água vê.
- **Limite do WebGPU:** 8 vertex buffers por pipeline; empacote atributos (ex.: `aux` vec4 na vegetação).
- **TSL:** nunca somar número JS com node (`0 + uniform` vira string). Use `smoothstep(a, b, x)` com a < b e `.oneMinus()` para inverter.

## Câmera
- `src/controls/freecam.js`: voo livre (WASD/QE, Shift, arrastar, roda do mouse, 1–6 vistas).
- `src/controls/focus.js`: foco automático com profundidade de campo (`DepthOfFieldNode` de TSL sobre o pass da cena).
  - O raycast parte do centro da tela, cerca de 12×/s.
  - Os alvos são as malhas de casas e forte (com BVH do `three-mesh-bvh`), as instâncias visíveis a menos de 80 m (exceto grama e cascalho) e o heightfield.
  - O efeito entra abaixo de 45 m e fica pleno abaixo de 22 m, com transição suave.
  - A tecla **B** (ou a opção no painel) liga e desliga, trocando o `outputNode` do `RenderPipeline`.
  - A HUD mostra uma retícula central com a distância focada.

- **Mergulho:** sobre a água a câmera pode descer até 0,6 m do fundo (`freecam.js`: `waterLevel`, `diveClearance`).
  - `src/post/underwater.js`: abaixo de `WATER_LEVEL`, a tela toda passa para o meio aquático (absorção por canal, névoa verde-azulada, escurece com a profundidade). Não há divisão na linha d'água.
  - `src/post/lensDroplets.js`: gotas na lente ao voltar à superfície, secando em ~9 s. É um porte do Tidewater (MIT, manter o cabeçalho).
  - Os dois entram em `graded()` no `main.js`, antes do `renderOutput`.
  - QA: `node tools/dive.mjs [prefixo]` captura a cena submersa, dois pontos do fundo (rocha e areia), a lente molhada e a lente seca.
  - `underwater.js` reconstrói a posição de cada pixel pela profundidade e absorve a luz no caminho superfície → ponto. O terreno e o fundo escurecem juntos com a profundidade.
  - `src/post/marineSnow.js`: partículas em suspensão numa caixa de 8 m em volta da câmera, só embaixo d'água. É um porte do Tidewater (MIT).
- **Fundo do mar** (`src/world/seabed/`, porte parcial do recife do Tidewater, MIT):
  - `batch.js`: todos os modelos num único mesh e num único pipeline, com uma chamada de desenho indireta por modelo/LOD e instâncias num storage buffer. Só funciona em WebGPU.
  - `geometry.js`: geradores do Tidewater (pedras, ouriço, anêmona, pradaria, sargaço, estrela, cascalho) mais os nossos (laminária `forest`/`sugar`, alface-do-mar, mexilhões).
  - `materials.js`: um material físico com um ramo por `SURFACE`, a ondulação analítica vinda do leste e a translucidez como emissivo.
  - `seabed.js`: distribuição por habitat (profundidade, declive, manchas de ruído → rocha/areia) em tiles de 16 m gerados deterministicamente em volta da câmera (64 slots × 448 instâncias). Fica desligado acima de ~26 m sobre a água.
  - O terreno submerso (`terrain.js`) usa areia/lodo com marcas de ondulação; a rocha da costa só vale na linha d'água.
- **Regras do fundo e dos peixes são dados**:
  - `src/world/seabed/config.js`: semente, habitat (rocha/areia, manchas), tipos (modelo, superfície, tamanhos, cores, LOD) e camadas de distribuição. Cada entrada tem peso × janela de profundidade × rocha/areia × mancha × declive.
  - `src/world/fish/config.js`: semente, comportamentos, levantamento de habitat das células e regras de spawn (`when`, `chance`, `groups`, `count`, `zone`, `oneOf`).
  - O código (`seabed.js`, `schools.js`) só interpreta essas tabelas. Tudo é determinístico pela semente e pelas coordenadas: a mesma semente dá o mesmo mundo.
  - Para testar sem recarregar, edite `app.seabed.config` / `app.fish.config` no console e chame `app.seabed.regenerate()` / `app.fish.regenerate()`. Espécie de peixe nova: anatomia em `species.js` e padrão de pele em `material.js`. Organismo novo do fundo: gerador em `geometry.js`, entrada em `MODELS` (`seabed.js`) e ramo de superfície em `materials.js`.
- **Peixes** (`src/world/fish/`, porte do `Fish.js` do Tidewater, MIT):
  - `geometry.js` e `creatures.js` são cópias (peixe montado pela tabela de anatomia; raia).
  - `species.js`: 10 espécies galegas — peixe-rei, sardinha, chicharro, xarda, muxo, robaliza, sargo, maragota, agulha e raia.
  - `material.js`: a pele do Tidewater, com as marcas dessas espécies. A translucidez das nadadeiras entra como emissivo.
  - `schools.js`: grupos criados por habitat em células de 48 m em volta da câmera (16 células × 900 peixes, uma por frame) e descartados longe dela. Comportamentos do Tidewater: cardume, bola de isca, patrulha que caça a bola, mill, forrageio, solo, superfície, salto da tainha, raia que descansa. Os peixes fogem da câmera embaixo d'água.
  - A simulação e o culling ficam na CPU (~0,6 ms para ~1.900 peixes). Os registros visíveis são compactados e sobem num único intervalo.
  - `app.fish.paused = true` congela a simulação (QA). `node tools/fish.mjs [prefixo] [espécies...]` faz um close-up lateral de cada espécie.
  - Limitação: o chão dos peixes é só o heightfield; eles ainda podem atravessar blocos de granito do fundo.
- Embaixo d'água o `camera.far` cai para 90 m (a névoa esconde o resto). O frame submerso passou de 27,6 para 16,6 ms.

- **Pedras de granito** (`src/world/granite/`, porte do Tidewater, MIT; usadas por `rocks.js`):
  - `geometry.js`: icosfera cortada por planos de fratura, com cavidade (`ao`) no vértice. Estilos boulder/block/slab/spire mais `tor` (bloco arredondado de granito). A base plana é deslocada para y = −0,35, como nas pedras antigas.
  - `detail.js`: textura 512² gerada na CPU (~0,26 s) — R placas fraturadas, G solo, B grãos, A fbm.
  - `shading.js`: `graniteSurface` (3 amostras triplanares; juntas, placas, pintas de feldspato, líquen cinza-verde e laranja perto do mar, musgo, faixa preta de líquen, cracas, algas, crosta coralina submersa, molhado) mais `createGraniteMaterial`, com o contato com o chão lido do `heightTex` do terreno. `lo: true` é a variante barata dos tiles distantes e do cascalho.
  - Conjuntos por ambiente: `tor*` nas colinas, `shore*` na costa e `talus*` no pé do penhasco. O forte continua com o `createRockMaterial` antigo.
  - QA: `node tools/rocks.mjs [prefixo]` faz close-ups de uma pedra de cada conjunto.

## Pendências (backlog)
### Câmera
- [ ] O foco não é aplicado nas capturas (`app.capture`) quando o loop está pausado; considerar `focus.update` antes de capturar.
- [ ] Opcional: foco pelo clique (clicar num ponto para focar) e aberture/bokeh ajustáveis no painel.

### Relevo e montanhas (em andamento)
- [ ] Remover o escalonamento em degraus de 14 m do maciço em `heightfield.js`
      (`massif = lerp( massif, Math.round( massif / 14 ) * 14, 0.18 )`). É ele que causa o padrão quadriculado na rocha.
- [ ] Baixar a linha de neve das cordilheiras distantes em `horizon.js` (`snowLine` 1150 → ~780).
- [ ] Conferir as vistas 4 (Lago) e 5 (Montanhas) depois das mudanças no relevo; a captura da vista 5 estourou o tempo.
- [ ] Cordilheiras distantes ainda com sombreamento "amarrotado" e faixa clara de água na base; comparar com `ref/ref_perspective.webp`.

### Arte (dos relatórios de QA)
- [ ] Face do penhasco da mina: deslocar a geometria (~1,5 m) com 2–3 saliências, vegetação nas saliências e fissuras só no normal.
- [ ] Copas das árvores ainda "bolhosas": mais aglomerados de cartões de folha com vazios, troncos e galhos visíveis.
- [ ] Nuvens: camada de cúmulos e bancos de névoa nos vales distantes.
- [ ] Vila mais compacta, com mais tecido vermelho e cercas nas vielas.

### Performance (em andamento)
Ferramentas: `tools/perf.mjs` (tempo de GPU por camada, via timestamp com `?perf`), `tools/cpuprof.mjs` (perfil de CPU do loop),
`tools/leak.mjs` (cresce shader/pipeline?), `tools/resprobe.mjs` (frame × resolução × recursos) e `tools/fps.mjs` (janela real;
falha se a janela ficar atrás de outras, porque o Edge pausa o rAF).

Feito:
- [x] **Causa principal:** instâncias com ≤ 1024 matrizes usavam o caminho de uniform buffer, que dá nome único por objeto e
      gerava um shader e um pipeline por tile (437 vertex shaders; `setPipeline` = 54% da CPU). A capacidade subiu para 2048
      (caminho de atributo instanciado), ficando 50 shaders e ~80 pipelines.
- [x] Draw calls: de 814 para ~555 (tiles maiores; no reflexo, só o LOD baixo das árvores e chunks de terreno a < 700 m).
- [x] Matrizes estáticas congeladas (`matrixAutoUpdate`/`matrixWorldAutoUpdate` = false). A CPU do loop fica ~80% ociosa.

Medições no headless (vista 0, 1600×900, ms/frame; valores absolutos do headless não representam a janela real):
`full 151.6 | 800×450 84.4 | sem DOF 138.7 | + sem reflexo 125.2 | + sem sombras 112.6`. O gargalo agora é **GPU/preenchimento**.

Próximos passos:
- [ ] Pipelines ainda crescem devagar (+2 a cada 20 frames): investigar quais variantes surgem (sombra? LOD?).
- [ ] DOF: rodar em meia resolução ou desligar sozinho quando `amount` ≈ 0 (hoje sempre roda com o foco ligado).
- [ ] Reflexo da água: `resolutionScale` 0.45 → 0.3 e/ou atualizar a cada 2 frames.
- [ ] Sombras: mapa 4096 → 2048 ou `CSMShadowNode` com 2 cascatas; menos casters.
- [ ] Shaders pesados por pixel: pedras (Worley + fbm), casas (pedra/colmo procedurais) e terreno. Pré-gerar em texturas como no terreno.
- [ ] Resolução dinâmica: reduz a `pixelRatio` e realoca os render targets; trocar por escala do pass.
- [ ] Medir na janela real (painel do app visível ou Edge em primeiro plano) para confirmar o FPS.

### Técnico
- [ ] Fallback WebGL (`?webgl`) não confirmado; o teste headless estourou o tempo.
- [x] Pedras: ruídos por pixel trocados por textura pré-gerada (`granite/`) e `materialLo` nos tiles distantes (custo de GPU na vista 0: ~0,24 → ~0,02 ms no headless).
- [ ] Vegetação detalhada: conjunto "hi" centrado na câmera em vez de tiles, para reduzir draw calls.
- [ ] Sombra: fazer o snapping no espaço de vista da luz (ainda cintila).
- [ ] Carregamento de 25–40 s: cachear heightfield, máscara e AO (IndexedDB) ou pré-gerar em `.bin`.

## Git
- Remoto: https://github.com/alexadrerui/Castro-do-Mar (branch `main`).
- O projeto fica num pendrive (E:, sistema de arquivos sem registro de dono), por isso o git acusa
  "dubious ownership". Use `git -c safe.directory="E:/Vila_Celta_ 890" ...` em cada comando
  (ou o usuário pode registrar a exceção uma vez com `git config --global --add safe.directory`).
- Commits com `user.name=alexadrerui`, `user.email=alexadrerui@gmail.com`.
