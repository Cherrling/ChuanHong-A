import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ApiResponse,
  GameAction,
  RoomSession,
  RoomSnapshot
} from "@chuanhong/game-core";
import { GameTable } from "./GameTable";

const SESSION_KEY = "chuanhong-a-session-v1";
const NAME_KEY = "chuanhong-a-name";

type ConnectionStatus = "connecting" | "connected" | "disconnected";
type RoomResult = { session: RoomSession; snapshot: RoomSnapshot };

const socket: Socket = io({
  autoConnect: false,
  transports: ["websocket", "polling"]
});

function loadSession(): RoomSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<RoomSession>;
    if (
      typeof value.roomCode === "string" &&
      typeof value.playerId === "string" &&
      typeof value.reconnectToken === "string"
    ) {
      return value as RoomSession;
    }
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
  return null;
}

function saveSession(session: RoomSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

function request<T>(
  event: string,
  payload?: unknown
): Promise<ApiResponse<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({
        ok: false,
        code: "OFFLINE",
        error: "正在连接服务器，请稍后重试"
      });
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({
          ok: false,
          code: "TIMEOUT",
          error: "服务器响应超时，请重试"
        });
      }
    }, 8_000);

    const callback = (response: ApiResponse<T>): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve(response);
    };

    if (payload === undefined) {
      socket.emit(event, callback);
    } else {
      socket.emit(event, payload, callback);
    }
  });
}

