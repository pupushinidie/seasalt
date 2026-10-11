/**
 * 新手教程的剧本（海盐与纸）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器。两人局：你和咕噜一号，从一局的中间（第 4 轮、轮到你）开始。
 * 手牌、两个弃牌堆、牌堆顶都按剧本摆好；唯一用到随机的是鲨鱼 + 泳者偷牌，
 * createTutorialGame 先看好随机数会抽第几张，把美人鱼放在那个位置，所以「偷到美人鱼」一定发生。
 *
 * 剧情：摸两张留一张 → 打两只蟹翻弃牌堆挑一艘船 → 打两艘船再来一回合 → 拿弃牌堆顶的泳者 →
 * 鲨鱼 + 泳者偷到美人鱼 → 讲 STOP 和最后机会、颜色奖励 → 你喊最后机会 → 咕噜一号最后一回合（打两条鱼摸一张）→
 * 你最高，拿卡牌分 + 颜色奖励冲过 40 分赢下。剧本走完接一局练习：新开两人局，对手交给人机。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，tutorial.test.ts 会检查剧本还能不能从头走到尾。
 */
import { buildDeck, cardKey } from "./cards.js";
import { apply, canDeclare, createGame, discardOptions, playablePairs as pairsIn } from "./engine.js";
import { createRng } from "./rng.js";
import type { Card, GameCommand, GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px）。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值（见 anchorVisible）。
   */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手按剧本自动走这几步（谁走由局面决定），牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly GameCommand[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_RIVALS = [{ id: "p2", name: "咕噜一号" }] as const;
const ONE = "p2";

// ---------- 剧本里的牌（id 按整副牌的顺序取，每张只取一次） ----------
const DECK = buildDeck();
const used = new Set<number>();
function pick(key: string): Card {
  const card = DECK.find((each) => !used.has(each.id) && (cardKey(each) === key || each.type === key));
  if (!card) throw new Error(`剧本里没有 ${key} 了`);
  used.add(card.id);
  return card;
}

const C = {
  // 你的手牌
  crabA: pick("crab:darkBlue"),
  crabB: pick("crab:lightBlue"),
  boatA: pick("boat:darkBlue"),
  shark: pick("shark:darkBlue"),
  octopusA: pick("octopus:lightBlue"),
  lighthouse: pick("lighthouse:purple"),
  // 咕噜一号的手牌（美人鱼的位置开局时按随机数放）
  shellA: pick("shell:black"),
  shellB: pick("shell:gray"),
  penguin: pick("penguin:purple"),
  fishA: pick("fish:black"),
  mermaid: pick("mermaid"),
  // 左边弃牌堆（从下到上）
  boatB: pick("boat:lightBlue"),
  sailor: pick("sailor:pink"),
  shellC: pick("shell:yellow"),
  penguinB: pick("penguin:pink"),
  // 右边弃牌堆
  shellD: pick("shell:lightBlue"),
  swimmer: pick("swimmer:darkBlue"),
  // 牌堆顶（第一个最先摸到）
  octopusB: pick("octopus:yellow"),
  fishB: pick("fish:darkBlue"),
  crabC: pick("crab:yellow"),
} as const;

/** 剧本里的牌 id（网页和单测用）。 */
export const TUTORIAL_CARDS: Readonly<Record<keyof typeof C, number>> = Object.fromEntries(
  Object.entries(C).map(([name, card]) => [name, card.id]),
) as Record<keyof typeof C, number>;

/** 剧本开局时的总分（你、咕噜一号）和轮次。 */
export const TUTORIAL_SCORES = [26, 33] as const;
export const TUTORIAL_ROUND = 4;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    kind: "info", id: "goal", lesson: "目标", anchor: "goal",
    say: "海盐与纸比的是谁先攒到 40 分。",
    note: "一局打好几轮，每轮攒牌得分。我们从一局中间开始：你 26 分，咕噜一号 33 分。",
  },
  {
    kind: "info", id: "hand", lesson: "手牌和卡牌分", anchor: "hand",
    say: "这是你的手牌，每张牌下面一行小字写着它怎么得分。",
    note: "手牌和面前打出的牌加起来，就是你这一轮的「卡牌分」。",
  },
  {
    kind: "info", id: "take", lesson: "拿牌", anchor: "piles",
    say: "每回合先拿牌：从牌堆摸两张，或者拿一个弃牌堆顶上的牌。",
    note: "弃牌堆只能拿最上面那张。",
  },
  { kind: "do", id: "draw", anchor: "draw", expect: { type: "DRAW_DECK" }, say: "这次点「摸两张」。" },
  {
    kind: "do", id: "keep", anchor: `keep:${C.octopusB.id}`, expect: { type: "KEEP", card: C.octopusB.id, pile: 0 },
    say: "留下章鱼，鱼丢到左边的弃牌堆。",
    note: "摸两张只能留一张，另一张必须丢到一个弃牌堆顶上；有空的弃牌堆时，必须丢进空的那个。",
  },
  {
    kind: "info", id: "points", anchor: "my-points",
    say: "两张章鱼 3 分，卡牌分涨了。",
    note: "收集牌按张数算分；灯塔这种乘数牌，每有一张对应的牌就加分（灯塔：每艘船 +1）。",
  },
  {
    kind: "do", id: "crab", lesson: "对子和效果", anchor: "pair:crab", expect: { type: "PLAY_PAIR", cards: [C.crabA.id, C.crabB.id] },
    say: "两只蟹是一对：打出来，能从弃牌堆里挑一张。",
    note: "每一对 1 分，手里的和打出的都算；打出来才有效果，还不会被偷。",
  },
  {
    kind: "do", id: "crabPile", anchor: "crab-pile:0", expect: { type: "CRAB_PILE", pile: 0 },
    say: "翻开左边的弃牌堆。",
    note: "打蟹的人能看到整堆，别人只看得到堆顶。",
  },
  {
    kind: "do", id: "crabTake", anchor: `crab-card:${C.boatB.id}`, expect: { type: "CRAB_TAKE", card: C.boatB.id },
    say: "挑那艘船：你手里正好有一艘。",
  },
  {
    kind: "do", id: "boat", anchor: "pair:boat", expect: { type: "PLAY_PAIR", cards: [C.boatA.id, C.boatB.id] },
    say: "两艘船：打出来马上再来一回合。",
    note: "灯塔数的船也包括面前打出的，所以照样每艘 +1。",
  },
  {
    kind: "do", id: "takeSwimmer", anchor: "take:1", expect: { type: "TAKE_DISCARD", pile: 1 },
    say: "新的一回合：拿右边弃牌堆顶上的泳者。",
    note: "拿了弃牌堆的牌，这回合就不摸牌堆了。",
  },
  {
    kind: "do", id: "steal", anchor: "pair:steal", expect: { type: "PLAY_PAIR", cards: [C.shark.id, C.swimmer.id] },
    say: "鲨鱼配泳者也是一对：打出来，从对手手里随机偷一张。",
    note: "三人以上时自己选偷谁；两人局直接偷咕噜一号。",
  },
  {
    kind: "info", id: "mermaid", lesson: "美人鱼", anchor: "hand", face: "surprised",
    say: "偷到一张美人鱼！",
    note: "第 1 张美人鱼得你最多的那种颜色的张数，第 2 张得第二多的……集齐 4 张美人鱼直接赢下整局。",
  },
  {
    kind: "info", id: "declare", lesson: "STOP 和最后机会", anchor: "declare",
    say: "卡牌分到 7，回合最后就能宣告结束这一轮。",
    note: "「STOP」：这一轮马上结束，每人拿自己的卡牌分。也可以不宣告，点「结束回合」接着攒。",
  },
  {
    kind: "info", id: "lastChance", anchor: "last-chance", face: "think",
    say: "「最后机会」是赌一把：对手各再打一回合。",
    note: "之后你的卡牌分最高（平分也算）：你拿卡牌分 + 颜色奖励，对手只拿颜色奖励；赌输了：你只拿颜色奖励，对手拿卡牌分。",
  },
  {
    kind: "info", id: "colorBonus", anchor: "color-bonus",
    say: "颜色奖励 = 你最多的那种颜色有几张。",
    note: "手牌和打出的都算，你深蓝色有 4 张，奖励 4 分。只有「最后机会」才算颜色奖励。",
  },
  {
    kind: "do", id: "callLast", anchor: "last-chance", expect: { type: "LAST_CHANCE" },
    say: "你 12 分，咕噜一号手里没剩几张好牌：喊「最后机会」！",
    note: "宣告之后你的手牌亮出来，不会再被偷。",
  },
  {
    kind: "watch", id: "rivalFinal",
    say: "咕噜一号打最后一回合：拿弃牌堆的鱼，打出两条鱼再摸一张。",
    moves: [
      { type: "TAKE_DISCARD", pile: 0 },
      { type: "PLAY_PAIR", cards: [C.fishA.id, C.fishB.id] },
      { type: "END_TURN" },
    ],
  },
  {
    kind: "info", id: "result", lesson: "结算和终局", anchor: "standings", face: "happy",
    say: "你最高，赌赢了：12 + 4 = 16 分，冲过 40 分！",
    note: "咕噜一号只拿颜色奖励 2 分。有人总分到 40，这一轮打完就结束，总分最高的人赢（平分比最后一轮的得分）。",
  },
  {
    kind: "info", id: "emptyDeck", anchor: "standings",
    say: "还有一条：牌堆摸完了还没人宣告，这一轮作废，谁都不得分。",
    note: "所以分数差不多够了就别拖太久。",
  },
  {
    kind: "info", id: "end", finale: true, face: "happy",
    say: "学会了！和人机练一局吧。",
    note: "拿不准就点「提示」（键盘 T）。真实对局里连续两次超时或掉线，会由人机替你打（托管），点「取消托管」就拿回来。",
  },
];

