"""小图加白描边（贴纸效果）和候选预览。

- outline(img, white=2, dark=1)：透明底小图外面加 white 像素宽的白边，再加 dark 像素宽的深色细边（让白边在浅色牌上也看得出）。
- python sticker.py <名字> [白边宽]：把 out/r1/<名字>/ 的候选贴到几种牌色上拼成总览 out/sheets/<名字>-cards.png。
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw, ImageFilter

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"

# 和 apps/web/src/art.ts 的 CARD_COLORS 一致
CARD_BG = {
    "darkBlue": "#2f5fae", "lightBlue": "#7fcdf0", "black": "#2b2f38", "yellow": "#f6d24c", "green": "#5cbb6c",
    "white": "#f8f5ee", "purple": "#9b80d8", "gray": "#a6aeb8", "lightOrange": "#f9c597", "pink": "#f5a5c2", "orange": "#f0802e",
}


def _grow(mask: Image.Image, radius: int) -> Image.Image:
    """把不透明区域往外扩 radius 像素（方形扩张，像素风的硬边）。"""
    if radius <= 0:
        return mask
    return mask.filter(ImageFilter.MaxFilter(radius * 2 + 1))


def trim(img: Image.Image, pad: int = 0) -> Image.Image:
    box = img.getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox()
    if not box:
        return img
    left, top, right, bottom = box
    return img.crop((max(0, left - pad), max(0, top - pad), min(img.width, right + pad), min(img.height, bottom + pad)))


def outline(img: Image.Image, white: int = 2, dark: int = 1, dark_color=(36, 40, 52, 255)) -> Image.Image:
    """返回同尺寸的图：原图 + 外圈白边 + 最外圈深色细边。原图边上要留够空位。"""
    img = img.convert("RGBA")
    alpha = img.getchannel("A").point(lambda a: 255 if a > 40 else 0)
    inner = _grow(alpha, white)
    outer = _grow(alpha, white + dark)
    result = Image.new("RGBA", img.size, (0, 0, 0, 0))
    result.paste(Image.new("RGBA", img.size, dark_color), mask=outer)
    result.paste(Image.new("RGBA", img.size, (255, 255, 255, 255)), mask=inner)
    solid = img.copy()
    solid.putalpha(alpha)
    result.alpha_composite(solid)
    return result


def fit(img: Image.Image, size: int = 64, margin: int = 3) -> Image.Image:
    """裁掉空白后放回 size×size 画布中间（四周至少留 margin 像素给描边）。不缩放。"""
    img = trim(img.convert("RGBA"))
    room = size - margin * 2
    if img.width > room or img.height > room:
        # 太大就按整数倍缩小不了，只能裁：居中裁到 room
        left = max(0, (img.width - room) // 2)
        top = max(0, (img.height - room) // 2)
        img = img.crop((left, top, left + min(room, img.width), top + min(room, img.height)))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


def card_mock(sprite: Image.Image, color: str, scale: int = 2) -> Image.Image:
    w, h = 96, 134
    card = Image.new("RGBA", (w, h), CARD_BG[color])
    draw = ImageDraw.Draw(card)
    draw.rectangle([2, 2, w - 3, h - 3], outline=(255, 255, 255, 230), width=2)
    card.alpha_composite(sprite, ((w - sprite.width) // 2, (h - sprite.height) // 2 + 2))
    return card.resize((w * scale, h * scale), Image.NEAREST)


def sheet(name: str, white: int = 2, colors=("darkBlue", "yellow", "black", "white", "lightBlue", "pink")) -> pathlib.Path:
    folder = OUT / "r1" / name
    files = sorted(folder.glob("*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]) if p.stem.rsplit("-", 1)[-1].isdigit() else 0)
    files = [f for f in files if f.stem == name or f.stem.rsplit("-", 1)[-1].isdigit()]
    cells = []
    for f in files:
        sprite = outline(fit(Image.open(f)), white=white)
        cells.append((f, [card_mock(sprite, c) for c in colors]))
    cw, ch = 96 * 2 + 8, 134 * 2 + 8
    cols = len(colors)
    board = Image.new("RGBA", (cols * cw + 40, len(cells) * ch), (232, 236, 242, 255))
    draw = ImageDraw.Draw(board)
    for row, (f, cards) in enumerate(cells):
        suffix = f.stem.rsplit("-", 1)[1] if f.stem.rsplit("-", 1)[-1].isdigit() else "0"
        draw.text((6, row * ch + 8), suffix, fill=(20, 20, 20, 255))
        for col, card in enumerate(cards):
            board.alpha_composite(card, (40 + col * cw, row * ch + 4))
    path = OUT / "sheets" / f"{name}-cards.png"
    board.save(path)
    return path


if __name__ == "__main__":
    print(sheet(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 2))
