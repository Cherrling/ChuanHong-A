import { describe, expect, it } from "vitest";
import type { Card, Suit } from "../src/cards.js";
import {
  createGame,
  getActiveSeats,
  RuleError,
  soloScoreValues
} from "../src/game.js";
import type {
  GameState,
  OpeningResponse,
  Seat
} from "../src/game.js";
import {
  applyGameAction
} from "../src/game.js";
import { toClientGameView } from "../src/view.js";

function card(
  rank: Card["rank"],
  suit: Suit = "clubs"
): Card {
  return { rank, suit };
}

const HEART_TWO = card(2, "hearts");

function create(hands: [Card[], Card[], Card[], Card[]]): GameState {
  return createGame(hands);
}

function openRound(
  state: GameState,
  responses: Partial<Record<Seat, OpeningResponse>> = {}
): GameState {
  let next = state;
  const start = next.startingSeat;
  next = applyGameAction(next, start, { type: "BEGIN_OPENING" });

  for (let offset = 0; offset < 4; offset += 1) {
    const seat = ((start + offset) % 4) as Seat;
    next = applyGameAction(next, seat, {
      type: "OPENING_RESPONSE",
      response: responses[seat] ?? "quiet"
    });
  }

  return next;
}

function withHands(
  state: GameState,
  hands: [Card[], Card[], Card[], Card[]]
): GameState {
  const next = structuredClone(state);
  for (const seat of [0, 1, 2, 3] as const) {
    next.players[seat].hand = [...hands[seat]];
  }
  return next;
}

function expectRuleError(
  action: () => unknown,
  code: string
): void {
  try {
    action();
    throw new Error("Expected a RuleError");
  } catch (error) {
    expect(error).toBeInstanceOf(RuleError);
    expect((error as RuleError).code).toBe(code);
  }
}

describe("deal, team split, and opening", () => {
  it("finds the heart-two holder, red-A team, and reveals aces only on contact", () => {
    const initial = create([
      [HEART_TWO, card(14, "hearts"), card(5)],
      [card(14, "diamonds"), card(6)],
      [card(7, "diamonds")],
      [card(8, "spades")]
    ]);

    expect(initial.startingSeat).toBe(0);
    expect(initial.team.mode).toBe("2v2");
    expect(initial.team.redTeam).toEqual([0, 1]);
    expect(initial.opening.revealedHeartTwo).toBeNull();

    const opened = openRound(initial, { 0: "contact" });
    expect(opened.phase).toBe("PLAY");
    expect(opened.team.foundPartner).toBe(true);
    expect(opened.opening.revealedAces[0]).toHaveLength(1);
    expect(opened.opening.revealedAces[1]).toHaveLength(1);
    expect(opened.currentSeat).toBe(0);
    expect(toClientGameView(opened, 2).team).toMatchObject({
      mode: "2v2",
      redTeam: [0, 1],
      foundPartner: true
    });
  });

  it("publicly reveals the opening heart two without removing it from hand", () => {
    const initial = create([
      [HEART_TWO, card(14, "hearts")],
      [card(14, "diamonds")],
      [card(3, "hearts")],
      [card(4, "spades")]
    ]);
    const started = applyGameAction(initial, 0, { type: "BEGIN_OPENING" });
    const view = toClientGameView(started, 1);

    expect(started.opening.revealedHeartTwo).toEqual(HEART_TWO);
    expect(started.players[0].hand).toContainEqual(HEART_TWO);
    expect(view.opening.revealedHeartTwo).toEqual(HEART_TWO);
  });

  it("keeps a non-red counter separate from contact and doubles the multiplier", () => {
    const initial = create([
      [HEART_TWO, card(14, "hearts"), card(5)],
      [card(14, "diamonds"), card(6)],
      [card(13, "spades"), card(13, "hearts"), card(7, "diamonds")],
      [card(8, "spades")]
    ]);

    const opened = openRound(initial, { 2: "counter" });
    expect(opened.multiplier).toBe(2);
    expect(opened.team.foundPartner).toBe(false);
    expect(opened.opening.counterSeat).toBe(2);
    expect(opened.opening.revealedAces[0]).toHaveLength(0);
    expect(opened.opening.revealedAces[1]).toHaveLength(0);
    expect(opened.opening.revealedMaxCards[2]).toMatchObject({
      rank: 13,
      suit: "spades"
    });
  });

  it("treats a sole player's voluntary ace reveal as a counter challenge", () => {
    const initial = create([
      [
        HEART_TWO,
        card(14, "hearts"),
        card(14, "diamonds"),
        card(5)
      ],
      [card(6)],
      [card(7)],
      [card(8)]
    ]);
    expect(initial.team).toMatchObject({
      mode: "1v3",
      soleSeat: 0
    });

    const opened = openRound(initial, { 0: "contact" });
    expect(opened.team.foundPartner).toBe(true);
    expect(opened.multiplier).toBe(2);
    expect(opened.opening.counterSeat).toBe(0);
    expect(opened.opening.revealedAces[0]).toHaveLength(2);
    expect(opened.opening.revealedMaxCards[0]?.rank).toBe(14);
    expect(opened.opening.revealedMaxCards[1]?.rank).toBe(6);
  });

  it("a red-A counter reveals aces but does not silently count as contact", () => {
    const initial = create([
      [HEART_TWO, card(14, "hearts"), card(5)],
      [card(6)],
      [card(14, "diamonds"), card(7)],
      [card(8)]
    ]);

    const opened = openRound(initial, { 0: "counter" });
    expect(opened.team.foundPartner).toBe(false);
    expect(opened.opening.revealedAces[0]).toHaveLength(1);
    expect(opened.opening.revealedAces[2]).toHaveLength(1);
    expect(opened.multiplier).toBe(2);
  });

  it("allows only one counter challenge in a round", () => {
    const initial = create([
      [HEART_TWO, card(14, "hearts")],
      [card(14, "diamonds")],
      [card(3, "hearts"), card(13)],
      [card(4, "spades")]
    ]);
    let game = applyGameAction(initial, 0, { type: "BEGIN_OPENING" });
    game = applyGameAction(game, 0, {
      type: "OPENING_RESPONSE",
      response: "quiet"
    });
    game = applyGameAction(game, 1, {
      type: "OPENING_RESPONSE",
      response: "counter"
    });

    expectRuleError(
      () =>
        applyGameAction(game, 2, {
          type: "OPENING_RESPONSE",
          response: "counter"
        }),
      "COUNTER_ALREADY_USED"
    );
  });
});

