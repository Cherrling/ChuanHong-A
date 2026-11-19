import { useEffect, useMemo, useState } from "react";
import type {
  Card,
  ClientGameView,
  GameAction,
  RoomSnapshot,
  Seat
} from "@chuanhong/game-core";
import {
  cardKey,
  cardLabel,
  comboLabel,
  identifyCombo
} from "@chuanhong/game-core";
import { PlayingCard } from "./PlayingCard";

interface GameTableProps {
  snapshot: RoomSnapshot;
  busy: boolean;
  message: string | null;
  onDismissMessage: () => void;
  onAction: (action: GameAction) => Promise<boolean>;
  onNextRound: () => Promise<void>;
}

type TablePosition = "bottom" | "right" | "top" | "left";

function positionFor(seat: Seat, selfSeat: Seat): TablePosition {
  const offset = (seat - selfSeat + 4) % 4;
  return (["bottom", "right", "top", "left"] as const)[offset] ?? "top";
}

function playerName(snapshot: RoomSnapshot, seat: Seat): string {
  return snapshot.players.find((player) => player.seat === seat)?.name ?? `玩家${seat + 1}`;
}

function selectedCards(hand: Card[], selectedKeys: string[]): Card[] {
  const wanted = new Set(selectedKeys);
  return hand.filter((card) => wanted.has(cardKey(card)));
}

export function GameTable(props: GameTableProps) {
  const game = props.snapshot.game;
  if (!game) {
    return null;
  }

  return <GameTableContent {...props} game={game} />;
}

