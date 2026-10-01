# Castro do Mar — notas para o Claude

Recriação procedural (three.js r186, WebGPU + TSL) da vila celta das imagens em `ref/`.
Idioma do usuário: português. Todo o conteúdo (terreno, texturas, casas) é procedural.

## Rodar e verificar
- `npm run dev`: Vite na porta 5190 (`?auto` pula o botão de entrada, `?webgl` força WebGL 2).
- `node tools/shoot.mjs <prefixo> [vistas...]`: captura headless (Edge + WebGPU) em `shots/`.
  Use `--cam=x,y,z,tx,ty,tz` para uma câmera avulsa. Capturas de várias vistas podem passar de 7 min.
- `node tools/profile.mjs [--from=x,z] [rumos]`: perfil de alturas do relevo por rumo da bússola.
- `node tools/ring.mjs`: altura máxima e média do horizonte por setor.
- `node tools/verify.mjs [vistas] [--cold|--warm] [--update] [--params=...]`: checagem de regressão da imagem (ideia do `harness/verify.mjs` do Makone, MIT). Faz uma carga fria (perfil novo, sem cache) e outra com cache e, em cada vista, mede brilho, contraste, saturação, pixels estourados e pretos e o azul do céu (média das vistas com céu, só reprova se cair). Compara com `tools/verify.baseline.json` (uma referência para a carga fria e outra para a com cache, porque as nuvens mudam entre as duas), reprova com erro no console ou se as duas cargas diferirem, e sai com código 1. **Rode antes de publicar mudanças visuais ou de carregamento.** Mudança visual intencional: confira as imagens (`shots/verify_*`) e regrave com `--update`. Mantém o foco (profundidade de campo) como o usuário vê: o céu branco só aparecia por ele.
- `node tools/houses.mjs [round long granary hut lookout] [--pick=<índice>] [--context]`: folha de revisão das construções (ideia do `skills/object/review.md` do Makone). Para cada tipo, escolhe a casa mais afastada das outras e do castro e gera `shots/houses_<tipo>.png` com cinco vistas: frente (porta) e trás na altura dos olhos, 3/4 alto, planta e a 60 m (teste de silhueta). Cada câmera procura uma posição que veja cinco pontos da casa, sem nada colado na lente, fora de outras construções e de costas para o sol. O sexto quadro traz as medidas, tiradas por raycast (perfil r(h) de fora e parede por dentro): altura, diâmetro ou largura, parede visível, beiral, inclinação e fração da altura que é telhado, comparadas com faixas de referência da Idade do Ferro (tabela `REF` no topo do arquivo, ajustável). Vegetação, pedras, grama, fumaça e aves ficam ocultas, exceto com `--context`.
- `node tools/castroreview.mjs <prefixo> [--detail=0|1|2] [--flat|--unlit|--mat] [--plain] [--close]`: casa do castro (`src/world/castroHouse.js`, reconstrução img2threejs de `ref/casa_castro/`) sozinha na página `review/castro.html`, das cinco vistas das referências, com a silhueta enquadrada na caixa da referência; gera `shots/<prefixo>_ref1..5.png` e uma folha comparativa. `python ref/casa_castro/make_mattes.py` recorta as referências (o recorte da skill lê a vinheta do fundo como objeto) e `python ref/casa_castro/overlay.py <prefixo>` (render com `--plain`) dá a sobreposição e o IoU por vista. `--close` acrescenta cinco close-ups rasantes (`shots/<prefixo>_close_*.png`: paredes, torre, telhado, cone) para conferir o relevo. Materiais próprios (`CASTRO_KEYS`):
  - `castroStone` = `slabMaterial` (`materials.js`): lajes planas em fiadas da textura `slab` do `surfaceBake.js` (lajes de 1 a 3 células de 2,5 : 1, junta escura rebaixada). O relevo é uma altura em metros (almofada de 1,2 cm) passada ao `proceduralBump`; o `bump` do `stoneMaterial` em fiadas de 0,2 m virava linhas pretas.
  - `castroThatch` = `thatchMaterial` com `courses: 0` (as camadas vêm da geometria) e `tufts: 1` (tufos de ~18 × 60 cm, relevo de 2,5 cm).
  - Na vila é o tipo `castro` do `BUILDINGS` (`layout.js`, em −63, 24, porta para o mercado), ancorado no centro do conjunto (`CASTRO_HOUSE.centre`) e assentado no ponto mais baixo do chão sob as paredes; `r` = `CASTRO_HOUSE.footprintR` (pad, chão pisado, clareira). Também está no catálogo do editor de objetos; `node tools/castroedit.mjs [prefixo]` testa seleção por clique, giro em torno do pivô, remover e desfazer.
  - Custo: 9,6 mil triângulos; os dois shaders novos somam ~0,37 s de compilação a frio (`shadercost`, total 9,4 s). Pipeline img2threejs completo (`ref/casa_castro/spec.json`).
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
  - Storage buffers precisam ser enviados antes da pré-compilação (ex.: `birds.commit()` logo após criar o `BirdBatch`): um buffer nunca enviado deixava o pré-compile da cena pendente até o limite de 12 s.
  - Usa internos do r186 (`renderer._renderContexts.get`); conferir ao atualizar o three. O console mostra `first frame (ms)`: se voltar a passar de ~0,5 s, a pré-compilação deixou de bater.
