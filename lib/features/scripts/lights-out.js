/*
 * Lights Out wall hack: marks the bilge's two eggs through the dark — the Evil
 * Sea Urchin egg and the Evil Anglerfish egg — whether or not your lantern is on
 * them, and whether or not they are glowing.
 *
 * Use: paste this into the DevTools console on any Mermaid Office page, then go
 * down into the bilge as usual (pasting mid-run works too). Each egg gets a ring
 * and a label on top of the game's own picture. Put the lantern on the ring and
 * press: click the anglerfish egg, hold the urchin egg (letting go early stings).
 * `blackhat scripts lights-out` puts it on the clipboard for you.
 *
 * - The server never says what a light is, but the paths do: the urchin egg is
 *   the only light that never moves, and the anglerfish egg is the only soft
 *   light drifting with the current (lures drift against it, shards twinkle).
 * - It reads the scene the game already holds, off the page, every frame. It
 *   sends nothing and makes no requests.
 * - Most runs hold no egg at all; the label in the corner says so at once.
 * - The rings never block a click: they sit on a layer the mouse passes through.
 * - Pasting it again replaces the previous copy; × in the panel removes it.
 */
(() => {
  "use strict";

  //#region core — pure, no DOM, so it also runs under Node for testing

  /** Whether a path never moves. Only the urchin egg's doesn't. */
  const isStationary = (path) => path.every((k) => k.x === path[0].x && k.y === path[0].y);

  /** Soft lights (lures, eggs) go fully dark between glows; a shard never does. */
  const isSoft = (glow) => glow.levels.includes(0);

  /**
   * Which egg a light is, "urchin" or "anglerfish", or null for a shard or a lure.
   * `current` is the config's unit vector: the anglerfish egg drifts with it,
   * every lure against it.
   */
  function eggKind(light, current) {
    const { path, glow } = light;
    if (isStationary(path)) return "urchin";
    if (!isSoft(glow)) return null;
    const a = path[0];
    const b = path[path.length - 1];
    return (b.x - a.x) * current.x + (b.y - a.y) * current.y > 0 ? "anglerfish" : null;
  }

  /** The scene's eggs, as `{ id, kind, path }`. */
  function findEggs(lights, current) {
    const eggs = [];
    for (const light of lights) {
      const kind = eggKind(light, current);
      if (kind) eggs.push({ id: light.id, kind, path: light.path });
    }
    return eggs;
  }

  /** A light's position at run time `t`, linear between keyframes, or null off its path. The game's own rule. */
  function positionAt(path, t) {
    if (t < path[0].t || t > path[path.length - 1].t) return null;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (t <= b.t) {
        const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    const last = path[path.length - 1];
    return { x: last.x, y: last.y };
  }

  //#endregion core

  window.__lightsOut?.destroy();

  /** The dive's canvas is labelled this way; the help card's demo isn't. */
  const SCENE = 'canvas[aria-label^="The flooded bilge"]';
  const LOOK = {
    urchin: { color: "125, 255, 176", name: "urchin egg" },
    anglerfish: { color: "255, 125, 233", name: "anglerfish egg" },
  };

  let raf = 0;
  /** The dive we're drawn over: its canvas, its props, our layer, its eggs. */
  let game = null;

  // --- reading the game ----------------------------------------------------------

  /**
   * The bilge canvas's own props, found through React's bookkeeping on the
   * canvas node. `liveRef` is what the game plays every frame: the run clock,
   * the lights and the shards already taken.
   */
  function sceneProps(canvas) {
    const key = Object.keys(canvas).find((k) => k.startsWith("__reactFiber$"));
    let fiber = key ? canvas[key] : null;
    for (let i = 0; fiber && i < 12; i++, fiber = fiber.return) {
      const p = fiber.memoizedProps;
      if (p?.liveRef?.current && p.config?.bilge) return p;
    }
    return null;
  }

  function attach(canvas) {
    const overlay = document.createElement("canvas");
    overlay.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    // Inside the dialog, beside the game's canvas: the bilge is a modal <dialog>
    // in the browser's top layer, so nothing outside it can be drawn on top.
    canvas.after(overlay);
    return { canvas, props: sceneProps(canvas), overlay, ctx: overlay.getContext("2d"), lights: null, eggs: [] };
  }

  function detach() {
    game?.overlay.remove();
    game = null;
  }

  // --- drawing -------------------------------------------------------------------

  function frame() {
    raf = requestAnimationFrame(frame);
    const canvas = document.querySelector(SCENE);
    if (game && game.canvas !== canvas) detach();
    if (!canvas) return setStatus("waiting for a lantern");
    game ??= attach(canvas);
    if (!game.props) return setStatus("can't read the bilge, the site has changed");
    draw(game);
  }

  function draw(g) {
    const { canvas, overlay, ctx } = g;
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
    }
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const live = g.props.liveRef.current;
    const cfg = g.props.config;
    const t = live.clock(performance.now());
    // No run playing: the egg card, or the way a run ended.
    if (t === null) return setStatus("in the bilge");
    if (live.lights !== g.lights) {
      g.lights = live.lights;
      g.eggs = findEggs(live.lights, cfg.current);
    }

    const s = overlay.width / cfg.bilge.width;
    const px = overlay.width / Math.max(1, canvas.clientWidth);
    const notes = [];
    for (const egg of g.eggs) {
      if (live.taken.has(egg.id)) continue;
      const look = LOOK[egg.kind];
      const first = egg.path[0];
      const last = egg.path[egg.path.length - 1];
      if (t < first.t) {
        const wait = Math.ceil((first.t - t) / 1000);
        notes.push(`${look.name} in ${wait} s`);
        ring(ctx, first.x * s, first.y * s, px, look.color, `${look.name} in ${wait} s`, true);
      } else if (t > last.t) {
        notes.push(`${look.name} drifted off`);
      } else {
        const pos = positionAt(egg.path, t);
        const how = egg.kind === "urchin" ? `hold ${cfg.pryMs / 1000} s` : "click";
        notes.push(`${look.name} · ${how}`);
        ring(ctx, pos.x * s, pos.y * s, px, look.color, `${look.name} · ${how}`, false);
      }
    }
    const text = notes.length ? notes.join(" · ") : "no egg this run";
    corner(ctx, overlay.width, px, text);
    setStatus(text);
  }

  /** A pulsing ring with a dot at the exact centre, and its label above. */
  function ring(ctx, x, y, px, rgb, label, ghost) {
    const r = 14 * px;
    const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 160);
    ctx.save();
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = `rgba(${rgb}, ${ghost ? 0.45 : pulse})`;
    if (ghost) ctx.setLineDash([4 * px, 4 * px]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(${rgb}, ${ghost ? 0.45 : 1})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 ${12 * px}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.setLineDash([]);
    ctx.strokeText(label, x, y - r - 4 * px);
    ctx.fillText(label, x, y - r - 4 * px);
    ctx.restore();
  }

  /** What this run holds, top right. Top left is where the game's "?" tells go. */
  function corner(ctx, width, px, text) {
    const label = `🏮 ${text}`;
    ctx.save();
    ctx.font = `${12 * px}px system-ui, sans-serif`;
    const w = ctx.measureText(label).width + 16 * px;
    const h = 22 * px;
    const x = width - w - 8 * px;
    const y = 8 * px;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#f3e6c8";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 8 * px, y + h / 2);
    ctx.restore();
  }

  // --- panel -------------------------------------------------------------------

  // Out here it only shows while the bilge is shut: once the dialog opens, the
  // page behind it (this included) sits under its backdrop.
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:8px;align-items:center;" +
    "padding:8px 10px;border-radius:8px;background:#1d140c;color:#f3e6c8;" +
    "font:12px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)";
  const label = document.createElement("span");
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.title = "Remove the Lights Out wall hack";
  closeBtn.style.cssText =
    "font:inherit;padding:2px 8px;border-radius:5px;border:1px solid #8a6a3d;background:#3a2815;color:inherit;cursor:pointer";
  closeBtn.addEventListener("click", () => window.__lightsOut.destroy());
  panel.append("🏮", label, closeBtn);
  document.body.append(panel);

  function setStatus(text) {
    if (label.textContent !== text) label.textContent = text;
  }

  // --- boot ----------------------------------------------------------------------

  raf = requestAnimationFrame(frame);

  window.__lightsOut = {
    destroy() {
      cancelAnimationFrame(raf);
      detach();
      panel.remove();
      delete window.__lightsOut;
    },
  };
})();
