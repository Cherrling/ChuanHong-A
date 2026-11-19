import type { Card } from "./cards.js";
import {
  assertUniqueCards,
  cardKey,
  isHeartTwo,
  isRedAce,
  removeCards,
  sortCards,
  strongestCard
} from "./cards.js";
import type { Combo } from "./combos.js";
import {
  canBeat,
  cardsLabel,
  comboLabel,
  identifyCombo,
  includesHeartTwo
} from "./combos.js";

export const SEAT_COUNT = 4;
export const SEATS = [0, 1, 2, 3] as const;
export type Seat = (typeof SEATS)[number];
export type Phase = "OPENING" | "PLAY" | "WIND_PENDING" | "FINISHED";
export type TeamMode = "2v2" | "1v3";
export type OpeningResponse = "contact" | "quiet" | "counter";

export interface PlayerGameState {
  seat: Seat;
  hand: Card[];
  finishedPosition: number | null;
}

export interface OpeningState {
  status: "IDLE" | "IN_PROGRESS" | "COMPLETE";
  currentSeat: Seat | null;
  respondedSeats: Seat[];
  responses: Record<Seat, OpeningResponse | null>;
  contactedSeat: Seat | null;
  counterSeats: Seat[];
  revealedHeartTwo: Card | null;
  revealedAces: Record<Seat, Card[]>;
  revealedMaxCards: Record<Seat, Card | null>;
}

export interface TeamState {
  mode: TeamMode;
  redAceSeats: Seat[];
  redTeam: Seat[];
  otherTeam: Seat[];
  soleSeat: Seat | null;
  foundPartner: boolean;
}

export interface PublicPlay {
  seat: Seat;
  cards: Card[];
  combo: Combo;
}

export interface WindState {
  mode: "SEEK" | "CLAIMED";
  finisherSeat: Seat;
  receiverSeat: Seat;
  currentSeat: Seat;
  passedSeats: Seat[];
}

export interface RoundResult {
  teamMode: TeamMode;
  winningSide: "red" | "other";
  outcome: "full" | "half";
  soleRank: number | null;
  multiplier: number;
  scores: Record<Seat, number>;
  finishOrder: Seat[];
}

export interface HistoryEntry {
  id: number;
  type: "system" | "opening" | "play" | "pass" | "wind" | "finish";
  seat: Seat | null;
  text: string;
  cards: Card[];
}

export interface RulePolicy {
  openingOrder: "play-order";
  redCounterDoesContact: true;
  counterMultiplierCap: 2;
  windReceiverMustChoose: true;
  tiedStrongestSuitOrder: "spades-hearts-diamonds-clubs";
}

export interface GameState {
  roundNumber: number;
  phase: Phase;
  players: Record<Seat, PlayerGameState>;
  team: TeamState;
  opening: OpeningState;
  startingSeat: Seat;
  currentSeat: Seat | null;
  currentPlay: PublicPlay | null;
  passes: Seat[];
  wind: WindState | null;
  heartTwoLeadPending: boolean;
  finishOrder: Seat[];
  multiplier: number;
  result: RoundResult | null;
  history: HistoryEntry[];
  policy: RulePolicy;
}

export type GameAction =
  | { type: "BEGIN_OPENING" }
  | { type: "OPENING_RESPONSE"; response: OpeningResponse }
  | { type: "PLAY"; cards: Card[] }
  | { type: "PASS" }
  | { type: "REQUEST_WIND" };

export class RuleError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "RuleError";
  }
}

export function isSeat(value: number): value is Seat {
  return value >= 0 && value < SEAT_COUNT && Number.isInteger(value);
}

export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % SEAT_COUNT) as Seat;
}

export function seatsAfter(seat: Seat): Seat[] {
  return [1, 2, 3].map((offset) => ((seat + offset) % SEAT_COUNT) as Seat);
}

