/** Turning a critter board into lines of text. Shared by the one-shot printer
 * and the live dashboard, so both always say the same thing. */

import { bold, cyan, dim, green, red, yellow } from "../../term/ansi.mjs";
import { num, relative } from "../../units.mjs";

const MOOD_ICON = {
  happy: "😊",
  hungry: "🍽️",
  dirty: "🫧",
  sick: "🤒",
  dead: "💀",
};

const PHASE_LABEL = { egg: "🥚 Egg", growing: "🐣 Growing", adult: "🐟 Adult" };

/** Mirrors HATCH_CLICKS_REQUIRED in backend/src/lib/critters.ts — display only
 * (the API reports the taps landed, not the target). */
const HATCH_CLICKS_REQUIRED = 3;

/** "cat-shark" → "Cat Shark". The API gives no display name, and mirroring the
 * catalog here would be a second copy to keep in sync. */
function kindLabel(kind) {
  return String(kind)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Compact "2d 4h" / "3h 10m" / "12m" until a future instant ("now" if past). */
function until(iso) {
  return relative(Date.parse(iso) - Date.now());
}

function bar(pct) {
  const width = 12;
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  const glyph = "█".repeat(filled) + "░".repeat(width - filled);
  const paint = pct >= 60 ? green : pct >= 30 ? yellow : red;
  return paint(glyph);
}

/** Widest label ("Humidity"), so the bars line up down the board whatever phase
 * each critter is in. */
const METER_LABEL_W = 8;

/**
 * Both care meters on one line. They're read as a pair — "is it fed *and*
 * clean?" — and a line each cost a whole extra row per critter, which is real
 * scrolling once a board is a full ten slots.
 */
function meterPair(labelA, valA, labelB, valB) {
  const cell = (label, pct) =>
    `${label.padEnd(METER_LABEL_W)} ${bar(pct)} ${String(pct).padStart(3)}%`;
  return `   ${cell(labelA, valA)}${dim("  ·  ")}${cell(labelB, valB)}`;
}

/**
 * What the keeper should actually do about this critter, in priority order.
 * Meters are "how much life is left" (100 = just tended, 0 = death), so a low
 * number is the alarm.
 *
 * Returns tagged entries rather than pre-painted strings so the summary line can
 * classify them without sniffing the rendered text for an emoji.
 */
function advice(critter) {
  if (!critter.alive) return [];
  const egg = critter.phase === "egg";
  const feedWord = egg ? "Warm it" : "Feed it";
  const cleanWord = egg ? "Mist it" : "Clean the tank";
  const out = [];

  if (critter.mood === "sick") {
    out.push({
      level: "urgent",
      text: `⚠ Sick — tend it NOW to save it, but today's coins are already forfeit.`,
    });
  }
  if (critter.hunger <= 40) {
    out.push({
      level: critter.hunger <= 20 ? "urgent" : "warn",
      text: `⚠ ${feedWord}.`,
    });
  }
  if (critter.cleanliness <= 40) {
    out.push({
      level: critter.cleanliness <= 20 ? "urgent" : "warn",
      text: `⚠ ${cleanWord}.`,
    });
  }
  if (egg && critter.ready) {
    // Not an alarm: a ready egg can't spoil. Still worth surfacing — nothing
    // happens until you go and tap it.
    out.push({
      level: "ready",
      text: `✨ Ready to hatch — ${critter.hatchClicks}/${HATCH_CLICKS_REQUIRED} taps done, go crack it open.`,
    });
  }
  if (!critter.paidToday && out.length === 0) {
    out.push({
      level: "info",
      text: `· Not yet paid today — feed + clean to collect.`,
    });
  }
  return out;
}

const ADVICE_PAINT = { urgent: red, warn: yellow, ready: cyan, info: dim };

export function renderCritter(critter) {
  const lines = [];
  const title = critter.name
    ? `${bold(critter.name)} ${dim(`— ${kindLabel(critter.kind)}`)}`
    : bold(kindLabel(critter.kind));

  if (!critter.alive) {
    lines.push(
      `${MOOD_ICON.dead} ${title} ${dim(`(tier ${critter.tier})`)}`,
      dim(
        `   Died ${critter.diedAt ? new Date(critter.diedAt).toLocaleString() : "—"}` +
          ` · lived ${critter.daysAlive}d · earned ${num(critter.totalEarned)} 🪙`,
      ),
    );
    return lines;
  }

  const phase = PHASE_LABEL[critter.phase] ?? critter.phase;
  const mood = `${MOOD_ICON[critter.mood] ?? ""} ${critter.mood}`;

  // Lifecycle countdown — an egg is waiting to hatch, a baby to finish growing;
  // an adult has nothing left to wait for. It rides on the status line rather
  // than taking a row of its own. A *ready* egg gets nothing here: its "✨ Ready
  // to hatch" advice line below already says so, louder.
  let countdown = null;
  if (critter.phase === "egg" && !critter.ready) {
    countdown = `hatches in ~${until(critter.hatchAt)}`;
  } else if (critter.phase === "growing") {
    countdown = `full grown in ~${until(critter.fullGrownAt)} (${Math.round(critter.growth * 100)}% size)`;
  }

  lines.push(
    `${title} ${dim(`(tier ${critter.tier} · ${critter.variantId})`)}`,
    `   ${phase} · ${critter.mood === "happy" ? green(mood) : yellow(mood)}` +
      ` · ${dim(`${critter.daysAlive}d old`)}` +
      (countdown ? ` · ${dim(countdown)}` : ""),
  );

  const egg = critter.phase === "egg";
  lines.push(
    egg
      ? meterPair("Warmth", critter.hunger, "Humidity", critter.cleanliness)
      : meterPair("Hunger", critter.hunger, "Tank", critter.cleanliness),
  );

  // The egg phase pays a reduced fraction of the tier rate; the exact fraction
  // is a backend constant, so say "reduced" rather than mirror a tunable number.
  const rate = egg
    ? `${critter.coinsPerDay} 🪙/day (reduced while an egg)`
    : `${critter.coinsPerDay} 🪙/day`;
  lines.push(
    dim(
      `   ${rate} · ${critter.paidToday ? "paid today ✓" : "not paid today"}` +
        ` · earned ${num(critter.totalEarned)} 🪙 so far`,
    ),
  );

  if (critter.sittingUntil && Date.parse(critter.sittingUntil) > Date.now()) {
    lines.push(
      cyan(`   🛟 With the sitter for another ${until(critter.sittingUntil)}`),
    );
  }

  for (const item of advice(critter)) {
    lines.push(`   ${(ADVICE_PAINT[item.level] ?? dim)(item.text)}`);
  }
  return lines;
}

/** Split a board into the two groups every view shows separately. */
export function partition(board) {
  return {
    alive: board.critters.filter((x) => x.alive),
    memorials: board.critters.filter((x) => !x.alive),
  };
}

/** How many critters want action, and how many eggs are sitting ready. */
export function summarize(alive) {
  const notes = alive.map(advice);
  return {
    needy: notes.filter((n) =>
      n.some((i) => i.level === "urgent" || i.level === "warn"),
    ).length,
    ready: notes.filter((n) => n.some((i) => i.level === "ready")).length,
  };
}

function summaryLines({ needy, ready }) {
  const out = [
    needy > 0
      ? yellow(
          `${needy} critter${needy === 1 ? "" : "s"} need${needy === 1 ? "s" : ""} attention.`,
        )
      : green("All critters are content."),
  ];
  if (ready > 0) {
    out.push(
      cyan(`${ready} egg${ready === 1 ? " is" : "s are"} ready to hatch.`),
    );
  }
  return out;
}

/** Lifetime coins earned by the critters currently occupying an active slot.
 * Deliberately excludes memorials — this is what your *current* board has
 * brought in, not the all-time total including the departed. */
export function sumEarned(alive) {
  return alive.reduce((total, c) => total + (c.totalEarned ?? 0), 0);
}

export function slotLine(board, aliveCount) {
  return (
    `Active slots: ${aliveCount}/${board.activeSlots} in use` +
    ` (cap ${board.activeSlotCap}` +
    (board.nextActiveSlotPrice != null
      ? `, next slot ${num(board.nextActiveSlotPrice)} 🪙)`
      : `, maxed)`)
  );
}

/** The one-shot / log-friendly rendering: everything, top to bottom. */
export function renderReport(user, board) {
  const { alive, memorials } = partition(board);
  const out = [
    `${bold("🧜 Hatchery")} ${dim(`— ${new Date().toLocaleString()}`)}`,
    `${user.name} ${dim(`(${user.username})`)} · ${num(user.coinBalance)} 🪙` +
      dim(` · critters earned ${num(sumEarned(alive))} 🪙`),
    dim(slotLine(board, alive.length)),
    "",
  ];

  if (alive.length === 0) {
    out.push(dim("No living critters — the Hatchery is quiet."), "");
  }
  for (const critter of alive) out.push(...renderCritter(critter), "");
  if (memorials.length > 0) {
    out.push(dim("In memoriam"));
    for (const critter of memorials) out.push(...renderCritter(critter), "");
  }

  out.push(...summaryLines(summarize(alive)));
  return out.join("\n");
}
