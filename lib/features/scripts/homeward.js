/*
 * Treasure World homeward: sails your ship back to the Home Harbour's jetty from
 * wherever it is on the map, and stops there, ready to go ashore.
 *
 * Use: be aboard your ship anywhere, paste this into the DevTools console on
 * /treasure-world and click Start in the ⚓ panel at the top right. `blackhat
 * scripts homeward` puts it on the clipboard for you.
 *
 * - It sails the fastest way home by sea in the wind as the game scores it: into
 *   the wind's eye is 45 % speed and a beam reach is full speed, so going upwind
 *   it tacks. It replans as the wind turns.
 * - It steers with the game's own arrow keys and reads the ship's position from
 *   the game's own move reports, guessing ahead along its heading between them.
 * - It stops on the jetty's tile, where Space puts you ashore on the harbour.
 * - Pressing an arrow key, WASD, E, F, Q or Space yourself pauses it ("you took
 *   over"). Click Start to hand back.
 * - Keep the window visible (not minimised, not fully covered by other windows):
 *   the game only moves the ship while the page is rendering.
 * - Pasting it again replaces the previous copy; × in the panel removes it.
 */
(() => {
  "use strict";

  //#region core — pure, no DOM, so it also runs under Node for testing

  /** Unit steps for the 8 key directions, index 0 = east, clockwise on screen. */
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  const isSea = (cfg, k) => k === cfg.terrain.deep || k === cfg.terrain.shallow;

  const seaAt = (cfg, map, x, y) =>
    x >= 0 && y >= 0 && x < cfg.worldW && y < cfg.worldH && isSea(cfg, map[y * cfg.worldW + x]);

  /** Whether a diagonal step from (x, y) has sea on both sides: the hull can't squeeze between two corners. */
  const cornerFree = (cfg, map, x, y, dx, dy) =>
    !dx || !dy || (seaAt(cfg, map, x + dx, y) && seaAt(cfg, map, x, y + dy));

  /** `b − a` as an angle in (−π, π]. The game's. */
  function angleTo(a, b) {
    let t = (b - a) % (2 * Math.PI);
    if (t > Math.PI) t -= 2 * Math.PI;
    if (t <= -Math.PI) t += 2 * Math.PI;
    return t;
  }

  /** The wind at local time `now` (ms) from the forecast, `{ dirRad, knots }`, or null. The game's. */
  function windAt(w, now) {
    const k = w?.keyframes;
    if (!k?.length) return null;
    const t = now + w.offsetMs, first = k[0], last = k[k.length - 1];
    if (t <= first.at) return { dirRad: first.dirRad, knots: first.knots };
    if (t >= last.at) return { dirRad: last.dirRad, knots: last.knots };
    const n = Math.min(k.length - 2, Math.max(0, Math.floor((t - first.at) / Math.max(1, w.stepMs))));
    const a = k[n], b = k[n + 1];
    const f = b.at > a.at ? Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at))) : 0;
    return { dirRad: a.dirRad + angleTo(a.dirRad, b.dirRad) * f, knots: a.knots + (b.knots - a.knots) * f };
  }

  /**
   * The share of full speed a heading makes in `wind`: the points of sail, by the
   * angle off the wind's eye (the wind blows towards `dirRad`). The game's.
   */
  function sailFactor(cfg, heading, wind) {
    const p = cfg.sailing.pointsOfSail;
    if (!wind || !p.length) return 1;
    const deg = (Math.abs(angleTo(heading, wind.dirRad + Math.PI)) * 180) / Math.PI;
    let f = p[p.length - 1].factor;
    if (deg <= p[0].deg) f = p[0].factor;
    else {
      for (let i = 0; i < p.length - 1; i++) {
        if (deg <= p[i + 1].deg) {
          const s = p[i + 1].deg > p[i].deg ? (deg - p[i].deg) / (p[i + 1].deg - p[i].deg) : 1;
          f = p[i].factor + (p[i + 1].factor - p[i].factor) * s;
          break;
        }
      }
    }
    return Math.min(1, Math.max(0, f));
  }

  /** Seconds to sail one step in each of the 8 directions in `wind`. A diagonal is the same speed, √2 the way. */
  const stepTimes = (cfg, wind) =>
    DIRS.map(([dx, dy]) => (Math.hypot(dx, dy) * cfg.tile) / (cfg.shipSpeed * sailFactor(cfg, Math.atan2(dy, dx), wind)));

  /** Seconds by sea from every tile to tile `goal`, sailing the 8 key directions at `steps`; Infinity where there is no way. */
  function timeTo(cfg, map, goal, steps) {
    const W = cfg.worldW;
    const time = new Float64Array(W * cfg.worldH).fill(Infinity);
    // A binary min-heap of [seconds, tile].
    const heap = [];
    const push = (s, i) => {
      heap.push([s, i]);
      for (let c = heap.length - 1; c > 0; ) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        [heap[p], heap[c]] = [heap[c], heap[p]];
        c = p;
      }
    };
    const pop = () => {
      const top = heap[0], end = heap.pop();
      if (heap.length) {
        heap[0] = end;
        for (let c = 0; ; ) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };
    if (!isSea(cfg, map[goal])) return time;
    time[goal] = 0;
    push(0, goal);
    while (heap.length) {
      const [s, b] = pop();
      if (s > time[b]) continue;
      const bx = b % W, by = (b - bx) / W;
      // Every tile one step `d` short of b.
      for (let d = 0; d < 8; d++) {
        const [dx, dy] = DIRS[d];
        const ax = bx - dx, ay = by - dy, a = ay * W + ax;
        if (!seaAt(cfg, map, ax, ay) || !cornerFree(cfg, map, ax, ay, dx, dy)) continue;
        const t = s + steps[d];
        if (t < time[a]) {
          time[a] = t;
          push(t, a);
        }
      }
    }
    return time;
  }

  /** The direction index that gets home soonest from tile `i`, or -1 at home or where there is no way. */
  function bestDir(cfg, map, time, steps, i) {
    if (!(time[i] > 0 && time[i] < Infinity)) return -1;
    const W = cfg.worldW, x = i % W, y = (i - x) / W;
    let best = -1, bestT = Infinity;
    for (let d = 0; d < 8; d++) {
      const [dx, dy] = DIRS[d];
      if (!seaAt(cfg, map, x + dx, y + dy) || !cornerFree(cfg, map, x, y, dx, dy)) continue;
      const t = steps[d] + time[(y + dy) * W + x + dx];
      if (t < bestT) {
        best = d;
        bestT = t;
      }
    }
    return best;
  }

  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  /** The compass point the wind blows from, as the game's wind gauge names it. */
  const windFrom = (w) => COMPASS[Math.round((((((w.dirRad + Math.PI) * 180) / Math.PI + 90) % 360) + 360) % 360 / 45) % 8];

  /** "0:42", "2:05". */
  function clock(s) {
    const r = Math.round(s);
    return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
  }

  //#endregion core

  window.__homeward?.destroy();

  const MOVE_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
  const USER_KEYS = new Set([...MOVE_KEYS, "w", "a", "s", "d", "W", "A", "S", "D", "e", "E", "f", "F", "q", "Q", " "]);
  const origFetch = window.fetch;
  const origSend = WebSocket.prototype.send;

  let cfg = null;
  let map = null;
  /** The game's wind forecast, with `offsetMs` from this clock to the server's. */
  let forecast = null;
  let forecastAt = 0;
  /** The plan: seconds home from every tile, the step times it was made with, and the wind it was made in. */
  let plan = null;
  let mode = null;
  /** The ship's place as the page last reported it, in world units, and when. */
  const pos = { x: 0, y: 0, at: 0, known: false };
  /** The direction held (-1 for none), and since when. */
  let dir = -1;
  let dirSince = 0;
  // "loading" | "ready" | "running" | "paused" | "stopped" | "home"
  let status = "loading";
  let note = "";
  let timer = null;
  const held = new Set();

  const tileOf = (x, y) => Math.floor(y / cfg.tile) * cfg.worldW + Math.floor(x / cfg.tile);
  const windNow = () => windAt(forecast, Date.now());

  // --- keys ------------------------------------------------------------------

  function keyEvent(type, key) {
    window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
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

  function steer(d, now) {
    if (d !== dir) {
      dir = d;
      dirSince = now;
    }
    const want = new Set();
    if (d >= 0) {
      const [dx, dy] = DIRS[d];
      if (dx > 0) want.add("ArrowRight");
      if (dx < 0) want.add("ArrowLeft");
      if (dy > 0) want.add("ArrowDown");
      if (dy < 0) want.add("ArrowUp");
    }
    hold(want);
  }

  const letGo = () => steer(-1, performance.now());

  function onUserKey(e) {
    if (!e.isTrusted) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    stopAlarm();
    if (status === "running" && USER_KEYS.has(e.key)) pause("you took over");
  }
  window.addEventListener("keydown", onUserKey, true);
  window.addEventListener("focus", stopAlarm);

  // --- what the game says --------------------------------------------------------

  function setPos(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    pos.x = x;
    pos.y = y;
    pos.at = performance.now();
    pos.known = true;
  }

  // The page reports the hull's place on its socket while it sails, a few times a second.
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
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    let sent = null;
    if (method !== "GET" && typeof init?.body === "string") {
      try {
        sent = JSON.parse(init.body);
      } catch {}
    }
    // Its other report, which also carries where the hull came to rest.
    if (path === "/api/treasure-world/position" && sent && mode === "sailing") setPos(sent.x, sent.y);
    const res = await origFetch.call(window, input, init);
    if (!res.ok) return res;
    if (path === "/api/treasure-world/position") {
      res.clone().json().then((r) => r?.corrected && mode === "sailing" && setPos(r.x, r.y), () => {});
    } else if (path === "/api/treasure-world/wind") {
      res.clone().json().then(onWind, () => {});
    } else if (path === "/api/treasure-world" && method === "GET") {
      res.clone().json().then((b) => b?.me && onMode(b.me.mode), () => {});
    } else if (path === "/api/treasure-world/land" || path === "/api/treasure-world/leave") {
      onMode(path.endsWith("land") ? "ashore" : "away");
    } else if (path === "/api/treasure-world/embark") {
      onMode("sailing");
    }
    return res;
  };

  function onWind(w) {
    if (!Array.isArray(w?.keyframes)) return;
    forecast = { ...w, offsetMs: w.serverNow - Date.now() };
    forecastAt = Date.now();
  }

  function onMode(m) {
    mode = m;
    if (status === "running" && m !== "sailing") stop(m === "ashore" ? "you went ashore" : "you left the world");
    render();
  }

  // --- sailing -------------------------------------------------------------------

  /** Plan again when the wind has turned 2° since the last plan, or a forecast has come or gone. */
  function replan() {
    const wind = windNow();
    const same = plan && (plan.wind && wind ? Math.abs(angleTo(plan.wind.dirRad, wind.dirRad)) < Math.PI / 90 : !plan.wind && !wind);
    if (same) return;
    const steps = stepTimes(cfg, wind);
    plan = { wind, steps, time: timeTo(cfg, map, cfg.homeDock, steps) };
  }

  /**
   * Where the ship is now, near enough: the last report, carried on along the
   * held heading. Only while reports keep coming, as none come once it stops.
   */
  function ahead(now) {
    const age = now - pos.at;
    if (dir < 0 || age > 400) return pos;
    const [dx, dy] = DIRS[dir];
    const run = (cfg.shipSpeed * sailFactor(cfg, Math.atan2(dy, dx), windNow()) * Math.min(age, now - dirSince)) / 1000;
    const n = Math.hypot(dx, dy);
    return { x: pos.x + (dx / n) * run, y: pos.y + (dy / n) * run };
  }

  function tick() {
    if (status !== "running") return;
    const now = performance.now();
    replan();
    const p = ahead(now);
    let i = tileOf(p.x, p.y);
    // A guess that ran onto land or off the map goes by the last report instead.
    if (!(plan.time[i] < Infinity)) i = tileOf(pos.x, pos.y);
    if (i === cfg.homeDock) {
      // Let go, and give the page a moment to report where the hull came to rest.
      if (dir >= 0) letGo();
      else if (now - dirSince > 800) finish();
      return render();
    }
    if (!(plan.time[i] < Infinity)) return stop("there's no way home by sea from here");
    if (dir >= 0 && now - pos.at > 5000 && now - dirSince > 5000) {
      return stop("the ship won't move. Is the window visible, or is it a battle?");
    }
    const d = bestDir(cfg, map, plan.time, plan.steps, i);
    steer(d, now);
    render();
  }

  function start() {
    if (!cfg || status === "running") return;
    if (mode !== "sailing" || !pos.known) {
      status = "paused";
      note = mode === "ashore" ? "board your ship first" : "set sail first";
      return render();
    }
    if (tileOf(pos.x, pos.y) === cfg.homeDock) {
      status = "home";
      note = "already at the jetty: Space goes ashore";
      return render();
    }
    // The page fetches the wind only every half hour. A fresher forecast replans when it lands.
    if (Date.now() - forecastAt > 10 * 60_000) api("/treasure-world/wind").then(onWind, () => {});
    status = "running";
    note = "";
    stopAlarm();
    letGo();
    render();
  }

  function pause(why) {
    status = "paused";
    note = why;
    letGo();
    render();
  }

  function stop(why) {
    status = "stopped";
    note = why;
    letGo();
    render();
  }

  function finish() {
    status = "home";
    note = "at the jetty: Space goes ashore";
    letGo();
    render();
    alarm("⚓ Home", "Your ship is at the Home Harbour's jetty. Space goes ashore.");
  }

  // --- alarm -------------------------------------------------------------------

  let blinkTimer = null;
  let notification = null;
  let savedTitle = null;

  /** Flash the tab title until you're back, and raise a desktop notification. */
  function alarm(title, body) {
    stopAlarm();
    savedTitle = document.title;
    let on = false;
    blinkTimer = setInterval(() => {
      on = !on;
      document.title = on ? title : savedTitle;
    }, 600);
    if ("Notification" in window && Notification.permission === "granted") {
      notification = new Notification(title, { body, tag: "homeward" });
      notification.onclick = () => {
        window.focus();
        notification?.close();
      };
    }
  }

  function stopAlarm() {
    clearInterval(blinkTimer);
    blinkTimer = null;
    if (savedTitle !== null) document.title = savedTitle;
    savedTitle = null;
    notification?.close();
    notification = null;
  }

  // --- panel -------------------------------------------------------------------

  // Top right, under the Tide Digger's: the bottom left is the Coast Bot's.
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:28px;top:140px;z-index:2147483647;display:flex;gap:8px;align-items:center;" +
    "max-width:calc(100vw - 56px);padding:8px 10px;border-radius:8px;background:#0b2233;color:#e8f4ff;" +
    "font:12px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)";
  const label = document.createElement("span");
  const btn = (text, title, onClick) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.title = title;
    b.style.cssText =
      "font:inherit;padding:2px 8px;border-radius:5px;border:1px solid #4d7a99;background:#16405c;color:inherit;cursor:pointer";
    b.addEventListener("click", () => {
      b.blur(); // a focused button would swallow the game's Space
      onClick();
    });
    return b;
  };
  const goBtn = btn("Start", "Start or pause sailing home", () => {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    if (status === "running") pause("");
    else start();
  });
  const closeBtn = btn("×", "Remove the homeward script", () => window.__homeward.destroy());
  panel.append("⚓", label, goBtn, closeBtn);
  document.body.append(panel);

  function render() {
    goBtn.textContent = status === "running" ? "Pause" : "Start";
    goBtn.disabled = status === "loading";
    let text;
    if (status === "running" && plan) {
      const i = tileOf(pos.x, pos.y);
      const left = plan.time[i] < Infinity ? ` · about ${clock(plan.time[i])} to go` : "";
      const from = plan.wind ? ` · wind from ${windFrom(plan.wind)}` : "";
      text = `sailing home${left}${from}`;
    } else {
      text = `${status}${note ? `: ${note}` : ""}`;
    }
    if (label.textContent !== text) label.textContent = text;
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
      const b = await api("/treasure-world");
      cfg = b.config;
      const m = await api(`/treasure-world/map?v=${encodeURIComponent(cfg.worldHash)}`);
      map = Uint8Array.from(atob(m.map), (c) => c.charCodeAt(0));
      try {
        onWind(await api("/treasure-world/wind"));
      } catch {}
      mode = b.me.mode;
      if (mode === "sailing" && !pos.known) setPos(b.me.shipX, b.me.shipY);
      status = "ready";
      if (mode !== "sailing") note = mode === "ashore" ? "board your ship, then Start" : "set sail, then Start";
      else if (tileOf(pos.x, pos.y) === cfg.homeDock) note = "already at the jetty";
      else {
        replan();
        const t = plan.time[tileOf(pos.x, pos.y)];
        note = t < Infinity ? `about ${clock(t)} from the jetty` : "there's no way home by sea from here";
      }
    } catch (err) {
      status = "stopped";
      note = String(err.message ?? err);
    }
    render();
  })();
  render();
  timer = setInterval(tick, 50);

  window.__homeward = {
    start,
    pause: () => pause(""),
    destroy() {
      status = "stopped";
      clearInterval(timer);
      letGo();
      stopAlarm();
      window.removeEventListener("keydown", onUserKey, true);
      window.removeEventListener("focus", stopAlarm);
      if (window.fetch !== origFetch) window.fetch = origFetch;
      WebSocket.prototype.send = origSend;
      panel.remove();
      delete window.__homeward;
    },
  };
})();
