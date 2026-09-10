/**
 * The Still screen — the batch as lines of text, and the keys that act on it.
 *
 * Nearly everything it draws comes from the service's `state`, captured by
 * reference, so a batch started while you were on the menu is simply already
 * there when you open this.
 *
 * THE ONE EXCEPTION, and a deliberate divergence from the other two screens:
 * this one holds a single transient boolean, `confirming`. Bottling is
 * irreversible and it costs the next batch a night, so a stray `b` must not
 * bank a four-unit batch. That is view state and nothing else needs it, which
 * is why it lives here rather than on the service — a second app session must
 * not find a half-armed confirmation waiting for it.
 */

import { cyan, dim, green, red, yellow } from "../../term/ansi.mjs";
import { fit } from "../../term/screen.mjs";
import { clock, relative } from "../../units.mjs";
import { adviceLine, batchLines, stopsPaying } from "./format.mjs";

export function createScreen(service) {
  const { state } = service;

  let confirming = false;

  /** The confirmation is only meaningful while there is something to bottle. */
  const canConfirm = () => Boolean(state.batch) && !state.bottling;

  return {
    title: "The Still",

    headerLines(cols) {
      const where = !state.updatedAt
        ? "connecting…"
        : !state.jailed
          ? "Not in The Brig"
          : fit(
              [
                `cell ${state.cellIndex} · banked ${state.banked ?? 0} 🍶`,
                `cell ${state.cellIndex} · ${state.banked ?? 0} 🍶`,
              ],
              cols - 2,
            );

      const startNote =
        state.lastStart && state.lastStartAt
          ? dim(` · started a batch at ${clock(state.lastStartAt)}`)
          : "";

      let status;
      if (state.bottling) {
        status = cyan("🍶 bottling…");
      } else if (state.starting) {
        status = cyan("⟳ starting a batch…");
      } else if (state.refreshing) {
        status = cyan("⟳ refreshing…") + startNote;
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
              ` · next check in ${relative(state.nextAt - Date.now())}`,
          ) + startNote;
      } else {
        status = dim("loading…");
      }

      return [` ${where}`, ` ${status}`];
    },

    bodyLines() {
      if (!state.updatedAt) return [dim("  Looking under the bunk…")];

      const out = [""];

      if (!state.jailed) {
        out.push(
          dim("  Not in The Brig — nothing fermenting."),
          "",
          dim("  The still is a prisoner's privilege. Get yourself jailed."),
        );
        return out;
      }

      // The receipt for the last bottling, which outlives the round that
      // cleared the batch — otherwise pressing `b` makes the screen go blank
      // and says nothing about where the units went.
      // The receipt outlives the round that cleared the batch — otherwise
      // pressing `b` makes the screen go blank and says nothing about where
      // the units went. It carries its own clock so a receipt still sitting
      // there an hour later is obviously an hour old.
      if (state.lastBottle) {
        const { brew, gone, error } = state.lastBottle;
        const at = state.lastBottleAt ? dim(` at ${clock(state.lastBottleAt)}`) : "";
        if (gone) {
          out.push(
            `  ${yellow("The guard got there first — that batch was already poured out.")}${at}`,
            "",
          );
        } else if (error) {
          out.push(`  ${red(`Bottling failed — ${error}`)}${at}`, "");
        } else if (brew > 0) {
          out.push(`  ${green(`✓ Bottled ${brew} 🍶 into your stash.`)}${at}`, "");
        } else {
          out.push(
            `  ${dim("Cleared the still — there was nothing in it.")}${at}`,
            "",
          );
        }
      }

      if (!state.batch) {
        out.push(
          dim("  The still is empty."),
          "",
          dim("  A bucket, some gruel, a few fruit peels."),
          dim("  Every night a guard walks past."),
        );
        return out;
      }

      out.push(...batchLines(state.batch).map((l) => `  ${l}`));

      const advice = adviceLine(state.batch);
      if (advice) out.push("", `  ${advice}`);

      if (state.lastStart?.forfeited) {
        out.push(
          "",
          dim("  This batch forfeits a night: you had already bottled today."),
        );
      }

      return out;
    },

    footerBits() {
      if (confirming && canConfirm()) {
        const n = state.batch.units;
        return [
          yellow(`bottle ${n} unit${n === 1 ? "" : "s"}? press b again`),
        ];
      }
      if (!state.updatedAt) return [];
      if (!state.jailed) return [dim("not jailed")];
      if (!state.batch) return [yellow("still empty")];
      return [
        stopsPaying(state.batch)
          ? yellow("bottle it")
          : green("worth another night"),
      ];
    },

    // Only the keys that can do something are offered. `s` never appears
    // beside a live batch, where its only possible answer is the conflict the
    // auto-start path goes out of its way to treat as harmless.
    keyHints() {
      const act = !state.jailed ? "" : state.batch ? "b bottle · " : "s start · ";
      return [
        `${act}u refresh · ↑/↓ scroll · g/G top/end · q back`,
        `${act}u · ↑/↓ · q`,
        "",
      ];
    },

    onKey(key) {
      switch (key) {
        case "u":
        case "U":
          confirming = false;
          service.refreshNow();
          return true;

        case "s":
        case "S":
          // A live batch would only ever get `batch_exists` back.
          if (state.jailed && !state.batch && !state.refreshing) {
            confirming = false;
            service.startNow();
          }
          return true;

        case "b":
        case "B":
          if (!canConfirm()) return true;
          if (confirming) {
            confirming = false;
            service.bottleNow();
            return true;
          }
          confirming = true;
          // Re-read before asking, so the number you are agreeing to is not
          // one from a five-minute-old poll. The prompt redraws itself when
          // the round lands.
          service.refreshNow();
          return true;

        default:
          // Any other key cancels — and is then handed on to the shell, so
          // `q` still goes back and the scroll keys still scroll. Swallowing
          // it here would make every stray keypress cost two.
          confirming = false;
          return false;
      }
    },
  };
}
