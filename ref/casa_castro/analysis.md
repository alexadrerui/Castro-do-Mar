# Casa do castro — análise das referências (protocolo image_analysis, camadas 1–6)

Referências: `ref_1.png` (frente 3/4: pórtico e porta), `ref_2.png` (traseira/lateral 3/4 com o alpendre),
`ref_3.png` (lado da torre redonda), `ref_4.png` (fundos), `ref_5.png` (planta, de cima). Fundo cinza liso,
modelo de jogo (texturas fotográficas). Escala inferida: porta ~1,9 m de altura.

## 1. Identificação
- Tipo: **casa composta de castro galego** (vivenda + torre/casa redonda adossada) e um **anexo redondo
  aberto** (cozinha/forno com fogo, coberto de colmo sobre postes). Classe: edifício / mobiliário de cena.
- `primaryDomain`: object. Confiança na identificação: 0,85.

## 2. Forma e silhueta
- Corpo principal: **prisma retangular** (~8 × 5,5 m em planta inferida, paredes ~2,4 m), cobertura de colmo
  de **duas águas com quadril** do lado oposto à torre (planta, ref_5: retângulo + meio-círculo).
- Torre: **cilindro** de pedra (~5 m de diâmetro, ~3 m de parede) com **coroamento ameado irregular**
  (pedras salientes no topo, ref_3/ref_4), adossado à empena do corpo; coberta por **cone escalonado**
  (3–4 degraus de colmo, ref_3) que se funde com a cobertura do corpo.
- Assimétrica (composição em L/planta "bota" vista de cima). Linguagem geométrica com bordas orgânicas
  (colmo irregular, alvenaria rústica).
- Anexo: cilindro baixo (mureta ~0,9 m, diâmetro ~3,5 m) aberto em ~1/3 do perímetro, 6–7 postes,
  **cone** de colmo com beiral largo.

## 3. Decomposição macro → meso → micro
- **Macro:** corpo retangular · torre redonda · cobertura do corpo · cobertura cônica da torre ·
  pórtico de madeira · anexo redondo (mureta + postes + cone).
- **Meso:** porta com **ombreiras e verga de pedra** e **frontão triangular de madeira entalhada** com
  roseta (ref_1) sob uma **lucarna/aba de colmo** que projeta sobre a porta; pórtico: 4 postes com mãos-
  francesas, viga com **cabeças de caibro redondas** (6–7 tocos), telhado de tábuas em uma água;
  janela pequena quadrada na torre (ref_3); soleira de pedra; portão largo na lateral (ref_2, vão grande
  de pedra); cumeeira de colmo (rolo) na cobertura.
- **Micro:** cada pedra da alvenaria (fiadas irregulares, pedras chatas), camadas do colmo (5–7 fiadas
  visíveis, bordas desfiadas), entalhe da roseta, adereços: carroça de duas rodas raiadas, 2 barris,
  cesto/ânfora vermelha, jarros e frutas no chão; no anexo: fogo/brasas, potes.

## 4. Relações espaciais
- <torre, adossada-a, empena do corpo> (contato por encosto; torre mais alta que a parede do corpo).
- <cobertura do corpo, cobre, corpo> com beiral ~0,6–0,8 m; <cone da torre, encosta-em, cobertura do corpo>
  (fusão das águas, ref_4/5).
- <pórtico, encostado-a, fachada frontal> (postes no chão, telhado de tábuas abaixo do beiral de colmo).
- <frontão entalhado, acima-de, porta>; <aba de colmo, acima-de, frontão>.
- <carroça/barris, sob, pórtico>.
- <anexo, separado-de, casa> (~2 m de distância; não toca).

## 5. Materiais (PBR, inferido)
- Alvenaria de granito: dielétrico, rugosidade ~0,9, albedo cinza médio-frio com variação por pedra,
  juntas escuras sem argamassa (pedra seca). Relevo forte por pedra.
- Colmo: palha velha, rugosidade ~0,95, albedo marrom-oliva escuro, fibras no sentido da descida,
  fiadas com borda clara/desfiada e sombra entre fiadas.
- Madeira (pórtico, frontão, postes): marrom-avermelhado médio, rugosidade ~0,8, tábuas com veio.
- Entalhe: mesma madeira, relevo da roseta.
- Pedra da soleira/mureta: mesma alvenaria, topo mais claro.
- (Observação: iluminação de estúdio cinza nas referências; cores lidas com cautela.)

## 6. Cor e acabamento
- Pedra: cinza médio (valor ~45–60%), saturação baixa, levemente azulada/fria.
- Colmo: marrom-oliva escuro (valor ~30–40%), bordas das fiadas mais claras (~50%).
- Madeira: marrom-avermelhado (valor ~30%), fosco.
- Acabamento geral fosco.

## O que a vista única esconde / confiança
- Interior não visível (porta escura): será um vazio escuro. Planta exata da torre vs corpo inferida
  de ref_5 (confiança 0,7). Frontão entalhado: motivo aproximado (roseta de 6 pétalas, 0,5).
- Fidelidade será **estilizada procedural** (sem projetar as fotos): o projeto inteiro é procedural e
  os materiais vêm das texturas pré-geradas (`surfaceBake.js`). Dito explicitamente.