function emptySeatRecord<T>(createValue: () => T): Record<Seat, T> {
  return {
    0: createValue(),
    1: createValue(),
    2: createValue(),
    3: createValue()
  };
}

function redAceSeats(players: Record<Seat, PlayerGameState>): Seat[] {
  return SEATS.filter((seat) =>
    players[seat].hand.some(isRedAce)
  );
}

function buildTeam(players: Record<Seat, PlayerGameState>): TeamState {
  const holders = redAceSeats(players);
  const otherTeam = SEATS.filter((seat) => !holders.includes(seat));

  return {
    mode: holders.length === 1 ? "1v3" : "2v2",
    redAceSeats: holders,
    redTeam: holders,
    otherTeam,
    soleSeat: holders.length === 1 ? (holders[0] ?? null) : null,
    foundPartner: false
  };
}

function revealAllRedAces(state: GameState): void {
  for (const seat of SEATS) {
    state.opening.revealedAces[seat] = state.players[seat].hand
      .filter(isRedAce)
      .map((card) => ({ ...card }));
  }
}

function revealAllStrongestCards(state: GameState): void {
  for (const seat of SEATS) {
    const best = strongestCard(state.players[seat].hand);
    state.opening.revealedMaxCards[seat] = best ? { ...best } : null;
  }
}

function historyEntry(
  state: GameState,
  type: HistoryEntry["type"],
  seat: Seat | null,
  text: string,
  cards: Card[] = []
): void {
  state.history.push({
    id: state.history.length + 1,
    type,
    seat,
    text,
    cards: cards.map((card) => ({ ...card }))
  });
}

function cloneState(state: GameState): GameState {
  const players = emptySeatRecord<PlayerGameState>(() => ({
    seat: 0,
    hand: [],
    finishedPosition: null
  }));
  for (const seat of SEATS) {
    players[seat] = {
      ...state.players[seat],
      hand: state.players[seat].hand.map((card) => ({ ...card }))
    };
  }

  return {
    ...state,
    players,
    team: {
      ...state.team,
      redAceSeats: [...state.team.redAceSeats],
      redTeam: [...state.team.redTeam],
      otherTeam: [...state.team.otherTeam]
    },
    opening: {
      ...state.opening,
      respondedSeats: [...state.opening.respondedSeats],
      responses: { ...state.opening.responses },
      counterSeats: [...state.opening.counterSeats],
      revealedHeartTwo: state.opening.revealedHeartTwo
        ? { ...state.opening.revealedHeartTwo }
        : null,
      revealedAces: {
        0: state.opening.revealedAces[0].map((card) => ({ ...card })),
        1: state.opening.revealedAces[1].map((card) => ({ ...card })),
        2: state.opening.revealedAces[2].map((card) => ({ ...card })),
        3: state.opening.revealedAces[3].map((card) => ({ ...card }))
      },
      revealedMaxCards: { ...state.opening.revealedMaxCards }
    },
    currentPlay: state.currentPlay
      ? {
          seat: state.currentPlay.seat,
          cards: state.currentPlay.cards.map((card) => ({ ...card })),
          combo: { ...state.currentPlay.combo }
        }
      : null,
    passes: [...state.passes],
    wind: state.wind
      ? { ...state.wind, passedSeats: [...state.wind.passedSeats] }
      : null,
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
    policy: { ...state.policy }
  };
}

export interface CreateGameOptions {
  roundNumber?: number;
  policy?: RulePolicy;
}

