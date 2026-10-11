/**
 * 海盐与纸和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botAdvice, discardOptions, mermaidCount, pointsOf, type GameCommand, type GameState } from "@seasalt/game";
import { CARD_NAMES } from "./cards.js";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "seasalt";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个按钮（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

const PILE = ["左边", "右边"] as const;

/** 这条命令对应界面上哪个元素、怎么说。 */
function describe(game: GameState, command: GameCommand): { say: string; anchor: string | null } {
  const me = game.players[game.actor];
  const cardName = (id: number) => {
    const card = [...game.drawn, ...(me?.hand ?? []), ...game.discards[0], ...game.discards[1]].find((each) => each.id === id);
    return card ? CARD_NAMES[card.type] : "这张";
  };
  switch (command.type) {
    case "DRAW_DECK":
      return { say: "我会摸两张。", anchor: "draw" };
    case "TAKE_DISCARD": {
      const top = game.discards[command.pile].at(-1);
      return { say: `我会拿${PILE[command.pile]}的${top ? CARD_NAMES[top.type] : "牌"}。`, anchor: `take:${command.pile}` };
    }
    case "KEEP":
      return {
        say: `我会留下${cardName(command.card)}，另一张丢${PILE[command.pile]}。`,
        anchor: discardOptions(game).length > 1 ? `keep:${command.card}` : `drawn:${command.card}`,
      };
    case "PLAY_PAIR": {
      const type = me?.hand.find((card) => card.id === command.cards[0])?.type;
      const effect = type === "shark" || type === "swimmer" ? "steal" : type ?? "crab";
      const name = effect === "steal" ? "鲨鱼 + 泳者" : effect === "crab" ? "两只蟹" : effect === "boat" ? "两艘船" : "两条鱼";
      return { say: `我会打出${name}。`, anchor: `pair:${effect}` };
    }
    case "CRAB_PILE":
      return { say: `我会翻${PILE[command.pile]}的弃牌堆。`, anchor: `crab-pile:${command.pile}` };
    case "CRAB_TAKE":
      return { say: `我会挑${cardName(command.card)}。`, anchor: `crab-card:${command.card}` };
    case "STEAL": {
      const target = game.players.find((player) => player.id === command.target);
      return { say: `我会偷${target?.name ?? "他"}的。`, anchor: `steal:${command.target}` };
    }
    case "STOP":
      return { say: "我会喊 STOP。", anchor: "stop" };
    case "LAST_CHANCE":
      return { say: "我会喊「最后机会」。", anchor: "last-chance" };
    case "END_TURN":
      return { say: "我会结束回合。", anchor: "end-turn" };
    case "READY":
      return { say: "看完结算点「下一轮」。", anchor: "ready" };
  }
}

/** 「提示」：让人机从你的位置算一步（界面拿到的就是你看得到的那份），配一句原因。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase !== "playing") return { say: "这局已经结束了。", anchor: null };
  const me = game.players.findIndex((player) => player.id === playerId);
  if (me === -1) return { say: "你不在这局里。", anchor: null };
  if (game.stage !== "roundEnd" && game.actor !== me) {
    const actor = game.players[game.actor];
    return { say: actor ? `等 ${actor.name} 走完再问我。` : "现在不用你做决定。", anchor: null };
  }
  const advice = botAdvice(game, playerId);
  if (!advice) return { say: "现在不用你做决定。", anchor: null };
  const { say, anchor } = describe(game, advice.command);
  return { say, note: advice.reason, anchor };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "mermaid-3": { title: "再来一张美人鱼就赢", text: "集齐 4 张美人鱼直接赢下整局，不用等结算。" },
  "stolen-from": { title: "被偷走一张牌", text: "对手打出鲨鱼 + 泳者，从你手里随机偷一张。打出去的对子和亮出的手牌不会被偷。" },
  "last-chance-other": { title: "有人喊了「最后机会」", text: "你还有最后一回合。结算时你的卡牌分比他高，他就只拿颜色奖励，你拿卡牌分。" },
  "stop-other": { title: "有人喊了 STOP", text: "这一轮马上结束，每人拿自己的卡牌分。" },
  "can-declare": { title: "可以宣告了", text: "卡牌分到 7：喊 STOP 立刻结算；喊「最后机会」赌你最高；或者结束回合接着攒。" },
  "empty-deck": { title: "牌堆摸完了", text: "没人宣告就摸完牌堆，这一轮作废，谁都不得分。" },
  "round-end": { title: "一轮结束", text: "有人总分到目标分，那一轮打完就结束，总分最高的人赢。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  const me = game.players.findIndex((player) => player.id === selfId);
  const self = game.players[me];
  if (self && game.phase === "playing" && mermaidCount(self.hand, self.played) === 3) ids.push("mermaid-3");
  for (const event of game.events) {
    if (event.type === "Stole" && event.from === selfId) ids.push("stolen-from");
    if (event.type === "Announced" && event.player !== selfId) ids.push(event.call === "lastChance" ? "last-chance-other" : "stop-other");
    if (event.type === "RoundEnded") ids.push(event.reason === "emptyDeck" ? "empty-deck" : "round-end");
  }
  if (self && game.phase === "playing" && game.stage === "play" && game.actor === me && game.call === null && pointsOf(game, me).total >= game.config.declareAt) ids.push("can-declare");
  return ids;
}
