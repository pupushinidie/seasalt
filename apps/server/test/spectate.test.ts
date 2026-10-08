import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  AckResponse,
  ClientToServerEvents,
  JoinRoomPayload,
  LobbyRoomSnapshot,
  PublicRoomSummary,
  RoomAccess,
  ServerToClientEvents,
} from "@seasalt/game";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function create(client: TestSocket, name: string): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => client.emit("room:create", { name, capacity: 2 }, (response) => {
    if (response.ok) resolve(response.data);
    else reject(new Error(response.error));
  }));
}

function join(client: TestSocket, payload: JoinRoomPayload): Promise<AckResponse<LobbyRoomSnapshot>> {
  return new Promise((resolve) => client.emit("room:join", payload, resolve));
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

function settings(client: TestSocket, value: Partial<RoomAccess>): Promise<AckResponse<void>> {
  return call((ack) => client.emit("room:access", value, ack));
}

function lobby(client: TestSocket): Promise<PublicRoomSummary[]> {
  return new Promise((resolve) => client.emit("lobby:get", (response) => resolve(response.ok ? response.data : [])));
}

function nextUpdate(client: TestSocket): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve) => client.once("room:updated", resolve));
}

/** 等到满足条件的那次房间更新（前面的操作可能还有更新在路上）。 */
function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve) => {
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

function closed(client: TestSocket): Promise<string> {
  return new Promise((resolve) => client.once("room:closed", ({ reason }) => resolve(reason)));
}

describe("观战和公开房间", () => {
  beforeAll(async () => {
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
  });

  it("新房间默认可观战、不公开；陌生人从列表只能观战，房主打开公开后才能坐下", async () => {
    const host = await connect();
    const room = await create(host, "房主甲");
    expect(room.access).toEqual({ allowSpectators: true, spectatorsSeeAll: false, open: false });

    const stranger = await connect();
    const summary = (await lobby(stranger)).find((candidate) => candidate.players[0]?.name === "房主甲")!;
    expect(summary.open).toBe(false);
    expect(summary.allowSpectators).toBe(true);

    const refused = await join(stranger, { name: "路人乙", roomId: summary.id });
    expect(refused.ok).toBe(false);

    const watching = await join(stranger, { name: "路人乙", roomId: summary.id, spectate: true });
    expect(watching.ok && watching.data.spectators.map((spectator) => spectator.name)).toEqual(["路人乙"]);
    // 从列表进来的看不到房间码，邀请制房间也不能坐下。
    expect(watching.ok && watching.data.code).toBe("");
    expect((await call<void>((ack) => stranger.emit("room:sit", ack))).ok).toBe(false);
    expect((await lobby(await connect())).find((candidate) => candidate.id === summary.id)?.spectators).toBe(1);

    // 观战的人不能开语音；能聊天，带「观战」标记。
    expect((await call<unknown>((ack) => stranger.emit("voice:join", { muted: true }, ack))).ok).toBe(false);
    const chatSeen = nextUpdate(host);
    expect((await call<void>((ack) => stranger.emit("room:chat", { message: "加油" }, ack))).ok).toBe(true);
    expect((await chatSeen).chat.at(-1)).toMatchObject({ name: "路人乙", spectator: true });

    // 不是房主不能改设置；房主打开公开后，观战的人可以坐下。
    expect((await settings(stranger, { open: true })).ok).toBe(false);
    expect((await settings(host, { open: true })).ok).toBe(true);
    const seated = updateWhere(host, (snapshot) => snapshot.members.length === 2);
    expect((await call<void>((ack) => stranger.emit("room:sit", ack))).ok).toBe(true);
    const afterSit = await seated;
    expect(afterSit.members.map((member) => member.name)).toEqual(["房主甲", "路人乙"]);
    expect(afterSit.spectators).toEqual([]);

    // 满座后列表加入会被拒；改回观战后空出座位，第三个人能从列表加入。
    const third = await connect();
    expect((await join(third, { name: "路人丙", roomId: summary.id })).ok).toBe(false);
    expect((await call<void>((ack) => stranger.emit("room:stand", ack))).ok).toBe(true);
    const joined = await join(third, { name: "路人丙", roomId: summary.id });
    expect(joined.ok && joined.data.members.map((member) => member.name)).toEqual(["房主甲", "路人丙"]);
  });

  it("对局中观战的人看不到手牌，房主打开「看手牌」后能看到；不能操作，随时能离开", async () => {
    const host = await connect();
    const room = await create(host, "玩家甲");
    const guest = await connect();
    expect((await join(guest, { name: "玩家乙", code: room.code })).ok).toBe(true);
    const viewer = await connect();
    const invitedViewer = await join(viewer, { name: "看客丙", code: room.code, spectate: true });
    expect(invitedViewer.ok && invitedViewer.data.code).toBe(room.code);

    const started = updateWhere(viewer, (snapshot) => snapshot.game !== undefined);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
    const view = await started;
    expect(view.game?.players.every((player) => player.hand.length === 0)).toBe(true);
    expect(view.game?.deck).toBeUndefined();

    const reveal = updateWhere(viewer, (snapshot) => snapshot.access.spectatorsSeeAll);
    expect((await settings(host, { spectatorsSeeAll: true })).ok).toBe(true);
    const godView = await reveal;
    expect(godView.game?.players.every((player) => player.hand.length === player.handCount)).toBe(true);
    expect(godView.game?.deck).toBeUndefined();
    // 玩家自己看到的还是只有自己的手牌。
    const hostView = await call<LobbyRoomSnapshot>((ack) => host.emit("game:command", { type: "END_TURN" }, ack));
    if (hostView.ok) expect(hostView.data.game?.players.filter((player) => player.hand.length > 0).length).toBe(1);

    expect((await call<LobbyRoomSnapshot>((ack) => viewer.emit("game:command", { type: "DRAW_DECK" }, ack))).ok).toBe(false);
    // 对局中玩家不能改成观战，列表加入只能观战。
    expect((await call<void>((ack) => guest.emit("room:stand", ack))).ok).toBe(false);
    expect((await call<void>((ack) => viewer.emit("room:leave", ack))).ok).toBe(true);
  });

  it("房主关闭观战会把观战的人请出去；房间解散时观战的人也会收到通知", async () => {
    const host = await connect();
    const room = await create(host, "玩家丁");
    const viewer = await connect();
    expect((await join(viewer, { name: "看客戊", code: room.code, spectate: true })).ok).toBe(true);
    const kicked = closed(viewer);
    expect((await settings(host, { allowSpectators: false })).ok).toBe(true);
    expect(await kicked).toContain("关闭了观战");
    expect((await join(viewer, { name: "看客戊", code: room.code, spectate: true })).ok).toBe(false);

    expect((await settings(host, { allowSpectators: true })).ok).toBe(true);
    expect((await join(viewer, { name: "看客戊", code: room.code, spectate: true })).ok).toBe(true);
    const dissolved = closed(viewer);
    expect((await call<void>((ack) => host.emit("room:dissolve", ack))).ok).toBe(true);
    expect(await dissolved).toContain("解散");
  });

  it("同名的人不能同时在房间里（座位和观战一起算）", async () => {
    const host = await connect();
    const room = await create(host, "玩家己");
    const viewer = await connect();
    expect((await join(viewer, { name: "玩家己", code: room.code, spectate: true })).ok).toBe(false);
  });
});
