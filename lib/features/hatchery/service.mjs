/**
 * The part of the Hatchery that keeps working when nobody is looking at it.
 *
 * It owns the poll timer, the chores, and every scrap of state the screen later
 * renders — so opening the menu item shows you what has been happening, rather
 * than starting a stopwatch. Nothing in here draws anything; it mutates `state`
 * and says so, and whoever is on screen decides whether that's worth a repaint.
 *
 * The timer is a single `setTimeout` aimed at `state.nextAt` rather than a
 * once-a-second "is it time yet?" poll: the countdown on screen is derived from
 * `nextAt` by the renderer, so the service has no reason to wake up in between.
 */

import { careForAll, careHeadline, needsCare } from "./care.mjs";

/** How often the Hatchery refreshes and does the chores. */
export const DEFAULT_INTERVAL_MS = 5 * 60_000;
/** Below this, polling is just hammering the server for no benefit. */
export const MIN_INTERVAL_MS = 5_000;

/** One full snapshot: who you are (for the balance) plus the critter board. */
export async function fetchSnapshot(api) {
  // /api/auth/me both fetches the balance and validates the cached token.
  const { user } = await api.get("/api/auth/me");
  const board = await api.get("/api/critter");
  if (!Array.isArray(board?.critters)) {
    throw new Error(
      "unexpected /api/critter response (no critters array) — is the server up to date?",
    );
  }
  return { user, board };
}

export function createService({ api }, { intervalMs, care } = {}) {
  const every = intervalMs ?? DEFAULT_INTERVAL_MS;
  const careByDefault = care ?? true;

  const listeners = new Set();
  let timer = null;
  let running = false;

  const state = {
    data: null,
    error: null,
    updatedAt: null,
    refreshing: false,
    /** Set while the chores are in flight, so the header can say so. */
    caring: false,
    /** Headline of the most recent round of chores, and when it happened.
     * Kept here rather than on the screen so a round done at 09:14 is still
     * reportable when you open the Hatchery at 11:00. */
    lastCare: null,
    lastCareAt: null,
    /** When the next automatic round is due; the renderer counts down to it. */
    nextAt: Date.now(),
  };

  const emit = () => {
    for (const fn of listeners) fn();
  };

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!running) return;
    state.nextAt = Date.now() + every;
    timer = setTimeout(() => round(), every);
  }

  /** Fetch, optionally do the chores, and (if any were done) fetch again so the
   * board reflects them. `doCare` overrides the mode for the `c` key. */
  async function round({ doCare = careByDefault } = {}) {
    if (state.refreshing) return;
    // Whatever prompted this round replaces the pending one — otherwise a
    // manual refresh leaves the old timer armed and we fetch twice.
    if (timer) clearTimeout(timer);
    timer = null;

    state.refreshing = true;
    emit();
    try {
      let snapshot = await fetchSnapshot(api);
      if (doCare) {
        const pending = snapshot.board.critters.filter(needsCare).length;
        if (pending > 0) {
          state.caring = true;
          emit();
          const results = await careForAll(api, snapshot.board);
          state.lastCare = careHeadline(results);
          state.lastCareAt = Date.now();
          state.caring = false;
          snapshot = await fetchSnapshot(api);
        }
      }
      state.data = snapshot;
      state.error = null;
      state.updatedAt = Date.now();
    } catch (err) {
      // Keep the last good board — a blip shouldn't blank the view, and in the
      // app there is nobody left to catch a throw anyway.
      state.error = err.message;
    } finally {
      state.caring = false;
      state.refreshing = false;
      schedule();
      emit();
    }
  }

  return {
    state,

    start() {
      if (running) return;
      running = true;
      round();
    },

    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },

    /** Pull the next round forward to now (the `u` key). */
    refreshNow() {
      round();
    },

    /** Chores on demand, even when started with --no-care — the one write this
     * tool makes stays a deliberate act. */
    careNow() {
      round({ doCare: true });
    },

    /** What the menu shows without revealing any actual status. */
    activity() {
      if (state.refreshing || state.caring) return "working";
      if (state.error) return "error";
      return "idle";
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
