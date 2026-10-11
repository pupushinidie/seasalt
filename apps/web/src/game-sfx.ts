import { useEffect, useRef } from "react";
import type { GameEvent, GameState, PairEffect } from "@seasalt/game";
import { sfx, synth } from "./gm-sound.js";

/**
 * 海盐与纸的动作音效：每次对局 version 变了，按这一步引擎给的 events（game.events）挨个配声音，
 * 时间上错开一点，听起来像一个动作的结果。自己的动作响亮，别人的减半（mine=false）；观战的人听到的都算别人的。
 *
 * 第一次拿到对局（进房间、重连、观战刚进来、练习局重开）不出声；version 一下跳了好几步（断线回来）只提示轮到你。
 * 共用的声音在 gm-sound.tsx（不要改它）；这里用 synth 组合了几个这款游戏自己的：
 * 海浪（新一轮洗牌）、船钟（两艘船）、溅水（两条鱼）、蟹钳（两只蟹）、汽笛（STOP / 最后机会）、竖琴刮奏（集齐美人鱼）。
 */

const { tone, noise, level, jitter } = synth;

/** 开发时把响过的声音名字记在 window.__sfxLog，方便自测脚本确认「响了、响的是哪个」。 */
function logSfx(name: string) {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __sfxLog?: string[] };
    (w.__sfxLog ??= []).push(name);
  }
}

function at(ms: number, name: string, play: () => void) {
  const run = () => {
    logSfx(name);
    play();
  };
  if (ms <= 0) run();
  else window.setTimeout(run, ms);
}

// ---------- 这款游戏的招牌声音 ----------

export const seaSfx = {
  /** 海浪涌上来再退下去：新一轮洗牌的时候。 */
  wave() {
    noise({ duration: 0.7, volume: 0.13, filter: "lowpass", freq: 350, freqTo: 1700, q: 0.5 });
    noise({ at: 0.5, duration: 0.9, volume: 0.11, filter: "lowpass", freq: 1700, freqTo: 250, q: 0.5 });
    noise({ at: 0.55, duration: 0.6, volume: 0.04, filter: "highpass", freq: 4500, freqTo: 2500 });
  },
  /** 船钟「叮——叮」：两艘船，再来一回合。 */
  bell(mine: boolean) {
    const v = level(mine);
    for (const start of [0, 0.32]) {
      tone(1046 * jitter(0.01), { at: start, duration: 0.9, volume: 0.13 * v, type: "sine" });
      tone(2637, { at: start, duration: 0.5, volume: 0.05 * v, type: "sine" });
      tone(3951, { at: start, duration: 0.25, volume: 0.025 * v, type: "sine" });
      noise({ at: start, duration: 0.02, volume: 0.12 * v, filter: "highpass", freq: 5000 });
    }
  },
  /** 溅水 + 几个气泡：两条鱼。 */
  splash(mine: boolean) {
    const v = level(mine);
    noise({ duration: 0.28, volume: 0.22 * v, filter: "highpass", freq: 5200, freqTo: 1400, q: 0.6 });
    noise({ at: 0.02, duration: 0.2, volume: 0.12 * v, filter: "lowpass", freq: 900, freqTo: 300 });
    [0.18, 0.27, 0.33].forEach((t, i) => tone(380 + i * 140, { at: t, duration: 0.07, volume: 0.07 * v, glideTo: 900 + i * 200 }));
  },
  /** 蟹钳「咔嚓咔嚓」：两只蟹。 */
  pinch(mine: boolean) {
    const v = level(mine);
    for (const t of [0, 0.11]) {
      noise({ at: t, duration: 0.025, volume: 0.3 * v, freq: 4200 * jitter(0.1), q: 3 });
      tone(2300 * jitter(0.05), { at: t, duration: 0.035, volume: 0.08 * v, type: "square" });
    }
  },
  /** 鲨鱼冲过来：一声低沉的「嗖」再咬一口。 */
  shark(mine: boolean) {
    const v = level(mine);
    noise({ duration: 0.25, volume: 0.18 * v, filter: "bandpass", freq: 600, freqTo: 2400, q: 0.7 });
    tone(90, { at: 0.18, duration: 0.25, volume: 0.25 * v, type: "triangle", glideTo: 55 });
  },
  /** 汽笛：STOP 是两声短的，最后机会是一声长的、尾巴往上挑。 */
  horn(kind: "stop" | "lastChance", mine: boolean) {
    const v = level(mine);
    const blasts: [number, number][] = kind === "stop" ? [[0, 0.32], [0.42, 0.42]] : [[0, 0.95]];
    for (const [start, length] of blasts) {
      tone(110, { at: start, duration: length, volume: 0.2 * v, type: "triangle" });
      tone(165, { at: start, duration: length, volume: 0.1 * v, type: "triangle" });
      tone(220, { at: start, duration: length, volume: 0.035 * v, type: "square" });
    }
    if (kind === "lastChance") {
      // 「赌一把」：高处两下问号似的上扬
      tone(784, { at: 0.9, duration: 0.14, volume: 0.11 * v, type: "triangle", glideTo: 988 });
      tone(988, { at: 1.04, duration: 0.24, volume: 0.11 * v, type: "triangle", glideTo: 1319 });
    }
  },
  /** 竖琴刮奏：集齐 4 张美人鱼，直接获胜。 */
  harp(mine: boolean) {
    const v = level(mine);
    [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760, 2093].forEach((f, i) =>
      tone(f, { at: i * 0.045, duration: 0.6, volume: 0.08 * v, type: "triangle" }),
    );
  },
  /** 别人在结算画面点了「下一轮」：很轻的一下。 */
  readyTick() {
    tone(1175, { duration: 0.06, volume: 0.05, type: "triangle" });
  },
};

