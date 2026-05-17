import type { ChatServerEvent } from "../api";

/** Reconnect-with-backoff WebSocket wrapper. Browser WebSocket doesn't
 * reconnect on its own; we restart with exponential backoff + jitter on every
 * close that isn't a user-initiated `stop()`. Heartbeat keeps the connection
 * alive through proxies (Vite, nginx) that close idle sockets. */
const BACKOFF_STEPS_MS = [1000, 2000, 5000, 10000];
const JITTER_MS = 500;
const HEARTBEAT_MS = 25_000;

export interface ChatSocketStatus {
  state: "connecting" | "open" | "closed";
  reconnectAttempts: number;
}

export class ChatSocket {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusCb: ((s: ChatSocketStatus) => void) | null = null;
  private readonly onEvent: (event: ChatServerEvent) => void;

  constructor(onEvent: (event: ChatServerEvent) => void) {
    this.onEvent = onEvent;
  }

  start(): void {
    if (this.ws || this.stopped || this.reconnectTimer) return;
    this.stopped = false;
    // Defer the actual WebSocket creation. In React 19 strict-mode dev
    // builds, effects run mount → cleanup → mount. setTimeout(0) races with
    // React's cleanup scheduling; 30ms is well past the cleanup boundary and
    // still invisible to the user. The deferred connect is cancelled by
    // stop() before it fires, so we don't open-then-immediately-close a
    // socket (which causes the Vite proxy to log `write ECONNABORTED`).
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, 30);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.emitStatus("closed");
  }

  onStatus(cb: (s: ChatSocketStatus) => void): () => void {
    this.statusCb = cb;
    return () => {
      this.statusCb = null;
    };
  }

  /** Send a JSON payload to the server. No-op when disconnected (typing /
   * presence events can be safely dropped — server-side TTL handles cleanup). */
  send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      /* ignore — readyState may have changed mid-send */
    }
  }

  private connect(): void {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/chat/ws`;
    this.emitStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.retry = 0;
      this.emitStatus("open");
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          /* ignore */
        }
      }, HEARTBEAT_MS);
    });

    ws.addEventListener("message", (evt) => {
      try {
        const data =
          typeof evt.data === "string" ? evt.data : String(evt.data);
        const parsed = JSON.parse(data) as ChatServerEvent;
        this.onEvent(parsed);
      } catch {
        // ignore malformed
      }
    });

    ws.addEventListener("close", () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.ws = null;
      this.emitStatus("closed");
      if (!this.stopped) this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close listener also fires; that handles reconnection
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay =
      BACKOFF_STEPS_MS[Math.min(this.retry, BACKOFF_STEPS_MS.length - 1)] +
      Math.floor(Math.random() * JITTER_MS);
    this.retry += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private emitStatus(state: ChatSocketStatus["state"]): void {
    if (this.statusCb)
      this.statusCb({ state, reconnectAttempts: this.retry });
  }
}
