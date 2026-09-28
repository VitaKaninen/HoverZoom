"""Generate the large fixtures used by test-pages/perf-dupes.html (gitignored: ~80 MB).

20 phone-sized photos (4032x3024, noisy so the JPEGs are realistically heavy) with thumbnails,
plus 4 byte-identical re-uploads under other names.

    python make-perf-images.py
"""

import os
import random
import shutil
import sys
from PIL import Image, ImageChops, ImageDraw

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-images", "perf")
W, H = 4032, 3024
COUNT = 20
REUPLOADS = [3, 7, 12, 18]


def photo(i):
    rnd = random.Random(i)
    base = Image.new("RGB", (W, H), tuple(rnd.randrange(40, 200) for _ in range(3)))
    d = ImageDraw.Draw(base)
    for _ in range(40):
        x, y = rnd.randrange(W), rnd.randrange(H)
        r = rnd.randrange(100, 900)
        d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(rnd.randrange(256) for _ in range(3)))
    d.text((80, 80), "perf %02d" % i, fill=(255, 255, 255))
    noise = Image.merge("RGB", [Image.effect_noise((W, H), 40 + c * 5) for c in range(3)])
    return ImageChops.add(base, noise, scale=1.6, offset=-60)


def main():
    os.makedirs(ROOT, exist_ok=True)
    for i in range(1, COUNT + 1):
        img = photo(i)
        img.save(os.path.join(ROOT, "p%02d.jpg" % i), quality=90)
        img.resize((300, 225)).save(os.path.join(ROOT, "p%02d_t.jpg" % i), quality=85)
        print("p%02d" % i)
    for i in REUPLOADS:
        for suffix in ("", "_t"):
            shutil.copyfile(os.path.join(ROOT, "p%02d%s.jpg" % (i, suffix)),
                            os.path.join(ROOT, "re%02d%s.jpg" % (i, suffix)))
    print("done")


if __name__ == "__main__":
    main()
