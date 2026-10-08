"""检查动画帧：每帧相对首帧、相邻帧的变化量（不透明像素里颜色变了的比例），拼成放大 3 倍的帧条。python fxcheck.py fx-crab"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageChops

OUT = pathlib.Path(__file__).resolve().parent / "out"


def frames(name: str) -> list[pathlib.Path]:
    return sorted((OUT / "fx" / name).glob(f"{name}-s*-[0-9][0-9].png"))


def diff(a: Image.Image, b: Image.Image) -> float:
    d = ImageChops.difference(a.convert("RGBA"), b.convert("RGBA")).convert("L").point(lambda v: 255 if v > 24 else 0)
    mask = ImageChops.lighter(a.getchannel("A"), b.getchannel("A")).point(lambda v: 255 if v > 40 else 0)
    area = sum(1 for v in mask.getdata() if v)
    changed = sum(1 for v, m in zip(d.getdata(), mask.getdata()) if v and m)
    return changed / max(1, area)


if __name__ == "__main__":
    for name in sys.argv[1:]:
        paths = frames(name)
        images = [Image.open(p).convert("RGBA") for p in paths]
        first = [round(diff(images[0], im), 3) for im in images]
        step = [round(diff(images[i - 1], images[i]), 3) for i in range(1, len(images))]
        print(name, len(images), "帧；相对首帧", first, "；相邻", step)
        w, h = images[0].size
        strip = Image.new("RGBA", (w * len(images), h), (60, 70, 100, 255))
        for i, im in enumerate(images):
            strip.alpha_composite(im, (i * w, 0))
        strip.resize((strip.width * 3, strip.height * 3), Image.NEAREST).save(OUT / "sheets" / f"{name}-frames.png")
