export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

export const RANK_LABELS: Record<Rank, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A"
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣"
};

export const SUIT_DISPLAY_ORDER: Record<Suit, number> = {
  spades: 0,
  hearts: 1,
  diamonds: 2,
  clubs: 3
};

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
}

export function shuffleDeck(
  cards: readonly Card[],
  random: () => number = Math.random
): Card[] {
  const deck = cards.map((card) => ({ ...card }));

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = deck[index];
    const swap = deck[swapIndex];

    if (current === undefined || swap === undefined) {
      throw new Error("Deck index out of bounds");
    }

    deck[index] = swap;
    deck[swapIndex] = current;
  }

  return deck;
}

export function cardKey(card: Card): string {
  return `${card.suit}:${card.rank}`;
}

export function sameCard(left: Card, right: Card): boolean {
  return left.suit === right.suit && left.rank === right.rank;
}

export function cardLabel(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${RANK_LABELS[card.rank]}`;
}

export function isHeartTwo(card: Card): boolean {
  return card.suit === "hearts" && card.rank === 2;
}

export function isRedAce(card: Card): boolean {
  return card.rank === 14 && (card.suit === "hearts" || card.suit === "diamonds");
}

export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }

    return SUIT_DISPLAY_ORDER[left.suit] - SUIT_DISPLAY_ORDER[right.suit];
  });
}

export function strongestCard(cards: readonly Card[]): Card | null {
  if (cards.length === 0) {
    return null;
  }

  return [...cards].sort((left, right) => {
    if (left.rank !== right.rank) {
      return right.rank - left.rank;
    }

    return SUIT_DISPLAY_ORDER[left.suit] - SUIT_DISPLAY_ORDER[right.suit];
  })[0] ?? null;
}

export function removeCards(hand: readonly Card[], played: readonly Card[]): Card[] {
  const playedKeys = new Set(played.map(cardKey));
  return hand.filter((card) => !playedKeys.has(cardKey(card)));
}

export function assertUniqueCards(cards: readonly Card[]): void {
  const keys = new Set(cards.map(cardKey));

  if (keys.size !== cards.length) {
    throw new Error("Duplicate cards are not allowed");
  }
}
