/**
 * Asking the operating system to show a message.
 *
 * A platform wrapper, not an abstraction — it knows nothing about notifications
 * as a domain, only how this OS pops one up. Fire-and-forget and it never
 * throws: a toast that doesn't appear is not worth taking the app down for.
 *
 * SECURITY: the text is untrusted. It carries other players' names and chat
 * previews, so on macOS it is passed to `osascript` as *arguments* to an
 * `on run argv` script rather than interpolated into the script source. A name
 * like `" & (do shell script "…") & "` is then just a string. Do not "simplify"
 * this into a single -e with the text embedded.
 */

import { execFile } from "node:child_process";

/** Set the first time a platform tells us it can't do this, so the UI can say
 * so once instead of every attempt silently doing nothing. */
let unavailable = null;

/** Why OS notifications aren't working, or null while they are. */
export function osNotifyUnavailable() {
  return unavailable;
}

function run(command, args) {
  try {
    execFile(command, args, (err) => {
      if (!err) return;
      unavailable =
        err.code === "ENOENT"
          ? `${command} not found`
          : `${command} failed (${err.message.split("\n")[0]})`;
    });
  } catch (err) {
    unavailable = `${command} could not be run (${err.message})`;
  }
}

/** Show one notification. Silently does nothing on a platform we can't drive. */
export function osNotify({ title, subtitle = "", body }) {
  const text = String(body ?? "").trim();
  if (!text) return;

  if (process.platform === "darwin") {
    // Two variants rather than an empty subtitle, which macOS renders as a
    // blank line in the banner.
    const script = subtitle
      ? "display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)"
      : "display notification (item 1 of argv) with title (item 2 of argv)";
    const args = ["-e", "on run argv", "-e", script, "-e", "end run", "--", text, String(title)];
    if (subtitle) args.push(String(subtitle));
    run("osascript", args);
    return;
  }

  if (process.platform === "linux") {
    // execFile again, so the same "text is data, never script" rule holds.
    run("notify-send", [String(title), subtitle ? `${subtitle}\n${text}` : text]);
    return;
  }

  unavailable ??= `no OS notification support on ${process.platform}`;
}