export function createGame(
  hands: readonly [
    readonly Card[],
    readonly Card[],
    readonly Card[],
    readonly Card[]
  ],
  options: CreateGameOptions = {}
): GameState {
  const allCards = hands.flatMap((hand) => [...hand]);
  assertUniqueCards(allCards);
  if (allCards.filter(isRedAce).length !== 2) {
    throw new RuleError(
      "INVALID_DEAL",
      "A round requires the heart ace and diamond ace"
    );
  }

  const heartTwoSeats = SEATS.filter((seat) =>
    hands[seat].some(isHeartTwo)
  );
  if (heartTwoSeats.length !== 1) {
    throw new RuleError(
      "INVALID_DEAL",
      "A round requires exactly one heart two"
    );
  }

  const players = emptySeatRecord<PlayerGameState>(() => ({
    seat: 0,
    hand: [],
    finishedPosition: null
  }));
  for (const seat of SEATS) {
    players[seat] = {
      seat,
      hand: sortCards(hands[seat]),
      finishedPosition: null
    };
  }

  const startingSeat = heartTwoSeats[0] as Seat;
  const team = buildTeam(players);
  const policy: RulePolicy = options.policy ?? {
    openingOrder: "play-order",
    redCounterDoesContact: true,
    counterMultiplierCap: 2,
    windReceiverMustChoose: true,
    tiedStrongestSuitOrder: "spades-hearts-diamonds-clubs"
  };

  return {
    roundNumber: options.roundNumber ?? 1,
    phase: "OPENING",
    players,
    team,
    opening: {
      status: "IDLE",
      currentSeat: null,
      respondedSeats: [],
      responses: emptySeatRecord(() => null),
      contactedSeat: null,
      counterSeats: [],
      revealedHeartTwo: null,
      revealedAces: emptySeatRecord(() => []),
      revealedMaxCards: emptySeatRecord(() => null)
    },
    startingSeat,
    currentSeat: startingSeat,
    currentPlay: null,
    passes: [],
    wind: null,
    heartTwoLeadPending: true,
    finishOrder: [],
    multiplier: 1,
    result: null,
    history: [],
    policy
  };
}

function assertNotFinished(state: GameState): void {
  if (state.phase === "FINISHED") {
    throw new RuleError("GAME_FINISHED", "The round has already finished");
  }
}

function assertActor(state: GameState, actor: Seat): void {
  if (!isSeat(actor)) {
    throw new RuleError("INVALID_SEAT", "Invalid seat");
  }
  if (state.currentSeat !== actor) {
    throw new RuleError("NOT_YOUR_TURN", "It is not this player's turn");
  }
}

function validateSelectedCards(
  state: GameState,
  actor: Seat,
  cards: readonly Card[]
): Combo {
  if (cards.length === 0) {
    throw new RuleError("EMPTY_PLAY", "Select at least one card");
  }
  assertUniqueCards(cards);

  const handKeys = new Set(state.players[actor].hand.map(cardKey));
  if (cards.some((card) => !handKeys.has(cardKey(card)))) {
    throw new RuleError("CARD_NOT_IN_HAND", "A selected card is not in hand");
  }

  const combo = identifyCombo(cards);
  if (!combo) {
    throw new RuleError("INVALID_COMBO", "The selected cards are not a legal combo");
  }

  return combo;
}

function assertPlayAllowed(
  state: GameState,
  combo: Combo,
  cards: readonly Card[],
  inWind: boolean
): void {
  if (state.heartTwoLeadPending && !inWind) {
    if (!includesHeartTwo(cards)) {
      throw new RuleError(
        "HEART_TWO_REQUIRED",
        "The opening play must include the heart two"
      );
    }
  }

  if (!state.currentPlay) {
    return;
  }

  if (!canBeat(combo, state.currentPlay.combo)) {
    throw new RuleError(
      "PLAY_TOO_SMALL",
      "The play does not beat the current target"
    );
  }
}

function activeSeats(state: GameState): Seat[] {
  return SEATS.filter(
    (seat) => state.players[seat].finishedPosition === null
  );
}

function nextActiveSeat(state: GameState, from: Seat): Seat {
  for (const seat of seatsAfter(from)) {
    if (state.players[seat].finishedPosition === null) {
      return seat;
    }
  }

  return from;
}

