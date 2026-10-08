"""对子效果的小动画（/animate-with-text-v3）：首帧和末帧都用选定的小图，动作只写小幅动作，循环时无缝。
结果在 out/fx/<名字>/<名字>-s<种子>-NN.png。用法：python fx.py [名字 ...]

- fx-crab：两只蟹打出时，蟹开合钳子
- fx-boat：两艘船，船在浪上摇
- fx-fish：两条鱼，鱼摆尾
- fx-shark：鲨鱼 + 泳者，鲨鱼张嘴咬
- fx-mermaid：四美人鱼获胜，美人鱼挥手
"""
from __future__ import annotations

import json
import pathlib
import sys

import pixellab

ART = pixellab.ART
OUT = ART / "out" / "fx"
SELECTION = json.loads((ART / "selection.json").read_text())

FX: dict[str, tuple[str, str, int]] = {
    # 名字: (用哪张小图, 动作, 种子)
    "fx-crab": ("card-crab", "the crab opens and closes its two claws twice, small hop", 31),
    "fx-boat": ("card-boat", "the sailboat rocks gently side to side on the small waves, the sail ripples", 32),
    "fx-fish": ("card-fish", "the fish wiggles its tail and fins, swimming in place", 33),
    "fx-shark": ("card-shark", "the shark opens its mouth wide and snaps it shut, biting twice", 34),
    "fx-mermaid": ("card-mermaid", "the mermaid waves her hand and her tail sways", 35),
    # 第一版船几乎不动（只有首帧不同，循环时会闪），换种子重做
    "fx-boat2": ("card-boat", "the sailboat bobs up and down on the waves, the little waves roll", 36),
}


def run(name: str) -> None:
    card, action, seed = FX[name]
    if card not in SELECTION:
        print(name, "还没选", card)
        return
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    frame = pixellab.b64_image(ART / SELECTION[card])
    pixellab.animate(f"{name}-s{seed}", {
        "first_frame": frame,
        "last_frame": frame,
        "action": action,
        "frame_count": 8,
        "no_background": True,
        "seed": seed,
    }, folder)


if __name__ == "__main__":
    for name in sys.argv[1:] or list(FX):
        try:
            run(name)
        except Exception as error:
            print(name, "失败：", error, flush=True)
            continue
        print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
