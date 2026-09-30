# Castro do Mar — notas para o Claude

Recriação procedural (three.js r186, WebGPU + TSL) da vila celta das imagens em `ref/`.
Idioma do usuário: português. Todo o conteúdo (terreno, texturas, casas) é procedural.

## Rodar e verificar
- `npm run dev`: Vite na porta 5190 (`?auto` pula o botão de entrada, `?webgl` força WebGL 2).
- `node tools/shoot.mjs <prefixo> [vistas...]`: captura headless (Edge + WebGPU) em `shots/`.
  Use `--cam=x,y,z,tx,ty,tz` para uma câmera avulsa. Capturas de várias vistas podem passar de 7 min.
- `node tools/profile.mjs [--from=x,z] [rumos]`: perfil de alturas do relevo por rumo da bússola.
- `node tools/ring.mjs`: altura máxima e média do horizonte por setor.
- `node tools/loadtime.mjs [n] [parâmetros]`: tempo de cada etapa do loader e do primeiro frame, a frio (IndexedDB limpo) e com cache; o segundo argumento vai para a URL (ex.: `nocache`).
- O painel do navegador do app pausa o render quando está oculto; prefira o `shoot.mjs`.

## Convenções
- Eixos: +X leste (mar), +Z sul, +Y cima; 1 unidade = 1 m. O layout fica em `src/world/layout.js`.
- **Relevo:** lógica em `heightfield.js`, calculada no worker (`gen.worker.js`). O horizonte distante (`horizon.js`) reutiliza `rawHeight`.
  - Relevo, máscara, AO e macro ficam em cache no IndexedDB (`src/core/cache.js`). A chave é o hash do código de `heightfield.js`, `layout.js`, `noise.js` e `gen.worker.js`: editar esses arquivos invalida o cache sozinho.
  - `?nocache` ignora o cache; `app.clearCache()` apaga.
- **Instâncias:** `src/core/chunked.js`. Os tiles são `Mesh` com `InstancedBufferGeometry`, **não** `InstancedMesh`.
  - A matriz de cada instância vem dos atributos `iM0..iM3` (um buffer intercalado, que ocupa um slot de vertex buffer) e é aplicada no `positionNode` do material, antes do `positionNode` original. O passe de sombra copia o `positionNode`, então a sombra acompanha.
  - Motivo: o three indexa o shader de um `InstancedMesh` pelo `uuid` do objeto, e cada tile montava o próprio grafo TSL (~12 ms × ~830 tiles). Agora todos os tiles de um material compartilham um único build.
  - Raycast por instância em `mesh.raycast`; os dados ficam em `mesh.userData.instances` (`src`, `matrices`, `count`).
  - Materiais passados ao `ChunkedInstances` não podem ser usados em meshes comuns (eles exigem os atributos `iM*`).
- **Pré-compilação** (etapa `compile` no `main.js`):
  - O shader de um objeto é indexado pelo render context (render target, MRT e profundidade da chamada `render()` aninhada). Um `compileAsync( scene, camera )` simples compila variantes que nenhum frame usa.
  - Por isso roda antes um frame de sonda com a cena vazia (só luzes e água), que registra a profundidade de cada render target.
  - Depois compila para o pass da cena e em seguida para o reflexo, nessa ordem (a ordem inversa deixou o céu branco). As duas compilações não podem rodar ao mesmo tempo, porque compartilham o `lightsNode`.
  - `renderer.info.calls ++` antes de cada compilação: a chave de luzes/ambiente/névoa fica em cache por `info.calls`.
  - Usa internos do r186 (`renderer._renderContexts.get`); conferir ao atualizar o three. O console mostra `first frame (ms)`: se voltar a passar de ~0,5 s, a pré-compilação deixou de bater.
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
  - Cáusticas (`underwater.js`): padrão procedural de cáustica ("Tileable Water Caustic" do Dave Hoskins), só nas superfícies viradas para cima. A normal vem das derivadas da posição reconstruída. O padrão é deslocado pelo sol refratado e perde nitidez e força com a profundidade. `app.underwater.debug` = 1 mostra o fator das cáusticas, 2 a máscara "para cima", 3 a profundidade.
  - `src/world/waterUnderside.js`: a superfície vista de baixo — plano com `BackSide`, visível só embaixo d'água. Tem a janela de Snell (céu refratado com nuvens suaves e o brilho do sol), reflexão total fora dela, aro escuro na borda e ondas analíticas que quebram a janela.
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
  - O chão dos peixes é `seabed.floorAt(x, z)`: terreno ou topo das pedras do fundo (cada pedra é um domo sobre a base, numa grade de 4 m mantida pelos tiles carregados). Os peixes passam por cima das pedras em vez de atravessá-las.
- Embaixo d'água o `camera.far` cai para 90 m (a névoa esconde o resto). O frame submerso passou de 27,6 para 16,6 ms.

