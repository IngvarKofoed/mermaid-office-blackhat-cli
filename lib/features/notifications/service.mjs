/**
 * The notification stream: a WebSocket held open from app launch, a feed of what
 * has happened, and the policy for which of those become OS notifications.
 *
 * The rule that matters most: the fetch done at startup is SILENT. It records
 * every id it sees and toasts none of them, because the alternative is that
 * launching on a Monday morning fires fifty banners at once. Every later fetch —
 * a reconnect, the `u` key — toasts whatever it finds unseen, and live arrivals
 * toast as they land.
 *
 * Note the connection is not free of side effects: the server claims your daily
 * login bonus when a socket connects, and again on its 30-second heartbeat. That
 * is the app's second write after the Hatchery chores, and it is not optional
 * while connected.
 */

import { osNotify, osNotifyUnavailable } from "../../notify.mjs";
import { featureOf, formatNotification } from "./format.mjs";

export const DEFAULT_LIMIT = 50;
/** Toast this many individually; the rest of a burst becomes one summary. */
const TOAST_BURST = 3;
/** Live arrivals inside this window are one burst, so a storm can't out-run the
 * cap by arriving as N separate messages. */
const TOAST_WINDOW_MS = 400;
/** Reconnect backoff, in seconds, holding at the last entry. */
const BACKOFF_S = [1, 2, 4, 8, 16, 30];

const APP_TITLE = "blackhat";

