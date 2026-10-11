import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import type { Card, CardColor, CardType } from "@seasalt/game";
import { art, CARD_COLORS } from "./art.js";

export const CARD_NAMES: Readonly<Record<CardType, string>> = {
  crab: "蟹",
  boat: "船",
  fish: "鱼",
  shark: "鲨鱼",
  swimmer: "泳者",
  shell: "贝壳",
  octopus: "章鱼",
  penguin: "企鹅",
  sailor: "水手",
  lighthouse: "灯塔",
  shoal: "鱼群",
  colony: "企鹅群",
  captain: "船长",
  mermaid: "美人鱼",
};

/** 牌面底下的一行小字。 */
export const CARD_HINTS: Readonly<Record<CardType, string>> = {
  crab: "一对·挑弃牌",
  boat: "一对·再来",
  fish: "一对·摸一张",
  shark: "配泳者·偷牌",
  swimmer: "配鲨鱼·偷牌",
  shell: "0/2/4/6/8/10",
  octopus: "0/3/6/9/12",
  penguin: "1/3/5",
  sailor: "0/5",
  lighthouse: "每艘船 +1",
  shoal: "每条鱼 +1",
  colony: "每只企鹅 +2",
  captain: "每个水手 +3",
  mermaid: "数一种颜色",
};

/** 完整说明（鼠标悬停、规则里用）。 */
export const CARD_HELP: Readonly<Record<CardType, string>> = {
  crab: "蟹：两只凑一对，1 分。打出这一对：选一个弃牌堆，翻看整堆，挑一张拿进手里（别人不知道是哪张）。",
  boat: "船：两艘凑一对，1 分。打出这一对：马上再来一回合。",
  fish: "鱼：两条凑一对，1 分。打出这一对：从牌堆顶摸一张。",
  shark: "鲨鱼：配一张泳者凑一对，1 分。打出这一对：从一位对手手里随机偷一张。",
  swimmer: "泳者：配一张鲨鱼凑一对，1 分。打出这一对：从一位对手手里随机偷一张。",
  shell: "贝壳：1 张 0 分，之后每多 1 张 +2（6 张 10 分）。",
  octopus: "章鱼：1 张 0 分，之后每多 1 张 +3（5 张 12 分）。",
  penguin: "企鹅：1 / 2 / 3 张得 1 / 3 / 5 分。",
  sailor: "水手：1 张 0 分，2 张 5 分。",
  lighthouse: "灯塔：你每有 1 艘船（手里和面前都算）+1 分。",
  shoal: "鱼群：你每有 1 条鱼 +1 分。",
  colony: "企鹅群：你每有 1 只企鹅 +2 分。",
  captain: "船长：你每有 1 个水手 +3 分。",
  mermaid: "美人鱼：第 1 张得你最多的那种颜色的张数，第 2 张得第二多的，依此类推（美人鱼自己算白色）。集齐 4 张立刻获胜。",
};

export function cardLabel(card: Pick<Card, "type" | "color">): string {
  return `${CARD_COLORS[card.color].name}${CARD_NAMES[card.type]}`;
}

export function colorStyle(color: CardColor): CSSProperties {
  const tone = CARD_COLORS[color];
  return { "--cc": tone.bg, "--ck": tone.ink, "--ce": tone.edge } as CSSProperties;
}

interface CardViewProps {
  readonly card: Pick<Card, "type" | "color">;
  readonly className?: string;
  readonly style?: CSSProperties | undefined;
  readonly title?: string | undefined;
  /** 给了就是可以点的牌（按钮）。 */
  readonly onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
  readonly onMouseEnter?: (() => void) | undefined;
  readonly onMouseLeave?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  /** 牌上叠一块提示（比如「拿这张」）。 */
  readonly badge?: ReactNode | undefined;
  /** 新手教程高亮用的 data-tutorial。 */
  readonly tut?: string | undefined;
}

/**
 * 一张牌：整张是牌的颜色，中间一只白描边的像素小图，左上角名字、底下一行计分提示。
 * 尺寸由外层 CSS 变量决定：--cw 牌宽。小图有两张：72px 的大图（大牌）和 36px 的小图（mini 小牌、或者外层加了
 * small-cards 时的大牌），都按 1 倍显示，由 CSS 决定显示哪张。
 */
export function CardView({ card, className = "", style, title, onClick, onMouseEnter, onMouseLeave, disabled, badge, tut }: CardViewProps) {
  const label = cardLabel(card);
  const body = (
    <>
      <b className="ss-card-name">{CARD_NAMES[card.type]}</b>
      <img className="big" src={art.card(card.type)} alt="" draggable={false} />
      <img className="sm" src={art.cardSmall(card.type)} alt="" draggable={false} />
      <small className="ss-card-hint">{CARD_HINTS[card.type]}</small>
      {badge && <span className="ss-card-badge">{badge}</span>}
    </>
  );
  const classes = `ss-card t-${card.type} c-${card.color} ${className}`;
  const merged = { ...colorStyle(card.color), ...style };
  const tip = title ?? `${label}　${CARD_HELP[card.type]}`;
  if (onClick) {
    return (
      <button type="button" className={classes} style={merged} title={tip} aria-label={label} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} disabled={disabled} data-tutorial={tut}>
        {body}
      </button>
    );
  }
  return (
    <span className={classes} style={merged} title={tip} aria-label={label} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} data-tutorial={tut}>
      {body}
    </span>
  );
}

/** 牌背：深海蓝底、白色波纹、中间一枚贝壳徽记。 */
export function CardBack({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={`ss-card back ${className}`} style={style} aria-label="牌背">
      <img src={art.emblem} alt="" draggable={false} />
    </span>
  );
}