describe("ordinary play and passes", () => {
  function openedGame(): GameState {
    return openRound(
      create([
        [HEART_TWO, card(14, "hearts"), card(5)],
        [card(14, "diamonds"), card(6)],
        [card(3, "hearts"), card(7, "diamonds")],
        [card(4, "hearts"), card(8, "spades")]
      ])
    );
  }

  it("requires the first lead to contain the heart two", () => {
    const game = openedGame();
    expectRuleError(
      () =>
        applyGameAction(game, 0, {
          type: "PLAY",
          cards: [card(5)]
        }),
      "HEART_TWO_REQUIRED"
    );

    const next = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    expect(next.phase).toBe("PLAY");
    expect(next.currentSeat).toBe(1);
    expect(next.players[0].hand).toHaveLength(2);
  });

  it("rejects an action from a non-current seat", () => {
    const game = openedGame();

    expectRuleError(
      () =>
        applyGameAction(game, 1, {
          type: "PLAY",
          cards: [card(14, "diamonds")]
        }),
      "NOT_YOUR_TURN"
    );
  });

  it("allows a legal opening pair that contains the heart two", () => {
    const game = openRound(
      create([
        [HEART_TWO, card(2, "spades"), card(14, "hearts")],
        [card(14, "diamonds")],
        [card(3, "hearts")],
        [card(4, "spades")]
      ])
    );
    const next = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO, card(2, "spades")]
    });

    expect(next.currentPlay?.combo.type).toBe("pair");
    expect(next.currentSeat).toBe(1);
  });

  it("allows a teammate to beat a play", () => {
    const game = openedGame();
    const first = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    const teammatePlay = applyGameAction(first, 1, {
      type: "PLAY",
      cards: [card(14, "diamonds")]
    });

    expect(teammatePlay.currentPlay?.seat).toBe(1);
    expect(teammatePlay.currentSeat).toBe(2);
  });

  it("lets earlier passers act again after another player beats the target", () => {
    const game = openedGame();
    let next = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    next = applyGameAction(next, 1, { type: "PASS" });
    next = applyGameAction(next, 2, { type: "PASS" });
    next = applyGameAction(next, 3, {
      type: "PLAY",
      cards: [card(8, "spades")]
    });
    expect(next.currentSeat).toBe(0);
    next = applyGameAction(next, 0, { type: "PASS" });
    expect(next.currentSeat).toBe(1);
    next = applyGameAction(next, 1, { type: "PASS" });
    expect(next.currentSeat).toBe(2);
  });

  it("returns the lead to the latest player when everyone else passes", () => {
    const game = openedGame();
    let next = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    next = applyGameAction(next, 1, {
      type: "PLAY",
      cards: [card(6)]
    });
    next = applyGameAction(next, 2, { type: "PASS" });
    next = applyGameAction(next, 3, { type: "PASS" });
    next = applyGameAction(next, 0, { type: "PASS" });

    expect(next.currentPlay).toBeNull();
    expect(next.currentSeat).toBe(1);
    expect(getActiveSeats(next)).toEqual([0, 1, 2, 3]);
  });
});

