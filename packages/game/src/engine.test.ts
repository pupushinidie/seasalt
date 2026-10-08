import { describe, expect, it } from "vitest";
import { buildDeck, cardKey, cardPoints, CARD_TYPES, COLORS } from "./cards.js";
import {
  applyCommand,
  canDeclare,
  createGame,
  defaultTarget,
  legalActions,
  pointsOf,
  redactGameForViewer,
  stealTargets,
  timeoutTurn,
} from "./engine.js";
import { createRng } from "./rng.js";
import type { Card, CardColor, GameCommand, GameState } from "./types.js";

const names = ["甲", "乙", "丙", "丁"];
const newGame = (count = 2, seed = 7, starter = 0) =>
  createGame(names.slice(0, count).map((name, index) => ({ id: `p${index + 1}`, name })), seed, {}, { starter });

/** 从整副牌里按 type 或 type:color 取牌（每张只能取一次）。 */
function pool() {
  const cards = buildDeck();
  return (key: string): Card => {
    const at = cards.findIndex((card) => cardKey(card) === key || card.type === key);
    if (at === -1) throw new Error(`没有 ${key} 了`);
    return cards.splice(at, 1)[0]!;
  };
}

const cards = (...keys: string[]) => {
  const take = pool();
  return keys.map(take);
};

interface Layout {
  hands?: string[][];
  played?: string[][][];
  piles?: [string[], string[]];
  /** 牌堆顶，第一个最先摸到。 */
  top?: string[];
  /** 牌堆里剩几张（多出来的牌不放进牌堆）；默认全放。 */
  deckSize?: number;
  actor?: number;
  stage?: GameState["stage"];
}

/** 把一局摆成指定的样子（手牌、面前、弃牌堆、牌堆顶），其余牌放进牌堆。 */
function arrange(state: GameState, layout: Layout): GameState {
  const remaining = buildDeck();
  const take = (key: string): Card => {
    const at = remaining.findIndex((card) => cardKey(card) === key || card.type === key);
    if (at === -1) throw new Error(`没有 ${key} 了`);
    return remaining.splice(at, 1)[0]!;
  };
  state.players.forEach((player, index) => {
    player.hand = (layout.hands?.[index] ?? []).map(take);
    player.played = (layout.played?.[index] ?? []).map((pair) => pair.map(take));
    player.revealed = false;
  });
  state.discards = [(layout.piles?.[0] ?? []).map(take), (layout.piles?.[1] ?? []).map(take)];
  const top = (layout.top ?? []).map(take);
  const rest = layout.deckSize === undefined ? remaining : remaining.slice(0, Math.max(0, layout.deckSize - top.length));
  state.deck = [...rest, ...top.reverse()];
  if (layout.actor !== undefined) state.actor = layout.actor;
  if (layout.stage) state.stage = layout.stage;
  state.drawn = [];
  state.crabPile = null;
  refresh(state);
  return state;
}

function refresh(state: GameState): void {
  state.deckCount = state.deck!.length;
  state.discardCounts = [state.discards[0].length, state.discards[1].length];
  state.drawnCount = state.drawn.length;
  for (const player of state.players) player.handCount = player.hand.length;
}

const play = (state: GameState, player: string, command: GameCommand) => applyCommand(state, player, command);
const idsOf = (state: GameState, player: number, type: string) => state.players[player]!.hand.filter((card) => card.type === type).map((card) => card.id);
const pair = (state: GameState, player: number, a: string, b = a): GameCommand => {
  const first = idsOf(state, player, a)[0]!;
  const second = idsOf(state, player, b).find((id) => id !== first)!;
  return { type: "PLAY_PAIR", cards: [first, second] };
};

describe("牌", () => {
  it("58 张，各种牌和颜色的张数和官方牌表一致", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(58);
    expect(new Set(deck.map((card) => card.id)).size).toBe(58);
    const byType = Object.fromEntries(CARD_TYPES.map((type) => [type, deck.filter((card) => card.type === type).length]));
    expect(byType).toEqual({
      crab: 9, boat: 8, fish: 7, shark: 5, swimmer: 5,
      shell: 6, octopus: 5, penguin: 3, sailor: 2,
      lighthouse: 1, shoal: 1, colony: 1, captain: 1, mermaid: 4,
    });
    const byColor = Object.fromEntries(COLORS.map((color) => [color, deck.filter((card) => card.color === color).length]));
    expect(byColor).toEqual({
      darkBlue: 9, lightBlue: 9, black: 8, yellow: 8, green: 6, white: 4,
      purple: 4, gray: 4, lightOrange: 3, pink: 2, orange: 1,
    });
    // 白色就是 4 张美人鱼。
    expect(deck.filter((card) => card.color === "white").every((card) => card.type === "mermaid")).toBe(true);
  });
});

