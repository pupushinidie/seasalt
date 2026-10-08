/**
 * 海盐与纸的牌（基础版 58 张，颜色按官方牌表，见 cards.ts）：
 * - 对子牌：蟹 9、船 8、鱼 7、鲨鱼 5、泳者 5。两张同名（鲨鱼配泳者）算一对，每对 1 分；打出来才有效果。
 * - 收集牌：贝壳 6、章鱼 5、企鹅 3、水手 2，按张数计分。
 * - 乘数牌：灯塔（船）、鱼群（鱼）、企鹅群（企鹅）、船长（水手）各 1 张。
 * - 美人鱼 4 张（白色）：第 1 张数你最多的颜色，第 2 张数第二多的颜色……集齐 4 张立刻获胜。
 */
export type DuoType = "crab" | "boat" | "fish" | "shark" | "swimmer";
export type CollectorType = "shell" | "octopus" | "penguin" | "sailor";
export type MultiplierType = "lighthouse" | "shoal" | "colony" | "captain";
export type CardType = DuoType | CollectorType | MultiplierType | "mermaid";

export type CardColor =
  | "darkBlue"
  | "lightBlue"
  | "black"
  | "yellow"
  | "green"
  | "white"
  | "purple"
  | "gray"
  | "lightOrange"
  | "pink"
  | "orange";

export interface Card {
  /** 0–57，整副牌里唯一；界面用它做动画的 key。 */
  readonly id: number;
  readonly type: CardType;
  readonly color: CardColor;
}

/** 打出的一对：蟹蟹 / 船船 / 鱼鱼 / 鲨鱼 + 泳者。 */
export type PairEffect = "crab" | "boat" | "fish" | "steal";

export interface Config {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 有人总分到这个数，这一轮结算完游戏结束：2 人 40、3 人 35、4 人 30。 */
  readonly targetScore: number;
  /** 宣告结束本轮需要的卡牌分。 */
  readonly declareAt: number;
  /** 每一个决定的限时（秒）；超时自动处理，见 timeoutTurn。 */
  readonly stepTimeoutSec: number;
  /** 每轮结算画面停留的秒数；所有人都点「下一轮」会提前开始。 */
  readonly roundEndSec: number;
}

/** 一位玩家的卡牌分明细（手牌 + 面前打出的牌一起算）。 */
export interface CardPoints {
  /** 对子分：每一对 1 分（打出的和手里凑成的都算）。 */
  readonly pairs: number;
  /** 收集牌（贝壳、章鱼、企鹅、水手）。 */
  readonly collectors: number;
  /** 乘数牌（灯塔、鱼群、企鹅群、船长）。 */
  readonly multipliers: number;
  /** 美人鱼。 */
  readonly mermaids: number;
  /** 以上之和 = 卡牌分。 */
  readonly total: number;
  /** 颜色奖励：数量最多的那种颜色有几张（只在「最后机会」时用）。 */
  readonly colorBonus: number;
  /** 各颜色的张数（美人鱼算白色）。 */
  readonly colors: Partial<Record<CardColor, number>>;
}

export type EndCall = "stop" | "lastChance";
export type RoundEndReason = EndCall | "emptyDeck";

export interface RoundResult {
  readonly reason: RoundEndReason;
  /** 本轮卡牌分（结算那一刻）。 */
  readonly cardPoints: number;
  readonly colorBonus: number;
  /** 本轮实际得分。 */
  readonly score: number;
  /** 「最后机会」时：这一份分数是怎么来的。 */
  readonly scored: "cards" | "cards+bonus" | "bonus" | "none";
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 座位色下标，开局按入座顺序定。 */
  readonly color: number;
  /** 累计总分；房间列表里当作「分数」显示。 */
  score: number;
  /** 手牌。发给别人看时（没亮牌）是空数组，张数看 handCount。 */
  hand: Card[];
  handCount: number;
  /** 面前打出的对子，每项两张，按打出的先后。 */
  played: Card[][];
  /** 手牌已亮出（「最后机会」的宣告者和打完最后一回合的人；结算时所有人）。亮出的手牌不能被偷。 */
  revealed: boolean;
  /** 每一轮的得分（平局时比最后一轮）。 */
  rounds: number[];
  /** 最近一轮的结算明细。 */
  lastRound: RoundResult | null;
}

/**
 * draw：轮到 actor 拿牌（从牌堆摸 2 张，或拿一个弃牌堆顶的牌）；
 * keep：摸了 2 张，选一张留下，另一张丢到弃牌堆；
 * play：可以打对子、宣告结束本轮，或者结束回合；
 * crabPile / crabPick：打出两只蟹，先选弃牌堆，再从整堆里挑一张；
 * steal：打出鲨鱼 + 泳者，选一位对手随机偷一张；
 * roundEnd：一轮结束，显示结算，等下一轮。
 */
export type Stage = "draw" | "keep" | "play" | "crabPile" | "crabPick" | "steal" | "roundEnd";

