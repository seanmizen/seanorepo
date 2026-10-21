# Where: any machine with Python 3 and Pillow
#        (`uv run --with pillow python scripts/skykey.py ...`).
# When: the subject of a photo stands against blue sky, and
#       scripts/lift.swift finds no subject (for example, a tree).
# Why: a colour key makes the blue sky transparent. It uses no model.
#      The key keeps the largest connected shape, so that small separate
#      shapes (other leaves, an aerial) go too.
#
# Usage: skykey.py in.jpg out.png x0,y0,x1,y1 [clear x0,y0,x1,y1 ...]
#   x0,y0,x1,y1 : the crop, in px of the photo
#   clear       : rectangles (in px of the photo) to make transparent
#                 before the key, for objects that are not sky
import sys
from PIL import Image

KEY_START = 0  # sky score where the pixel starts to fade
KEY_FULL = 30  # sky score where the pixel is fully transparent

src = Image.open(sys.argv[1]).convert("RGBA")
x0, y0, x1, y1 = (int(v) for v in sys.argv[3].split(","))
clears = [tuple(int(v) for v in r.split(",")) for r in sys.argv[4:]]
px = src.load()
for cx0, cy0, cx1, cy1 in clears:
    for y in range(cy0, cy1):
        for x in range(cx0, cx1):
            px[x, y] = (0, 0, 0, 0)

img = src.crop((x0, y0, x1, y1))
w, h = img.size
px = img.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if not a:
            continue
        # How much bluer than red and green the pixel is.
        score = min(b - r - 40, b - g - 10)
        if score >= KEY_FULL:
            px[x, y] = (0, 0, 0, 0)
        elif score > KEY_START:
            alpha = round(255 * (KEY_FULL - score) / (KEY_FULL - KEY_START))
            # Remove the blue tint of the sky from the edge.
            px[x, y] = (r, g, min(b, max(r, g)), alpha)

# Keep the largest connected shape.
seen = set()
best = []
for y in range(h):
    for x in range(w):
        if px[x, y][3] and (x, y) not in seen:
            stack, shape = [(x, y)], []
            seen.add((x, y))
            while stack:
                cx, cy = stack.pop()
                shape.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and px[nx, ny][3]:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if len(shape) > len(best):
                best = shape
keep = Image.new("RGBA", img.size, (0, 0, 0, 0))
kpx = keep.load()
for xy in best:
    kpx[xy] = px[xy]
keep.crop(keep.getbbox()).save(sys.argv[2])
