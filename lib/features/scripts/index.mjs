/**
 * The Browser Scripts feature descriptor.
 *
 * The odd one out: nothing here talks to the server. Each script is for the
 * browser's DevTools console (the .js files beside this one, listed in
 * catalog.mjs), and this feature only hands them over — onto the clipboard from
 * the screen, or to stdout for a pipe.
 */

import { findScript, SCRIPTS } from "./catalog.mjs";
import { createScreen } from "./screen.mjs";
import { createService, readScript } from "./service.mjs";

const idWidth = Math.max(...SCRIPTS.map((s) => s.id.length));
const LIST = SCRIPTS.map((s) => `  ${s.id.padEnd(idWidth)}   ${s.blurb}`).join("\n");

const HELP = `Browser Scripts — scripts for the browser's DevTools console

  blackhat scripts [script] [options]

Opens the Browser Scripts screen: pick one with ↑/↓, press c to copy it. Name a
script and the screen opens on it. Piped, it prints that script instead:

  blackhat scripts coast-bot | pbcopy
  blackhat scripts lights-out > lights-out.js

Piped with no script named, it prints this list:

${LIST}

The scripts run in the browser, not here. Open DevTools → Console, paste one and
press Enter; the screen says which page each wants and what to do next. Pasting
a script again replaces its earlier copy.

Options
  -1, --once     print and exit (the default when not a terminal)
  -h, --help     this help

Keys
  ↑ / ↓     pick a script         c         copy it
  q / Esc   back to the menu (Ctrl-C quits)`;

export default {
  id: "scripts",
  title: "Browser Scripts",
  icon: "📜",
  blurb: "Copy a script for the browser console",
  help: HELP,

  parseFlags(argv) {
    const flags = {
      script: null,
      // The scripts don't change under you, so where the app can't open there
      // is nothing to keep re-printing — the shell's fallback loop would spam it.
      once: process.stdin.isTTY && process.stdout.isTTY ? null : true,
      help: false,
    };
    for (const arg of argv) {
      if (arg === "--once" || arg === "-1") flags.once = true;
      else if (arg === "--help" || arg === "-h") flags.help = true;
      else if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
      else if (flags.script) throw new Error(`One script at a time (got ${flags.script} and ${arg})`);
      else if (findScript(arg)) flags.script = arg;
      else throw new Error(`Unknown script: ${arg} (try one of: ${SCRIPTS.map((s) => s.id).join(", ")})`);
    }
    return flags;
  },

  createService,
  createScreen,

  /** The named script, trimmed because the caller's console.log adds the newline; or the list. */
  async runOnce(_ctx, flags) {
    if (!flags.script) return LIST;
    return (await readScript(flags.script)).trimEnd();
  },
};
