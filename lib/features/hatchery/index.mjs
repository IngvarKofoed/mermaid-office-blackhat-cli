/**
 * The Hatchery feature descriptor — what the app shell needs to know to put a
 * row on the menu, start the background work, draw the screen, and run the
 * one-shot path for cron.
 *
 * Adding another feature means another folder shaped like this one and another
 * line in lib/registry.mjs; nothing in the shell changes.
 */

import { careForAll, careLines } from "./care.mjs";
import { renderReport } from "./format.mjs";
import { createScreen } from "./screen.mjs";
import {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  createService,
  fetchSnapshot,
} from "./service.mjs";

/** `5m` / `30s` / `600` → milliseconds. Bare numbers are seconds. */
function parseInterval(spec) {
  const m = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(String(spec).trim());
  if (!m) return null;
  const unit = { s: 1000, m: 60_000, h: 3_600_000 }[m[2] ?? "s"];
  const ms = Math.round(Number(m[1]) * unit);
  return ms > 0 ? ms : null;
}

const HELP = `Hatchery — tend and watch your critters

  blackhat hatchery [options]

Opens the Hatchery screen. Its background work — refresh every 5 minutes and do
the chores for every critter that needs them — starts with the app either way,
so sitting on the menu tends the critters just the same. Piped or run from cron
it does one round and exits instead.

Options
  -1, --once              one round, then exit (the default when not a terminal)
      --loop              keep going even when piped
  -i, --interval <time>   how often to refresh + tend (default 5m; -w works too)
      --no-care           only look; don't do any chores
      --plain             re-print the report instead of opening the app
      --json              print the raw board as JSON
  -h, --help              this help

Keys
  u         refresh now           c         do the chores now
  ↑ / ↓     scroll (also j / k)   g / G     jump to top / end
  PgUp/PgDn scroll a page         q / Esc   back to the menu (Ctrl-C quits)

It never hatches an egg for you — the 3-tap crack (and its colour reveal) is
yours to do on the site.`;

export default {
  id: "hatchery",
  title: "Hatchery",
  icon: "🥚",
  blurb: "Tend and watch your critters",
  help: HELP,

  /**
   * Parse this feature's own arguments. Throws rather than exiting, so the
   * shell owns the one place a bad argument turns into a message and a status
   * code. Called with `[]` to get the defaults for a feature the user didn't
   * name — which is how a background service is configured when you launch
   * straight into a different screen.
   */
  parseFlags(argv) {
    const flags = {
      json: false,
      /** null = decide from the terminal: keep going in one, run once if piped. */
      once: null,
      intervalMs: DEFAULT_INTERVAL_MS,
      plain: false,
      /** The chores are the point of leaving this running, so they're on. */
      care: true,
      help: false,
    };

    const setInterval_ = (spec, flag) => {
      if (spec === undefined) return;
      const ms = parseInterval(spec);
      if (ms === null) {
        throw new Error(`${flag} needs an interval like 5m, 30s or 600`);
      }
      if (ms < MIN_INTERVAL_MS) {
        throw new Error(`${flag} must be at least ${MIN_INTERVAL_MS / 1000}s`);
      }
      flags.intervalMs = ms;
    };

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--json") flags.json = true;
      else if (arg === "--once" || arg === "-1") flags.once = true;
      else if (arg === "--loop") flags.once = false;
      else if (arg === "--no-care") flags.care = false;
      // Accepted and ignored: chores are the default now, but an existing cron
      // line or a habit shouldn't blow up with "unknown argument".
      else if (arg === "--care" || arg === "-c") flags.care = true;
      else if (arg === "--plain") flags.plain = true;
      else if (arg === "--help" || arg === "-h") flags.help = true;
      else if (
        arg === "--interval" ||
        arg === "-i" ||
        arg === "--watch" ||
        arg === "-w"
      ) {
        // The value is optional, so only consume the next token if it looks
        // like one — `--interval --json` must not eat the flag.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          setInterval_(argv[++i], arg);
        }
      } else if (arg.startsWith("--interval=")) {
        setInterval_(arg.slice("--interval=".length), "--interval");
      } else if (arg.startsWith("--watch=")) {
        setInterval_(arg.slice("--watch=".length), "--watch");
      } else throw new Error(`Unknown argument: ${arg}`);
    }
    return flags;
  },

  createService,
  createScreen,

  /** One round, rendered for a pipe or a log. Returns the text to print. */
  async runOnce({ api }, flags) {
    let snapshot = await fetchSnapshot(api);
    let care = null;
    if (flags.care) {
      care = await careForAll(api, snapshot.board);
      // Re-read so the printed board shows the freshly-tended meters, not the
      // state that prompted the chores.
      if (care.some((r) => r.done.length > 0)) {
        snapshot = await fetchSnapshot(api);
      }
    }

    const { user, board } = snapshot;
    if (flags.json) {
      return JSON.stringify(
        { checkedAt: new Date().toISOString(), user, board, care },
        null,
        2,
      );
    }
    const report = renderReport(user, board);
    return care ? `${careLines(care).join("\n")}\n\n${report}` : report;
  },
};
