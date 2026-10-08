"""候选总览：python overview.py <名字> [牌色1 牌色2]：16 个候选各贴在两种牌色上，加白描边，拼成 out/sheets/<名字>-overview.png。"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw

import sticker

OUT = pathlib.Path(__file__).resolve().parent / "out"


def overview(name: str, colors=("darkBlue", "yellow")) -> pathlib.Path:
    folder = OUT / "r1" / name
    files = [folder / f"{name}.png"] + sorted(
        [p for p in folder.glob(f"{name}-*.png") if p.stem.rsplit("-", 1)[-1].isdigit()],
        key=lambda p: int(p.stem.rsplit("-", 1)[1]),
    )
    cols, scale = 8, 2
    cw, ch = 96 * scale + 6, 134 * scale + 22
    rows = (len(files) + cols - 1) // cols
    board = Image.new("RGBA", (cols * cw, rows * ch * len(colors)), (225, 230, 238, 255))
    draw = ImageDraw.Draw(board)
    for i, f in enumerate(files):
        sprite = sticker.outline(sticker.fit(Image.open(f)), white=2)
        for k, color in enumerate(colors):
            x = (i % cols) * cw
            y = (i // cols) * ch * len(colors) + k * ch
            board.alpha_composite(sticker.card_mock(sprite, color, scale), (x + 3, y + 18))
            if k == 0:
                draw.text((x + 4, y + 4), str(i), fill=(0, 0, 0, 255))
    path = OUT / "sheets" / f"{name}-overview.png"
    board.save(path)
    return path


if __name__ == "__main__":
    colors = tuple(sys.argv[2:4]) or ("darkBlue", "yellow")
    print(overview(sys.argv[1], colors))
