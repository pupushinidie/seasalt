import type { CardColor, CardType } from "@seasalt/game";

/** 美术资源（art/export.py 导出到 public/art/）、座位色和牌的颜色。 */
const BASE = `${import.meta.env.BASE_URL}art/`;

export const art = {
  hero: `${BASE}hero.png`,
  /** 牌桌：白天是晴天沙滩，夜间是月光沙滩。 */
  beachDay: `${BASE}beach-day.png`,
  beachNight: `${BASE}beach-night.png`,
  /** 牌背中间的徽记（32px）。 */
  emblem: `${BASE}emblem.png`,
  /** 每种牌的小图（72px 画布，白描边已经画好；-sm 是缩一半的 36px 版，小牌用）。 */
  card: (type: CardType) => `${BASE}card-${type}.png`,
  cardSmall: (type: CardType) => `${BASE}card-${type}-sm.png`,
  /** 对子效果的小动画：横排帧条，每帧 72px（见 art/export.py 的 FX）。 */
  fx: (name: "crab" | "boat" | "fish" | "shark" | "mermaid") => `${BASE}fx-${name}.png`,
  /** STOP / 最后机会的图标（32px）。 */
  iconStop: `${BASE}icon-stop.png`,
  iconLast: `${BASE}icon-last.png`,
  /** 座位头像 0–3（32px）。 */
  avatar: (index: number) => `${BASE}avatar-${index % 4}.png`,
};

/** 动画帧条的帧数（和 art/export.py 一致）。 */
export const FX_FRAMES = 8;

/** 座位色：4 种，开局按入座顺序分。 */
export const SEAT_COLORS = ["#ef6b57", "#3f8fe8", "#47b968", "#f0b53a"] as const;

export function seatColor(index: number): string {
  return SEAT_COLORS[index % SEAT_COLORS.length]!;
}

/**
 * 牌的 11 种颜色：牌面整张就是这个颜色。偏清爽，但相邻的几种（深蓝 / 黑、浅橙 / 粉 / 橙、灰 / 白）要分得开。
 * ink 是牌上的字色（深底白字、浅底深字），edge 是牌面内圈的描边色。
 */
export const CARD_COLORS: Readonly<Record<CardColor, { readonly name: string; readonly bg: string; readonly ink: string; readonly edge: string }>> = {
  darkBlue: { name: "深蓝", bg: "#2f5fae", ink: "#ffffff", edge: "#1d3f7a" },
  lightBlue: { name: "浅蓝", bg: "#7fcdf0", ink: "#0f3550", edge: "#4ea8d4" },
  black: { name: "黑", bg: "#2b2f38", ink: "#ffffff", edge: "#14161b" },
  yellow: { name: "黄", bg: "#f6d24c", ink: "#4a3806", edge: "#d6aa1c" },
  green: { name: "绿", bg: "#5cbb6c", ink: "#0d3a18", edge: "#3a9350" },
  white: { name: "白", bg: "#f8f5ee", ink: "#3a4252", edge: "#d2ccbe" },
  purple: { name: "紫", bg: "#9b80d8", ink: "#ffffff", edge: "#6f55b0" },
  gray: { name: "灰", bg: "#a6aeb8", ink: "#24292f", edge: "#7d8792" },
  lightOrange: { name: "浅橙", bg: "#f9c597", ink: "#5a2e0c", edge: "#e09a5e" },
  pink: { name: "粉", bg: "#f5a5c2", ink: "#5a1830", edge: "#d8729a" },
  orange: { name: "橙", bg: "#f0802e", ink: "#ffffff", edge: "#c45a10" },
};

/** 背景图 512×288，按整数倍放大到盖满一块区域。 */
export function coverSize(width: number, height: number): string {
  const scale = Math.max(1, Math.ceil(Math.max(width / 512, height / 288)));
  return `${512 * scale}px ${288 * scale}px`;
}
