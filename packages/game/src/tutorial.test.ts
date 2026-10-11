import { describe, expect, it } from "vitest";
import { botCommand } from "./bot.js";
import { legalActions, pointsOf, redactGameForViewer } from "./engine.js";
import {
  anchorVisible,
  createPracticeGame,
  createTutorialGame,
  sameCommand,
  TUTORIAL_CARDS,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  tutorialApply,
} from "./tutorial.js";
import type { GameState } from "./types.js";

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length): GameState {
  let game = createTutorialGame("小蒲");
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = tutorialApply(game, TUTORIAL_SELF, step.expect);
    if (step.kind === "watch") for (const move of step.moves) game = tutorialApply(game, tutorialActor(game)!, move);
  }
  return game;
}

const stepIndex = (id: string) => {
  const at = TUTORIAL_STEPS.findIndex((step) => step.id === id);
  if (at === -1) throw new Error(`没有步骤 ${id}`);
  return at;
};
/** 走完 id 这一步之后的局面。 */
const after = (id: string) => playScript(stepIndex(id) + 1);
const hasCard = (game: GameState, playerId: string, id: number) => game.players.find((one) => one.id === playerId)!.hand.some((card) => card.id === id);

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要你做的都合法、轮到的是对的人，高亮的东西在界面上看得见", () => {
    let game = createTutorialGame("小蒲");
    for (const step of TUTORIAL_STEPS) {
      if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
      if (step.kind === "do") {
        expect(tutorialActor(game), `「${step.id}」不是轮到你`).toBe(TUTORIAL_SELF);
        expect(legalActions(game, TUTORIAL_SELF).some((command) => sameCommand(command, step.expect)), `「${step.id}」这一步不合法`).toBe(true);
        game = tutorialApply(game, TUTORIAL_SELF, step.expect);
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          const actor = tutorialActor(game);
          expect(actor && actor !== TUTORIAL_SELF, `「${step.id}」该对手走的时候轮到了 ${actor}`).toBe(true);
          expect(legalActions(game, actor!).some((command) => sameCommand(command, move)), `「${step.id}」里对手的 ${JSON.stringify(move)} 不合法`).toBe(true);
          game = tutorialApply(game, actor!, move);
        }
      }
    }
    expect(game.phase).toBe("finished");
  });

  it("开局：两人局第 4 轮，轮到你拿牌，你 26 分、咕噜一号 33 分，你卡牌分 2", () => {
    const start = createTutorialGame("小蒲");
    expect(start.round).toBe(4);
    expect(start.players.map((one) => one.score)).toEqual([26, 33]);
    expect(tutorialActor(start)).toBe(TUTORIAL_SELF);
    expect(start.stage).toBe("draw");
    expect(pointsOf(start, 0).total).toBe(2);
    // 咕噜一号的手牌你看不到
    expect(redactGameForViewer(start, TUTORIAL_SELF).players[1]!.hand).toEqual([]);
  });

  it("摸到章鱼和鱼，留章鱼、鱼丢左边；两只蟹翻左边弃牌堆挑到船；两艘船再来一回合", () => {
    const drawn = after("draw");
    expect(drawn.drawn.map((card) => card.id).sort()).toEqual([TUTORIAL_CARDS.octopusB, TUTORIAL_CARDS.fishB].sort());
    const kept = after("keep");
    expect(kept.discards[0].at(-1)?.id).toBe(TUTORIAL_CARDS.fishB);
    expect(pointsOf(kept, 0).collectors).toBe(3);
    const pile = after("crabPile");
    expect(pile.stage).toBe("crabPick");
    // 打蟹的人看得到整堆，对手只看得到堆顶
    expect(redactGameForViewer(pile, TUTORIAL_SELF).discards[0]).toHaveLength(5);
    expect(redactGameForViewer(pile, "p2").discards[0]).toHaveLength(1);
    expect(hasCard(after("crabTake"), TUTORIAL_SELF, TUTORIAL_CARDS.boatB)).toBe(true);
    const extra = after("boat");
    expect(extra.extraTurn).toBe(true);
    expect(extra.stage).toBe("draw");
    expect(tutorialActor(extra)).toBe(TUTORIAL_SELF);
  });

  it("鲨鱼 + 泳者一定偷到美人鱼；这时你 12 分、颜色奖励 4（深蓝 4 张）", () => {
    const stolen = after("steal");
    expect(stolen.events.some((event) => event.type === "Stole" && event.card?.id === TUTORIAL_CARDS.mermaid)).toBe(true);
    expect(hasCard(stolen, TUTORIAL_SELF, TUTORIAL_CARDS.mermaid)).toBe(true);
    const points = pointsOf(stolen, 0);
    expect(points).toMatchObject({ total: 12, pairs: 3, collectors: 3, multipliers: 2, mermaids: 4, colorBonus: 4 });
    expect(points.colors.darkBlue).toBe(4);
    expect(legalActions(stolen, TUTORIAL_SELF).map((command) => command.type)).toContain("LAST_CHANCE");
  });

  it("最后机会：咕噜一号打两条鱼摸一张，只有 4 分；你赌赢 12 + 4，42 比 35 赢下整局", () => {
    const called = after("callLast");
    expect(called.call).toEqual({ player: 0, kind: "lastChance" });
    expect(tutorialActor(called)).toBe("p2");
    const end = after("rivalFinal");
    expect(end.history.some((event) => event.type === "FishDrew" && event.player === "p2")).toBe(true);
    expect(end.phase).toBe("finished");
    expect(end.players.map((one) => one.lastRound)).toEqual([
      { reason: "lastChance", cardPoints: 12, colorBonus: 4, score: 16, scored: "cards+bonus" },
      { reason: "lastChance", cardPoints: 4, colorBonus: 2, score: 2, scored: "bonus" },
    ]);
    expect(end.players.map((one) => one.score)).toEqual([42, 35]);
    expect(end.finalResult?.winners).toEqual([TUTORIAL_SELF]);
  });

  it("剧本本身：步骤 id 不重复，最后一步是唯一的收尾，说明文字不空，每步主句不超过两句", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.trim().length).toBeGreaterThan(0);
      expect(step.say.split(/[。！？]/).filter((part) => part.trim()).length).toBeLessThanOrEqual(2);
    }
  });

  it("教程不改输入的局面；同一剧本走两遍结果一样", () => {
    const start = createTutorialGame("小蒲");
    const copy = structuredClone(start);
    tutorialApply(start, TUTORIAL_SELF, { type: "DRAW_DECK" });
    expect(start).toEqual(copy);
    expect(playScript().players.map((one) => one.score)).toEqual(playScript().players.map((one) => one.score));
  });

  it("练习局：两边都交给人机，150 局都能正常打完", () => {
    const stuck: string[] = [];
    for (let seed = 1; seed <= 150; seed += 1) {
      let game = createPracticeGame("小蒲", seed);
      let moves = 0;
      while (game.phase === "playing" && moves < 5000) {
        const actor = tutorialActor(game);
        if (!actor) break;
        const command = botCommand(redactGameForViewer(game, actor), actor);
        if (!command) break;
        game = tutorialApply(game, actor, command);
        moves += 1;
      }
      if (game.phase !== "finished" || !game.finalResult) stuck.push(`第 ${seed} 局（${moves} 步）`);
    }
    expect(stuck).toEqual([]);
  }, 60_000);
});
