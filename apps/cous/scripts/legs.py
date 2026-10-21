# Where: any machine with Python 3 and Pillow
#        (`uv run --with pillow python scripts/legs.py ...`).
# When: you make a run frame from a cutout of Cous standing.
# Why: the two video frames show almost no leg movement. This script
#      swings each leg pair: it cuts the pair below the joint, rotates it
#      about the joint, and puts it back under the body. Only the
#      photo's own pixels move. Nothing is generated.
#
# Usage: legs.py in.png out.png  x0,x1,cut,pivotx,angle  [...]
#   x0, x1  : the columns of the region that holds one leg pair
#   cut     : the row of the cut. Put it below the belly.
#   pivotx  : the column of the joint
#   angle   : degrees counter-clockwise on screen. A positive angle moves
#             the foot right (forward).
#
# The run frames used these values (in px of the lifted video frames):
#   cous-run-1: 0,175,320,76,-20   175,<width>,306,262,20
#   cous-run-2: 0,185,300,88,20    185,<width>,302,270,-20
import sys
from PIL import Image, ImageChops
OVERLAP = 14  # px above the cut that rotate with the leg, hidden by the body
KEEP = 10     # px below the cut where the body keeps the original leg top
src = Image.open(sys.argv[1]).convert("RGBA")
body = src.copy()
legs = Image.new("RGBA", src.size, (0, 0, 0, 0))
src_alpha = src.getchannel("A")
for spec in sys.argv[3:]:
    x0, x1, cut, pivotx, angle = (float(v) for v in spec.split(","))
    x0, x1, cut = int(x0), int(x1), int(cut)
    region = (x0, cut - OVERLAP, x1, src.height)
    layer = Image.new("RGBA", src.size, (0, 0, 0, 0))
    layer.paste(src.crop(region), region[:2])
    # Pivot at the bottom of the kept leg top, so that the rotated leg
    # meets the original there with no step.
    layer = layer.rotate(angle, resample=Image.BICUBIC, center=(pivotx, cut + KEEP))
    # Near the joint, the leg stays inside the original outline.
    a = layer.getchannel("A")
    near = Image.new("L", src.size, 0)
    near.paste(255, (0, 0, src.width, cut + KEEP))
    clipped = ImageChops.multiply(a, src_alpha)
    a = Image.composite(clipped, a, near)
    layer.putalpha(a)
    legs.alpha_composite(layer)
    body.paste(Image.new("RGBA", (x1 - x0, src.height - cut - KEEP), (0, 0, 0, 0)), (x0, cut + KEEP))
legs.alpha_composite(body)

# Remove specks: pixel islands that the cuts left apart from the cat.
w, h = legs.size
px = legs.load()
seen = set()
islands = []
for y in range(h):
    for x in range(w):
        if px[x, y][3] and (x, y) not in seen:
            stack, island = [(x, y)], []
            seen.add((x, y))
            while stack:
                cx, cy = stack.pop()
                island.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and px[nx, ny][3]:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            islands.append(island)
islands.sort(key=len, reverse=True)
for island in islands[1:]:
    if len(island) < 0.01 * len(islands[0]):
        for xy in island:
            px[xy] = (0, 0, 0, 0)
legs.save(sys.argv[2])
