#!/usr/bin/env python3
"""Prepare launcher art and a store icon from the checked-in Fizira logo."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
icon = root / 'fizira-symbol.png'
target = root / 'android/app/src/main/res/drawable'
store = root / 'android/store-assets'
target.mkdir(parents=True, exist_ok=True)
store.mkdir(parents=True, exist_ok=True)

with Image.open(icon) as source:
    source = source.convert('RGBA')
    for size, output in [
        (512, target / 'ic_launcher.png'),
        (512, store / 'fizira-rustore-icon-512.png'),
    ]:
        background = Image.new('RGBA', (size, size), '#FFFFFF')
        logo_width = round(size * 0.70)
        logo_height = round(source.height * logo_width / source.width)
        scaled = source.resize((logo_width, logo_height), Image.Resampling.LANCZOS)
        background.alpha_composite(scaled, ((size-logo_width)//2,(size-logo_height)//2))
        background.convert('RGB').save(output, optimize=True)
print('FIZIRA_ANDROID_BRAND_ICONS_OK')
