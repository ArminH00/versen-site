from pathlib import Path

from PIL import Image
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PRODUCT_DIR = ROOT / "assets" / "product-clean"
CARD_BACKGROUND = (246, 245, 241)


def clean(path):
    image = Image.open(path).convert("RGB")
    pixels = np.array(image, dtype=np.uint8)
    low = pixels.min(axis=2)
    high = pixels.max(axis=2)
    mask = (low >= 248) & ((high - low) <= 12)
    changed = int(mask.sum())

    if changed:
        pixels[mask] = CARD_BACKGROUND
        image = Image.fromarray(pixels, "RGB")
        image.save(path, "JPEG", quality=94, optimize=True)

    return changed


def main():
    for path in sorted(PRODUCT_DIR.glob("*.jpg")):
        changed = clean(path)
        print(f"{path.relative_to(ROOT)}: {changed} px")


if __name__ == "__main__":
    main()
