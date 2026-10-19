/*
 * Treasure World coast bot: sails along an island's coast in the shallows and
 * stops when the egg-fishing sonar pings, then flashes the tab title, beeps and
 * shows a desktop notification. With 🎣 auto-fish on it fishes the ping itself
 * instead: sails onto it, casts and reels all its casts, keeps the first egg of a
 * kind you picked and lets every other go.
 *
 * Use: board your ship with the fishing kit, sail out near an island (any but the
 * home harbour), paste this into the DevTools console, click Start in the panel at
 * the bottom left. `blackhat coast-bot` puts it on the clipboard for you.
 *
 * - It steers by sending the same arrow-key events the keyboard does, reads the
 *   ship's position from the game's own presence messages, and reads pings from
 *   the game's own sonar polls (it never polls the sonar itself).
 * - Auto-fish casts and reels with the game's own F key, hears the bite on the
 *   game's own socket, and keeps or lets go with the game's own buttons.
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
    // Auto-fish: fish each ping rather than calling you, keeping only these kinds.
    // Both are remembered between pastes.
    fish: false,
    keep: [],
    // How near the ping to stop, in tiles. The rod reaches castRadiusTiles (2).
    arrive: 0.9,
  };

  //#region core — pure steering, no DOM, so it also runs under Node for testing

  /** Unit steps for the 8 key directions, index 0 = east, clockwise on screen. */
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  const isSea = (cfg, k) => k === cfg.terrain.deep || k === cfg.terrain.shallow;

  const seaAt = (cfg, map, x, y) =>
    x >= 0 && y >= 0 && x < cfg.worldW && y < cfg.worldH && isSea(cfg, map[y * cfg.worldW + x]);

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

  /** Whether a diagonal step from (x, y) has sea on both sides: the hull can't squeeze between two corners. */
  const cornerFree = (cfg, map, x, y, dx, dy) =>
    !dx || !dy || (seaAt(cfg, map, x + dx, y) && seaAt(cfg, map, x, y + dy));

  /** Steps by sea from each tile to the target tile, -1 where there is no way. */
  function buildRoute(cfg, map, tx, ty) {
    const W = cfg.worldW;
    const steps = new Int32Array(W * cfg.worldH).fill(-1);
    if (!seaAt(cfg, map, tx, ty)) return steps;
    steps[ty * W + tx] = 0;
    const queue = [ty * W + tx];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % W, y = (i - x) / W;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, j = ny * W + nx;
        if (!seaAt(cfg, map, nx, ny) || steps[j] >= 0 || !cornerFree(cfg, map, x, y, dx, dy)) continue;
        steps[j] = steps[i] + 1;
        queue.push(j);
      }
    }
    return steps;
  }

  /** Sea all along a straight line in tile units, checked every quarter tile. */
  function clearLine(cfg, map, ax, ay, bx, by) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 4);
    for (let k = 1; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
      if (!seaAt(cfg, map, Math.floor(x), Math.floor(y))) return false;
    }
    return true;
  }

  /**
   * Heads for a point (gx, gy) in tile units by sea: straight at it when nothing
   * is in the way, else at the furthest tile it can see a few steps down the
   * route. Makes for the middle of its own tile for a moment when the hull stops
   * making progress.
   */
  function makeHoming(cfg, map, gx, gy) {
    const W = cfg.worldW;
    const steps = buildRoute(cfg, map, Math.floor(gx), Math.floor(gy));
    const at = (px, py) => (seaAt(cfg, map, Math.floor(px), Math.floor(py)) ? steps[Math.floor(py) * W + Math.floor(px)] : -1);
    const downhill = (i) => {
      const x = i % W, y = (i - x) / W;
      let best = i, bestD = Infinity;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, j = ny * W + nx;
        if (!seaAt(cfg, map, nx, ny) || steps[j] !== steps[i] - 1 || !cornerFree(cfg, map, x, y, dx, dy)) continue;
        const d = Math.hypot(nx + 0.5 - gx, ny + 0.5 - gy);
        if (d < bestD) {
          best = j;
          bestD = d;
        }
      }
      return best;
    };
    let mark = null;
    let unstickUntil = 0;
    return {
      /** Whether there is a way by sea from (px, py) tiles. */
      reaches: (px, py) => at(px, py) >= 0,
      /** Direction index for a hull at (px, py) tiles at time `t` ms, or -1 when there's no way. */
      next(px, py, t) {
        if (at(px, py) < 0) return -1;
        if (!mark || Math.hypot(px - mark.x, py - mark.y) > 0.3) {
          mark = { x: px, y: py, t };
        } else if (t - mark.t > 1500) {
          unstickUntil = t + 500;
          mark = { x: px, y: py, t: t + 500 };
        }
        if (t < unstickUntil) return quantize(Math.floor(px) + 0.5 - px, Math.floor(py) + 0.5 - py);
        if (clearLine(cfg, map, px, py, gx, gy)) return quantize(gx - px, gy - py);
        let i = Math.floor(py) * W + Math.floor(px);
        let aim = null;
        for (let k = 0; k < 8 && steps[i] > 0; k++) {
          i = downhill(i);
          const cx = (i % W) + 0.5, cy = Math.floor(i / W) + 0.5;
          if (!aim || clearLine(cfg, map, px, py, cx, cy)) aim = { x: cx, y: cy };
        }
        return aim ? quantize(aim.x - px, aim.y - py) : quantize(gx - px, gy - py);
      },
    };
  }

  /** "silk-betta" → "Silk Betta". */
  const kindName = (id) => id.replace(/(^|-)(\w)/g, (_, dash, c) => (dash ? " " : "") + c.toUpperCase());

  /** Every egg the rod can bring up: the base table's, and the zones' extras. */
  function catchKinds(f) {
    const ids = new Set(Object.keys(f.baseCatchTable).filter((k) => k !== "nothing"));
    for (const zone of Object.values(f.zoneTickets ?? {})) for (const k of Object.keys(zone)) ids.add(k);
    return [...ids];
  }

  /**
   * A cast's tickets by kind, "nothing" included, at a ping: the base table plus
   * those of every zone the ping is in. The far north goes by the ping's row,
   * the shore by its being a shore ping, and a zone this doesn't know counts as in.
   */
  function castTickets(cfg, ping) {
    const f = cfg.fishing;
    const t = { ...f.baseCatchTable };
    for (const [zone, extra] of Object.entries(f.zoneTickets ?? {})) {
      const inZone =
        zone === "north" ? Math.floor(ping.y / cfg.tile) < f.northRows : zone === "shore" ? ping.shore === true : true;
      if (inZone) for (const [k, n] of Object.entries(extra)) t[k] = (t[k] ?? 0) + n;
    }
    return t;
  }

  //#endregion core

  window.__coastBot?.destroy();

  const SAVED = "coastBot";
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED) ?? "{}");
    if (typeof saved.fish === "boolean") OPTS.fish = saved.fish;
    if (Array.isArray(saved.keep)) OPTS.keep = saved.keep.filter((k) => typeof k === "string");
  } catch {}
  function save() {
    try {
      localStorage.setItem(SAVED, JSON.stringify({ fish: OPTS.fish, keep: OPTS.keep }));
    } catch {}
  }

  const MOVE_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
  const USER_KEYS = new Set([
    ...MOVE_KEYS, "w", "a", "s", "d", "W", "A", "S", "D", "e", "E", "f", "F", " ",
  ]);
  const ZONE_WHERE = { north: "the far north", shore: "shore pings" };
  const MISSES = {
    nothing: "nothing on the hook",
    spooked: "spooked it",
    got_away: "it got away",
    snapped: "the line snapped",
  };
  const origFetch = window.fetch;
  const origSend = WebSocket.prototype.send;

  let cfg = null;
  let map = null;
  let labels = null;
  let homeMass = -1;
  let islandId = -1;
  // Landmass → the config's island, for its name and where it lies.
  const islands = new Map();
  let pilot = null;
  // Last ship position the game reported, in world units, and when it last changed.
  const pos = { x: 0, y: 0, known: false };
  let movedAt = 0;
  // "loading" | "ready" | "running" | "ping" | "fishing" | "paused" | "stopped"
  let status = "loading";
  let note = "loading map…";
  let sonar = null;
  let sonarChangedAt = 0;
  let lastSonarAt = 0;
  let runningSince = 0;
  let timer = null;
  const held = new Set();

  // Auto-fish: the ping in hand (worth fishing? the way there), the last F
  // pressed to cast, the last cast the game asked for, the last egg hooked, the
  // keep-or-release attempts on it, and a line for the panel.
  let ping = null;
  let castPressedAt = 0;
  let castAskedAt = 0;
  let hookedKind = null;
  const decide = { at: 0, tries: 0 };
  let fishNote = "";

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

  /** The game's F: casts on a ping when the ship stands still, reels when the line is out. */
  function pressFish() {
    keyEvent("keydown", "f");
    keyEvent("keyup", "f");
  }

  // --- what the game says --------------------------------------------------------

  function setPos(x, y) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (x !== pos.x || y !== pos.y) movedAt = performance.now();
      pos.x = x;
      pos.y = y;
      pos.known = true;
    }
  }

  // The game's socket, met on its first send. The bite comes in on it.
  const sockets = new Set();
  function onSocketMessage(e) {
    if (typeof e.data !== "string" || !e.data.includes('"fishing.bite"')) return;
    try {
      if (JSON.parse(e.data).type !== "fishing.bite") return;
    } catch {
      return;
    }
    if (status !== "fishing" || sonar?.state !== "cast") return;
    fishNote = "it's biting, reeling in";
    render();
    // The reel window is reelWindowMs (1.5 s) from the bite; a beat after it is safe.
    setTimeout(() => {
      if (status === "fishing" && sonar?.state === "cast") pressFish();
    }, 150);
  }

  WebSocket.prototype.send = function (data) {
    if (!sockets.has(this)) {
      sockets.add(this);
      this.addEventListener("message", onSocketMessage);
    }
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
    if (/\/api\/treasure-world\/fish\/cast\b/.test(url)) castAskedAt = performance.now();
    const res = await origFetch.call(window, input, init);
    if (res.ok && /\/api\/treasure-world\/(sonar|fish\/cast|fish\/release)\b/.test(url)) {
      res.clone().json().then(onSonar, () => {});
    } else if (res.ok && /\/api\/treasure-world\/fish\/reel\b/.test(url)) {
      res.clone().json().then(onReel, () => {});
    } else if (res.ok && /\/api\/treasure-world\/fish\/keep\b/.test(url)) {
      res.clone().json().then(onKept, () => {});
    } else if (res.ok && /\/api\/treasure-world\/position\b/.test(url)) {
      res.clone().json().then((r) => r?.corrected && setPos(r.x, r.y), () => {});
    }
    return res;
  };

  function onSonar(v) {
    if (!v || typeof v.state !== "string") return;
    const was = sonar?.state;
    if (v.state !== was) sonarChangedAt = performance.now();
    sonar = v;
    lastSonarAt = Date.now();
    if (v.state === "cast" && was !== "cast" && status === "fishing") fishNote = "line out, waiting for a bite";
    if (v.state === "signal") {
      if (status === "running" && !OPTS.fish) {
        status = "ping";
        releaseAll();
        alarm(v.shore ? "🐟 Shore ping!" : "🐟 Sonar ping!", "Steer onto the blip, stop and cast (F).");
      }
    } else {
      // A stop's alarm rings until you're back; the polls after it don't end it.
      if (status !== "stopped") stopAlarm();
      if (v.state === "blocked") {
        if (status === "running" || status === "ping" || status === "fishing") {
          stop(v.reason === "crate_full" ? "the egg crate is full" : "today's egg is kept");
          alarm("🥚 Coast bot stopped", note);
        }
      } else if (v.state === "quiet" && was === "signal" && status === "ping" && OPTS.resumeAfterFade) {
        start();
      }
    }
    render();
  }

  function onReel(r) {
    if (status !== "fishing" || !r) return;
    hookedKind = r.outcome === "hooked" ? (r.kind ?? null) : null;
    fishNote = hookedKind ? `hooked a ${kindName(hookedKind)}` : (MISSES[r.outcome] ?? String(r.outcome));
    render();
  }

  function onKept(r) {
    if (status !== "fishing") return;
    const name = kindName(r?.kind ?? hookedKind ?? "mystery");
    stop(`kept a ${name} egg`);
    alarm(`🥚 Kept a ${name} egg!`, "Today's catch is done, so the coast bot has stopped.");
  }

  function onUserKey(e) {
    if (!e.isTrusted) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
      return;
    }
    stopAlarm();
    if ((status === "running" || status === "ping" || status === "fishing") && USER_KEYS.has(e.key)) {
      status = "paused";
      note = "you took over";
      releaseAll();
      render();
    }
  }
  window.addEventListener("keydown", onUserKey, true);
  window.addEventListener("focus", stopAlarm);

  // --- auto-fish -------------------------------------------------------------------

  /**
   * Whether auto-fish takes this sonar state on: a line out or an egg on the hook
   * to see through, or a ping that can hold an egg you picked and that the ship
   * can sail to. A ping not worth it is left to fade while the bot sails on.
   */
  function fishable(s) {
    if (!OPTS.fish || !s) return false;
    if (s.state === "cast" || s.state === "catch") return true;
    if (s.state !== "signal" || s.castsLeft === 0) return false;
    const key = `${s.x},${s.y}`;
    if (ping?.key !== key) {
      const t = castTickets(cfg, s);
      const worth = OPTS.keep.some((k) => t[k] > 0);
      const homing = worth ? makeHoming(cfg, map, s.x / cfg.tile, s.y / cfg.tile) : null;
      const reachable = worth && homing.reaches(pos.x / cfg.tile, pos.y / cfg.tile);
      ping = { key, worth: reachable, homing };
      if (!worth) fishNote = "skipped a ping that can't hold your eggs";
      else if (!reachable) fishNote = "skipped a ping it can't sail to";
    }
    return ping.worth;
  }

  function fishTick() {
    const s = sonar;
    const now = performance.now();
    if (!fishable(s)) {
      // Faded, fished out, or not worth it: back round the coast.
      status = "running";
      pilot.reset();
      render();
      return;
    }
    if (s.state !== "catch") decide.tries = 0;
    if (s.state === "signal") {
      const d = Math.hypot(s.x - pos.x, s.y - pos.y) / cfg.tile;
      if (d > OPTS.arrive) {
        const dir = ping.homing.next(pos.x / cfg.tile, pos.y / cfg.tile, now);
        if (dir < 0) {
          ping.worth = false;
          fishNote = "lost the way to the ping";
          releaseAll();
        } else {
          hold(keysFor(dir));
          fishNote = `sailing onto the ping, ${d.toFixed(1)} tiles off`;
        }
      } else {
        releaseAll();
        // The game casts only once the hull has stood still stillMs; give the
        // last position message and a fresh state a moment to land too.
        const settled = now - movedAt > cfg.fishing.stillMs + 600 && now - sonarChangedAt > 600;
        const asked = now - Math.max(castPressedAt, castAskedAt) < 1500;
        if (settled && !asked) {
          castPressedAt = now;
          pressFish();
        }
        fishNote = settled ? "casting" : "stopping on the ping";
      }
    } else if (s.state === "cast") {
      releaseAll();
    } else {
      releaseAll();
      const kind = s.kind ?? hookedKind;
      if (!kind) {
        stop("an egg is on the hook, but which?");
        alarm("🐟 An egg on the hook", "Keep it or let it go.");
        return;
      }
      choose(kind, now);
    }
    render();
  }

  /** Keeps a kind you picked, lets any other go: the game's own buttons, or the server's when there are none to press. */
  function choose(kind, now) {
    if (now - decide.at < 2000) return;
    decide.at = now;
    decide.tries++;
    const keep = OPTS.keep.includes(kind);
    fishNote = `${keep ? "keeping" : "letting go of"} a ${kindName(kind)}`;
    const text = keep ? "Keep" : "Release";
    const b = [...document.querySelectorAll('[role="status"] button')].find((el) => el.textContent.trim() === text);
    if (b) {
      if (!b.disabled) b.click();
    } else if (decide.tries > 2) {
      api(`/treasure-world/fish/${keep ? "keep" : "release"}`, { method: "POST" }).then(keep ? onKept : onSonar, () => {});
    }
  }

  // --- the loop --------------------------------------------------------------

  function tick() {
    if (!pos.known) return;
    if (status === "running" && fishable(sonar)) status = "fishing";
    if (status === "fishing") {
      fishTick();
      return;
    }
    if (status !== "running") return;
    const px = pos.x / cfg.tile;
    const py = pos.y / cfg.tile;
    hold(keysFor(pilot.next(px, py, performance.now())));
    render();
  }

  function start() {
    if (!cfg || status === "running" || status === "fishing") return;
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
    fishNote = "";
    if (OPTS.fish) {
      const why = fishWhyNot(islands.get(id));
      if (why) {
        status = "paused";
        note = why;
        render();
        return;
      }
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

  /**
   * Why auto-fish can't start round this island, or null when it can. Sets a
   * hint instead when only some of the eggs picked bite here.
   */
  function fishWhyNot(isl) {
    if (!OPTS.keep.length) return "pick the eggs to keep first";
    // The bot sails the shallows, so its pings here are shore pings.
    const t = castTickets(cfg, { y: ((isl?.cy ?? pos.y / cfg.tile) + 0.5) * cfg.tile, shore: true });
    const missing = OPTS.keep.filter((k) => !(t[k] > 0));
    if (!missing.length) return null;
    const north = cfg.islands
      .filter((i) => i.id !== cfg.homeIslandId && i.cy < cfg.fishing.northRows)
      .map((i) => i.name)
      .join(" or ");
    const names = missing.map(kindName).join(" and ");
    const where = north ? `, e.g. ${north}` : "";
    if (missing.length === OPTS.keep.length) return `${names} ${missing.length > 1 ? "bite" : "bites"} only in the far north${where}`;
    fishNote = `no ${names} here, only in the far north${where}`;
    return null;
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
    "position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;flex-direction:column;gap:6px;" +
    "max-width:calc(100vw - 24px);padding:8px 10px;border-radius:8px;background:#0b2233;color:#e8f4ff;" +
    "font:12px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;align-items:center";
  // The kinds to keep, one toggle each, shown while auto-fish is on.
  const keepRow = document.createElement("div");
  keepRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;align-items:center";
  const chips = new Map();
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
    if (status === "running" || status === "fishing") {
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
  const fishBtn = btn("", "Auto-fish: sail onto each ping, cast and reel, keep only the eggs picked below", () => {
    OPTS.fish = !OPTS.fish;
    save();
    if (!OPTS.fish && status === "fishing") {
      status = "paused";
      note = "auto-fish off";
      releaseAll();
    }
    render();
  });
  const closeBtn = btn("×", "Remove the coast bot", () => window.__coastBot.destroy());
  row.append("🧭", label, goBtn, sideBtn, fishBtn, closeBtn);
  keepRow.append("keep:");
  panel.append(row, keepRow);
  document.body.append(panel);

  /** One toggle per kind the rod can bring up, its odds per cast where it bites best. */
  function buildChips() {
    const f = cfg.fishing;
    const t = castTickets(cfg, { y: 0, shore: true });
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    for (const k of catchKinds(f)) {
      const p = (100 * (t[k] ?? 0)) / total;
      const zones = Object.entries(f.zoneTickets ?? {})
        .filter(([, extra]) => extra[k] > 0)
        .map(([zone]) => ZONE_WHERE[zone] ?? zone);
      const where = f.baseCatchTable[k] > 0 || !zones.length ? "" : `, ${zones.join(" and ")} only`;
      const chip = btn(kindName(k), `${kindName(k)}: about ${p < 10 ? p.toFixed(1) : Math.round(p)}% of casts${where}`, () => {
        OPTS.keep = OPTS.keep.includes(k) ? OPTS.keep.filter((x) => x !== k) : [...OPTS.keep, k];
        save();
        render();
      });
      chips.set(k, chip);
      keepRow.append(chip);
    }
  }

  function render() {
    const going = status === "running" || status === "fishing";
    goBtn.textContent = going ? "Pause" : "Start";
    goBtn.disabled = status === "loading";
    sideBtn.textContent = OPTS.landOn === "right" ? "land ▶" : "◀ land";
    fishBtn.textContent = OPTS.fish ? "🎣 auto" : "🎣 off";
    fishBtn.style.background = OPTS.fish ? "#2a7a5c" : "#16405c";
    keepRow.style.display = OPTS.fish && chips.size ? "flex" : "none";
    for (const [k, chip] of chips) {
      const on = OPTS.keep.includes(k);
      chip.style.background = on ? "#2a7a5c" : "transparent";
      chip.style.borderColor = on ? "#5ef2c2" : "#4d7a99";
      chip.style.opacity = on ? "1" : "0.7";
    }
    let text;
    if (status === "running") {
      const s = Math.round((Date.now() - runningSince) / 1000);
      const t = map[Math.floor(pos.y / cfg.tile) * cfg.worldW + Math.floor(pos.x / cfg.tile)];
      const home = cfg.islands.find((i) => i.id === cfg.homeIslandId);
      const safe = home && Math.hypot(pos.x / cfg.tile - home.cx, pos.y / cfg.tile - home.cy) <= cfg.harbourSafeTiles;
      const where = safe ? "harbour safe water, no pings" : t === cfg.terrain.shallow ? "shallows" : "deep water";
      const deaf = Date.now() - lastSonarAt > 10_000 ? " · no sonar polls, kit aboard?" : "";
      const isl = islands.get(islandId)?.name ?? "the island";
      const fished = OPTS.fish && fishNote ? ` · 🎣 ${fishNote}` : "";
      text = `round ${isl} · ${where} · ${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s${deaf}${fished}`;
    } else if (status === "fishing") {
      const left = sonar?.state === "signal" && typeof sonar.castsLeft === "number" ? ` · ${sonar.castsLeft} casts left` : "";
      text = `🎣 ${fishNote}${left}`;
    } else if (status === "ping") {
      text = "🐟 PING! Steer onto it, stop, cast (F)";
    } else {
      text = `${status}${note ? `: ${note}` : ""}`;
    }
    label.textContent = text;
  }

  // --- boot ----------------------------------------------------------------------

  async function api(path, init = {}) {
    const r = await origFetch(`/api${path}`, {
      ...init,
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
        islands.set(id, isl);
        if (isl.id === cfg.homeIslandId) homeMass = id;
      }
      buildChips();
      // A kind the rod no longer brings up, remembered from an older paste.
      OPTS.keep = OPTS.keep.filter((k) => chips.has(k));
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
      for (const s of sockets) s.removeEventListener("message", onSocketMessage);
      panel.remove();
      delete window.__coastBot;
    },
  };
})();
