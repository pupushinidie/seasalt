"""把 selection.json 里选定的图导出到 apps/web/public/art/（名字以 _ 开头的不导出）。用法：python export.py

- card-<种类>：牌面小图。裁掉空白、加白描边（2 像素白 + 1 像素深色细边），放进 72×72 画布 → card-<种类>.png（大牌按 1 倍显示）；
  再缩一半（每 2×2 取多数色，保住描边）加 1 像素白边 + 1 像素深色边，放进 36×36 → card-<种类>-sm.png（小牌用）。
- 其他（牌桌、首页主图、头像、徽记）：原样复制。
"""
from __future__ import annotations

import json
import pathlib
import shutil
from collections import Counter

from PIL import Image

import sticker

ART = pathlib.Path(__file__).resolve().parent
TARGET = ART.parent / "apps" / "web" / "public" / "art"


def half(img: Image.Image) -> Image.Image:
    """像素画缩一半：每 2×2 里有 2 个以上不透明像素就取不透明像素里最多的颜色（一样多取最深的）。"""
    img = img.convert("RGBA")
    width, height = (img.width + 1) // 2, (img.height + 1) // 2
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    src = img.load()
    dst = out.load()
    for y in range(height):
        for x in range(width):
            block = []
            for dy in (0, 1):
                for dx in (0, 1):
                    sx, sy = x * 2 + dx, y * 2 + dy
                    if sx < img.width and sy < img.height and src[sx, sy][3] > 40:
                        block.append(src[sx, sy][:3])
            if len(block) >= 2:
                counts = Counter(block)
                best = max(counts.items(), key=lambda item: (item[1], -sum(item[0])))[0]
                dst[x, y] = (*best, 255)
    return out


def place(img: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


# 一群的图（几块分开的）整体描一圈白边
MERGE = {"card-shoal": 4, "card-colony": 3}


def card_art(source: pathlib.Path, name: str) -> None:
    sprite = sticker.trim(Image.open(source).convert("RGBA"))
    merge = MERGE.get(name, 0)
    big = sticker.outline(place(sprite, 72), white=2, dark=1, merge=merge)
    big.save(TARGET / f"{name}.png")
    small = sticker.outline(place(half(sprite), 36), white=1, dark=1, merge=(merge + 1) // 2)
    small.save(TARGET / f"{name}-sm.png")


if __name__ == "__main__":
    TARGET.mkdir(parents=True, exist_ok=True)
    for name, source in json.loads((ART / "selection.json").read_text()).items():
        if name.startswith("_"):
            continue
        path = ART / source
        if not path.exists():
            print(name, "缺图：", source)
            continue
        if name.startswith("card-"):
            card_art(path, name)
        else:
            shutil.copyfile(path, TARGET / f"{name}.png")
        print(name, "←", source)
