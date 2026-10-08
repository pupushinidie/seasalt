import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  canDeclare,
  cardPoints,
  COLORS,
  discardOptions,
  playablePairs,
  pointsOf,
  sortCards,
  stealTargets,
  type Card,
  type CardPoints,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyRoomSnapshot,
  type PairEffect,
  type Player,
} from "@seasalt/game";
import { art, CARD_COLORS, coverSize, FX_FRAMES, seatColor } from "./art.js";
import { CARD_NAMES, CardBack, CardView, cardLabel, colorStyle } from "./cards.js";
import GameRules from "./GameRules.js";
import { socket } from "./socket.js";
import type { Theme } from "./theme.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly theme: Theme;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onDissolve: () => void;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  // now 可能比 anchor.at 早（计时器上一跳），不能让剩余时间比服务端给的还多。
  return Math.max(0, Math.ceil((anchor.ms - Math.max(0, now - anchor.at)) / 1000));
}

const PILE_NAME = ["左边", "右边"] as const;
const EFFECT_TEXT: Record<PairEffect, string> = {
  crab: "从弃牌堆挑一张",
  boat: "再来一回合",
  fish: "从牌堆摸一张",
  steal: "偷对手一张",
};
const PAIR_NAME: Record<PairEffect, string> = { crab: "两只蟹", boat: "两艘船", fish: "两条鱼", steal: "鲨鱼 + 泳者" };
const SKIP_TEXT: Record<PairEffect, string> = {
  crab: "两个弃牌堆都空了，蟹的效果用不了",
  boat: "没有牌可拿了，船的效果用不了",
  fish: "牌堆空了，鱼的效果用不了",
  steal: "没有能偷的对手，效果用不了",
};

const quote = (card: Pick<Card, "type" | "color">) => `「${cardLabel(card)}」`;

function describeEvent(event: GameEvent, name: (id: string) => string, myId: string): string | null {
  const who = (id: string) => name(id);
  switch (event.type) {
    case "RoundStarted":
      return `第 ${event.round} 轮开始，${who(event.first)}先手；弃牌堆翻出 ${event.piles.map(quote).join(" 和 ")}`;
    case "TurnStarted":
      if (event.extra) return `${who(event.player)}再来一回合`;
      if (event.final) return `${who(event.player)}的最后一回合`;
      return null;
    case "DrewDeck":
      if (event.cards && event.player === myId) return event.cards.length === 1 ? `你摸到最后一张：${quote(event.cards[0]!)}` : `你摸了 ${event.cards.map(quote).join(" 和 ")}`;
      return `${who(event.player)}从牌堆摸了 ${event.count} 张`;
    case "Kept":
      if (!event.discarded) return null;
      if (event.kept && event.player === myId) return `你留下${quote(event.kept)}，把${quote(event.discarded)}丢到${PILE_NAME[event.pile as 0 | 1]}`;
      return `${who(event.player)}留下一张，把${quote(event.discarded)}丢到${PILE_NAME[event.pile as 0 | 1]}`;
    case "TookDiscard":
      return `${who(event.player)}拿走${PILE_NAME[event.pile as 0 | 1]}的${quote(event.card)}`;
    case "PlayedPair":
      return `${who(event.player)}打出${PAIR_NAME[event.effect]}：${EFFECT_TEXT[event.effect]}`;
    case "EffectSkipped":
      return SKIP_TEXT[event.effect];
    case "CrabPile":
      return `${who(event.player)}翻看${PILE_NAME[event.pile as 0 | 1]}的弃牌堆`;
    case "CrabTook":
      return event.card ? `你从${PILE_NAME[event.pile as 0 | 1]}的弃牌堆拿了${quote(event.card)}` : `${who(event.player)}从${PILE_NAME[event.pile as 0 | 1]}的弃牌堆拿了一张`;
    case "FishDrew":
      return event.card ? `你从牌堆摸到${quote(event.card)}` : `${who(event.player)}从牌堆摸了一张`;
    case "Stole":
      if (event.card && event.player === myId) return `你从${who(event.from)}手里偷到${quote(event.card)}`;
      if (event.card && event.from === myId) return `${who(event.player)}从你手里偷走了${quote(event.card)}`;
      return `${who(event.player)}从${who(event.from)}手里偷走一张`;
    case "Announced":
      return event.call === "stop" ? `${who(event.player)}宣告 STOP！（卡牌分 ${event.points}）` : `${who(event.player)}宣告最后机会！（卡牌分 ${event.points}），其他人各打最后一回合`;
    case "Revealed":
      return `${who(event.player)}亮出手牌：卡牌分 ${event.points}`;
    case "TurnTimedOut":
      return `${who(event.player)}超时，自动处理`;
    case "RoundEnded": {
      if (event.reason === "emptyDeck") return `第 ${event.round} 轮结束：牌堆摸空了，这一轮不计分`;
      if (event.reason === "stop") return `第 ${event.round} 轮结束（STOP）：每人拿自己的卡牌分`;
      return `第 ${event.round} 轮结束：${who(event.caller ?? "")}的最后机会${event.betWon ? "赌赢了" : "赌输了"}`;
    }
    case "MermaidWin":
      return `${who(event.player)}集齐 4 张美人鱼，直接获胜！`;
    case "GameEnded":
      return `${event.winners.map(who).join("、")}获胜！`;
    default:
      return null;
  }
}

/** 打出对子 / 被偷时，在那位玩家的面板上弹一下（小动画 + 一行字）。 */
interface Toast {
  readonly fx: "crab" | "boat" | "fish" | "shark";
  readonly text: string;
}

const PAIR_TOAST: Record<PairEffect, Toast> = {
  crab: { fx: "crab", text: "两只蟹！" },
  boat: { fx: "boat", text: "两艘船！再来一回合" },
  fish: { fx: "fish", text: "两条鱼！" },
  steal: { fx: "shark", text: "鲨鱼出动！" },
};

