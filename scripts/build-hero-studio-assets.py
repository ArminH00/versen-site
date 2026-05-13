#!/usr/bin/env python3
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "product-clean"
OUT_DIR = ROOT / "assets" / "hero-studio"

HERO_PRODUCTS = [
    "snabbforsegling-tershine-amplify-500-ml.jpg",
    "dackglans-tershine-refined-500-ml.jpg",
    "bilschampo-tershine-purify-s-keramiskt.jpg",
    "fortvattsmedel-tershine-elevate-snow-foam-skummande-vaxsakert.jpg",
    "kallavfettning-tershine-dissolve.jpg",
    "vassle-kreatin-paronglass-900g.jpg",
]


def is_background(pixel):
    red, green, blue, _alpha = pixel
    channel_min = min(red, green, blue)
    channel_max = max(red, green, blue)
    return channel_min >= 236 and (channel_max - channel_min) <= 22


def cutout(source_path, target_path):
    img = Image.open(source_path).convert("RGBA")
    width, height = img.size
    px = img.load()
    seen = bytearray(width * height)
    queue = deque()

    def add(x, y):
        idx = y * width + x
        if seen[idx]:
            return
        seen[idx] = 1
        if is_background(px[x, y]):
            queue.append((x, y))

    for x in range(width):
        add(x, 0)
        add(x, height - 1)
    for y in range(height):
        add(0, y)
        add(width - 1, y)

    while queue:
        x, y = queue.popleft()
        px[x, y] = (255, 255, 255, 0)
        if x > 0:
            add(x - 1, y)
        if x < width - 1:
            add(x + 1, y)
        if y > 0:
            add(x, y - 1)
        if y < height - 1:
            add(x, y + 1)

    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        pad = 70
        left = max(0, bbox[0] - pad)
        top = max(0, bbox[1] - pad)
        right = min(width, bbox[2] + pad)
        bottom = min(height, bbox[3] + pad)
        img = img.crop((left, top, right, bottom))

    target_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(target_path, "PNG", optimize=True)


def main():
    for filename in HERO_PRODUCTS:
        source = SOURCE_DIR / filename
        target = OUT_DIR / source.with_suffix(".png").name
        cutout(source, target)
        print(target.relative_to(ROOT))


if __name__ == "__main__":
    main()
