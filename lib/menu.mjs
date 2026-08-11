/**
 * The main menu — the app's front door, one row per registered feature.
 *
 * A row deliberately carries no status: no counts, no coins, no "3 need
 * attention". That belongs behind the item. The one thing it borrows from the
 * background service is an activity glyph, so a server that has gone away is
 * visible from here instead of failing quietly for an hour.
 */

import { cyan, dim, displayWidth, inverse, red } from "./term/ansi.mjs";

const GLYPH = { working: "⟳", error: "⚠" };

export function createMenu(entries, { open }) {
  let selected = 0;

  /** Widest feature name, so the blurbs line up down the list. */
  const nameWidth = Math.max(
    0,
    ...entries.map((e) => displayWidth(e.feature.title)),
  );

  function row(entry, isSelected, cols) {
    const { icon, title, blurb } = entry.feature;
    const activity = entry.service.activity?.() ?? "idle";
    const glyph = GLYPH[activity] ?? "";

    const pad = " ".repeat(Math.max(0, nameWidth - displayWidth(title)));
    const left = `  ${icon}  ${title}${pad}   `;
    const gap = Math.max(
      1,
      cols - displayWidth(left + blurb) - displayWidth(glyph) - 2,
    );

    // The selected row is built without colours: a dim or red span nested
    // inside an inverse one closes with a reset that ends the inverse too,
    // which leaves half a highlight bar on screen.
    if (isSelected) {
      return inverse(`${left}${blurb}${" ".repeat(gap)}${glyph}  `);
    }
    const paint = activity === "error" ? red : cyan;
    return `${left}${dim(blurb)}${" ".repeat(gap)}${paint(glyph)}  `;
  }

  return {
    title: "Menu",

    headerLines() {
      return [];
    },

    // The list is one row per feature and there are single digits of those, so
    // it never needs scrolling of its own — and if it ever does, the app's
    // scroll keys still reach it.
    bodyLines(cols) {
      return ["", ...entries.map((e, i) => row(e, i === selected, cols))];
    },

    footerBits() {
      const n = entries.length;
      return [dim(`${n} feature${n === 1 ? "" : "s"}`)];
    },

    keyHints() {
      return ["↑/↓ move · ↵ open · q quit", "↑/↓ · ↵ · q", ""];
    },

    onKey(key) {
      switch (key) {
        case "up":
        case "k":
          selected = Math.max(0, selected - 1);
          return true;
        case "down":
        case "j":
          selected = Math.min(entries.length - 1, selected + 1);
          return true;
        case "enter":
        case "right":
        case "l":
          if (entries[selected]) open(entries[selected]);
          return true;
        default:
          return false;
      }
    },
  };
}