export function createService({ api }, { limit = DEFAULT_LIMIT, toast = true } = {}) {
  const listeners = new Set();
  /** Every notification id we have ever displayed, so nothing toasts twice. */
  const seen = new Set();

  let socket = null;
  let running = false;
  let connecting = false;
  let reconnectTimer = null;
  let backoff = 0;
  /** One free re-login per connection attempt, for an expired cached JWT. */
  let reloggedIn = false;
  /** False until the first successful open, so the startup fetch isn't
   * immediately repeated by the reconnect resync. */
  let everOpened = false;
  let pending = [];
  let flushTimer = null;

  const state = {
    items: [],
    unreadCount: 0,
    connected: false,
    error: null,
    updatedAt: null,
  };

  const emit = () => {
    for (const fn of listeners) fn();
  };

  // --- Toasting ------------------------------------------------------------

  function toastBatch(list) {
    if (!toast || list.length === 0) return;
    for (const n of list.slice(0, TOAST_BURST)) {
      const { title } = formatNotification(n);
      osNotify({ title: APP_TITLE, subtitle: featureOf(n.kind), body: title });
    }
    const rest = list.length - TOAST_BURST;
    if (rest > 0) {
      osNotify({
        title: APP_TITLE,
        body: `${rest} more notification${rest === 1 ? "" : "s"}`,
      });
    }
  }

  /** Buffer briefly so several live arrivals coalesce like a fetched batch. */
  function queueToast(n) {
    if (!toast) return;
    pending.push(n);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const batch = pending;
      pending = [];
      toastBatch(batch);
    }, TOAST_WINDOW_MS);
  }

  // --- Feed ----------------------------------------------------------------

  /**
   * Pull the backlog. `silent` is true exactly once, at startup: it seeds `seen`
   * without toasting. Every other call announces what it didn't already know.
   */
  async function fetchFeed({ silent }) {
    const body = await api.get(`/api/notifications?limit=${limit}`);
    const items = Array.isArray(body?.notifications) ? body.notifications : [];

    const fresh = items.filter((n) => !seen.has(n.id));
    for (const n of items) seen.add(n.id);

    state.items = items;
    state.unreadCount = Number(body?.unreadCount ?? 0);
    state.updatedAt = Date.now();
    state.error = null;

    // Oldest first, so a burst's summary covers the ones you'd care least about.
    if (!silent) toastBatch(fresh);
  }

  function onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return; // Not ours to understand; the socket carries every feature's traffic.
    }

    if (msg?.type === "notification.created") {
      const n = msg.payload?.notification;
      if (!n || typeof n.id !== "number" || seen.has(n.id)) return;
      seen.add(n.id);
      state.items = [n, ...state.items].slice(0, limit);
      if (!n.read) state.unreadCount += 1;
      queueToast(n);
      emit();
      return;
    }

    if (msg?.type === "notification.read") {
      const p = msg.payload ?? {};
      if (p.all === true) {
        state.items = state.items.map((n) => ({ ...n, read: true }));
        state.unreadCount = 0;
      } else if (Array.isArray(p.ids)) {
        const ids = new Set(p.ids);
        let cleared = 0;
        state.items = state.items.map((n) => {
          if (!ids.has(n.id) || n.read) return n;
          cleared++;
          return { ...n, read: true };
        });
        state.unreadCount = Math.max(0, state.unreadCount - cleared);
      }
      emit();
    }
  }

  // --- Socket --------------------------------------------------------------

  function socketUrl() {
    return `${api.baseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(api.token ?? "")}`;
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) return;
    const seconds = BACKOFF_S[Math.min(backoff, BACKOFF_S.length - 1)];
    backoff++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, seconds * 1000);
  }

  function connect() {
    if (!running || socket) return;
    connecting = true;
    emit();

    let opened = false;
    let ws;
    try {
      ws = new WebSocket(socketUrl());
    } catch (err) {
      connecting = false;
      state.error = err.message;
      scheduleReconnect();
      emit();
      return;
    }
    socket = ws;

    ws.addEventListener("open", () => {
      opened = true;
      connecting = false;
      backoff = 0;
      reloggedIn = false;
      state.connected = true;
      state.error = null;
      emit();
      // Anything that arrived while we were away is missing from `items`, so
      // every reconnect re-fetches — and unlike the startup fetch, that one
      // announces what it finds. Skipped on the very first open, where the
      // backlog was just read a moment ago.
      if (everOpened) resync({ silent: false });
      everOpened = true;
    });

    ws.addEventListener("message", (ev) => onMessage(ev.data));

    /**
     * The connection is over, however it ended.
     *
     * Both events route here, and the guard makes that safe. It is not
     * belt-and-braces: a *refused* connection fires `error` and no `close` at
     * all, so listening only for `close` — which reads like the obvious
     * choice — strands the service in "connecting…" forever the first time a
     * retry finds the server still down. An established connection that drops
     * fires `close`, sometimes after an `error`, so both orders happen.
     */
    let settled = false;
    const settle = async () => {
      if (settled) return;
      settled = true;
      if (socket === ws) socket = null;
      connecting = false;
      const wasConnected = state.connected;
      state.connected = false;

      // On the way out, none of the recovery below applies — and without this
      // quitting mid-connect would fire a login at a server we're leaving.
      if (!running) {
        emit();
        return;
      }

      // Closed before it ever opened: the likeliest cause by far is the cached
      // JWT having expired, which the server rejects at the upgrade with a bare
      // 401 that the WebSocket API gives us no way to read. So mint a fresh
      // token once and try again immediately; a second failure backs off.
      if (!opened && !reloggedIn) {
        reloggedIn = true;
        try {
          await api.login();
          emit();
          connect();
          return;
        } catch (err) {
          state.error = err.message;
        }
      } else if (!wasConnected && !state.error) {
        state.error = "cannot reach the notification stream";
      }

      scheduleReconnect();
      emit();
    };

    ws.addEventListener("error", settle);
    ws.addEventListener("close", settle);
  }

  async function resync({ silent = false } = {}) {
    try {
      await fetchFeed({ silent });
    } catch (err) {
      state.error = err.message;
    }
    emit();
  }

  return {
    state,

    async start() {
      if (running) return;
      running = true;
      // Held from here to the first open, so the menu reads "working" rather
      // than flashing an error glyph while the backlog is still loading.
      connecting = true;
      emit();
      // Silent: this is the backlog, not news.
      await resync({ silent: true });
      connect();
    },

    stop() {
      running = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearTimeout(flushTimer);
      reconnectTimer = null;
      flushTimer = null;
      pending = [];
      if (socket) {
        const s = socket;
        socket = null;
        try {
          s.close();
        } catch {
          // Already closing; nothing to do.
        }
      }
    },

    /** The `u` key. Announces anything it finds that we hadn't seen. */
    refreshNow() {
      resync({ silent: false });
    },

    /** The `a` key — a write, so it stays an explicit keystroke. The server
     * echoes `notification.read` back over the socket, but update locally too so
     * it lands even while the stream is down. */
    async markAllRead() {
      try {
        await api.post("/api/notifications/read", { all: true });
        state.items = state.items.map((n) => ({ ...n, read: true }));
        state.unreadCount = 0;
        state.error = null;
      } catch (err) {
        state.error = err.message;
      }
      emit();
    },

    /** What the menu glyph shows: whether the stream is up, nothing about what
     * is in it. */
    activity() {
      if (connecting) return "working";
      if (state.error || !state.connected) return "error";
      return "idle";
    },

    /** Null while OS notifications work, else why they don't. */
    toastProblem() {
      if (!toast) return "off";
      return osNotifyUnavailable();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