const PAIR_SOUND: Record<PairEffect, { name: string; play: (mine: boolean) => void }> = {
  crab: { name: "pinch", play: seaSfx.pinch },
  boat: { name: "bell", play: seaSfx.bell },
  fish: { name: "splash", play: seaSfx.splash },
  steal: { name: "shark", play: seaSfx.shark },
};

/** 一步里的事件 → 一串错开的声音；最后接上回合交接（轮到你 / 交出回合）。 */
function playEvents(events: readonly GameEvent[], game: GameState, myId: string, actorBefore: string | null): void {
  const mine = (id: string | undefined) => !!myId && id === myId;
  let t = 0;
  const ended = events.some((event) => event.type === "GameEnded");
  const announced = new Set(events.flatMap((event) => (event.type === "Announced" ? [event.player] : [])));

  for (const event of events) {
    switch (event.type) {
      case "RoundStarted":
        if (event.round > 1) at(t, "roundStart", () => sfx.roundStart());
        at(t + 100, "wave", () => seaSfx.wave());
        at(t + 250, "shuffle", () => sfx.shuffle());
        at(t + 650, "flip", () => sfx.flip(false));
        at(t + 800, "flip", () => sfx.flip(false));
        t += 1000;
        break;
      case "TurnStarted":
        break; // 回合交接放在最后统一处理
      case "DrewDeck":
        at(t, "draw", () => sfx.draw(mine(event.player), event.count));
        t += 220;
        break;
      case "Kept":
        if (event.discarded) {
          at(t, "card", () => sfx.card(mine(event.player)));
          t += 200;
        }
        break;
      case "TookDiscard":
        at(t, "draw", () => sfx.draw(mine(event.player), 1));
        t += 200;
        break;
      case "PlayedPair": {
        const sound = PAIR_SOUND[event.effect];
        at(t, "card", () => sfx.card(mine(event.player), 2));
        at(t + 160, sound.name, () => sound.play(mine(event.player)));
        t += event.effect === "boat" ? 800 : 520;
        break;
      }
      case "EffectSkipped":
        at(t, "pass", () => sfx.pass(mine(event.player)));
        t += 250;
        break;
      case "CrabPile":
        at(t, "flip", () => sfx.flip(mine(event.player)));
        t += 200;
        break;
      case "CrabTook":
      case "FishDrew":
        at(t, "draw", () => sfx.draw(mine(event.player), 1));
        t += 200;
        break;
      case "Stole": {
        // 偷的人是我、或者被偷的是我：都算「我的事」，响亮一点。
        const loud = mine(event.player) || mine(event.from);
        at(t, "hit", () => sfx.hit(loud));
        at(t + 180, "draw", () => sfx.draw(loud, 1));
        t += 380;
        break;
      }
      case "Announced":
        at(t, `horn-${event.call}`, () => seaSfx.horn(event.call, mine(event.player)));
        t += event.call === "stop" ? 950 : 1300;
        break;
      case "Revealed":
        // 宣告最后机会时紧跟着的亮牌，汽笛已经够了
        if (announced.has(event.player)) break;
        at(t, "reveal", () => sfx.reveal(mine(event.player)));
        t += 350;
        break;
      case "TurnTimedOut":
        if (mine(event.player)) {
          at(t, "timeout", () => sfx.timeout());
          t += 400;
        }
        break;
      case "RoundEnded": {
        if (ended) break; // 终局的音乐盖过这一轮的结算
        t += 150;
        if (event.reason === "emptyDeck") {
          at(t, "pass", () => sfx.pass(false));
          t += 300;
          break;
        }
        const row = event.scores.find((score) => mine(score.player));
        if (event.reason === "lastChance" && event.caller && mine(event.caller)) {
          if (event.betWon) at(t, "sparkle", () => sfx.sparkle(true));
          else at(t, "bust", () => sfx.bust(true));
          t += 450;
        } else if (row) {
          at(t, "score", () => sfx.score(true, row.score >= 7));
          t += 400;
        } else {
          at(t, "score", () => sfx.score(false));
          t += 400;
        }
        break;
      }
      case "MermaidWin":
        at(t, "harp", () => seaSfx.harp(mine(event.player)));
        t += 900;
        break;
      case "GameEnded": {
        t += 250;
        if (myId) {
          const won = event.winners.includes(myId);
          at(t, won ? "gameOver-win" : "gameOver-lose", () => sfx.gameOver(won));
        } else {
          at(t, "score", () => sfx.score(false, true));
        }
        t += 600;
        break;
      }
    }
  }

  // 回合交接：这一步最后开始的回合是谁的。
  if (ended || game.stage === "roundEnd") return;
  const turn = [...events].reverse().find((event) => event.type === "TurnStarted");
  if (!turn || turn.type !== "TurnStarted") return;
  if (mine(turn.player)) at(t + 150, "yourTurn", () => sfx.yourTurn());
  else if (mine(actorBefore ?? undefined)) at(t + 80, "turnPassed", () => sfx.turnPassed());
}

