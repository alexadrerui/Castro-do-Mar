# Câmera e foco

Movido do CLAUDE.md em 08/10/2026 (texto sem alterações). O CLAUDE.md guarda só o essencial e aponta para cá.

- `src/controls/freecam.js`: voo livre (WASD/QE, Shift, arrastar, roda do mouse, 1–6 vistas).
- `src/controls/focus.js`: foco automático com profundidade de campo (`DepthOfFieldNode` de TSL sobre o pass da cena).
  - O raycast parte do centro da tela, cerca de 12×/s.
  - Os alvos são as malhas de casas e forte (com BVH do `three-mesh-bvh`), as instâncias visíveis a menos de 80 m (exceto grama e cascalho) e o heightfield.
  - O efeito entra abaixo de 45 m e fica pleno abaixo de 22 m, com transição suave.
  - A tecla **B** (ou a opção no painel) liga e desliga, trocando o `outputNode` do `RenderPipeline`.
  - A HUD mostra uma retícula central com a distância focada.

- **Foco pelo clique** (`focus.js` `focusAt`/`release`, `main.js`): um clique sem arrastar (< 5 px e < 350 ms) trava o foco no ponto clicado e a retícula da HUD acompanha esse ponto. Clicar no céu (nada a menos de 140 m), trocar de vista ou o ponto sair da tela devolvem o foco ao centro.
