import { randomBytes, randomUUID } from "node:crypto";
import {
  SEATS,
  applyGameAction,
  createDeck,
  createGame,
  shuffleDeck,
  toClientGameView
} from "@chuanhong/game-core";
import type {
  Card,
  GameAction,
  GameState,
  RoomSession,
  RoomSnapshot,
  Seat
} from "@chuanhong/game-core";

type InternalRoomStatus = "LOBBY" | "PLAYING" | "FINISHED";

interface InternalPlayer {
  id: string;
  reconnectToken: string;
  socketId: string | null;
  seat: Seat;
  name: string;
  connected: boolean;
  totalScore: number;
}

export interface InternalRoom {
  code: string;
  hostId: string;
  status: InternalRoomStatus;
  players: InternalPlayer[];
  game: GameState | null;
  createdAt: number;
  updatedAt: number;
}

export class RoomError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "RoomError";
  }
}

export interface JoinResult {
  session: RoomSession;
  snapshot: RoomSnapshot;
  replacedSocketId?: string;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NAME_MAX_LENGTH = 20;

function normalizeName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    throw new RoomError("INVALID_NAME", "请输入昵称");
  }
  if (normalized.length > NAME_MAX_LENGTH) {
    throw new RoomError("INVALID_NAME", `昵称不能超过 ${NAME_MAX_LENGTH} 个字符`);
  }
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (hasControlCharacter) {
    throw new RoomError("INVALID_NAME", "昵称包含不可用字符");
  }
  return normalized;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export class RoomManager {
  private readonly rooms = new Map<string, InternalRoom>();

  constructor(private readonly random: () => number = Math.random) {}

  createRoom(name: string, socketId: string): JoinResult {
    let code = this.generateCode();
    while (this.rooms.has(code)) {
      code = this.generateCode();
    }

    const player = this.createPlayer(name, 0);
    player.socketId = socketId;
    player.connected = true;
    const room: InternalRoom = {
      code,
      hostId: player.id,
      status: "LOBBY",
      players: [player],
      game: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.rooms.set(code, room);

    return {
      session: this.sessionFor(room, player),
      snapshot: this.snapshotFor(room, player.id)
    };
  }

  joinRoom(codeInput: string, name: string, socketId: string): JoinResult {
    const code = normalizeCode(codeInput);
    const room = this.requireRoom(code);
    if (room.status !== "LOBBY") {
      throw new RoomError("ROOM_STARTED", "牌局已经开始，请使用断线恢复");
    }
    if (room.players.length >= SEATS.length) {
      throw new RoomError("ROOM_FULL", "房间已经坐满");
    }

    const usedSeats = new Set(room.players.map((player) => player.seat));
    const seat = SEATS.find((candidate) => !usedSeats.has(candidate));
    if (seat === undefined) {
      throw new RoomError("ROOM_FULL", "房间已经坐满");
    }

    const player = this.createPlayer(name, seat);
    player.socketId = socketId;
    player.connected = true;
    room.players.push(player);
    room.updatedAt = Date.now();

    return {
      session: this.sessionFor(room, player),
      snapshot: this.snapshotFor(room, player.id)
    };
  }

  resumeRoom(session: RoomSession, socketId: string): JoinResult {
    const room = this.requireRoom(normalizeCode(session.roomCode));
    const player = room.players.find(
      (candidate) =>
        candidate.id === session.playerId &&
        candidate.reconnectToken === session.reconnectToken
    );

    if (!player) {
      throw new RoomError("INVALID_SESSION", "恢复凭证无效");
    }

    const replacedSocketId = player.socketId ?? undefined;
    player.socketId = socketId;
    player.connected = true;
    room.updatedAt = Date.now();

    return {
      session: this.sessionFor(room, player),
      snapshot: this.snapshotFor(room, player.id),
      replacedSocketId
    };
  }

  disconnect(roomCode: string, playerId: string, socketId: string): void {
    const room = this.rooms.get(normalizeCode(roomCode));
    const player = room?.players.find((candidate) => candidate.id === playerId);
    if (!room || !player || player.socketId !== socketId) {
      return;
    }

    player.connected = false;
    player.socketId = null;
    room.updatedAt = Date.now();
  }

  startRoom(roomCode: string, playerId: string): InternalRoom {
    const room = this.requireRoom(normalizeCode(roomCode));
    this.requireHost(room, playerId);
    if (room.status !== "LOBBY") {
      throw new RoomError("ROOM_STARTED", "房间已经开始过牌局");
    }
    if (room.players.length !== SEATS.length) {
      throw new RoomError("WAITING_FOR_PLAYERS", "需要四名玩家才能开始");
    }
    if (room.players.some((player) => !player.connected)) {
      throw new RoomError("PLAYER_OFFLINE", "请等待所有玩家上线");
    }

    this.dealRound(room, 1);
    return room;
  }

  startNextRound(roomCode: string, playerId: string): InternalRoom {
    const room = this.requireRoom(normalizeCode(roomCode));
    this.requireHost(room, playerId);
    if (room.status !== "FINISHED") {
      throw new RoomError("ROUND_NOT_FINISHED", "当前牌局尚未结束");
    }
    if (room.players.some((player) => !player.connected)) {
      throw new RoomError("PLAYER_OFFLINE", "请等待所有玩家上线");
    }

    const nextRound = (room.game?.roundNumber ?? 0) + 1;
    this.dealRound(room, nextRound);
    return room;
  }

  applyAction(
    roomCode: string,
    playerId: string,
    action: GameAction
  ): InternalRoom {
    const room = this.requireRoom(normalizeCode(roomCode));
    if (room.status !== "PLAYING" || !room.game) {
      throw new RoomError("ROOM_NOT_PLAYING", "当前房间不在牌局中");
    }

    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      throw new RoomError("PLAYER_NOT_FOUND", "玩家不在房间中");
    }

    const nextGame = applyGameAction(room.game, player.seat, action);
    room.game = nextGame;
    room.updatedAt = Date.now();

    if (nextGame.phase === "FINISHED" && nextGame.result) {
      for (const seat of SEATS) {
        const roomPlayer = room.players.find((candidate) => candidate.seat === seat);
        if (roomPlayer) {
          roomPlayer.totalScore += nextGame.result.scores[seat];
        }
      }
      room.status = "FINISHED";
    }

    return room;
  }

  getRoom(roomCode: string): InternalRoom {
    return this.requireRoom(normalizeCode(roomCode));
  }

  getPlayerSocketIds(room: InternalRoom): string[] {
    return room.players.flatMap((player) =>
      player.connected && player.socketId ? [player.socketId] : []
    );
  }

  verifySocket(roomCode: string, playerId: string, socketId: string): void {
    const room = this.requireRoom(normalizeCode(roomCode));
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player || player.socketId !== socketId || !player.connected) {
      throw new RoomError("SESSION_REPLACED", "该席位已在新连接中恢复");
    }
  }

  snapshotFor(room: InternalRoom, playerId: string): RoomSnapshot {
    const self = room.players.find((player) => player.id === playerId);
    if (!self) {
      throw new RoomError("PLAYER_NOT_FOUND", "玩家不在房间中");
    }

    return {
      roomCode: room.code,
      status: room.status,
      selfId: self.id,
      selfSeat: self.seat,
      selfIsHost: room.hostId === self.id,
      players: room.players.map((player) => ({
        id: player.id,
        seat: player.seat,
        name: player.name,
        connected: player.connected,
        isHost: player.id === room.hostId,
        totalScore: player.totalScore
      })),
      game: room.game ? toClientGameView(room.game, self.seat) : null,
      canStart:
        room.status === "LOBBY" &&
        room.hostId === self.id &&
        room.players.length === SEATS.length &&
        room.players.every((player) => player.connected),
      canStartNextRound:
        room.status === "FINISHED" &&
        room.hostId === self.id &&
        room.players.every((player) => player.connected),
      memoryOnly: true
    };
  }

  private createPlayer(name: string, seat: Seat): InternalPlayer {
    return {
      id: randomUUID(),
      reconnectToken: randomBytes(24).toString("base64url"),
      socketId: null,
      seat,
      name: normalizeName(name),
      connected: false,
      totalScore: 0
    };
  }

  private sessionFor(room: InternalRoom, player: InternalPlayer): RoomSession {
    return {
      roomCode: room.code,
      playerId: player.id,
      reconnectToken: player.reconnectToken
    };
  }

  private requireRoom(code: string): InternalRoom {
    const room = this.rooms.get(code);
    if (!room) {
      throw new RoomError("ROOM_NOT_FOUND", "房间不存在或已失效");
    }
    return room;
  }

  private requireHost(room: InternalRoom, playerId: string): void {
    if (room.hostId !== playerId) {
      throw new RoomError("HOST_ONLY", "只有房主可以执行此操作");
    }
  }

  private dealRound(room: InternalRoom, roundNumber: number): void {
    const deck = shuffleDeck(createDeck(), this.random);
    const hands: [Card[], Card[], Card[], Card[]] = [[], [], [], []];

    for (let index = 0; index < deck.length; index += 1) {
      const seat = (index % SEATS.length) as Seat;
      const card = deck[index];
      if (card) {
        hands[seat].push(card);
      }
    }

    room.game = createGame(hands, { roundNumber });
    room.status = "PLAYING";
    room.updatedAt = Date.now();
  }

  private generateCode(): string {
    let code = "";
    for (let index = 0; index < 5; index += 1) {
      const position = Math.floor(this.random() * CODE_ALPHABET.length);
      code += CODE_ALPHABET[position] ?? "A";
    }
    return code;
  }
}
