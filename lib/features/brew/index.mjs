/**
 * The Still feature descriptor — what the app shell needs to put a row on the
 * menu, start the background work, draw the screen, and run the one-shot path
 * for cron.
 *
 * No `requires()`: this is plain `fetch` and nothing else, so it runs wherever
 * the shell does.
 */

import { renderReport } from "./format.mjs";
import { createScreen } from "./screen.mjs";
import {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  createService,
  fetchRound,
} from "./service.mjs";

/** `5m` / `30s` / `600` → milliseconds. Bare numbers are seconds. */
function parseInterval(spec) {
  const m = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(String(spec).trim());
  if (!m) return null;
  const unit = { s: 1000, m: 60_000, h: 3_600_000 }[m[2] ?? "s"];
  const ms = Math.round(Number(m[1]) * unit);
  return ms > 0 ? ms : null;
}

const HELP = `The Still — keep a batch of Bilge Brew fermenting

  blackhat brew [options]

Opens The Still screen. Its background work — check every 5 minutes, and put a
batch in the still whenever you're in The Brig and it's empty — starts with the
app either way, so sitting on the menu keeps the still going just the same.
Piped or run from cron it does one round and exits instead, which is where the
automatic start earns its keep.

Options
  -1, --once              one round, then exit (the default when not a terminal)
      --loop              keep going even when piped
  -i, --interval <time>   how often to check (default 5m)
      --no-start          only look; never put a batch in the still
      --plain             re-print the report instead of opening the app
      --json              print the raw round as JSON
  -h, --help              this help

Keys
  s         start a batch          b         bottle it (asks first)
  u         refresh now            ↑ / ↓     scroll (also j / k)
  PgUp/PgDn scroll a page          q / Esc   back to the menu (Ctrl-C quits)

IT PUTS A BATCH IN THE STILL BY DEFAULT, so this writes to your account unless
you pass --no-start. It never bottles one for you: deciding when to cash out is
the whole game, and it stays a keypress you confirm.

Starting is the free half of that game — a fresh batch has the lowest DC, and a
batch with nothing in it loses nothing when the guard pours it out. The one
exception: if you bottle and it restarts the same day, the new batch forfeits
its first patrol. On a weekday that costs nothing, because the night was spent
either way; on a weekend it costs one real roll. The screen says so when it
happens.

The nightly patrol itself shows up as a notification, not here — leave
\`blackhat notifications\` running (or just the app) and you'll get the die, the
DC and the outcome as it lands.`;

const MAX_INTERVAL_MS = 6 * 3_600_000;

export default {
  id: "brew",
  title: "The Still",
  icon: "🍶",
  blurb: "Keep a batch of Bilge Brew going",
  help: HELP,

  parseFlags(argv) {
    const flags = {
      json: false,
      /** null = decide from the terminal: keep going in one, run once if piped. */
      once: null,
      intervalMs: DEFAULT_INTERVAL_MS,
      plain: false,
      /** Never forgetting to start one is the point, so it's on. */
      start: true,
      help: false,
    };

    const setIntervalMs = (spec, flag) => {
      if (spec === undefined) return;
      const ms = parseInterval(spec);
      if (ms === null) {
        throw new Error(`${flag} needs an interval like 5m, 30s or 600`);
      }
      if (ms < MIN_INTERVAL_MS) {
        throw new Error(`${flag} must be at least ${MIN_INTERVAL_MS / 1000}s`);
      }
      if (ms > MAX_INTERVAL_MS) {
        throw new Error(
          `${flag} must be at most ${MAX_INTERVAL_MS / 3_600_000}h — the still` +
            ` is checked against team midnight, and a longer gap can miss a night`,
        );
      }
      flags.intervalMs = ms;
    };

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--json") flags.json = true;
      else if (arg === "--once" || arg === "-1") flags.once = true;
      else if (arg === "--loop") flags.once = false;
      else if (arg === "--no-start") flags.start = false;
      // Accepted and ignored: starting is the default, but an existing cron
      // line or a habit shouldn't blow up with "unknown argument".
      else if (arg === "--start") flags.start = true;
      else if (arg === "--plain") flags.plain = true;
      else if (arg === "--help" || arg === "-h") flags.help = true;
      else if (arg === "--interval" || arg === "-i") {
        // The value is optional, so only consume the next token if it looks
        // like one — `--interval --json` must not eat the flag.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          setIntervalMs(argv[++i], arg);
        }
      } else if (arg.startsWith("--interval=")) {
        setIntervalMs(arg.slice("--interval=".length), "--interval");
      } else throw new Error(`Unknown argument: ${arg}`);
    }
    return flags;
  },

  createService,
  createScreen,

  /**
   * One round, rendered for a pipe or a log. Runs the same sequence the
   * service does, auto-start included — but never raises an OS banner: a cron
   * line that toasted every five minutes would be unusable, and the report it
   * prints already says everything a banner would.
   */
  async runOnce({ api }, flags) {
    const round = await fetchRound(api, { start: flags.start });
    if (flags.json) {
      return JSON.stringify(
        { checkedAt: new Date().toISOString(), ...round },
        null,
        2,
      );
    }
    return renderReport(round);
  },
};