- **Layers:** 1 = props que não entram no reflexo; 2 = objetos que o reflexo da água vê; 3 = cópias leves (`src/core/proxies.js`), vistas só pelo reflexo e pela sombra do sol.
- **Cópias leves (`proxies.js`):** os materiais procedurais de casas, forte e mina (`materials.js`, rocha do forte) eram compilados três vezes: cena, reflexo e sombra. O passe de sombra mantém todo o grafo de cor só para ler o alfa. Agora cada malha cujo material tem `userData.proxyColor` fica só na cena (sem sombra, fora da layer 2), e um filho com a mesma geometria e cor lisa num uniform (um shader para todas) aparece no reflexo e projeta a sombra. Material procedural novo: defina `proxyColor` (ver `proxyTone`).
- **Limite do WebGPU:** 8 vertex buffers por pipeline; empacote atributos (ex.: `aux` vec4 na vegetação).
- **TSL:** nunca somar número JS com node (`0 + uniform` vira string). Use `smoothstep(a, b, x)` com a < b e `.oneMinus()` para inverter.

## Editor de relevo (`?edit`)
- `src/editor/terrainEditor.js`. Pincéis no estilo do exemplo `webgpu_sculpt` (`Sculptor` da r186, que esculpe malhas livres e por isso não foi usado direto): Elevar, Baixar, Suavizar, Aplanar (à altura do início da pincelada), Ruído (fbm), Restaurar (volta ao relevo procedural) e Gerar (carimbo procedural do `shader-studio`, MIT: Perlin fbm ou Ilha, com a costa deformada por ruído). Tamanho, força e dureza; cursor em anel sobre o relevo (sobre a água no lago); desfazer/refazer por pincelada.
- **Água** (ideia das ferramentas de margem do jogo Habitat Creator): **Cavar** leva o relevo até a profundidade abaixo do nível da água (só abaixa) e **Aterrar** até a altura acima dele (só levanta). As duas deixam uma margem em rampa, de largura ajustável, até o relevo de antes da pincelada. É um perfil fixo, não uma taxa, então segurar o pincel não come a margem. O anel interno do cursor marca onde o nível fica plano. Um buraco cavado em terra se enche de água, porque o plano d'água cobre o mapa todo.
- **Vista de cima** (botão ou **T**): a câmera voa até ficar quase vertical sobre o cursor e guarda a posição de antes. Nesse modo `freecam.planar = true`: WASD andam no plano (para cima na tela = rumo da câmera) e Q/E sobem e descem. T de novo volta.
- Mouse: esquerdo esculpe, direito arrastado olha (`freecam.leftLook = false`), WASD/QE voa, Shift inverte, `[` `]` mudam o tamanho, T alterna a vista de cima, Ctrl+Z / Ctrl+Y desfazem e refazem. O clique de foco fica desligado no editor.
- **Camada de edição** (`src/world/terrainEdits.js`): uma grade de diferenças de altura (1121² float32) somada ao relevo procedural no worker, antes da AO. Fica no projeto em `public/terrain-edits.bin`. O servidor de desenvolvimento lê e grava o arquivo (`/__terrain-edits` no `vite.config.js`; GET responde 204 sem arquivo). O hash das edições entra na chave do cache.
- Durante a edição, só o heightfield, os blocos do terreno (`terrain.refresh`, no lugar, todos os LODs) e a textura de alturas acompanham. AO, vegetação, pedras, casas e grama são refeitos na carga seguinte: "Salvar e aplicar" grava e recarrega. Exportar/Importar/Limpar também existem (limpar pede dois cliques).
- **Encher** (lago com nível próprio, ideia do Drusniel: Gods' End — `LakeShape.js`/`waterGeometry.js`, MIT, `licenses/LICENSE-Drusniel.md`): clique numa depressão e a água sobe até a borda mais baixa, menos 20 cm (`src/world/lakeFill.js`: inundação minimax até o mar ou a beira da grade; recusa encosta, mar e bacia grande demais). Shift+clique remove. O lago vira só um ponto em `world-edits.json` (`lakes`), e o nível é recalculado a cada carga, então esculpir a depressão muda o lago.
  - `src/world/lakeWater.js` (`app.lakes`): superfície própria sobre as células do lago (+2 células sob as margens), com o material do mar (`water.js` com `level`, `geometry`, `envMap`, ondas 0,16 e espuma 0,12). O reflexo é o PMREM do céu, não o planar (um passe a mais por lago). O ambiente do céu é gerado já na etapa da água quando há lago (ou no `?edit`), para a água do lago entrar na pré-compilação.
  - `levelAt(x, z)` dá o nível sob a câmera para o `underwater.js` e o mergulho da `freecam`. `wet()` alimenta `setLakeTest` (`vegetation.js` `inLake`): sem árvores, arbustos, pedras e grama na água.
  - Fundo do mar e peixes marinhos não entram (trabalham pelo nível do mar). As carpas e o lótus (`world/koi/`) usam o nível do lago e aparecem ao "Salvar e aplicar".
  - Pendências: o leito segue com a cor do campo (o terreno só conhece o nível do mar), sem superfície vista de baixo nem neve marinha no lago, e o lago não acompanha o relevo ao vivo no editor (só na carga seguinte).
- QA: `node tools/terrainedit.mjs [prefixo] [--save]` usa o mouse de verdade: eleva, desfaz e refaz, suaviza, carimba uma ilha no lago e restaura; cava um lago em terra, aterra um raso e testa a vista de cima (T, W no plano, volta). Com `--save`, salva, recarrega, confere a ilha e apaga o arquivo de teste (não roda se já existir um `public/terrain-edits.bin`).

## Editor de objetos (`?edit`, aba "Objetos")
- `src/editor/objectEditor.js` (ideia do editor de decorações do Habitat Creator). Um clique seleciona uma casa, barraca ou adereço. O objeto ganha uma caixa ciano (`BoxHelper`), o gizmo `TransformControls` (mover no chão com a altura presa ao relevo, girar em torno do vertical, escala uniforme) e um menu flutuante ao lado: 1 Mover, 2 Girar, 3 Escalar, × e Remover. Teclas com seleção: 1/2/3 (no lugar das vistas da câmera), Delete, Esc; Ctrl+Z/Y. Arrastar o espaço vazio gira a câmera (`freecam.leftBlocker` evita isso sobre o gizmo). O catálogo do painel adiciona objetos: escolha um e clique no chão.
- **Edições** em `public/world-edits.json` (`src/world/worldEdits.js`): `objects` (`b<i>`/`s<i>`/`p<i>`, índices das listas originais de `layout.js`: `x`, `z`, `yaw`, `scale` ou `removed`) e `added` (objetos novos, ids `a<n>`). `applyWorldEdits` altera BUILDINGS/STALLS/PROPS na página e no worker antes de qualquer leitura, então pads no relevo, chão pisado, clareiras da vegetação e poleiros das aves acompanham. O hash entra na chave do cache. As barracas removidas continuam na lista com `removed`, porque compartilham uma sequência aleatória.
- `buildings.js`: cada objeto é construído sozinho (`buildObject`), com o giro e a escala aplicados em volta da âncora no chão. No modo normal tudo é fundido por material, como antes; no editor cada objeto vira um grupo (`objectGroup`, ~1.000 chamadas de desenho em vez de ~350). "Salvar e aplicar" (compartilhado com o relevo) grava e recarrega.
- Detalhes:
  - Casas redondas e cabanas movidas guardam a porta com que foram construídas (`door`); sem isso, a porta se reorientava para o centro da vila na carga seguinte.
  - Casa longa, cercado, carroça, varal, lenha e barraca recebem o giro no próprio ângulo, e a casa longa e o cercado recebem a escala nas dimensões. Assim são reconstruídos assentados no relevo (uma matriz deixaria postes flutuando).
  - Cada edição guarda a posição original (`ox`, `oz`); se o `layout.js` mudar e o objeto não estiver mais lá, a edição é ignorada com aviso.
  - A chave do cache dos campos só depende das casas, então mover barraca ou adereço não regera o relevo.
  - Pendências: barracas e adereços adicionados em campo aberto não abrem clareira na vegetação (a `clearance` só olha BUILDINGS); um objeto original removido só volta editando o JSON.
- QA: `node tools/objectedit.mjs [prefixo] [--save]`: seleciona (caixa, gizmo, menu), move pelo eixo X arrastando o gizmo, testa a tecla 2, remove e desfaz, adiciona do catálogo. Com `--save`, confere no modo normal após recarregar e apaga o arquivo de teste.

## Pincel de natureza (`?edit`, aba "Natureza")
- `src/editor/natureEditor.js` (ideia do "Nature brush" do Habitat Creator): pinta ou apaga carvalho, pinheiro, bétula, tojo, fento, pedras e grama; "Tudo (apagar)" limpa todos. Tamanho e densidade; Shift alterna pintar/apagar; `[` `]`, T (vista de cima), Ctrl+Z/Y. A pintura aparece como uma camada colorida sobre o terreno (o `colorNode` do material do terreno ganha a mistura na primeira vez que a aba abre, só no editor). Plantas e pedras só mudam ao "Salvar e aplicar" (recarrega).
- **Grade** (`src/world/natureEdits.js`): 700² texels de 4 m sobre o `TERRAIN`, 8 canais em bytes com sinal (0 carvalho, 1 pinheiro, 2 bétula, 3 tojo, 4 fento, 5 pedras, 6 grama, 7 tamanho das pedras). v > 0 acrescenta (densidade), v < 0 apaga (o procedural fica com probabilidade 1 + v). Fica em `public/nature-edits.bin` (`/__nature-edits` no servidor de desenvolvimento).
- **Determinismo:** o apagar decide por um hash da posição (`hash01`) e só depois que a planta ou pedra já gastou seus sorteios, então o resto da distribuição fica idêntico. O pintado usa uma sequência própria por texel e por tipo (`texelSeed`), então pintar em outro lugar ou editar o relevo não embaralha o que já foi pintado. Sem pintura, o mundo sai igual ao de antes. "Tudo (apagar)" apaga 100%, qualquer que seja a densidade. Se a gravação no servidor falhar, cada arquivo editado é baixado.
- Pedras: o canal de tamanho é gravado pelo raio do pincel (4–60 m → 0–1); um pincel largo mistura blocos maiores (até ~6 m). Grama: apagar afina todos os tipos, pintar acrescenta campo.
- Abas: `src/editor/tabs.js` (`app.setEditorTab`) mostra um editor por vez e decide quem fica com o botão esquerdo. O "Salvar e aplicar" de qualquer aba grava relevo, objetos e natureza (só o que mudou).
- QA: `node tools/natureedit.mjs [prefixo] [--save]` acha um bosque e um campo aberto perto da vila, apaga tudo no bosque, pinta pinheiros e pedras (pincel de 50 m) no campo, testa desfazer/refazer e, com `--save`, conta as instâncias depois de recarregar (miolo do pincel sem árvores, pinheiros e pedras grandes no campo).

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
  - Impostores octaédricos (`src/world/impostors.js`, porte do `Impostors.js`): o carvalho e o pinheiro de perto são renderizados de 6×6 direções em dois atlas na primeira carga (depois vêm do cache). Cada árvore distante vira um quad virado para a câmera, que reprojeta o raio no quadro mais próximo. Terceiro nível do `ChunkedInstances` (`impostor`, `impostorDistance` = 320 m para o carvalho); a troca é por tile, sem fade.
  - Sub-bosque (`trees.js`): `shrubBush` (tojo/giesta: lóbulos de cartões com o bloco de folhas estreitas do atlas, material de aglomerados) e `bracken` (fento: frondes do Tidewater com haste nua e lâmina triangular; os folíolos são recortados pela `uv` em `createFoliageMaterial( sunDir, { fern: true } )`). O fento predomina nas manchas de mata e nas partes baixas; o tojo, nas encostas altas.
  - Material de folhagem: `MeshPhysicalNodeMaterial` com `specularIntensity` 0,2 (com o especular padrão, o Fresnel em ângulo rasante deixava grama e frondes brancas/cinza). Cartões e frondes usam `normalViewGeometry` sem a inversão do `DoubleSide` (a face de baixo ficava preta); troncos e cones mantêm a inversão.
  - QA: `node tools/trees.mjs [prefixo] [espécie] [--imp] [--solo]` enquadra a planta mais próxima da vila (a pé, de longe e do alto), com a câmera do lado do sol; `--imp` força os impostores a qualquer distância e `--solo` esconde pedras e outras plantas.

- **Grama** (`src/world/grass.js`, porte do `GrassField.js` do Tidewater, MIT):
  - Células de 8 m em volta da câmera (até 88 m), cada uma com um remendo fixo de 384 touceiras × 7 lâminas; três níveis (perto < 18 m, meio < 46 m, longe) com as mesmas lâminas, que afinam e somem por camada enquanto as restantes alargam. Vento em rajadas vindas do sudoeste, com brilho das lâminas dobradas.
  - Máscara de densidade RGBA gerada na carga (4 m por texel sobre o terreno): G campo (sem rocha, trilha, terra, roça nem casas; `clearance` perto da vila), R duna (margens baixas e suaves), B estorno (*Ammophila*, no lugar da aveia-da-praia) e A correola-marinha (*Calystegia soldanella*, flor rosa).
  - A cor vem do `meadowTone` exportado por `terrain.js`, o mesmo do chão, e a altura do `heightTex` do terreno. Layer 1 (fora do reflexo), sem sombra própria.
  - Substituiu os antigos tufos de cartão (`grassTuftGeometry`). QA: `node tools/grass.mjs [prefixo]` acha um trecho de campo e um de duna e captura na altura dos olhos e de 12 m.

- **Carpas e lótus** (`src/world/koi/`, porte do AndyLe Pool — https://github.com/AndyLeAI/Andy_KOI_Pool, commit dc3b205, Apache 2.0; manter os cabeçalhos e o `LICENSE-AndyLePool`):
  - Só existem em **lago criado no editor de relevo**: o da ferramenta Encher (nível próprio, ver o editor de relevo) ou um cavado abaixo do nível do mar. Para estes, na carga, `lakes.js` procura a água fechada por terra seca (separada do mar pelo flood-fill a partir da borda da grade) que tenha células que eram terra no relevo procedural (`hf.data − terrainEdits ≥ nível da água`). As poças naturais da costa ficam de fora. Sem lago, nada é construído e nenhum shader é compilado. Cada lago guarda um campo de distância à margem (chanfro).
  - `koi.js`: a classe `Koi` do original (corpo em tubo sobre uma espinha de 12 nós refeito na CPU a cada quadro, nadadeiras, 9 variedades: kohaku, sanke, showa, tancho, ogon, kigoi, chagoi, asagi, butterfly). Mudanças: tamanho real (0,55–0,95 m), desvio da margem pela distância do lago, fuga da câmera; sem ração e sem saltos (dependem das ondulações do original).
  - `lotus.js`: folhas com recorte e nervuras (textura de canvas) e flores de três anéis de pétalas, em água de 0,3–3 m longe da margem, fundidas em duas malhas.
  - `ponds.js` (`app.koi`, camada "Carpas e lótus"): ~1 carpa por 25 m² (3–14) e ~1 folha por 14 m²; tudo semeado pela posição do lago. As carpas só nadam com a câmera a menos de 160 m. `app.koi.paused = true` congela.
  - QA: `node tools/koi.mjs [prefixo] [--x= --z= --r=] [--sea]` afunda uma depressão de teste (`public/terrain-edits.bin`), põe o lago com Encher (`public/world-edits.json`), recarrega, captura de cima, da margem, de perto e de baixo d'água, testa a ferramenta no editor (remover, encher de novo, encosta recusada) e apaga os dois arquivos (não roda se algum já existir). `--sea`: cava até abaixo do nível do mar, como antes.
  - Pendência: num lago cavado abaixo do nível do mar, os cardumes marinhos (`fish/`) e o fundo do mar (`seabed/`) também entram, porque escolhem pela profundidade (no lago da Encher não).

- **Gaivotas** (`src/world/birds/`, porte do Tidewater, MIT):
  - `shapes.js` é cópia do `BirdShapes.js` (modelo de ave com corpo, pescoço, bico, cauda em leque e asas de três ossos).
  - `gulls.js`: gaivotas-patiamarelas (26) circulando sobre a baía, acima do relevo sob cada círculo. Alternam planeio (asa em "M") e batidas; inclinam nas curvas. Tudo no vertex shader, com relógio próprio (`app.gulls.time`); `app.gulls.paused = true` congela o voo.
  - Cores do padrão em sRGB (`srgb()`); os `smoothstep` invertidos do Tidewater foram trocados pela forma com `.oneMinus()`.
  - QA: `node tools/gulls.mjs [prefixo] [índice]` faz close-ups de lado, de baixo e de cima e uma vista geral.
  - Aves que pousam e mergulham (`flock.js`, `batch.js`, `flight.js`, `pose.js`, `kit.js`; porte do `Birds.js`/`BirdBatch.js`/`Flight.js`/`BirdPose.js`/`Kit.js`): 16 gaivotas-patiamarelas e 5 charrões (*Thalasseus sandvicensis*), numa só chamada de desenho com pose escrita pela CPU num storage buffer (só WebGPU).
  - Gaivotas pousam em poleiros achados por raycast (ápice dos telhados redondos, cumeeira das casas longas, parapeito do muro do castro, pedras da costa), decolam quando a câmera chega perto (`FLUSH`), voam, circulam em térmicas e voltam a pousar. Charrões patrulham rotas sobre o lago, pairam contra o vento e mergulham.
  - `app.flock.paused = true` congela as poses (QA). `node tools/birds.mjs [prefixo]` lista poleiros e estados, faz close-ups (telhado, pedra, charrão) e testa a decolagem com a câmera perto.
  - As gaivotas altas que só planam (`gulls.js`) continuam, reduzidas a 14.

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
- **Espalhamento na névoa** (`main.js`, do exemplo `webgpu_custom_fog_scattering`): uma versão desfocada da cena em meia resolução é misturada pela quantidade de névoa de cada pixel (a mesma `hazeAmount` do `fogNode`, com distância e altura reconstruídas da profundidade); o céu fica nítido. Suaviza as cordilheiras distantes. `app.scatter` (força); `?scatter=0` desliga.
- **Céu e sol** (`sky.js`, `main.js`): o céu de Preetham (`SkyMesh`) era bem mais claro que a cena na nossa exposição, e o céu em volta do sol ficava branco. Agora o céu visível passa por um ganho (`app.sky.gain`, 0,4); o céu da iluminação (IBL) não muda. A entrada do bloom é limitada a 6, porque o disco do sol, milhares de vezes mais claro que o branco, virava um clarão sobre metade do quadro. A exposição global (0,8) não mudou.
- **Sombra de nuvens** (`src/world/cloudShadow.js`, porte do `rendering/cloudShadow.js` do Drusniel, MIT): ruído de valor em duas oitavas no plano XZ (células de ~85 m), multiplicado na cor do terreno, da grama, das plantas e copas distantes (impostores), das pedras de granito e das casas (`createBuildingMaterials`, exceto porta e brasas). Sem passe extra. A cobertura é o próprio `cloudCoverage` do céu (o controle "Nuvens" mexe nas duas; `bindSky` antes dos materiais), a deriva acompanha as nuvens do céu no relógio TSL e a força cai com o sol baixo (`updateCloudSun`). O limiar foi reescalado para a faixa real do ruído (0,29–0,71 entre p10 e p90); o original quase não sombreava com a nossa cobertura de 0,55. `app.cloudShadow` (`strength` 0,4, `scale`, `speed`); `?cloudshadow=0` desliga.
  - Testado e descartado: o `skipEmptyDraws` do Drusniel. Aqui só há 2–3 malhas instanciadas vazias entre ~700 por vista (lá, ~20), e pular draws vazios deixaria de compilá-los no pré-compile.
- **God rays** (`src/post/godrays.js`): dispersão de luz em espaço de tela (GPU Gems 3, cap. 13). A fonte é o céu visível perto do sol, que montanhas, nuvens, copas e casas recortam, em 1/3 da resolução. Desfoque radial na direção do sol (48 amostras com dither), suavizado e somado à cena HDR antes do bloom. Some quando o sol sai da tela, quando ele se põe e embaixo d'água. Controles em `app.godrays` (`strength` 3,5, `decay`, `length`, `falloff`, `tint`); `?godrays=0` desliga. O `GodraysNode` da r186 é outro efeito (raymarching pelo mapa de sombra, só dentro da caixa de sombra) e não foi usado.
- `node tools/variants.mjs <prefixo> --cam=x,y,z,tx,ty,tz "nome::js" ...`: um carregamento, vários ajustes cumulativos (`a` = `window.__app`), com uma captura e brilho/estouro/saturação depois de cada um. Útil para afinar parâmetros sem recarregar.
- **Brétema** (`src/post/mist.js`, do exemplo `webgpu_postprocessing_fog`): camada de névoa entre a água e 14 m, marchada em 12 passos a 35% da resolução pela profundidade da cena, ruído 3D animado com o vento, desfoque gaussiano na própria baixa resolução. Some embaixo d'água. `app.mist` (`strength`, `top`, `density`, `threshold`); `?mist=0` desliga.
- Testados e descartados: água com absorção pelo fundo (aula "stylized nature": ganho só visto de cima, +2 ms, e a profundidade multiamostrada não pode ser lida pelo `viewportLinearDepth`); lens flare (`LensflareNode`: contra o sol a cena já está lavada, ganho quase nulo, ~2,5 ms).
- `node tools/abtest.mjs <prefixo> "<paramsA>" "<paramsB>" [vistas] [--cam=...]`: mesmas vistas com os parâmetros de URL A e B, tempo de frame de cada um e imagem comparativa (`shots/<prefixo>_cmp_*.png`). A medição varia ±4 ms entre execuções: repita antes de concluir.
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
- [x] Copas dos carvalhos "bolhosas": trocadas pela árvore do Tidewater (ramos visíveis, aglomerados com vazios, atlas de folhas na GPU). A bétula ainda é a antiga.
- [x] Pinheiros pretos: não era o modelo, e sim a tonalidade de toda a vegetação convertida duas vezes para linear (`Color.set( hex )` já converte; havia um `.convertSRGBToLinear()` a mais em `vegetation.js`). Paletas de arbusto e fento reajustadas.
- [x] Pinheiro novo (`trees.js` `pineTree`): tronco e galhos do `TreeGenerator` da r186; tufos de agulhas em cartões ao longo dos raminhos (bloco 1 do atlas de folhas, material `canopy` do carvalho); impostor como o do carvalho. Os centros dos anéis dos tubos são recuperados da malha do gerador (`tubeRings`). A cobertura das agulhas sobe com o nível de mip (`createFoliageMaterial`, só no quadrante do bloco 1); sem isso, as copas distantes sumiam.
- Tentativa descartada: árvores do pacote "Low Poly Trees Free" (Sketchfab, CC BY 4.0). Ficaram boas visualmente, mas somavam ~150 chamadas de desenho e faziam o pré-compile passar do limite de 12 s mesmo com cache (carga de ~8 s para ~20 s). Se voltar a elas: juntar as 3 variantes numa espécie só e investigar os pipelines novos.
- [ ] Nuvens: poucos cúmulos volumétricos distantes (exemplo `webgpu_volume_cloud`: raymarch numa textura 3D; faltaria iluminação pelo sol). A brétema baixa já existe (`src/post/mist.js`).
- [x] Silhueta das casas (medida com `tools/houses.mjs`): os telhados desciam até ~0,6 m do chão e escondiam a parede. Agora o telhado é calculado a partir da parede visível (`ROUND` em `buildings.js`: 1,8 m), do beiral (0,6 m) e da inclinação (40–44° na redonda, ~48° na longa e na cabana); a borda do beiral é irregular e o colmo, mais escuro. Medido: parede visível 1,8 m (redonda e longa) e 1,2 m (cabana), contra 0,6 m antes; telhado/altura ~0,73, um pouco acima da faixa de referência (0,45–0,7).
- [x] Textura do colmo: as fibras saíam em espiral (a UV do cone usava o arco de cada anel; agora é o ângulo vezes o raio do beiral, `builder.js` `coneRoof`) e o relevo das fibras finas virava listras pretas; agora as fibras ficam só na cor e o relevo marca as camadas, mais fracas e quebradas por ruído.
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
- [x] Pipelines que cresciam com os frames: era o `mineBlock` com dois materiais no passe de sombra (ver Técnico).
- [ ] DOF: rodar em meia resolução ou desligar sozinho quando `amount` ≈ 0 (hoje sempre roda com o foco ligado).
- [x] Reflexo da água com orçamento (`src/world/planarReprojection.js`, porte do `PlanarReprojection.js`/`ReflectionBudget.js` do Drusniel, MIT): a captura planar é refeita a cada 100 ms ou quando a câmera anda 2 m, com o frustum 35% × 15% mais largo; entre capturas a água projeta o raio refletido pela câmera da captura (girar não faz o reflexo escorregar; após um giro de 12°, a diferença para uma captura nova foi de 1,9/255). Fora da captura, a água mostra a própria cor. Medido: 14 capturas em 75 quadros parado, 28/180 andando 0,1 m/quadro, 45/180 a 0,5 m/quadro. `?reflectms=0` captura todo quadro; `app.water.reflection` (`interval`, `invalidate()`, contadores); o `app.capture` invalida antes de capturar. O `resolutionScale` (0,45) não mudou.
- [ ] Sombras: mapa 4096 → 2048 ou `CSMShadowNode` com 2 cascatas; menos casters.
- [x] Casas, forte e mina: superfícies pré-geradas em texturas (ver Técnico). Falta o terreno.
- [ ] Resolução dinâmica: reduz a `pixelRatio` e realoca os render targets; trocar por escala do pass.
- [ ] Medir na janela real (painel do app visível ou Edge em primeiro plano) para confirmar o FPS.

### Técnico
- [ ] Fallback WebGL (`?webgl`) não confirmado; o teste headless estourou o tempo.
- [x] Pedras: ruídos por pixel trocados por textura pré-gerada (`granite/`) e `materialLo` nos tiles distantes (custo de GPU na vista 0: ~0,24 → ~0,02 ms no headless).
- [ ] Vegetação detalhada: conjunto "hi" centrado na câmera em vez de tiles, para reduzir draw calls.
- [ ] Sombra: fazer o snapping no espaço de vista da luz (ainda cintila).
- [x] Carregamento: cache de relevo/máscara/AO/macro no IndexedDB, um build TSL por material nos tiles e pré-compilação nos contextos reais.
      Com cache, ~8 s até o primeiro frame (antes ~16 s mais ~6 s de travada no primeiro frame). O primeiro frame caiu de ~6 s para ~0,1 s.
- [ ] Primeira visita (sem cache de shaders do navegador): `node tools/shadercost.mjs` mede a compilação a frio de cada pipeline, um de cada vez (rótulo = objeto / material, resultado em `shots/shadercost.json`). Soma: 20,6 s → 12,7 s (cópias leves) → 8,7 s (superfícies pré-geradas); pré-compile a frio ~7,7 s, primeiro frame a frio ~18 s (antes ~23 s). O que sobra de mais caro: horizonte, aves, bétula, gaivotas (~0,4–0,6 s cada).
- [x] **Superfícies pré-geradas** (`src/world/surfaceBake.js`): pedra (células de Worley em espaço de célula, 16×16, escalonadas por `len`/`rowH` de cada variante), colmo (fibras, fibras finas, camadas), madeira, reboco e um ladrilho de 32 m de manchas de mundo (musgo, desgaste, desbotamento, rocha escura). Tudo periódico (rede e células dão a volta), sem emenda; geradas na CPU num worker (`surface.worker.js`, ~3 s, começa no início da carga) e guardadas no IndexedDB (`surfaces.js`, chave pelo hash do código). Os materiais (`materials.js`, `createRockMaterial` do forte) só colorem as texturas. Gerar na CPU não cria shaders novos (o cache de shaders do navegador está no limite).
- [ ] Desligar as sombras em tempo de execução (`app.setShadows(false)`, caixa "Sombras" do painel) quebra o renderizador (`Cannot read properties of null (reading 'depthTexture')`, depois erros de validação do WebGPU). Já acontecia antes das superfícies.
- [x] Céu branco (tom do horizonte, sem nuvens) quando o pré-compile terminava numa carga fria, visto pela saída com profundidade de campo: o céu agora fica fora da compilação do reflexo (`main.js`). Antes, o limite de 12 s escondia o problema. O `tools/verify.mjs` reprova se voltar (testado com o bug reintroduzido).
- [x] **Cache de shaders do navegador:** o projeto está no limite do que o Edge guarda entre cargas. Acima dele, a segunda carga recompila tudo e o `compile` bate nos 12 s (~20 s até o primeiro frame, em vez de ~6 s). O limite não depende de uma flag nem do número de pipelines, e perto dele o resultado varia entre execuções. Ferramentas: `node tools/pipeprobe.mjs` (tempo de cada pipeline em duas cargas; a segunda sem pipelines lentos = cache funcionando; `SETTLE`/`EXTRA` no ambiente) e `node tools/pipedup.mjs` (descritores repetidos, campos que variam e pilhas das criações depois do primeiro frame).
  - Os bakes de GPU (atlas de folhas, impostores) ficam em cache no IndexedDB (`src/core/bakeCache.js`, chave `bakes:` com o hash de `leafAtlas.js`, `impostors.js`, `trees.js`, `vegetation.js` e a versão do three). Com cache, os shaders de bake nem são compilados. **Regra:** evitar shaders novos na carga com cache; prefira reaproveitar materiais (o pinheiro usa o `canopy` do carvalho; os impostores de todas as espécies compartilham um shader, com as constantes em uniforms).
  - Os pipelines cresciam sem parar (884 em 15 s, 774 de um só shader): o `mineBlock` do forte tinha dois materiais (grupos). No passe de sombra, os dois grupos usam o mesmo material de sombra, cuja chave de cache segue o material do grupo, e o three recriava o render object a cada desenho da sombra. Foi dividido em duas malhas (`fort.js` `splitGroups`); agora são ~111 pipelines. **Regra:** não usar malhas com array de materiais que projetem sombra.
- [ ] O horizonte (~1 s) e a vegetação/pedras (~1,1 s) ainda são gerados a cada carga; dá para cachear como o relevo.
- [ ] Objetos que só aparecem embaixo d'água (superfície vista de baixo, neve marinha, fundo, peixes) ainda compilam no primeiro mergulho.

## Git
- Remoto: https://github.com/alexadrerui/Castro-do-Mar (branch `main`).
- O projeto fica num pendrive (E:, sistema de arquivos sem registro de dono), por isso o git acusa
  "dubious ownership". Use `git -c safe.directory="E:/Vila_Celta_ 890" ...` em cada comando
  (ou o usuário pode registrar a exceção uma vez com `git config --global --add safe.directory`).
- Commits com `user.name=alexadrerui`, `user.email=alexadrerui@gmail.com`.
