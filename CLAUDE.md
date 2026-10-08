# Castro do Mar — notas para o Claude

Recriação procedural (three.js r186, WebGPU + TSL) da vila celta das imagens em `ref/`.
Idioma do usuário: português. Todo o conteúdo (terreno, texturas, casas) é procedural.

## Rodar e verificar
- `npm run dev`: Vite na porta 5190 (`?auto` pula o botão de entrada, `?webgl` força WebGL 2).
- `node tools/shoot.mjs <prefixo> [vistas...]`: captura headless (Edge + WebGPU) em `shots/`.
  Use `--cam=x,y,z,tx,ty,tz` para uma câmera avulsa. Capturas de várias vistas podem passar de 7 min.
- `node tools/profile.mjs [--from=x,z] [rumos]`: perfil de alturas do relevo por rumo da bússola.
- `node tools/ring.mjs`: altura máxima e média do horizonte por setor.
- `node tools/verify.mjs [vistas] [--cold|--warm] [--update] [--params=...]`: regressão da imagem (carga fria e com cache; brilho, contraste, saturação, estourados, pretos, azul do céu contra `tools/verify.baseline.json`; sai com 1 se reprovar). **Rode antes de publicar mudanças visuais ou de carregamento.** Mudança visual intencional: confira `shots/verify_*` e regrave com `--update`. Detalhes em `docs/ferramentas.md`.
- `node tools/houses.mjs` (folha de revisão das construções) e `node tools/castroreview.mjs` (casa do castro contra as referências): ver `docs/ferramentas.md`.
- `node tools/loadtime.mjs [n] [parâmetros]`: tempo de cada etapa do loader e do primeiro frame, a frio (IndexedDB limpo) e com cache; o segundo argumento vai para a URL (ex.: `nocache`).
- O painel do navegador do app pausa o render quando está oculto; prefira o `shoot.mjs`.
- Medir e comparar:
  - `node tools/variants.mjs <prefixo> --cam=x,y,z,tx,ty,tz "nome::js" ... [--params=...]`: um carregamento, vários ajustes cumulativos (`a` = `window.__app`), captura e brilho depois de cada um.
  - `node tools/abtest.mjs <prefixo> "<paramsA>" "<paramsB>" [vistas]`: mesmas vistas com dois conjuntos de parâmetros (varia ±4 ms entre execuções: repita).
  - `node tools/gputime.mjs [vista] "nome::js" ... [--rounds=3]`: tempo de GPU por consultas resolvidas a cada quadro, variantes intercaladas (a medida confiável de custo de GPU; o `?perf`/`gpuProfile` do headless dá tempos irreais).
  - `node tools/fps.mjs [vistas] [--params=...]`: janela real (falha se a janela ficar atrás de outras: o Edge pausa o rAF).
  - `node tools/pipedup.mjs`: total de pipelines e os criados depois do `ready` (deve ser 0; compare o **total** entre rodadas). `node tools/shadercost.mjs`: compilação a frio por pipeline. `node tools/loadtime.mjs`: tempo de cada etapa da carga.
  - `node tools/flicker.mjs`: cintilação entre quadros com a câmera parada.
- Cada sistema tem a própria ferramenta de QA (`tools/<sistema>.mjs`), citada no arquivo de `docs/` dele.

## Convenções
- Eixos: +X leste (mar), +Z sul, +Y cima; 1 unidade = 1 m. O layout fica em `src/world/layout.js`.
- **Relevo:** lógica em `heightfield.js`, calculada em workers (`gen.worker.js`). O horizonte distante (`horizon.js`) reutiliza `rawHeight`.
  - Na carga fria, `genFields.js` divide relevo, máscara, ruído macro e AO em faixas de linhas num pool de 2–4 workers (núcleos − 1): primeiro relevo, máscara e ruído macro, que são independentes; depois o AO sobre o relevo completo, com as edições já somadas. Os campos saem idênticos byte a byte aos de uma passada única. De ~7 s para ~2 s; o primeiro quadro frio caiu de 20,4 para 15,9 s. O loader (`ui/loader.js`) aceita etapas simultâneas.
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