describe("计分", () => {
  const score = (hand: string[], played: string[][] = []) => {
    const take = pool();
    return cardPoints(hand.map(take), played.map((p) => p.map(take)));
  };

  it("对子：两张同名 1 分，四张 2 分；鲨鱼要配泳者", () => {
    expect(score(["crab", "crab"]).pairs).toBe(1);
    expect(score(["crab", "crab", "crab"]).pairs).toBe(1);
    expect(score(["crab", "crab", "crab", "crab"]).pairs).toBe(2);
    expect(score(["shark", "shark", "swimmer"]).pairs).toBe(1);
    expect(score(["shark", "shark", "swimmer", "swimmer"]).pairs).toBe(2);
    expect(score(["shark", "shark"]).pairs).toBe(0);
    expect(score(["boat", "fish"]).pairs).toBe(0);
    // 打出的对子和手里的对子都算。
    expect(score(["fish", "fish"], [["boat", "boat"], ["crab", "crab"]]).pairs).toBe(3);
  });

  it("收集牌：贝壳 0/2/4/6/8/10，章鱼 0/3/6/9/12，企鹅 1/3/5，水手 0/5", () => {
    const shells = [0, 2, 4, 6, 8, 10];
    for (let n = 1; n <= 6; n += 1) expect(score(Array(n).fill("shell")).collectors).toBe(shells[n - 1]);
    const octopus = [0, 3, 6, 9, 12];
    for (let n = 1; n <= 5; n += 1) expect(score(Array(n).fill("octopus")).collectors).toBe(octopus[n - 1]);
    expect([1, 2, 3].map((n) => score(Array(n).fill("penguin")).collectors)).toEqual([1, 3, 5]);
    expect([1, 2].map((n) => score(Array(n).fill("sailor")).collectors)).toEqual([0, 5]);
  });

  it("乘数牌数手里和面前的对应牌，不算自己", () => {
    expect(score(["lighthouse"]).multipliers).toBe(0);
    expect(score(["lighthouse", "boat"], [["boat", "boat"]]).multipliers).toBe(3);
    expect(score(["shoal", "fish", "fish"]).multipliers).toBe(2);
    const colony = score(["colony", "penguin", "penguin", "penguin"]);
    expect(colony.multipliers).toBe(6);
    expect(colony.collectors).toBe(5);
    const captain = score(["captain", "sailor", "sailor"]);
    expect(captain.multipliers).toBe(6);
    expect(captain.collectors).toBe(5);
    expect(captain.total).toBe(11);
  });

  it("美人鱼：第一张数最多的颜色，第二张数第二多的颜色（规则书的例子）", () => {
    // 3 深蓝、2 黑、1 黄：1 张美人鱼 3 分，2 张 3 + 2 = 5 分。
    const base = ["crab:darkBlue", "boat:darkBlue", "fish:darkBlue", "boat:black", "fish:black", "shell:yellow"];
    expect(score([...base, "mermaid"]).mermaids).toBe(3);
    expect(score([...base, "mermaid", "mermaid"]).mermaids).toBe(5);
  });

  it("美人鱼：官方的例子，4 浅蓝 + 2 绿 + 两张美人鱼 = 6 分", () => {
    const hand = ["crab:lightBlue", "crab:lightBlue", "boat:lightBlue", "shell:lightBlue", "fish:green", "octopus:green", "mermaid", "mermaid"];
    expect(score(hand).mermaids).toBe(6);
  });

  it("美人鱼本身算白色；每种颜色只能被一张美人鱼数", () => {
    // 3 张美人鱼（白 3）+ 2 深蓝：3 + 2 + 0。
    expect(score(["mermaid", "mermaid", "mermaid", "crab:darkBlue", "boat:darkBlue"]).mermaids).toBe(5);
    expect(score(["mermaid"]).mermaids).toBe(1);
    expect(score(["mermaid", "mermaid", "shell:yellow"]).mermaids).toBe(3);
  });

  it("颜色奖励 = 最多的那种颜色的张数（手牌 + 面前）", () => {
    const points = score(["shell:yellow", "octopus:yellow"], [["crab:yellow", "crab:darkBlue"]]);
    expect(points.colorBonus).toBe(3);
    expect(score([]).colorBonus).toBe(0);
  });
});

