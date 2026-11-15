#!/usr/bin/env python3
"""Generate square PWA icons from the checked-in Fizira symbol."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
output = root / "icons"
output.mkdir(exist_ok=True)
with Image.open(root / "fizira-symbol.png") as image:
    symbol = image.convert("RGBA")
for size in (180, 192, 512):
    canvas = Image.new("RGBA", (size, size), "#ffffff")
    width = round(size * 0.7)
    height = round(width * symbol.height / symbol.width)
    resized = symbol.resize((width, height), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((size - width) // 2, (size - height) // 2))
    canvas.convert("RGB").save(output / f"icon-{size}.png", optimize=True)
print("PWA icons generated")
