import { buildDeck, cardKey, cardPoints, mermaidCount, pairEffect } from "./cards.js";
import { createRng, type Rng } from "./rng.js";
import type { Card, CardPoints, Config, EndCall, GameCommand, GameEvent, GameState, Player, RoundEndReason, RoundResult, Stage } from "./types.js";

export const HISTORY_LIMIT = 80;

/** 目标分：2 人 40、3 人 35、4 人 30（规则书第 1 节）。 */
export function defaultTarget(playerCount: number): number {
  return playerCount <= 2 ? 40 : playerCount === 3 ? 35 : 30;
}

export function defaultConfig(playerCount: number, overrides: Partial<Config> = {}): Config {
  return {
    minPlayers: 2,
    maxPlayers: 4,
    targetScore: defaultTarget(playerCount),
    declareAt: 7,
    stepTimeoutSec: 45,
    roundEndSec: 25,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

interface Ctx {
  readonly state: GameState;
  readonly rng: Rng;
  readonly events: GameEvent[];
}

const pid = (state: GameState, index: number) => state.players[index]?.id ?? "";

function indexOf(state: GameState, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

/** 从 from 的下一位开始按座位顺序数，不含 from 自己。 */
function othersFrom(state: GameState, from: number): number[] {
  const n = state.players.length;
  return Array.from({ length: n - 1 }, (_, k) => (from + 1 + k) % n);
}

/** 某位玩家此刻的卡牌分（手牌 + 面前）。 */
export function pointsOf(state: Pick<GameState, "players">, index: number): CardPoints {
  const player = state.players[index]!;
  return cardPoints(player.hand, player.played);
}

/** 能被鲨鱼偷的对手：手里有牌、手牌没亮出。 */
export function stealTargets(state: GameState, thief: number): number[] {
  return othersFrom(state, thief).filter((index) => {
    const player = state.players[index]!;
    return player.handCount > 0 && !player.revealed;
  });
}

/** 有空的弃牌堆时，另一张必须丢进空堆；两个都空或都不空就随便选。 */
export function discardOptions(state: Pick<GameState, "discardCounts">): (0 | 1)[] {
  const [left, right] = state.discardCounts;
  if (left === 0 && right > 0) return [0];
  if (right === 0 && left > 0) return [1];
  return [0, 1];
}

/** 能不能宣告结束本轮：自己的回合、拿完牌、还没人宣告、卡牌分 ≥ 7。 */
export function canDeclare(state: GameState, index: number): boolean {
  return (
    state.phase === "playing" &&
    state.stage === "play" &&
    state.actor === index &&
    state.call === null &&
    pointsOf(state, index).total >= state.config.declareAt
  );
}

function syncCounts(state: GameState): void {
  state.deckCount = state.deck!.length;
  state.discardCounts = [state.discards[0].length, state.discards[1].length];
  state.drawnCount = state.drawn.length;
  for (const player of state.players) player.handCount = player.hand.length;
}

/** 牌进了 actor 的手：集齐 4 张美人鱼立刻获胜。返回游戏是否就此结束。 */
function checkMermaids(ctx: Ctx, index: number): boolean {
  const { state, events } = ctx;
  const player = state.players[index]!;
  if (mermaidCount(player.hand, player.played) < 4) return false;
  state.phase = "finished";
  state.stage = "roundEnd";
  state.actor = -1;
  for (const each of state.players) each.revealed = true;
  state.finalResult = { winner: player.id, winners: [player.id], mermaids: true };
  events.push({ type: "MermaidWin", player: player.id });
  events.push({ type: "GameEnded", winners: [player.id], mermaids: true });
  return true;
}

/** 新的一回合（extra：打出两艘船换来的；final：「最后机会」后的最后一回合）。 */
function beginTurn(ctx: Ctx, index: number, options: { extra?: boolean; final?: boolean } = {}): void {
  const { state, events } = ctx;
  state.actor = index;
  state.extraTurn = options.extra === true;
  state.drawn = [];
  state.crabPile = null;
  events.push({
    type: "TurnStarted",
    player: pid(state, index),
    ...(options.extra ? { extra: true } : {}),
    ...(options.final ? { final: true } : {}),
  });
  // 牌堆和两个弃牌堆都空了（只可能出现在最后一回合）：没牌可拿，直接到出牌这一步。
  const nothingToTake = state.deck!.length === 0 && state.discards[0].length === 0 && state.discards[1].length === 0;
  state.stage = nothingToTake ? "play" : "draw";
}

/** 新的一轮：58 张全部洗匀，翻两张各起一个弃牌堆；从上一轮结束者的左手边开始（第一轮随机）。 */
function startRound(ctx: Ctx, starter?: number): void {
  const { state, rng, events } = ctx;
  const deck = rng.shuffle(buildDeck());
  state.deck = deck;
  for (const player of state.players) {
    player.hand = [];
    player.played = [];
    player.revealed = false;
  }
  state.discards = [[deck.pop()!], [deck.pop()!]];
  state.round += 1;
  state.starter = starter ?? (state.lastEnder + 1) % state.players.length;
  state.call = null;
  state.finalTurns = [];
  state.ready = [];
  events.push({ type: "RoundStarted", round: state.round, first: pid(state, state.starter), piles: [state.discards[0][0]!, state.discards[1][0]!] });
  beginTurn(ctx, state.starter);
}

/** 结算这一轮（STOP / 最后机会 / 牌堆摸空）。 */
function endRound(ctx: Ctx, reason: RoundEndReason): void {
  const { state, events } = ctx;
  const points = state.players.map((_, index) => pointsOf(state, index));
  const caller = state.call?.player ?? -1;
  const betWon = reason === "lastChance" ? points[caller]!.total >= Math.max(...points.map((p) => p.total)) : undefined;
  state.lastEnder = caller >= 0 ? caller : state.actor;

  const scores = state.players.map((player, index) => {
    const { total: cards, colorBonus } = points[index]!;
    let score = 0;
    let scored: RoundResult["scored"] = "none";
    if (reason === "stop") {
      score = cards;
      scored = "cards";
    } else if (reason === "lastChance") {
      const isCaller = index === caller;
      if (betWon) {
        score = isCaller ? cards + colorBonus : colorBonus;
        scored = isCaller ? "cards+bonus" : "bonus";
      } else {
        score = isCaller ? colorBonus : cards;
        scored = isCaller ? "bonus" : "cards";
      }
    }
    player.revealed = true;
    player.score += score;
    player.rounds.push(score);
    player.lastRound = { reason, cardPoints: cards, colorBonus, score, scored };
    return { player: player.id, cardPoints: cards, colorBonus, score, total: player.score };
  });

  state.stage = "roundEnd";
  state.actor = -1;
  state.drawn = [];
  state.crabPile = null;
  state.finalTurns = [];
  state.ready = [];
  events.push({
    type: "RoundEnded",
    round: state.round,
    reason,
    ...(caller >= 0 ? { caller: pid(state, caller) } : {}),
    ...(betWon !== undefined ? { betWon } : {}),
    scores,
  });

  const best = Math.max(...state.players.map((player) => player.score));
  if (best >= state.config.targetScore) {
    // 总分最高者获胜；一样高比最后一轮的得分；还一样就并列。
    const top = state.players.filter((player) => player.score === best);
    const lastBest = Math.max(...top.map((player) => player.rounds.at(-1) ?? 0));
    const winners = top.filter((player) => (player.rounds.at(-1) ?? 0) === lastBest).map((player) => player.id);
    state.phase = "finished";
    state.finalResult = { winner: winners[0]!, winners, mermaids: false };
    events.push({ type: "GameEnded", winners, mermaids: false });
  }
}

/** 结束当前回合（没有宣告）。 */
function endTurn(ctx: Ctx): void {
  const { state, events } = ctx;
  const index = state.actor;
  if (state.call?.kind === "lastChance") {
    // 最后一回合打完：亮出手牌（之后不能再被偷），轮到下一位；都打完就结算。
    const player = state.players[index]!;
    player.revealed = true;
    events.push({ type: "Revealed", player: player.id, points: pointsOf(state, index).total });
    const next = state.finalTurns.shift();
    if (next === undefined) endRound(ctx, "lastChance");
    else beginTurn(ctx, next, { final: true });
    return;
  }
  // 回合结束时牌堆空了：这一轮作废，谁都不得分。
  if (state.deck!.length === 0) {
    endRound(ctx, "emptyDeck");
    return;
  }
  beginTurn(ctx, (index + 1) % state.players.length);
}

function declare(ctx: Ctx, kind: EndCall): void {
  const { state, events } = ctx;
  const index = state.actor;
  const player = state.players[index]!;
  const points = pointsOf(state, index).total;
  state.call = { player: index, kind };
  events.push({ type: "Announced", player: player.id, call: kind, points });
  player.revealed = true;
  if (kind === "stop") {
    endRound(ctx, "stop");
    return;
  }
  events.push({ type: "Revealed", player: player.id, points });
  state.finalTurns = othersFrom(state, index);
  beginTurn(ctx, state.finalTurns.shift()!, { final: true });
}

/** 从 player 手里拿走 id 这张牌。 */
function takeFromHand(player: Player, id: number): Card {
  const at = player.hand.findIndex((card) => card.id === id);
  if (at === -1) throw new Error("手里没有这张牌。");
  return player.hand.splice(at, 1)[0]!;
}

function steal(ctx: Ctx, thief: number, victim: number): void {
  const { state, rng, events } = ctx;
  const from = state.players[victim]!;
  const card = from.hand.splice(rng.int(from.hand.length), 1)[0]!;
  state.players[thief]!.hand.push(card);
  events.push({ type: "Stole", player: pid(state, thief), from: from.id, card, privateTo: [pid(state, thief), from.id] });
  state.stage = "play";
  checkMermaids(ctx, thief);
}

/** 复制一份状态来改：牌局本身深拷贝；事件和动作序列不会再改，直接共用。 */
function cloneState(state: GameState): GameState {
  const { log, history, events, ...rest } = state;
  const next = structuredClone(rest) as GameState;
  next.history = history;
  next.events = events;
  if (log) next.log = log;
  return next;
}

function runCommand(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  if (state.phase !== "playing") throw new Error("对局已经结束。");
  const me = indexOf(state, playerId);
  if (me === -1) throw new Error("你不在这局里。");
  const next = cloneState(state);
  const rng = createRng(next.rng ?? 1);
  const events: GameEvent[] = [];
  const ctx: Ctx = { state: next, rng, events };
  const player = next.players[me]!;

  if (command.type === "READY") {
    if (next.stage !== "roundEnd") throw new Error("这一轮还没结束。");
    if (!next.ready.includes(playerId)) next.ready.push(playerId);
    if (next.ready.length >= next.players.length) startRound(ctx);
    return finishStep(next, state, rng, events, [{ player: playerId, command }]);
  }
  if (next.actor !== me) throw new Error("还没轮到你。");

  switch (command.type) {
    case "DRAW_DECK": {
      if (next.stage !== "draw") throw new Error("现在不能摸牌。");
      if (next.deck!.length === 0) throw new Error("牌堆已经空了，只能拿弃牌堆的牌。");
      const cards = [next.deck!.pop()!];
      if (next.deck!.length > 0) cards.push(next.deck!.pop()!);
      events.push({ type: "DrewDeck", player: playerId, count: cards.length, cards, privateTo: [playerId] });
      if (cards.length === 1) {
        // 牌堆只剩一张：直接留下，没有要丢的。
        player.hand.push(cards[0]!);
        events.push({ type: "Kept", player: playerId, discarded: null, pile: -1, kept: cards[0]!, privateTo: [playerId] });
        next.stage = "play";
        checkMermaids(ctx, me);
      } else {
        next.drawn = cards;
        next.stage = "keep";
      }
      break;
    }
    case "TAKE_DISCARD": {
      if (next.stage !== "draw") throw new Error("现在不能拿牌。");
      const pile = next.discards[command.pile];
      if (!pile || pile.length === 0) throw new Error("这个弃牌堆是空的。");
      const card = pile.pop()!;
      player.hand.push(card);
      events.push({ type: "TookDiscard", player: playerId, pile: command.pile, card });
      next.stage = "play";
      checkMermaids(ctx, me);
      break;
    }
    case "KEEP": {
      if (next.stage !== "keep") throw new Error("现在不用选。");
      const kept = next.drawn.find((card) => card.id === command.card);
      if (!kept) throw new Error("只能从刚摸的两张里选。");
      syncCounts(next);
      if (!discardOptions(next).includes(command.pile)) throw new Error("有空的弃牌堆时，另一张必须丢进空堆。");
      const other = next.drawn.find((card) => card.id !== command.card)!;
      player.hand.push(kept);
      next.discards[command.pile].push(other);
      next.drawn = [];
      events.push({ type: "Kept", player: playerId, discarded: other, pile: command.pile, kept, privateTo: [playerId] });
      next.stage = "play";
      checkMermaids(ctx, me);
      break;
    }
    case "PLAY_PAIR": {
      if (next.stage !== "play") throw new Error("现在不能出牌。");
      const [a, b] = command.cards;
      if (a === b) throw new Error("要选两张不同的牌。");
      const first = player.hand.find((card) => card.id === a);
      const second = player.hand.find((card) => card.id === b);
      if (!first || !second) throw new Error("手里没有这两张牌。");
      const effect = pairEffect(first.type, second.type);
      if (!effect) throw new Error("这两张凑不成一对。");
      const pair = [takeFromHand(player, a), takeFromHand(player, b)];
      player.played.push(pair);
      events.push({ type: "PlayedPair", player: playerId, cards: pair, effect });
      syncCounts(next);
      if (effect === "crab") {
        const piles = ([0, 1] as const).filter((index) => next.discards[index].length > 0);
        if (piles.length === 0) events.push({ type: "EffectSkipped", player: playerId, effect });
        else if (piles.length === 1) {
          next.crabPile = piles[0]!;
          events.push({ type: "CrabPile", player: playerId, pile: piles[0]! });
          next.stage = "crabPick";
        } else next.stage = "crabPile";
      } else if (effect === "boat") {
        if (next.deck!.length + next.discards[0].length + next.discards[1].length === 0) events.push({ type: "EffectSkipped", player: playerId, effect });
        else beginTurn(ctx, me, { extra: true, final: next.call?.kind === "lastChance" });
      } else if (effect === "fish") {
        const card = next.deck!.pop();
        if (!card) events.push({ type: "EffectSkipped", player: playerId, effect });
        else {
          player.hand.push(card);
          events.push({ type: "FishDrew", player: playerId, card, privateTo: [playerId] });
          checkMermaids(ctx, me);
        }
      } else {
        const targets = stealTargets(next, me);
        if (targets.length === 0) events.push({ type: "EffectSkipped", player: playerId, effect });
        else if (targets.length === 1) steal(ctx, me, targets[0]!);
        else next.stage = "steal";
      }
      break;
    }
    case "CRAB_PILE": {
      if (next.stage !== "crabPile") throw new Error("现在不用选弃牌堆。");
      if (!next.discards[command.pile] || next.discards[command.pile].length === 0) throw new Error("这个弃牌堆是空的。");
      next.crabPile = command.pile;
      events.push({ type: "CrabPile", player: playerId, pile: command.pile });
      next.stage = "crabPick";
      break;
    }
    case "CRAB_TAKE": {
      if (next.stage !== "crabPick" || next.crabPile === null) throw new Error("现在不能从弃牌堆挑牌。");
      const pile = next.discards[next.crabPile as 0 | 1];
      const at = pile.findIndex((card) => card.id === command.card);
      if (at === -1) throw new Error("这个弃牌堆里没有这张牌。");
      const card = pile.splice(at, 1)[0]!;
      player.hand.push(card);
      events.push({ type: "CrabTook", player: playerId, pile: next.crabPile, card, privateTo: [playerId] });
      next.crabPile = null;
      next.stage = "play";
      checkMermaids(ctx, me);
      break;
    }
    case "STEAL": {
      if (next.stage !== "steal") throw new Error("现在不能偷牌。");
      const victim = indexOf(next, command.target);
      syncCounts(next);
      if (!stealTargets(next, me).includes(victim)) throw new Error("不能偷这位玩家。");
      steal(ctx, me, victim);
      break;
    }
    case "END_TURN": {
      if (next.stage !== "play") throw new Error("现在不能结束回合。");
      endTurn(ctx);
      break;
    }
    case "STOP":
    case "LAST_CHANCE": {
      syncCounts(next);
      if (next.stage !== "play") throw new Error("现在不能宣告。");
      if (next.call !== null) throw new Error("这一轮已经有人宣告了。");
      if (pointsOf(next, me).total < next.config.declareAt) throw new Error(`卡牌分到 ${next.config.declareAt} 分才能宣告。`);
      declare(ctx, command.type === "STOP" ? "stop" : "lastChance");
      break;
    }
    default:
      throw new Error("未知操作。");
  }
  return finishStep(next, state, rng, events, [{ player: playerId, command }]);
}

function finishStep(state: GameState, previous: GameState, rng: Rng, events: GameEvent[], log: GameState["log"]): { state: GameState; events: GameEvent[] } {
  syncCounts(state);
  state.rng = rng.state;
  state.version = previous.version + 1;
  state.events = events;
  state.history = [...previous.history, ...events].slice(-HISTORY_LIMIT);
  state.log = [...(previous.log ?? []), ...(log ?? [])];
  return { state, events };
}

export function apply(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  return runCommand(state, playerId, command);
}

export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return runCommand(state, playerId, command).state;
}

/** 手里能打出的对子（每种组合给一个例子：同名两张取前两张）。 */
export function playablePairs(hand: readonly Card[]): [Card, Card][] {
  const byType = (type: Card["type"]) => hand.filter((card) => card.type === type);
  const pairs: [Card, Card][] = [];
  for (const type of ["crab", "boat", "fish"] as const) {
    const cards = byType(type);
    if (cards.length >= 2) pairs.push([cards[0]!, cards[1]!]);
  }
  const sharks = byType("shark");
  const swimmers = byType("swimmer");
  if (sharks.length > 0 && swimmers.length > 0) pairs.push([sharks[0]!, swimmers[0]!]);
  return pairs;
}

/** 某位玩家此刻能做的所有操作（打对子每种组合只列一个）。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase !== "playing") return [];
  const me = indexOf(state, playerId);
  if (me === -1) return [];
  if (state.stage === "roundEnd") return state.ready.includes(playerId) ? [] : [{ type: "READY" }];
  if (state.actor !== me) return [];
  const player = state.players[me]!;
  switch (state.stage) {
    case "draw": {
      const actions: GameCommand[] = [];
      if (state.deckCount > 0) actions.push({ type: "DRAW_DECK" });
      for (const pile of [0, 1] as const) if (state.discardCounts[pile] > 0) actions.push({ type: "TAKE_DISCARD", pile });
      return actions;
    }
    case "keep":
      return state.drawn.flatMap((card) => discardOptions(state).map((pile): GameCommand => ({ type: "KEEP", card: card.id, pile })));
    case "play": {
      const actions: GameCommand[] = playablePairs(player.hand).map(([a, b]): GameCommand => ({ type: "PLAY_PAIR", cards: [a.id, b.id] }));
      actions.push({ type: "END_TURN" });
      if (canDeclare(state, me)) actions.push({ type: "STOP" }, { type: "LAST_CHANCE" });
      return actions;
    }
    case "crabPile":
      return ([0, 1] as const).filter((pile) => state.discardCounts[pile] > 0).map((pile): GameCommand => ({ type: "CRAB_PILE", pile }));
    case "crabPick":
      return state.crabPile === null ? [] : state.discards[state.crabPile as 0 | 1].map((card): GameCommand => ({ type: "CRAB_TAKE", card: card.id }));
    case "steal":
      return stealTargets(state, me).map((index): GameCommand => ({ type: "STEAL", target: pid(state, index) }));
    default:
      return [];
  }
}

/** 加上这些牌之后的卡牌分（超时自动选牌时比较用）。 */
function pointsWith(player: Player, extra: readonly Card[]): number {
  return cardPoints([...player.hand, ...extra], player.played).total;
}

/** 几张牌里留哪张分最高（一样高取最先的那张）。 */
function bestCard(player: Player, cards: readonly Card[]): Card {
  let best = cards[0]!;
  let bestPoints = pointsWith(player, [best]);
  for (const card of cards.slice(1)) {
    const points = pointsWith(player, [card]);
    if (points > bestPoints) {
      best = card;
      bestPoints = points;
    }
  }
  return best;
}

/** 超时时替玩家做的决定（见 README 的「限时」）。 */
export function timeoutCommand(state: GameState): GameCommand | null {
  if (state.phase !== "playing" || state.stage === "roundEnd") return null;
  const actor = state.players[state.actor]!;
  switch (state.stage) {
    case "draw":
      if (state.deckCount > 0) return { type: "DRAW_DECK" };
      return { type: "TAKE_DISCARD", pile: state.discardCounts[0] > 0 ? 0 : 1 };
    case "keep": {
      const kept = bestCard(actor, state.drawn);
      return { type: "KEEP", card: kept.id, pile: discardOptions(state)[0]! };
    }
    case "play":
      return { type: "END_TURN" };
    case "crabPile":
      return { type: "CRAB_PILE", pile: state.discardCounts[0] >= state.discardCounts[1] ? 0 : 1 };
    case "crabPick": {
      const pile = state.discards[state.crabPile as 0 | 1];
      // 一样高时拿靠近堆顶的那张。
      return { type: "CRAB_TAKE", card: bestCard(actor, [...pile].reverse()).id };
    }
    case "steal": {
      const targets = stealTargets(state, state.actor);
      const victim = targets.reduce((best, index) => (state.players[index]!.handCount > state.players[best]!.handCount ? index : best), targets[0]!);
      return { type: "STEAL", target: pid(state, victim) };
    }
    default:
      return null;
  }
}

/**
 * 超时自动处理：拿牌 → 从牌堆摸；留牌 → 留分高的那张，另一张丢左边（有空堆丢空堆）；
 * 出牌 → 直接结束回合（不打对子、不宣告）；蟹 → 挑张数多的弃牌堆里分最高的牌；
 * 偷牌 → 偷手牌最多的对手；结算画面 → 开始下一轮。
 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "finished") return state;
  const stage = state.stage;
  if (stage === "roundEnd") {
    const next = cloneState(state);
    const rng = createRng(next.rng ?? 1);
    const events: GameEvent[] = [];
    startRound({ state: next, rng, events });
    return finishStep(next, state, rng, events, [{ player: "", command: { type: "TIMEOUT" } }]).state;
  }
  const actor = state.players[state.actor]!;
  const command = timeoutCommand(state)!;
  const result = runCommand(state, actor.id, command);
  result.state.events = [{ type: "TurnTimedOut", player: actor.id, stage }, ...result.events];
  result.state.history = [...state.history, ...result.state.events].slice(-HISTORY_LIMIT);
  result.state.log = [...(state.log ?? []), { player: actor.id, command: { type: "TIMEOUT" } }];
  return result.state;
}

/** 服务端计时用：每一个决定单独计时；结算画面按轮计时（别人点「下一轮」不重置）。 */
export function timerKey(state: GameState): string {
  return state.stage === "roundEnd" ? `round-${state.round}` : `v${state.version}`;
}

export function timerSeconds(state: GameState): number {
  return state.stage === "roundEnd" ? state.config.roundEndSec : state.config.stepTimeoutSec;
}

/** 事件里带 privateTo 的牌，别人看不到。 */
function redactEvent(event: GameEvent, viewerId: string): GameEvent {
  if (!("privateTo" in event) || event.privateTo.includes(viewerId)) return event;
  const { cards: _cards, kept: _kept, card: _card, ...rest } = event as GameEvent & { cards?: unknown; kept?: unknown; card?: unknown };
  return rest as GameEvent;
}

/**
 * 发给某位玩家看的状态：去掉牌堆顺序、随机数、种子和动作序列；
 * 别人没亮出的手牌只留张数；刚摸的两张只有摸牌的人看得到；
 * 弃牌堆只看得到堆顶（打蟹挑牌的人看得到他选的那一整堆）；事件里的私密牌去掉。
 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
  const { deck: _deck, rng: _rng, seed: _seed, log: _log, ...rest } = state;
  const viewer = indexOf(state, viewerId);
  const actorView = viewer >= 0 && viewer === state.actor;
  const discards = state.discards.map((pile, index) =>
    actorView && state.stage === "crabPick" && state.crabPile === index ? [...pile] : pile.slice(-1),
  ) as [Card[], Card[]];
  return {
    ...rest,
    players: state.players.map((player) => (player.id === viewerId || player.revealed ? player : { ...player, hand: [] })),
    discards,
    drawn: actorView ? state.drawn : [],
    events: state.events.map((event) => redactEvent(event, viewerId)),
    history: state.history.map((event) => redactEvent(event, viewerId)),
  };
}

export interface CreateOptions {
  /** 测试用：指定第一轮的先手。 */
  readonly starter?: number;
}

export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  overrides: Partial<Config> = {},
  options: CreateOptions = {},
): GameState {
  const config = defaultConfig(players.length, overrides);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  const rng = createRng(seed);
  const state: GameState = {
    config,
    phase: "playing",
    players: players.map((player, index): Player => ({
      id: player.id,
      name: player.name,
      color: index,
      score: 0,
      hand: [],
      handCount: 0,
      played: [],
      revealed: false,
      rounds: [],
      lastRound: null,
    })),
    round: 0,
    starter: 0,
    actor: 0,
    stage: "draw",
    discards: [[], []],
    discardCounts: [0, 0],
    deckCount: 0,
    drawn: [],
    drawnCount: 0,
    crabPile: null,
    call: null,
    finalTurns: [],
    extraTurn: false,
    lastEnder: 0,
    ready: [],
    events: [],
    history: [],
    version: 0,
    deck: [],
    seed,
  };
  const events: GameEvent[] = [];
  startRound({ state, rng, events }, options.starter ?? rng.int(players.length));
  syncCounts(state);
  state.rng = rng.state;
  state.events = events;
  state.history = events.slice(-HISTORY_LIMIT);
  state.log = [];
  return state;
}

/**
 * 测试用：把指定的牌挪到牌堆顶（第一个最先摸到）。key 是 type 或 type:color。牌堆数组的末尾是堆顶。
 * 只能挪还在牌堆里的牌。
 */
export function stackDeck(deck: Card[], keys: readonly string[]): void {
  const picked: Card[] = [];
  for (const key of keys) {
    const at = deck.findIndex((card) => cardKey(card) === key || card.type === key);
    if (at === -1) throw new Error(`牌堆里没有 ${key}`);
    picked.push(deck.splice(at, 1)[0]!);
  }
  deck.push(...picked.reverse());
}

export type { Stage };