describe("开局和拿牌", () => {
  it("两个弃牌堆各翻一张，牌堆 56 张，轮到先手拿牌", () => {
    const game = newGame(3, 11, 1);
    expect(game.discards[0]).toHaveLength(1);
    expect(game.discards[1]).toHaveLength(1);
    expect(game.deckCount).toBe(56);
    expect(game.actor).toBe(1);
    expect(game.stage).toBe("draw");
    expect(game.config.targetScore).toBe(35);
    expect([2, 3, 4].map(defaultTarget)).toEqual([40, 35, 30]);
  });

  it("从牌堆摸两张：留一张，另一张丢进选的弃牌堆", () => {
    const game = arrange(newGame(), { piles: [["shell"], ["octopus"]], top: ["crab:yellow", "mermaid"], actor: 0, stage: "draw" });
    const drew = play(game, "p1", { type: "DRAW_DECK" });
    expect(drew.stage).toBe("keep");
    expect(drew.drawn.map((card) => card.type)).toEqual(["crab", "mermaid"]);
    const mermaid = drew.drawn.find((card) => card.type === "mermaid")!;
    const kept = play(drew, "p1", { type: "KEEP", card: mermaid.id, pile: 1 });
    expect(kept.players[0]!.hand.map((card) => card.type)).toEqual(["mermaid"]);
    expect(kept.discards[1].at(-1)!.type).toBe("crab");
    expect(kept.discards[1]).toHaveLength(2);
    expect(kept.stage).toBe("play");
  });

  it("有空的弃牌堆时，另一张必须丢进空堆", () => {
    const game = arrange(newGame(), { piles: [[], ["octopus"]], top: ["crab", "boat"], actor: 0, stage: "draw" });
    const drew = play(game, "p1", { type: "DRAW_DECK" });
    const keep = drew.drawn[0]!.id;
    expect(() => play(drew, "p1", { type: "KEEP", card: keep, pile: 1 })).toThrow();
    const kept = play(drew, "p1", { type: "KEEP", card: keep, pile: 0 });
    expect(kept.discardCounts).toEqual([1, 1]);
  });

  it("牌堆只剩一张：摸到就直接留下", () => {
    const game = arrange(newGame(), { piles: [["shell"], ["octopus"]], top: ["fish"], deckSize: 1, actor: 0, stage: "draw" });
    const drew = play(game, "p1", { type: "DRAW_DECK" });
    expect(drew.stage).toBe("play");
    expect(drew.players[0]!.hand.map((card) => card.type)).toEqual(["fish"]);
    expect(drew.deckCount).toBe(0);
  });

  it("拿弃牌堆顶的一张；空堆不能拿", () => {
    const game = arrange(newGame(), { piles: [["shell", "penguin"], []], actor: 0, stage: "draw" });
    const took = play(game, "p1", { type: "TAKE_DISCARD", pile: 0 });
    expect(took.players[0]!.hand.map((card) => card.type)).toEqual(["penguin"]);
    expect(took.discards[0].map((card) => card.type)).toEqual(["shell"]);
    expect(() => play(game, "p1", { type: "TAKE_DISCARD", pile: 1 })).toThrow();
  });
});

describe("对子的效果", () => {
  it("两只蟹：选一个弃牌堆，整堆里挑任意一张；别人不知道拿了哪张", () => {
    const game = arrange(newGame(), {
      hands: [["crab", "crab"], ["shell"]],
      piles: [["mermaid", "octopus", "penguin"], ["sailor"]],
      actor: 0,
      stage: "play",
    });
    const played = play(game, "p1", pair(game, 0, "crab"));
    expect(played.stage).toBe("crabPile");
    // 选堆之前谁都只看得到堆顶。
    expect(redactGameForViewer(played, "p1").discards[0]).toHaveLength(1);
    const chose = play(played, "p1", { type: "CRAB_PILE", pile: 0 });
    expect(chose.stage).toBe("crabPick");
    expect(redactGameForViewer(chose, "p1").discards[0].map((card) => card.type)).toEqual(["mermaid", "octopus", "penguin"]);
    expect(redactGameForViewer(chose, "p2").discards[0].map((card) => card.type)).toEqual(["penguin"]);
    const mermaid = chose.discards[0][0]!;
    const took = play(chose, "p1", { type: "CRAB_TAKE", card: mermaid.id });
    expect(took.players[0]!.hand.map((card) => card.type)).toEqual(["mermaid"]);
    expect(took.discards[0].map((card) => card.type)).toEqual(["octopus", "penguin"]);
    expect(took.stage).toBe("play");
    const seenByOther = redactGameForViewer(took, "p2").events.find((event) => event.type === "CrabTook")!;
    expect("card" in seenByOther).toBe(false);
    const seenByMe = redactGameForViewer(took, "p1").events.find((event) => event.type === "CrabTook")!;
    expect("card" in seenByMe && seenByMe.card?.type).toBe("mermaid");
  });

  it("两只蟹：只有一个弃牌堆有牌就直接看那一堆；都空就只计分", () => {
    const one = arrange(newGame(), { hands: [["crab", "crab"], []], piles: [[], ["sailor", "shell"]], actor: 0, stage: "play" });
    const auto = play(one, "p1", pair(one, 0, "crab"));
    expect(auto.stage).toBe("crabPick");
    expect(auto.crabPile).toBe(1);
    const none = arrange(newGame(), { hands: [["crab", "crab"], []], piles: [[], []], actor: 0, stage: "play" });
    const skipped = play(none, "p1", pair(none, 0, "crab"));
    expect(skipped.stage).toBe("play");
    expect(skipped.events.some((event) => event.type === "EffectSkipped")).toBe(true);
    expect(pointsOf(skipped, 0).pairs).toBe(1);
  });

  it("两艘船：马上再来一回合（先拿牌）", () => {
    const game = arrange(newGame(), { hands: [["boat", "boat"], []], piles: [["shell"], ["octopus"]], actor: 0, stage: "play" });
    const played = play(game, "p1", pair(game, 0, "boat"));
    expect(played.actor).toBe(0);
    expect(played.stage).toBe("draw");
    expect(played.extraTurn).toBe(true);
    expect(played.players[0]!.played).toHaveLength(1);
  });

  it("两条鱼：把牌堆顶的一张加进手牌", () => {
    const game = arrange(newGame(), { hands: [["fish", "fish"], []], piles: [["shell"], ["octopus"]], top: ["mermaid"], actor: 0, stage: "play" });
    const played = play(game, "p1", pair(game, 0, "fish"));
    expect(played.players[0]!.hand.map((card) => card.type)).toEqual(["mermaid"]);
    expect(played.stage).toBe("play");
    expect(played.deckCount).toBe(game.deckCount - 1);
  });

  it("鲨鱼 + 泳者：从一位对手手里随机偷一张；只有一个人能偷就直接偷", () => {
    const game = arrange(newGame(), { hands: [["shark", "swimmer"], ["mermaid"]], piles: [["shell"], ["octopus"]], actor: 0, stage: "play" });
    const played = play(game, "p1", pair(game, 0, "shark", "swimmer"));
    expect(played.players[0]!.hand.map((card) => card.type)).toEqual(["mermaid"]);
    expect(played.players[1]!.hand).toHaveLength(0);
    const stole = played.events.find((event) => event.type === "Stole")!;
    expect(stole.type === "Stole" && stole.privateTo).toEqual(["p1", "p2"]);
    const thirdView = redactGameForViewer(played, "p2").events.find((event) => event.type === "Stole")!;
    expect("card" in thirdView).toBe(true); // 被偷的人知道丢了哪张
  });

  it("鲨鱼 + 泳者：多位对手时要选；手里没牌的不能选", () => {
    const game = arrange(newGame(3), { hands: [["shark", "swimmer"], ["octopus", "shell"], ["sailor"]], piles: [["shell"], ["octopus"]], actor: 0, stage: "play" });
    const played = play(game, "p1", pair(game, 0, "shark", "swimmer"));
    expect(played.stage).toBe("steal");
    expect(stealTargets(played, 0)).toEqual([1, 2]);
    const stole = play(played, "p1", { type: "STEAL", target: "p3" });
    expect(stole.players[0]!.hand.map((card) => card.type)).toEqual(["sailor"]);
    expect(redactGameForViewer(stole, "p2").events.find((event) => event.type === "Stole")).not.toHaveProperty("card");
  });

  it("凑不成对的两张不能打出", () => {
    const game = arrange(newGame(), { hands: [["crab", "boat", "shark", "shark", "shell", "shell"], []], piles: [["shell"], ["octopus"]], actor: 0, stage: "play" });
    expect(() => play(game, "p1", pair(game, 0, "crab", "boat"))).toThrow();
    expect(() => play(game, "p1", pair(game, 0, "shark"))).toThrow();
    expect(() => play(game, "p1", pair(game, 0, "shell"))).toThrow();
  });
});

