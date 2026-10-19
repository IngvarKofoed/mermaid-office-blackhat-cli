/*
 * Treasure World tide digger: walks the tide line of the island you're standing
 * on and digs every tile of it for hermits and shells, then stops.
 *
 * Use: sail to an island (any but the home harbour, which has no tide line), go
 * ashore, paste this into the DevTools console on /treasure-world and click Start
 * in the 🦀 panel at the top right. `blackhat scripts tide-digger` puts it on the
 * clipboard for you.
 *
 * - The tide line is sand touching water, the game's own rule; hermits and shells
 *   wash up nowhere else. It works out which tiles those are from the public map,
 *   walks to the nearest one it hasn't dug and presses F there, then brushes off
 *   and closes the find dialog when there is one.
 * - It walks with the game's own arrow keys, a short leg at a time, and re-reads
 *   where the game says you stopped before the next leg.
 * - Each dig drinks one water. It stops when the water runs out, when every
 *   tide-line tile of the island is dug, or when you press a key yourself.
 * - A hermit has two hours in the holding tank to reach the Hatchery, so a hermit
 *   find flashes the tab title, beeps and raises a notification. It keeps digging
 *   for shells. The tank holds one hermit, so a second burrows back in; the bot
 *   remembers that tile, and the next run digs it again once the tank is empty.
 * - It remembers today's dug tiles, so pasting it again doesn't redig them. A new
 *   tide on an island forgets that island's.
 * - Keep the window visible: the figure only walks while the page is drawing.
 * - Pasting it again replaces the previous copy; × in the panel removes it.
 */
