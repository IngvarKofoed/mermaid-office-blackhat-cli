/**
 * The Notifications feature descriptor.
 *
 * The one thing here that isn't in the Hatchery's shape is `requires()`: this
 * feature's service needs a global WebSocket, which only exists from Node 22.
 * It's declared rather than checked inline so the shell stays free of feature
 * knowledge — and the shell only enforces it where services actually start, so
 * `--once` in cron still runs on an older Node.
 */

import { dim } from "../../term/ansi.mjs";
import { relative } from "../../units.mjs";
import { DEFAULT_LIMIT, createService } from "./service.mjs";
import { createdAtMs, formatNotification } from "./format.mjs";
import { createScreen } from "./screen.mjs";

const MAX_LIMIT = 200;
/** Only used by the --plain --loop path; the live screen is push-driven. */
const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 5_000;

/** `5m` / `30s` / `600` → milliseconds. Bare numbers are seconds. */
function parseInterval(spec) {
  const m = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(String(spec).trim());
  if (!m) return null;
  const unit = { s: 1000, m: 60_000, h: 3_600_000 }[m[2] ?? "s"];
  const ms = Math.round(Number(m[1]) * unit);
  return ms > 0 ? ms : null;
}

const HELP = `Notifications — what's been happening

  blackhat notifications [options]

Opens the Notifications screen. The stream itself starts with the app either
way: a WebSocket is held open from launch, and anything that arrives while
you're on another screen still raises an OS notification. Piped or run from
cron it prints the recent list and exits instead.

Options
      --limit <n>         how many to fetch (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})
      --no-toast          list them, but don't raise OS notifications
  -1, --once              print the list, then exit (the default when not a terminal)
      --loop              keep going even when piped
  -i, --interval <time>   re-print cadence for --plain --loop (default 60s)
      --plain             re-print the list instead of opening the app
      --json              print the raw notifications as JSON
  -h, --help              this help

Keys
  u         refresh now           a         mark all read
  ↑ / ↓     scroll (also j / k)   g / G     jump to top / end
  PgUp/PgDn scroll a page         q / Esc   back to the menu (Ctrl-C quits)

The backlog you already had when the app started never raises OS
notifications — only what arrives afterwards does.

HOLDING THE STREAM OPEN CLAIMS YOUR DAILY LOGIN BONUS. The server does that
whenever a socket connects, and again on its 30-second heartbeat. It's the same
thing opening the website does, but it means running this writes to your
account even with the Hatchery's --no-care.`;

export default {
  id: "notifications",
  title: "Notifications",
  icon: "🔔",
  blurb: "What's been happening",
  help: HELP,

  /** The stream needs a global WebSocket, which arrived in Node 22. */
  requires() {
    return typeof WebSocket === "function"
      ? null
      : `notifications needs Node 22+ (this is ${process.version}) — no global WebSocket. ` +
          `Use a one-shot command (e.g. blackhat hatchery --once), or upgrade Node.`;
  },

  parseFlags(argv) {
    const flags = {
      json: false,
      once: null,
      plain: false,
      help: false,
      limit: DEFAULT_LIMIT,
      toast: true,
      intervalMs: DEFAULT_INTERVAL_MS,
    };

    const setLimit = (spec) => {
      const n = Number(spec);
      if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
        throw new Error(`--limit needs a whole number from 1 to ${MAX_LIMIT}`);
      }
      flags.limit = n;
    };

    const setIntervalMs = (spec, flag) => {
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
      else if (arg === "--plain") flags.plain = true;
      else if (arg === "--no-toast") flags.toast = false;
      else if (arg === "--help" || arg === "-h") flags.help = true;
      else if (arg === "--limit") setLimit(argv[++i]);
      else if (arg.startsWith("--limit=")) setLimit(arg.slice("--limit=".length));
      else if (arg === "--interval" || arg === "-i") {
        setIntervalMs(argv[++i], arg);
      } else if (arg.startsWith("--interval=")) {
        setIntervalMs(arg.slice("--interval=".length), "--interval");
      } else throw new Error(`Unknown argument: ${arg}`);
    }
    return flags;
  },

  createService,
  createScreen,

  /** One read, rendered for a pipe or a log. Never opens a socket — which is
   * why this path works on a Node too old for the app. */
  async runOnce({ api }, flags) {
    const body = await api.get(`/api/notifications?limit=${flags.limit}`);
    const items = Array.isArray(body?.notifications) ? body.notifications : [];

    if (flags.json) {
      return JSON.stringify(
        { checkedAt: new Date().toISOString(), ...body },
        null,
        2,
      );
    }

    const unread = Number(body?.unreadCount ?? 0);
    const out = [
      `🔔 Notifications ${dim(`— ${new Date().toLocaleString()}`)}`,
      dim(`${unread} unread · showing ${items.length}`),
      "",
    ];
    if (items.length === 0) out.push(dim("Nothing yet."));
    // One line each, matching the screen. Nothing is truncated here: a pipe or a
    // log file has no width to fit, and cutting a line would lose information
    // the reader can't get back.
    for (const n of items) {
      const { icon, title, preview } = formatNotification(n);
      const at = createdAtMs(n.createdAt);
      const age = Number.isFinite(at) ? `${relative(Date.now() - at)} ago` : "";
      out.push(
        `${n.read ? " " : "•"} ${icon}  ${title}` +
          (preview ? dim(` · ${preview}`) : "") +
          ` ${dim(`(${age})`)}`,
      );
    }
    return out.join("\n");
  },
};
