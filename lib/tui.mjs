/**
 * The live dashboard: a full-screen view that refreshes on a timer and takes
 * keystrokes.
 *
 * Flicker-free by construction. The naive loop — clear the screen, print the
 * frame — is what makes terminal dashboards blink, because the terminal can
 * render the blank intermediate state. Here every frame is built as an array of
 * lines, compared line-by-line against the frame already on screen, and only the
 * lines that actually differ are rewritten, all in a single write() so the
 * terminal applies them as one update. A once-a-second countdown therefore
 * repaints exactly one line, and an unchanged screen writes nothing at all.
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
  cyan,
  dim,
  displayWidth,
  green,
  inverse,
  moveTo,
  red,
  truncateToWidth,
  yellow,
} from "./ansi.mjs";
import { careForAll, careHeadline, needsCare } from "./care.mjs";
import {
  clock,
  num,
  partition,
  relative,
  renderCritter,
  slotLine,
  sumEarned,
  summarize,
} from "./format.mjs";

const HEADER_ROWS = 4;
const FOOTER_ROWS = 2;

/** First candidate that fits in `cols`, else the last (paint truncates it).
 * Lets the header and footer shed detail on a narrow terminal instead of
 * being chopped mid-word. */
function fit(candidates, cols) {
  return (
    candidates.find((s) => displayWidth(s) <= cols) ??
    candidates[candidates.length - 1]
  );
}

class Screen {
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
  ["\x1b[H", "home"],
  ["\x1b[F", "end"],
];

/** Split a stdin chunk into key names — a single chunk may carry several. */
function parseKeys(chunk) {
  const s = chunk.toString("utf8");
  const keys = [];
  for (let i = 0; i < s.length;) {
    const seq = KEY_SEQUENCES.find(([bytes]) => s.startsWith(bytes, i));
    if (seq) {
      keys.push(seq[1]);
      i += seq[0].length;
      continue;
    }
    keys.push(s[i]);
    i += 1;
  }
  return keys;
}

/**
 * Run the dashboard until the user quits. Resolves once the terminal has been
 * restored.
 */