(() => {
  "use strict";

  //#region core — pure, no DOM, so it also runs under Node for testing

  /** Tile → island id for every land tile, -1 for water: the first island whose carve box (radius + 4) holds it. The game's rule. */
  function islandMap(cfg, map) {
    const out = new Int16Array(map.length).fill(-1);
    const { sand, rock, palm } = cfg.terrain;
    for (const isl of cfg.islands) {
      const reach = isl.radius + 4;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const tx = isl.cx + dx;
          const ty = isl.cy + dy;
          if (tx < 0 || ty < 0 || tx >= cfg.worldW || ty >= cfg.worldH) continue;
          const i = ty * cfg.worldW + tx;
          const k = map[i];
          if ((k === sand || k === rock || k === palm) && out[i] === -1) out[i] = isl.id;
        }
      }
    }
    return out;
  }

  /** Sand with a shallow or deep 4-neighbour, on `islandId`. The game's rule for where finds wash up. */
  function tideLine(cfg, map, islands, islandId) {
    const { sand, deep, shallow } = cfg.terrain;
    const W = cfg.worldW;
    const H = cfg.worldH;
    const out = [];
    for (let i = 0; i < map.length; i++) {
      if (map[i] !== sand || islands[i] !== islandId) continue;
      const x = i % W;
      const y = (i - x) / W;
      const wet = (j) => map[j] === deep || map[j] === shallow;
      if ((y > 0 && wet(i - W)) || (y < H - 1 && wet(i + W)) || (x > 0 && wet(i - 1)) || (x < W - 1 && wet(i + 1))) {
        out.push(i);
      }
    }
    return out;
  }

  /**
   * The walk from tile `from` to the nearest tile in `targets`, as tiles from the
   * next step to the target, or null when none can be reached. Sand only, eight
   * ways, and never across a corner: a diagonal needs both tiles beside it to be
   * sand, as the figure would otherwise clip the rock it passes.
   */
  function pathToNearest(cfg, map, from, targets) {
    const W = cfg.worldW;
    const H = cfg.worldH;
    const sand = cfg.terrain.sand;
    const prev = new Int32Array(map.length).fill(-1);
    prev[from] = from;
    const queue = [from];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (i !== from && targets.has(i)) {
        const path = [];
        for (let j = i; j !== from; j = prev[j]) path.push(j);
        return path.reverse();
      }
      const x = i % W;
      const y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (prev[j] !== -1 || map[j] !== sand) continue;
          if (dx && dy && (map[y * W + nx] !== sand || map[ny * W + x] !== sand)) continue;
          prev[j] = i;
          queue.push(j);
        }
      }
    }
    return null;
  }

  /** The furthest tile along `path` reached by repeating its first step: one straight leg. */
  function legEnd(cfg, from, path) {
    const step = path[0] - from;
    let end = 0;
    while (end + 1 < path.length && path[end + 1] - path[end] === step) end++;
    return path[end];
  }

  /**
   * Holding the keys to get from (x, y) to (tx, ty): a diagonal while both axes
   * still have ground to cover, then straight along the longer one. Each part is
   * `{ dx, dy, ms }` with dx, dy in −1..1, timed at `speed` units a second — the
   * game moves a diagonal at full speed too.
   */
  function legKeys(x, y, tx, ty, speed) {
    const vx = tx - x;
    const vy = ty - y;
    const d = Math.min(Math.abs(vx), Math.abs(vy));
    const parts = [];
    if (d > 0.5) parts.push({ dx: Math.sign(vx), dy: Math.sign(vy), ms: ((d * Math.SQRT2) / speed) * 1000 });
    const rx = Math.abs(vx) - d;
    const ry = Math.abs(vy) - d;
    if (rx > 0.5) parts.push({ dx: Math.sign(vx), dy: 0, ms: (rx / speed) * 1000 });
    if (ry > 0.5) parts.push({ dx: 0, dy: Math.sign(vy), ms: (ry / speed) * 1000 });
    return parts;
  }

  //#endregion core

  window.__tideDigger?.destroy();

  const STORE = "tideDigger";
  const MOVE_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
  const USER_KEYS = new Set([...MOVE_KEYS, "w", "a", "s", "d", "W", "A", "S", "D", "e", "E", "f", "F", "q", "Q", " "]);
  const origFetch = window.fetch;

  let cfg = null;
  let map = null;
  let islands = null;
  /** The game's board: `me` (mode, water), `hermits` (tank, crate, last tide). */
  let board = null;
  /** Where the game last said the figure stands, and when it said so. */
  const pos = { x: 0, y: 0, at: 0 };
  /** The last dig the page sent: its tile, and the answer once it lands. */
  let dig = null;
  // "loading" | "ready" | "running" | "paused" | "stopped"
  let status = "loading";
  let note = "";
  let islandId = -1;
  let islandName = "";
  let line = [];
  /** Today's memory: tiles dug clean, and tiles holding a find we couldn't carry. */
  let memory = { day: "", tideAt: null, dug: new Set(), left: new Map() };
  const tally = { digs: 0, shells: 0, hermits: 0, chests: 0, coins: 0 };
  const held = new Set();

  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Copenhagen" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tileOf = (x, y) => Math.floor(y / cfg.tile) * cfg.worldW + Math.floor(x / cfg.tile);
  const centre = (i) => ({ x: ((i % cfg.worldW) + 0.5) * cfg.tile, y: (Math.floor(i / cfg.worldW) + 0.5) * cfg.tile });

  // --- memory ------------------------------------------------------------------

  function loadMemory() {
    try {
      const m = JSON.parse(localStorage.getItem(STORE) ?? "null");
      if (m?.day === today()) {
        memory = { day: m.day, tideAt: m.tideAt, dug: new Set(m.dug), left: new Map(m.left) };
        return;
      }
    } catch {}
    memory = { day: today(), tideAt: null, dug: new Set(), left: new Map() };
  }

  function saveMemory() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({ day: memory.day, tideAt: memory.tideAt, dug: [...memory.dug], left: [...memory.left] }),
      );
    } catch {}
  }

  /** A tide that came in today forgets the tiles of the island it came in on (every island, for the seed). */
  function noticeTide(tide) {
    if (!tide || tide.at === memory.tideAt) return;
    memory.tideAt = tide.at;
    const tideDay = new Date(tide.at).toLocaleDateString("en-CA", { timeZone: "Europe/Copenhagen" });
    if (tideDay === memory.day && islands) {
      const hit = (i) => tide.islandId === null || islands[i] === tide.islandId;
      for (const i of [...memory.dug]) if (hit(i)) memory.dug.delete(i);
      for (const i of [...memory.left.keys()]) if (hit(i)) memory.left.delete(i);
    }
    saveMemory();
  }

  // --- what the game says --------------------------------------------------------

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
    if (path === "/api/treasure-world/dig" && sent) dig = { tile: sent.tileIndex, result: null, error: null };
    const res = await origFetch.call(window, input, init);
    if (path === "/api/treasure-world/position" && sent) {
      // The figure's place as the page reported it; the server's, if it corrected it.
      res.clone().json().then((r) => {
        const p = r?.corrected ? r : sent;
        setPos(p.x, p.y);
      }, () => setPos(sent.x, sent.y));
    } else if (path === "/api/treasure-world/dig" && dig) {
      const d = dig;
      res.clone().json().then((r) => {
        if (res.ok) d.result = r;
        else d.error = r?.error ?? `HTTP ${res.status}`;
      }, () => (d.error = `HTTP ${res.status}`));
    } else if (path === "/api/treasure-world" && method === "GET" && res.ok) {
      res.clone().json().then(onBoard, () => {});
    }
    return res;
  };

  function setPos(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    pos.x = x;
    pos.y = y;
    pos.at = performance.now();
  }

  function onBoard(b) {
    if (!b?.me) return;
    board = b;
    // Before the map is in, boot reads the tide from its own board.
    if (islands) noticeTide(b.hermits?.lastTide);
    if (status === "running" && b.me.mode !== "ashore") {
      stop(b.me.mode === "sailing" ? "you're back aboard" : "you left the world");
    }
    render();
  }

  // --- keys ----------------------------------------------------------------------

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
    for (const k of want) {
      if (!held.has(k)) {
        held.add(k);
        keyEvent("keydown", k);
      }
    }
  }

  const releaseAll = () => hold(new Set());

  function keysFor(dx, dy) {
    const want = new Set();
    if (dx > 0) want.add("ArrowRight");
    if (dx < 0) want.add("ArrowLeft");
    if (dy > 0) want.add("ArrowDown");
    if (dy < 0) want.add("ArrowUp");
    return want;
  }

  function onUserKey(e) {
    if (!e.isTrusted) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    stopAlarm();
    if (status === "running" && USER_KEYS.has(e.key)) pause("you took over");
  }
  window.addEventListener("keydown", onUserKey, true);
  window.addEventListener("focus", stopAlarm);

  // --- walking -------------------------------------------------------------------

  /** Wait for the page's next position report after `since`, or `ms`: none comes when nothing moved. */
  async function settled(since, ms = 1200) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (pos.at > since) return true;
      await sleep(40);
    }
    return false;
  }

  /** One straight leg towards `target`'s centre. True when the figure moved. */
  async function walkLeg(target) {
    const c = centre(target);
    const from = { x: pos.x, y: pos.y };
    for (const part of legKeys(pos.x, pos.y, c.x, c.y, cfg.footSpeed)) {
      if (status !== "running") break;
      hold(keysFor(part.dx, part.dy));
      await sleep(part.ms);
    }
    releaseAll();
    await settled(performance.now());
    return Math.hypot(pos.x - from.x, pos.y - from.y) > 2;
  }

  /** The tiles still worth a dig: undug, or holding a find we can now carry. */
  function targets() {
    const tankFull = !!board?.hermits?.tank;
    const crateFull = board ? board.hermits.shellCrateFree >= cfg.hermits.shellCrateSize : false;
    const out = new Set();
    for (const i of line) {
      const left = memory.left.get(i);
      if (left === "hermit" ? !tankFull : left === "shell" ? !crateFull : !memory.dug.has(i)) out.add(i);
    }
    return out;
  }

  // --- digging -------------------------------------------------------------------

  const findButton = (test) => [...document.querySelectorAll("button")].find((b) => test(b.textContent.trim()));

  /** Press F where the figure stands and see the dig through, find dialog and all. */
  async function digHere(tile) {
    dig = null;
    keyEvent("keydown", "f");
    keyEvent("keyup", "f");
    const end = performance.now() + 6000;
    while (performance.now() < end && !(dig && (dig.result || dig.error))) await sleep(50);
    if (!dig) return { error: "the dig key did nothing" };
    if (dig.error) return { error: dig.error };
    const r = dig.result;
    const where = dig.tile ?? tile;
    tally.digs++;
    tally.chests += r.found.length;
    tally.coins += r.totalCoins;
    memory.left.delete(where);
    memory.dug.add(where);
    for (const f of r.finds) {
      if (f.kind === "shell") tally.shells++;
      else tally.hermits++;
    }
    if (r.hermitEscaped) memory.left.set(where, "hermit");
    else if (r.shellLeft) memory.left.set(where, "shell");
    saveMemory();
    if (board) {
      board.me.water = r.water;
      const shells = r.finds.filter((f) => f.kind === "shell").length;
      board.hermits.shellCrateFree += shells;
      if (r.shellLeft) board.hermits.shellCrateFree = Math.max(board.hermits.shellCrateFree, cfg.hermits.shellCrateSize);
      if (r.finds.some((f) => f.kind === "hermit")) {
        board.hermits.tank = { shell: null, expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString() };
        alarm("🦀 A hermit!", "It's in your holding tank: 2 hours to get it to the Hatchery.");
      }
    }
    // Anything worth stopping for opens the find dialog: brush the sand off and close it.
    const dialog = r.found.length || r.mapsDestroyed.length || r.finds.length || r.hermitEscaped || r.shellLeft;
    if (dialog) {
      const end2 = performance.now() + 8000;
      while (performance.now() < end2) {
        await sleep(150);
        findButton((t) => t === "Skip the brushing")?.click();
        const keep = findButton((t) => t.endsWith("Keep digging"));
        if (keep && !keep.disabled) {
          keep.click();
          break;
        }
      }
      await sleep(300);
    }
    return { result: r };
  }

  // --- the loop ------------------------------------------------------------------

  let looping = false;

  async function loop() {
    if (looping) return;
    looping = true;
    let stuck = 0;
    try {
      while (status === "running") {
        if (board && board.me.water <= 0) {
          stop("out of water, sail home to re-provision");
          break;
        }
        const want = targets();
        if (!want.size) {
          finish();
          break;
        }
        const here = tileOf(pos.x, pos.y);
        if (want.has(here)) {
          const c = centre(here);
          // Close enough to the middle that the page's own report lands on this tile.
          if (Math.hypot(pos.x - c.x, pos.y - c.y) > cfg.tile * 0.3) await walkLeg(here);
          if (status !== "running") break;
          const { error } = await digHere(here);
          // A refused dig spends nothing: try the tile again, recentred, and give up after three.
          if (error === "out_of_water" && board) board.me.water = 0;
          else if (error && ++stuck >= 3) stop(`the dig failed: ${error}`);
          else if (!error) stuck = 0;
          render();
          continue;
        }
        const path = pathToNearest(cfg, map, here, want);
        if (!path) {
          for (const i of want) memory.dug.add(i);
          note = "some of the tide line can't be walked to";
          continue;
        }
        const moved = await walkLeg(legEnd(cfg, here, path));
        if (moved) stuck = 0;
        else if (++stuck >= 4) {
          // Walked into something the map doesn't show (another pirate, a duel): leave it.
          stop("the figure won't move");
        }
        render();
      }
    } finally {
      releaseAll();
      looping = false;
      render();
    }
  }

  function start() {
    if (!cfg || status === "running") return;
    if (board?.me.mode !== "ashore") {
      status = "paused";
      note = "go ashore on an island first";
      return render();
    }
    if (!placeIsland()) return render();
    status = "running";
    note = "";
    stopAlarm();
    render();
    void loop();
  }

  /** Which island the figure stands on, and its tide line. False, with a note, when there is none to dig. */
  function placeIsland() {
    const here = tileOf(pos.x, pos.y);
    const id = islands[here];
    const isl = cfg.islands.find((i) => i.id === id);
    if (!isl || id === cfg.homeIslandId) {
      status = "paused";
      note = id === cfg.homeIslandId ? "the harbour has no tide line, sail to another island" : "not on an island";
      return false;
    }
    islandId = id;
    islandName = isl.name ?? `island ${id}`;
    line = tideLine(cfg, map, islands, id);
    return true;
  }

  function pause(why) {
    status = "paused";
    note = why;
    releaseAll();
    render();
  }

  function stop(why) {
    status = "stopped";
    note = why;
    releaseAll();
    render();
  }

  function finish() {
    const found = [tally.shells && `${tally.shells} 🐚`, tally.hermits && `${tally.hermits} 🦀`].filter(Boolean).join(" ");
    const waiting = line.filter((i) => memory.left.has(i)).length;
    stop(`${islandName}'s tide line is dug${found ? `: ${found}` : ", nothing in it"}${waiting ? ` · ${waiting} left in the sand` : ""}`);
    alarm("🐚 Tide line dug", note, false);
  }

  // --- alarm -------------------------------------------------------------------

  let audio = null;
  let blinkTimer = null;
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

  /** Flash the tab title until you're back, and raise a desktop notification; `loud` beeps too. */
  function alarm(title, body, loud = true) {
    stopAlarm();
    savedTitle = document.title;
    let on = false;
    blinkTimer = setInterval(() => {
      on = !on;
      document.title = on ? title : savedTitle;
    }, 600);
    if (loud) beep();
    if ("Notification" in window && Notification.permission === "granted") {
      notification = new Notification(title, { body, tag: "tide-digger" });
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

  // Top right: the bottom left is the Coast Bot's, and the HUD's buttons are above it.
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:28px;top:96px;z-index:2147483647;display:flex;gap:8px;align-items:center;" +
    "padding:8px 10px;border-radius:8px;background:#3a2a14;color:#fbeed2;" +
    "font:12px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)";
  const label = document.createElement("span");
  const btn = (text, title, onClick) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.title = title;
    b.style.cssText =
      "font:inherit;padding:2px 8px;border-radius:5px;border:1px solid #8f6b3a;background:#5a3f1c;color:inherit;cursor:pointer";
    b.addEventListener("click", () => {
      b.blur(); // a focused button would take the game's keys
      onClick();
    });
    return b;
  };
  const goBtn = btn("Start", "Start or pause the tide digger", () => {
    audio ??= new AudioContext();
    void audio.resume();
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    if (status === "running") pause("");
    else start();
  });
  const closeBtn = btn("×", "Remove the tide digger", () => window.__tideDigger.destroy());
  panel.append("🦀", label, goBtn, closeBtn);
  document.body.append(panel);

  function render() {
    goBtn.textContent = status === "running" ? "Pause" : "Start";
    goBtn.disabled = status === "loading";
    const water = board ? ` · 💧 ${board.me.water}` : "";
    const found = [tally.shells && `🐚 ${tally.shells}`, tally.hermits && `🦀 ${tally.hermits}`].filter(Boolean).join(" ");
    let text;
    if (status === "running") {
      const dug = line.filter((i) => memory.dug.has(i)).length;
      text = `${islandName} · dug ${dug} of ${line.length}${water}${found ? ` · ${found}` : ""}`;
    } else {
      text = `${status}${note ? `: ${note}` : ""}${status === "ready" ? water : ""}`;
    }
    if (board?.hermits?.tank && status !== "loading") {
      const left = Math.max(0, Math.round((Date.parse(board.hermits.tank.expiresAt) - Date.now()) / 60000));
      text += ` · tank: ${Math.floor(left / 60)}h${String(left % 60).padStart(2, "0")} to the Hatchery`;
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
      islands = islandMap(cfg, map);
      loadMemory();
      setPos(b.me.footX, b.me.footY);
      onBoard(b);
      status = "ready";
      if (b.me.mode !== "ashore") note = "go ashore on an island, then Start";
      else if (placeIsland()) {
        status = "ready";
        const left = targets().size;
        note = `${islandName} · ${left} of ${line.length} tide-line tiles to dig`;
      }
    } catch (err) {
      status = "stopped";
      note = String(err.message ?? err);
    }
    render();
  })();
  render();
  const timer = setInterval(render, 1000);

  window.__tideDigger = {
    start,
    pause: () => pause(""),
    /** Forget today's dug tiles. */
    forget() {
      memory = { day: today(), tideAt: memory.tideAt, dug: new Set(), left: new Map() };
      saveMemory();
      render();
    },
    destroy() {
      status = "stopped";
      clearInterval(timer);
      releaseAll();
      stopAlarm();
      window.removeEventListener("keydown", onUserKey, true);
      window.removeEventListener("focus", stopAlarm);
      if (window.fetch !== origFetch) window.fetch = origFetch;
      panel.remove();
      delete window.__tideDigger;
    },
  };
})();
