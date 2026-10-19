/*
 * Live Wire Plinko bot: plays all of today's batteries in The Brig. It buys a
 * battery, drops every spark from the chute with the best odds of the Eelectra
 * egg, closes the board when the sparks run out and buys the next, until the
 * day's batteries are gone — or an egg comes up, which it keeps.
 *
 * Use: in The Brig (/rooms/prison), paste this into the DevTools console and
 * click Start in the ⚡ panel at the bottom left. Each battery costs 2,000
 * coins; the panel says how many are left today before you start.
 * `blackhat scripts plinko-bot` puts it on the clipboard for you.
 *
 * - "Best" is worked out, not guessed. The board, the drain and the battery's
 *   flags are all public, so it solves the whole battery against the dice —
 *   every chute, every bucket, every spark left — and drops from the chute that
 *   gives the egg the best chance from here. That is often beside the drain
 *   rather than over it, away from a fuse and towards a recharge; with the Lid
 *   on it goes after sparks. Over the server's own rules that finds the egg in
 *   about 1 battery in 21, where aiming at the drain manages 1 in 24.5.
 * - It plays with the board's own controls (the chute keys and the Drop
 *   button), and reads the battery from the game's own answers. Pasting it costs
 *   one fetch.
 * - Touching the page yourself pauses it. Start hands back.
 * - Keep the window visible: the board only lands a spark once it has drawn it
 *   falling, and it draws only while the page is visible.
 * - Pasting it again replaces the previous copy; × in the panel removes it.
 */