describe("finishing, wind, and scoring", () => {
  it("ends 2v2 full-road when a red team finishes first and second", () => {
    let game = openRound(
      create([
        [HEART_TWO, card(14, "hearts")],
        [card(14, "diamonds")],
        [card(3)],
        [card(4)]
      ]),
      { 0: "contact" }
    );
    game = withHands(game, [
      [HEART_TWO, card(2, "spades")],
      [card(3, "hearts"), card(3, "diamonds")],
      [card(4)],
      [card(5)]
    ]);
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO, card(2, "spades")]
    });
    expect(game.phase).toBe("WIND_PENDING");
    expect(game.wind).toMatchObject({
      finisherSeat: 0,
      receiverSeat: 1,
      currentSeat: 1
    });

    game = applyGameAction(game, 1, {
      type: "PLAY",
      cards: [card(3, "hearts"), card(3, "diamonds")]
    });
    expect(game.phase).toBe("FINISHED");
    expect(game.result).toMatchObject({
      teamMode: "2v2",
      winningSide: "red",
      outcome: "full",
      multiplier: 1
    });
    expect(game.result?.scores).toEqual({ 0: 2, 1: 2, 2: -2, 3: -2 });
  });

  it("applies the counter multiplier to the final 2v2 score", () => {
    let game = openRound(
      create([
        [HEART_TWO, card(14, "hearts")],
        [card(14, "diamonds")],
        [card(3)],
        [card(4)]
      ]),
      { 0: "contact", 1: "counter" }
    );
    game = withHands(game, [
      [HEART_TWO, card(2, "spades")],
      [card(3, "hearts"), card(3, "diamonds")],
      [card(4)],
      [card(5)]
    ]);
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO, card(2, "spades")]
    });
    game = applyGameAction(game, 1, {
      type: "PLAY",
      cards: [card(3, "hearts"), card(3, "diamonds")]
    });

    expect(game.multiplier).toBe(2);
    expect(game.result).toMatchObject({
      multiplier: 2,
      outcome: "full",
      scores: { 0: 4, 1: 4, 2: -4, 3: -4 }
    });
  });

  it("ends 2v2 half-road when teams split the first two places", () => {
    let game = openRound(
      create([
        [HEART_TWO, card(14, "hearts")],
        [card(3)],
        [card(14, "diamonds")],
        [card(4)]
      ]),
      { 0: "contact" }
    );
    game = withHands(game, [
      [HEART_TWO],
      [card(3)],
      [card(14, "diamonds")],
      [card(4)]
    ]);
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    game = applyGameAction(game, 1, {
      type: "PLAY",
      cards: [card(3)]
    });
    expect(game.phase).toBe("WIND_PENDING");
    game = applyGameAction(game, 2, {
      type: "PLAY",
      cards: [card(14, "diamonds")]
    });

    expect(game.phase).toBe("FINISHED");
    expect(game.finishOrder).toEqual([0, 1, 2]);
    expect(game.result).toMatchObject({
      winningSide: "red",
      outcome: "half"
    });
    expect(game.result?.scores).toEqual({ 0: 1, 1: -1, 2: 1, 3: -1 });
  });

  it("requires the receiver to request wind or play, then lets a guard cancel it", () => {
    let game = openRound(
      create([
        [HEART_TWO, card(12)],
        [card(5), card(9)],
        [card(14, "hearts"), card(6), card(10)],
        [card(14, "diamonds"), card(7), card(11)]
      ])
    );
    game = withHands(game, [
      [HEART_TWO],
      [card(5), card(9)],
      [card(6), card(10)],
      [card(7), card(11)]
    ]);
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    expectRuleError(
      () => applyGameAction(game, 1, { type: "PASS" }),
      "WIND_RECEIVER_MUST_CHOOSE"
    );

    game = applyGameAction(game, 1, { type: "REQUEST_WIND" });
    game = applyGameAction(game, 2, {
      type: "PLAY",
      cards: [card(6)]
    });
    expect(game.phase).toBe("PLAY");
    expect(game.wind).toBeNull();
    expect(game.currentPlay?.seat).toBe(2);
  });

  it("grants wind after request when the remaining players pass", () => {
    let game = openRound(
      create([
        [HEART_TWO, card(12)],
        [card(5), card(9)],
        [card(14, "hearts"), card(6), card(10)],
        [card(14, "diamonds"), card(7), card(11)]
      ])
    );
    game = withHands(game, [
      [HEART_TWO],
      [card(5), card(9)],
      [card(6), card(10)],
      [card(7), card(11)]
    ]);
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    game = applyGameAction(game, 1, { type: "REQUEST_WIND" });
    game = applyGameAction(game, 2, { type: "PASS" });
    game = applyGameAction(game, 3, { type: "PASS" });

    expect(game.phase).toBe("PLAY");
    expect(game.currentPlay).toBeNull();
    expect(game.currentSeat).toBe(1);
    expect(game.wind).toBeNull();
  });

  it("checks every seat after the receiver for a guard", () => {
    let game = openRound(
      create([
        [HEART_TWO, card(14, "hearts")],
        [card(3), card(8)],
        [card(14, "diamonds"), card(9)],
        [card(4), card(13)]
      ]),
      { 0: "contact" }
    );
    game = withHands(game, [
      [HEART_TWO],
      [card(3), card(8)],
      [card(14, "diamonds"), card(9)],
      [card(4), card(13)]
    ]);
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    expect(game.wind?.receiverSeat).toBe(2);
    game = applyGameAction(game, 1, { type: "PASS" });
    game = applyGameAction(game, 2, { type: "REQUEST_WIND" });
    game = applyGameAction(game, 3, {
      type: "PLAY",
      cards: [card(4)]
    });

    expect(game.phase).toBe("PLAY");
    expect(game.currentPlay?.seat).toBe(3);
    expect(game.wind).toBeNull();
  });

  it("uses on-table identity only when contact enabled team wind", () => {
    let game = openRound(
      create([
        [HEART_TWO, card(14, "hearts")],
        [card(4), card(8)],
        [card(14, "diamonds"), card(9)],
        [card(5), card(10)]
      ]),
      { 0: "counter" }
    );
    game = withHands(game, [
      [HEART_TWO],
      [card(4), card(8)],
      [card(14, "diamonds"), card(9)],
      [card(5), card(10)]
    ]);
    expect(game.team.foundPartner).toBe(false);
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    expect(game.wind?.receiverSeat).toBe(1);
  });

  it("gives wind to the first active non-red teammate in 1v3", () => {
    let game = openRound(
      create([
        [card(14, "hearts"), card(14, "diamonds"), card(4)],
        [card(7), card(9)],
        [HEART_TWO, card(5)],
        [card(6), card(8)]
      ]),
      { 0: "contact" }
    );
    game = withHands(game, [
      [card(14, "hearts"), card(4)],
      [card(7), card(9)],
      [HEART_TWO],
      [card(6), card(8)]
    ]);
    game = applyGameAction(game, 2, {
      type: "PLAY",
      cards: [HEART_TWO]
    });

    expect(game.team).toMatchObject({
      mode: "1v3",
      foundPartner: true
    });
    expect(game.wind?.receiverSeat).toBe(3);
  });

  it.each([
    [1, 6, -2, "red", "full"],
    [2, 3, -1, "red", "half"],
    [3, -3, 1, "other", "half"],
    [4, -6, 2, "other", "full"]
  ] as const)(
    "scores sole-player rank %i as %i and each opponent as %i",
    (rank, sole, other, winner, outcome) => {
      expect(soloScoreValues(rank)).toEqual({
        sole,
        other,
        winner,
        outcome
      });
    }
  );

  it("double-counts counter challenges and keeps solo scores zero-sum", () => {
    for (const rank of [1, 2, 3, 4]) {
      const score = soloScoreValues(rank, 2);
      expect(score.sole + score.other * 3).toBe(0);
    }
    expect(soloScoreValues(1, 2)).toMatchObject({ sole: 12, other: -4 });
  });

  it("finishes a 1v3 round immediately when the sole player is first", () => {
    let game = openRound(
      create([
        [
          HEART_TWO,
          card(14, "hearts"),
          card(14, "diamonds"),
          card(5)
        ],
        [card(6)],
        [card(7)],
        [card(8)]
      ])
    );
    game = withHands(game, [
      [HEART_TWO],
      [card(6)],
      [card(7)],
      [card(8)]
    ]);
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [HEART_TWO]
    });

    expect(game.result).toMatchObject({
      teamMode: "1v3",
      soleRank: 1,
      outcome: "full",
      scores: { 0: 6, 1: -2, 2: -2, 3: -2 }
    });
  });

  it("finishes a 1v3 round when the sole player is second", () => {
    let game = openRound(
      create([
        [card(14, "hearts"), card(14, "diamonds"), card(9)],
        [HEART_TWO, card(5)],
        [card(3), card(10)],
        [card(4), card(11)]
      ])
    );
    game = withHands(game, [
      [card(14, "hearts")],
      [HEART_TWO],
      [card(3), card(10)],
      [card(4), card(11)]
    ]);
    game = applyGameAction(game, 1, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    game = applyGameAction(game, 2, {
      type: "PLAY",
      cards: [card(3)]
    });
    game = applyGameAction(game, 3, { type: "PASS" });
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [card(14, "hearts")]
    });

    expect(game.finishOrder).toEqual([1, 0]);
    expect(game.result).toMatchObject({
      teamMode: "1v3",
      soleRank: 2,
      outcome: "half",
      scores: { 0: 3, 1: -1, 2: -1, 3: -1 }
    });
  });

  it("finishes a 1v3 round when the sole player is third", () => {
    let game = openRound(
      create([
        [card(14, "hearts"), card(14, "diamonds"), card(9)],
        [HEART_TWO, card(5)],
        [card(3), card(10)],
        [card(4), card(11)]
      ])
    );
    game = withHands(game, [
      [card(14, "hearts")],
      [HEART_TWO],
      [card(3)],
      [card(4), card(11)]
    ]);
    game = applyGameAction(game, 1, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    game = applyGameAction(game, 2, {
      type: "PLAY",
      cards: [card(3)]
    });
    game = applyGameAction(game, 3, { type: "REQUEST_WIND" });
    game = applyGameAction(game, 0, {
      type: "PLAY",
      cards: [card(14, "hearts")]
    });

    expect(game.finishOrder).toEqual([1, 2, 0]);
    expect(game.result).toMatchObject({
      teamMode: "1v3",
      soleRank: 3,
      outcome: "half",
      scores: { 0: -3, 1: 1, 2: 1, 3: 1 }
    });
  });

  it("ends a 1v3 round as sole-player fourth after all opponents finish", () => {
    let game = openRound(
      create([
        [card(14, "hearts"), card(14, "diamonds"), card(9)],
        [HEART_TWO, card(5)],
        [card(3), card(10)],
        [card(4), card(11)]
      ])
    );
    game = withHands(game, [
      [card(14, "hearts"), card(9)],
      [HEART_TWO],
      [card(3)],
      [card(4)]
    ]);
    game = applyGameAction(game, 1, {
      type: "PLAY",
      cards: [HEART_TWO]
    });
    game = applyGameAction(game, 2, {
      type: "PLAY",
      cards: [card(3)]
    });
    game = applyGameAction(game, 3, {
      type: "PLAY",
      cards: [card(4)]
    });

    expect(game.finishOrder).toEqual([1, 2, 3]);
    expect(game.result).toMatchObject({
      teamMode: "1v3",
      soleRank: 4,
      outcome: "full",
      scores: { 0: -6, 1: 2, 2: 2, 3: 2 }
    });
  });
});

describe("client visibility", () => {
  it("sends only the requesting player's hand and intentional public cards", () => {
    const game = create([
      [HEART_TWO, card(5)],
      [card(14, "diamonds"), card(6, "spades")],
      [card(14, "hearts"), card(7, "hearts")],
      [card(8, "diamonds")]
    ]);
    const view = toClientGameView(game, 0);
    const serialized = JSON.stringify(view);

    expect(view.selfHand.map((visible) => visible.rank).sort()).toEqual([2, 5]);
    expect(view.team).toBeNull();
    expect(view.players.every((player) => !("hand" in player))).toBe(true);
    expect(serialized).not.toContain('"suit":"spades","rank":6');
    expect(serialized).not.toContain('"suit":"hearts","rank":7');
    expect(serialized).not.toContain('"suit":"diamonds","rank":8');
  });

  it("does not offer a contact action merely for a black-suit ace", () => {
    const game = create([
      [HEART_TWO, card(14, "spades")],
      [card(14, "diamonds")],
      [card(14, "hearts")],
      [card(8)]
    ]);
    const view = toClientGameView(game, 0);

    expect(view.actions.selfHasRedAce).toBe(false);
    expect(view.actions.canBeginOpening).toBe(true);
  });
});
