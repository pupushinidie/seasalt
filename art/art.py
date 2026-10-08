"""海盐与纸美术第一轮：出候选。结果在 out/r1/<名字>/（小图一组一个目录）或 out/r1/<名字>-s<种子>.png（大图）。

卡面方向（他定的）：整张牌是这张牌的颜色（纯色底），中间一只带白描边的像素小图，字很少，清爽，不做折纸效果。
- 14 种牌各一只 64px 小图（/generate-image-v2：64px 一次出 16 个候选）。所有颜色共用同一只，底色由 CSS 按牌的颜色画；
  白描边由 export.py 用代码加，保证每张一致。第一只（蟹）挑好后当风格参考，其余的只学描边、细节和明暗，不学配色。
- 牌桌（白天晴天沙滩 / 夜间月光沙滩）和首页主图用 /create-image-pixen，512×288。
- 座位头像、按钮图标是 32px 小图（一次 64 个候选）。
PixelLab 同一时间只跑一个任务，按顺序一个一个来。

用法：python art.py [--style 风格参考图] [名字 ...]（不写名字就全跑；已经出过的跳过）
"""
from __future__ import annotations

import pathlib
import sys

import pixellab

OUT = pixellab.ART / "out" / "r1"

STYLE = "cute simple pixel art icon for a card game, centered, single subject, clean bold dark outline, bright flat colors, soft simple shading, no text, no background"

# 名字: 提示词（64px 小图）
CREATURES: dict[str, str] = {
    "crab": "a cute red-orange crab facing front, two raised claws, little eyes on stalks",
    "boat": "a small wooden sailboat with one white triangular sail, side view, floating on a little wave",
    "fish": "a cute round tropical fish swimming sideways, yellow and blue stripes, big eye",
    "shark": "a grey-blue shark swimming sideways, open smiling mouth with small teeth, dorsal fin",
    "swimmer": "a person swimming front crawl in blue water, swim cap and goggles, one arm raised mid stroke, splashes",
    "shell": "a peach-pink scallop seashell with ridges, front view",
    "octopus": "a cute purple octopus with eight curly tentacles, front view, big eyes",
    "penguin": "a cute standing penguin, black and white with orange beak and feet, front view",
    "sailor": "a young sailor boy in a white sailor hat and blue and white striped shirt, waving, upper body, front view",
    "mermaid": "a mermaid with long flowing red hair and a teal fish tail, sitting, smiling, full body",
    "lighthouse": "a red and white striped lighthouse on a little rock, yellow light shining at the top",
    "shoal": "a school of five small silver-blue fish swimming together in a curve",
    "colony": "a group of three cute penguins standing close together on a small ice floe",
    "captain": "an old sea captain with a white captain hat, white beard and a pipe, navy coat, upper body, front view",
    # 第一版红发青尾太像某部动画电影的人鱼公主，换掉发色、鱼尾和上衣
    "mermaid2": "a cute mermaid girl with short wavy dark brown hair and a coral pink fish tail, a small yellow starfish clip in her hair, white top, sitting and waving, full body",
}

# 32px 小图（一次 64 个候选）
ICONS: dict[str, str] = {
    "icon-stop": "game icon: a raised open hand palm facing forward, stop gesture, simple white glove with dark outline",
    "icon-last": "game icon: a small golden hourglass with blue sand running down",
    "avatar": "cute round seaside animal face portrait for a game avatar, front view, big eyes, head only, seagull or seal or turtle or starfish or crab",
    "emblem": "a round white seashell emblem medallion on a deep blue wave badge, symmetric, front view",
}

SCENES: dict[str, tuple[str, tuple[int, ...]]] = {
    "beach-day": ("top-down view of a bright sandy beach on a sunny day, smooth pale sand covering most of the picture, gentle turquoise waves and white foam along the top edge, a few small shells and pebbles scattered near the edges, calm and clean, no people, no text", (31, 32, 33)),
    "beach-night": ("top-down view of a sandy beach at night under moonlight, smooth cool blue-grey sand covering most of the picture, dark blue sea and soft glowing foam along the top edge, a few small shells near the edges, calm and quiet, no people, no text", (41, 42, 43)),
    "hero": ("a bright sunny seaside: a red and white lighthouse on the rocks, a small sailboat on turquoise water, penguins and a crab on the white sand beach, seashells, fluffy clouds, clean and cheerful, no people, no text", (51, 52, 53)),
}


def b64(path: pathlib.Path) -> dict:
    return pixellab.b64_image(path)


def creature(name: str, style: pathlib.Path | None) -> None:
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    body: dict = {
        "description": f"{CREATURES[name]}. {STYLE}",
        "image_size": {"width": 64, "height": 64},
        "no_background": True,
        "seed": 1101,
    }
    if style:
        body["style_image"] = {"image": b64(style), "size": {"width": 64, "height": 64}}
        body["style_options"] = {"color_palette": False, "outline": True, "detail": True, "shading": True}
    pixellab.generate_async(name, body, folder, endpoint="/generate-image-v2")


def icon(name: str) -> None:
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    pixellab.generate_async(name, {
        "description": ICONS[name],
        "image_size": {"width": 32, "height": 32},
        "no_background": True,
        "seed": 1201,
    }, folder, endpoint="/generate-image-v2")


def scene(name: str) -> None:
    prompt, seeds = SCENES[name]
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": prompt,
            "image_size": {"width": 512, "height": 288},
            "detail": "highly detailed",
            "seed": seed,
        }, OUT, endpoint="/create-image-pixen")


if __name__ == "__main__":
    args = sys.argv[1:]
    style: pathlib.Path | None = None
    if args[:1] == ["--style"]:
        style = pixellab.ART / args[1]
        args = args[2:]
    names = args or [*CREATURES, *ICONS, *SCENES]
    for name in names:
        try:
            if name in CREATURES:
                creature(name, style)
            elif name in ICONS:
                icon(name)
            else:
                scene(name)
        except Exception as error:  # 一项失败不影响后面的
            print(name, "失败：", error, flush=True)
            continue
        print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
