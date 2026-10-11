/**
 * 「普通」难度人机：像一个认真玩、会算账的普通玩家。
 *
 * 只吃 redactGameForViewer(game, 自己) 之后的状态：别人的手牌只有张数，弃牌堆只看得到堆顶
 * （打两只蟹选好堆之后才看得到那一整堆），牌堆顺序看不到。看不到的牌一律当作
 * 「整副牌减去我看得到的牌」里随机的一张来估计。
 *
 * - 估值 = 现在的卡牌分 + 一点「潜力」：再拿到某种牌能多得几分 × 这一轮还拿得到的机会。
 * - 拿牌：弃牌堆顶的牌和「摸两张留一张」的期望比，哪个多拿哪个。
 * - 留牌：留估值高的；另一张丢去盖住对别人更有用的那个堆顶。
 * - 对子：手里有就打（鱼 → 蟹 → 鲨鱼泳者 → 船，船最后打，因为它会开始新的回合）。
 * - 宣告：用看得到的信息抽样估计对手的卡牌分，比较 STOP / 最后机会 / 继续 三种结果；
 *   这一轮结算会让有人到目标分时，按谁会赢来定。
 */
import { buildDeck, cardPoints, mermaidCount } from "./cards.js";
import { discardOptions, legalActions, stealTargets } from "./engine.js";
import type { Card, CardType, GameCommand, GameState, Player } from "./types.js";

export interface BotAdvice {
  readonly command: GameCommand;
  /** 一句玩家听得懂的理由（教程「提示」用）。 */
  readonly reason: string;
}

/** 可调参数（模拟脚本用来比较；线上用默认值）。 */
export interface BotParams {
  /** 潜力的权重。 */
  readonly potential: number;
  /** 弃牌堆顶的牌要比摸牌期望至少多这么多才拿。 */
  readonly takeBias: number;
  /** 领先多少分就喊 STOP（牌堆还多时）。 */
  readonly stopMargin: number;
  /** 牌堆快摸完时 STOP 的门槛降到这个。 */
  readonly stopMarginLate: number;
  /** 最后机会至少要有这么大的把握。 */
  readonly lastChanceProb: number;
  /** 估计别人看不到的每张手牌比随机牌多值几分（大家都留好牌）。 */
  readonly handBias: number;
  /** 最后机会后别人那一回合大约能多拿几分。 */
  readonly finalTurnGain: number;
  /** 潜力看几次拿牌的机会（每次看 2 张）；0 表示按牌堆剩多少估计。 */
  readonly horizon: number;
  /** 抽样次数。 */
  readonly samples: number;
}

export const DEFAULT_BOT_PARAMS: BotParams = {
  potential: 0,
  takeBias: -0.3,
  stopMargin: 2,
  stopMarginLate: 0,
  lastChanceProb: 0.75,
  handBias: 0,
  finalTurnGain: 1.5,
  samples: 80,
  horizon: 0,
};

const NAMES: Readonly<Record<CardType, string>> = {
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
const PILE = ["左边", "右边"] as const;
const FULL_DECK = buildDeck();
/** 集齐 4 张美人鱼直接获胜：估值里当作一个很大的数。 */
const MERMAID_WIN = 60;

/** 只依赖局面的小随机数（同一局面同一个决定，便于复现）。 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

interface View {
  readonly state: GameState;
  readonly me: number;
  readonly player: Player;
  /** 我看不到的牌（牌堆、别人的手、弃牌堆里面）。 */
  readonly pool: Card[];
  /** 这一轮我大约还有几次拿牌的机会。 */
  readonly looks: number;
  readonly params: BotParams;
  readonly random: () => number;
}

function makeView(state: GameState, playerId: string, params: BotParams): View | null {
  const me = state.players.findIndex((player) => player.id === playerId);
  if (me === -1) return null;
  const player = state.players[me]!;
  const known = new Set<number>();
  const see = (cards: readonly Card[]) => cards.forEach((card) => known.add(card.id));
  see(player.hand);
  see(state.drawn);
  for (const other of state.players) {
    other.played.forEach(see);
    if (other.revealed) see(other.hand);
  }
  see(state.discards[0]);
  see(state.discards[1]);
  const pool = FULL_DECK.filter((card) => !known.has(card.id));
  const n = state.players.length;
  const looks = state.call ? 0 : params.horizon > 0 ? params.horizon : Math.max(1, Math.min(6, state.deckCount / (2 * n)));
  const random = seededRandom(hash(playerId) ^ Math.imul(state.version + 1, 2654435761) ^ state.round);
  return { state, me, player, pool, looks, params, random };
}