## Armadilhas e regras (aprendidas; detalhes nos `docs/`)
- **TSL:**
  - `smoothstep( a, b, x )` com a > b é indefinido no WGSL (o anel de espuma do borrifo sumia): use `smoothstep( b, a, x ).oneMinus()`.
  - `a.step( b )` não se comportou como `step( a, b )`: use `b.greaterThanEqual( a ).select( 1, 0 )`.
  - Uma função com `setLayout` vira função WGSL própria e não enxerga os uniforms ("struct member nodeUniform0 not found"): as que leem uniforms ficam sem layout.
  - Função com `setLayout` chamada de dentro de outra com `setLayout` sai num lugar diferente do código no primeiro shader montado: o mesmo material vira dois programas (dois pipelines). Deixe a interna sem layout (ver `wind.js`).
  - Trocar a textura de um `texture()` entre quadros (ping-pong) não chega aos bindings de outro passe: escreva em B lendo A e copie B em A (`copyTextureToTexture`).
  - O emissivo é montado **antes** das luzes: um valor que dependa da sombra recebida vai no `outputNode` (ver contraluz da grama em `docs/vegetacao-pedras.md`).
- **Nada aninhado dentro da passada da cena** (o `updateBefore` de um nó) com outra câmera e os mesmos materiais/luzes: o three compartilha o buffer de uniforms do grupo "render", e as cordilheiras apareciam de cabeça para baixo sobre a baía. A captura do reflexo roda antes da passada (`captureBefore`).
- **Pipelines:** um pipeline que nasce a cada quadro enche o cache de shaders do Edge (o projeto está no limite: acima dele a carga com cache recompila tudo e bate nos 12 s). Depois de mexer no reflexo, nas luzes ou nos transparentes, rode `node tools/pipedup.mjs`. As luzes ficam também nas camadas 2 e 3 (sem isso, o reflexo vazava pipelines). Evite shaders novos na carga com cache: reaproveite materiais e ponha as diferenças entre variantes em uniforms, não em literais (o three guarda os programas pelo código).
- **Sombra:** não use malhas com array de materiais que projetem sombra (recriava o render object a cada desenho: pipelines sem fim; ver `fort.js` `splitGroups`). Para desligar as sombras, zere `sun.shadow.intensity`; desligar `castShadow` descarta o mapa e quebra o renderizador ao religar.
- **MSAA:** o número de amostras do passe da cena faz parte de todo pipeline da cena; só muda na carga (`app.msaa`). Com MSAA a profundidade é `texture_depth_multisampled_2d`, que o WGSL não aceita em `textureGather` (ver a oclusão de ambiente em `docs/pos-processamento.md`).
- **Testes na página:** um `import()` do módulo feito pelo teste carrega **outra cópia** (uniforms mudados não chegam ao app): use os objetos do `app`. O `app.capture` pode devolver o quadro anterior logo depois de mudar o estado: capture duas vezes.
- O vigia de arquivos do Vite pode perder gravações feitas por script fora do editor: se a página não mudar, `touch` no arquivo.
- Medidas de desempenho no headless variam entre rodadas: repita, alterne A/B, e não conclua por uma rodada isolada.

