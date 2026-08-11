/**
 * The app shell: one screen at a time, a stack to get back out, and a repaint
 * loop that doesn't have to be clever.
 *
 * The split that matters is between *services* and *screens*. A service owns a
 * feature's polling, its writes and its state, and is started here at launch and
 * stopped only on the way out — so the Hatchery is tended whether or not you are
 * looking at it. A screen is a pure renderer over that state; only the frontmost
 * one is ever asked for lines, which is what makes "status appears when you open
 * the item" true without anything having to arrange it.
 *
 * Redraw needs no bookkeeping. draw() runs on every key, every second, and every
 * service event, because Screen.paint() diffs the frame line-by-line and writes
 * nothing when nothing changed. There is no dirty flag and no subscribing and
 * unsubscribing as screens come and go; a redundant paint is free.
 *
 * The frame is always: title bar, the screen's own header lines, a rule, the
 * scrollable body, a rule, the footer. Scrolling, hint shedding and the stack
 * live here so a feature only has to return arrays of lines.
 */

import { createMenu } from "./menu.mjs";
import { dim, displayWidth, inverse } from "./term/ansi.mjs";
import { Screen, fit, parseKeys } from "./term/screen.mjs";
import { clock } from "./units.mjs";

const APP_NAME = "BLACKHAT";

/**
 * Run until the user quits. Resolves once the terminal has been handed back.
 *
 * `flags` is keyed by feature id and holds whatever that feature's parseFlags
 * returned; a feature the user didn't name on the command line gets its own
 * defaults, because its service still runs.
 */
export function runApp({
  registry,
  ctx,
  flags = {},
  initial = null,
  identity = "",
}) {
  const term = new Screen();

  const entries = registry.map((feature) => {
    const service = feature.createService(
      ctx,
      flags[feature.id] ?? feature.parseFlags([]),
    );
    return { feature, service, screen: feature.createScreen(service) };
  });

  const menu = createMenu(entries, {
    open: (entry) => stack.push(entry.screen),
  });
  const stack = [menu];
  const start = entries.find((e) => e.feature.id === initial);
  if (start) stack.push(start.screen);

  /** Scroll offset per screen, so coming back puts you where you left off. */
  const scroll = new Map();
  /** Body geometry from the last paint — what the scroll keys move against. */
  let view = { length: 0, height: 1 };
  let closed = false;

  const top = () => stack[stack.length - 1];
  const scrollOf = (screen) => scroll.get(screen) ?? 0;

  // --- Frame ---------------------------------------------------------------

  function titleBar(cols) {
    const crumb = stack.length > 1 ? ` · ${top().title.toUpperCase()}` : "";
    const left = ` 🧜 ${APP_NAME}${crumb}`;
    const now = `${clock(Date.now())} `;
    const right = fit(
      [`${identity}  ${now}`, now],
      Math.max(0, cols - displayWidth(left)),
    );
    const gap = Math.max(1, cols - displayWidth(left) - displayWidth(right));
    return inverse(left + " ".repeat(gap) + right);
  }

  const rule = (cols) => dim(" " + "─".repeat(Math.max(0, cols - 2)));

  function footerLine(cols, scrollInfo) {
    const bits = [...(top().footerBits?.() ?? [])];
    if (scrollInfo) bits.push(dim(`[${scrollInfo}]`));
    const left = ` ${bits.join(dim(" · "))}`;
    const keys = dim(
      fit(
        top().keyHints?.() ?? [""],
        Math.max(0, cols - displayWidth(left) - 2),
      ),
    );
    const gap = Math.max(
      1,
      cols - displayWidth(left) - displayWidth(keys) - 1,
    );
    return left + " ".repeat(gap) + keys;
  }

  function draw() {
    // Services keep resolving for a moment after the terminal is handed back;
    // painting then would scribble on the user's shell.
    if (closed) return;
    const cols = term.cols;
    const screen = top();

    const header = [titleBar(cols), ...(screen.headerLines?.(cols) ?? [])];
    const body = screen.bodyLines?.(cols) ?? [];
    // Two rules and the footer, plus whatever header the screen contributed —
    // floored at one row so a very short terminal can't go negative.
    const height = Math.max(1, term.rows - header.length - 3);

    // Re-clamp on every paint rather than only on keypress: a refresh can
    // shorten the body (a critter stored away) and strand the view past the end.
    const at = Math.min(scrollOf(screen), Math.max(0, body.length - height));
    scroll.set(screen, at);
    view = { length: body.length, height };

    const window = body.slice(at, at + height);
    while (window.length < height) window.push("");

    const scrollInfo =
      body.length > height ? `${at + 1}–${at + height}/${body.length}` : null;

    term.paint([
      ...header,
      rule(cols),
      ...window,
      rule(cols),
      footerLine(cols, scrollInfo),
    ]);
  }

  // --- Keys ----------------------------------------------------------------

  /** Everything a screen didn't claim: scrolling, going back, quitting. */
  function handleDefault(key, quit) {
    const screen = top();
    const max = Math.max(0, view.length - view.height);
    const at = scrollOf(screen);
    const to = (n) => {
      scroll.set(screen, Math.max(0, Math.min(n, max)));
      return true;
    };

    switch (key) {
      case "q":
      case "Q":
        if (stack.length > 1) return Boolean(stack.pop());
        quit();
        return false;
      case "escape":
      case "left":
      case "h":
        // Back, but never out — quitting stays a deliberate q or Ctrl-C.
        return stack.length > 1 ? Boolean(stack.pop()) : false;
      case "j":
      case "down":
        return to(at + 1);
      case "k":
      case "up":
        return to(at - 1);
      case "pagedown":
      case " ":
        return to(at + view.height);
      case "pageup":
        return to(at - view.height);
      case "g":
      case "home":
        return to(0);
      case "G":
      case "end":
        return to(max);
      default:
        return false;
    }
  }

  // --- Run -----------------------------------------------------------------

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const unsubscribes = [];
    let ticker = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (ticker) clearInterval(ticker);
      for (const off of unsubscribes) off();
      for (const { service } of entries) service.stop();
      stdin.off("data", onData);
      process.off("SIGINT", quit);
      process.off("SIGTERM", quit);
      process.off("exit", cleanup);
      term.out.off("resize", onResize);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      term.close();
    };

    function quit() {
      cleanup();
      resolve();
    }

    function onResize() {
      // Row positions all shift, so nothing on screen can be trusted.
      term.invalidate();
      draw();
    }

    function onData(chunk) {
      for (const key of parseKeys(chunk)) {
        // Raw mode means no SIGINT, so Ctrl-C and Ctrl-D are handled here — and
        // they quit from any depth, unlike q.
        if (key === "\x03" || key === "\x04") return quit();
        if (top().onKey?.(key)) draw();
        else if (handleDefault(key, quit)) draw();
      }
    }

    term.open();
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    process.on("SIGINT", quit);
    process.on("SIGTERM", quit);
    // Safety net: whatever takes the process down — a thrown bug, fail()'s
    // process.exit — the alternate screen and cursor must be handed back, or
    // the user is left staring at an invisible cursor in a dead terminal.
    process.on("exit", cleanup);
    term.out.on("resize", onResize);

    // Every service, not just the visible one: the menu's activity glyphs are
    // driven by the ones in the background, and a paint that changes nothing
    // costs nothing.
    for (const { service } of entries) unsubscribes.push(service.subscribe(draw));

    draw();
    for (const { service } of entries) service.start();

    // Purely for the clocks and countdowns — the services schedule themselves.
    ticker = setInterval(draw, 1000);
  });
}
