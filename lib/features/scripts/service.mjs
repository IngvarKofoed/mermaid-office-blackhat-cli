/**
 * The Browser Scripts' only moving parts: which script is picked, and putting
 * it on the clipboard.
 *
 * There is nothing to poll — the scripts run in the browser, not here — so start
 * and stop do nothing, and the menu glyph only lights for the moment a copy
 * takes. It is a service anyway because the pick and the copy are what change
 * on this screen, and state belongs here rather than in the screen.
 */

import { readFile } from "node:fs/promises";
import { copyToClipboard } from "../../clipboard.mjs";
import { SCRIPTS } from "./catalog.mjs";

/** A script's text, read on every use so an edit to the file needs no restart. */
export function readScript(id) {
  return readFile(new URL(`./${id}.js`, import.meta.url), "utf8");
}

export function createService(_ctx, flags) {
  const state = {
    /** Index into SCRIPTS: the one on show, and the one `c` copies. */
    selected: Math.max(0, SCRIPTS.findIndex((s) => s.id === flags.script)),
    copying: false,
    /** Which script the last copy was, when it landed, and how many lines. */
    copiedId: null,
    copiedAt: null,
    lines: 0,
    /** Why the last copy didn't happen, or null. */
    error: null,
  };

  const listeners = new Set();
  const emit = () => {
    for (const fn of listeners) fn();
  };

  return {
    state,

    start() {},
    stop() {},

    /** ↑ / ↓. Stops at the ends, as the menu does. */
    select(step) {
      state.selected = Math.max(0, Math.min(SCRIPTS.length - 1, state.selected + step));
      emit();
    },

    /** The `c` key. */
    async copyNow() {
      if (state.copying) return;
      const { id } = SCRIPTS[state.selected];
      state.copying = true;
      emit();
      try {
        const script = await readScript(id);
        state.error = await copyToClipboard(script);
        state.copiedId = state.error ? null : id;
        state.copiedAt = state.error ? null : Date.now();
        state.lines = script.trimEnd().split("\n").length;
      } catch (err) {
        state.error = err.message;
        state.copiedId = null;
        state.copiedAt = null;
      }
      state.copying = false;
      emit();
    },

    activity() {
      return state.copying ? "working" : "idle";
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