export function App() {
  const [session, setSession] = useState<RoomSession | null>(() => loadSession());
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [roomCode, setRoomCode] = useState(
    () => new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? ""
  );
  const [copied, setCopied] = useState(false);
  const sessionRef = useRef(session);
  const resumeInFlight = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const onConnect = (): void => {
      setConnection("connected");
      const stored = sessionRef.current;
      if (stored && !resumeInFlight.current) {
        resumeInFlight.current = true;
        void request<RoomResult>("room:resume", { session: stored }).then(
          (response) => {
            resumeInFlight.current = false;
            if (response.ok) {
              applyRoomResult(response.data);
              return;
            }
            if (
              response.code === "INVALID_SESSION" ||
              response.code === "ROOM_NOT_FOUND"
            ) {
              clearSession();
              setSession(null);
              setSnapshot(null);
              setMessage("上一局房间已失效。服务器重启后需要重新建房。");
            } else {
              setMessage(response.error);
            }
          }
        );
      }
    };
    const onDisconnect = (): void => {
      setConnection("disconnected");
    };
    const onConnectError = (): void => {
      setConnection("disconnected");
    };
    const onSnapshot = (next: RoomSnapshot): void => {
      setSnapshot(next);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:snapshot", onSnapshot);
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room:snapshot", onSnapshot);
    };
  }, []);

  function applyRoomResult(result: RoomResult): void {
    saveSession(result.session);
    setSession(result.session);
    setSnapshot(result.snapshot);
    setMessage(null);
  }

  async function createRoom(): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setMessage("请先填写昵称");
      return;
    }
    setBusy(true);
    setMessage(null);
    localStorage.setItem(NAME_KEY, trimmedName);
    const response = await request<RoomResult>("room:create", {
      name: trimmedName
    });
    setBusy(false);
    if (response.ok) {
      applyRoomResult(response.data);
    } else {
      setMessage(response.error);
    }
  }

  async function joinRoom(): Promise<void> {
    const trimmedName = name.trim();
    const code = roomCode.trim().toUpperCase();
    if (!trimmedName) {
      setMessage("请先填写昵称");
      return;
    }
    if (code.length !== 5) {
      setMessage("请输入 5 位房间码");
      return;
    }
    setBusy(true);
    setMessage(null);
    localStorage.setItem(NAME_KEY, trimmedName);
    const response = await request<RoomResult>("room:join", {
      code,
      name: trimmedName
    });
    setBusy(false);
    if (response.ok) {
      applyRoomResult(response.data);
    } else {
      setMessage(response.error);
    }
  }

  async function startRoom(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const response = await request<RoomSnapshot>("room:start");
    setBusy(false);
    if (response.ok) {
      setSnapshot(response.data);
    } else {
      setMessage(response.error);
    }
  }

  async function nextRound(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const response = await request<RoomSnapshot>("room:next-round");
    setBusy(false);
    if (response.ok) {
      setSnapshot(response.data);
    } else {
      setMessage(response.error);
    }
  }

  async function gameAction(action: GameAction): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    const response = await request<RoomSnapshot>("game:action", { action });
    setBusy(false);
    if (response.ok) {
      setSnapshot(response.data);
      return true;
    }
    setMessage(response.error);
    return false;
  }

  async function copyShareLink(): Promise<void> {
    if (!snapshot) {
      return;
    }
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("room", snapshot.roomCode);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setMessage(`房间码：${snapshot.roomCode}`);
    }
  }

  if (!session && !snapshot) {
    return (
      <div className="landing-shell">
        <div className="landing-orbit orbit-one" aria-hidden="true" />
        <div className="landing-orbit orbit-two" aria-hidden="true" />
        <header className="landing-header">
          <div className="brand-lockup">
            <span className="brand-mark">串</span>
            <div>
              <strong>串红A</strong>
              <span>四人实时牌局</span>
            </div>
          </div>
          <ConnectionPill status={connection} />
        </header>

        <main className="landing-main">
          <section className="hero-copy">
            <span className="hero-kicker">找伙 · 反揪 · 接风</span>
            <h1>
              一张牌桌，
              <br />
              四种心思。
            </h1>
            <p>
              创建房间或输入好友的房间码。红A决定队友，也要决定何时公开。
            </p>
            <div className="rule-ribbon">
              <span>4 人</span>
              <span>52 张</span>
              <span>零和积分</span>
              <span>无充值</span>
            </div>
          </section>

          <section className="entry-panel">
            <div>
              <span className="eyebrow">进入牌局</span>
              <h2>坐哪一席？</h2>
            </div>
            <label className="field-label">
              <span>昵称</span>
              <input
                value={name}
                maxLength={20}
                placeholder="例如：阿红"
                autoComplete="nickname"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary-button wide-button"
              disabled={busy || connection !== "connected"}
              onClick={() => void createRoom()}
            >
              {busy ? "正在创建" : "创建四席房间"}
            </button>

            <div className="entry-divider">
              <span>或加入已有房间</span>
            </div>

            <div className="join-row">
              <label className="field-label room-field">
                <span>房间码</span>
                <input
                  value={roomCode}
                  maxLength={5}
                  placeholder="ABCDE"
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(event) =>
                    setRoomCode(event.target.value.toUpperCase())
                  }
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || connection !== "connected"}
                onClick={() => void joinRoom()}
              >
                加入
              </button>
            </div>

            {message ? (
              <button
                type="button"
                className="inline-error"
                onClick={() => setMessage(null)}
              >
                {message}
              </button>
            ) : null}
            <p className="entry-footnote">
              房间保存在内存中。服务器重启后，当前房间与积分会清空。
            </p>
          </section>
        </main>

        <footer className="landing-footer">
          以 <a href="/RULES.md">RULES.md</a> 为规则来源。待确认边界见{" "}
          <a href="/OPEN_QUESTIONS.md">OPEN_QUESTIONS.md</a>。状态机审计见{" "}
          <a href="/RULES_AUDIT.md">RULES_AUDIT.md</a>。
        </footer>
      </div>
    );
  }

  if (session && !snapshot) {
    return (
      <div className="loading-shell">
        <div className="brand-mark">串</div>
        <strong>{connection === "connected" ? "正在恢复牌局" : "正在连接服务器"}</strong>
        <span>房间 {session.roomCode}</span>
        {message ? <p>{message}</p> : null}
      </div>
    );
  }

  if (!snapshot) {
    return null;
  }

  if (snapshot.status === "LOBBY" || !snapshot.game) {
    return (
      <Lobby
        snapshot={snapshot}
        busy={busy}
        connection={connection}
        message={message}
        copied={copied}
        onCopy={() => void copyShareLink()}
        onStart={() => void startRoom()}
        onDismiss={() => setMessage(null)}
      />
    );
  }

  return (
    <>
      {connection !== "connected" ? (
        <div className="connection-banner">连接已断开，正在自动重连</div>
      ) : null}
      <GameTable
        snapshot={snapshot}
        busy={busy}
        message={message}
        onDismissMessage={() => setMessage(null)}
        onAction={gameAction}
        onNextRound={nextRound}
      />
    </>
  );
}

