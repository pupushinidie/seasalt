import { describe, expect, it } from "vitest";
import { botAdvice, botCommand } from "./bot.js";
import { buildDeck, cardKey } from "./cards.js";
import { applyCommand, createGame, legalActions, redactGameForViewer, timeoutTurn } from "./engine.js";
import type { Card, GameCommand, GameState } from "./types.js";

const names = ["甲", "乙", "丙", "丁"];
const newGame = (count = 2, seed = 7, starter = 0) =>
  createGame(names.slice(0, count).map((name, index) => ({ id: `p${index + 1}`, name })), seed, {}, { starter });

interface Layout {
  hands?: string[][];
  played?: string[][][];
  piles?: [string[], string[]];
  top?: string[];
  deckSize?: number;
  actor?: number;
  stage?: GameState["stage"];
  scores?: number[];
}

/** 把一局摆成指定的样子，其余牌放进牌堆。key 是 type 或 type:color。 */
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
    if (layout.scores) player.score = layout.scores[index]!;
  });
  state.discards = [(layout.piles?.[0] ?? []).map(take), (layout.piles?.[1] ?? []).map(take)];
  const top = (layout.top ?? []).map(take);
  const rest = layout.deckSize === undefined ? remaining : remaining.slice(0, Math.max(0, layout.deckSize - top.length));
  state.deck = [...rest, ...top.reverse()];
  if (layout.actor !== undefined) state.actor = layout.actor;
  if (layout.stage) state.stage = layout.stage;
  state.drawn = [];
  state.crabPile = null;
  state.deckCount = state.deck.length;
  state.discardCounts = [state.discards[0].length, state.discards[1].length];
  state.drawnCount = 0;
  for (const player of state.players) player.handCount = player.hand.length;
  return state;
}

const decide = (state: GameState, id = "p1") => botCommand(redactGameForViewer(state, id), id);
const legal = (state: GameState, id: string, command: GameCommand) =>
  legalActions(state, id).some((action) => JSON.stringify(action) === JSON.stringify(command)) ||
  (command.type === "KEEP" && state.drawn.some((card) => card.id === command.card)) ||
  (command.type === "PLAY_PAIR" && legalActions(state, id).some((action) => action.type === "PLAY_PAIR"));

