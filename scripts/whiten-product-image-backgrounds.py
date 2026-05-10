from pathlib import Path

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[1]
PRODUCT_DIR = ROOT / "assets" / "product-clean"


def clean(path):
    image = Image.open(path).convert("RGB")
    r, g, b = image.split()
    min_channel = ImageChops.darker(ImageChops.darker(r, g), b)
    max_channel = ImageChops.lighter(ImageChops.lighter(r, g), b)
    saturation = ImageChops.subtract(max_channel, min_channel)
    light_mask = min_channel.point(lambda value: 255 if value >= 218 else 0)
    neutral_mask = saturation.point(lambda value: 255 if value <= 18 else 0)
    mask = ImageChops.multiply(light_mask, neutral_mask)
    changed = mask.histogram()[255]

    if changed:
        image.paste(Image.new("RGB", image.size, "#ffffff"), mask=mask)
        image.save(path, "JPEG", quality=94, optimize=True)

    return changed


def main():
    for path in sorted(PRODUCT_DIR.glob("*.jpg")):
        changed = clean(path)
        print(f"{path.relative_to(ROOT)}: {changed} px")


if __name__ == "__main__":
    main()
