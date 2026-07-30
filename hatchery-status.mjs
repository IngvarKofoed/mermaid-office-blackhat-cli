#!/usr/bin/env node
/**
 * Mermaid Office — Hatchery status.
 *
 * Shows the state of every critter on your Hatchery board: phase, mood, both
 * care meters, what it earns, and what it needs from you right now.
 *
 * Run it bare and it does the useful thing: in a terminal, a live dashboard
 * refreshing every 5 minutes and doing the chores each time; piped or in cron,
 * one round and exit (cron is already the scheduler). `--once` / `--loop`
 * override that guess, `--no-care` makes it look-but-don't-touch.
 *
 * STANDALONE: this folder depends on nothing outside itself — no npm packages,
 * no imports from the Mermaid Office repo. Copy it anywhere and it still works;
 * it only needs Node 18+ and a reachable server. See README.md.
 *
 * Credentials — env vars, or KEY=VALUE lines in a `.env` beside this script
 * (falling back to ~/.mermaid-office.env)
 *   MERMAID_URL        base URL, default http://localhost:8601
 *   MERMAID_EMAIL      your login email
 *   MERMAID_PASSWORD   your password
 *   MERMAID_ENV_FILE   override the credentials-file path
 *
 * DOES THE CHORES BY DEFAULT — feed + clean, or warm + mist an egg — for every
 * critter that needs them, so this writes to your account unless you pass
 * --no-care. It never hatches an egg: the 3-tap crack and its colour reveal
 * are the player's to do.
 *
 * Note: even the read side has one server-side effect. GET /api/critter is the
 * same call the Hatchery page makes, and the server derives critter state on
 * read — so a critter that has already died is recorded as dead and its
 * notification fires. It never *causes* a death (the state is derived from
 * timestamps either way), and reading costs no coins.
 */

import { setColorEnabled } from "./lib/ansi.mjs";
import { Api } from "./lib/api.mjs";
import { careForAll, careLines } from "./lib/care.mjs";
import {
  ENV_FILE_CANDIDATES,
  loadEnvFile,
  resolveEnvFile,
} from "./lib/env.mjs";
import { renderReport } from "./lib/format.mjs";
import { runDashboard } from "./lib/tui.mjs";

const DEFAULT_URL = "http://localhost:8601";
/** How often the dashboard refreshes and does the chores. */
const DEFAULT_INTERVAL_MS = 5 * 60_000;
/** Below this, polling is just hammering the server for no benefit. */
const MIN_INTERVAL_MS = 5_000;

function fail(message) {
  console.error(`hatchery-status: ${message}`);
  process.exit(1);
}

/** `5m` / `30s` / `600` → milliseconds. Bare numbers are seconds. */
function parseInterval(spec) {
  const m = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(String(spec).trim());
  if (!m) return null;
  const unit = { s: 1000, m: 60_000, h: 3_600_000 }[m[2] ?? "s"];
  const ms = Math.round(Number(m[1]) * unit);
  return ms > 0 ? ms : null;
}

function parseArgs(argv) {
  const opts = {
    json: false,
    /** null = decide from the terminal: keep going in one, run once if piped. */
    once: null,
    intervalMs: DEFAULT_INTERVAL_MS,
    envFile: null,
    color: null,
    plain: false,
    /** The chores are the point of leaving this running, so they're on. */
    care: true,
    help: false,
  };

  const setInterval_ = (spec, flag) => {
    if (spec === undefined) return;
    const ms = parseInterval(spec);
    if (ms === null) fail(`${flag} needs an interval like 5m, 30s or 600`);
    if (ms < MIN_INTERVAL_MS) {
      fail(`${flag} must be at least ${MIN_INTERVAL_MS / 1000}s`);
    }
    opts.intervalMs = ms;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--once" || arg === "-1") opts.once = true;
    else if (arg === "--loop") opts.once = false;
    else if (arg === "--no-care") opts.care = false;
    // Accepted and ignored: chores are the default now, but an existing cron
    // line or a habit shouldn't blow up with "unknown argument".
    else if (arg === "--care" || arg === "-c") opts.care = true;
    else if (arg === "--plain") opts.plain = true;
    else if (arg === "--no-color") opts.color = false;
    else if (arg === "--color") opts.color = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (
      arg === "--interval" ||
      arg === "-i" ||
      arg === "--watch" ||
      arg === "-w"
    ) {
      // The value is optional, so only consume the next token if it looks like
      // one — `--interval --json` must not eat the flag.
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        setInterval_(argv[++i], arg);
      }
    } else if (arg.startsWith("--interval=")) {
      setInterval_(arg.slice("--interval=".length), "--interval");
    } else if (arg.startsWith("--watch=")) {
      setInterval_(arg.slice("--watch=".length), "--watch");
    } else if (arg === "--env-file") {
      opts.envFile = argv[++i] ?? fail("--env-file needs a path");
    } else if (arg.startsWith("--env-file=")) {
      opts.envFile = arg.slice("--env-file=".length);
    } else fail(`Unknown argument: ${arg}`);
  }
  return opts;
}