function toastsFrom(events: readonly GameEvent[]): Map<string, Toast> {
  const toasts = new Map<string, Toast>();
  for (const event of events) {
    if (event.type === "PlayedPair") toasts.set(event.player, PAIR_TOAST[event.effect]);
    if (event.type === "Stole") toasts.set(event.from, { fx: "shark", text: "被偷走一张" });
  }
  return toasts;
}

function ToastView({ toast }: { toast: Toast | undefined }) {
  if (!toast) return null;
  return (
    <span className="ss-toast" aria-hidden="true">
      <span className="ss-fx" style={{ backgroundImage: `url(${art.fx(toast.fx)})`, "--frames": FX_FRAMES } as CSSProperties} />
      <b>{toast.text}</b>
    </span>
  );
}

/** 这次操作里，我看得到的新进手牌（翻牌动画用）和新打出的对子。 */
interface Fresh {
  readonly cards: Set<number>;
  readonly piles: Set<number>;
}

function freshFrom(events: readonly GameEvent[], myId: string): Fresh {
  const cards = new Set<number>();
  const piles = new Set<number>();
  for (const event of events) {
    if (event.type === "Kept" && event.kept && event.player === myId) cards.add(event.kept.id);
    if (event.type === "Kept" && event.discarded) piles.add(event.pile);
    if (event.type === "TookDiscard" && event.player === myId) cards.add(event.card.id);
    if ((event.type === "CrabTook" || event.type === "FishDrew") && event.card) cards.add(event.card.id);
    if (event.type === "Stole" && event.card && event.player === myId) cards.add(event.card.id);
    if (event.type === "PlayedPair") for (const card of event.cards) cards.add(card.id);
    if (event.type === "DrewDeck" && event.cards) for (const card of event.cards) cards.add(card.id);
    if (event.type === "RoundStarted") {
      piles.add(0);
      piles.add(1);
    }
  }
  return { cards, piles };
}

/**
 * 牌的大小：按牌桌区域的高度算（对手一排 + 中间牌堆 + 自己的面前和手牌），宽度不够时手牌叠起来。
 * --cw 大牌宽（中间牌堆和手牌），--mw 小牌宽（对手面前、打出的对子）；牌太窄时（small-cards）大牌也用 36px 的小图。
 */
interface Sizes {
  /** 手牌的最大宽度（张数多时再缩）。 */
  readonly cw: number;
  /** 中间牌堆和弃牌堆的牌宽：按剩下的高度放大；够宽（≥ 168）时小图按 2 倍显示。 */
  readonly pw: number;
  readonly mw: number;
  readonly mobile: boolean;
}

function pickSizes(height: number, mobile: boolean, revealedRows: number): Sizes {
  if (mobile) return { cw: 64, pw: 64, mw: 44, mobile };
  const mw = height >= 820 ? 52 : 44;
  const opps = mw * 1.4 + 70 + revealedRows * (mw * 1.4 + 6);
  const fixed = 300 + revealedRows * (mw * 1.4 + 6) + (mw - 44) * 3;
  const cw = Math.max(64, Math.min(128, Math.floor((height - fixed) / 2.8 / 4) * 4));
  const me = cw * 1.4 + mw * 1.4 + 70;
  const center = height - opps - me - 20;
  const pw = Math.max(64, Math.min(176, Math.floor((center - 44) / 1.4 / 4) * 4));
  return { cw, pw, mw, mobile };
}