(() => {
  "use strict";

  //#region core — pure, no DOM, so it also runs under Node for testing

  // The server's dice, mirrored from its catalog/brig-plinko.ts — they aren't on
  // the wire. If they drift the odds below drift a little; the drop itself is
  // always the server's.
  const BUCKETS = 9;
  const ROWS = 8;
  const MAX_LANE = 2 * (BUCKETS - 1);
  const KICK_CHANCE = 0.11;
  const MAX_KICKS = 2;
  const KICK_UP_SHARE = 0.25;
  const CATCH_CHANCE = 0.025;
  /** Sparks beyond this are planned as this many. A battery starts with 10. */
  const MAX_SPARKS = 30;

  const kickLane = (L, d) => (L + d < 0 || L + d > MAX_LANE ? L - d : L + d);

  /**
   * odds[c][b]: the chance a spark from chute c lands in bucket b, kicks and
   * all. Exact, over the server's path rules: a stray may kick it at each peg
   * (sideways 2 or 4 lanes, or up a row by 1 or 3), else it bounces a lane left
   * or right to the next row.
   */
  function landingOdds() {
    const memo = new Map();
    function from(r, L, k) {
      if (r === ROWS) {
        const out = new Array(BUCKETS).fill(0);
        out[L / 2] = 1;
        return out;
      }
      const key = `${r},${L},${k}`;
      if (memo.has(key)) return memo.get(key);
      const out = new Array(BUCKETS).fill(0);
      const add = (p, r2, L2, k2) => {
        if (p <= 0) return;
        const d = from(r2, L2, k2);
        for (let b = 0; b < BUCKETS; b++) out[b] += p * d[b];
      };
      const kick = k < MAX_KICKS ? KICK_CHANCE : 0;
      const up = r > 0 ? KICK_UP_SHARE : 0;
      for (const sign of [-1, 1]) {
        add((kick / 2) * up * 0.6, r - 1, kickLane(L, sign), k + 1);
        add((kick / 2) * up * 0.4, r - 1, kickLane(L, sign * 3), k + 1);
        add((kick / 2) * (1 - up) * 0.65, r, kickLane(L, sign * 2), k + 1);
        add((kick / 2) * (1 - up) * 0.35, r, kickLane(L, sign * 4), k + 1);
      }
      if (L === 0) add(1 - kick, r + 1, 1, k);
      else if (L === MAX_LANE) add(1 - kick, r + 1, MAX_LANE - 1, k);
      else {
        add((1 - kick) / 2, r + 1, L - 1, k);
        add((1 - kick) / 2, r + 1, L + 1, k);
      }
      memo.set(key, out);
      return out;
    }
    return Array.from({ length: BUCKETS }, (_, c) => from(0, 2 * c, 0));
  }

  const STATIC = 1;
  const GREASE = 2;
  const LID = 4;

  /**
   * The best chute for every state one battery can reach, and the egg's chance
   * from each. Only Drift changes the board, by swapping the drain with a
   * neighbour, so the other eight buckets keep their order: a state is where the
   * drain is, the sparks left, and the Static / Grease / Lid flags. Solved by
   * value iteration over every chute and bucket.
   */
  function makePlanner(board, odds) {
    const others = board.filter((id) => id !== "drain");
    const at = (p, b) => (b === p ? "drain" : others[b < p ? b : b - 1]);
    const S = MAX_SPARKS + 1;
    const idx = (p, s, f) => (p * S + s) * 8 + f;
    const V = new Float64Array(BUCKETS * S * 8);
    const best = new Int8Array(BUCKETS * S * 8);
    const val = (p, s, f) => (s <= 0 ? 0 : V[idx(p, Math.min(s, MAX_SPARKS), f)]);

    /** The egg's chance after a spark from state (p, s, f) lands in bucket b. */
    function land(p, s, f, b) {
      const s1 = s - 1;
      // Static and the Lid are used up by this drop; the Grease waits for the drain.
      const g = f & GREASE;
      switch (at(p, b)) {
        case "drain":
          if (f & LID) return val(p, s1, g);
          if (g) return val(p, s1, 0);
          return CATCH_CHANCE + (1 - CATCH_CHANCE) * val(p, s1, 0);
        case "overcharge":
          return val(p, s1 + 2, g);
        case "recharge":
          return val(p, s1 + 1, g);
        case "short-circuit":
          return val(p, Math.max(0, s1 - 1), g);
        case "blown-fuse":
          return val(p, Math.max(0, s1 - 2), g);
        case "drift":
          if (p === 0) return val(1, s1, g);
          if (p === BUCKETS - 1) return val(BUCKETS - 2, s1, g);
          return (val(p - 1, s1, g) + val(p + 1, s1, g)) / 2;
        case "static":
          return val(p, s1, g | STATIC);
        case "grease":
          return val(p, s1, GREASE);
        case "lid":
          return val(p, s1, g | LID);
        default:
          return val(p, s1, g);
      }
    }

    const after = new Float64Array(BUCKETS);
    for (let sweep = 0; sweep < 1000; sweep++) {
      let delta = 0;
      for (let s = 1; s <= MAX_SPARKS; s++) {
        for (let p = 0; p < BUCKETS; p++) {
          for (let f = 0; f < 8; f++) {
            for (let b = 0; b < BUCKETS; b++) after[b] = land(p, s, f, b);
            let top = -1;
            let pick = p;
            let mean = 0;
            for (let c = 0; c < BUCKETS; c++) {
              let q = 0;
              for (let b = 0; b < BUCKETS; b++) q += odds[c][b] * after[b];
              mean += q / BUCKETS;
              if (q > top + 1e-12) {
                top = q;
                pick = c;
              }
            }
            // With Static set the spark falls from a random chute, whatever is asked.
            const v = f & STATIC ? mean : top;
            const i = idx(p, s, f);
            delta = Math.max(delta, Math.abs(v - V[i]));
            V[i] = v;
            best[i] = f & STATIC ? p : pick;
          }
        }
      }
      if (delta < 1e-12) break;
    }

    return {
      /** The chute to drop from next, and the egg's chance from here, for a battery off the wire. */
      plan(battery) {
        const p = battery.board.indexOf("drain");
        const s = Math.min(battery.sparks, MAX_SPARKS);
        const f = (battery.staticNext ? STATIC : 0) | (battery.grease ? GREASE : 0) | (battery.lid ? LID : 0);
        return { chute: best[idx(p, s, f)], chance: val(p, s, f) };
      },
    };
  }

  //#endregion core

  window.__plinkoBot?.destroy();

  const ODDS = landingOdds();
  const PEGS = 'canvas[aria-label^="The pegboard"]';
  const origFetch = window.fetch;

  // "loading" | "ready" | "running" | "paused" | "stopped"
  let status = "loading";
  let note = "";
  /** The game's own view: the battery, today's count and keep, the config. */
  let view = null;
  let planner = null;
  let plannerKey = "";
  let lastPlan = null;
  /** The drop count our last Drop click was made at, until the battery moves on. */
  let sentAt = null;
  let boughtAt = 0;
  let keepTried = false;
  let timer = null;

  // --- what the game says --------------------------------------------------------

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    const res = await origFetch.call(window, input, init);
    const m = /\/api\/prison\/plinko(?:\/(battery|drop|keep|release))?(?:[?#]|$)/.exec(url);
    if (m) res.clone().json().then((body) => onPlinko(m[1] ?? "view", res.ok, body), () => {});
    return res;
  };

  function onPlinko(kind, ok, body) {
    if (!ok) {
      // A refused drop spent nothing, and the board re-reads itself.
      if (kind === "drop") sentAt = null;
      else if (kind === "battery" && status === "running") stop(`the guard said no (${body?.error ?? "refused"})`);
      else if (kind === "keep" && status === "running") {
        stop(`couldn't keep the egg (${body?.error ?? "refused"}), it's waiting on the board`);
        alarm("🥚 Eelectra egg waiting", "The bot couldn't keep it. It lapses in 10 minutes.");
      }
      render();
      return;
    }
    if (kind === "drop") {
      if (view) view = { ...view, battery: body.battery.status === "spent" ? null : body.battery };
      if (body.outcome === "found" && status === "running") alarm("🥚 Eelectra egg!", "It came up the drain. Keeping it.");
    } else if (kind === "keep" || kind === "release") {
      view = body.plinko;
    } else {
      view = body;
      if (kind === "battery") sentAt = null;
    }
    render();
  }

  // --- playing -----------------------------------------------------------------

  const findButton = (root, test) =>
    [...root.querySelectorAll("button")].find((b) => test(b.textContent.trim()));

  function planFor(battery) {
    const key = battery.board.filter((id) => id !== "drain").join();
    if (key !== plannerKey) {
      planner = makePlanner(battery.board, ODDS);
      plannerKey = key;
    }
    lastPlan = planner.plan(battery);
    return lastPlan;
  }

  function tick() {
    placePanel();
    if (status === "running") {
      if (!/^\/rooms\/prison\/?$/.test(location.pathname)) pause("not in The Brig");
      else {
        const pegs = document.querySelector(PEGS);
        const dialog = pegs?.closest("dialog");
        if (dialog) onBoard(dialog, pegs.closest('[tabindex="0"]'));
        else offBoard();
      }
    }
    render();
  }

  /** The board is up: finish what's on it, or drop the next spark. */
  function onBoard(dialog, keys) {
    const button = (text) => findButton(dialog, (t) => t === text);
    const keep = button("Keep");
    if (keep) {
      if (!keep.disabled && !keepTried) {
        keepTried = true;
        keep.click();
      }
      return;
    }
    const done = button("Done"); // the egg is in the crate
    if (done) {
      done.click();
      return stop("🥚 Eelectra egg kept, that's today's");
    }
    const close = button("Close"); // the last spark is gone
    if (close) return close.click();

    const drop = findButton(dialog, (t) => t.startsWith("Drop from chute"));
    const battery = view?.battery;
    if (!drop || drop.disabled || battery?.status !== "open" || battery.drops === sentAt) return;
    const { chute } = planFor(battery);
    if (drop.textContent.trim() !== `Drop from chute ${chute + 1}`) {
      // The board's own chute key; the button relabels by the next tick.
      keys?.dispatchEvent(new KeyboardEvent("keydown", { key: String(chute + 1), bubbles: true, cancelable: true }));
      return;
    }
    sentAt = battery.drops;
    drop.click();
  }

  /** No board: bring a tucked-away one back, or buy the next battery. */
  function offBoard() {
    const pill = findButton(
      document.body,
      (t) => /^⚡ \d+ sparks? left$/.test(t) || t.startsWith("🥚 Your Eelectra egg is waiting"),
    );
    if (pill) return pill.click();
    // With a battery on, the board opens itself.
    if (!view || view.battery) return;
    if (view.today.keptToday) return stop("today's Eelectra egg is kept");
    if (view.today.bought >= view.today.cap) {
      stop(`all ${view.today.cap} of today's batteries played`);
      return alarm("⚡ Plinko done", `All ${view.today.cap} of today's batteries played, no egg.`, false);
    }
    if (Date.now() - boughtAt < 3000) return; // a purchase in flight
    const buy = findButton(document.body, (t) => t.startsWith("Buy a battery"));
    if (!buy) {
      // The Brig's Plinko panel is folded: unfold it.
      [...document.querySelectorAll('button[aria-expanded="false"]')]
        .find((b) => b.textContent.includes("Live Wire Plinko"))
        ?.click();
      return;
    }
    if (buy.disabled) return;
    boughtAt = Date.now();
    buy.click();
  }

  function start() {
    if (!view || status === "running") return;
    status = "running";
    note = "";
    sentAt = null;
    keepTried = false;
    stopAlarm();
    render();
  }

  function pause(why) {
    status = "paused";
    note = why;
    render();
  }

  function stop(why) {
    status = "stopped";
    note = why;
    render();
  }

  function onUser(e) {
    if (!e.isTrusted || panel.contains(e.target)) return;
    stopAlarm();
    if (status === "running") pause("you took over");
  }
  window.addEventListener("pointerdown", onUser, true);
  window.addEventListener("keydown", onUser, true);
  window.addEventListener("focus", stopAlarm);

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
      notification = new Notification(title, { body, tag: "plinko-bot" });
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

  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;gap:8px;align-items:center;" +
    "padding:8px 10px;border-radius:8px;background:#0b2a33;color:#fff6c8;" +
    "font:12px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)";
  const label = document.createElement("span");
  const btn = (text, title, onClick) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.title = title;
    b.style.cssText =
      "font:inherit;padding:2px 8px;border-radius:5px;border:1px solid #3f7f8f;background:#124452;color:inherit;cursor:pointer";
    b.addEventListener("click", () => {
      b.blur(); // a focused button would take the board's Space
      onClick();
    });
    return b;
  };
  const goBtn = btn("Start", "Start or pause the Plinko bot", () => {
    audio ??= new AudioContext();
    void audio.resume();
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    if (status === "running") pause("");
    else start();
  });
  const closeBtn = btn("×", "Remove the Plinko bot", () => window.__plinkoBot.destroy());
  panel.append("⚡", label, goBtn, closeBtn);
  document.body.append(panel);

  /**
   * Over the board while it's up. A modal <dialog> makes the rest of the page
   * inert and covers it, so out on the page the panel could be seen but not
   * clicked.
   */
  function placePanel() {
    const host = document.querySelector(PEGS)?.closest("dialog") ?? document.body;
    if (panel.parentElement !== host) host.append(panel);
  }

  function render() {
    goBtn.textContent = status === "running" ? "Pause" : "Start";
    goBtn.disabled = !view || status === "loading";
    let text;
    const today = view?.today;
    const battery = view?.battery;
    if (status === "running" && today) {
      const n = Math.min(today.bought, today.cap);
      if (battery?.status === "open" && lastPlan) {
        const chance = (lastPlan.chance * 100).toFixed(1);
        text = `battery ${n} of ${today.cap} · ${battery.sparks} sparks · chute ${lastPlan.chute + 1} · egg ${chance}%`;
      } else {
        text = `battery ${n} of ${today.cap}`;
      }
    } else if (status === "ready" && today) {
      const left = today.cap - today.bought;
      const price = view.config.price.toLocaleString();
      text = battery
        ? "a battery is live, Start finishes it"
        : today.keptToday
          ? "today's Eelectra egg is already kept"
          : left > 0
            ? `${left} of ${today.cap} batteries left today, 🪙${price} each`
            : "every battery bought today";
    } else {
      text = `${status}${note ? `: ${note}` : ""}`;
    }
    if (label.textContent !== text) label.textContent = text;
  }

  // --- boot ----------------------------------------------------------------------

  (async () => {
    try {
      const r = await origFetch("/api/prison/plinko", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!r.ok) throw new Error(`/prison/plinko → ${r.status}`);
      view = await r.json();
      status = "ready";
    } catch (err) {
      status = "stopped";
      note = String(err.message ?? err);
    }
    render();
  })();
  render();
  timer = setInterval(tick, 250);

  window.__plinkoBot = {
    start,
    pause: () => pause(""),
    destroy() {
      clearInterval(timer);
      stopAlarm();
      window.removeEventListener("pointerdown", onUser, true);
      window.removeEventListener("keydown", onUser, true);
      window.removeEventListener("focus", stopAlarm);
      if (window.fetch !== origFetch) window.fetch = origFetch;
      panel.remove();
      delete window.__plinkoBot;
    },
  };
})();
