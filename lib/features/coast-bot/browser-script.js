/*
 * Treasure World coast bot: sails along an island's coast in the shallows and
 * stops when the egg-fishing sonar pings, then flashes the tab title, beeps and
 * shows a desktop notification.
 *
 * Use: board your ship with the fishing kit, sail out near an island (any but the
 * home harbour), paste this into the DevTools console, click Start in the panel at
 * the bottom left. `blackhat coast-bot` puts it on the clipboard for you.
 *
 * - It steers by sending the same arrow-key events the keyboard does, reads the
 *   ship's position from the game's own presence messages, and reads pings from
 *   the game's own sonar polls (it never polls the sonar itself).
 * - Pressing an arrow key, WASD, E, F or Space yourself pauses it ("you took
 *   over"). Click Start to hand back.
 * - After a ping it waits. If you don't touch the keys and the ping fades, it
 *   carries on round the coast.
 * - Keep the window visible (not minimised, not fully covered by other windows):
 *   the game only moves the ship while the page is rendering.
 * - Pasting it again replaces the previous copy; × in the panel removes it.
 */
(() => {
  "use strict";

  const OPTS = {
    // Tile-centre distance from land to hold. ≤ 2 is always shallow water here.
    clearance: 1.7,
    // Which side the land is on: "right" goes clockwise round an island on screen.
    landOn: "right",
    // How hard to pull back onto the contour when off it.
    gain: 1.5,
    tickMs: 100,
    resumeAfterFade: true,
  };

  //#region core — pure steering, no DOM, so it also runs under Node for testing

  /** Unit steps for the 8 key directions, index 0 = east, clockwise on screen. */
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  const isSea = (cfg, k) => k === cfg.terrain.deep || k === cfg.terrain.shallow;

  /** Each tile's landmass (8-connected land), or -1 on water. One per island. */
  function landMasses(cfg, map) {
    const W = cfg.worldW, H = cfg.worldH;
    const labels = new Int32Array(W * H).fill(-1);
    let n = 0;
    for (let s = 0; s < W * H; s++) {
      if (isSea(cfg, map[s]) || labels[s] >= 0) continue;
      labels[s] = n;
      const stack = [s];
      while (stack.length) {
        const i = stack.pop();
        const x = i % W, y = (i - x) / W;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (labels[j] < 0 && !isSea(cfg, map[j])) {
              labels[j] = n;
              stack.push(j);
            }
          }
        }
      }
      n++;
    }
    return labels;
  }

  /** The landmass nearest a point in tile units, or -1 when none is within 40 tiles. */
  function nearestLandMass(cfg, labels, px, py) {
    const W = cfg.worldW, H = cfg.worldH;
    const cx = Math.floor(px), cy = Math.floor(py);
    let best = -1, bestD = Infinity;
    for (let y = Math.max(0, cy - 40); y <= Math.min(H - 1, cy + 40); y++) {
      for (let x = Math.max(0, cx - 40); x <= Math.min(W - 1, cx + 40); x++) {
        const id = labels[y * W + x];
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        if (id >= 0 && d < bestD) {
          best = id;
          bestD = d;
        }
      }
    }
    return best;
  }

  /**
   * Signed distance from ONE landmass's coast, in tiles, per tile: positive off
   * it, negative on it. Every other island counts as open water, so the contour
   * can never wander off onto a neighbour's coast.
   */
  function buildField(cfg, map, labels, id) {
    const W = cfg.worldW, H = cfg.worldH, N = W * H, D = Math.SQRT2;
    const chamfer = (isSource) => {
      const f = new Float32Array(N);
      for (let i = 0; i < N; i++) f[i] = isSource(i) ? 0 : 1e9;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          let v = f[i];
          if (x > 0) v = Math.min(v, f[i - 1] + 1);
          if (y > 0) {
            v = Math.min(v, f[i - W] + 1);
            if (x > 0) v = Math.min(v, f[i - W - 1] + D);
            if (x < W - 1) v = Math.min(v, f[i - W + 1] + D);
          }
          f[i] = v;
        }
      }
      for (let y = H - 1; y >= 0; y--) {
        for (let x = W - 1; x >= 0; x--) {
          const i = y * W + x;
          let v = f[i];
          if (x < W - 1) v = Math.min(v, f[i + 1] + 1);
          if (y < H - 1) {
            v = Math.min(v, f[i + W] + 1);
            if (x < W - 1) v = Math.min(v, f[i + W + 1] + D);
            if (x > 0) v = Math.min(v, f[i + W - 1] + D);
          }
          f[i] = v;
        }
      }
      return f;
    };
    const toLand = chamfer((i) => labels[i] === id);
    const toSea = chamfer((i) => labels[i] !== id);
    const field = new Float32Array(N);
    for (let i = 0; i < N; i++) field[i] = labels[i] === id ? -toSea[i] : toLand[i];
    return { W, H, field };
  }

  /** The field at a point in tile units, bilinear between tile centres. */
  function sample(F, px, py) {
    const u = Math.min(Math.max(px - 0.5, 0), F.W - 1.001);
    const v = Math.min(Math.max(py - 0.5, 0), F.H - 1.001);
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * F.W + i;
    const f = F.field;
    return (f[k] * (1 - a) + f[k + 1] * a) * (1 - b) + (f[k + F.W] * (1 - a) + f[k + F.W + 1] * a) * b;
  }

  /** Unit vector pointing away from land. */
  function awayFromLand(F, px, py) {
    const h = 0.5;
    const gx = sample(F, px + h, py) - sample(F, px - h, py);
    const gy = sample(F, px, py + h) - sample(F, px, py - h);
    const n = Math.hypot(gx, gy) || 1;
    return { x: gx / n, y: gy / n };
  }

  function quantize(dx, dy) {
    return ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  }

  /** Along the contour `clearance` off the coast, land on `landOn`, pulled back onto it. */
  function steer(F, px, py, o) {
    const g = awayFromLand(F, px, py);
    const s = o.landOn === "left" ? -1 : 1;
    const e = Math.max(-1, Math.min(1, (sample(F, px, py) - o.clearance) * o.gain));
    return quantize(-g.y * s - e * g.x, g.x * s - e * g.y);
  }

  /** `steer`, plus backing off the coast for a moment when the hull stops making progress. */
  function makePilot(F, o) {
    let mark = null;
    let backOffUntil = 0;
    return {
      reset() {
        mark = null;
        backOffUntil = 0;
      },
      /** Direction index for a hull at (px, py) tiles, at time `t` ms. */
      next(px, py, t) {
        if (!mark || Math.hypot(px - mark.x, py - mark.y) > 0.5) {
          mark = { x: px, y: py, t };
        } else if (t - mark.t > 2000) {
          backOffUntil = t + 800;
          mark = { x: px, y: py, t: t + 800 };
        }
        if (t < backOffUntil) {
          const g = awayFromLand(F, px, py);
          return quantize(g.x, g.y);
        }
        return steer(F, px, py, o);
      },
    };
  }

  //#endregion core

  window.__coastBot?.destroy();

  const MOVE_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
  const USER_KEYS = new Set([
    ...MOVE_KEYS, "w", "a", "s", "d", "W", "A", "S", "D", "e", "E", "f", "F", " ",
  ]);
  const origFetch = window.fetch;
  const origSend = WebSocket.prototype.send;

  let cfg = null;
  let map = null;
  let labels = null;
  let homeMass = -1;
  let islandId = -1;
  const islandNames = new Map();
  let pilot = null;
  // Last ship position the game reported, in world units.
  const pos = { x: 0, y: 0, known: false };
  // "loading" | "ready" | "running" | "ping" | "paused" | "stopped"
  let status = "loading";
  let note = "loading map…";
  let sonar = null;
  let lastSonarAt = 0;
  let runningSince = 0;
  let timer = null;
  const held = new Set();

  // --- keys ------------------------------------------------------------------

  function keyEvent(type, key) {
    window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  }

  function keysFor(dir) {
    const [dx, dy] = DIRS[dir];
    const want = new Set();
    if (dx > 0) want.add("ArrowRight");
    if (dx < 0) want.add("ArrowLeft");
    if (dy > 0) want.add("ArrowDown");
    if (dy < 0) want.add("ArrowUp");
    return want;
  }

  function hold(want) {
    for (const k of [...held]) {
      if (!want.has(k)) {
        held.delete(k);
        keyEvent("keyup", k);
      }
    }
    // Re-sent every tick: the game drops all held keys when the window loses focus.
    for (const k of want) {
      held.add(k);
      keyEvent("keydown", k);
    }
  }

  const releaseAll = () => hold(new Set());

  // --- what the game says --------------------------------------------------------

  function setPos(x, y) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      pos.x = x;
      pos.y = y;
      pos.known = true;
    }
  }

  WebSocket.prototype.send = function (data) {
    if (typeof data === "string" && data.includes('"treasure.move"')) {
      try {
        const m = JSON.parse(data);
        if (m.type === "treasure.move") setPos(m.payload.x, m.payload.y);
      } catch {}
    }
    return origSend.call(this, data);
  };

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    if (/\/api\/treasure-world\/(land|leave)\b/.test(url) && method !== "GET") {
      stop("you went ashore");
    }
    const res = await origFetch.call(window, input, init);
    if (res.ok && /\/api\/treasure-world\/(sonar|fish\/cast|fish\/release)\b/.test(url)) {
      res.clone().json().then(onSonar, () => {});
    } else if (res.ok && /\/api\/treasure-world\/position\b/.test(url)) {
      res.clone().json().then((r) => r?.corrected && setPos(r.x, r.y), () => {});
    }
    return res;
  };

  function onSonar(v) {
    if (!v || typeof v.state !== "string") return;
    const was = sonar?.state;
    sonar = v;
    lastSonarAt = Date.now();
    if (v.state === "signal") {
      if (status === "running") {
        status = "ping";
        releaseAll();
        alarm(v.shore ? "🐟 Shore ping!" : "🐟 Sonar ping!", "Steer onto the blip, stop and cast (F).");
      }
    } else {
      stopAlarm();
      if (v.state === "blocked") {
        if (status === "running" || status === "ping") {
          stop(v.reason === "crate_full" ? "the egg crate is full" : "today's egg is kept");
          alarm("🥚 Coast bot stopped", note);
        }
      } else if (v.state === "quiet" && was === "signal" && status === "ping" && OPTS.resumeAfterFade) {
        start();
      }
    }
    render();
  }

  function onUserKey(e) {
    if (!e.isTrusted) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
      return;
    }
    stopAlarm();
    if ((status === "running" || status === "ping") && USER_KEYS.has(e.key)) {
      status = "paused";
      note = "you took over";
      releaseAll();
      render();
    }
  }
  window.addEventListener("keydown", onUserKey, true);
  window.addEventListener("focus", stopAlarm);

  // --- the loop --------------------------------------------------------------

  function tick() {
    if (status !== "running" || !pos.known) return;
    const px = pos.x / cfg.tile;
    const py = pos.y / cfg.tile;
    hold(keysFor(pilot.next(px, py, performance.now())));
    render();
  }

  function start() {
    if (!cfg || status === "running") return;
    if (!pos.known) {
      note = "no ship position yet";
      render();
      return;
    }
    // Lock onto the island nearest the ship; clicking Start elsewhere re-locks.
    const id = nearestLandMass(cfg, labels, pos.x / cfg.tile, pos.y / cfg.tile);
    if (id < 0 || id === homeMass) {
      status = "paused";
      note = id < 0 ? "no island nearby, sail closer" : "no pings by the home harbour, sail to another island";
      render();
      return;
    }
    if (id !== islandId) {
      islandId = id;
      pilot = makePilot(buildField(cfg, map, labels, id), OPTS);
    }
    pilot.reset();
    status = "running";
    note = "";
    runningSince = Date.now();
    stopAlarm();
    render();
  }

  function stop(why) {
    status = "stopped";
    note = why;
    releaseAll();
    render();
  }

  // --- alarm -------------------------------------------------------------------

  let audio = null;
  let blinkTimer = null;
  let beepTimer = null;
  let notification = null;
  let savedTitle = null;

  function beep() {
    if (!audio) return;
    const t0 = audio.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(audio.destination);
      const at = t0 + i * 0.25;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      o.start(at);
      o.stop(at + 0.2);
    }
  }

  function alarm(title, body) {
    stopAlarm();
    savedTitle = document.title;
    let on = false;
    blinkTimer = setInterval(() => {
      on = !on;
      document.title = on ? title : savedTitle;
    }, 600);
    beep();
    beepTimer = setInterval(beep, 5000);
    if ("Notification" in window && Notification.permission === "granted") {
      notification = new Notification(title, { body, tag: "coast-bot", requireInteraction: true });
      notification.onclick = () => {
        window.focus();
        notification?.close();
      };
    }
    panel.style.outline = "3px solid #ff5a5a";
  }

  function stopAlarm() {
    clearInterval(blinkTimer);
    clearInterval(beepTimer);
    blinkTimer = beepTimer = null;
    if (savedTitle !== null) document.title = savedTitle;
    savedTitle = null;
    notification?.close();
    notification = null;
    panel.style.outline = "none";
  }

  // --- panel -------------------------------------------------------------------

  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;gap:8px;align-items:center;" +
    "padding:8px 10px;border-radius:8px;background:#0b2233;color:#e8f4ff;" +
    "font:12px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)";
  const label = document.createElement("span");
  const btn = (text, title, onClick) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.title = title;
    b.style.cssText = "font:inherit;padding:2px 8px;border-radius:5px;border:1px solid #4d7a99;background:#16405c;color:inherit;cursor:pointer";
    b.addEventListener("click", () => {
      b.blur(); // a focused button would swallow the game's Space
      onClick();
    });
    return b;
  };
  const goBtn = btn("Start", "Start or pause the coast bot", () => {
    audio ??= new AudioContext();
    void audio.resume();
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    if (status === "running") {
      status = "paused";
      note = "";
      releaseAll();
      render();
    } else {
      start();
    }
  });
  const sideBtn = btn("", "Which side of the ship the land is on", () => {
    OPTS.landOn = OPTS.landOn === "right" ? "left" : "right";
    render();
  });
  const closeBtn = btn("×", "Remove the coast bot", () => window.__coastBot.destroy());
  panel.append("🧭", label, goBtn, sideBtn, closeBtn);
  document.body.append(panel);

  function render() {
    goBtn.textContent = status === "running" ? "Pause" : "Start";
    goBtn.disabled = status === "loading";
    sideBtn.textContent = OPTS.landOn === "right" ? "land ▶" : "◀ land";
    let text;
    if (status === "running") {
      const s = Math.round((Date.now() - runningSince) / 1000);
      const t = map[Math.floor(pos.y / cfg.tile) * cfg.worldW + Math.floor(pos.x / cfg.tile)];
      const home = cfg.islands.find((i) => i.id === cfg.homeIslandId);
      const safe = home && Math.hypot(pos.x / cfg.tile - home.cx, pos.y / cfg.tile - home.cy) <= cfg.harbourSafeTiles;
      const where = safe ? "harbour safe water, no pings" : t === cfg.terrain.shallow ? "shallows" : "deep water";
      const deaf = Date.now() - lastSonarAt > 10_000 ? " · no sonar polls, kit aboard?" : "";
      const isl = islandNames.get(islandId) ?? "the island";
      text = `round ${isl} · ${where} · ${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s${deaf}`;
    } else if (status === "ping") {
      text = "🐟 PING! Steer onto it, stop, cast (F)";
    } else {
      text = `${status}${note ? `: ${note}` : ""}`;
    }
    label.textContent = text;
  }

  // --- boot ----------------------------------------------------------------------

  async function api(path) {
    const r = await origFetch(`/api${path}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  }

  (async () => {
    try {
      const board = await api("/treasure-world");
      cfg = board.config;
      const m = await api(`/treasure-world/map?v=${encodeURIComponent(cfg.worldHash)}`);
      map = Uint8Array.from(atob(m.map), (c) => c.charCodeAt(0));
      labels = landMasses(cfg, map);
      for (const isl of cfg.islands) {
        const id = nearestLandMass(cfg, labels, isl.cx, isl.cy);
        islandNames.set(id, isl.name);
        if (isl.id === cfg.homeIslandId) homeMass = id;
      }
      if (board.me.mode === "sailing") setPos(board.me.shipX, board.me.shipY);
      status = "ready";
      note = board.me.mode === "sailing" ? "sail near an island, then Start" : "board your ship first";
    } catch (err) {
      status = "stopped";
      note = String(err);
    }
    render();
  })();
  render();
  timer = setInterval(tick, OPTS.tickMs);

  window.__coastBot = {
    opts: OPTS,
    start,
    pause: () => {
      status = "paused";
      releaseAll();
      render();
    },
    destroy() {
      clearInterval(timer);
      releaseAll();
      stopAlarm();
      window.removeEventListener("keydown", onUserKey, true);
      window.removeEventListener("focus", stopAlarm);
      if (window.fetch !== origFetch) window.fetch = origFetch;
      WebSocket.prototype.send = origSend;
      panel.remove();
      delete window.__coastBot;
    },
  };
})();
