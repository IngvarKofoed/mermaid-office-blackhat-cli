/**
 * The Notifications screen — the feed as lines of text.
 *
 * Like the Hatchery screen it holds no state of its own: everything comes from
 * the service's `state`, captured by reference, so what arrived while you were
 * elsewhere in the app is simply already listed when you open this.
 */

import {
  bold,
  cyan,
  dim,
  displayWidth,
  green,
  red,
  truncateToWidth,
  yellow,
} from "../../term/ansi.mjs";
import { relative } from "../../units.mjs";
import { createdAtMs, formatNotification } from "./format.mjs";

export function createScreen(service) {
  const { state } = service;

  const unreadLabel = () =>
    state.unreadCount > 0
      ? yellow(`${state.unreadCount} unread`)
      : green("all read");

  return {
    title: "Notifications",

    headerLines() {
      let status;
      if (state.error) status = red(`⚠ ${state.error}`);
      else if (state.connected) status = dim("listening");
      else status = cyan("connecting…");

      const problem = service.toastProblem?.();
      let note = "";
      if (problem === "off") note = dim(" · toasts off");
      else if (problem) note = dim(` · no OS notifications: ${problem}`);

      return [` ${unreadLabel()} · ${status}${note}`];
    },

    bodyLines(cols) {
      if (state.items.length === 0) {
        return [
          dim(
            state.updatedAt
              ? "  Nothing yet — you're all caught up."
              : "  Fetching your notifications…",
          ),
        ];
      }

      const out = [];
      for (const n of state.items) {
        const { icon, title, preview } = formatNotification(n);
        const at = createdAtMs(n.createdAt);
        const age = Number.isFinite(at) ? `${relative(Date.now() - at)} ago` : "";

        // Unread earns the bullet and the weight; read fades into the list.
        const label = `${n.read ? "  " : cyan(" •")} ${icon}  ${
          n.read ? dim(title) : bold(title)
        }`;
        const text = preview ? label + dim(` · ${preview}`) : label;

        // One row each, so the age is cut *into* the text rather than letting a
        // long preview shove it off the edge — the frame painter truncates from
        // the right, which would take the timestamp with it.
        const room = Math.max(8, cols - displayWidth(age) - 2);
        const fitted =
          displayWidth(text) > room
            ? `${truncateToWidth(text, room - 1)}${dim("…")}`
            : text;

        const gap = Math.max(
          1,
          cols - displayWidth(fitted) - displayWidth(age) - 1,
        );
        out.push(`${fitted}${" ".repeat(gap)}${dim(age)} `);
      }
      return out;
    },

    footerBits() {
      return [unreadLabel()];
    },

    keyHints() {
      return [
        "u refresh · a mark all read · ↑/↓ scroll · q back",
        "u · a · ↑/↓ · q",
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
        case "a":
        case "A":
          service.markAllRead();
          return true;
        default:
          return false;
      }
    },
  };
}