describe("宣告结束本轮", () => {
  it("卡牌分不到 7 不能宣告", () => {
    const game = arrange(newGame(), { hands: [["octopus", "octopus"], []], piles: [["shell"], ["octopus"]], actor: 0, stage: "play" });
    expect(canDeclare(game, 0)).toBe(false);
    expect(() => play(game, "p1", { type: "STOP" })).toThrow();
    const enough = arrange(newGame(), { hands: [["octopus", "octopus", "octopus"], []], piles: [["shell"], ["shell"]], actor: 0, stage: "play" });
    expect(pointsOf(enough, 0).total).toBe(6);
    const seven = arrange(newGame(), { hands: [["octopus", "octopus", "octopus", "penguin"], []], piles: [["shell"], ["shell"]], actor: 0, stage: "play" });
    expect(canDeclare(seven, 0)).toBe(true);
  });

  it("STOP：本轮立刻结束，所有人拿卡牌分（没有颜色奖励）", () => {
    const game = arrange(newGame(), {
      hands: [["octopus", "octopus", "octopus", "penguin"], ["shell", "shell", "crab", "crab"]],
      piles: [["fish"], ["fish"]],
      actor: 0,
      stage: "play",
    });
    const stopped = play(game, "p1", { type: "STOP" });
    expect(stopped.stage).toBe("roundEnd");
    expect(stopped.players.map((player) => player.lastRound!.score)).toEqual([7, 3]);
    expect(stopped.players.map((player) => player.score)).toEqual([7, 3]);
    expect(stopped.players.every((player) => player.revealed)).toBe(true);
    // 下一轮从宣告者的左手边开始。
    const next = play(play(stopped, "p1", { type: "READY" }), "p2", { type: "READY" });
    expect(next.round).toBe(2);
    expect(next.starter).toBe(1);
    expect(next.actor).toBe(1);
  });

  it("最后机会：其他人各打一个回合，打完亮牌", () => {
    const game = arrange(newGame(3), {
      hands: [["octopus", "octopus", "octopus", "penguin"], ["shell"], ["sailor"]],
      piles: [["fish"], ["fish"]],
      actor: 0,
      stage: "play",
    });
    const called = play(game, "p1", { type: "LAST_CHANCE" });
    expect(called.call).toEqual({ player: 0, kind: "lastChance" });
    expect(called.players[0]!.revealed).toBe(true);
    expect(called.actor).toBe(1);
    expect(called.stage).toBe("draw");
    // 别人看得到宣告者的手牌。
    expect(redactGameForViewer(called, "p2").players[0]!.hand).toHaveLength(4);
    let state = play(called, "p2", { type: "TAKE_DISCARD", pile: 0 });
    expect(canDeclare(state, 1)).toBe(false);
    expect(legalActions(state, "p2").some((command) => command.type === "STOP" || command.type === "LAST_CHANCE")).toBe(false);
    state = play(state, "p2", { type: "END_TURN" });
    expect(state.players[1]!.revealed).toBe(true);
    expect(state.actor).toBe(2);
    state = play(state, "p3", { type: "TAKE_DISCARD", pile: 1 });
    state = play(state, "p3", { type: "END_TURN" });
    expect(state.stage).toBe("roundEnd");
  });

  it("最后机会赌赢（平分也算赢）：宣告者 卡牌分 + 颜色奖励，对手只拿颜色奖励", () => {
    // 官方例子：玩家 1 有 7 分、颜色奖励 2（黄）；玩家 2 有 4 分、颜色奖励 2（浅蓝）。
    const game = arrange(newGame(), {
      hands: [
        ["octopus:yellow", "octopus:green", "octopus:purple", "penguin:purple", "shell:yellow"],
        ["crab:lightBlue", "crab:lightBlue", "shell:black", "shell:darkBlue", "penguin:pink"],
      ],
      piles: [["fish"], ["fish"]],
      actor: 0,
      stage: "play",
    });
    expect(pointsOf(game, 0).total).toBe(7);
    expect(pointsOf(game, 1).total).toBe(4);
    let state = play(game, "p1", { type: "LAST_CHANCE" });
    // 对手得先拿牌才能结束最后一回合。
    expect(() => play(state, "p2", { type: "END_TURN" })).toThrow();
    state = play(state, "p2", { type: "TAKE_DISCARD", pile: 0 });
    state = play(state, "p2", { type: "END_TURN" });
    const result = state.events.find((event) => event.type === "RoundEnded")!;
    expect(result.type === "RoundEnded" && result.betWon).toBe(true);
    expect(state.players[0]!.lastRound).toMatchObject({ cardPoints: 7, colorBonus: 2, score: 9, scored: "cards+bonus" });
    expect(state.players[1]!.lastRound).toMatchObject({ score: 2, scored: "bonus" });
  });

  it("最后机会平分算宣告者赢", () => {
    // 宣告者 7 分；对手 6 分，最后一回合拿到第二条鱼凑成一对，正好也是 7 分。
    const game = arrange(newGame(), {
      hands: [["octopus", "octopus", "octopus", "penguin"], ["octopus", "octopus", "penguin", "penguin", "fish"]],
      piles: [["fish"], ["shell"]],
      actor: 0,
      stage: "play",
    });
    let state = play(game, "p1", { type: "LAST_CHANCE" });
    state = play(state, "p2", { type: "TAKE_DISCARD", pile: 0 });
    expect(pointsOf(state, 1).total).toBe(7);
    state = play(state, "p2", { type: "END_TURN" });
    expect(state.players[0]!.lastRound!.scored).toBe("cards+bonus");
    expect(state.players[1]!.lastRound!.scored).toBe("bonus");
  });

  it("最后机会赌输：宣告者只拿颜色奖励，对手只拿卡牌分（官方规则）", () => {
    const game = arrange(newGame(), {
      hands: [["octopus:yellow", "octopus:green", "octopus:purple", "penguin:purple"], ["sailor", "sailor", "captain", "crab:yellow", "crab:yellow"]],
      piles: [["fish"], ["fish"]],
      actor: 0,
      stage: "play",
    });
    let state = play(game, "p1", { type: "LAST_CHANCE" });
    state = play(state, "p2", { type: "TAKE_DISCARD", pile: 0 });
    state = play(state, "p2", { type: "END_TURN" });
    const result = state.events.find((event) => event.type === "RoundEnded")!;
    expect(result.type === "RoundEnded" && result.betWon).toBe(false);
    expect(state.players[0]!.lastRound).toMatchObject({ cardPoints: 7, colorBonus: 2, score: 2, scored: "bonus" });
    // 对手：水手 5 + 船长 6 + 一对蟹 1 = 12，只拿卡牌分，不加颜色奖励。
    expect(state.players[1]!.lastRound).toMatchObject({ cardPoints: 12, score: 12, scored: "cards" });
  });

  it("最后机会：亮出的手牌不能被偷", () => {
    const game = arrange(newGame(3), {
      hands: [["octopus", "octopus", "octopus", "penguin"], ["shark", "swimmer"], ["shell"]],
      piles: [["fish"], ["fish"]],
      actor: 0,
      stage: "play",
    });
    let state = play(game, "p1", { type: "LAST_CHANCE" });
    state = play(state, "p2", { type: "TAKE_DISCARD", pile: 0 });
    expect(stealTargets(state, 1)).toEqual([2]);
    state = play(state, "p2", pair(state, 1, "shark", "swimmer"));
    expect(state.players[2]!.hand).toHaveLength(0);
    expect(state.players[0]!.hand).toHaveLength(4);
  });

  it("最后机会：最后一回合里打两艘船照样再来一回合", () => {
    const game = arrange(newGame(), {
      hands: [["octopus", "octopus", "octopus", "penguin"], ["boat", "boat"]],
      piles: [["fish"], ["fish"]],
      actor: 0,
      stage: "play",
    });
    let state = play(game, "p1", { type: "LAST_CHANCE" });
    state = play(state, "p2", { type: "TAKE_DISCARD", pile: 0 });
    state = play(state, "p2", pair(state, 1, "boat"));
    expect(state.actor).toBe(1);
    expect(state.stage).toBe("draw");
    state = play(state, "p2", { type: "TAKE_DISCARD", pile: 1 });
    state = play(state, "p2", { type: "END_TURN" });
    expect(state.stage).toBe("roundEnd");
  });

  it("最后机会进行中牌堆空了：不作废，照常结算", () => {
    const game = arrange(newGame(), {
      hands: [["octopus", "octopus", "octopus", "penguin"], []],
      piles: [["fish"], ["fish"]],
      deckSize: 1,
      actor: 0,
      stage: "play",
    });
    let state = play(game, "p1", { type: "LAST_CHANCE" });
    state = play(state, "p2", { type: "DRAW_DECK" });
    expect(state.deckCount).toBe(0);
    state = play(state, "p2", { type: "END_TURN" });
    expect(state.players[0]!.lastRound!.reason).toBe("lastChance");
    expect(state.players[0]!.lastRound!.score).toBeGreaterThan(0);
  });
});