/** 手里 + 面前这些牌值多少：卡牌分 + 潜力。 */
function value(view: View, hand: readonly Card[], played: readonly (readonly Card[])[]): number {
  const base = cardPoints(hand, played).total;
  const mermaids = mermaidCount(hand, played);
  if (mermaids >= 4) return base + MERMAID_WIN;
  if (view.looks <= 0 || view.params.potential <= 0) return base;
  // 潜力：每一种牌，再来一张能多几分 × 这一轮还摸得到它的概率。
  const poolSize = view.pool.length || 1;
  let potential = 0;
  const seen = new Set<CardType>();
  for (const card of view.pool) {
    if (seen.has(card.type)) continue;
    seen.add(card.type);
    const remaining = view.pool.reduce((count, each) => count + (each.type === card.type ? 1 : 0), 0);
    const plus = [...hand, card];
    let gain = cardPoints(plus, played).total - base;
    if (card.type === "mermaid" && mermaids === 3) gain += MERMAID_WIN;
    if (gain <= 0) continue;
    const chance = 1 - Math.pow(1 - remaining / poolSize, view.looks * 2);
    potential += gain * chance;
  }
  return base + view.params.potential * potential;
}

/** 多拿这些牌，估值涨多少。 */
function gainOf(view: View, extra: readonly Card[]): number {
  const { hand, played } = view.player;
  return value(view, [...hand, ...extra], played) - value(view, hand, played);
}

/** 从看不到的牌里摸 k 张、留最好的一张，平均能涨多少。 */
function expectedBestOf(view: View, k: number): number {
  if (k <= 0 || view.pool.length === 0) return 0;
  // 同一种（种类 + 颜色）的牌涨幅一样，先算好。
  const byKey = new Map<string, number>();
  const gains = view.pool.map((card) => {
    const key = `${card.type}:${card.color}`;
    let gain = byKey.get(key);
    if (gain === undefined) {
      gain = gainOf(view, [card]);
      byKey.set(key, gain);
    }
    return gain;
  });
  if (k === 1) return gains.reduce((sum, gain) => sum + gain, 0) / gains.length;
  const trials = 40;
  let total = 0;
  for (let t = 0; t < trials; t += 1) {
    let best = -Infinity;
    for (let j = 0; j < k; j += 1) best = Math.max(best, gains[Math.floor(view.random() * gains.length)]!);
    total += best;
  }
  return total / trials;
}

/** 给别人看的一张牌大致值多少（丢牌时决定盖住哪一堆）。 */
function genericValue(card: Card | undefined): number {
  if (!card) return 0;
  switch (card.type) {
    case "mermaid":
      return 5;
    case "lighthouse":
    case "shoal":
    case "colony":
    case "captain":
      return 2.5;
    case "octopus":
    case "shell":
    case "penguin":
    case "sailor":
      return 2;
    default:
      return 1.5;
  }
}

const top = (pile: readonly Card[]): Card | undefined => pile[pile.length - 1];
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

// ---------------- 宣告 ----------------

interface Outcome {
  /** 这一轮每个人的得分（按座位）。 */
  readonly scores: number[];
}

interface DeclareEstimate {
  readonly myPoints: number;
  readonly myBonus: number;
  /** 对手卡牌分的平均估计（按座位，自己是 0）。 */
  readonly oppMean: number[];
  readonly stop: number;
  readonly lastChance: number;
  readonly lastChanceWin: number;
  readonly cont: number;
  /** STOP 后游戏结束且我赢的概率（不结束则为 null）。 */
  readonly stopWins: number | null;
}

/** 一种结算结果对我值多少：游戏结束按胜负算，否则按和对手的分差。 */
function utility(view: View, scores: readonly number[]): number {
  const { state, me } = view;
  const totals = state.players.map((player, index) => player.score + scores[index]!);
  const best = Math.max(...totals);
  if (best >= state.config.targetScore) {
    const top = totals.map((total, index) => ({ total, last: scores[index]!, index })).filter((row) => row.total === best);
    const lastBest = Math.max(...top.map((row) => row.last));
    const winners = top.filter((row) => row.last === lastBest).map((row) => row.index);
    return winners.includes(me) ? 100 / winners.length : -100;
  }
  return relative(view, totals);
}