## Mapa da documentação (`docs/`, ler quando o assunto for aquele)
- `docs/ferramentas.md`: detalhes do `verify`, `houses`, `castroreview` (e materiais da casa do castro), endpoint de captura.
- `docs/opcoes-toque-debug.md`: Opções do painel (qualidade, oclusão, anti-serrilhado, áudio, renderizador, editor), resolução dinâmica e controles de toque, painel `#debug`.
- `docs/som.md`: som ambiente sintetizado (`src/audio/ambience.js`).
- `docs/multijogador.md`: Visita junto (Trystero P2P, relays, TURN, mundo compartilhado).
- `docs/editor-relevo-agua.md`: editor de relevo (`?edit`), lagos (Encher), rios, cachoeiras.
- `docs/editor-mundo.md`: editor de objetos, caminhos, pontes, pincel de natureza.
- `docs/camera-foco.md`: câmera livre, foco automático e pelo clique.
- `docs/agua-mergulho.md`: água do mar, mergulho, cáusticas, fundo do mar, peixes, carpas e lótus.
- `docs/vegetacao-pedras.md`: carvalho, pinheiro, bétula, impostores, grama, vento único, flores, granito, panos ao vento.
- `docs/aves.md`: gaivotas, charrões, alcatrazes, borrifo, corvos-marinhos.
- `docs/ceu-clima.md`: céu e sol, sombra das nuvens, nuvens volumétricas (takram), dia e noite (relógio, estrelas, lua, luar, quadros-chave do visual), chuva, gotas, raios.
- `docs/pos-processamento.md`: bloom, oclusão de ambiente, exposição automática, espalhamento na névoa, god rays, brétema, névoa de vale, pintura a óleo, profundidade invertida, testados e descartados.
- `docs/backlog-historico.md`: pendências com o histórico do que foi feito, medido e descartado (performance, sombras, carregamento, arte, relevo).
- Ao documentar algo novo: o detalhe vai no arquivo de `docs/` do assunto; no CLAUDE.md só entra uma regra que valha em qualquer tarefa ou uma linha no mapa.

## Pendências em aberto (detalhes em `docs/backlog-historico.md`)
- Servidor para o que precisa persistir sem ninguém na sala (recados, placar, galeria).
- Inspector do three atrás de `?inspector`; laço de atualização com prioridades; revelação na entrada (anel).
- Profundidade de campo em meia resolução.
- Sombras: mapa 4096 → 2048 ou 2 cascatas; menos casters.
- Vegetação de perto num conjunto em volta da câmera em vez de tiles (menos chamadas).
- Primeira visita sem cache de shaders (pré-compilação a frio ~7,85 s, pronto a frio ~15,8 s): sobram materiais únicos (terreno, aves, água, fundo do mar, ~0,3–0,6 s cada).
- Ainda não conferido: o rastro da lua na água. Um objeto original removido no editor só volta editando o JSON.

## Publicação (GitHub Pages)
- `.github/workflows/deploy.yml`: a cada push no `main`, o GitHub Actions roda `npm ci` e `npm run build -- --base=/<repo>/` e publica o `dist` em https://alexadrerui.github.io/Castro-do-Mar/ (no repositório: Settings → Pages → Source: GitHub Actions).
- O site é estático. As edições (`public/terrain-edits.bin`, `world-edits.json`, `nature-edits.bin`) entram no site se estiverem versionadas. Os endpoints do servidor de desenvolvimento (`/__terrain-edits` etc.) só são consultados em `import.meta.env.DEV`. O build registra quais desses arquivos existem em `public/` (`__EDIT_FILES__`, plugin `editFilesDefine` do `vite.config.js`; `src/world/editFiles.js` `shipped`), e o site publicado só pede esses (antes, um 404 por arquivo ausente). No `?edit` do site publicado, "Salvar e aplicar" vai direto para o download dos arquivos editados, com o aviso de colocá-los em `public/` e publicar.
- Conferir um build localmente: `MSYS_NO_PATHCONV=1 npx vite build --base=/Castro-do-Mar/` (sem a variável, o Git Bash converte `/Castro-do-Mar/` num caminho do Windows), `npx vite preview` com a mesma base e `node tools/livecheck.mjs <url> <png>` (espera o `ready`, lista respostas 4xx/5xx e erros, salva uma captura). Também serve para o site publicado.

## Git
- Remoto: https://github.com/alexadrerui/Castro-do-Mar (branch `main`).
- O projeto fica num pendrive (E:, sistema de arquivos sem registro de dono), por isso o git acusa
  "dubious ownership". Use `git -c safe.directory="E:/Vila_Celta_ 890" ...` em cada comando
  (ou o usuário pode registrar a exceção uma vez com `git config --global --add safe.directory`).
- Commits com `user.name=alexadrerui`, `user.email=alexadrerui@gmail.com`.