describe("牌堆摸空、美人鱼、终局", () => {
  it("回合结束时牌堆空了：这一轮作废，谁都不得分，下一轮从他左手边开始", () => {
    const game = arrange(newGame(3), {
      hands: [["octopus", "octopus", "octopus", "penguin"], ["shell"], []],
      piles: [["fish"], ["fish"]],
      top: ["crab", "boat"],
      deckSize: 2,
      actor: 1,
      stage: "draw",
    });
    let state = play(game, "p2", { type: "DRAW_DECK" });
    state = play(state, "p2", { type: "KEEP", card: state.drawn[0]!.id, pile: 0 });
    state = play(state, "p2", { type: "END_TURN" });
    expect(state.stage).toBe("roundEnd");
    expect(state.players.map((player) => player.lastRound!.score)).toEqual([0, 0, 0]);
    expect(state.players.map((player) => player.lastRound!.reason)).toEqual(["emptyDeck", "emptyDeck", "emptyDeck"]);
    const next = ["p1", "p2", "p3"].reduce((s, id) => play(s, id, { type: "READY" }), state);
    expect(next.starter).toBe(2);
  });

  it("牌堆空了但这回合宣告了 STOP：照常计分", () => {
    const game = arrange(newGame(), {
      hands: [["octopus", "octopus", "octopus"], []],
      piles: [["penguin"], ["fish"]],
      deckSize: 0,
      actor: 0,
      stage: "draw",
    });
    let state = play(game, "p1", { type: "TAKE_DISCARD", pile: 0 });
    state = play(state, "p1", { type: "STOP" });
    expect(state.players[0]!.lastRound).toMatchObject({ reason: "stop", score: 7 });
  });

  it("集齐 4 张美人鱼立刻获胜", () => {
    const game = arrange(newGame(), { hands: [["mermaid", "mermaid", "mermaid"], []], piles: [["mermaid"], ["fish"]], actor: 0, stage: "draw" });
    const won = play(game, "p1", { type: "TAKE_DISCARD", pile: 0 });
    expect(won.phase).toBe("finished");
    expect(won.finalResult).toEqual({ winner: "p1", winners: ["p1"], mermaids: true });
  });

  it("偷到第 4 张美人鱼也立刻获胜", () => {
    const game = arrange(newGame(), { hands: [["mermaid", "mermaid", "mermaid", "shark", "swimmer"], ["mermaid"]], piles: [["shell"], ["fish"]], actor: 0, stage: "play" });
    const won = play(game, "p1", pair(game, 0, "shark", "swimmer"));
    expect(won.phase).toBe("finished");
    expect(won.finalResult?.mermaids).toBe(true);
  });

  it("有人到目标分：总分最高者获胜；一样高比最后一轮", () => {
    const game = arrange(newGame(), {
      hands: [["octopus", "octopus", "octopus", "penguin"], ["octopus", "octopus", "penguin", "penguin"]],
      piles: [["fish"], ["fish"]],
      actor: 0,
      stage: "play",
    });
    // 甲 33 分，最后一轮拿 7 → 40；乙 34 分，最后一轮拿 6 → 40。同分比最后一轮：甲赢。
    game.players[0]!.score = 33;
    game.players[1]!.score = 34;
    const ended = play(game, "p1", { type: "STOP" });
    expect(ended.players.map((player) => player.score)).toEqual([40, 40]);
    expect(ended.phase).toBe("finished");
    expect(ended.finalResult).toEqual({ winner: "p1", winners: ["p1"], mermaids: false });
  });

  it("总分和最后一轮都一样：并列获胜", () => {
    const game = arrange(newGame(), {
      hands: [["octopus", "octopus", "octopus", "penguin"], ["octopus", "octopus", "penguin", "penguin", "fish", "fish"]],
      piles: [["fish"], ["fish"]],
      actor: 0,
      stage: "play",
    });
    game.players[0]!.score = 35;
    game.players[1]!.score = 35;
    const ended = play(game, "p1", { type: "STOP" });
    expect(ended.players.map((player) => player.score)).toEqual([42, 42]);
    expect(ended.finalResult?.winners).toEqual(["p1", "p2"]);
  });

  it("没人到目标分就开下一轮，全部 58 张重新洗", () => {
    const game = arrange(newGame(), {
      hands: [["octopus", "octopus", "octopus", "penguin"], ["shell"]],
      played: [[["crab", "crab"]], []],
      piles: [["fish"], ["fish"]],
      actor: 0,
      stage: "play",
    });
    const next = play(play(play(game, "p1", { type: "STOP" }), "p1", { type: "READY" }), "p2", { type: "READY" });
    expect(next.round).toBe(game.round + 1);
    expect(next.deckCount).toBe(56);
    expect(next.players.every((player) => player.hand.length === 0 && player.played.length === 0)).toBe(true);
  });
});

