/**
 * The Coast Bot screen — how to use the browser script, and the key that
 * copies it.
 *
 * Mostly fixed text: the bot runs in the browser, so the only status there is
 * to show here is whether the last copy landed.
 */

import { cyan, dim, green, red } from "../../term/ansi.mjs";
import { clock } from "../../units.mjs";

const HOW = [
  "Sails your ship round an island's coast in the shallows, and stops the",
  "moment the sonar pings — then flashes the tab title, beeps and raises a",
  "desktop notification.",
  "",
  "1. Board your ship with the fishing kit and sail to an island — any but",
  "   the home harbour, where no ping ever rolls.",
  "2. Press c to copy the script.",
  "3. On /treasure-world, open DevTools → Console, paste it, press Enter.",
  "4. Click Start in the 🧭 panel at the bottom left of the page.",
  "",
  "Pressing an arrow key, WASD, E, F or Space yourself pauses it, and Start",
  "hands back. Left alone after a ping, it sails on once the ping fades. It",
  "stops for good once today's egg is kept or the egg crate is full.",
  "",
  "Keep the browser window visible — not minimised, not fully covered — as",
  "the game only moves the ship while the page is drawing.",
];

export function createScreen(service) {
  const { state } = service;

  return {
    title: "Coast Bot",

    headerLines() {
      return [` ${dim("Treasure World egg fishing · a script for the browser console")}`];
    },

    bodyLines() {
      const out = ["", ...HOW.map((line) => (line ? `  ${line}` : "")), ""];
      if (state.copying) {
        out.push(`  ${cyan("⟳ copying…")}`);
      } else if (state.error) {
        out.push(
          `  ${red(`⚠ Not copied — ${state.error}`)}`,
          dim("  It's in a file too: blackhat coast-bot > coast-bot.js"),
        );
      } else if (state.copiedAt) {
        out.push(
          `  ${green(`✓ On the clipboard since ${clock(state.copiedAt)} · ${state.lines} lines`)}`,
        );
      }
      return out;
    },

    footerBits() {
      return state.copiedAt ? [green("copied")] : [];
    },

    keyHints() {
      return ["c copy · ↑/↓ scroll · q back", "c copy · q back", ""];
    },

    onKey(key) {
      if (key !== "c" && key !== "C") return false;
      void service.copyNow();
      return true;
    },
  };
}