describe("人机：基本", () => {
  it("不用它做决定时返回 null", () => {
    const game = newGame(3, 3, 0);
    expect(decide(game, "p2")).toBeNull();
    expect(decide(game, "p3")).toBeNull();
    expect(decide(game, "p1")).not.toBeNull();
  });

  it("只用自己看得到的信息：别人的手牌、牌堆顺序、弃牌堆里面换掉，决定不变", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      let game = newGame(3, seed, 0);
      // 先随便走几步，让场上有手牌和弃牌
      for (let step = 0; step < 25 && game.phase === "playing"; step += 1) {
        if (game.stage === "roundEnd") break;
        const id = game.players[game.actor]!.id;
        game = applyCommand(game, id, decide(game, id)!);
      }
      if (game.phase !== "playing" || game.stage === "roundEnd" || game.stage === "crabPick") continue;
      const id = game.players[game.actor]!.id;
      const me = game.actor;
      // 把对手手牌、牌堆、弃牌堆底下的牌整体打乱重新分（张数不变）
      const swapped = structuredClone(game);
      const hidden: Card[] = [];
      swapped.players.forEach((player, index) => { if (index !== me && !player.revealed) hidden.push(...player.hand); });
      hidden.push(...swapped.deck!);
      swapped.discards.forEach((pile) => hidden.push(...pile.slice(0, -1)));
      const reshuffled = [...hidden].reverse();
      let at = 0;
      swapped.players.forEach((player, index) => {
        if (index !== me && !player.revealed) player.hand = reshuffled.slice(at, (at += player.hand.length));
      });
      swapped.discards = swapped.discards.map((pile) => {
        const top = pile.slice(-1);
        const under = reshuffled.slice(at, (at += pile.length - top.length));
        return [...under, ...top];
      }) as [Card[], Card[]];
      swapped.deck = reshuffled.slice(at);
      // 只比较隐藏信息不同：redact 后的牌面一致
      const a = redactGameForViewer(game, id);
      const b = redactGameForViewer(swapped, id);
      expect(b.players.map((p) => p.hand)).toEqual(a.players.map((p) => p.hand));
      expect(b.discards).toEqual(a.discards);
      expect(botCommand(b, id)).toEqual(botCommand(a, id));
    }
  });

  it("2–4 人各 300 局全由人机打完，每一步都合法，不会死循环", () => {
    for (const count of [2, 3, 4]) {
      for (let seed = 1; seed <= 300; seed += 1) {
        let game = newGame(count, seed * 7 + count, seed % count);
        let steps = 0;
        while (game.phase === "playing") {
          steps += 1;
          expect(steps).toBeLessThan(5_000);
          if (game.stage === "roundEnd") {
            game = timeoutTurn(game);
            continue;
          }
          const id = game.players[game.actor]!.id;
          const command = decide(game, id);
          expect(command).not.toBeNull();
          expect(legal(game, id, command!)).toBe(true);
          game = applyCommand(game, id, command!);
        }
        expect(game.finalResult?.winners.length).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  it("每一步都有一句理由", () => {
    let game = newGame(2, 11, 0);
    for (let step = 0; step < 60 && game.phase === "playing"; step += 1) {
      if (game.stage === "roundEnd") { game = timeoutTurn(game); continue; }
      const id = game.players[game.actor]!.id;
      const advice = botAdvice(redactGameForViewer(game, id), id)!;
      expect(advice.reason.length).toBeGreaterThan(3);
      game = applyCommand(game, id, advice.command);
    }
  });
});

describe("人机：关键决定", () => {
  it("弃牌堆顶有能凑分的牌就拿，没用就摸牌", () => {
    const game = arrange(newGame(2), { hands: [["octopus", "octopus"], []], piles: [["octopus"], ["crab"]], actor: 0, stage: "draw" });
    expect(decide(game)).toEqual({ type: "TAKE_DISCARD", pile: 0 });
    const plain = arrange(newGame(2), { hands: [["octopus"], []], piles: [["crab:yellow"], ["swimmer:darkBlue"]], actor: 0, stage: "draw" });
    expect(decide(plain)?.type).toBe("DRAW_DECK");
  });

  it("摸两张留分高的，另一张丢进空的弃牌堆", () => {
    const game = arrange(newGame(2), { hands: [["octopus", "octopus"], []], piles: [["shell"], []], top: ["octopus", "penguin"], actor: 0, stage: "draw" });
    const drawn = applyCommand(game, "p1", { type: "DRAW_DECK" });
    const command = decide(drawn);
    expect(command?.type).toBe("KEEP");
    const kept = drawn.drawn.find((card) => command?.type === "KEEP" && card.id === command.card);
    expect(kept?.type).toBe("octopus");
    expect(command).toMatchObject({ pile: 1 });
  });

  it("有对子先打（鱼、蟹、鲨鱼泳者），船最后打", () => {
    const game = arrange(newGame(2), { hands: [["boat", "boat", "fish", "fish"], ["shell"]], piles: [["shell"], ["penguin"]], actor: 0, stage: "play" });
    const first = decide(game);
    expect(first?.type).toBe("PLAY_PAIR");
    const typeOf = (id: number) => game.players[0]!.hand.find((card) => card.id === id)!.type;
    expect(first?.type === "PLAY_PAIR" && typeOf(first.cards[0])).toBe("fish");
  });

  it("打蟹挑牌：挑整堆里最有用的一张", () => {
    const game = arrange(newGame(2), { hands: [["octopus", "octopus", "octopus"], []], piles: [["octopus", "shell", "boat"], ["penguin"]], actor: 0, stage: "crabPick" });
    game.crabPile = 0;
    const command = decide(game);
    const card = game.discards[0].find((each) => command?.type === "CRAB_TAKE" && each.id === command.card);
    expect(card?.type).toBe("octopus");
  });

  it("鲨鱼泳者：偷手牌多的人", () => {
    const game = arrange(newGame(3), { hands: [[], ["shell"], ["shell", "boat", "crab", "fish"]], actor: 0, stage: "steal" });
    expect(decide(game)).toEqual({ type: "STEAL", target: "p3" });
  });

  it("卡牌分高、对手看起来很少：喊 STOP 或最后机会；分不够就结束回合", () => {
    const strong = arrange(newGame(2), {
      hands: [["octopus", "octopus", "octopus", "octopus", "colony", "penguin", "penguin"], ["shell"]],
      actor: 0,
      stage: "play",
    });
    expect(["STOP", "LAST_CHANCE"]).toContain(decide(strong)?.type);
    const weak = arrange(newGame(2), { hands: [["shell", "shell", "penguin"], ["shell"]], actor: 0, stage: "play" });
    expect(decide(weak)?.type).toBe("END_TURN");
  });

  it("喊 STOP 就能到目标分赢下这局时一定喊", () => {
    const game = arrange(newGame(2), {
      hands: [["octopus", "octopus", "octopus", "shell", "shell"], ["shell", "boat", "crab", "fish", "shark", "penguin"]],
      scores: [33, 20],
      actor: 0,
      stage: "play",
    });
    expect(decide(game)?.type).toBe("STOP");
  });

  it("喊 STOP 会让对手到目标分赢下时不喊", () => {
    // 对手 38 分，面前两对已经 2 分：一结算他就到 40 分以上，比我高。
    const game = arrange(newGame(2), {
      hands: [["octopus", "octopus", "octopus", "shell", "shell"], ["shell", "penguin"]],
      played: [[], [["crab", "crab"], ["boat", "boat"]]],
      scores: [20, 38],
      actor: 0,
      stage: "play",
    });
    expect(decide(game)?.type).not.toBe("STOP");
  });
});
