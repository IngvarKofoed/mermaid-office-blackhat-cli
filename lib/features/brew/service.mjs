/**
 * The part of The Still that keeps working when nobody is looking at it.
 *
 * It owns the poll timer, the one write that happens without being asked
 * (starting a batch), and every scrap of state the screen later renders — so
 * opening the menu item shows you what has been happening rather than starting
 * a stopwatch. Nothing in here draws anything.
 *
 * Like the Hatchery, the timer is a single `setTimeout` aimed at `state.nextAt`
 * rather than a once-a-second "is it time yet?" poll; the countdown on screen
 * is derived from `nextAt` by the renderer.
 *
 * WHY A ROUND READS THREE ENDPOINTS. `GET /api/prison/brew` answers
 * `{ batch: null }` both for a free player and for a jailed player with an
 * empty still, and those are opposite situations for a tool whose whole job is
 * reminding you. So `/api/prison` goes first, purely for the caller's own
 * `cellIndex` — the only REST signal for "am I serving a sentence", since
 * `/api/auth/me` does not carry it. A free player's round stops right there.
 */

import { osNotify } from "../../notify.mjs";
import { nagText, stopsPaying } from "./format.mjs";

/** How often the still is checked. */
export const DEFAULT_INTERVAL_MS = 5 * 60_000;
/** Below this, polling is just hammering the server for no benefit. */
export const MIN_INTERVAL_MS = 5_000;

const APP_TITLE = "blackhat";
const SUBTITLE = "The Still";

/**
 * Put a batch in the still.
 *
 * Neither error the server can answer with here is a failure. `batch_exists`
 * means the website started one between our read and our write;
 * `not_imprisoned` means the player walked out in that same gap. Both are
 * answered by believing the server and re-reading, never by an error in the
 * header — the alternative is a red glyph on the menu every time you use the
 * site and the CLI at once.
 *
 * A successful start hands back the whole batch view, the same shape the GET
 * returns, so there is nothing to re-read on the happy path.
 */
async function startBatch(api) {
  try {
    const view = await api.post("/api/prison/brew/start");
    const batch = view?.batch ?? null;
    return {
      batch,
      released: false,
      // `isTonight` false on a batch created a moment ago is the restart
      // night: the player had already bottled today, so this batch forfeits
      // its first rolling patrol. Recorded because our own auto-start is what
      // spent it, and a silently late first roll would be worse than saying so.
      started: { forfeited: batch?.tonight?.isTonight === false },
    };
  } catch (err) {
    if (err.code === "not_imprisoned") {
      return { batch: null, released: true, started: null };
    }
    if (err.code === "batch_exists") {
      const view = await api.get("/api/prison/brew");
      return { batch: view?.batch ?? null, released: false, started: null };
    }
    throw err;
  }
}

/**
 * One full round: who and where you are, the still, and what you have banked.
 *
 * Exported so the one-shot printer and the live service run exactly the same
 * sequence — including the auto-start, which is the whole reason a cron line
 * is worth having.
 *
 * All three reads are free of side effects, unlike the Hatchery's board poll.
 */
export async function fetchRound(api, { start = true, onStart } = {}) {
  const prison = await api.get("/api/prison");
  const cellIndex = prison?.cellIndex ?? null;
  if (cellIndex === null) {
    return {
      jailed: false,
      cellIndex: null,
      batch: null,
      banked: null,
      started: null,
    };
  }

  const view = await api.get("/api/prison/brew");
  let batch = view?.batch ?? null;
  let started = null;
  let jailed = true;

  // Only ever attempted after both reads have succeeded. Starting against a
  // stale or errored read is the obvious bug here: its only possible answer
  // is a conflict.
  if (batch === null && start) {
    // Announced at the moment it becomes true rather than guessed at from the
    // previous round's state, so the header can't claim to be starting a batch
    // on a round that turns out to have found one.
    onStart?.();
    const outcome = await startBatch(api);
    batch = outcome.batch;
    started = outcome.started;
    if (outcome.released) jailed = false;
  }

  const banked = jailed
    ? Number((await api.get("/api/prison/contraband"))?.stash?.brew ?? 0)
    : null;

  return { jailed, cellIndex: jailed ? cellIndex : null, batch, banked, started };
}

