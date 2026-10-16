/**
 * Putting text on the system clipboard.
 *
 * A platform wrapper in the same spirit as notify.mjs: it knows nothing about
 * what is being copied, only how this OS takes it. Unlike a toast, a copy that
 * didn't happen has to be said out loud — the user is about to paste — so it
 * resolves to the reason instead of failing quietly. It never rejects.
 *
 * The text goes in on the tool's stdin, never on its command line.
 */

import { spawn } from "node:child_process";

const TIMEOUT_MS = 5000;

/** The tools to try here, in order; the first one that exists is used. */
function tools() {
  switch (process.platform) {
    case "darwin":
      // pbcopy decodes stdin by the locale, and with none set (cron, a bare
      // env) every emoji in the text arrives as mojibake.
      return [{ command: "pbcopy", args: [], env: { LC_CTYPE: "UTF-8" } }];
    case "linux":
      return [
        { command: "wl-copy", args: [] },
        { command: "xclip", args: ["-selection", "clipboard"] },
        { command: "xsel", args: ["--clipboard", "--input"] },
      ];
    default:
      return [];
  }
}

/** Resolves to null on success, "missing" when the tool isn't installed, or why it failed. */
function pipeTo({ command, args, env = {} }, text) {
  return new Promise((resolve) => {
    let child;
    try {
      // Output ignored, not piped: xclip and wl-copy fork a child that keeps
      // serving the selection, and a pipe it inherited would hold this open.
      child = spawn(command, args, {
        stdio: ["pipe", "ignore", "ignore"],
        env: { ...process.env, ...env },
      });
    } catch (err) {
      resolve(`${command} could not be run (${err.message})`);
      return;
    }
    // A tool that never returns would leave the caller on "copying…" for good.
    const timer = setTimeout(() => {
      child.kill();
      resolve(`${command} didn't finish within ${TIMEOUT_MS / 1000}s`);
    }, TIMEOUT_MS);
    const done = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    child.on("error", (err) =>
      done(err.code === "ENOENT" ? "missing" : `${command} failed (${err.message})`),
    );
    // `exit`, not `close`, for the same forking reason.
    child.on("exit", (code) => done(code === 0 ? null : `${command} exited with ${code}`));
    // A tool that dies early makes this write EPIPE; `exit` reports it.
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  });
}

/** Copy `text`. Resolves to null once it's on the clipboard, or to why it isn't. */
export async function copyToClipboard(text) {
  const candidates = tools();
  if (candidates.length === 0) return `no clipboard support on ${process.platform}`;
  for (const tool of candidates) {
    const result = await pipeTo(tool, text);
    if (result !== "missing") return result;
  }
  const names = candidates.map((t) => t.command);
  return names.length === 1
    ? `${names[0]} is not installed`
    : `none of ${names.join(", ")} is installed`;
}
