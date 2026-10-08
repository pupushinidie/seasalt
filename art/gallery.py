"""生成选图画廊：out/gallery/gallery.json + gallery.html + 候选图。可以反复运行。
本地查看：python -m http.server 8767 --directory art/out/gallery，然后打开 http://localhost:8767/gallery.html

牌面小图每个候选都按导出的样子（白描边）贴在这种牌真实有的两种颜色上，放大 2 倍；推荐的就是现在牌桌上用的。
"""
from __future__ import annotations

import json
import pathlib
import shutil
import time

from PIL import Image, ImageDraw

import export
import pixellab
import sticker

ART = pixellab.ART
OUT = ART / "out" / "gallery"
R1 = ART / "out" / "r1"

NAMES = {
    "crab": "蟹", "boat": "船", "fish": "鱼", "shark": "鲨鱼", "swimmer": "泳者", "shell": "贝壳", "octopus": "章鱼",
    "penguin": "企鹅", "sailor": "水手", "lighthouse": "灯塔", "shoal": "鱼群", "colony": "企鹅群", "captain": "船长", "mermaid": "美人鱼",
}
# 每种牌在牌桌上会出现的颜色（挑两种对比大的来贴）
SHOW_COLORS = {
    "crab": ("darkBlue", "yellow"), "boat": ("lightBlue", "black"), "fish": ("darkBlue", "yellow"), "shark": ("lightBlue", "purple"),
    "swimmer": ("black", "lightOrange"), "shell": ("green", "gray"), "octopus": ("purple", "yellow"), "penguin": ("pink", "lightOrange"),
    "sailor": ("pink", "orange"), "lighthouse": ("purple", "purple"), "shoal": ("gray", "gray"), "colony": ("green", "green"),
    "captain": ("lightOrange", "lightOrange"), "mermaid": ("white", "white"),
}
INK = {"darkBlue": "#ffffff", "black": "#ffffff", "purple": "#ffffff", "orange": "#ffffff"}

# 每种牌的候选（第一个是推荐，也就是现在用的）：(候选编号, 说明)
CARD_CANDIDATES: dict[str, list[tuple[str, str]]] = {}


def card_png(source: pathlib.Path, color: str, name: str) -> Image.Image:
    sprite = sticker.trim(Image.open(source).convert("RGBA"))
    big = sticker.outline(export.place(sprite, 72), white=2, dark=1)
    w, h = 96, 134
    card = Image.new("RGBA", (w, h), sticker.CARD_BG[color])
    draw = ImageDraw.Draw(card)
    draw.rectangle([1, 1, w - 2, h - 2], outline=(255, 255, 255, 190), width=1)
    card.alpha_composite(big, ((w - 72) // 2, (h - 72) // 2))
    return card


def card_strip(kind: str, cand: str) -> str:
    source = R1 / kind.replace("mermaid", "mermaid2") / f"{cand}.png" if kind == "mermaid" else R1 / kind / f"{cand}.png"
    colors = SHOW_COLORS[kind]
    colors = colors[:1] if colors[0] == colors[1] else colors
    cards = [card_png(source, color, NAMES[kind]) for color in colors]
    strip = Image.new("RGBA", (len(cards) * 100 - 4, 134), (0, 0, 0, 0))
    for index, card in enumerate(cards):
        strip.alpha_composite(card, (index * 100, 0))
    strip = strip.resize((strip.width * 2, strip.height * 2), Image.NEAREST)
    target = OUT / "cards" / f"{cand}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    strip.save(target)
    return target.relative_to(OUT).as_posix()


def image_item(item_id: str, title: str, note: str, sources: list[tuple[str, str, str]], recommended: str | None, **extra) -> dict:
    return {
        "id": item_id, "title": title, "note": note, "kind": "image", **extra,
        "candidates": [{"id": cid, "src": src, "label": label, **({"recommended": True} if cid == recommended else {})} for cid, src, label in sources],
    }


def copy_in(path: pathlib.Path, folder: str) -> str:
    target = OUT / folder / path.name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
    return target.relative_to(OUT).as_posix()


def build() -> dict:
    items = []
    for kind, cands in CARD_CANDIDATES.items():
        sources = [(cand, card_strip(kind, cand), label) for cand, label in cands]
        items.append(image_item(f"card-{kind}", f"{NAMES[kind]}", "", sources, cands[0][0], scale=1))
    return items


if __name__ == "__main__":
    print("用 gallery_r1.py")
