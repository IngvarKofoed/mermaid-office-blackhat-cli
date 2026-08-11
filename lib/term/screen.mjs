/**
 * The frame buffer and the keyboard — everything about driving a terminal that
 * doesn't care what is being drawn on it.
 *
 * Flicker-free by construction. The naive loop — clear the screen, print the
 * frame — is what makes terminal dashboards blink, because the terminal can
 * render the blank intermediate state. Here every frame is built as an array of
 * lines, compared line-by-line against the frame already on screen, and only the
 * lines that actually differ are rewritten, all in a single write() so the
 * terminal applies them as one update. A once-a-second countdown therefore
 * repaints exactly one line, and an unchanged screen writes nothing at all.
 *
 * That last property is load-bearing for the app above: because a redundant
 * paint costs nothing, nothing has to track *whether* a repaint is needed.
 */

import {
  ALT_SCREEN_OFF,
  ALT_SCREEN_ON,
  CLEAR_LINE,
  CLEAR_SCREEN,
  CURSOR_HIDE,
  CURSOR_SHOW,
  WRAP_OFF,
  WRAP_ON,
  displayWidth,
  moveTo,
  truncateToWidth,
} from "./ansi.mjs";

/** First candidate that fits in `cols`, else the last (paint truncates it).
 * Lets a header or footer shed detail on a narrow terminal instead of being
 * chopped mid-word. */
export function fit(candidates, cols) {
  return (
    candidates.find((s) => displayWidth(s) <= cols) ??
    candidates[candidates.length - 1]
  );
}

export class Screen {
  constructor(out = process.stdout) {
    this.out = out;
    this.prev = [];
  }

  get rows() {
    return this.out.rows || 24;
  }

  get cols() {
    return this.out.columns || 80;
  }

  open() {
    this.out.write(ALT_SCREEN_ON + CLEAR_SCREEN + CURSOR_HIDE + WRAP_OFF);
    this.prev = [];
  }

  close() {
    this.out.write(WRAP_ON + CURSOR_SHOW + ALT_SCREEN_OFF);
  }

  /** Forget what's on screen, so the next paint rewrites every line (resize). */
  invalidate() {
    this.prev = [];
  }

  paint(lines) {
    const { rows, cols } = this;
    const frame = [];
    for (let i = 0; i < rows; i++) {
      frame.push(truncateToWidth(lines[i] ?? "", cols));
    }
    let out = "";
    for (let i = 0; i < rows; i++) {
      if (this.prev[i] === frame[i]) continue;
      out += moveTo(i + 1) + CLEAR_LINE + frame[i];
    }
    if (out) this.out.write(out + moveTo(rows, 1));
    this.prev = frame;
  }
}

/** Escape sequences we care about, longest first so a prefix can't win. */
const KEY_SEQUENCES = [
  ["\x1b[5~", "pageup"],
  ["\x1b[6~", "pagedown"],
  ["\x1b[A", "up"],
  ["\x1b[B", "down"],
  ["\x1b[C", "right"],
  ["\x1b[D", "left"],
  ["\x1b[H", "home"],
  ["\x1b[F", "end"],
  ["\r", "enter"],
  ["\n", "enter"],
];

/** Any CSI sequence, so one we don't handle can be stepped over whole. */
const CSI = /^\x1b\[[0-9;?]*[A-Za-z~]/;

/**
 * Split a stdin chunk into key names — a single chunk may carry several.
 *
 * An escape sequence we don't recognise is swallowed entirely rather than let
 * through character by character: `\x1b[Z` (shift-tab) must not arrive as an
 * Escape followed by a `Z`, which is bound to "jump to end".
 *
 * A lone ESC is only read as the Escape key when it is the whole chunk, since
 * that is the only thing distinguishing it from the start of a sequence. A
 * terminal that splits one across two reads — a laggy link — can still produce a
 * stray Escape; the cost is one unwanted step back out of a screen.
 */
export function parseKeys(chunk) {
  const s = chunk.toString("utf8");
  const keys = [];
  for (let i = 0; i < s.length; ) {
    const seq = KEY_SEQUENCES.find(([bytes]) => s.startsWith(bytes, i));
    if (seq) {
      keys.push(seq[1]);
      i += seq[0].length;
      continue;
    }
    if (s[i] === "\x1b") {
      const unknown = CSI.exec(s.slice(i));
      if (unknown) {
        i += unknown[0].length;
        continue;
      }
      if (s.length === 1) keys.push("escape");
      i += 1;
      continue;
    }
    keys.push(s[i]);
    i += 1;
  }
  return keys;
}
