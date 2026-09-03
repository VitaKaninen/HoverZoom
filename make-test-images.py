"""Generate the local fixtures used by test-page.html.

Deterministic, offline, and named to exercise the URL-upgrade rules:
a full-size original plus thumbnails using the WordPress -WxH suffix and a
/thumbs/ path segment, in several formats.

    python make-test-images.py
"""

import os
import sys
from PIL import Image, ImageDraw

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-images")


def make(w, h, label, seed):
    """A gradient with its own dimensions drawn on it, so a zoom is visibly bigger."""
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line(
            [(0, y), (w, y)],
            fill=(int(30 + 150 * t), int(40 + 90 * (1 - t)), int(70 + 120 * ((seed % 5) / 4))),
        )
    step = max(w // 12, 8)
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=(255, 255, 255), width=max(w // 400, 1))
    size = max(int(h / 6), 8)
    text = "%s  %dx%d" % (label, w, h)
    try:
        d.text((int(w * 0.05), int(h * 0.42)), text, fill=(255, 255, 255))
    except Exception:
        pass
    return img


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("  %-42s %dx%d" % (os.path.relpath(path, ROOT), img.width, img.height))


def main():
    os.makedirs(ROOT, exist_ok=True)
    print("writing fixtures to %s" % ROOT)

    full = make(1600, 1200, "FULL", 1)
    save(full, "photo.jpg")
    save(full, "photo.png")
    save(full, "photo.webp")

    for w, h in ((200, 150), (420, 315), (800, 600)):
        save(full.resize((w, h)), "photo-%dx%d.jpg" % (w, h))
    save(full.resize((200, 150)), "photo-200x150.png")
    save(full.resize((200, 150)), "photo-200x150.webp")

    scene = make(1600, 1200, "SCENE", 3)
    save(scene, "scene.jpg")
    save(scene.resize((200, 150)), "thumbs", "scene.jpg")

    save(make(24, 18, "i", 4), "icon.png")

    print("done")


if __name__ == "__main__":
    main()
