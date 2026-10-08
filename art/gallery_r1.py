"""海盐与纸 · 第一轮选图画廊。python gallery_r1.py 生成 out/gallery/（可以反复运行）。
本地查看：python -m http.server 8767 --directory art/out/gallery，然后打开 http://localhost:8767/gallery.html"""
from __future__ import annotations

import json
import shutil
import time

from PIL import Image

import gallery
import pixellab

OUT = gallery.OUT
R1 = gallery.R1

gallery.CARD_CANDIDATES.update({
    "crab": [("crab-2", "橙色、带笑脸，明暗最简单"), ("crab-5", "亮橙"), ("crab-9", "橙色、更圆"), ("crab", "深一点的红橙")],
    "boat": [("boat-8", "红条船身，最显眼"), ("boat", "原木色"), ("boat-10", "蓝条船身"), ("boat-3", "原木色、浪大一点")],
    "fish": [("fish", "黄蓝条纹、圆眼睛"), ("fish-12", "条纹更密"), ("fish-14", "大黄鱼、蓝鳍"), ("fish-2", "条纹波浪")],
    "shark": [("shark", "灰蓝、微笑"), ("shark-8", "同款、鳍大一点"), ("shark-3", "斜着游"), ("shark-13", "大眼睛")],
    "swimmer": [("swimmer", "红泳帽"), ("swimmer-2", "黄泳帽"), ("swimmer-3", "绿泳帽、深肤色"), ("swimmer-8", "白泳帽")],
    "shell": [("shell-7", "咧嘴笑"), ("shell", "抿嘴笑"), ("shell-2", "橙一点"), ("shell-15", "大笑")],
    "octopus": [("octopus-9", "大眼睛、浅紫（紫色牌上也分得开）"), ("octopus", "深紫、卷触手"), ("octopus-2", "中紫"), ("octopus-14", "品红")],
    "penguin": [("penguin-3", "红围巾（和企鹅群呼应）"), ("penguin", "最简单的一只"), ("penguin-2", "眯眼笑"), ("penguin-8", "领结")],
    "sailor": [("sailor", "挥手"), ("sailor-7", "挥手、换了角度"), ("sailor-8", "挥手、笑"), ("sailor-4", "红条衫、大笑")],
    "lighthouse": [("lighthouse", "带黄色光束，一眼认得出"), ("lighthouse-13", "光束更大"), ("lighthouse-8", "没有光束"), ("lighthouse-11", "旁边有小屋")],
    "shoal": [("shoal-6", "深蓝小鱼围成一圈（灰色牌上看得清）"), ("shoal", "银蓝、五条"), ("shoal-4", "围成一圈、颜色浅"), ("shoal-3", "四条")],
    "colony": [("colony-2", "三只企鹅戴不同颜色的围巾"), ("colony", "三只、冰块"), ("colony-13", "五只挤在一起"), ("colony-3", "三只、站位错开")],
    "captain": [("captain-15", "深蓝外套 + 烟斗"), ("captain-3", "深蓝外套"), ("captain-7", "深蓝外套、锚扣"), ("captain-12", "独眼罩 + 烟斗")],
    "mermaid": [("mermaid2-1", "挥手、鱼尾露得最清楚"), ("mermaid2", "挥手"), ("mermaid2-2", "双手举起"), ("mermaid2-3", "托腮笑")],
})


def avatar_set(cid: str, picks: list[int]) -> str:
    seat = ["#ef6b57", "#3f8fe8", "#47b968", "#f0b53a"]
    strip = Image.new("RGBA", (4 * 44 - 4, 40), (0, 0, 0, 0))
    for index, pick in enumerate(picks):
        name = "avatar.png" if pick == 0 else f"avatar-{pick}.png"
        face = Image.open(R1 / "avatar" / name).convert("RGBA")
        box = Image.new("RGBA", (40, 40), seat[index])
        box.paste(Image.new("RGBA", (36, 36), (29, 42, 72, 255)), (2, 2))
        box.alpha_composite(face, (4, 4))
        strip.alpha_composite(box, (index * 44, 0))
    strip = strip.resize((strip.width * 3, strip.height * 3), Image.NEAREST)
    target = OUT / "avatars" / f"{cid}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    strip.save(target)
    return target.relative_to(OUT).as_posix()