export function createService({ api }, { intervalMs, start, toast = true } = {}) {
  const every = intervalMs ?? DEFAULT_INTERVAL_MS;
  const startByDefault = start ?? true;

  const listeners = new Set();
  let timer = null;
  let running = false;

  /**
   * The unit count we last raised a banner about, so a poll that found nothing
   * new stays silent. Null means "not currently nagging", which is also the
   * state after a bottling or a pour — so the next time a batch crosses the
   * line it is first sight again.
   *
   * In memory, like everything here bar the cached token: two app sessions on
   * one evening will each nag once. That is the Notifications precedent, not a
   * shortcut — a marker on disk would be the only persistent state this tool
   * keeps about the game, to save a duplicate banner.
   */
  let naggedAtUnits = null;
  /** Same idea for the empty still, which only `--no-start` can reach. */
  let naggedEmpty = false;

  const state = {
    jailed: false,
    cellIndex: null,
    batch: null,
    banked: null,
    error: null,
    updatedAt: null,
    refreshing: false,
    /** Set while the auto-start is in flight, so the header can say so. */
    starting: false,
    bottling: false,
    /** What the last auto-start did, and when — kept here rather than on the
     * screen so a batch started at 09:14 is still reportable at 11:00. */
    lastStart: null,
    lastStartAt: null,
    /** The outcome of the last bottling: banked, already gone, or failed. */
    lastBottle: null,
    lastBottleAt: null,
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

  /**
   * Raise a banner for the states that want a decision from you, and only when
   * one of them has actually changed.
   *
   * The night's *result* is not one of these — that arrives as a `brew_patrol`
   * notification through the Notifications feature, which already holds a
   * socket open and now knows how to render it. On a night that both adds a
   * unit and leaves the batch across the line you get both, which is accepted:
   * they say different things, and this is the one that wants an action.
   */
  function announce() {
    if (!toast) return;

    if (state.jailed && !state.batch) {
      // Only reachable under --no-start; otherwise the round just filled it.
      if (naggedEmpty) return;
      naggedEmpty = true;
      osNotify({
        title: APP_TITLE,
        subtitle: SUBTITLE,
        body: "The still is empty — start a batch.",
      });
      return;
    }
    naggedEmpty = false;

    if (!state.batch || !stopsPaying(state.batch)) {
      naggedAtUnits = null;
      return;
    }
    // First sight of a ripe batch counts as a change, so opening the app to
    // one that crossed the line while you were away nags now rather than
    // waiting for a crossing it already missed.
    if (naggedAtUnits === state.batch.units) return;
    naggedAtUnits = state.batch.units;
    osNotify({
      title: APP_TITLE,
      subtitle: SUBTITLE,
      body: nagText(state.batch),
    });
  }

  /** `doStart` overrides the mode, for the `s` key. */
  async function round({ doStart = startByDefault } = {}) {
    if (state.refreshing) return;
    // Whatever prompted this round replaces the pending one — otherwise a
    // manual refresh leaves the old timer armed and we fetch twice.
    if (timer) clearTimeout(timer);
    timer = null;

    state.refreshing = true;
    state.starting = false;
    emit();
    try {
      const result = await fetchRound(api, {
        start: doStart,
        onStart: () => {
          state.starting = true;
          emit();
        },
      });
      state.jailed = result.jailed;
      state.cellIndex = result.cellIndex;
      state.batch = result.batch;
      state.banked = result.banked;
      if (result.started) {
        state.lastStart = result.started;
        state.lastStartAt = Date.now();
      }
      state.error = null;
      state.updatedAt = Date.now();
      announce();
    } catch (err) {
      // Keep the last good reading — a blip shouldn't blank the view, and in
      // the app there is nobody left to catch a throw anyway.
      state.error = err.message;
    } finally {
      state.starting = false;
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

    /** Pull the next round forward to now (the `u` key, and arming a bottle). */
    refreshNow() {
      round();
    },

    /** Start one by hand, for a `--no-start` session (the `s` key). */
    startNow() {
      round({ doStart: true });
    },

    /**
     * Bottle the batch — the only write this tool will not do for you, because
     * choosing when to cash out is the entire game.
     *
     * `no_batch` is not an error in the ordinary sense. The server's sweep runs
     * every thirty seconds and a failed patrol deletes the row, so a batch can
     * genuinely be poured out between the poll that drew the screen and the
     * keypress that confirms it. Either way the round that follows settles the
     * batch and the banked total at once, rather than leaving the screen a poll
     * interval behind its own action.
     */
    async bottleNow() {
      if (state.bottling) return;
      state.bottling = true;
      state.lastBottle = null;
      emit();
      try {
        const res = await api.post("/api/prison/brew/bottle");
        // `brew` is what came out of THIS batch, not the new stash total; the
        // total arrives on the re-read below.
        state.lastBottle = { brew: Number(res?.brew ?? 0) };
        state.error = null;
      } catch (err) {
        state.lastBottle =
          err.code === "no_batch"
            ? { gone: true }
            : { error: err.message };
      } finally {
        state.lastBottleAt = Date.now();
        state.bottling = false;
        naggedAtUnits = null;
        emit();
        round();
      }
    },

    /** What the menu shows without revealing any actual status. */
    activity() {
      if (state.refreshing || state.starting || state.bottling) return "working";
      if (state.error) return "error";
      return "idle";
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