export type GameCommand =
  /** 从牌堆顶摸 2 张（只剩 1 张就摸 1 张，直接留下）。 */
  | { readonly type: "DRAW_DECK" }
  /** 拿走弃牌堆 pile（0 左 / 1 右）顶上那张。 */
  | { readonly type: "TAKE_DISCARD"; readonly pile: 0 | 1 }
  /** 留下 card，另一张丢进弃牌堆 pile（有空堆时必须丢进空堆）。 */
  | { readonly type: "KEEP"; readonly card: number; readonly pile: 0 | 1 }
  /** 打出两张成对的牌（牌 id）。 */
  | { readonly type: "PLAY_PAIR"; readonly cards: readonly [number, number] }
  | { readonly type: "CRAB_PILE"; readonly pile: 0 | 1 }
  | { readonly type: "CRAB_TAKE"; readonly card: number }
  /** 鲨鱼 + 泳者：从这位对手手里随机偷一张。 */
  | { readonly type: "STEAL"; readonly target: string }
  /** 结束回合（不宣告）。 */
  | { readonly type: "END_TURN" }
  /** 卡牌分 ≥ 7 时宣告结束本轮。 */
  | { readonly type: "STOP" }
  | { readonly type: "LAST_CHANCE" }
  /** 结算画面：准备好下一轮。 */
  | { readonly type: "READY" };

/**
 * 动作事件。带 privateTo 的事件里，card / cards / kept 只有这些玩家能看到，
 * redactGameForViewer 会给其他人去掉。
 */
export type GameEvent =
  | { readonly type: "RoundStarted"; readonly round: number; readonly first: string; readonly piles: readonly Card[] }
  | { readonly type: "TurnStarted"; readonly player: string; readonly extra?: boolean; readonly final?: boolean }
  | { readonly type: "DrewDeck"; readonly player: string; readonly count: number; readonly cards?: readonly Card[]; readonly privateTo: readonly string[] }
  | { readonly type: "Kept"; readonly player: string; readonly discarded: Card | null; readonly pile: number; readonly kept?: Card; readonly privateTo: readonly string[] }
  | { readonly type: "TookDiscard"; readonly player: string; readonly pile: number; readonly card: Card }
  | { readonly type: "PlayedPair"; readonly player: string; readonly cards: readonly Card[]; readonly effect: PairEffect }
  /** 效果用不了（弃牌堆都空、牌堆空、没人能偷），只计分。 */
  | { readonly type: "EffectSkipped"; readonly player: string; readonly effect: PairEffect }
  | { readonly type: "CrabPile"; readonly player: string; readonly pile: number }
  | { readonly type: "CrabTook"; readonly player: string; readonly pile: number; readonly card?: Card; readonly privateTo: readonly string[] }
  | { readonly type: "FishDrew"; readonly player: string; readonly card?: Card; readonly privateTo: readonly string[] }
  | { readonly type: "Stole"; readonly player: string; readonly from: string; readonly card?: Card; readonly privateTo: readonly string[] }
  | { readonly type: "Announced"; readonly player: string; readonly call: EndCall; readonly points: number }
  | { readonly type: "Revealed"; readonly player: string; readonly points: number }
  | { readonly type: "TurnTimedOut"; readonly player: string; readonly stage: Stage }
  | {
      readonly type: "RoundEnded";
      readonly round: number;
      readonly reason: RoundEndReason;
      readonly caller?: string;
      readonly betWon?: boolean;
      readonly scores: readonly { readonly player: string; readonly cardPoints: number; readonly colorBonus: number; readonly score: number; readonly total: number }[];
    }
  | { readonly type: "MermaidWin"; readonly player: string }
  | { readonly type: "GameEnded"; readonly winners: readonly string[]; readonly mermaids: boolean };

export interface FinalResult {
  /** 第一位获胜者（并列时见 winners）。 */
  readonly winner: string;
  readonly winners: string[];
  /** 集齐 4 张美人鱼直接获胜。 */
  readonly mermaids: boolean;
}

export interface GameState {
  readonly config: Config;
  phase: "playing" | "finished";
  players: Player[];
  /** 第几轮，从 1 开始。 */
  round: number;
  /** 本轮先手（players 下标）。 */
  starter: number;
  /** 轮到谁（players 下标）；roundEnd 时为 -1。 */
  actor: number;
  stage: Stage;
  /** 两个弃牌堆，数组末尾是堆顶。发给玩家看时只留堆顶一张（打蟹挑牌的人看得到整堆），张数看 discardCounts。 */
  discards: [Card[], Card[]];
  discardCounts: [number, number];
  /** 牌堆张数（顺序只在服务端）。 */
  deckCount: number;
  /** keep 阶段摸到的牌；只有摸牌的人看得到，别人看 drawnCount。 */
  drawn: Card[];
  drawnCount: number;
  /** crabPick 阶段选中的弃牌堆。 */
  crabPile: number | null;
  /** 宣告结束本轮：谁、STOP 还是最后机会。 */
  call: { readonly player: number; readonly kind: EndCall } | null;
  /** 「最后机会」后还没打最后一回合的人（players 下标，按顺序）。 */
  finalTurns: number[];
  /** 这一回合是打出两艘船换来的额外回合。 */
  extraTurn: boolean;
  /** 上一轮是谁结束的（下一轮从他左手边开始）。 */
  lastEnder: number;
  /** 结算画面里已经点了「下一轮」的玩家 id。 */
  ready: string[];
  /** 本次操作产生的事件。 */
  events: GameEvent[];
  /** 最近的事件（最多 HISTORY_LIMIT 条），断线重连后还能看到动作记录。 */
  history: GameEvent[];
  finalResult?: FinalResult;
  /** 每个动作 +1；前端据此判断是不是新事件，服务端据此给每一步计时。 */
  version: number;
  /** 以下只在服务端：牌堆顺序、随机数状态、种子、动作序列。 */
  deck?: Card[];
  rng?: number;
  seed?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
}
