#!/usr/bin/env python3
"""Генерирует иконки приложения (mipmap-*) — прицельная сетка на оливковом фоне."""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}


def draw(size: int) -> Image.Image:
    s = size * 4  # сглаживание уменьшением
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.2, fill=(38, 43, 33, 255))
    d.rounded_rectangle([s * 0.04, s * 0.04, s * 0.96, s * 0.96], radius=s * 0.17, outline=(74, 82, 62, 255), width=max(2, s // 60))
    c = s / 2
    light = (214, 204, 172, 255)
    for r, w in ((0.34, 0.022), (0.2, 0.016)):
        d.ellipse([c - s * r, c - s * r, c + s * r, c + s * r], outline=light, width=max(2, int(s * w)))
    # перекрестие с разрывом в центре
    for a in range(4):
        ang = a * math.pi / 2
        x0 = c + math.cos(ang) * s * 0.09
        y0 = c + math.sin(ang) * s * 0.09
        x1 = c + math.cos(ang) * s * 0.42
        y1 = c + math.sin(ang) * s * 0.42
        d.line([x0, y0, x1, y1], fill=light, width=max(2, int(s * 0.022)))
    # деления дальности
    for i in range(1, 4):
        y = c + s * 0.08 * i + s * 0.03
        half = s * (0.05 - i * 0.008)
        d.line([c - half, y, c + half, y], fill=light, width=max(2, int(s * 0.012)))
    d.ellipse([c - s * 0.03, c - s * 0.03, c + s * 0.03, c + s * 0.03], fill=(168, 52, 38, 255))
    return img.resize((size, size), Image.LANCZOS)


for name, size in SIZES.items():
    out = os.path.join(ROOT, f'mipmap-{name}')
    os.makedirs(out, exist_ok=True)
    draw(size).save(os.path.join(out, 'ic_launcher.png'))
print('иконки готовы')