function GameTableContent({
  snapshot,
  busy,
  message,
  onDismissMessage,
  onAction,
  onNextRound,
  game
}: GameTableProps & { game: ClientGameView }) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const selectionSignature = [
    game.roundNumber,
    game.phase,
    game.currentSeat,
    game.selfHand.map(cardKey).join(",")
  ].join("|");

  useEffect(() => {
    setSelectedKeys([]);
  }, [selectionSignature]);

  const selected = useMemo(
    () => selectedCards(game.selfHand, selectedKeys),
    [game.selfHand, selectedKeys]
  );
  const selectedCombo = selected.length > 0 ? identifyCombo(selected) : null;

  function toggleCard(card: Card): void {
    if (!game.actions.canPlay || busy) {
      return;
    }
    const key = cardKey(card);
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((candidate) => candidate !== key)
        : [...current, key]
    );
  }

  async function send(action: GameAction): Promise<void> {
    const accepted = await onAction(action);
    if (accepted) {
      setSelectedKeys([]);
    }
  }

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="brand-lockup compact-brand">
          <span className="brand-mark">串</span>
          <div>
            <strong>串红A</strong>
            <span>第 {game.roundNumber} 局</span>
          </div>
        </div>
        <div className="room-meta">
          <span className="room-code">房间 {snapshot.roomCode}</span>
          <span className={game.multiplier > 1 ? "multiplier is-hot" : "multiplier"}>
            ×{game.multiplier}
          </span>
          <span className={`phase-pill phase-${game.phase.toLowerCase()}`}>
            {phaseLabel(game)}
          </span>
        </div>
      </header>

      {message ? (
        <button type="button" className="notice-banner" onClick={onDismissMessage}>
          <span>{message}</span>
          <span aria-hidden="true">关闭</span>
        </button>
      ) : null}

      <div className="game-layout">
        <section className="table-column">
          <div className="table-felt" aria-label="牌桌">
            {snapshot.players.map((player) => (
              <PlayerSeat
                key={player.id}
                snapshot={snapshot}
                game={game}
                seat={player.seat}
              />
            ))}

            <div className="table-center">
              <div className="table-emblem" aria-hidden="true">
                <span>红</span>
                <span>A</span>
              </div>
              {game.currentPlay ? (
                <div className="current-play">
                  <p>
                    {playerName(snapshot, game.currentPlay.seat)} ·{" "}
                    {comboLabel(game.currentPlay.combo)}
                  </p>
                  <div className="card-row">
                    {game.currentPlay.cards.map((card) => (
                      <PlayingCard key={cardKey(card)} card={card} compact />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="lead-state">
                  <strong>{game.actions.canPlay ? "自由领出" : "等待领出"}</strong>
                  <span>
                    {game.heartTwoLeadPending
                      ? "首手必须包含 ♥2"
                      : "可出任意合法牌型"}
                  </span>
                </div>
              )}
              {game.wind ? <WindFlag game={game} snapshot={snapshot} /> : null}
            </div>
          </div>

          <section className="hand-zone" aria-label="我的手牌">
            <div className="hand-heading">
              <div>
                <span className="eyebrow">我的手牌</span>
                <strong>{playerName(snapshot, game.selfSeat)}</strong>
              </div>
              <span>{game.selfHand.length} 张</span>
            </div>
            <div className="hand-cards">
              {game.selfHand.map((card) => {
                const key = cardKey(card);
                return (
                  <PlayingCard
                    key={key}
                    card={card}
                    selected={selectedKeys.includes(key)}
                    interactive={game.actions.canPlay}
                    onClick={() => toggleCard(card)}
                  />
                );
              })}
            </div>
            {selected.length > 0 ? (
              <div className="selection-summary">
                <span>已选 {selected.length} 张</span>
                <strong>
                  {selectedCombo ? comboLabel(selectedCombo) : "牌型未成"}
                </strong>
              </div>
            ) : null}
          </section>

          <ActionDock
            snapshot={snapshot}
            game={game}
            busy={busy}
            selected={selected}
            onAction={send}
          />

          {game.phase === "FINISHED" && game.result ? (
            <RoundResult
              snapshot={snapshot}
              game={game}
              busy={busy}
              onNextRound={onNextRound}
            />
          ) : null}
        </section>

        <aside className="game-sidebar">
          <section className="sidebar-card opening-card">
            <div className="section-heading">
              <span className="eyebrow">开局</span>
              <strong>找伙与反揪</strong>
            </div>
            {game.opening.provisional ? (
              <p className="policy-note">{game.opening.provisionalText}</p>
            ) : null}
            {game.team ? (
              <div className="team-summary">
                <span>{game.team.mode} · 已公开队伍</span>
                <strong>
                  红A队：
                  {game.team.redTeam
                    .map((seat) => playerName(snapshot, seat))
                    .join("、")}
                </strong>
                <small>
                  {game.team.foundPartner ? "本局已找伙" : "本局未找伙"}
                </small>
              </div>
            ) : (
              <div className="team-summary muted">
                <span>队伍尚未公开</span>
                <strong>红A持有者可在开局窗口联系</strong>
              </div>
            )}
          </section>

          <section className="sidebar-card">
            <div className="section-heading">
              <span className="eyebrow">公开记录</span>
              <strong>回合动态</strong>
            </div>
            <ol className="history-list">
              {[...game.history].reverse().slice(0, 30).map((entry) => (
                <li key={entry.id} className={`history-${entry.type}`}>
                  <span>{entry.text}</span>
                  {entry.cards.length > 0 ? (
                    <small>
                      {entry.cards.map(cardLabel).join(" ")}
                    </small>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <p className="memory-note">
            房间只保存在服务器内存中，重启后本局与累计积分会丢失。
          </p>
        </aside>
      </div>
    </main>
  );
}

interface PlayerSeatProps {
  snapshot: RoomSnapshot;
  game: ClientGameView;
  seat: Seat;
}

function PlayerSeat({ snapshot, game, seat }: PlayerSeatProps) {
  const player = snapshot.players.find((candidate) => candidate.seat === seat);
  const gamePlayer = game.players.find((candidate) => candidate.seat === seat);
  const position = positionFor(seat, game.selfSeat);
  const isCurrent = game.currentSeat === seat;
  const isSelf = game.selfSeat === seat;
  const isReceiver = game.wind?.receiverSeat === seat;

  if (!player || !gamePlayer) {
    return null;
  }

  return (
    <article
      className={[
        "player-seat",
        `seat-${position}`,
        isCurrent ? "is-current" : "",
        isSelf ? "is-self" : "",
        !player.connected ? "is-offline" : "",
        gamePlayer.finishedPosition ? "is-finished" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="seat-avatar" aria-hidden="true">
        {player.name.slice(0, 1)}
      </div>
      <div className="seat-info">
        <div className="seat-name-line">
          <strong>{player.name}</strong>
          {player.isHost ? <span className="mini-tag">房主</span> : null}
          {isReceiver ? <span className="mini-tag wind-tag">接风</span> : null}
        </div>
        <div className="seat-stats">
          <span>{gamePlayer.handCount} 张</span>
          <span>{player.totalScore >= 0 ? "+" : ""}{player.totalScore} 分</span>
        </div>
        {gamePlayer.finishedPosition ? (
          <span className="finish-tag">第 {gamePlayer.finishedPosition} 名</span>
        ) : null}
        {!player.connected ? <span className="offline-tag">已断线</span> : null}
      </div>
      <div className="public-cards">
        {gamePlayer.revealedAces.map((card) => (
          <PlayingCard key={`ace-${cardKey(card)}`} card={card} compact />
        ))}
        {gamePlayer.revealedMaxCard ? (
          <div className="max-card-wrap">
            <small>最大</small>
            <PlayingCard card={gamePlayer.revealedMaxCard} compact />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function WindFlag({
  game,
  snapshot
}: {
  game: ClientGameView;
  snapshot: RoomSnapshot;
}) {
  if (!game.wind) {
    return null;
  }

  return (
    <div className="wind-flag">
      <span className="wind-icon">风</span>
      <div>
        <strong>
          {game.wind.mode === "SEEK" ? "等待接风选择" : "接风管风窗口"}
        </strong>
        <span>
          {playerName(snapshot, game.wind.finisherSeat)} →{" "}
          {playerName(snapshot, game.wind.receiverSeat)}
        </span>
      </div>
    </div>
  );
}

interface ActionDockProps {
  snapshot: RoomSnapshot;
  game: ClientGameView;
  busy: boolean;
  selected: Card[];
  onAction: (action: GameAction) => Promise<void>;
}

function ActionDock({
  snapshot,
  game,
  busy,
  selected,
  onAction
}: ActionDockProps) {
  if (game.phase === "FINISHED") {
    return null;
  }

  if (game.phase === "OPENING") {
    return (
      <section className="action-dock opening-dock">
        <div>
          <span className="eyebrow">开局窗口</span>
          <strong>{openingPrompt(snapshot, game)}</strong>
        </div>
        {game.actions.canBeginOpening ? (
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void onAction({ type: "BEGIN_OPENING" })}
          >
            开始询问
          </button>
        ) : null}
        {game.actions.canRespondOpening ? (
          <div className="button-row">
            {game.actions.selfHasRedAce && game.opening.contactedSeat === null ? (
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void onAction({
                    type: "OPENING_RESPONSE",
                    response: "contact"
                  })
                }
              >
                联系亮A
              </button>
            ) : null}
            {game.opening.counterSeat === null ? (
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={() =>
                  void onAction({
                    type: "OPENING_RESPONSE",
                    response: "counter"
                  })
                }
              >
                反揪 ×2
              </button>
            ) : null}
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() =>
                void onAction({
                  type: "OPENING_RESPONSE",
                  response: "quiet"
                })
              }
            >
              不表态
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  const waitingFor = game.currentSeat === null ? "" : playerName(snapshot, game.currentSeat);

  return (
    <section className="action-dock">
      <div>
        <span className="eyebrow">当前回合</span>
        <strong>
          {game.actions.canPlay
            ? game.actions.canPass
              ? "选牌后出牌，或选择不要"
              : "轮到你行动"
            : `等待 ${waitingFor}`}
        </strong>
        {game.actions.heartTwoRequired ? (
          <small className="requirement-note">首手必须包含 ♥2</small>
        ) : null}
      </div>
      <div className="button-row">
        {game.actions.canRequestWind ? (
          <button
            type="button"
            className="wind-button"
            disabled={busy}
            onClick={() => void onAction({ type: "REQUEST_WIND" })}
          >
            要风
          </button>
        ) : null}
        {game.actions.canPass ? (
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={() => void onAction({ type: "PASS" })}
          >
            不要
          </button>
        ) : null}
        <button
          type="button"
          className="primary-button"
          disabled={busy || !game.actions.canPlay || selected.length === 0}
          onClick={() => void onAction({ type: "PLAY", cards: selected })}
        >
          {busy ? "处理中" : "出牌"}
        </button>
      </div>
    </section>
  );
}

function RoundResult({
  snapshot,
  game,
  busy,
  onNextRound
}: {
  snapshot: RoomSnapshot;
  game: ClientGameView;
  busy: boolean;
  onNextRound: () => Promise<void>;
}) {
  const result = game.result;
  if (!result) {
    return null;
  }

  return (
    <section className="round-result">
      <div className="result-burst">
        <span>{result.outcome === "full" ? "全道" : "半道"}</span>
        <strong>
          {result.teamMode === "1v3" ? `独子第 ${result.soleRank} 名` : "双方结算"}
        </strong>
      </div>
      <div className="score-grid">
        {snapshot.players.map((player) => (
          <div key={player.id} className={player.seat === game.selfSeat ? "is-self" : ""}>
            <span>{player.name}</span>
            <strong>
              {result.scores[player.seat] > 0 ? "+" : ""}
              {result.scores[player.seat]}
            </strong>
            <small>累计 {player.totalScore}</small>
          </div>
        ))}
      </div>
      <div className="result-actions">
        <span>
          走牌顺序：
          {result.finishOrder
            .map((seat) => playerName(snapshot, seat))
            .join(" → ")}
        </span>
        {snapshot.selfIsHost ? (
          <button
            type="button"
            className="primary-button"
            disabled={busy || !snapshot.canStartNextRound}
            onClick={() => void onNextRound()}
          >
            下一局
          </button>
        ) : (
          <span className="waiting-next">等待房主开始下一局</span>
        )}
      </div>
    </section>
  );
}

function openingPrompt(snapshot: RoomSnapshot, game: ClientGameView): string {
  if (game.opening.status === "IDLE") {
    return game.actions.canBeginOpening
      ? "你是 ♥2 持有者，请发起询问"
      : `等待 ${playerName(snapshot, game.startingSeat)} 发起询问`;
  }
  if (game.actions.canRespondOpening) {
    return "轮到你选择联系、反揪或不表态";
  }
  return game.opening.currentSeat === null
    ? "开局窗口即将结束"
    : `等待 ${playerName(snapshot, game.opening.currentSeat)} 响应`;
}

function phaseLabel(game: ClientGameView): string {
  if (game.phase === "OPENING") {
    return "找伙";
  }
  if (game.phase === "WIND_PENDING") {
    return "接风";
  }
  if (game.phase === "FINISHED") {
    return "已结束";
  }
  return "出牌";
}