describe("隐藏信息", () => {
  it("别人的手牌、刚摸的两张、牌堆顺序、种子都不发出去", () => {
    const game = arrange(newGame(), { hands: [["mermaid"], ["shell", "octopus"]], piles: [["fish", "boat"], ["crab"]], top: ["sailor", "captain"], actor: 0, stage: "draw" });
    const drew = play(game, "p1", { type: "DRAW_DECK" });
    const other = redactGameForViewer(drew, "p2");
    expect(other.players[0]!.hand).toEqual([]);
    expect(other.players[0]!.handCount).toBe(1);
    expect(other.drawn).toEqual([]);
    expect(other.drawnCount).toBe(2);
    expect(other.deck).toBeUndefined();
    expect(other.seed).toBeUndefined();
    expect(other.rng).toBeUndefined();
    expect(other.log).toBeUndefined();
    expect(other.discards[0].map((card) => card.type)).toEqual(["boat"]);
    expect(other.discardCounts).toEqual([2, 1]);
    const drewEvent = other.events.find((event) => event.type === "DrewDeck")!;
    expect(drewEvent).not.toHaveProperty("cards");
    const mine = redactGameForViewer(drew, "p1");
    expect(mine.drawn.map((card) => card.type)).toEqual(["sailor", "captain"]);
    expect(mine.players[1]!.hand).toEqual([]);
    const kept = play(drew, "p1", { type: "KEEP", card: drew.drawn[1]!.id, pile: 1 });
    const keptEvent = redactGameForViewer(kept, "p2").events.find((event) => event.type === "Kept")!;
    expect(keptEvent).not.toHaveProperty("kept");
    expect(keptEvent.type === "Kept" && keptEvent.discarded?.type).toBe("sailor");
    // 动作记录里也一样：别人的私密事件里没有牌。
    const hidden = redactGameForViewer(kept, "p2").history.filter((event) => "privateTo" in event && !event.privateTo.includes("p2"));
    expect(hidden.length).toBeGreaterThan(0);
    for (const event of hidden) {
      expect(event).not.toHaveProperty("cards");
      expect(event).not.toHaveProperty("kept");
      expect(event).not.toHaveProperty("card");
    }
  });
});

