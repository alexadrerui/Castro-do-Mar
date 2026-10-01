# Alpha mattes of the references for the skill's Tier 1 diagnostics (diagnose_render.py reads the
# alpha when a PNG has one). The skill's own mask keys on the corner colour, so the radial vignette
# of these backdrops became "object" and the grey stone became "background". Here the backdrop is
# flood-filled from the border: it is a smooth gradient, so neighbouring pixels differ by a couple
# of levels, while the object's texture and edges stop the fill.
# python ref/casa_castro/make_mattes.py  ->  ref/casa_castro/matte/ref_<k>.png
from collections import deque
from pathlib import Path
from PIL import Image

HERE = Path(__file__).parent
STEP = 5        # max per-channel difference between neighbouring backdrop pixels
SAT = 0.12      # the backdrop is grey: (max - min) / max stays below this

(HERE / 'matte').mkdir(exist_ok=True)
for k in range(1, 6):
    im = Image.open(HERE / f'ref_{k}.png').convert('RGB')
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)

    def grey(c):
        m = max(c)
        return m == 0 or (m - min(c)) / m < SAT

    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            q.append((x, y))
    for x, y in q:
        bg[y * w + x] = 1
    while q:
        x, y = q.popleft()
        c = px[x, y]
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx]:
                n = px[nx, ny]
                if max(abs(n[0] - c[0]), abs(n[1] - c[1]), abs(n[2] - c[2])) <= STEP and grey(n):
                    bg[ny * w + nx] = 1
                    q.append((nx, ny))
    out = im.convert('RGBA')
    out.putalpha(Image.frombytes('L', (w, h), bytes(0 if b else 255 for b in bg)))
    out.save(HERE / 'matte' / f'ref_{k}.png')
    print(k, 'object fraction', round(1 - sum(bg) / (w * h), 3))
