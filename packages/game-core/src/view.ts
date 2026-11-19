import type { Card } from "./cards.js";
import { isRedAce } from "./cards.js";
import type {
  HistoryEntry,
  Phase,
  PublicPlay,
  RoundResult,
  Seat,
  TeamMode
} from "./game.js";
import { SEATS } from "./game.js";
import type { GameState } from "./game.js";

export interface PlayerPublicView {
  seat: Seat;
  handCount: number;
  finishedPosition: number | null;
  revealedAces: Card[];
  revealedMaxCard: Card | null;
}

export interface PublicTeamView {
  mode: TeamMode;
  redTeam: Seat[];
  otherTeam: Seat[];
  soleSeat: Seat | null;
  foundPartner: boolean;
}

export interface OpeningPublicView {
  status: "IDLE" | "IN_PROGRESS" | "COMPLETE";
  currentSeat: Seat | null;
  respondedSeats: Seat[];
  contactedSeat: Seat | null;
  counterSeat: Seat | null;
  provisional: true;
  provisionalText: string;
}

export interface WindPublicView {
  mode: "SEEK" | "CLAIMED";
  finisherSeat: Seat;
  receiverSeat: Seat;
  currentSeat: Seat;
}

export interface ActionAvailability {
  canBeginOpening: boolean;
  canRespondOpening: boolean;
  selfHasRedAce: boolean;
  canPlay: boolean;
  canPass: boolean;
  canRequestWind: boolean;
  heartTwoRequired: boolean;
}

export interface ClientGameView {
  roundNumber: number;
  phase: Phase;
  selfSeat: Seat;
  selfHand: Card[];
  players: PlayerPublicView[];
  team: PublicTeamView | null;
  opening: OpeningPublicView;
  startingSeat: Seat;
  currentSeat: Seat | null;
  currentPlay: PublicPlay | null;
  wind: WindPublicView | null;
  multiplier: number;
  heartTwoLeadPending: boolean;
  finishOrder: Seat[];
  result: RoundResult | null;
  history: HistoryEntry[];
  actions: ActionAvailability;
}

export function toClientGameView(
  state: GameState,
  selfSeat: Seat
): ClientGameView {
  const hasRevealedAces = SEATS.some(
    (seat) => state.opening.revealedAces[seat].length > 0
  );
  const teamIsPublic = state.team.foundPartner || hasRevealedAces;
  const selfFinished = state.players[selfSeat].finishedPosition !== null;
  const selfHasRedAce = state.players[selfSeat].hand.some(isRedAce);

  return {
    roundNumber: state.roundNumber,
    phase: state.phase,
    selfSeat,
    selfHand: state.players[selfSeat].hand.map((card) => ({ ...card })),
    players: SEATS.map((seat) => ({
      seat,
      handCount: state.players[seat].hand.length,
      finishedPosition: state.players[seat].finishedPosition,
      revealedAces: state.opening.revealedAces[seat].map((card) => ({
        ...card
      })),
      revealedMaxCard: state.opening.revealedMaxCards[seat]
        ? { ...state.opening.revealedMaxCards[seat] }
        : null
    })),
    team: teamIsPublic
      ? {
          mode: state.team.mode,
          redTeam: [...state.team.redTeam],
          otherTeam: [...state.team.otherTeam],
          soleSeat: state.team.soleSeat,
          foundPartner: state.team.foundPartner
        }
      : null,
    opening: {
      status: state.opening.status,
      currentSeat: state.opening.currentSeat,
      respondedSeats: [...state.opening.respondedSeats],
      contactedSeat: state.opening.contactedSeat,
      counterSeat: state.opening.counterSeat,
      provisional: true,
      provisionalText:
        "暂行开局顺序：从♥2持有者起，四人各响应一次；单独反揪不自动算找伙。"
    },
    startingSeat: state.startingSeat,
    currentSeat: state.currentSeat,
    currentPlay: state.currentPlay
      ? {
          seat: state.currentPlay.seat,
          cards: state.currentPlay.cards.map((card) => ({ ...card })),
          combo: { ...state.currentPlay.combo }
        }
      : null,
    wind: state.wind
      ? {
          mode: state.wind.mode,
          finisherSeat: state.wind.finisherSeat,
          receiverSeat: state.wind.receiverSeat,
          currentSeat: state.wind.currentSeat
        }
      : null,
    multiplier: state.multiplier,
    heartTwoLeadPending: state.heartTwoLeadPending,
    finishOrder: [...state.finishOrder],
    result: state.result
      ? {
          ...state.result,
          scores: { ...state.result.scores },
          finishOrder: [...state.result.finishOrder]
        }
      : null,
    history: state.history.map((entry) => ({
      ...entry,
      cards: entry.cards.map((card) => ({ ...card }))
    })),
    actions: {
      canBeginOpening:
        state.phase === "OPENING" &&
        state.opening.status === "IDLE" &&
        selfSeat === state.startingSeat,
      canRespondOpening:
        state.phase === "OPENING" &&
        state.opening.status === "IN_PROGRESS" &&
        state.currentSeat === selfSeat,
      selfHasRedAce,
      canPlay:
        !selfFinished &&
        state.currentSeat === selfSeat &&
        (state.phase === "PLAY" || state.phase === "WIND_PENDING"),
      canPass:
        !selfFinished &&
        state.currentSeat === selfSeat &&
        ((state.phase === "PLAY" && state.currentPlay !== null) ||
          (state.phase === "WIND_PENDING" &&
            state.wind !== null &&
            !(
              state.wind.mode === "SEEK" &&
              state.wind.receiverSeat === selfSeat
            ))),
      canRequestWind:
        !selfFinished &&
        state.currentSeat === selfSeat &&
        state.phase === "WIND_PENDING" &&
        state.wind?.mode === "SEEK" &&
        state.wind.receiverSeat === selfSeat,
      heartTwoRequired:
        state.heartTwoLeadPending &&
        state.currentSeat === selfSeat &&
        state.phase === "PLAY"
    }
  };
}
