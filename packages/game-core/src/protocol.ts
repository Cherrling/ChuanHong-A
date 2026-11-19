import type { GameAction, Seat } from "./game.js";
import type { ClientGameView } from "./view.js";

export interface RoomSession {
  roomCode: string;
  playerId: string;
  reconnectToken: string;
}

export interface RoomPlayerSnapshot {
  id: string;
  seat: Seat;
  name: string;
  connected: boolean;
  isHost: boolean;
  totalScore: number;
}

export interface RoomSnapshot {
  roomCode: string;
  status: "LOBBY" | "PLAYING" | "FINISHED";
  selfId: string;
  selfSeat: Seat;
  selfIsHost: boolean;
  players: RoomPlayerSnapshot[];
  game: ClientGameView | null;
  canStart: boolean;
  canStartNextRound: boolean;
  memoryOnly: true;
}

export interface SuccessResponse<T> {
  ok: true;
  data: T;
}

export interface ErrorResponse {
  ok: false;
  code: string;
  error: string;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

export type ClientGameAction = GameAction;
