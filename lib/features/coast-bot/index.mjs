/**
 * The Coast Bot feature descriptor.
 *
 * The odd one out: nothing here talks to the server. The bot is a script for the
 * browser's DevTools console (browser-script.js), and this feature only hands it
 * over — onto the clipboard from the screen, or to stdout for a pipe.
 */

import { createScreen } from "./screen.mjs";
import { createService, readScript } from "./service.mjs";

const HELP = `Coast Bot — the Treasure World egg-fishing script

  blackhat coast-bot [options]

Opens the Coast Bot screen; press c there to copy the script to the clipboard.
Piped, it prints the script instead:

  blackhat coast-bot | pbcopy
  blackhat coast-bot > coast-bot.js

The script runs in the browser, not here. Paste it into the DevTools console on
/treasure-world with your ship at sea near an island (any but the home harbour)
and the fishing kit aboard, then click Start in the 🧭 panel at the bottom left.
It sails round that island's coast in the shallows and stops when the sonar
pings, then flashes the tab title, beeps and raises a desktop notification.

Options
  -1, --once     print the script and exit (the default when not a terminal)
  -h, --help     this help

Keys
  c         copy the script        q / Esc   back to the menu (Ctrl-C quits)`;

export default {
  id: "coast-bot",
  title: "Coast Bot",
  icon: "🧭",
  blurb: "Copy the Treasure World fishing script",
  help: HELP,

  parseFlags(argv) {
    const flags = {
      // The script doesn't change under you, so where the app can't open there
      // is nothing to keep re-printing — the shell's fallback loop would spam it.
      once: process.stdin.isTTY && process.stdout.isTTY ? null : true,
      help: false,
    };
    for (const arg of argv) {
      if (arg === "--once" || arg === "-1") flags.once = true;
      else if (arg === "--help" || arg === "-h") flags.help = true;
      else throw new Error(`Unknown argument: ${arg}`);
    }
    return flags;
  },

  createService,
  createScreen,

  /** The script itself; trimmed, because the caller's console.log adds the newline. */
  async runOnce() {
    return (await readScript()).trimEnd();
  },
};
