import { describe, expect, it } from "vitest";
import type { Card, Suit } from "../src/cards.js";
import { createDeck, cardKey, shuffleDeck } from "../src/cards.js";
import {
  canBeat,
  identifyCombo
} from "../src/combos.js";

function card(rank: Card["rank"], suit: Suit = "spades"): Card {
  return { rank, suit };
}

describe("deck", () => {
  it("contains 52 unique cards and shuffles without changing the set", () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck, () => 0.42);

    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardKey)).size).toBe(52);
    expect(new Set(shuffled.map(cardKey))).toEqual(new Set(deck.map(cardKey)));
    expect(shuffled).not.toEqual(deck);
  });
});

describe("combo identification", () => {
  it.each([
    ["single", [card(2)]],
    ["single", [card(14)]],
    ["pair", [card(2), card(2, "hearts")]],
    [
      "consecutivePair",
      [
        card(2),
        card(2, "hearts"),
        card(3, "diamonds"),
        card(3, "clubs")
      ]
    ],
    [
      "straight",
      [card(7), card(8, "hearts"), card(9, "diamonds")]
    ],
    ["tripleBomb", [card(13), card(13, "hearts"), card(13, "diamonds")]],
    [
      "quadBomb",
      [
        card(2),
        card(2, "hearts"),
        card(2, "diamonds"),
        card(2, "clubs")
      ]
    ],
    ["doubleA", [card(14), card(14, "hearts")]],
    [
      "tripleA",
      [card(14), card(14, "hearts"), card(14, "diamonds")]
    ],
    [
      "quadA",
      [
        card(14),
        card(14, "hearts"),
        card(14, "diamonds"),
        card(14, "clubs")
      ]
    ]
  ] as const)("recognizes %s", (type, cards) => {
    expect(identifyCombo(cards)?.type).toBe(type);
  });

  it("rejects A in straights and ordinary low ranges in multi-rank combos", () => {
    expect(
      identifyCombo([card(12), card(13, "hearts"), card(14, "diamonds")])
    ).toBeNull();
    expect(
      identifyCombo([card(13), card(14, "hearts")])
    ).toBeNull();
    expect(
      identifyCombo([card(2), card(3, "hearts"), card(5, "diamonds")])
    ).toBeNull();
  });

  it("does not accept three-with-one or other attached-card patterns", () => {
    expect(
      identifyCombo([
        card(8),
        card(8, "hearts"),
        card(8, "diamonds"),
        card(9, "clubs")
      ])
    ).toBeNull();
  });
});

describe("combo comparison", () => {
  const straight789 = identifyCombo([
    card(7),
    card(8, "hearts"),
    card(9, "diamonds")
  ]);
  const straight10JQ = identifyCombo([
    card(10),
    card(11, "hearts"),
    card(12, "diamonds")
  ]);
  const triple2 = identifyCombo([
    card(2),
    card(2, "hearts"),
    card(2, "diamonds")
  ]);
  const tripleK = identifyCombo([
    card(13),
    card(13, "hearts"),
    card(13, "diamonds")
  ]);
  const quad2 = identifyCombo([
    card(2),
    card(2, "hearts"),
    card(2, "diamonds"),
    card(2, "clubs")
  ]);
  const doubleA = identifyCombo([card(14), card(14, "hearts")]);
  const tripleA = identifyCombo([
    card(14),
    card(14, "hearts"),
    card(14, "diamonds")
  ]);
  const quadA = identifyCombo([
    card(14),
    card(14, "hearts"),
    card(14, "diamonds"),
    card(14, "clubs")
  ]);

  it("compares same-type, same-length ordinary combos by rank", () => {
    expect(straight789 && straight10JQ && canBeat(straight10JQ, straight789)).toBe(
      true
    );
    expect(straight789 && canBeat(straight789, straight789)).toBe(false);
  });

  it("does not let a longer straight beat a shorter straight", () => {
    const longer = identifyCombo([
      card(7),
      card(8, "hearts"),
      card(9, "diamonds"),
      card(10, "clubs")
    ]);
    expect(longer && straight789 && canBeat(longer, straight789)).toBe(false);
  });

  it("orders bombs above ordinary combos and quad bombs above triple bombs", () => {
    expect(straight789 && triple2 && canBeat(triple2, straight789)).toBe(true);
    expect(tripleK && triple2 && canBeat(tripleK, triple2)).toBe(true);
    expect(quad2 && tripleK && canBeat(quad2, tripleK)).toBe(true);
    expect(quad2 && tripleK && canBeat(tripleK, quad2)).toBe(false);
  });

  it("lets double-A beat every bomb but not an equal double-A", () => {
    expect(doubleA && quad2 && canBeat(doubleA, quad2)).toBe(true);
    expect(doubleA && canBeat(doubleA, doubleA)).toBe(false);
    expect(quad2 && doubleA && canBeat(quad2, doubleA)).toBe(false);
  });

  it("keeps larger A groups as special non-bomb combos", () => {
    expect(tripleA && quadA && canBeat(quadA, tripleA)).toBe(false);
    expect(tripleA && quad2 && canBeat(tripleA, quad2)).toBe(true);
    expect(doubleA && tripleA && canBeat(doubleA, tripleA)).toBe(false);
  });
});
