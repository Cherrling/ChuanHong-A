import type { Card } from "@chuanhong/game-core";
import {
  RANK_LABELS,
  SUIT_SYMBOLS,
  cardKey
} from "@chuanhong/game-core";

interface PlayingCardProps {
  card: Card;
  selected?: boolean;
  interactive?: boolean;
  compact?: boolean;
  onClick?: () => void;
}

export function PlayingCard({
  card,
  selected = false,
  interactive = false,
  compact = false,
  onClick
}: PlayingCardProps) {
  const isRed = card.suit === "hearts" || card.suit === "diamonds";
  const className = [
    "playing-card",
    isRed ? "is-red" : "is-black",
    selected ? "is-selected" : "",
    compact ? "is-compact" : "",
    interactive ? "is-interactive" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span className="card-rank">{RANK_LABELS[card.rank]}</span>
      <span className="card-suit">{SUIT_SYMBOLS[card.suit]}</span>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        aria-label={`${RANK_LABELS[card.rank]}${SUIT_SYMBOLS[card.suit]}`}
        aria-pressed={selected}
        data-card={cardKey(card)}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      {content}
    </span>
  );
}