- **Carvalhos** (`src/world/trees.js` e `src/world/leafAtlas.js`, porte do Tidewater, MIT):
  - `trees.js` (`oakTree(lod, seed)`): tronco com a base alargada, bifurcação baixa, ramos curvos (Bézier) e 8 lóbulos de copa, cada um com aglomerados de cartões cruzados e vazios entre eles. Normais volumétricas e exposição (`ao`) por cartão. Gera o nosso formato de vértice (`color`, `aux`, `uv`); LOD 1 com menos aglomerados e cartões maiores.
  - `leafAtlas.js`: atlas 2×2 de rosetas de folhas gerado uma vez na GPU (R cobertura, G brilho, B variação por folha). O carvalho usa o bloco 0 com um material próprio (`createFoliageMaterial( sunDir, { clusters } )`, `app.canopyMaterial`); pinheiro, bétula, arbustos e grama seguem no atlas de canvas.
  - Impostores octaédricos (`src/world/impostors.js`, porte do `Impostors.js`): o carvalho de perto é renderizado de 6×6 direções em dois atlas na carga (~10 ms). Cada árvore distante vira um quad virado para a câmera, que reprojeta o raio no quadro mais próximo. Terceiro nível do `ChunkedInstances` (`impostor`, `impostorDistance` = 320 m para o carvalho); a troca é por tile, sem fade.
  - Sub-bosque (`trees.js`): `shrubBush` (tojo/giesta: lóbulos de cartões com o bloco de folhas estreitas do atlas, material de aglomerados) e `bracken` (fento: frondes do Tidewater com haste nua e lâmina triangular; os folíolos são recortados pela `uv` em `createFoliageMaterial( sunDir, { fern: true } )`). O fento predomina nas manchas de mata e nas partes baixas; o tojo, nas encostas altas.
  - Material de folhagem: `MeshPhysicalNodeMaterial` com `specularIntensity` 0,2 (com o especular padrão, o Fresnel em ângulo rasante deixava grama e frondes brancas/cinza). Cartões e frondes usam `normalViewGeometry` sem a inversão do `DoubleSide` (a face de baixo ficava preta); troncos e cones mantêm a inversão.
  - QA: `node tools/trees.mjs [prefixo] [espécie] [--imp] [--solo]` enquadra a planta mais próxima da vila (a pé, de longe e do alto), com a câmera do lado do sol; `--imp` força os impostores a qualquer distância e `--solo` esconde pedras e outras plantas.

- **Gaivotas** (`src/world/birds/`, porte do Tidewater, MIT):
  - `shapes.js` é cópia do `BirdShapes.js` (modelo de ave com corpo, pescoço, bico, cauda em leque e asas de três ossos).
  - `gulls.js`: gaivotas-patiamarelas (26) circulando sobre a baía, acima do relevo sob cada círculo. Alternam planeio (asa em "M") e batidas; inclinam nas curvas. Tudo no vertex shader, com relógio próprio (`app.gulls.time`); `app.gulls.paused = true` congela o voo.
  - Cores do padrão em sRGB (`srgb()`); os `smoothstep` invertidos do Tidewater foram trocados pela forma com `.oneMinus()`.
  - QA: `node tools/gulls.mjs [prefixo] [índice]` faz close-ups de lado, de baixo e de cima e uma vista geral.

- **Pedras de granito** (`src/world/granite/`, porte do Tidewater, MIT; usadas por `rocks.js`):
  - `geometry.js`: icosfera cortada por planos de fratura, com cavidade (`ao`) no vértice. Estilos boulder/block/slab/spire mais `tor` (bloco arredondado de granito). A base plana é deslocada para y = −0,35, como nas pedras antigas.
  - `detail.js`: textura 512² gerada na CPU (~0,26 s) — R placas fraturadas, G solo, B grãos, A fbm.
  - `shading.js`: `graniteSurface` (3 amostras triplanares; juntas, placas, pintas de feldspato, líquen cinza-verde e laranja perto do mar, musgo, faixa preta de líquen, cracas, algas, crosta coralina submersa, molhado) mais `createGraniteMaterial`, com o contato com o chão lido do `heightTex` do terreno. `lo: true` é a variante barata dos tiles distantes e do cascalho.
  - Conjuntos por ambiente: `tor*` nas colinas, `shore*` na costa e `talus*` no pé do penhasco. O forte continua com o `createRockMaterial` antigo.
  - QA: `node tools/rocks.mjs [prefixo]` faz close-ups de uma pedra de cada conjunto.