const players = (selfName: string) => [{ id: TUTORIAL_SELF, name: selfName }, ...TUTORIAL_RIVALS];

/** 教程开局：两人局第 4 轮的中间，轮到你拿牌。 */
export function createTutorialGame(selfName: string, seed = 20261011): GameState {
  const game = createGame(players(selfName), seed, {}, { starter: 0 });
  const [me, one] = game.players as [GameState["players"][number], GameState["players"][number]];
  // 偷牌时随机抽第几张：先看好，把美人鱼放在那里。
  const stolenAt = createRng(game.rng ?? 1).int(5);
  const rivalHand = [C.shellA, C.shellB, C.penguin, C.fishA];
  rivalHand.splice(stolenAt, 0, C.mermaid);
  me.hand = [C.crabA, C.crabB, C.boatA, C.shark, C.octopusA, C.lighthouse];
  one.hand = rivalHand;
  for (const [player, score] of [[me, TUTORIAL_SCORES[0]], [one, TUTORIAL_SCORES[1]]] as const) {
    player.played = [];
    player.revealed = false;
    player.score = score;
    player.rounds = [9, 8, score - 17];
    player.handCount = player.hand.length;
  }
  game.discards = [[C.boatB, C.sailor, C.shellC, C.penguinB], [C.shellD, C.swimmer]];
  const top = [C.octopusB, C.fishB, C.crabC];
  const rest = (game.deck ?? []).filter((card) => !used.has(card.id));
  game.deck = [...rest, ...top.reverse()];
  game.deckCount = game.deck.length;
  game.discardCounts = [game.discards[0].length, game.discards[1].length];
  game.round = TUTORIAL_ROUND;
  game.starter = 1;
  game.lastEnder = 0;
  game.actor = 0;
  game.stage = "draw";
  game.drawn = [];
  game.drawnCount = 0;
  game.events = [{ type: "TurnStarted", player: TUTORIAL_SELF }];
  game.history = [...game.events];
  return game;
}