function isTeammate(state: GameState, left: Seat, right: Seat): boolean {
  if (left === right) {
    return false;
  }
  if (state.team.mode === "1v3") {
    return (
      !state.team.redTeam.includes(left) &&
      !state.team.redTeam.includes(right)
    );
  }

  return (
    state.team.redTeam.includes(left) === state.team.redTeam.includes(right)
  );
}

function chooseWindReceiver(state: GameState, finisherSeat: Seat): Seat {
  const candidates = seatsAfter(finisherSeat).filter(
    (seat) => state.players[seat].finishedPosition === null
  );

  if (state.team.foundPartner) {
    const teammate = candidates.find((seat) =>
      isTeammate(state, finisherSeat, seat)
    );
    if (teammate !== undefined) {
      return teammate;
    }
  }

  return candidates[0] ?? finisherSeat;
}

function startWind(state: GameState, finisherSeat: Seat): void {
  const receiverSeat = chooseWindReceiver(state, finisherSeat);
  const currentSeat = nextActiveSeat(state, finisherSeat);
  state.phase = "WIND_PENDING";
  state.wind = {
    mode: "SEEK",
    finisherSeat,
    receiverSeat,
    currentSeat,
    passedSeats: []
  };
  state.currentSeat = currentSeat;
  historyEntry(
    state,
    "wind",
    finisherSeat,
    `玩家 ${finisherSeat + 1} 走牌，接风者为玩家 ${receiverSeat + 1}`
  );
}

function scoreTwoVersusTwo(
  state: GameState,
  winner: "red" | "other",
  outcome: "full" | "half"
): Record<Seat, number> {
  const base = outcome === "full" ? 2 : 1;
  const scores = emptySeatRecord(() => 0);

  for (const seat of SEATS) {
    const onWinningTeam =
      winner === "red"
        ? state.team.redTeam.includes(seat)
        : state.team.otherTeam.includes(seat);
    scores[seat] = (onWinningTeam ? base : -base) * state.multiplier;
  }

  return scores;
}

export interface SoloScoreValues {
  sole: number;
  other: number;
  winner: "red" | "other";
  outcome: "full" | "half";
}

export function soloScoreValues(
  soleRank: number,
  multiplier = 1
): SoloScoreValues {
  const table = {
    1: { sole: 6, other: -2, winner: "red" as const, outcome: "full" as const },
    2: { sole: 3, other: -1, winner: "red" as const, outcome: "half" as const },
    3: { sole: -3, other: 1, winner: "other" as const, outcome: "half" as const },
    4: { sole: -6, other: 2, winner: "other" as const, outcome: "full" as const }
  };
  const entry = table[soleRank as keyof typeof table];
  if (!entry) {
    throw new RuleError("INVALID_RESULT", "Invalid sole-player rank");
  }

  return {
    sole: entry.sole * multiplier,
    other: entry.other * multiplier,
    winner: entry.winner,
    outcome: entry.outcome
  };
}

function scoreOneVersusThree(
  state: GameState,
  soleRank: number
): { winner: "red" | "other"; outcome: "full" | "half"; scores: Record<Seat, number> } {
  const scores = emptySeatRecord(() => 0);
  const soleSeat = state.team.soleSeat;
  if (soleSeat === null) {
    throw new RuleError("INVALID_TEAM", "The round has no sole player");
  }

  const entry = soloScoreValues(soleRank, state.multiplier);

  for (const seat of SEATS) {
    scores[seat] = seat === soleSeat ? entry.sole : entry.other;
  }

  return {
    winner: entry.winner,
    outcome: entry.outcome,
    scores
  };
}