/**
 * 牌桌上调用：game 是当前（已经按自己视角处理过的）对局，myId 是自己的座位 id（观战传空字符串）。
 */
export function useGameSfx(game: GameState, myId: string) {
  const prev = useRef<{ version: number; ready: number; actor: string | null } | null>(null);
  useEffect(() => {
    const before = prev.current;
    const actor = game.players[game.actor]?.id ?? null;
    prev.current = { version: game.version, ready: game.ready.length, actor };
    if (!before || game.version === before.version) return;
    const jump = game.version - before.version;
    if (jump < 0 || jump > 3) {
      // 断线回来、一下跳了好几步：不补放，只在轮到自己时提示一声
      if (myId && actor === myId && game.phase === "playing" && game.stage !== "roundEnd") at(150, "yourTurn", () => sfx.yourTurn());
      return;
    }
    if (game.events.length === 0) {
      // 结算画面里有人点了「下一轮」（自己点的按钮已经响过了）
      if (game.ready.length > before.ready && game.ready.at(-1) !== myId) at(0, "ready", () => seaSfx.readyTick());
      return;
    }
    playEvents(game.events, game, myId, before.actor);
  }, [game.version]);
}

/** 选中 / 点了不能点的：在牌桌的点击处理里调。 */
export const uiSfx = {
  select(on = true) {
    logSfx(on ? "select" : "unselect");
    sfx.select(on);
  },
  deny() {
    logSfx("deny");
    sfx.deny();
  },
};