/** 我和对手的分差：两人局就是分差；多人局一半比平均、一半比最强的。 */
function relative(view: View, totals: readonly number[]): number {
  const others = totals.filter((_, index) => index !== view.me);
  const mean = others.reduce((sum, total) => sum + total, 0) / others.length;
  const max = Math.max(...others);
  return totals[view.me]! - (0.5 * mean + 0.5 * max);
}

function estimateDeclare(view: View): DeclareEstimate {
  const { state, me, player, params } = view;
  const mine = cardPoints(player.hand, player.played);
  const n = state.players.length;
  const oppSum = new Array<number>(n).fill(0);
  let stop = 0;
  let lastChance = 0;
  let lastChanceWin = 0;
  let stopEnds = 0;
  let stopWin = 0;
  const samples = params.samples;
  for (let s = 0; s < samples; s += 1) {
    const pool = shuffled(view.pool, view.random);
    let at = 0;
    const points: number[] = [];
    const bonus: number[] = [];
    state.players.forEach((other, index) => {
      if (index === me) {
        points.push(mine.total);
        bonus.push(mine.colorBonus);
        return;
      }
      const hidden = other.revealed ? 0 : other.handCount;
      const hand = other.revealed ? other.hand : pool.slice(at, at + hidden);
      at += hidden;
      const p = cardPoints(hand, other.played);
      points.push(p.total + hidden * params.handBias);
      bonus.push(p.colorBonus);
      oppSum[index]! += p.total + hidden * params.handBias;
    });
    // STOP：每人拿卡牌分。
    const stopScores = points.map((p) => Math.round(p));
    const u = utility(view, stopScores);
    stop += u;
    if (Math.abs(u) >= 50) {
      stopEnds += 1;
      if (u > 0) stopWin += 1;
    }
    // 最后机会：别人各再打一回合；我最高（并列也算）就拿卡牌分 + 颜色奖励，别人只拿颜色奖励。
    const after = points.map((p, index) => (index === me ? p : p + params.finalTurnGain));
    const win = after.every((p, index) => index === me || mine.total >= p);
    if (win) lastChanceWin += 1;
    const lcScores = after.map((p, index) =>
      index === me ? (win ? mine.total + mine.colorBonus : mine.colorBonus) : win ? bonus[index]! : Math.round(p),
    );
    lastChance += utility(view, lcScores);
  }
  stop /= samples;
  lastChance /= samples;
  const oppMean = oppSum.map((sum) => sum / samples);
  // 继续：先不结算，分差照旧；领先不到 margin 分就不急着喊（大家都还在涨，喊早了得分少）。
  const nowTotals = state.players.map((other) => other.score);
  const late = state.deckCount <= 4 * n;
  const margin = late ? params.stopMarginLate : params.stopMargin;
  const cont = relative(view, nowTotals) + margin;
  return {
    myPoints: mine.total,
    myBonus: mine.colorBonus,
    oppMean,
    stop,
    lastChance,
    lastChanceWin: lastChanceWin / samples,
    cont,
    stopWins: stopEnds > samples / 2 ? stopWin / stopEnds : null,
  };
}

function relativeMean(view: View, oppMean: readonly number[]): number {
  const others = oppMean.filter((_, index) => index !== view.me);
  const mean = others.reduce((sum, p) => sum + p, 0) / others.length;
  return 0.5 * mean + 0.5 * Math.max(...others);
}

// ---------------- 各个决定 ----------------

function decideDraw(view: View, actions: readonly GameCommand[]): BotAdvice {
  const { state } = view;
  let best: BotAdvice | null = null;
  let bestScore = -Infinity;
  const deckOk = actions.some((action) => action.type === "DRAW_DECK");
  const deckGain = deckOk ? expectedBestOf(view, state.deckCount >= 2 ? 2 : 1) : -Infinity;
  for (const pile of [0, 1] as const) {
    const card = top(state.discards[pile]);
    if (!card || state.discardCounts[pile] === 0) continue;
    const gain = gainOf(view, [card]) - view.params.takeBias;
    if (gain > bestScore) {
      bestScore = gain;
      best = {
        command: { type: "TAKE_DISCARD", pile },
        reason: gain >= 0.95 ? `拿${PILE[pile]}弃牌堆的${NAMES[card.type]}：马上多 ${fmt(gain)} 分左右，比摸牌稳。` : `拿${PILE[pile]}弃牌堆的${NAMES[card.type]}：比摸两张碰运气划算。`,
      };
    }
  }
  if (deckOk && (best === null || deckGain > bestScore)) {
    return { command: { type: "DRAW_DECK" }, reason: best ? "弃牌堆顶的牌用处不大，摸两张挑一张更好。" : "摸两张，挑一张留下。" };
  }
  return best ?? { command: actions[0]!, reason: "拿牌。" };
}