function resolveRoundIfFinished(state: GameState): boolean {
  if (state.team.mode === "2v2") {
    const redFinished = state.team.redTeam.every((seat) =>
      state.finishOrder.includes(seat)
    );
    const otherFinished = state.team.otherTeam.every((seat) =>
      state.finishOrder.includes(seat)
    );

    if (!redFinished && !otherFinished) {
      return false;
    }

    const winner = redFinished ? "red" : "other";
    const winnerSeats =
      winner === "red" ? state.team.redTeam : state.team.otherTeam;
    const positions = winnerSeats.map((seat) =>
      state.finishOrder.indexOf(seat)
    );
    const outcome = positions.includes(0) && positions.includes(1) ? "full" : "half";

    state.phase = "FINISHED";
    state.currentSeat = null;
    state.wind = null;
    state.currentPlay = null;
    state.result = {
      teamMode: state.team.mode,
      winningSide: winner,
      outcome,
      soleRank: null,
      multiplier: state.multiplier,
      scores: scoreTwoVersusTwo(state, winner, outcome),
      finishOrder: [...state.finishOrder]
    };
    historyEntry(
      state,
      "finish",
      null,
      winner === "red" ? "红A队获胜" : "另一队获胜"
    );
    return true;
  }

  const soleSeat = state.team.soleSeat;
  if (soleSeat === null) {
    throw new RuleError("INVALID_TEAM", "The round has no sole player");
  }

  const solePosition = state.finishOrder.indexOf(soleSeat);
  const nonSoleSeats = state.team.otherTeam;
  const allOthersFinished = nonSoleSeats.every((seat) =>
    state.finishOrder.includes(seat)
  );

  if (solePosition < 0 && !allOthersFinished) {
    return false;
  }

  const soleRank = solePosition >= 0 ? solePosition + 1 : 4;
  const score = scoreOneVersusThree(state, soleRank);
  state.phase = "FINISHED";
  state.currentSeat = null;
  state.wind = null;
  state.currentPlay = null;
  state.result = {
    teamMode: state.team.mode,
    winningSide: score.winner,
    outcome: score.outcome,
    soleRank,
    multiplier: state.multiplier,
    scores: score.scores,
    finishOrder: [...state.finishOrder]
  };
  historyEntry(
    state,
    "finish",
    null,
    `独子获得第 ${soleRank} 名`
  );
  return true;
}

function registerFinish(state: GameState, seat: Seat): void {
  if (state.players[seat].finishedPosition !== null) {
    return;
  }

  state.finishOrder.push(seat);
  state.players[seat].finishedPosition = state.finishOrder.length;
  historyEntry(
    state,
    "system",
    seat,
    `玩家 ${seat + 1} 第 ${state.finishOrder.length} 名走完`
  );
}

function commitPlay(
  state: GameState,
  actor: Seat,
  cards: readonly Card[],
  combo: Combo
): void {
  state.players[actor].hand = removeCards(state.players[actor].hand, cards);
  state.currentPlay = {
    seat: actor,
    cards: cards.map((card) => ({ ...card })),
    combo: { ...combo }
  };
  state.passes = [];
  state.heartTwoLeadPending = false;
  historyEntry(
    state,
    "play",
    actor,
    `玩家 ${actor + 1} 打出${comboLabel(combo)}：${cardsLabel(cards)}`,
    [...cards]
  );
}

function afterPlay(state: GameState, actor: Seat): void {
  if (state.players[actor].hand.length === 0) {
    registerFinish(state, actor);
    if (resolveRoundIfFinished(state)) {
      return;
    }
    startWind(state, actor);
    return;
  }

  state.phase = "PLAY";
  state.wind = null;
  state.currentSeat = nextActiveSeat(state, actor);
}

