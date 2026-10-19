/**
 * The Browser Scripts screen — the list to pick from, how to use the one
 * picked, and the key that copies it.
 *
 * Mostly fixed text: the scripts run in the browser, so the only status there
 * is to show here is whether the last copy landed.
 */

import { cyan, dim, displayWidth, green, inverse, red } from "../../term/ansi.mjs";
import { clock } from "../../units.mjs";
import { SCRIPTS } from "./catalog.mjs";

export function createScreen(service) {
  const { state } = service;

  /** Widest script name, so the blurbs line up down the list. */
  const nameWidth = Math.max(...SCRIPTS.map((s) => displayWidth(s.title)));

  function row(script, isSelected) {
    const pad = " ".repeat(nameWidth - displayWidth(script.title));
    const left = `  ${script.icon}  ${script.title}${pad}   `;
    // Plain inside the highlight: a dim span would end the inverse with it.
    return isSelected ? `  ${inverse(`${left}${script.blurb}  `)}` : `  ${left}${dim(script.blurb)}`;
  }

  return {
    title: "Browser Scripts",

    headerLines() {
      return [` ${dim("Scripts for the browser's DevTools console · they run there, not here")}`];
    },

    bodyLines() {
      const script = SCRIPTS[state.selected];
      const out = [
        "",
        ...SCRIPTS.map((s, i) => row(s, i === state.selected)),
        "",
        ...script.how.map((line) => (line ? `  ${line}` : "")),
        "",
      ];
      if (state.copying) {
        out.push(`  ${cyan("⟳ copying…")}`);
      } else if (state.error) {
        out.push(
          `  ${red(`⚠ Not copied — ${state.error}`)}`,
          dim(`  It's in a file too: blackhat scripts ${script.id} > ${script.id}.js`),
        );
      } else if (state.copiedId === script.id) {
        out.push(
          `  ${green(`✓ On the clipboard since ${clock(state.copiedAt)} · ${state.lines} lines`)}`,
        );
      }
      return out;
    },

    footerBits() {
      const copied = SCRIPTS.find((s) => s.id === state.copiedId);
      return copied ? [green(`${copied.title} copied`)] : [];
    },

    keyHints() {
      return ["↑/↓ pick · c copy · q back", "↑/↓ · c · q", ""];
    },

    onKey(key) {
      switch (key) {
        case "up":
        case "k":
          service.select(-1);
          return true;
        case "down":
        case "j":
          service.select(1);
          return true;
        case "c":
        case "C":
          void service.copyNow();
          return true;
        default:
          // Paging, going back and quitting are the app's to handle.
          return false;
      }
    },
  };
}