function decideKeep(view: View): BotAdvice {
  const { state } = view;
  const [a, b] = state.drawn;
  if (!a || !b) {
    const card = a!;
    return { command: { type: "KEEP", card: card.id, pile: discardOptions(state)[0]! }, reason: "只摸到一张，留下。" };
  }
  const ga = gainOf(view, [a]);
  const gb = gainOf(view, [b]);
  const [keep, toss, gain] = ga >= gb ? [a, b, ga] : [b, a, gb];
  const options = discardOptions(state);
  let pile = options[0]!;
  if (options.length === 2) {
    // 两堆都能丢：盖住对别人更有用的那张堆顶。
    pile = genericValue(top(state.discards[1])) > genericValue(top(state.discards[0])) ? 1 : 0;
  }
  const why = gain >= 0.95 ? `留下${NAMES[keep.type]}（多 ${fmt(gain)} 分左右）` : `留下${NAMES[keep.type]}（以后更有用）`;
  const where = options.length === 2 ? `，${NAMES[toss.type]}丢到${PILE[pile]}，盖住那边的${NAMES[top(state.discards[pile])?.type ?? toss.type]}。` : `，${NAMES[toss.type]}只能丢进空的${PILE[pile]}弃牌堆。`;
  return { command: { type: "KEEP", card: keep.id, pile }, reason: why + where };
}

const PAIR_ORDER = ["fish", "crab", "steal", "boat"] as const;
const PAIR_REASON: Record<(typeof PAIR_ORDER)[number], string> = {
  fish: "打出两条鱼：再从牌堆摸一张，对子分也照算。",
  crab: "打出两只蟹：从弃牌堆里挑一张想要的。",
  steal: "打出鲨鱼 + 泳者：从对手手里偷一张。",
  boat: "打出两艘船：马上再来一回合。",
};

function decidePlay(view: View, actions: readonly GameCommand[]): BotAdvice {
  const { state, player } = view;
  // 1. 先打对子（打出的对子照样算分，还有效果，也不会被偷）。
  const pairs = actions.filter((action): action is Extract<GameCommand, { type: "PLAY_PAIR" }> => action.type === "PLAY_PAIR");
  const typeOf = (id: number) => player.hand.find((card) => card.id === id)!.type;
  const effectOf = (action: Extract<GameCommand, { type: "PLAY_PAIR" }>) => {
    const t = typeOf(action.cards[0]);
    return t === "shark" || t === "swimmer" ? "steal" : (t as "fish" | "crab" | "boat");
  };
  for (const effect of PAIR_ORDER) {
    const action = pairs.find((candidate) => effectOf(candidate) === effect);
    if (!action) continue;
    if (effect === "crab" && state.discardCounts[0] + state.discardCounts[1] === 0) continue;
    if (effect === "fish" && state.deckCount === 0) continue;
    if (effect === "steal" && stealTargets(state, view.me).length === 0) continue;
    if (effect === "boat" && state.deckCount + state.discardCounts[0] + state.discardCounts[1] === 0) continue;
    // 船会开始新的回合：想喊停的话先喊（不然下一回合再喊也一样，多拿一张更好）。
    return { command: action, reason: PAIR_REASON[effect] };
  }
  // 2. 宣告还是结束回合。
  const canStop = actions.some((action) => action.type === "STOP");
  if (canStop) {
    const est = estimateDeclare(view);
    const opp = Math.round(relativeMean(view, est.oppMean));
    if (est.lastChance > est.stop && est.lastChance > est.cont && est.lastChanceWin >= view.params.lastChanceProb) {
      return {
        command: { type: "LAST_CHANCE" },
        reason: `我有 ${est.myPoints} 分，估计对手只有 ${opp} 分左右，赌「最后机会」：赢了还多拿颜色奖励 ${est.myBonus} 分。`,
      };
    }
    if (est.stop >= est.cont || (est.stopWins !== null && est.stopWins >= 0.6)) {
      return {
        command: { type: "STOP" },
        reason: est.stopWins !== null && est.stopWins >= 0.6 ? `我有 ${est.myPoints} 分，现在喊 STOP 能到目标分拿下这局。` : `我有 ${est.myPoints} 分，估计对手 ${opp} 分左右，现在喊 STOP 最划算。`,
      };
    }
    return {
      command: { type: "END_TURN" },
      reason: `我有 ${est.myPoints} 分，估计对手 ${opp} 分左右，领先还不够多，先不喊，继续攒牌。`,
    };
  }
  const points = cardPoints(player.hand, player.played).total;
  if (pairs.length > 0) {
    // 剩下的对子效果用不了（比如牌堆空了），留在手里照样算分。
    return { command: { type: "END_TURN" }, reason: "对子效果现在用不了，留在手里照样算分，结束回合。" };
  }
  if (state.call) return { command: { type: "END_TURN" }, reason: `最后一回合打完了，我有 ${points} 分。` };
  return {
    command: { type: "END_TURN" },
    reason: points < state.config.declareAt ? `才 ${points} 分，到 ${state.config.declareAt} 分才能喊停，结束回合。` : "结束回合。",
  };
}