- **Foco pelo clique** (`focus.js` `focusAt`/`release`, `main.js`): um clique sem arrastar (< 5 px e < 350 ms) trava o foco no ponto clicado e a retícula da HUD acompanha esse ponto. Clicar no céu (nada a menos de 140 m), trocar de vista ou o ponto sair da tela devolvem o foco ao centro.
- **Água** (`water.js`):
  - Zonas de vento com ruído de baixa frequência (~420 m e ~140 m): espelho calmo alterna com água encrespada, atuando na refletividade e na distorção do reflexo. Há também uma oitava longa de ondulação (~160 m) contra a repetição.
  - Sombra do sol na água: camada fina `ShadowNodeMaterial` (`water.shadowMesh`) 2 cm acima do plano, que escurece só onde cai a sombra, usando o mesmo mapa de sombra do terreno. Tentativas que não funcionaram: um lighting model próprio (o `MeshBasic` descarta o resultado que ele produz) e ler o mapa de sombra na mão (a comparação de profundidade falhava).
  - Um plano casa sombra só se o material for de dupla face; o passe de sombra desenha as faces de trás.
- **Bloom** (`main.js`): `BloomNode` do three sobre a cena HDR (força 0,16, raio 0,35, limiar 1,05, meia resolução), liga/desliga no painel ("Brilho"). As 4 saídas (com/sem DOF × com/sem bloom) são montadas sob demanda.
- No headless, o `?perf` / `gpuProfile` hoje devolve tempos irreais (~0,2 ms por frame): não serve para medir custo de GPU.

## Pendências (backlog)
### Câmera
- [ ] O foco não é aplicado nas capturas (`app.capture`) quando o loop está pausado; considerar `focus.update` antes de capturar.
- [x] Foco pelo clique. (Abertura/bokeh ajustáveis no painel continuam opcionais.)

### Relevo e montanhas
- [x] Padrão quadriculado na rocha do maciço: vinha do detalhe de rocha de `terrain.js`, que se repete a cada 38 m, e não dos degraus de 14 m (removidos mesmo assim). De longe, o detalhe passa para o ruído macro.
- [x] Cordilheiras distantes "amarrotadas", translúcidas e com faixa clara na base: o winding da malha de `horizon.js` estava invertido (normais para baixo), então só apareciam as faces de trás.
- [x] Linha de neve das cordilheiras distantes: 1150 → 780.
- [x] Vistas 4 (Lago) e 5 (Montanhas) conferidas.

### Arte (dos relatórios de QA)
- [ ] Face do penhasco da mina: deslocar a geometria (~1,5 m) com 2–3 saliências, vegetação nas saliências e fissuras só no normal.
- [x] Copas dos carvalhos "bolhosas": trocadas pela árvore do Tidewater (ramos visíveis, aglomerados com vazios, atlas de folhas na GPU). Pinheiro e bétula ainda são os antigos.
- [x] Pinheiros pretos: não era o modelo, e sim a tonalidade de toda a vegetação convertida duas vezes para linear (`Color.set( hex )` já converte; havia um `.convertSRGBToLinear()` a mais em `vegetation.js`). Paletas de arbusto e fento reajustadas.
- [ ] Pinheiro ainda é o modelo antigo de cones (`plants.js`); dá para refazer no estilo dos carvalhos (o Tidewater não tem conífera).
- Tentativa descartada: árvores do pacote "Low Poly Trees Free" (Sketchfab, CC BY 4.0). Ficaram boas visualmente, mas somavam ~150 chamadas de desenho e faziam o pré-compile passar do limite de 12 s mesmo com cache (carga de ~8 s para ~20 s). Se voltar a elas: juntar as 3 variantes numa espécie só e investigar os pipelines novos.
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
- [x] Carregamento: cache de relevo/máscara/AO/macro no IndexedDB, um build TSL por material nos tiles e pré-compilação nos contextos reais.
      Com cache, ~8 s até o primeiro frame (antes ~16 s mais ~6 s de travada no primeiro frame). O primeiro frame caiu de ~6 s para ~0,1 s.
- [ ] Primeira visita (sem cache de shaders do navegador): a compilação dos pipelines na GPU passa de 12 s e bate no limite do `compile`.
- [ ] O horizonte (~1 s) e a vegetação/pedras (~1,1 s) ainda são gerados a cada carga; dá para cachear como o relevo.
- [ ] Objetos que só aparecem embaixo d'água (superfície vista de baixo, neve marinha, fundo, peixes) ainda compilam no primeiro mergulho.

## Git
- Remoto: https://github.com/alexadrerui/Castro-do-Mar (branch `main`).
- O projeto fica num pendrive (E:, sistema de arquivos sem registro de dono), por isso o git acusa
  "dubious ownership". Use `git -c safe.directory="E:/Vila_Celta_ 890" ...` em cada comando
  (ou o usuário pode registrar a exceção uma vez com `git config --global --add safe.directory`).
- Commits com `user.name=alexadrerui`, `user.email=alexadrerui@gmail.com`.