function handleOpeningAction(
  state: GameState,
  actor: Seat,
  action: GameAction
): void {
  if (state.phase !== "OPENING") {
    throw new RuleError("WRONG_PHASE", "The opening phase has ended");
  }

  if (action.type === "BEGIN_OPENING") {
    if (state.opening.status !== "IDLE") {
      throw new RuleError("OPENING_ALREADY_STARTED", "Opening has already started");
    }
    if (actor !== state.startingSeat) {
      throw new RuleError(
        "HEART_TWO_HOLDER_ONLY",
        "Only the heart-two holder can begin the question"
      );
    }

    state.opening.status = "IN_PROGRESS";
    state.opening.currentSeat = state.startingSeat;
    state.currentSeat = state.startingSeat;
    const heartTwo = state.players[actor].hand.find(isHeartTwo);
    if (!heartTwo) {
      throw new RuleError("INVALID_DEAL", "The starting player has no heart two");
    }
    state.opening.revealedHeartTwo = { ...heartTwo };
    historyEntry(
      state,
      "opening",
      actor,
      "♥2 持有者展示 ♥2 并开始询问，按出牌顺序逐座响应",
      [heartTwo]
    );
    return;
  }

  if (action.type !== "OPENING_RESPONSE") {
    throw new RuleError("ACTION_NOT_ALLOWED", "Use an opening response now");
  }
  if (state.opening.status !== "IN_PROGRESS") {
    throw new RuleError("OPENING_NOT_STARTED", "The opening question has not started");
  }
  assertActor(state, actor);
  if (state.opening.respondedSeats.includes(actor)) {
    throw new RuleError("ALREADY_RESPONDED", "This player already responded");
  }

  if (action.response === "contact") {
    if (!state.team.redAceSeats.includes(actor)) {
      throw new RuleError("NOT_RED_ACE_HOLDER", "Only a red-A holder can contact");
    }
    state.opening.contactedSeat ??= actor;
    state.team.foundPartner = true;
    revealAllRedAces(state);
    if (state.team.mode === "1v3" && state.team.soleSeat === actor) {
      state.opening.counterSeats.push(actor);
      state.multiplier = 2;
      revealAllStrongestCards(state);
      historyEntry(
        state,
        "opening",
        actor,
        `玩家 ${actor + 1} 主动公开独子红A，等同反揪`
      );
    } else {
      historyEntry(state, "opening", actor, `玩家 ${actor + 1} 联系并公开全部红A`);
    }
  } else if (action.response === "counter") {
    const firstCounter = state.opening.counterSeats.length === 0;
    state.opening.counterSeats.push(actor);
    state.multiplier = 2;
    if (state.team.redAceSeats.includes(actor)) {
      state.team.foundPartner = true;
      revealAllRedAces(state);
    }
    revealAllStrongestCards(state);
    historyEntry(
      state,
      "opening",
      actor,
      firstCounter
        ? `玩家 ${actor + 1} 反揪，全员展示最大单张，倍率变为 2`
        : `玩家 ${actor + 1} 同时选择反揪，效果相同，倍率保持 2`
    );
  } else {
    historyEntry(state, "opening", actor, `玩家 ${actor + 1} 不表态`);
  }

  state.opening.responses[actor] = action.response;
  state.opening.respondedSeats.push(actor);

  if (state.opening.respondedSeats.length === SEAT_COUNT) {
    state.opening.status = "COMPLETE";
    state.opening.currentSeat = null;
    state.phase = "PLAY";
    state.currentSeat = state.startingSeat;
    historyEntry(state, "system", null, "开局询问结束，由 ♥2 持有者领出");
    return;
  }

  const next = nextSeat(actor);
  state.opening.currentSeat = next;
  state.currentSeat = next;
}

function handlePlay(
  state: GameState,
  actor: Seat,
  cards: Card[]
): void {
  assertActor(state, actor);
  if (state.players[actor].finishedPosition !== null) {
    throw new RuleError("PLAYER_FINISHED", "A finished player cannot act");
  }

  const combo = validateSelectedCards(state, actor, cards);
  assertPlayAllowed(state, combo, cards, state.phase === "WIND_PENDING");
  commitPlay(state, actor, cards, combo);
  afterPlay(state, actor);
}