def scene_item(item_id: str, title: str, note: str, prefix: str, seeds: tuple[int, ...], recommended: int) -> dict:
    sources = []
    for seed in seeds:
        path = R1 / f"{prefix}-s{seed}.png"
        if path.exists():
            sources.append((f"s{seed}", gallery.copy_in(path, "scenes"), ""))
    return gallery.image_item(item_id, title, note, sources, f"s{recommended}", scale=1, wide=False)


def build() -> dict:
    items = gallery.build()
    for item in items:
        item["note"] = "现在牌桌上用的是标「推荐」的那张。每个候选贴在这种牌真实会有的两种颜色上（放大 2 倍）。"
    for item in items:
        if item["id"] == "card-mermaid":
            item["note"] += "\n第一批美人鱼是红色长发 + 青绿鱼尾 + 贝壳胸衣，太像某部动画电影里的人鱼公主（网站收费，撞脸有风险），换成深棕短发、珊瑚色鱼尾、海星发夹重画了。"
    items.append(scene_item("beach-night", "牌桌 · 夜间（月光沙滩）", "512×288，按整数倍放大铺满牌桌，显示下半部（干沙），上面盖一层淡淡的深色。", "beach-night", (41, 42, 43), 41))
    items.append(scene_item("beach-day", "牌桌 · 白天（晴天沙滩）", "白天版用这张，显示下半部，上面盖一层淡淡的白色。", "beach-day", (31, 32, 33), 32))
    items.append(scene_item("hero", "首页主图", "", "hero", (51, 52, 53), 52))
    emblems = [(f"e{n}", gallery.copy_in(R1 / "emblem" / ("emblem.png" if n == 0 else f"emblem-{n}.png"), "emblem"), label) for n, label in ((56, "白贝壳 + 米色外圈（现在用的）"), (0, "白贝壳 + 蓝圈"), (31, "白贝壳 + 浅色外圈"), (40, "浪花"))]
    items.append(gallery.image_item("emblem", "牌背中间的徽记（也是网页图标）", "", emblems, "e56", scale=3))
    items.append(gallery.image_item("avatars", "座位头像（一组 4 个，边框是座位色）", "", [
        ("A", avatar_set("A", [3, 26, 2, 13]), "海星 / 海豹 / 海龟 / 海鸥（现在用的）"),
        ("B", avatar_set("B", [27, 9, 16, 24]), "换一组同类的"),
        ("C", avatar_set("C", [46, 43, 61, 29]), "螃蟹 / 蓝鸟 / 青蛙 / 小黄鸭"),
    ], "A", scale=1))
    return {
        "round": "r1",
        "title": "海盐与纸 · 第一轮：牌面和场景",
        "updated": time.strftime("%m-%d %H:%M"),
        "spent": pixellab.spent_usd(),
        "intro": ("游戏已经能玩了（上面是牌局截图和几段小动画：打出对子、被偷、四美人鱼获胜时在玩家面板上弹一下），美术先用我挑的。卡面按你说的：整张是牌的颜色，中间一只白描边的像素小图，字很少。\n"
                  "每项点「选这张」，或者「都不满意，重画」并写备注。最后把页面底部那段文字复制给我。"),
        "preview": [],
        "items": items,
    }


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    data = build()
    shots = OUT / "shots"
    if shots.exists():
        data["preview"] = [{"src": f"shots/{p.name}", "caption": caption} for p, caption in [
            (shots / "table-night.png", "牌桌 · 夜间版（1440×790）"),
            (shots / "table-day.png", "牌桌 · 白天版"),
            (shots / "home.png", "首页"),
        ] if p.exists()]
        fx = OUT / "fx"
        labels = {"crab": "打出两只蟹", "boat": "打出两艘船（第一版几乎不动，重做过）", "fish": "打出两条鱼", "shark": "鲨鱼 + 泳者 / 被偷", "mermaid": "四美人鱼获胜"}
        data["preview"] += [{"src": f"fx/{name}.gif", "caption": f"小动画：{label}"} for name, label in labels.items() if (fx / f"{name}.gif").exists()]
    extra = json.loads((OUT / "extra-items.json").read_text()) if (OUT / "extra-items.json").exists() else []
    data["items"] += extra
    (OUT / "gallery.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    shutil.copyfile(gallery.ART / "gallery.html", OUT / "gallery.html")
    print("gallery ok, items", len(data["items"]), "spent", round(pixellab.spent_usd(), 4))
