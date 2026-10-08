import type { Card, CardColor, CardPoints, CardType, CollectorType, DuoType, MultiplierType, PairEffect } from "./types.js";

/** 颜色的固定顺序（界面上数颜色、并列时都按这个顺序）。 */
export const COLORS: readonly CardColor[] = [
  "darkBlue",
  "lightBlue",
  "black",
  "yellow",
  "green",
  "white",
  "purple",
  "gray",
  "lightOrange",
  "pink",
  "orange",
];

/** 牌的固定顺序：对子、收集、乘数、美人鱼。手牌按这个顺序排。 */
export const CARD_TYPES: readonly CardType[] = [
  "crab",
  "boat",
  "fish",
  "shark",
  "swimmer",
  "shell",
  "octopus",
  "penguin",
  "sailor",
  "lighthouse",
  "shoal",
  "colony",
  "captain",
  "mermaid",
];

/**
 * 官方牌表：每种牌各有哪些颜色（出现几次就是几张）。合计 58 张：
 * 深蓝 9、浅蓝 9、黑 8、黄 8、绿 6、白 4（就是 4 张美人鱼）、紫 4、灰 4、浅橙 3、粉 2、橙 1。
 */
export const CARD_LIST: Readonly<Record<CardType, readonly CardColor[]>> = {
  crab: ["darkBlue", "darkBlue", "lightBlue", "lightBlue", "black", "yellow", "yellow", "green", "gray"],
  boat: ["darkBlue", "darkBlue", "lightBlue", "lightBlue", "black", "black", "yellow", "yellow"],
  fish: ["darkBlue", "darkBlue", "lightBlue", "black", "black", "yellow", "green"],
  shark: ["darkBlue", "lightBlue", "black", "green", "purple"],
  swimmer: ["darkBlue", "lightBlue", "black", "yellow", "lightOrange"],
  shell: ["darkBlue", "lightBlue", "black", "yellow", "green", "gray"],
  octopus: ["lightBlue", "yellow", "green", "purple", "gray"],
  penguin: ["purple", "lightOrange", "pink"],
  sailor: ["pink", "orange"],
  lighthouse: ["purple"],
  shoal: ["gray"],
  colony: ["green"],
  captain: ["lightOrange"],
  mermaid: ["white", "white", "white", "white"],
};

export const DUO_TYPES: readonly DuoType[] = ["crab", "boat", "fish", "shark", "swimmer"];

/** 收集牌：有 n 张时得 table[n - 1] 分。 */
export const COLLECTOR_POINTS: Readonly<Record<CollectorType, readonly number[]>> = {
  shell: [0, 2, 4, 6, 8, 10],
  octopus: [0, 3, 6, 9, 12],
  penguin: [1, 3, 5],
  sailor: [0, 5],
};

/** 乘数牌：每有一张 target 得 per 分（乘数牌自己不算）。 */
export const MULTIPLIERS: Readonly<Record<MultiplierType, { readonly target: DuoType | CollectorType; readonly per: number }>> = {
  lighthouse: { target: "boat", per: 1 },
  shoal: { target: "fish", per: 1 },
  colony: { target: "penguin", per: 2 },
  captain: { target: "sailor", per: 3 },
};

/** 整副 58 张，id 按牌表顺序 0–57。 */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const type of CARD_TYPES) {
    for (const color of CARD_LIST[type]) cards.push({ id: id++, type, color });
  }
  return cards;
}

export function isDuo(type: CardType): type is DuoType {
  return (DUO_TYPES as readonly CardType[]).includes(type);
}

/** 两张牌能不能凑成一对打出，能的话是什么效果。 */
export function pairEffect(a: CardType, b: CardType): PairEffect | null {
  if (a === b && (a === "crab" || a === "boat" || a === "fish")) return a;
  if ((a === "shark" && b === "swimmer") || (a === "swimmer" && b === "shark")) return "steal";
  return null;
}

/** 牌的种类键：type 或 type:color（测试里码牌用）。 */
export function cardKey(card: Pick<Card, "type" | "color">): string {
  return `${card.type}:${card.color}`;
}

/** 手牌排序：按牌的种类，再按颜色，最后按 id。 */
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort(
    (a, b) =>
      CARD_TYPES.indexOf(a.type) - CARD_TYPES.indexOf(b.type) ||
      COLORS.indexOf(a.color) - COLORS.indexOf(b.color) ||
      a.id - b.id,
  );
}

/**
 * 卡牌分（手牌 + 面前打出的对子一起算）：
 * - 对子：打出的每一对 1 分；手里两张同名（鲨鱼配泳者）也算一对。
 * - 收集牌、乘数牌按张数；乘数牌数的是手里和面前的对应牌。
 * - 美人鱼：各颜色张数从多到少排，第 k 张美人鱼得第 k 多的颜色的张数（美人鱼自己算白色）。
 * - 颜色奖励：最多的那种颜色有几张。
 */
export function cardPoints(hand: readonly Card[], played: readonly (readonly Card[])[]): CardPoints {
  const all = [...hand, ...played.flat()];
  const total = (type: CardType) => all.reduce((n, card) => n + (card.type === type ? 1 : 0), 0);
  const held = (type: CardType) => hand.reduce((n, card) => n + (card.type === type ? 1 : 0), 0);

  const pairs =
    played.length +
    Math.floor(held("crab") / 2) +
    Math.floor(held("boat") / 2) +
    Math.floor(held("fish") / 2) +
    Math.min(held("shark"), held("swimmer"));

  let collectors = 0;
  for (const type of Object.keys(COLLECTOR_POINTS) as CollectorType[]) {
    const n = total(type);
    const table = COLLECTOR_POINTS[type];
    if (n > 0) collectors += table[Math.min(n, table.length) - 1]!;
  }

  let multipliers = 0;
  for (const type of Object.keys(MULTIPLIERS) as MultiplierType[]) {
    if (total(type) > 0) multipliers += MULTIPLIERS[type].per * total(MULTIPLIERS[type].target);
  }

  const colors: Partial<Record<CardColor, number>> = {};
  for (const card of all) colors[card.color] = (colors[card.color] ?? 0) + 1;
  const ranked = Object.values(colors).sort((a, b) => b - a);
  const mermaids = ranked.slice(0, total("mermaid")).reduce((sum, n) => sum + n, 0);
  const colorBonus = ranked[0] ?? 0;

  return { pairs, collectors, multipliers, mermaids, total: pairs + collectors + multipliers + mermaids, colorBonus, colors };
}

/** 一位玩家一共有几张美人鱼（手里 + 面前）。 */
export function mermaidCount(hand: readonly Card[], played: readonly (readonly Card[])[]): number {
  return [...hand, ...played.flat()].filter((card) => card.type === "mermaid").length;
}
