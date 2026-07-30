/** Mermaid Office REST client — login once, cache the JWT, re-login on 401. */

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const TOKEN_DIR = join(homedir(), ".cache", "mermaid-office");

export class Api {
  constructor(baseUrl, email, password) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.email = email;
    this.password = password;
    // One cache file per (server, account) pair; the digest keeps the email
    // out of the filename.
    const key = createHash("sha256")
      .update(`${this.baseUrl}\n${email}`)
      .digest("hex")
      .slice(0, 16);
    this.tokenPath = join(TOKEN_DIR, `token-${key}.json`);
    this.token = this.#readToken();
  }

  #readToken() {
    try {
      const { token } = JSON.parse(readFileSync(this.tokenPath, "utf8"));
      return typeof token === "string" ? token : null;
    } catch {
      return null;
    }
  }

  #writeToken(token) {
    try {
      mkdirSync(dirname(this.tokenPath), { recursive: true, mode: 0o700 });
      writeFileSync(this.tokenPath, JSON.stringify({ token }), { mode: 0o600 });
      chmodSync(this.tokenPath, 0o600); // in case the file already existed
    } catch {
      // A non-writable cache is not fatal — we just log in every run.
    }
  }

  async #request(path, init = {}) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new Error(`cannot reach ${this.baseUrl} (${err.message})`);
    }
    let body = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { res, body };
  }

  async login() {
    const { res, body } = await this.#request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok || typeof body?.token !== "string") {
      throw new Error(
        `login failed (${res.status}${body?.error ? `: ${body.error}` : ""})`,
      );
    }
    this.token = body.token;
    this.#writeToken(body.token);
    return body.user;
  }

  /**
   * Call an authed endpoint, logging in (or re-logging in) as needed. `makeInit`
   * is a factory rather than a value because the retry has to rebuild the
   * headers around the *new* token.
   */
  async #authed(path, makeInit, label) {
    if (!this.token) await this.login();
    let { res, body } = await this.#request(path, makeInit());
    if (res.status === 401 || res.status === 403) {
      // Cached token expired or was signed with an older JWT_SECRET.
      await this.login();
      ({ res, body } = await this.#request(path, makeInit()));
    }
    if (!res.ok) {
      const err = new Error(
        `${label} ${path} failed (${res.status}${body?.error ? `: ${body.error}` : ""})`,
      );
      // The server's machine-readable code (`dead`, `sitting`, …), so callers
      // can react to the reason instead of pattern-matching the message.
      err.code = body?.error ?? null;
      err.status = res.status;
      throw err;
    }
    return body;
  }

  get(path) {
    return this.#authed(
      path,
      () => ({ headers: { authorization: `Bearer ${this.token}` } }),
      "GET",
    );
  }

  post(path, payload) {
    return this.#authed(
      path,
      () => ({
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload ?? {}),
      }),
      "POST",
    );
  }

  /** One full snapshot: who you are (for the balance) plus the critter board. */
  async fetchSnapshot() {
    // /api/auth/me both fetches the balance and validates the cached token.
    const { user } = await this.get("/api/auth/me");
    const board = await this.get("/api/critter");
    if (!Array.isArray(board?.critters)) {
      throw new Error(
        "unexpected /api/critter response (no critters array) — is the server up to date?",
      );
    }
    return { user, board };
  }
}
