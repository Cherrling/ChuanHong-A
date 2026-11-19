import type { Server, Socket } from "socket.io";
import { RuleError } from "@chuanhong/game-core";
import type {
  ApiResponse,
  GameAction,
  RoomSession,
  RoomSnapshot
} from "@chuanhong/game-core";
import type { InternalRoom, JoinResult, RoomManager } from "./rooms.js";
import { RoomError } from "./rooms.js";

type Ack<T> = (response: ApiResponse<T>) => void;

interface SessionData {
  roomCode: string;
  playerId: string;
}

function success<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

function failure(error: unknown): ApiResponse<never> {
  if (error instanceof RuleError || error instanceof RoomError) {
    return {
      ok: false,
      code: error.code,
      error: error.message
    };
  }

  console.error("Unhandled room or game error", error);
  return {
    ok: false,
    code: "INTERNAL_ERROR",
    error: "服务器处理失败，请重试"
  };
}

function validateAck<T>(ack: Ack<T> | undefined): Ack<T> | null {
  return typeof ack === "function" ? ack : null;
}

function broadcastRoom(
  io: Server,
  manager: RoomManager,
  room: InternalRoom
): void {
  for (const socketId of manager.getPlayerSocketIds(room)) {
    const snapshot = manager.snapshotFor(
      room,
      room.players.find((player) => player.socketId === socketId)?.id ?? ""
    );
    io.to(socketId).emit("room:snapshot", snapshot);
  }
}

function joinSocketRoom(socket: Socket, result: JoinResult): SessionData {
  const data: SessionData = {
    roomCode: result.session.roomCode,
    playerId: result.session.playerId
  };
  socket.data.session = data;
  void socket.join(result.session.roomCode);
  return data;
}

export function registerSocketHandlers(
  io: Server,
  manager: RoomManager
): void {
  io.on("connection", (socket) => {
    socket.on(
      "room:create",
      (payload: { name?: string }, ack?: Ack<{ session: RoomSession; snapshot: RoomSnapshot }>) => {
        const reply = validateAck(ack);
        try {
          const result = manager.createRoom(payload?.name ?? "", socket.id);
          socket.data.session = {
            roomCode: result.session.roomCode,
            playerId: result.session.playerId
          };
          void socket.join(result.session.roomCode);
          reply?.(success(result));
          broadcastRoom(io, manager, manager.getRoom(result.session.roomCode));
        } catch (error) {
          reply?.(failure(error));
        }
      }
    );

    socket.on(
      "room:join",
      (
        payload: { code?: string; name?: string },
        ack?: Ack<{ session: RoomSession; snapshot: RoomSnapshot }>
      ) => {
        const reply = validateAck(ack);
        try {
          const result = manager.joinRoom(
            payload?.code ?? "",
            payload?.name ?? "",
            socket.id
          );
          joinSocketRoom(socket, result);
          reply?.(success(result));
          broadcastRoom(io, manager, manager.getRoom(result.session.roomCode));
        } catch (error) {
          reply?.(failure(error));
        }
      }
    );

    socket.on(
      "room:resume",
      (
        payload: { session?: RoomSession },
        ack?: Ack<{ session: RoomSession; snapshot: RoomSnapshot }>
      ) => {
        const reply = validateAck(ack);
        try {
          const session = payload?.session;
          if (!session) {
            throw new RoomError("INVALID_SESSION", "缺少恢复凭证");
          }
          const result = manager.resumeRoom(session, socket.id);
          joinSocketRoom(socket, result);
          if (result.replacedSocketId) {
            io.sockets.sockets.get(result.replacedSocketId)?.disconnect(true);
          }
          reply?.(success(result));
          broadcastRoom(io, manager, manager.getRoom(result.session.roomCode));
        } catch (error) {
          reply?.(failure(error));
        }
      }
    );

    socket.on("room:start", (ack?: Ack<RoomSnapshot>) => {
      const reply = validateAck(ack);
      try {
        const session = requireSession(socket);
        manager.verifySocket(session.roomCode, session.playerId, socket.id);
        const room = manager.startRoom(session.roomCode, session.playerId);
        reply?.(success(manager.snapshotFor(room, session.playerId)));
        broadcastRoom(io, manager, room);
      } catch (error) {
        reply?.(failure(error));
      }
    });

    socket.on("room:next-round", (ack?: Ack<RoomSnapshot>) => {
      const reply = validateAck(ack);
      try {
        const session = requireSession(socket);
        manager.verifySocket(session.roomCode, session.playerId, socket.id);
        const room = manager.startNextRound(session.roomCode, session.playerId);
        reply?.(success(manager.snapshotFor(room, session.playerId)));
        broadcastRoom(io, manager, room);
      } catch (error) {
        reply?.(failure(error));
      }
    });

    socket.on(
      "game:action",
      (payload: { action?: GameAction }, ack?: Ack<RoomSnapshot>) => {
        const reply = validateAck(ack);
        try {
          const session = requireSession(socket);
          manager.verifySocket(session.roomCode, session.playerId, socket.id);
          const action = payload?.action;
          if (!action || typeof action.type !== "string") {
            throw new RuleError("INVALID_ACTION", "操作格式无效");
          }
          if (
            action.type === "OPENING_RESPONSE" &&
            !["contact", "quiet", "counter"].includes(action.response)
          ) {
            throw new RuleError("INVALID_ACTION", "开局响应格式无效");
          }
          if (action.type === "PLAY" && !Array.isArray(action.cards)) {
            throw new RuleError("INVALID_ACTION", "出牌数据格式无效");
          }
          const room = manager.applyAction(session.roomCode, session.playerId, action);
          reply?.(success(manager.snapshotFor(room, session.playerId)));
          broadcastRoom(io, manager, room);
        } catch (error) {
          reply?.(failure(error));
        }
      }
    );

    socket.on("disconnect", () => {
      const session = socket.data.session as SessionData | undefined;
      if (!session) {
        return;
      }
      manager.disconnect(session.roomCode, session.playerId, socket.id);
      try {
        const room = manager.getRoom(session.roomCode);
        broadcastRoom(io, manager, room);
      } catch {
        // A missing room can occur only if the room has already expired.
      }
    });
  });
}

function requireSession(socket: Socket): SessionData {
  const session = socket.data.session as SessionData | undefined;
  if (!session) {
    throw new RoomError("NOT_IN_ROOM", "请先创建或加入房间");
  }
  return session;
}
