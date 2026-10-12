"""海盐与纸 全屏背景图候选：day / night 各 3 张，512x288，/create-image-pixen。
风格对齐 public/art/hero.png（明亮热带海岛）、beach-day.png、beach-night.png。
"""
import sys
import pathlib
from concurrent.futures import ThreadPoolExecutor, as_completed

ART = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ART))
import pixellab  # noqa: E402

OUT = ART / "out" / "bg"
OUT.mkdir(parents=True, exist_ok=True)

DAY = (
    "Pixel art game background, wide panoramic view of a tropical island shore in bright daylight, "
    "a calm turquoise lagoon with gentle waves and a broad stretch of clear pale sand fills the center "
    "of the picture completely empty, tall palm trees and a small wooden sailboat at the far left and right edges, "
    "a distant green island under a bright blue sky with soft white clouds on the horizon, "
    "a few seashells and a starfish near the corners, vivid azure and teal sea with warm honey sand palette, "
    "fresh airy seaside mood, detailed 16-bit pixel art style, slightly muted and soft lighting so UI panels stay readable. "
    "No text, no letters, no numbers, no signs, no writing, no people, no faces."
)
NIGHT = (
    "Pixel art game background, wide panoramic view of a tropical island shore at night under a starry sky with a bright moon, "
    "a calm dark indigo lagoon with gentle moonlit ripples and pale sand fills the center of the picture completely empty, "
    "palm trees in silhouette and a small wooden sailboat at the far left and right edges, "
    "a distant dark island on the horizon, a glowing lantern and a few seashells near the corners, "
    "deep indigo and teal palette with a warm lantern glow, calm quiet mood, detailed 16-bit pixel art style, "
    "dim and moody so UI panels stay readable. No text, no letters, no numbers, no signs, no writing, no people, no faces."
)


def one(name, desc, seed):
    body = {"description": desc, "image_size": {"width": 512, "height": 288},
            "detail": "highly detailed", "seed": seed}
    return pixellab.generate_image(name, body, OUT, endpoint="/create-image-pixen")


jobs = []
for i, seed in enumerate([1901, 1902, 1903]):
    jobs.append((f"day-s{seed}", DAY, seed))
for i, seed in enumerate([1901, 1902, 1903]):
    jobs.append((f"night-s{seed}", NIGHT, seed))

with ThreadPoolExecutor(max_workers=3) as pool:
    futs = {pool.submit(one, n, d, s): n for n, d, s in jobs}
    for f in as_completed(futs):
        try:
            print("OK", f.result())
        except Exception as e:
            print("FAIL", futs[f], repr(e))
print("done")