const HELP = `Mermaid Office — Hatchery status

  hatchery-status [options]

Run with no arguments in a terminal and it just works: a live dashboard that
refreshes every 5 minutes and does the chores — feed + clean, or warm + mist an
egg — for every critter that needs them. Piped or run from cron, it does one
round and exits instead.

Options
  -1, --once              one round, then exit (the default when not a terminal)
      --loop              keep going even when piped
  -i, --interval <time>   how often to refresh + tend (default 5m; -w works too)
      --no-care           only look; don't do any chores
      --plain             re-print the report instead of drawing the dashboard
      --json              print the raw board as JSON
      --env-file <path>   credentials file to read
      --no-color          plain output (also honours NO_COLOR)
  -h, --help              this help

Dashboard keys
  u        refresh now            c        do the chores now
  ↑ / ↓    scroll (also j / k)    g / G    jump to top / end
  PgUp/PgDn scroll a page         q        quit (Ctrl-C works too)

It never hatches an egg for you — the 3-tap crack (and its colour reveal) is
yours to do on the site.

Credentials come from MERMAID_URL / MERMAID_EMAIL / MERMAID_PASSWORD, either in
the environment or as KEY=VALUE lines in the first file that exists of:
${ENV_FILE_CANDIDATES.map((p) => `  ${p}`).join("\n")}`;

/** Fetch and print once — the one-shot and plain-watch rendering. */
async function printOnce(api, opts) {
  let snapshot = await api.fetchSnapshot();
  let care = null;
  if (opts.care) {
    care = await careForAll(api, snapshot.board);
    // Re-read so the printed board shows the freshly-tended meters, not the
    // state that prompted the chores.
    if (care.some((r) => r.done.length > 0)) {
      snapshot = await api.fetchSnapshot();
    }
  }

  const { user, board } = snapshot;
  if (opts.json) {
    console.log(
      JSON.stringify(
        { checkedAt: new Date().toISOString(), user, board, care },
        null,
        2,
      ),
    );
    return;
  }
  if (care) console.log(careLines(care).join("\n") + "\n");
  console.log(renderReport(user, board));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  // Without this, a missing global `fetch` surfaces inside the request helper as
  // a misleading "cannot reach <url>".
  if (typeof fetch !== "function") {
    fail(
      `Node 18+ is required (this is ${process.version}) — no global fetch.`,
    );
  }

  const envFile = resolveEnvFile(opts.envFile ?? process.env.MERMAID_ENV_FILE);
  loadEnvFile(envFile);

  const isTty = process.stdout.isTTY === true;
  setColorEnabled(opts.color ?? (isTty && !process.env.NO_COLOR));

  const baseUrl = process.env.MERMAID_URL || DEFAULT_URL;
  const email = process.env.MERMAID_EMAIL;
  const password = process.env.MERMAID_PASSWORD;
  if (!email || !password) {
    fail(
      `MERMAID_EMAIL and MERMAID_PASSWORD must be set — in the environment, or ` +
        `as KEY=VALUE lines in ${envFile}. Run with --help for details.`,
    );
  }

  const api = new Api(baseUrl, email, password);

  // Sitting in a terminal means "keep an eye on it"; piped or in cron means
  // "do a round and get out of the way" — cron is already the scheduler.
  const once = opts.once ?? !isTty;
  if (once) {
    await printOnce(api, opts);
    return;
  }

  // The dashboard needs a terminal to draw on and one to read keys from; piped
  // or JSON output falls back to re-printing the report on each tick.
  const dashboard =
    !opts.plain && !opts.json && isTty && process.stdin.isTTY === true;
  if (dashboard) {
    await runDashboard(api, { intervalMs: opts.intervalMs, care: opts.care });
    return;
  }

  // Plain loop: a transient failure (server restarting, laptop asleep) must
  // not kill a long-running session — log it and try again next tick.
  for (;;) {
    try {
      await printOnce(api, opts);
    } catch (err) {
      console.error(`hatchery-status: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
}

main().catch((err) => fail(err.message));
