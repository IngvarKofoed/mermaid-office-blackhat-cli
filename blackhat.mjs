#!/usr/bin/env node
/**
 * Blackhat — Mermaid Office from the terminal.
 *
 * Run it bare in a terminal and you get the main menu. Every feature's
 * background work starts with the app and keeps running whatever screen you're
 * on, so the Hatchery is tended while you sit on the menu; its status is only
 * drawn once you open it.
 *
 * Name a feature and you get the same app with that screen in front, plus that
 * feature's own options: `blackhat hatchery --interval 30s`. Piped or in cron,
 * naming a feature runs one round and exits (cron is already the scheduler).
 *
 * STANDALONE: this folder depends on nothing outside itself — no npm packages,
 * no imports from the Mermaid Office repo. Copy it anywhere and it still works;
 * it only needs Node 18+ and a reachable server. See README.md.
 *
 * Credentials — env vars, or KEY=VALUE lines in a `.env` beside this script
 * (falling back to ~/.blackhat.env)
 *   MERMAID_URL        base URL, default http://localhost:8601
 *   MERMAID_EMAIL      your login email
 *   MERMAID_PASSWORD   your password
 *   BLACKHAT_ENV_FILE  override the credentials-file path
 *
 * THE HATCHERY DOES THE CHORES BY DEFAULT — feed + clean, or warm + mist an egg
 * — for every critter that needs them, so this writes to your account unless you
 * pass `hatchery --no-care`. It never hatches an egg: the 3-tap crack and its
 * colour reveal are the player's to do.
 *
 * Note: even the read side has one server-side effect. GET /api/critter is the
 * same call the Hatchery page makes, and the server derives critter state on
 * read — so a critter that has already died is recorded as dead and its
 * notification fires. It never *causes* a death (the state is derived from
 * timestamps either way), and reading costs no coins.
 */

import { Api } from "./lib/api.mjs";
import { runApp } from "./lib/app.mjs";
import {
  ENV_FILE_CANDIDATES,
  loadEnvFile,
  resolveEnvFile,
} from "./lib/env.mjs";
import { REGISTRY } from "./lib/registry.mjs";
import { setColorEnabled } from "./lib/term/ansi.mjs";

const DEFAULT_URL = "http://localhost:8601";

function fail(message) {
  console.error(`blackhat: ${message}`);
  process.exit(1);
}

/**
 * Split the command line into app options, a command, and the rest.
 *
 * The rule is that a feature's options come after its name — so no global flag
 * namespace has to be kept de-conflicted as features are added, and the shell
 * never has to know that `--no-care` exists.
 */
function splitArgv(argv) {
  const app = { color: null, envFile: null, help: false };
  let command = null;
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (command !== null) {
      rest.push(arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") app.help = true;
    else if (arg === "--no-color") app.color = false;
    else if (arg === "--color") app.color = true;
    else if (arg === "--env-file") {
      app.envFile = argv[++i] ?? fail("--env-file needs a path");
    } else if (arg.startsWith("--env-file=")) {
      app.envFile = arg.slice("--env-file=".length);
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg} (a feature's options go after its name)`);
    } else command = arg;
  }
  return { app, command, rest };
}

function appHelp() {
  const width = Math.max(...REGISTRY.map((f) => f.id.length));
  const commands = REGISTRY.map(
    (f) => `  ${f.id.padEnd(width)}   ${f.blurb}`,
  ).join("\n");

  return `Blackhat — Mermaid Office from the terminal

  blackhat [options] [command [command options]]

Run it bare in a terminal and you get the main menu. Every feature's background
work starts with the app and keeps running whatever screen you're on — the
Hatchery is tended while you sit on the menu — and a feature's status is drawn
only once you open it.

Commands
${commands}

Naming a command opens the app on that screen, and takes that command's own
options (see \`blackhat <command> --help\`). Piped or run from cron it does one
round and exits instead.

Options
      --env-file <path>   credentials file to read
      --no-color          plain output (also honours NO_COLOR)
  -h, --help              this help

Menu keys
  ↑ / ↓    move (also j / k)      ↵        open
  q        quit                   Ctrl-C   quit from anywhere

Inside a feature, q or Esc goes back to the menu.

Credentials come from MERMAID_URL / MERMAID_EMAIL / MERMAID_PASSWORD, either in
the environment or as KEY=VALUE lines in the first file that exists of:
${ENV_FILE_CANDIDATES.map((p) => `  ${p}`).join("\n")}`;
}

async function main() {
  const { app, command, rest } = splitArgv(process.argv.slice(2));
  if (app.help && command === null) {
    console.log(appHelp());
    return;
  }
  // Without this, a missing global `fetch` surfaces inside the request helper as
  // a misleading "cannot reach <url>".
  if (typeof fetch !== "function") {
    fail(
      `Node 18+ is required (this is ${process.version}) — no global fetch.`,
    );
  }

  const feature = command === null ? null : REGISTRY.find((f) => f.id === command);
  if (command !== null && !feature) {
    fail(
      `Unknown command: ${command} (try one of: ${REGISTRY.map((f) => f.id).join(", ")})`,
    );
  }

  // Parsed before credentials are checked, so `--help` works without them.
  let flags = null;
  if (feature) {
    try {
      flags = feature.parseFlags(rest);
    } catch (err) {
      fail(err.message);
    }
    if (flags.help) {
      console.log(feature.help);
      return;
    }
  }

  const isTty = process.stdout.isTTY === true;
  const interactive = isTty && process.stdin.isTTY === true;

  // Checked before the credentials are: there is no sensible headless reading
  // of "the main menu", so this invocation is wrong whatever else is set up.
  if (!feature && !interactive) {
    fail(`name a command (try: blackhat ${REGISTRY[0].id})`);
  }

  const envFile = resolveEnvFile(app.envFile ?? process.env.BLACKHAT_ENV_FILE);
  loadEnvFile(envFile);
  // After the env file, so NO_COLOR can live in it too.
  setColorEnabled(app.color ?? (isTty && !process.env.NO_COLOR));

  const baseUrl = process.env.MERMAID_URL || DEFAULT_URL;
  const email = process.env.MERMAID_EMAIL;
  const password = process.env.MERMAID_PASSWORD;
  if (!email || !password) {
    fail(
      `MERMAID_EMAIL and MERMAID_PASSWORD must be set — in the environment, or ` +
        `as KEY=VALUE lines in ${envFile}. Run with --help for details.`,
    );
  }

  const ctx = { api: new Api(baseUrl, email, password) };

  if (feature) {
    // Sitting in a terminal means "keep an eye on it"; piped or in cron means
    // "do a round and get out of the way" — cron is already the scheduler.
    if (flags.once ?? !isTty) {
      console.log(await feature.runOnce(ctx, flags));
      return;
    }
    // The app needs a terminal to draw on and one to read keys from; --plain,
    // --json or a pipe fall back to re-printing the report on each tick.
    if (flags.plain || flags.json || !interactive) {
      for (;;) {
        // A transient failure (server restarting, laptop asleep) must not kill
        // a long-running session — log it and try again next tick.
        try {
          console.log(await feature.runOnce(ctx, flags));
        } catch (err) {
          console.error(`blackhat: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, flags.intervalMs));
      }
    }
  }

  await runApp({
    registry: REGISTRY,
    ctx,
    flags: feature ? { [feature.id]: flags } : {},
    initial: feature?.id ?? null,
    identity: email,
  });
}

main().catch((err) => fail(err.message));