describe("超时", () => {
  it("每一步超时都有合法的自动处理", () => {
    let state = arrange(newGame(3), {
      hands: [["crab", "crab", "shark", "swimmer"], ["shell", "shell"], ["octopus"]],
      piles: [["mermaid", "penguin"], ["fish"]],
      actor: 0,
      stage: "draw",
    });
    state = timeoutTurn(state); // 摸牌
    expect(state.stage).toBe("keep");
    state = timeoutTurn(state); // 留牌
    expect(state.stage).toBe("play");
    state = play(state, "p1", pair(state, 0, "crab"));
    expect(state.stage).toBe("crabPile");
    state = timeoutTurn(state); // 选张数多的堆
    expect(state.stage).toBe("crabPick");
    expect(state.crabPile).toBe(0);
    state = timeoutTurn(state); // 挑分最高的：美人鱼
    expect(state.players[0]!.hand.some((card) => card.type === "mermaid")).toBe(true);
    state = play(state, "p1", pair(state, 0, "shark", "swimmer"));
    expect(state.stage).toBe("steal");
    state = timeoutTurn(state); // 偷手牌最多的
    expect(state.players[1]!.handCount).toBe(1);
    state = timeoutTurn(state); // 出牌阶段超时：结束回合
    expect(state.actor).toBe(1);
    expect(state.events[0]).toMatchObject({ type: "TurnTimedOut", player: "p1", stage: "play" });
  });

  it("结算画面超时就开下一轮", () => {
    const game = arrange(newGame(), { hands: [["octopus", "octopus", "octopus", "penguin"], []], piles: [["fish"], ["fish"]], actor: 0, stage: "play" });
    const stopped = play(game, "p1", { type: "STOP" });
    const next = timeoutTurn(stopped);
    expect(next.round).toBe(stopped.round + 1);
    expect(next.stage).toBe("draw");
  });
});

