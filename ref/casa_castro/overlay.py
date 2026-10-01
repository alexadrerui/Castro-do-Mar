# Silhouette overlay of the reference mattes (make_mattes.py) and a render set (tools/castroreview.mjs
# --plain): white = both, red = only the reference, green = only the render.
# python ref/casa_castro/overlay.py <render prefix>  ->  shots/<prefix>_overlay.png
import sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).parent
SHOTS = HERE.parent.parent / 'shots'
prefix = sys.argv[1] if len(sys.argv) > 1 else 'castro_d0c'
W, H = 420, 260
sheet = Image.new('RGB', (W * 5, H))
for k in range(1, 6):
    ref = Image.open(HERE / 'matte' / f'ref_{k}.png').getchannel('A').resize((W, H))
    ren = Image.open(SHOTS / f'{prefix}_ref{k}.png').convert('RGB').resize((W, H))
    bg = ren.getpixel((0, 0))
    a, r = ref.load(), ren.load()
    out = Image.new('RGB', (W, H))
    o = out.load()
    inter = union = 0
    for y in range(H):
        for x in range(W):
            fa = a[x, y] > 127
            c = r[x, y]
            fr = max(abs(c[i] - bg[i]) for i in range(3)) > 6
            o[x, y] = (255, 255, 255) if fa and fr else (220, 40, 40) if fa else (40, 200, 60) if fr else (0, 0, 0)
            inter += fa and fr
            union += fa or fr
    sheet.paste(out, ((k - 1) * W, 0))
    print(f'ref{k} IoU {inter / max(1, union):.3f}')
sheet.save(SHOTS / f'{prefix}_overlay.png')