/** 练习局：新开一局两人局（随机）。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame(players(selfName), seed);
}

/**
 * 教程里走一步：结算画面上你点「下一轮」时，咕噜们先跟着点（人机总是马上准备好），
 * 所以下一轮立刻开始。其他命令照常交给引擎。
 */
export function tutorialApply(state: GameState, playerId: string, command: GameCommand): GameState {
  let game = state;
  if (command.type === "READY" && game.stage === "roundEnd") {
    for (const player of game.players) {
      if (player.id !== playerId && !game.ready.includes(player.id)) game = apply(game, player.id, { type: "READY" }).state;
    }
  }
  return apply(game, playerId, command).state;
}

/** 现在等谁做决定：结算画面等你点「下一轮」；对局结束返回 null。 */
export function tutorialActor(state: GameState, self: string = TUTORIAL_SELF): string | null {
  if (state.phase !== "playing") return null;
  if (state.stage === "roundEnd") return state.ready.includes(self) ? null : self;
  return state.players[state.actor]?.id ?? null;
}

/** 两条命令是不是同一步（打对子不管两张牌的先后）。 */
export function sameCommand(a: GameCommand, b: GameCommand): boolean {
  if (a.type === "PLAY_PAIR" && b.type === "PLAY_PAIR") return [...a.cards].sort().join() === [...b.cards].sort().join();
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 打出这一对是什么效果。 */
function effectOf(pair: readonly [Card, Card]): string {
  const type = pair[0].type;
  return type === "shark" || type === "swimmer" ? "steal" : type;
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard 的显示条件）。
 * viewer 是看界面的人（教程里就是你）。
 * 固定的：goal、hand、my-points、color-bonus、piles、draw、declare、stop、last-chance、end-turn、summary、ready、standings、hint；
 * 带参数的：take:<堆>、keep:<牌 id>、pair:<crab|boat|fish|steal>、crab-pile:<堆>、crab-card:<牌 id>、seat:<玩家 id>、final:<玩家 id>。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const me = state.players.findIndex((player) => player.id === viewer);
  const playing = state.phase === "playing";
  const myMove = playing && state.actor === me && me !== -1;
  const [name, arg] = anchor.split(":") as [string, string | undefined];
  const num = arg === undefined ? NaN : Number(arg);
  switch (name) {
    case "goal":
    case "piles":
      return true;
    case "hand":
    case "my-points":
    case "color-bonus":
      return me !== -1;
    case "draw":
      return myMove && state.stage === "draw" && state.deckCount > 0;
    case "take":
      return myMove && state.stage === "draw" && (state.discardCounts[num as 0 | 1] ?? 0) > 0;
    case "keep":
      return myMove && state.stage === "keep" && discardOptions(state).length > 1 && state.drawn.some((card) => card.id === num);
    case "pair":
      return myMove && state.stage === "play" && pairsIn(state.players[me]!.hand).some((pair) => effectOf(pair) === arg);
    case "declare":
    case "stop":
    case "last-chance":
      return myMove && canDeclare(state, me);
    case "end-turn":
      return myMove && state.stage === "play";
    case "crab-pile":
      return myMove && state.stage === "crabPile" && (state.discardCounts[num as 0 | 1] ?? 0) > 0;
    case "crab-card":
      return myMove && state.stage === "crabPick" && state.crabPile !== null && state.discards[state.crabPile as 0 | 1].some((card) => card.id === num);
    case "summary":
      return playing && state.stage === "roundEnd";
    case "ready":
      return playing && state.stage === "roundEnd" && !state.ready.includes(viewer);
    case "standings":
      return state.phase === "finished";
    case "final":
      return state.phase === "finished" && state.players.some((player) => player.id === arg);
    case "seat":
      return state.players.some((player) => player.id === arg && player.id !== viewer);
    default:
      return false;
  }
}

export { ONE as TUTORIAL_RIVAL };
