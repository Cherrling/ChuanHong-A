import { afterEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { cardKey } from "@chuanhong/game-core";
import type {
  ApiResponse,
  RoomSession,
  RoomSnapshot
} from "@chuanhong/game-core";
import { createApplication } from "../src/app.js";

type RoomResult = { session: RoomSession; snapshot: RoomSnapshot };

let sockets: Socket[] = [];
const servers: Array<ReturnType<typeof createApplication>> = [];

function connectClient(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"]
    });
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error("Socket connect timeout")), 4_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitAck<T>(
  socket: Socket,
  event: string,
  payload?: unknown
): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 4_000);
    const callback = (response: ApiResponse<T>): void => {
      clearTimeout(timer);
      resolve(response);
    };

    if (payload === undefined) {
      socket.emit(event, callback);
    } else {
      socket.emit(event, payload, callback);
    }
  });
}

afterEach(async () => {
  for (const socket of sockets) {
    socket.disconnect();
  }
  sockets = [];

  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
  }
});

describe("four-player room socket flow", () => {
  it("creates, joins, starts, validates plays, isolates hands, and resumes", async () => {
    const context = createApplication({ staticDir: null, random: () => 0.37 });
    servers.push(context);
    await new Promise<void>((resolve) => {
      context.httpServer.listen(0, "127.0.0.1", resolve);
    });
    const address = context.httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing test server address");
    }
    const url = `http://127.0.0.1:${address.port}`;

    const clients = await Promise.all([
      connectClient(url),
      connectClient(url),
      connectClient(url),
      connectClient(url)
    ]);
    const first = clients[0];
    if (!first) {
      throw new Error("Missing first socket");
    }

    const created = await emitAck<RoomResult>(first, "room:create", {
      name: "玩家一"
    });
    if (!created.ok) {
      throw new Error(created.error);
    }
    const sessions: RoomSession[] = [created.data.session];
    const seats = [created.data.snapshot.selfSeat];

    for (let index = 1; index < clients.length; index += 1) {
      const socket = clients[index];
      if (!socket) {
        throw new Error(`Missing socket ${index}`);
      }
      const joined = await emitAck<RoomResult>(socket, "room:join", {
        code: created.data.session.roomCode,
        name: `玩家${index + 1}`
      });
      if (!joined.ok) {
        throw new Error(joined.error);
      }
      sessions.push(joined.data.session);
      seats.push(joined.data.snapshot.selfSeat);
    }

    for (const snapshot of [created.data.snapshot]) {
      expect(snapshot.memoryOnly).toBe(true);
      expect(snapshot.players).toHaveLength(1);
    }

    const started = await emitAck<RoomSnapshot>(first, "room:start");
    if (!started.ok || !started.data.game) {
      throw new Error(started.ok ? "Missing game state" : started.error);
    }
    expect(started.data.status).toBe("PLAYING");
    expect(started.data.players).toHaveLength(4);
    expect(started.data.game.players.every((player) => !("hand" in player))).toBe(
      true
    );
    expect(started.data.game.selfHand).toHaveLength(13);

    const internalRoom = context.manager.getRoom(created.data.session.roomCode);
    const allGameCards =
      internalRoom.game?.players[0].hand.length === 13
        ? [0, 1, 2, 3].flatMap(
            (seat) =>
              internalRoom.game?.players[seat as 0 | 1 | 2 | 3].hand ?? []
          )
        : [];
    expect(allGameCards).toHaveLength(52);
    expect(new Set(allGameCards.map(cardKey)).size).toBe(52);
    expect(
      [0, 1, 2, 3].every(
        (seat) =>
          internalRoom.game?.players[seat as 0 | 1 | 2 | 3].hand.length === 13
      )
    ).toBe(true);
    const startingSeat = internalRoom.game?.startingSeat;
    if (startingSeat === undefined) {
      throw new Error("Missing starting seat");
    }
    const hiddenCard =
      internalRoom.game?.players[((startingSeat + 1) % 4) as 0 | 1 | 2 | 3]
        .hand[0];
    if (!hiddenCard) {
      throw new Error("Missing hidden card");
    }
    expect(JSON.stringify(started.data.game)).not.toContain(
      JSON.stringify(hiddenCard)
    );
    const startingClientIndex = seats.indexOf(startingSeat);
    const startingClient = clients[startingClientIndex];
    if (!startingClient) {
      throw new Error("Missing starting client");
    }

    const begin = await emitAck<RoomSnapshot>(
      startingClient,
      "game:action",
      { action: { type: "BEGIN_OPENING" } }
    );
    expect(begin.ok).toBe(true);

    for (let offset = 1; offset <= 4; offset += 1) {
      const seat = ((startingSeat + offset - 1) % 4) as 0 | 1 | 2 | 3;
      const clientIndex = seats.indexOf(seat);
      const socket = clients[clientIndex];
      if (!socket) {
        throw new Error(`Missing responding client at seat ${seat}`);
      }
      const response = await emitAck<RoomSnapshot>(
        socket,
        "game:action",
        {
          action: {
            type: "OPENING_RESPONSE",
            response: "quiet"
          }
        }
      );
      if (!response.ok) {
        throw new Error(response.error);
      }
    }

    const actionRoom = context.manager.getRoom(created.data.session.roomCode);
    const openingHand = actionRoom.game?.players[startingSeat].hand;
    if (!openingHand) {
      throw new Error("Missing starting hand");
    }
    const borrowedCard =
      actionRoom.game?.players[((startingSeat + 1) % 4) as 0 | 1 | 2 | 3]
        .hand[0];
    if (!borrowedCard) {
      throw new Error("Missing borrowed card");
    }
    const borrowedPlay = await emitAck<RoomSnapshot>(
      startingClient,
      "game:action",
      {
        action: {
          type: "PLAY",
          cards: [borrowedCard]
        }
      }
    );
    expect(borrowedPlay).toMatchObject({
      ok: false,
      code: "CARD_NOT_IN_HAND"
    });
    const nonHeartCard = openingHand.find(
      (card) => !(card.rank === 2 && card.suit === "hearts")
    );
    if (!nonHeartCard) {
      throw new Error("Deterministic deal unexpectedly contains only one card");
    }

    const wrongLead = await emitAck<RoomSnapshot>(
      startingClient,
      "game:action",
      {
        action: {
          type: "PLAY",
          cards: [nonHeartCard]
        }
      }
    );
    expect(wrongLead).toMatchObject({
      ok: false,
      code: "HEART_TWO_REQUIRED"
    });

    const heartTwo = openingHand.find(
      (card) => card.rank === 2 && card.suit === "hearts"
    );
    if (!heartTwo) {
      throw new Error("Heart two missing");
    }
    const legalLead = await emitAck<RoomSnapshot>(
      startingClient,
      "game:action",
      {
        action: {
          type: "PLAY",
          cards: [heartTwo]
        }
      }
    );
    expect(legalLead.ok).toBe(true);

    const resumedSocket = await connectClient(url);
    const reconnectSession = sessions[1];
    if (!reconnectSession) {
      throw new Error("Missing reconnect session");
    }
    const oldSocketClosed = new Promise<void>((resolve) => {
      clients[1]?.once("disconnect", () => resolve());
    });
    const resumed = await emitAck<RoomResult>(
      resumedSocket,
      "room:resume",
      { session: reconnectSession }
    );
    expect(resumed.ok).toBe(true);
    await oldSocketClosed;
    expect(clients[1]?.connected).toBe(false);
    if (resumed.ok) {
      expect(resumed.data.snapshot.selfSeat).toBe(seats[1]);
      expect(resumed.data.snapshot.game?.selfHand).toHaveLength(
        startingSeat === seats[1] ? 12 : 13
      );
    }
  });
});
