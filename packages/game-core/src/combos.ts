import type { Card, Rank } from "./cards.js";
import { RANK_LABELS, cardLabel, isHeartTwo } from "./cards.js";

export type ComboType =
  | "single"
  | "pair"
  | "consecutivePair"
  | "straight"
  | "tripleBomb"
  | "quadBomb"
  | "doubleA"
  | "tripleA"
  | "quadA";

export interface Combo {
  type: ComboType;
  size: number;
  rank: Rank;
}

const ORDINARY_TYPES = new Set<ComboType>([
  "single",
  "pair",
  "consecutivePair",
  "straight"
]);

const SPECIAL_A_TYPES = new Set<ComboType>([
  "doubleA",
  "tripleA",
  "quadA"
]);

export function identifyCombo(cards: readonly Card[]): Combo | null {
  if (cards.length === 0) {
    return null;
  }

  const sorted = [...cards].sort((left, right) => left.rank - right.rank);
  const first = sorted[0];
  const last = sorted.at(-1);

  if (first === undefined || last === undefined) {
    return null;
  }

  const counts = new Map<Rank, number>();
  for (const card of sorted) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }

  if (counts.size === 1) {
    if (sorted.length === 1) {
      return { type: "single", size: 1, rank: last.rank };
    }

    if (last.rank === 14) {
      if (sorted.length === 2) {
        return { type: "doubleA", size: 2, rank: 14 };
      }
      if (sorted.length === 3) {
        return { type: "tripleA", size: 3, rank: 14 };
      }
      if (sorted.length === 4) {
        return { type: "quadA", size: 4, rank: 14 };
      }
      return null;
    }

    if (sorted.length === 2) {
      return { type: "pair", size: 2, rank: last.rank };
    }
    if (sorted.length === 3) {
      return { type: "tripleBomb", size: 3, rank: last.rank };
    }
    if (sorted.length === 4) {
      return { type: "quadBomb", size: 4, rank: last.rank };
    }
    return null;
  }

  if (last.rank === 14) {
    return null;
  }

  const ranks = [...counts.keys()].sort((left, right) => left - right);
  const isConsecutive = ranks.every(
    (rank, index) => index === 0 || rank === (ranks[index - 1] ?? rank - 2) + 1
  );

  if (
    counts.size >= 2 &&
    isConsecutive &&
    [...counts.values()].every((count) => count === 2)
  ) {
    return {
      type: "consecutivePair",
      size: sorted.length,
      rank: last.rank
    };
  }

  if (
    sorted.length >= 3 &&
    isConsecutive &&
    [...counts.values()].every((count) => count === 1)
  ) {
    return {
      type: "straight",
      size: sorted.length,
      rank: last.rank
    };
  }

  return null;
}

export function isBomb(combo: Combo): boolean {
  return combo.type === "tripleBomb" || combo.type === "quadBomb";
}

export function isSpecialAce(combo: Combo): boolean {
  return SPECIAL_A_TYPES.has(combo.type);
}

export function canBeat(challenger: Combo, target: Combo): boolean {
  if (challenger.size === target.size && challenger.type === target.type) {
    if (isSpecialAce(challenger)) {
      return false;
    }

    return challenger.rank > target.rank;
  }

  if (challenger.type === target.type) {
    return false;
  }

  if (isSpecialAce(challenger)) {
    return !isSpecialAce(target);
  }

  if (isSpecialAce(target)) {
    return false;
  }

  if (challenger.type === "quadBomb" && target.type === "tripleBomb") {
    return true;
  }

  if (challenger.type === "tripleBomb" && target.type === "quadBomb") {
    return false;
  }

  if (isBomb(challenger) && !isBomb(target)) {
    return true;
  }

  if (isBomb(target)) {
    return false;
  }

  if (challenger.type !== target.type) {
    return false;
  }

  if (ORDINARY_TYPES.has(challenger.type) && challenger.size !== target.size) {
    return false;
  }

  return challenger.rank > target.rank;
}

export function includesHeartTwo(cards: readonly Card[]): boolean {
  return cards.some(isHeartTwo);
}

export function comboLabel(combo: Combo): string {
  const names: Record<ComboType, string> = {
    single: "单张",
    pair: "对子",
    consecutivePair: "连对",
    straight: "顺子",
    tripleBomb: "三张炸弹",
    quadBomb: "四张炸弹",
    doubleA: "双A",
    tripleA: "三A",
    quadA: "四A"
  };

  if (combo.type === "single") {
    return `${names[combo.type]} ${RANK_LABELS[combo.rank]}`;
  }

  return names[combo.type];
}

export function cardsLabel(cards: readonly Card[]): string {
  return cards.map(cardLabel).join(" ");
}
