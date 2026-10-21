# Where: any machine with Python 3 and Pillow
#        (`uv run --with pillow python scripts/perch.py ...`).
# When: a bird cutout has no perch of its own.
# Why: the bird sprites stand on a perch. This script puts a real branch
#      (cut from a photo with scripts/skykey.py --dark) under the bird's
#      feet. Both images stay photos. Only their size and place change.
#
# Usage: perch.py bird.png branch.png out.png [overlap]
#   overlap : px of branch that the feet cover, measured at the top edge
#             of the branch under the bird's centre (default 6)
import sys
from PIL import Image

bird = Image.open(sys.argv[1]).convert("RGBA")
branch = Image.open(sys.argv[2]).convert("RGBA")
overlap = int(sys.argv[4]) if len(sys.argv) > 4 else 6

# The branch is a little wider than the bird.
width = round(bird.width * 1.25)
branch = branch.resize((width, round(branch.height * width / branch.width)), Image.LANCZOS)

# The branch slopes, so find its top edge under the bird's centre.
alpha = branch.getchannel("A").load()
top = next(y for y in range(branch.height) if alpha[width // 2, y] > 128)
branch_y = bird.height - overlap - top

height = max(bird.height, branch_y + branch.height)
out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
out.alpha_composite(branch, (0, branch_y))
out.alpha_composite(bird, ((width - bird.width) // 2, 0))
out = out.crop(out.getbbox())
out.save(sys.argv[3])
print(sys.argv[3], out.size)
