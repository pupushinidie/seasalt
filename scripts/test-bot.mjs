#!/usr/bin/env node
/**
 * 海盐与纸陪玩机器人（本地联调、线上在服务器上连 localhost 测试用）。先 npm run build:game（规则包的 dist）。
 *
 * 用法：
 *   node scripts/test-bot.mjs host <昵称> [人数=4] [--start-at=N]   建房，打印房间码；给了 --start-at 就在凑够 N 人时自动开局
 *   node scripts/test-bot.mjs join <房间码> <昵称>                   加入房间
 *   node scripts/test-bot.mjs fill <房间码> <人数> [昵称前缀=机器人]  一次加入好几个机器人
 *
 * 环境变量：BOT_URL（默认 http://localhost:3011）、BOT_DELAY（每步之前等多少毫秒，默认 700）、
 *          BOT_PATH（socket.io 路径，默认 /socket.io）、BOT_REMATCH=0（终局后不同意再来一局）、
 *          BOT_CALL=stop|last|none（卡牌分够 7 时怎么宣告；默认随机：STOP 多、最后机会少）。
 * 策略：弃牌堆顶的牌能多拿 2 分以上（或是美人鱼）就拿，否则从牌堆摸；留分高的那张；能打的对子都打（船最后打）；
 *      蟹挑分最高的牌，偷手牌最多的对手。每次 ack 之后都按最新状态重新判断。
 */
import { io } from "socket.io-client";
import { cardPoints, legalActions, playablePairs, timeoutCommand } from "@seasalt/game";

const URL = process.env.BOT_URL ?? "http://localhost:3011";
const DELAY = Number(process.env.BOT_DELAY ?? 700);
const PATH = process.env.BOT_PATH ?? "/socket.io";
const CALL = process.env.BOT_CALL ?? "random";

const [mode, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg) => !arg.startsWith("--"));
const startAt = Number([...flags].find((flag) => flag.startsWith("--start-at="))?.split("=")[1] ?? 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decide(game, me) {
  const myIndex = game.players.findIndex((player) => player.id === me);
  const player = game.players[myIndex];
  const legal = legalActions(game, me);
  if (legal.length === 0) return null;
  const now = cardPoints(player.hand, player.played).total;
  if (game.stage === "draw") {
    let best = null;
    for (const pile of [0, 1]) {
      const top = game.discards[pile].at(-1);
      if (!top) continue;
      const gain = cardPoints([...player.hand, top], player.played).total - now;
      if (top.type === "mermaid" || gain >= 2 || game.deckCount === 0) {
        if (!best || gain > best.gain) best = { pile, gain };
      }
    }
    if (best) return { type: "TAKE_DISCARD", pile: best.pile };
    return legal[0];
  }
  if (game.stage === "play") {
    const pairs = playablePairs(player.hand);
    const order = ["fish", "crab", "shark", "swimmer", "boat"];
    pairs.sort((a, b) => order.indexOf(a[0].type) - order.indexOf(b[0].type));
    if (pairs.length > 0) return { type: "PLAY_PAIR", cards: [pairs[0][0].id, pairs[0][1].id] };
    if (legal.some((command) => command.type === "STOP")) {
      if (CALL === "stop") return { type: "STOP" };
      if (CALL === "last") return { type: "LAST_CHANCE" };
      if (CALL === "random") {
        const roll = Math.random();
        if (roll < 0.45) return { type: "STOP" };
        if (roll < 0.7) return { type: "LAST_CHANCE" };
      }
    }
    return { type: "END_TURN" };
  }
  return timeoutCommand(game);
}

function runBot(name, setup) {
  const socket = io(URL, { path: PATH, transports: ["websocket"], reconnection: true });
  let room = null;
  let acting = false;
  let lastKey = "";
  const log = (...items) => console.log(`[${name}]`, ...items);
  const myPlayerId = () => room?.members.find((member) => member.id === socket.id)?.playerId;

  async function act() {
    if (acting || !room) return;
    const game = room.game;
    if (room.rematch && game?.phase === "finished") {
      if (!room.rematch.acceptedIds.includes(socket.id) && process.env.BOT_REMATCH !== "0") {
        acting = true;
        await sleep(DELAY);
        socket.emit("room:rematch", true, () => { acting = false; });
      }
      return;
    }
    if (!game || game.phase !== "playing") return;
    const me = myPlayerId();
    const myIndex = game.players.findIndex((player) => player.id === me);
    const key = `${game.version}:${game.stage}`;
    let command = null;
    if (game.stage === "roundEnd") {
      if (!game.ready.includes(me)) command = { type: "READY" };
    } else if (game.actor === myIndex) {
      command = decide(game, me);
    }
    if (!command || key === lastKey) return;
    acting = true;
    lastKey = key;
    await sleep(DELAY);
    socket.emit("game:command", command, (response) => {
      acting = false;
      if (!response.ok) {
        log("被拒绝：", command.type, response.error);
        lastKey = "";
      } else {
        room = response.data;
      }
      void act(); // ack 之后按最新状态再判断一次
    });
  }

  socket.on("connect", () => {
    if (room) return;
    setup(socket, (snapshot) => {
      room = snapshot;
      void act();
    }, log);
  });
  socket.on("room:updated", (snapshot) => {
    room = snapshot;
    if (startAt && room.status === "waiting" && room.members.length >= startAt && room.members.find((m) => m.id === socket.id)?.isHost) {
      socket.emit("room:start", (response) => log(response.ok ? "开局" : `开局失败：${response.error}`));
    }
    if (room.game?.phase === "finished" && room.game.finalResult && !room.rematch?.acceptedIds.length) {
      const scores = room.game.players.map((player) => `${player.name} ${player.score}`).join(" / ");
      log("终局：", scores, "胜者", room.game.finalResult.winners.join(","), room.game.finalResult.mermaids ? "（四美人鱼）" : "");
    }
    void act();
  });
  socket.on("room:closed", ({ reason }) => {
    log("房间关闭：", reason);
    process.exit(0);
  });
  socket.on("connect_error", (error) => log("连不上：", error.message));
  return socket;
}

if (mode === "host") {
  const [name = "房主机器人", capacity = "4"] = positional;
  runBot(name, (socket, done, log) => {
    socket.emit("room:create", { name, capacity: Number(capacity) }, (response) => {
      if (!response.ok) {
        log("建房失败：", response.error);
        process.exit(1);
      }
      log("房间码", response.data.code);
      console.log(`ROOM ${response.data.code}`);
      done(response.data);
    });
  });
} else if (mode === "join" || mode === "fill") {
  const code = positional[0];
  const count = mode === "fill" ? Number(positional[1] ?? 1) : 1;
  const prefix = mode === "fill" ? positional[2] ?? "机器人" : positional[1] ?? "机器人";
  for (let k = 0; k < count; k += 1) {
    const name = mode === "fill" ? `${prefix}${k + 1}` : prefix;
    runBot(name, (socket, done, log) => {
      socket.emit("room:join", { name, code }, (response) => {
        if (!response.ok) {
          log("加入失败：", response.error);
          return;
        }
        log("已加入", code);
        done(response.data);
      });
    });
    await sleep(150);
  }
} else {
  console.log("用法见文件开头的注释。");
  process.exit(1);
}
