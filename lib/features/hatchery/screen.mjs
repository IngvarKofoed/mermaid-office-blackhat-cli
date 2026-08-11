/**
 * The Hatchery screen — the board as lines of text, and the two keys that make
 * something happen.
 *
 * It holds no state of its own. Everything it draws comes from the service's
 * `state` object, which it captures by reference, so a round that finished while
 * you were on the menu is simply already there when you open this.
 */

import { cyan, dim, green, red, yellow } from "../../term/ansi.mjs";
import { fit } from "../../term/screen.mjs";
import { clock, num, relative } from "../../units.mjs";
import {
  partition,
  renderCritter,
  slotLine,
  sumEarned,
  summarize,
} from "./format.mjs";

export function createScreen(service) {
  const { state } = service;

  return {
    title: "Hatchery",

    headerLines(cols) {
      const { user, board } = state.data ?? {};
      const alive = state.data ? partition(board).alive : [];
      // Earnings stay in every fallback — it's the number you leave this open
      // to watch — while the name and slot detail are what get shed on a narrow
      // terminal.
      const earned = user ? `${num(sumEarned(alive))} 🪙` : "";
      const who = user
        ? fit(
            [
              `${user.name} (${user.username}) · ${num(user.coinBalance)} 🪙 · critters earned ${earned} · ${slotLine(board, alive.length)}`,
              `${user.name} · ${num(user.coinBalance)} 🪙 · earned ${earned} · slots ${alive.length}/${board.activeSlots}`,
              `${num(user.coinBalance)} 🪙 · earned ${earned} · ${alive.length}/${board.activeSlots}`,
            ],
            cols - 2,
          )
        : "connecting…";

      const careNote =
        state.lastCare && state.lastCareAt
          ? dim(` · ${state.lastCare} at ${clock(state.lastCareAt)}`)
          : "";

      let status;
      if (state.caring) {
        status = cyan("🧹 doing the chores…");
      } else if (state.refreshing) {
        status = cyan("⟳ refreshing…") + careNote;
      } else if (state.error) {
        status =
          red(`⚠ ${state.error}`) +
          dim(` · retrying in ${relative(state.nextAt - Date.now())}`) +
          (state.updatedAt
            ? dim(` · showing data from ${clock(state.updatedAt)}`)
            : "");
      } else if (state.updatedAt) {
        status =
          dim(
            `updated ${relative(Date.now() - state.updatedAt)} ago` +
              ` · next refresh in ${relative(state.nextAt - Date.now())}`,
          ) + careNote;
      } else {
        status = dim("loading…");
      }

      return [` ${who}`, ` ${status}`];
    },

    bodyLines() {
      if (!state.data) return [dim("  Fetching your Hatchery board…")];
      const { alive, memorials } = partition(state.data.board);
      const out = [];
      if (alive.length === 0) {
        out.push(dim("  No living critters — the Hatchery is quiet."), "");
      }
      for (const critter of alive) {
        out.push(...renderCritter(critter).map((l) => ` ${l}`), "");
      }
      if (memorials.length > 0) {
        out.push(dim("  In memoriam"));
        for (const critter of memorials) {
          out.push(...renderCritter(critter).map((l) => ` ${l}`), "");
        }
      }
      return out;
    },

    footerBits() {
      if (!state.data) return [];
      const { alive } = partition(state.data.board);
      const { needy, ready } = summarize(alive);
      const bits = [
        needy > 0
          ? yellow(`${needy} need${needy === 1 ? "s" : ""} attention`)
          : green("all content"),
      ];
      if (ready > 0) bits.push(cyan(`${ready} ready to hatch`));
      return bits;
    },

    // Shed hint detail before the status does: which keys exist is learnable,
    // whereas a critter needing attention is the reason to be looking.
    keyHints() {
      return [
        "u refresh · c chores · ↑/↓ scroll · g/G top/end · q back",
        "u · c · ↑/↓ · q",
        "",
      ];
    },

    onKey(key) {
      switch (key) {
        case "u":
        case "U":
        case "r":
        case "R":
          service.refreshNow();
          return true;
        case "c":
        case "C":
          service.careNow();
          return true;
        default:
          // Scrolling, going back and quitting are the app's to handle.
          return false;
      }
    },
  };
}
