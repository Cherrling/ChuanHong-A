import { describe, expect, it } from "vitest";
import {
  applyGameAction,
  createGame
} from "@chuanhong/game-core";
import type { Card, GameState, OpeningResponse, Seat } from "@chuanhong/game-core";
import { RoomManager } from "../src/rooms.js";

function card(rank: Card["rank"], suit: Card["suit"] = "clubs"): Card {
  return { rank, suit };
}

function openRound(
  game: GameState,
  responses: Partial<Record<Seat, OpeningResponse>> = {}
): GameState {
  let next = applyGameAction(game, game.startingSeat, {
    type: "BEGIN_OPENING"
  });
  for (let offset = 0; offset < 4; offset += 1) {
    const seat = ((game.startingSeat + offset) % 4) as Seat;
    next = applyGameAction(next, seat, {
      type: "OPENING_RESPONSE",
      response: responses[seat] ?? "quiet"
    });
  }
  return next;
}

describe("room lifecycle", () => {
  it("applies round scores, preserves totals, and deals a new round", () => {
    const manager = new RoomManager(() => 0.37);
    const host = manager.createRoom("房主", "socket-0");
    const second = manager.joinRoom(host.session.roomCode, "二席", "socket-1");
    manager.joinRoom(host.session.roomCode, "三席", "socket-2");
    manager.joinRoom(host.session.roomCode, "四席", "socket-3");

    expect(() =>
      manager.startRoom(host.session.roomCode, second.session.playerId)
    ).toThrowError(
      expect.objectContaining({ code: "HOST_ONLY" })
    );
    const room = manager.startRoom(host.session.roomCode, host.session.playerId);

    const heartTwo = card(2, "hearts");
    let game = createGame(
      [
        [
          heartTwo,
          card(14, "hearts"),
          card(14, "diamonds"),
          card(5)
        ],
        [card(6)],
        [card(7)],
        [card(8)]
      ],
      { roundNumber: 1 }
    );
    game = openRound(game);
    game.players[0].hand = [heartTwo];

    room.game = game;
    room.status = "PLAYING";
    manager.applyAction(host.session.roomCode, host.session.playerId, {
      type: "PLAY",
      cards: [heartTwo]
    });

    expect(room.status).toBe("FINISHED");
    expect(
      room.players.map((player) => player.totalScore)
    ).toEqual([6, -2, -2, -2]);
    expect(
      manager.snapshotFor(room, host.session.playerId).canStartNextRound
    ).toBe(true);

    manager.startNextRound(host.session.roomCode, host.session.playerId);

    expect(room.status).toBe("PLAYING");
    expect(room.game?.roundNumber).toBe(2);
    expect(
      room.game && [0, 1, 2, 3].every(
        (seat) => room.game?.players[seat as Seat].hand.length === 13
      )
    ).toBe(true);
    expect(
      room.players.map((player) => player.totalScore)
    ).toEqual([6, -2, -2, -2]);
    expect(
      manager.snapshotFor(room, second.session.playerId).game?.selfHand
    ).toHaveLength(13);
  });
});
