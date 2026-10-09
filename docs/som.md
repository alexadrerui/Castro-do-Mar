# Som ambiente

Movido do CLAUDE.md em 08/10/2026 (texto sem alterações). O CLAUDE.md guarda só o essencial e aponta para cá.

## Som ambiente (`src/audio/ambience.js`)
- Tudo sintetizado com WebAudio, sem arquivos (decisão do usuário, 04/10/2026). `app.ambience`; o trovão (`lightning.js`, `output`) sai pelo mesmo barramento, então o volume e o mudo das Opções valem para tudo.
- O `AudioContext` só nasce no primeiro clique ou tecla (regra de autoplay; o "Entrar no castro" serve). No headless sem gesto nada roda, e o `verify` não muda. No mudo ou com a janela em segundo plano, o contexto é suspenso.
- Camadas, com o ganho recalculado ~12×/s pelo lugar:
  - mar: distância à linha da costa numa grade de 10 m feita na carga a partir do relevo (transformada de distância com a semente mais próxima), mais a altitude; o som vem do lado da praia; arrebentação em duas vozes alternadas (sobe 1–2 s, chia e some em 2,5–4,5 s);
  - vento: rajadas (passeio aleatório), mais forte exposto (alto sobre o chão ou sobre o mar), na tempestade e mais calmo à noite; assobio nos cumes; folhas no bosque;
  - chuva (`weather.level`): a gravação `public/audio/light-rain.mp3` (gerada pelo usuário com o ChatGPT, dele, MIT; laço sem emenda de 45 s a 128 kbps, 0,7 MB, recortado do original de 104 s com o fim cruzado no começo pelo ffmpeg), baixada só na primeira vez que chove; até chegar, ou se falhar, fica o chiado sintetizado. Chuva plena: −31 dB; rios e cachoeiras (amostras do `riverCourse`, com direção); fogueiras pelas fontes de fumaça das casas (`app.hearths`);
  - vozes agendadas: gaivotas na costa de dia, pássaros no bosque de dia (tordo, melro, tentilhão, chapim; coro ao amanhecer, ~7h) pela densidade de árvores numa grade de 64 m, coruja-do-mato à noite no bosque; grilos à noite em campo aberto (laço sintetizado);
  - embaixo d'água: tudo o que está acima passa por um passa-baixa de 320 Hz, mais um ronco grave e bolhas;
  - alturas (09/10/2026, ideia do Ascent, cuja trilha se abre e fica rarefeita com a altitude): um bordão em quintas abertas (lá 110, mi 165, lá 220, mi 330 Hz; senos um pouco desafinados, cada um com uma ondulação lenta de 0,03–0,08 Hz, passa-baixa de 1,1 kHz) que surge de 120 a 450 m acima do mar, baixo, por baixo do vento; menos na chuva, nada embaixo d'água. No cume do `ambience.mjs` (~25 m sobre o ponto mais alto do mapa) fica em 0,23 e o lá 110 Hz sai 13 dB acima do ruído vizinho; na vila não aparece.
- `app.ambience.levels` mostra o nível de cada camada.
- QA: `node tools/ambience.mjs [prefixo] [--seconds=8] [lugares...]` (costa, vila, bosque, cume, embaixo d'água, bosque à noite, chuva; `falls` com um rio do editor) dá o nível de cada camada e grava o que se ouve em `shots/<prefixo>_<lugar>.wav`. Medido (RMS): costa −23 dB, chuva −29 dB (era −23: alta demais, pelo usuário; agora ruído rosa mais suave), embaixo d'água −25 dB, cume −34 dB, vila −34 dB, bosque −36 dB, noite −40 dB; os espectros conferem (a costa nos graves, embaixo d'água sem nada acima de 1 kHz, os grilos em 4–8 kHz).