function ConnectionPill({ status }: { status: ConnectionStatus }) {
  const label = {
    connecting: "连接中",
    connected: "服务器在线",
    disconnected: "连接断开"
  }[status];
  return (
    <span className={`connection-pill status-${status}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

interface LobbyProps {
  snapshot: RoomSnapshot;
  busy: boolean;
  connection: ConnectionStatus;
  message: string | null;
  copied: boolean;
  onCopy: () => void;
  onStart: () => void;
  onDismiss: () => void;
}

function Lobby({
  snapshot,
  busy,
  connection,
  message,
  copied,
  onCopy,
  onStart,
  onDismiss
}: LobbyProps) {
  const bySeat = new Map(snapshot.players.map((player) => [player.seat, player]));

  return (
    <main className="lobby-shell">
      <header className="lobby-header">
        <div className="brand-lockup compact-brand">
          <span className="brand-mark">串</span>
          <div>
            <strong>串红A</strong>
            <span>等待开局</span>
          </div>
        </div>
        <ConnectionPill status={connection} />
      </header>

      <section className="lobby-main">
        <div className="lobby-title">
          <span className="eyebrow">四席牌桌</span>
          <h1>人齐开局</h1>
          <p>将房间码发给另外三位玩家。所有玩家上线后，房主即可开始。</p>
        </div>

        <button type="button" className="share-card" onClick={onCopy}>
          <span>房间码</span>
          <strong>{snapshot.roomCode}</strong>
          <small>{copied ? "分享链接已复制" : "点击复制分享链接"}</small>
        </button>

        <div className="lobby-seats">
          {[0, 1, 2, 3].map((seatNumber) => {
            const seat = seatNumber as 0 | 1 | 2 | 3;
            const player = bySeat.get(seat);
            return (
              <article
                key={seat}
                className={[
                  "lobby-seat",
                  player ? "is-occupied" : "is-empty",
                  player?.id === snapshot.selfId ? "is-self" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="seat-number">0{seat + 1}</span>
                <div className="seat-avatar">
                  {player ? player.name.slice(0, 1) : "+"}
                </div>
                <strong>{player?.name ?? "等待玩家"}</strong>
                <span>
                  {player
                    ? player.isHost
                      ? "房主"
                      : player.id === snapshot.selfId
                        ? "你"
                        : player.connected
                          ? "已入座"
                          : "已断线"
                    : "空席"}
                </span>
              </article>
            );
          })}
        </div>

        {message ? (
          <button type="button" className="inline-error" onClick={onDismiss}>
            {message}
          </button>
        ) : null}

        <div className="lobby-action">
          <div>
            <strong>{snapshot.players.length}/4 已入座</strong>
            <span>
              {snapshot.canStart
                ? "四人已就位"
                : snapshot.selfIsHost
                  ? "等待其余玩家上线"
                  : "等待房主开始"}
            </span>
          </div>
          {snapshot.selfIsHost ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !snapshot.canStart || connection !== "connected"}
              onClick={onStart}
            >
              洗牌开局
            </button>
          ) : (
            <span className="waiting-next">房主控制开局</span>
          )}
        </div>
        <p className="memory-note centered">
          本版本仅使用内存房间。服务器重启后，此房间会消失。
        </p>
      </section>
    </main>
  );
}
