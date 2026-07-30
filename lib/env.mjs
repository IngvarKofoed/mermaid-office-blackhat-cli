/** Credentials loading — env vars, or KEY=VALUE lines in a file. */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The folder holding the CLI (this file's parent's parent), not the cwd — so
 * cron and `npm link` resolve the same `.env` an interactive run would. */
const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Credentials-file search order. A `.env` beside the script comes first so the
 * folder is self-contained — move it (with its .env) to another machine and it
 * still works. The homedir file is the fallback for a global install, where
 * there is no sensible "beside the script".
 */
export const ENV_FILE_CANDIDATES = [
  join(ROOT_DIR, ".env"),
  join(homedir(), ".mermaid-office.env"),
];

/** The credentials file we will actually read: an explicit override if given,
 * else the first candidate that exists (else the first, for the error message). */
export function resolveEnvFile(override) {
  if (override) return override;
  return (
    ENV_FILE_CANDIDATES.find((p) => existsSync(p)) ?? ENV_FILE_CANDIDATES[0]
  );
}

/** Parse a dotenv-ish KEY=VALUE file into process.env. Real env wins over it. */
export function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes, so a password with spaces survives.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