function useSizes(revealedRows: number): [React.RefObject<HTMLDivElement | null>, Sizes, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<Sizes>({ cw: 96, pw: 96, mw: 44, mobile: false });
  const [box, setBox] = useState({ width: 800, height: 600 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const mobile = window.innerWidth < 760;
      const next = pickSizes(element.clientHeight, mobile, revealedRows);
      setSizes((previous) => (previous.cw === next.cw && previous.pw === next.pw && previous.mw === next.mw && previous.mobile === next.mobile ? previous : next));
      setBox((previous) => (previous.width === element.clientWidth && previous.height === element.clientHeight ? previous : { width: element.clientWidth, height: element.clientHeight }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [revealedRows]);
  return [ref, sizes, box];
}

function Avatar({ player }: { player: Player }) {
  return (
    <span className="ss-avatar" style={{ "--seat": seatColor(player.color) } as CSSProperties}>
      <img src={art.avatar(player.color)} alt="" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
    </span>
  );
}

/** 打出的对子：每一对两张挨着。 */
function PlayedPairs({ pairs, fresh }: { pairs: readonly (readonly Card[])[]; fresh: Fresh }) {
  if (pairs.length === 0) return null;
  return (
    <div className="ss-pairs">
      {pairs.map((pair) => (
        <span className="ss-pair" key={pair[0]!.id}>
          {pair.map((card) => <CardView key={card.id} card={card} className={`mini ${fresh.cards.has(card.id) ? "fresh" : ""}`} />)}
        </span>
      ))}
    </div>
  );
}

/** 颜色统计：每种颜色一个小色块 + 张数，最多的那种颜色描金边。 */
function ColorCounts({ points }: { points: CardPoints }) {
  const entries = COLORS.filter((color) => (points.colors[color] ?? 0) > 0);
  if (entries.length === 0) return <span className="ss-muted">还没有牌</span>;
  return (
    <span className="ss-colors">
      {entries.map((color) => (
        <span
          key={color}
          className={(points.colors[color] ?? 0) === points.colorBonus ? "ss-color top" : "ss-color"}
          style={colorStyle(color)}
          title={`${CARD_COLORS[color].name}色 ${points.colors[color]} 张`}
        >
          {points.colors[color]}
        </span>
      ))}
    </span>
  );
}

function OpponentPanel({
  game,
  index,
  online,
  fresh,
  toast,
  stealable,
  onSteal,
}: {
  game: GameState;
  index: number;
  online: boolean;
  fresh: Fresh;
  toast: Toast | undefined;
  stealable: boolean;
  onSteal: () => void;
}) {
  const player = game.players[index]!;
  const isActor = game.phase === "playing" && game.actor === index;
  const caller = game.call?.player === index;
  const points = player.revealed ? pointsOf(game, index) : cardPoints([], player.played);
  const classes = ["ss-opp", isActor ? "actor" : "", !online ? "offline" : "", stealable ? "pickable" : "", player.revealed ? "revealed" : ""].join(" ");
  const status = caller
    ? game.call?.kind === "lastChance" ? "宣告了最后机会" : "宣告了 STOP"
    : isActor
      ? game.extraTurn ? "再来一回合" : "行动中"
      : game.finalTurns.includes(index) ? "还有最后一回合" : player.revealed && game.call ? "已亮牌" : "";
  const body = (
    <>
      <header className="ss-opp-head">
        <Avatar player={player} />
        <span className="ss-opp-name">
          <strong>{player.name}</strong>
          <small>
            {!online && <em className="ss-tag off">离线</em>}
            {status && <em className={caller ? "ss-tag call" : isActor ? "ss-tag turn" : "ss-tag"}>{status}</em>}
          </small>
        </span>
        <span className="ss-opp-hand" title={`手里 ${player.handCount} 张`}>
          <CardBack className="tiny" />
          <b>{player.handCount}</b>
        </span>
        <span className="ss-opp-score" title="总分">
          <b>{player.score}</b>
          <small>总分</small>
        </span>
      </header>
      <div className="ss-opp-cards">
        {player.played.length === 0 && !player.revealed && <span className="ss-muted">面前还没有打出的牌</span>}
        <PlayedPairs pairs={player.played} fresh={fresh} />
        {player.revealed && player.hand.length > 0 && (
          <div className="ss-revealed" title="亮出的手牌（不能被偷）">
            {sortCards(player.hand).map((card) => <CardView key={card.id} card={card} className="mini" />)}
          </div>
        )}
      </div>
      <footer className="ss-opp-foot">
        <span>{player.revealed ? `卡牌分 ${points.total}` : `面前 ${points.total} 分`}</span>
        {player.revealed && <ColorCounts points={points} />}
      </footer>
      {stealable && <span className="ss-pick-hint">偷他一张</span>}
      <ToastView key={game.version} toast={toast} />
    </>
  );
  const style = { "--seat": seatColor(player.color) } as CSSProperties;
  return stealable ? (
    <button type="button" className={classes} style={style} onClick={onSteal}>{body}</button>
  ) : (
    <section className={classes} style={style} aria-label={`${player.name}的牌`}>{body}</section>
  );
}

/** 拿到这张牌，我的卡牌分会多几分（显示在可以拿的牌上）。 */
function gainOf(me: Player | undefined, card: Card): number {
  if (!me) return 0;
  return cardPoints([...me.hand, card], me.played).total - cardPoints(me.hand, me.played).total;
}

function gainBadge(gain: number): ReactNode {
  return <span className={gain > 0 ? "ss-gain up" : "ss-gain"}>{gain > 0 ? `+${gain} 分` : "+0"}</span>;
}

/** 鼠标悬停预览：拿到这张牌之后我的卡牌分。 */
function previewText(me: Player | undefined, cards: readonly Card[]): string {
  if (!me) return "";
  const before = cardPoints(me.hand, me.played).total;
  const after = cardPoints([...me.hand, ...cards], me.played).total;
  return after === before ? `拿了还是 ${after} 分` : `拿了 ${before} → ${after} 分`;
}

function GameBoard({ room, busy, error, notice, brand, connection, theme, themeToggle, chat, onCommand, onRematch, onDissolve }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const myId = member?.playerId ?? "";
  const isHost = member?.isHost ?? false;
  const myIndex = game.players.findIndex((player) => player.id === myId);
  const me = game.players[myIndex];
  const actor = game.players[game.actor];
  const playing = game.phase === "playing";
  const myMove = playing && game.actor === myIndex && myIndex !== -1;
  const stage = game.stage;
  const secondsLeft = useCountdown(room);
  const nameOf = (playerId: string) => (playerId === myId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const online = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId)?.connected ?? false;
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";
  const send = (command: GameCommand) => { if (!busy) onCommand(command); };

  // 只在 version 变了的时候播动画（聊天也会推整个房间状态）；刚进房间 / 重连时不播。
  const fresh = useMemo<Fresh>(
    () => (game.version === firstVersion.current ? { cards: new Set(), piles: new Set() } : freshFrom(game.events, myId)),
    [game.version],
  );
  const toasts = useMemo(() => (game.version === firstVersion.current ? new Map<string, Toast>() : toastsFrom(game.events)), [game.version]);

  // 对手：从自己的下一位开始按座位顺序。
  const opponents = useMemo(() => {
    const n = game.players.length;
    const start = Math.max(0, myIndex);
    return Array.from({ length: n - 1 }, (_, k) => (start + 1 + k) % n);
  }, [game.players.length, myIndex]);
  const revealedRows = opponents.some((index) => game.players[index]!.revealed && game.players[index]!.hand.length > 0) ? 1 : 0;
  const [tableRef, sizes, tableBox] = useSizes(revealedRows);
  const tableWidth = tableBox.width;

  const myPoints = me ? pointsOf(game, myIndex) : null;
  const hand = useMemo(() => (me ? sortCards(me.hand) : []), [game.version, me?.hand.length]);
  const pairs = useMemo(() => (me && myMove && stage === "play" ? playablePairs(me.hand) : []), [game.version, myMove, stage]);
  const pairCardIds = useMemo(() => {
    const ids = new Set<number>();
    if (!me || !myMove || stage !== "play") return ids;
    for (const card of me.hand) {
      if (card.type === "crab" || card.type === "boat" || card.type === "fish") {
        if (me.hand.filter((other) => other.type === card.type).length >= 2) ids.add(card.id);
      } else if ((card.type === "shark" && me.hand.some((other) => other.type === "swimmer")) || (card.type === "swimmer" && me.hand.some((other) => other.type === "shark"))) {
        ids.add(card.id);
      }
    }
    return ids;
  }, [game.version, myMove, stage]);
  const [hoverPair, setHoverPair] = useState<number[]>([]);
  const [keepPick, setKeepPick] = useState<number | null>(null);
  useEffect(() => setKeepPick(null), [game.version]);

  const thieves = myMove && stage === "steal" ? stealTargets(game, myIndex) : [];
  const declareOk = myIndex >= 0 && canDeclare(game, myIndex);
  const pileOptions = discardOptions(game);

  /** 打出手里这张牌所在的那一对（找一张能配的）。 */
  const playPairWith = (card: Card) => {
    if (!me) return;
    const partner = me.hand.find((other) =>
      other.id !== card.id && (card.type === "shark" ? other.type === "swimmer" : card.type === "swimmer" ? other.type === "shark" : other.type === card.type),
    );
    if (partner) send({ type: "PLAY_PAIR", cards: [card.id, partner.id] });
  };
  const keep = (card: Card, pile?: 0 | 1) => {
    if (pile !== undefined) send({ type: "KEEP", card: card.id, pile });
    else if (pileOptions.length === 1) send({ type: "KEEP", card: card.id, pile: pileOptions[0]! });
    else setKeepPick(card.id);
  };

  // 键盘：D 摸牌堆，1 / 2 拿左 / 右弃牌堆（打蟹时选堆），E 结束回合，S STOP，L 最后机会，N 下一轮。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (myMove && stage === "draw") {
        if (key === "d" && game.deckCount > 0) send({ type: "DRAW_DECK" });
        else if ((key === "1" || key === "2") && game.discardCounts[Number(key) - 1]! > 0) send({ type: "TAKE_DISCARD", pile: (Number(key) - 1) as 0 | 1 });
      } else if (myMove && stage === "crabPile" && (key === "1" || key === "2") && game.discardCounts[Number(key) - 1]! > 0) {
        send({ type: "CRAB_PILE", pile: (Number(key) - 1) as 0 | 1 });
      } else if (myMove && stage === "play") {
        if (key === "e") send({ type: "END_TURN" });
        else if (key === "s" && declareOk) send({ type: "STOP" });
        else if (key === "l" && declareOk) send({ type: "LAST_CHANCE" });
      } else if (stage === "roundEnd" && playing && key === "n" && !game.ready.includes(myId)) {
        send({ type: "READY" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 在后台时标题提示轮到你了
  useEffect(() => {
    const base = "海盐与纸 · 在线对战";
    const update = () => { document.title = myMove && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [myMove, game.version]);

  // 动作记录：断线重连后用 history 补上。
  const log = useMemo(() => {
    const lines: { key: string; text: string }[] = [];
    const history = game.history;
    const offset = game.version * 1000;
    history.forEach((event, index) => {
      const text = describeEvent(event, nameOf, myId);
      if (text) lines.push({ key: `${offset - history.length + index}`, text });
    });
    return lines.reverse();
  }, [game.version]);
  const [sideTab, setSideTab] = useState<"log" | "chat">("log");
  const [chatSeen, setChatSeen] = useState(room.chat.length);
  useEffect(() => { if (sideTab === "chat") setChatSeen(room.chat.length); }, [sideTab, room.chat.length]);
  const unread = sideTab === "chat" ? 0 : Math.max(0, room.chat.length - chatSeen);

  const [hideSummary, setHideSummary] = useState(false);
  useEffect(() => setHideSummary(false), [game.round, game.phase]);

  // ---------- 右上角：现在该谁做什么 ----------
  let headline = "";
  let detail = "";
  if (game.phase === "finished") headline = "对局结束";
  else if (stage === "roundEnd") {
    headline = `第 ${game.round} 轮结算`;
    detail = game.ready.includes(myId) ? `等其他人（${game.ready.length}/${game.players.length}）` : "看完结算点「下一轮」";
  } else if (myMove) {
    const final = game.call?.kind === "lastChance";
    switch (stage) {
      case "draw":
        headline = game.extraTurn ? "再来一回合：拿牌" : final ? "最后一回合：拿牌" : "轮到你：拿牌";
        detail = game.deckCount > 0 ? "从牌堆摸两张留一张，或者拿一个弃牌堆顶上的牌。" : "牌堆空了，只能拿弃牌堆顶上的牌。";
        break;
      case "keep":
        headline = "留哪一张？";
        detail = pileOptions.length === 1 ? `另一张会丢到${PILE_NAME[pileOptions[0]!]}（空的那一堆）。` : keepPick !== null ? "再点一个弃牌堆，把另一张丢进去。" : "点一张留下，另一张丢进你选的弃牌堆。";
        break;
      case "play":
        headline = final ? "最后一回合：出牌" : "轮到你：出牌";
        detail = final
          ? "打完这一回合就亮牌结算，不能再宣告。"
          : declareOk
            ? `你的卡牌分 ${myPoints?.total ?? 0}，可以宣告结束本轮了。`
            : `卡牌分到 ${game.config.declareAt} 分才能宣告（现在 ${myPoints?.total ?? 0}）。`;
        break;
      case "crabPile":
        headline = "两只蟹：看哪一堆？";
        detail = "选一个弃牌堆，翻看整堆，挑一张拿进手里。";
        break;
      case "crabPick":
        headline = `从${PILE_NAME[(game.crabPile ?? 0) as 0 | 1]}的弃牌堆挑一张`;
        detail = "别人不知道你拿了哪张。";
        break;
      case "steal":
        headline = "鲨鱼 + 泳者：偷谁？";
        detail = "从他手里随机偷一张（亮出的手牌不能偷）。";
        break;
    }
  } else if (actor) {
    const who = actor.name;
    switch (stage) {
      case "draw":
        headline = `轮到 ${who}`;
        detail = game.extraTurn ? `${who}打出两艘船，再来一回合` : `${who}在拿牌`;
        break;
      case "keep":
        headline = `${who} 在挑一张`;
        detail = "从牌堆摸了两张，留一张、丢一张";
        break;
      case "play":
        headline = `轮到 ${who}`;
        detail = `${who}在出牌`;
        break;
      case "crabPile":
      case "crabPick":
        headline = `${who} 在翻弃牌堆`;
        detail = "两只蟹：从弃牌堆挑一张";
        break;
      case "steal":
        headline = `${who} 要偷牌`;
        detail = "鲨鱼 + 泳者：从一位对手手里随机偷一张";
        break;
    }
  }

  const backdrop = theme === "day" ? art.beachDay : art.beachNight;
  const tableStyle = {
    "--cw": `${sizes.pw}px`,
    "--mw": `${sizes.mw}px`,
    "--backdrop": `url(${backdrop})`,
    "--bs": coverSize(tableBox.width, tableBox.height),
  } as CSSProperties;

  // 手牌：张数少时和中间的牌一样大；放不下就按张数缩小（最小 80px）；再放不下才叠起来（每张至少露出左边一条：名字和颜色）。
  const handWidth = Math.max(200, tableWidth - (sizes.mobile ? 24 : 52));
  const handGap = 6;
  const fitWidth = hand.length > 0 ? Math.floor((handWidth - (hand.length - 1) * handGap) / hand.length) : sizes.cw;
  const handCard = sizes.mobile ? sizes.cw : Math.max(80, Math.min(sizes.cw, Math.floor(fitWidth / 4) * 4));
  const natural = hand.length * handCard + Math.max(0, hand.length - 1) * handGap;
  const handStep = !sizes.mobile && hand.length > 1 && natural > handWidth ? Math.max(28, (handWidth - handCard) / (hand.length - 1)) : handCard + handGap;

  const crabCards = myMove && stage === "crabPick" && game.crabPile !== null ? game.discards[game.crabPile as 0 | 1] : [];

  // 宣告横幅：只在这次操作里有人宣告时出现（刚进房间 / 重连不弹），2.4 秒后自己消失。
  const announcement = useMemo(() => {
    if (game.version === firstVersion.current) return null;
    const event = game.events.find((item) => item.type === "Announced");
    return event?.type === "Announced" ? event : null;
  }, [game.version]);
  const [bannerOn, setBannerOn] = useState(false);
  useEffect(() => {
    if (!announcement) return;
    setBannerOn(true);
    const timer = window.setTimeout(() => setBannerOn(false), 2400);
    return () => window.clearTimeout(timer);
  }, [announcement]);
  const callChip = game.call && playing && stage !== "roundEnd"
    ? `${nameOf(game.players[game.call.player]!.id)}宣告了${game.call.kind === "lastChance" ? "最后机会" : "STOP"}`
    : null;

  const pileNode = (pile: 0 | 1) => {
    const top = game.discards[pile].at(-1);
    const count = game.discardCounts[pile];
    const canTake = myMove && stage === "draw" && count > 0;
    const canCrab = myMove && stage === "crabPile" && count > 0;
    const canDump = myMove && stage === "keep" && keepPick !== null && pileOptions.includes(pile);
    const onClick = canTake
      ? () => send({ type: "TAKE_DISCARD", pile })
      : canCrab
        ? () => send({ type: "CRAB_PILE", pile })
        : canDump
          ? () => send({ type: "KEEP", card: keepPick!, pile })
          : undefined;
    const badge = canTake && top ? gainBadge(gainOf(me, top)) : canCrab ? "看这一堆" : canDump ? "丢这里" : null;
    const highlight = (myMove && stage === "keep" && keepPick === null && pileOptions.length === 1 && pileOptions[0] === pile) || (myMove && stage === "crabPick" && game.crabPile === pile);
    return (
      <div className={["ss-pile", fresh.piles.has(pile) ? "fresh" : "", highlight ? "marked" : ""].join(" ")} key={pile}>
        {top ? (
          <CardView
            card={top}
            className={onClick ? "pickable" : ""}
            onClick={onClick}
            disabled={busy}
            badge={badge}
            title={canTake && me ? `${cardLabel(top)}：${previewText(me, [top])}` : undefined}
          />
        ) : canDump ? (
          <button type="button" className="ss-card empty pickable" onClick={onClick} disabled={busy}><span className="ss-card-badge">丢这里</span></button>
        ) : (
          <span className="ss-card empty"><small>空</small></span>
        )}
        <span className="ss-pile-label">{PILE_NAME[pile]}弃牌堆 <b>{count}</b></span>
      </div>
    );
  };

  return (
    <div className={sizes.mobile ? "ss-screen mobile" : "ss-screen"}>
      <header className="ss-topbar">
        {brand}
        <div className="ss-round">
          <span>第 <b>{game.round}</b> 轮</span>
          <span className="ss-goal">先到 <b>{game.config.targetScore}</b> 分</span>
          {callChip && <span className="ss-call-chip">{callChip}</span>}
        </div>
        <div className="ss-topbar-right">
          {themeToggle}
          <GameRules />
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>

      <div className="ss-layout">
        <div className={["ss-table", sizes.pw < 92 ? "small-cards" : "", sizes.pw >= 168 ? "double-art" : ""].join(" ")} ref={tableRef} style={tableStyle}>
          <div className={`ss-opps n${opponents.length}`}>
            {opponents.map((index) => (
              <OpponentPanel
                key={game.players[index]!.id}
                game={game}
                index={index}
                online={online(game.players[index]!.id)}
                fresh={fresh}
                toast={toasts.get(game.players[index]!.id)}
                stealable={thieves.includes(index)}
                onSteal={() => send({ type: "STEAL", target: game.players[index]!.id })}
              />
            ))}
          </div>

          <div className="ss-center">
            <div className="ss-deck">
              {game.deckCount > 0 ? (
                myMove && stage === "draw" ? (
                  <button type="button" className="ss-card back pickable" onClick={() => send({ type: "DRAW_DECK" })} disabled={busy} title="从牌堆摸两张，留一张，另一张丢进弃牌堆">
                    <img src={art.emblem} alt="" />
                    <span className="ss-card-badge">摸两张</span>
                  </button>
                ) : (
                  <CardBack />
                )
              ) : (
                <span className="ss-card empty"><small>空</small></span>
              )}
              <span className="ss-pile-label">牌堆 <b>{game.deckCount}</b></span>
            </div>
            {pileNode(0)}
            {pileNode(1)}

            {stage === "keep" && (
              <div className="ss-choice">
                {myMove ? (
                  game.drawn.map((card) => (
                    <CardView
                      key={card.id}
                      card={card}
                      className={["pickable", "fresh", keepPick === card.id ? "chosen" : ""].join(" ")}
                      onClick={() => keep(card)}
                      disabled={busy}
                      badge={keepPick === card.id ? "留这张" : gainBadge(gainOf(me, card))}
                      title={`${cardLabel(card)}：${previewText(me, [card])}`}
                    />
                  ))
                ) : (
                  Array.from({ length: game.drawnCount }, (_, k) => <CardBack key={k} className="fresh" />)
                )}
                <span className="ss-choice-label">{myMove ? "摸到的两张" : `${actor?.name ?? ""} 摸到的两张`}</span>
              </div>
            )}
          </div>

          {crabCards.length > 0 && (
            <div className="ss-crab">
              <header>
                <h3>{PILE_NAME[(game.crabPile ?? 0) as 0 | 1]}的弃牌堆：挑一张</h3>
                <span className="ss-muted">{crabCards.length} 张，从最早丢的排到堆顶；牌上是拿了之后多几分</span>
              </header>
              <div className="ss-crab-cards">
                {crabCards.map((card) => (
                  <CardView
                    key={card.id}
                    card={card}
                    className="pickable"
                    onClick={() => send({ type: "CRAB_TAKE", card: card.id })}
                    disabled={busy}
                    badge={gainBadge(gainOf(me, card))}
                    title={`${cardLabel(card)}：${previewText(me, [card])}`}
                  />
                ))}
              </div>
            </div>
          )}

          {me && (
            <section className={["ss-me", myMove ? "actor" : "", me.revealed ? "revealed" : ""].join(" ")} style={{ "--seat": seatColor(me.color) } as CSSProperties}>
              <header className="ss-me-head">
                <Avatar player={me} />
                <span className="ss-me-name">
                  <strong>{me.name}（你）</strong>
                  <small>
                    {me.revealed && game.call && stage !== "roundEnd" ? <em className="ss-tag call">手牌已亮出，不会被偷</em> : <em className="ss-tag">手里 {me.handCount} 张</em>}
                    {game.finalTurns.includes(myIndex) && <em className="ss-tag turn">你还有最后一回合</em>}
                  </small>
                </span>
                {myPoints && (
                  <span className="ss-me-points" title="卡牌分 = 对子 + 收集 + 乘数 + 美人鱼（手牌和面前一起算）">
                    <span className="ss-big"><small>卡牌分</small><b className={declareOk ? "ok" : ""}>{myPoints.total}</b></span>
                    <span className="ss-parts">
                      <span>对子 {myPoints.pairs}</span>
                      <span>收集 {myPoints.collectors}</span>
                      <span>乘数 {myPoints.multipliers}</span>
                      <span>美人鱼 {myPoints.mermaids}</span>
                    </span>
                    <span className="ss-bonus" title="颜色奖励：数量最多的那种颜色有几张（只在「最后机会」时算）">
                      <small>颜色奖励 {myPoints.colorBonus}</small>
                      <ColorCounts points={myPoints} />
                    </span>
                  </span>
                )}
                <span className="ss-opp-score ss-me-total"><b>{me.score}</b><small>总分</small></span>
              </header>
              <ToastView key={game.version} toast={toasts.get(me.id)} />
              <div className="ss-me-played">
                {me.played.length > 0 ? <PlayedPairs pairs={me.played} fresh={fresh} /> : <span className="ss-muted">打出的对子摆在这里</span>}
              </div>
              <div className={handCard < 92 ? "ss-hand small-cards" : "ss-hand normal-cards"} style={{ "--step": `${handStep}px`, "--cw": `${handCard}px` } as CSSProperties}>
                {hand.length === 0 && <span className="ss-muted">手里还没有牌</span>}
                {hand.map((card) => {
                  const inPair = pairCardIds.has(card.id);
                  const lifted = hoverPair.includes(card.id);
                  return (
                    <CardView
                      key={card.id}
                      card={card}
                      className={[fresh.cards.has(card.id) ? "fresh" : "", inPair ? "pickable" : "", lifted ? "lifted" : "", myMove && stage === "play" && !inPair ? "idle" : ""].join(" ")}
                      onClick={inPair ? () => playPairWith(card) : undefined}
                      disabled={busy}
                      badge={inPair && lifted ? "打出" : undefined}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {bannerOn && announcement && (
            <div className={`ss-banner ${announcement.call}`} role="status">
              <b>{announcement.player === myId ? "你" : nameOf(announcement.player)}宣告{announcement.call === "stop" ? " STOP！" : "最后机会！"}</b>
              <small>{announcement.call === "stop" ? "本轮立刻结束，每人拿卡牌分" : `卡牌分 ${announcement.points}，赌自己最高；其他人各打最后一回合`}</small>
            </div>
          )}

          {stage === "roundEnd" && playing && !hideSummary && (
            <RoundSummary game={game} myId={myId} secondsLeft={secondsLeft} busy={busy} onReady={() => send({ type: "READY" })} onHide={() => setHideSummary(true)} />
          )}
        </div>

        <aside className="ss-side">
          <section className={myMove || (stage === "roundEnd" && playing && !game.ready.includes(myId)) ? "ss-panel ss-action mine" : "ss-panel ss-action"}>
            <div className="ss-action-head">
              {actor && stage !== "roundEnd" && <i className="ss-dot" style={{ background: seatColor(actor.color) }} />}
              <h2>{headline}</h2>
              {playing && secondsLeft !== null && <b className={secondsLeft <= 10 ? "ss-timer low" : "ss-timer"}>{secondsLeft}s</b>}
            </div>
            {detail && <p className="ss-action-detail">{detail}</p>}

            {myMove && stage === "draw" && (
              <div className="ss-buttons">
                {game.deckCount > 0 && (
                  <button className="primary-button" type="button" disabled={busy} onClick={() => send({ type: "DRAW_DECK" })}>摸两张<small>D</small></button>
                )}
                {([0, 1] as const).map((pile) => {
                  const top = game.discards[pile].at(-1);
                  if (!top) return null;
                  return (
                    <button key={pile} className="quiet-button ss-take" type="button" disabled={busy} onClick={() => send({ type: "TAKE_DISCARD", pile })} title={previewText(me, [top])}>
                      <span className="ss-swatch" style={colorStyle(top.color)} />拿{PILE_NAME[pile]}的{CARD_NAMES[top.type]}<small>{pile + 1}</small>
                    </button>
                  );
                })}
              </div>
            )}
            {myMove && stage === "keep" && pileOptions.length > 1 && (
              <div className="ss-keep-list">
                {game.drawn.map((card) => (
                  <div key={card.id} className={keepPick === card.id ? "ss-keep-row chosen" : "ss-keep-row"}>
                    <span className="ss-swatch" style={colorStyle(card.color)} />
                    <span>留{cardLabel(card)}，另一张丢</span>
                    <button className="quiet-button" type="button" disabled={busy} onClick={() => keep(card, 0)}>左</button>
                    <button className="quiet-button" type="button" disabled={busy} onClick={() => keep(card, 1)}>右</button>
                  </div>
                ))}
              </div>
            )}
            {myMove && stage === "play" && (
              <>
                {pairs.length > 0 && (
                  <div className="ss-pair-buttons">
                    {pairs.map(([a, b]) => {
                      const effect = a.type === "shark" || a.type === "swimmer" ? "steal" : (a.type as PairEffect);
                      return (
                        <button
                          key={`${a.id}-${b.id}`}
                          className="quiet-button ss-pair-button"
                          type="button"
                          disabled={busy}
                          onClick={() => send({ type: "PLAY_PAIR", cards: [a.id, b.id] })}
                          onMouseEnter={() => setHoverPair([a.id, b.id])}
                          onMouseLeave={() => setHoverPair([])}
                          onFocus={() => setHoverPair([a.id, b.id])}
                          onBlur={() => setHoverPair([])}
                        >
                          <span className="ss-pair-icons"><img src={art.cardSmall(a.type)} alt="" /><img src={art.cardSmall(b.type)} alt="" /></span>
                          <span>打出{PAIR_NAME[effect]}<small>{EFFECT_TEXT[effect]}</small></span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {declareOk && (
                  <div className="ss-declare">
                    <button className="quiet-button ss-stop" type="button" disabled={busy} onClick={() => send({ type: "STOP" })} title="本轮立刻结束，所有人拿自己的卡牌分">
                      STOP<small>立刻结算 · S</small>
                    </button>
                    <button className="quiet-button ss-last" type="button" disabled={busy} onClick={() => send({ type: "LAST_CHANCE" })} title="其他人各再打一回合；你分最高（平分也算）就拿卡牌分 + 颜色奖励，他们只拿颜色奖励；否则反过来">
                      最后机会<small>赌你最高 · L</small>
                    </button>
                  </div>
                )}
                <div className="ss-buttons">
                  <button className={declareOk || pairs.length > 0 ? "quiet-button" : "primary-button"} type="button" disabled={busy} onClick={() => send({ type: "END_TURN" })}>
                    结束回合<small>E</small>
                  </button>
                </div>
              </>
            )}
            {myMove && stage === "crabPile" && (
              <div className="ss-buttons">
                {([0, 1] as const).map((pile) => game.discardCounts[pile] > 0 && (
                  <button key={pile} className="primary-button" type="button" disabled={busy} onClick={() => send({ type: "CRAB_PILE", pile })}>
                    看{PILE_NAME[pile]}<small>{game.discardCounts[pile]} 张 · {pile + 1}</small>
                  </button>
                ))}
              </div>
            )}
            {myMove && stage === "steal" && (
              <div className="ss-buttons">
                {thieves.map((index) => {
                  const player = game.players[index]!;
                  return (
                    <button key={player.id} className="primary-button" type="button" disabled={busy} onClick={() => send({ type: "STEAL", target: player.id })}>
                      偷{player.name}<small>手里 {player.handCount} 张</small>
                    </button>
                  );
                })}
              </div>
            )}
            {stage === "roundEnd" && playing && (
              <div className="ss-buttons">
                <button className="primary-button" type="button" disabled={busy || game.ready.includes(myId)} onClick={() => send({ type: "READY" })}>
                  {game.ready.includes(myId) ? "已准备" : "下一轮"}<small>N</small>
                </button>
                {hideSummary && <button className="quiet-button" type="button" onClick={() => setHideSummary(false)}>看结算</button>}
              </div>
            )}
            {(error || shownNotice) && <p className={error ? "ss-feedback error" : "ss-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}
          </section>

          <section className="ss-panel ss-tabs">
            <div className="ss-tab-bar" role="tablist">
              <button type="button" role="tab" aria-selected={sideTab === "log"} className={sideTab === "log" ? "active" : ""} onClick={() => setSideTab("log")}>动作记录</button>
              <button type="button" role="tab" aria-selected={sideTab === "chat"} className={sideTab === "chat" ? "active" : ""} onClick={() => setSideTab("chat")}>
                聊天{unread > 0 && <em>{unread}</em>}
              </button>
            </div>
            {sideTab === "log" ? (
              <ul className="ss-log">{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>
            ) : (
              <div className="ss-chat">{chat}</div>
            )}
          </section>
        </aside>
      </div>
      {game.phase === "finished" && <FinalDialog game={game} room={room} myId={myId} onRematch={onRematch} />}
    </div>
  );
}

function scoreReason(game: GameState, index: number): string {
  const result = game.players[index]!.lastRound;
  if (!result) return "";
  switch (result.scored) {
    case "none":
      return "牌堆摸空，不计分";
    case "cards":
      return game.call?.kind === "lastChance" ? `宣告者赌输了，拿卡牌分 ${result.cardPoints}` : `卡牌分 ${result.cardPoints}`;
    case "cards+bonus":
      return `赌赢了：卡牌分 ${result.cardPoints} + 颜色奖励 ${result.colorBonus}`;
    case "bonus":
      return index === game.call?.player ? `赌输了：只拿颜色奖励 ${result.colorBonus}` : `只拿颜色奖励 ${result.colorBonus}`;
  }
}

function RoundSummary({ game, myId, secondsLeft, busy, onReady, onHide }: {
  game: GameState;
  myId: string;
  secondsLeft: number | null;
  busy: boolean;
  onReady: () => void;
  onHide: () => void;
}) {
  const rows = game.players.map((player, index) => ({ player, index }));
  const target = game.config.targetScore;
  const ready = game.ready.includes(myId);
  const reason = game.players[0]!.lastRound?.reason;
  const caller = game.call ? game.players[game.call.player]! : null;
  const betWon = caller && game.call?.kind === "lastChance" ? caller.lastRound?.scored === "cards+bonus" : null;
  const title = reason === "emptyDeck"
    ? "牌堆摸空了：这一轮不计分"
    : reason === "stop"
      ? `${caller?.id === myId ? "你" : caller?.name}宣告 STOP：每人拿卡牌分`
      : `${caller?.id === myId ? "你" : caller?.name}的最后机会${betWon ? "赌赢了！" : "赌输了"}`;
  return (
    <section className="ss-summary" aria-label={`第 ${game.round} 轮结算`}>
      <header>
        <h2>第 {game.round} 轮 · {title}</h2>
        <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
      </header>
      <ol>
        {rows.map(({ player, index }) => {
          const result = player.lastRound!;
          const points = cardPoints(player.hand, player.played);
          return (
            <li key={player.id} className={player.id === myId ? "mine" : ""}>
              <div className="ss-sum-who">
                <i className="ss-dot" style={{ background: seatColor(player.color) }} />
                <strong>{player.name}{player.id === myId ? "（你）" : ""}</strong>
                <small>对子 {points.pairs} · 收集 {points.collectors} · 乘数 {points.multipliers} · 美人鱼 {points.mermaids} · 颜色奖励 {points.colorBonus}</small>
              </div>
              <div className="ss-sum-cards">
                {player.played.flat().map((card) => <CardView key={card.id} card={card} className="mini" />)}
                {player.played.length > 0 && player.hand.length > 0 && <span className="ss-sum-gap" />}
                {sortCards(player.hand).map((card) => <CardView key={card.id} card={card} className="mini" />)}
              </div>
              <div className="ss-sum-score">
                <b className={result.score === 0 ? "zero" : ""}>+{result.score}</b>
                <small>{scoreReason(game, index)}</small>
              </div>
              <div className="ss-sum-total">
                <strong>{player.score}</strong>
                <span className="ss-bar"><i style={{ width: `${Math.max(0, Math.min(100, (player.score / target) * 100))}%` }} /></span>
              </div>
            </li>
          );
        })}
      </ol>
      <footer>
        <span className="ss-muted">先到 {target} 分的那一轮打完，总分最高者获胜</span>
        <button className="primary-button" type="button" disabled={busy || ready} onClick={onReady}>
          {ready ? `等其他人 ${game.ready.length}/${game.players.length}` : "下一轮"}{secondsLeft !== null && <small>{secondsLeft}s</small>}
        </button>
      </footer>
    </section>
  );
}

function FinalDialog({ game, room, myId, onRematch }: { game: GameState; room: LobbyRoomSnapshot; myId: string; onRematch: (accept: boolean) => void }) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const won = (id: string) => result.winners.includes(id);
  // 获胜者排最前（四美人鱼直接获胜时总分不一定最高），其余按总分、再按最后一轮。
  const rows = [...game.players].sort((a, b) => Number(won(b.id)) - Number(won(a.id)) || b.score - a.score || (b.rounds.at(-1) ?? 0) - (a.rounds.at(-1) ?? 0));
  const winnerNames = result.winners.map((id) => (id === myId ? "你" : game.players.find((p) => p.id === id)?.name)).join("、");
  const title = won(myId) ? (result.winners.length > 1 ? "并列获胜！" : "你赢了！") : `${winnerNames} 获胜`;
  const tie = !result.mermaids && result.winners.length === 1 && rows.filter((player) => player.score === rows[0]!.score).length > 1;
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel ss-final" role="dialog" aria-modal="true" aria-labelledby="ss-final-title">
        <img className="ss-final-icon" src={art.card(result.mermaids ? "mermaid" : "lighthouse")} alt="" />
        <h2 id="ss-final-title">{title}</h2>
        <p className="ss-muted">
          {result.mermaids
            ? `${winnerNames}集齐了 4 张美人鱼，直接获胜。`
            : `打了 ${game.round} 轮，有人到了 ${game.config.targetScore} 分，总分最高者获胜${tie ? "（总分一样，比最后一轮的得分）" : ""}。`}
        </p>
        <ol className="ss-standings">
          {rows.map((player, rank) => (
            <li key={player.id} className={won(player.id) ? "winner" : ""}>
              <span className="ss-rank">{rank + 1}</span>
              <i className="ss-dot" style={{ background: seatColor(player.color) }} />
              <strong>{player.name}{player.id === myId ? "（你）" : ""}</strong>
              <small>{result.mermaids && won(player.id) ? "四张美人鱼" : `最后一轮 +${player.rounds.at(-1) ?? 0}`}</small>
              <b>{player.score}</b>
            </li>
          ))}
        </ol>
        {room.rematch && (
          <div className="ss-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
