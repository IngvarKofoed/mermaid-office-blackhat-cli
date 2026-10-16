/**
 * The Coast Bot's only moving part: putting the browser script on the
 * clipboard.
 *
 * There is nothing to poll — the bot runs in the browser, not here — so start
 * and stop do nothing, and the menu glyph only lights for the moment a copy
 * takes. It is a service anyway because the copy is the one thing on this
 * screen that changes, and state belongs here rather than in the screen.
 */

import { readFile } from "node:fs/promises";
import { copyToClipboard } from "../../clipboard.mjs";

const SCRIPT = new URL("./browser-script.js", import.meta.url);

/** The script, read on every use so an edit to the file needs no restart. */
export function readScript() {
  return readFile(SCRIPT, "utf8");
}

export function createService() {
  const state = {
    copying: false,
    /** When the last copy landed, and how many lines it was. */
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

    /** The `c` key. */
    async copyNow() {
      if (state.copying) return;
      state.copying = true;
      emit();
      try {
        const script = await readScript();
        state.error = await copyToClipboard(script);
        state.copiedAt = state.error ? null : Date.now();
        state.lines = script.trimEnd().split("\n").length;
      } catch (err) {
        state.error = err.message;
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