export function runDashboard(api, { intervalMs, care = false }) {
  const screen = new Screen();
  const state = {
    data: null,
    error: null,
    updatedAt: null,
    refreshing: false,
    /** Set while the chores are in flight, so the header can say so. */
    caring: false,
    /** Headline of the most recent round of chores, and when it happened. */
    lastCare: null,
    lastCareAt: null,
    scroll: 0,
    /** When the next automatic refresh is due; `u` just pulls this to now. */
    nextAt: Date.now(),
    /** Body lines of the current frame, kept so scrolling can clamp to them. */
    bodyLength: 0,
  };

  const bodyHeight = () => Math.max(1, screen.rows - HEADER_ROWS - FOOTER_ROWS);
  const maxScroll = () => Math.max(0, state.bodyLength - bodyHeight());

  // --- Frame ---------------------------------------------------------------

  function headerLines() {
    const cols = screen.cols;
    const left = " 🧜 MERMAID OFFICE · HATCHERY";
    const right = `${clock(Date.now())} `;
    const gap = Math.max(1, cols - displayWidth(left) - displayWidth(right));
    const title = inverse(left + " ".repeat(gap) + right);

    const { user, board } = state.data ?? {};
    const alive = state.data ? partition(board).alive : [];
    // Earnings stay in every fallback — it's the number you leave this open to
    // watch — while the name and slot detail are what get shed on a narrow term.
    const earned = user ? `${num(sumEarned(alive))} 🪙` : "";
    const who = user
      ? fit(
          [
            `${user.name} (${user.username}) · ${num(user.coinBalance)} 🪙 · critters earned ${earned} · ${slotLine(board, alive.length)}`,
            `${user.name} · ${num(user.coinBalance)} 🪙 · earned ${earned} · slots ${alive.length}/${board.activeSlots}`,
            `${num(user.coinBalance)} 🪙 · earned ${earned} · ${alive.length}/${board.activeSlots}`,
          ],
          cols - 2,
        )
      : "connecting…";

    const careNote =
      state.lastCare && state.lastCareAt
        ? dim(` · ${state.lastCare} at ${clock(state.lastCareAt)}`)
        : "";

    let status;
    if (state.caring) {
      status = cyan("🧹 doing the chores…");
    } else if (state.refreshing) {
      status = cyan("⟳ refreshing…") + careNote;
    } else if (state.error) {
      status =
        red(`⚠ ${state.error}`) +
        dim(` · retrying in ${relative(state.nextAt - Date.now())}`) +
        (state.updatedAt
          ? dim(` · showing data from ${clock(state.updatedAt)}`)
          : "");
    } else if (state.updatedAt) {
      status =
        dim(
          `updated ${relative(Date.now() - state.updatedAt)} ago` +
            ` · next refresh in ${relative(state.nextAt - Date.now())}`,
        ) + careNote;
    } else {
      status = dim("loading…");
    }

    return [
      title,
      ` ${who}`,
      ` ${status}`,
      dim(" " + "─".repeat(Math.max(0, screen.cols - 2))),
    ];
  }

  function bodyLines() {
    if (!state.data) return [dim("  Fetching your Hatchery board…")];
    const { alive, memorials } = partition(state.data.board);
    const out = [];
    if (alive.length === 0) {
      out.push(dim("  No living critters — the Hatchery is quiet."), "");
    }
    for (const critter of alive) {
      out.push(...renderCritter(critter).map((l) => ` ${l}`), "");
    }
    if (memorials.length > 0) {
      out.push(dim("  In memoriam"));
      for (const critter of memorials) {
        out.push(...renderCritter(critter).map((l) => ` ${l}`), "");
      }
    }
    return out;
  }

  function footerLines(scrollInfo) {
    const { alive } = state.data ? partition(state.data.board) : { alive: [] };
    const { needy, ready } = summarize(alive);

    const bits = [];
    if (state.data) {
      bits.push(
        needy > 0
          ? yellow(`${needy} need${needy === 1 ? "s" : ""} attention`)
          : green("all content"),
      );
      if (ready > 0) bits.push(cyan(`${ready} ready to hatch`));
    }
    if (scrollInfo) bits.push(dim(`[${scrollInfo}]`));

    const left = ` ${bits.join(dim(" · "))}`;
    // Shed hint detail before the status does: which keys exist is learnable,
    // whereas a critter needing attention is the reason to be looking.
    const keys = dim(
      fit(
        [
          "u refresh · c chores · ↑/↓ scroll · g/G top/end · q quit",
          "u · c · ↑/↓ · q",
          "",
        ],
        Math.max(0, screen.cols - displayWidth(left) - 2),
      ),
    );
    const gap = Math.max(
      1,
      screen.cols - displayWidth(left) - displayWidth(keys) - 1,
    );
    return [
      dim(" " + "─".repeat(Math.max(0, screen.cols - 2))),
      left + " ".repeat(gap) + keys,
    ];
  }

  function draw() {
    const body = bodyLines();
    state.bodyLength = body.length;
    const height = bodyHeight();
    // Re-clamp here rather than only on keypress: a refresh can shorten the
    // board (a critter stored away) and strand the view past the end.
    state.scroll = Math.min(state.scroll, maxScroll());

    const window = body.slice(state.scroll, state.scroll + height);
    while (window.length < height) window.push("");

    const overflow = body.length > height;
    const scrollInfo = overflow
      ? `${state.scroll + 1}–${state.scroll + height}/${body.length}`
      : null;

    screen.paint([...headerLines(), ...window, ...footerLines(scrollInfo)]);
  }

  // --- Data ----------------------------------------------------------------

  /** Fetch, optionally do the chores, and (if any were done) fetch again so the
   * board on screen reflects them. `doCare` overrides the mode for the `c` key. */
  async function refresh({ doCare = care } = {}) {
    if (state.refreshing) return;
    state.refreshing = true;
    draw();
    try {
      let snapshot = await api.fetchSnapshot();
      if (doCare) {
        const pending = snapshot.board.critters.filter(needsCare).length;
        if (pending > 0) {
          state.caring = true;
          draw();
          const results = await careForAll(api, snapshot.board);
          state.lastCare = careHeadline(results);
          state.lastCareAt = Date.now();
          state.caring = false;
          snapshot = await api.fetchSnapshot();
        }
      }
      state.data = snapshot;
      state.error = null;
      state.updatedAt = Date.now();
    } catch (err) {
      // Keep the last good board on screen — a blip shouldn't blank the view.
      state.error = err.message;
    } finally {
      state.caring = false;
      state.refreshing = false;
      state.nextAt = Date.now() + intervalMs;
      draw();
    }
  }

  // --- Run -----------------------------------------------------------------

  return new Promise((resolve) => {
    const stdin = process.stdin;
    let ticker = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (ticker) clearInterval(ticker);
      stdin.off("data", onData);
      process.off("SIGINT", quit);
      process.off("SIGTERM", quit);
      process.off("exit", cleanup);
      screen.out.off("resize", onResize);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      screen.close();
    };

    function quit() {
      cleanup();
      resolve();
    }

    function onResize() {
      // Row positions all shift, so nothing on screen can be trusted.
      screen.invalidate();
      draw();
    }

    function onData(chunk) {
      for (const key of parseKeys(chunk)) {
        switch (key) {
          case "q":
          case "Q":
          case "\x03": // Ctrl-C: raw mode means no SIGINT, so handle it here
          case "\x04": // Ctrl-D
            return quit();
          case "u":
          case "U":
          case "r":
          case "R":
            state.nextAt = Date.now();
            refresh();
            break;
          case "c":
          case "C":
            // Chores on demand, even when the session wasn't started with
            // --care — the one write this tool makes stays a deliberate act.
            state.nextAt = Date.now();
            refresh({ doCare: true });
            break;
          case "j":
          case "down":
            state.scroll = Math.min(state.scroll + 1, maxScroll());
            break;
          case "k":
          case "up":
            state.scroll = Math.max(state.scroll - 1, 0);
            break;
          case "pagedown":
          case " ":
            state.scroll = Math.min(state.scroll + bodyHeight(), maxScroll());
            break;
          case "pageup":
            state.scroll = Math.max(state.scroll - bodyHeight(), 0);
            break;
          case "g":
          case "home":
            state.scroll = 0;
            break;
          case "G":
          case "end":
            state.scroll = maxScroll();
            break;
          default:
            continue;
        }
        draw();
      }
    }

    screen.open();
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    process.on("SIGINT", quit);
    process.on("SIGTERM", quit);
    // Safety net: whatever takes the process down — a thrown bug, fail()'s
    // process.exit — the alternate screen and cursor must be handed back, or
    // the user is left staring at an invisible cursor in a dead terminal.
    process.on("exit", cleanup);
    screen.out.on("resize", onResize);

    draw();
    refresh();

    // One timer drives both the countdown and the refresh, so `u` only has to
    // move `nextAt` for the schedule to follow.
    ticker = setInterval(() => {
      if (!state.refreshing && Date.now() >= state.nextAt) refresh();
      else draw();
    }, 1000);
  });
}