function decideCrabPile(view: View, actions: readonly GameCommand[]): BotAdvice {
  const { state } = view;
  let best = actions[0]!;
  let bestScore = -Infinity;
  for (const action of actions) {
    if (action.type !== "CRAB_PILE") continue;
    const pile = action.pile;
    const topGain = gainOf(view, [top(state.discards[pile])!].filter(Boolean));
    const deeper = expectedBestOf(view, state.discardCounts[pile] - 1);
    const score = Math.max(topGain, deeper);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  const pile = best.type === "CRAB_PILE" ? best.pile : 0;
  return { command: best, reason: `翻${PILE[pile]}弃牌堆（${state.discardCounts[pile]} 张），里面挑到好牌的机会更大。` };
}

function decideCrabPick(view: View, actions: readonly GameCommand[]): BotAdvice {
  const { state } = view;
  const pile = state.discards[state.crabPile as 0 | 1];
  let best = actions[0]!;
  let bestGain = -Infinity;
  let bestCard: Card | undefined;
  for (const action of actions) {
    if (action.type !== "CRAB_TAKE") continue;
    const card = pile.find((each) => each.id === action.card);
    if (!card) continue;
    const gain = gainOf(view, [card]);
    if (gain > bestGain) {
      bestGain = gain;
      best = action;
      bestCard = card;
    }
  }
  return { command: best, reason: bestCard ? `从这堆里挑${NAMES[bestCard.type]}，对我最有用。` : "挑一张。" };
}

function decideSteal(view: View, actions: readonly GameCommand[]): BotAdvice {
  const { state } = view;
  let best = actions[0]!;
  let bestScore = -Infinity;
  for (const action of actions) {
    if (action.type !== "STEAL") continue;
    const target = state.players.find((player) => player.id === action.target)!;
    // 手牌多的偷到好牌的机会大；总分领先的顺便压一压。
    const score = target.handCount + 0.15 * target.score;
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  const target = state.players.find((player) => best.type === "STEAL" && player.id === best.target);
  return { command: best, reason: target ? `偷${target.name}的：他手牌最多（${target.handCount} 张）。` : "偷一张。" };
}

/**
 * 人机替 playerId 做的决定和理由；不用他做决定时返回 null。
 * state 必须是 redactGameForViewer(game, playerId) 之后的状态。
 */
export function botAdvice(state: GameState, playerId: string, params: BotParams = DEFAULT_BOT_PARAMS): BotAdvice | null {
  const actions = legalActions(state, playerId);
  if (actions.length === 0) return null;
  if (state.stage === "roundEnd") return { command: { type: "READY" }, reason: "看完结算，下一轮。" };
  const view = makeView(state, playerId, params);
  if (!view) return null;
  switch (state.stage) {
    case "draw":
      return decideDraw(view, actions);
    case "keep":
      return decideKeep(view);
    case "play":
      return decidePlay(view, actions);
    case "crabPile":
      return decideCrabPile(view, actions);
    case "crabPick":
      return decideCrabPick(view, actions);
    case "steal":
      return decideSteal(view, actions);
    default:
      return { command: actions[0]!, reason: "" };
  }
}

/** 人机替 playerId 做的决定；不用他做决定时返回 null。state 必须是他视角的状态。 */
export function botCommand(state: GameState, playerId: string, params: BotParams = DEFAULT_BOT_PARAMS): GameCommand | null {
  return botAdvice(state, playerId, params)?.command ?? null;
}