function handlePass(state: GameState, actor: Seat): void {
  assertActor(state, actor);
  if (state.phase === "PLAY") {
    if (!state.currentPlay) {
      throw new RuleError("CANNOT_PASS_ON_LEAD", "A lead player cannot pass");
    }

    state.passes.push(actor);
    historyEntry(state, "pass", actor, `玩家 ${actor + 1} 不要`);
    const next = nextActiveSeat(state, actor);

    if (next === state.currentPlay.seat) {
      const leader = state.currentPlay.seat;
      state.currentPlay = null;
      state.passes = [];
      state.currentSeat = leader;
      historyEntry(
        state,
        "system",
        leader,
        `其余玩家都不要，玩家 ${leader + 1} 获得自由领出权`
      );
      return;
    }

    state.currentSeat = next;
    return;
  }

  if (state.phase !== "WIND_PENDING" || !state.wind) {
    throw new RuleError("CANNOT_PASS_NOW", "Pass is not allowed now");
  }

  if (state.wind.mode === "SEEK" && actor === state.wind.receiverSeat) {
    throw new RuleError(
      "WIND_RECEIVER_MUST_CHOOSE",
      "The wind receiver must request wind or play"
    );
  }

  state.wind.passedSeats.push(actor);
  historyEntry(state, "pass", actor, `玩家 ${actor + 1} 不要`);
  const next = nextActiveSeat(state, actor);

  if (
    state.wind.mode === "CLAIMED" &&
    next === state.wind.receiverSeat
  ) {
    const receiver = state.wind.receiverSeat;
    state.phase = "PLAY";
    state.currentPlay = null;
    state.currentSeat = receiver;
    state.wind = null;
    state.passes = [];
    historyEntry(
      state,
      "wind",
      receiver,
      `无人管风，玩家 ${receiver + 1} 接风并自由领出`
    );
    return;
  }

  state.wind.currentSeat = next;
  state.currentSeat = next;
}

function handleRequestWind(state: GameState, actor: Seat): void {
  assertActor(state, actor);
  if (state.phase !== "WIND_PENDING" || !state.wind) {
    throw new RuleError("NO_WIND", "There is no wind to request");
  }
  if (state.wind.mode !== "SEEK" || state.wind.receiverSeat !== actor) {
    throw new RuleError(
      "WIND_NOT_AVAILABLE",
      "Only the selected receiver can request wind now"
    );
  }

  state.wind.mode = "CLAIMED";
  state.wind.passedSeats = [];
  const next = nextActiveSeat(state, actor);
  state.wind.currentSeat = next;
  state.currentSeat = next;
  historyEntry(state, "wind", actor, `玩家 ${actor + 1} 要风`);

  if (next === actor) {
    state.phase = "PLAY";
    state.currentPlay = null;
    state.wind = null;
  }
}

export function applyGameAction(
  state: GameState,
  actor: Seat,
  action: GameAction
): GameState {
  assertNotFinished(state);
  const nextState = cloneState(state);

  if (nextState.phase === "OPENING") {
    handleOpeningAction(nextState, actor, action);
    return nextState;
  }

  if (action.type === "PLAY") {
    if (nextState.phase !== "PLAY" && nextState.phase !== "WIND_PENDING") {
      throw new RuleError("WRONG_PHASE", "Cards cannot be played now");
    }
    handlePlay(nextState, actor, action.cards);
    return nextState;
  }

  if (action.type === "PASS") {
    handlePass(nextState, actor);
    return nextState;
  }

  if (action.type === "REQUEST_WIND") {
    handleRequestWind(nextState, actor);
    return nextState;
  }

  throw new RuleError("ACTION_NOT_ALLOWED", "This action is not allowed now");
}

export function getActiveSeats(state: GameState): Seat[] {
  return activeSeats(state);
}

export function getTeamForSeat(state: GameState, seat: Seat): Seat[] {
  return state.team.redTeam.includes(seat)
    ? state.team.redTeam
    : state.team.otherTeam;
}