/** 随机对局：每一步从合法操作里随机挑（偶尔超时），检查牌不多不少、计数对得上、分数只增不减。 */
function randomGame(seed: number, count: number): GameState {
  const rng = createRng(seed * 7919 + count);
  let state = createGame(names.slice(0, count).map((name, index) => ({ id: `p${index + 1}`, name })), seed);
  for (let step = 0; step < 20000 && state.phase === "playing"; step += 1) {
    checkInvariants(state);
    const before = state.players.map((player) => player.score);
    if (rng.next() < 0.05) {
      state = timeoutTurn(state);
    } else if (state.stage === "roundEnd") {
      for (const player of state.players) if (state.stage === "roundEnd") state = applyCommand(state, player.id, { type: "READY" });
    } else {
      const actor = state.players[state.actor]!;
      const actions = legalActions(state, actor.id);
      if (actions.length === 0) throw new Error(`没有可做的操作：${state.stage}`);
      // 偏向打对子、少宣告，让对局长一点。
      const weighted = actions.flatMap((action) => (action.type === "PLAY_PAIR" ? [action, action] : action.type === "STOP" || action.type === "LAST_CHANCE" ? (rng.next() < 0.3 ? [action] : []) : [action]));
      state = applyCommand(state, actor.id, rng.pick(weighted.length > 0 ? weighted : actions));
    }
    state.players.forEach((player, index) => {
      if (player.score < before[index]!) throw new Error("分数变少了");
    });
  }
  checkInvariants(state);
  return state;
}

function checkInvariants(state: GameState): void {
  const all: Card[] = [...state.deck!, ...state.discards[0], ...state.discards[1], ...state.drawn];
  for (const player of state.players) {
    all.push(...player.hand, ...player.played.flat());
    if (player.handCount !== player.hand.length) throw new Error("手牌张数对不上");
    for (const played of player.played) if (played.length !== 2) throw new Error("打出的不是一对");
  }
  if (all.length !== 58) throw new Error(`牌数不对：${all.length}`);
  if (new Set(all.map((card) => card.id)).size !== 58) throw new Error("有重复的牌");
  if (state.deckCount !== state.deck!.length) throw new Error("牌堆张数对不上");
  if (state.phase === "playing" && state.stage !== "roundEnd" && state.actor < 0) throw new Error("没人行动");
  if (state.stage === "keep" && state.drawn.length !== 2) throw new Error("留牌时手上不是两张");
  if (state.stage !== "keep" && state.drawn.length !== 0) throw new Error("摸的牌没处理完");
}

describe("随机对局", () => {
  it("300 局都能正常打完，牌不多不少", () => {
    let mermaidWins = 0;
    let rounds = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const count = 2 + (seed % 3);
      const end = randomGame(seed, count);
      expect(end.phase).toBe("finished");
      const result = end.finalResult!;
      if (result.mermaids) mermaidWins += 1;
      else {
        const best = Math.max(...end.players.map((player) => player.score));
        expect(best).toBeGreaterThanOrEqual(end.config.targetScore);
        for (const winner of result.winners) expect(end.players.find((player) => player.id === winner)!.score).toBe(best);
      }
      rounds += end.round;
    }
    expect(rounds).toBeGreaterThan(300);
    expect(mermaidWins).toBeLessThan(300);
  }, 120_000);

  it("每个人看到的状态里都没有别人的暗牌", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      let state = createGame(names.slice(0, 3).map((name, index) => ({ id: `p${index + 1}`, name })), seed);
      const rng = createRng(seed);
      for (let step = 0; step < 400 && state.phase === "playing"; step += 1) {
        for (const viewer of state.players) {
          const view = redactGameForViewer(state, viewer.id);
          for (const player of view.players) {
            if (player.id !== viewer.id && !player.revealed && player.hand.length > 0) throw new Error("看到了别人的手牌");
          }
          if (view.stage === "keep" && view.players[view.actor]!.id !== viewer.id && view.drawn.length > 0) throw new Error("看到了别人刚摸的牌");
          if (!(view.stage === "crabPick" && view.players[view.actor]!.id === viewer.id)) {
            if (view.discards.some((pile) => pile.length > 1)) throw new Error("看到了弃牌堆里面的牌");
          }
        }
        if (state.stage === "roundEnd") state = timeoutTurn(state);
        else {
          const actor = state.players[state.actor]!;
          state = applyCommand(state, actor.id, rng.pick(legalActions(state, actor.id)));
        }
      }
    }
  }, 60_000);
});

/** 让类型检查不报未用。 */
export type _Unused = CardColor;
