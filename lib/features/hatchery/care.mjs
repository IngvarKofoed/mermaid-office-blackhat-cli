/**
 * Doing the chores — the one part of this tool that writes.
 *
 * Feed and Clean are the same two endpoints in every phase; on an egg they read
 * as Warm and Mist. Both simply reset a care clock, so repeating them is
 * harmless, and the daily payout is guarded server-side by a once-a-day marker
 * that a second chore can't collect twice.
 */

import { cyan, dim, green, red, yellow } from "../../term/ansi.mjs";
import { num } from "../../units.mjs";

/**
 * Tend anything whose meters have dropped below this, even when the day is
 * already paid — purely to keep the clocks topped up.
 *
 * Read it as "the worst state the script may leave a critter in", because that
 * is what it decides: whenever this stops running — laptop shut, server down,
 * you forgot — a critter is somewhere above this line and has to survive on
 * that alone. A meter is the fraction of the way to death, so the margin it
 * buys is `floor × the clock's death horizon`, and the tightest clock wins:
 *
 *     floor   adult hunger (72h)   adult tank (48h)   egg (worst case, 36h)
 *      50%          36h                  24h                  18h
 *      80%          58h                  38h                  29h
 *
 * At 80% even the tightest case survives an overnight gap with room to spare,
 * and a full day of downtime doesn't kill anything. (Those are *effective*
 * hours — weekends don't count against either clock, so a weekend outage is
 * cheaper still.)
 *
 * It is a percentage rather than an "hours of margin" rule because the death
 * horizons live server-side and differ per clock and per phase; a percentage
 * needs no mirrored constants to stay correct.
 *
 * The cost of raising it is only more frequent top-ups — a critter crosses 80%
 * every ~7–10 effective hours, so a few rounds a day instead of one. There is
 * no penalty for tending early.
 */
export const CARE_FLOOR = 80;

/**
 * Is there anything to gain from tending this critter right now? Two reasons:
 * it hasn't been paid today (chores collect the daily coins), or it isn't in
 * good shape (chores keep it alive). If it's paid and healthy, doing the chores
 * again would achieve nothing but traffic.
 */
export function needsCare(critter) {
  if (!critter.alive) return false;
  // With the sitter, both clocks are frozen and the server refuses chores.
  if (critter.sittingUntil && Date.parse(critter.sittingUntil) > Date.now()) {
    return false;
  }
  if (!critter.paidToday) return true;
  if (critter.mood !== "happy") return true;
  return Math.min(critter.hunger, critter.cleanliness) < CARE_FLOOR;
}

/** Phase-appropriate names for the two chores. */
function choreWord(chore, phase) {
  if (phase === "egg") return chore === "feed" ? "warmed" : "misted";
  return chore === "feed" ? "fed" : "cleaned";
}

const ERROR_TEXT = {
  dead: "it died before the chores landed",
  sitting: "it's with the sitter",
  no_critter: "no longer on your board",
};

/**
 * Do both chores for every critter that wants them. Sequential on purpose: the
 * two chores race on the same daily-payout marker, and the pod is small enough
 * that a burst of parallel writes buys nothing.
 *
 * Never throws — one critter's failure is recorded against that critter and the
 * rest are still tended, because a half-done round is the worst outcome here.
 */
export async function careForAll(api, board) {
  const results = [];
  for (const critter of board.critters.filter(needsCare)) {
    const entry = {
      id: critter.id,
      name: critter.name || critter.kind,
      phase: critter.phase,
      wasSick: critter.mood === "sick",
      done: [],
      coins: 0,
      forfeited: false,
      error: null,
    };
    for (const chore of ["feed", "clean"]) {
      try {
        const res = await api.post(`/api/critter/${chore}`, {
          critterId: critter.id,
        });
        entry.done.push(choreWord(chore, critter.phase));
        entry.coins += res?.coinsEarned ?? 0;
        if (res?.forfeited) entry.forfeited = true;
      } catch (err) {
        // dead / sitting / gone all apply to the critter, not the chore, so the
        // second chore would fail identically — stop on this one.
        entry.error = ERROR_TEXT[err.code] ?? err.message;
        break;
      }
    }
    results.push(entry);
  }
  return results;
}

/** Totals for a one-line "what just happened". */
export function summarizeCare(results) {
  return {
    tended: results.filter((r) => r.done.length > 0).length,
    coins: results.reduce((sum, r) => sum + r.coins, 0),
    forfeited: results.filter((r) => r.forfeited).length,
    failed: results.filter((r) => r.error).length,
  };
}

/** Compact one-liner for the dashboard header. */
export function careHeadline(results) {
  if (results.length === 0) return null;
  const { tended, coins, forfeited, failed } = summarizeCare(results);
  const bits = [`cared ${tended}`];
  if (coins > 0) bits.push(`+${num(coins)} 🪙`);
  if (forfeited > 0) bits.push(`${forfeited} forfeited`);
  if (failed > 0) bits.push(`${failed} failed`);
  return bits.join(" ");
}

/** Full report for the one-shot / plain-watch printer. */
export function careLines(results) {
  if (results.length === 0) return [dim("Nothing needed doing — all tended.")];

  const lines = [];
  for (const r of results) {
    if (r.error) {
      lines.push(`${red("✗")} ${r.name} — ${r.error}`);
      continue;
    }
    const what = r.done.join(" + ");
    let tail = "";
    if (r.forfeited) {
      tail = yellow(" · saved from sickness, but today's coins are forfeit");
    } else if (r.coins > 0) {
      tail = green(` · +${num(r.coins)} 🪙`);
    } else {
      tail = dim(" · already paid today");
    }
    lines.push(`${cyan("✓")} ${r.name} — ${what}${tail}`);
  }

  const { tended, coins } = summarizeCare(results);
  lines.push(
    dim(
      `Tended ${tended} critter${tended === 1 ? "" : "s"}` +
        (coins > 0 ? ` · earned ${num(coins)} 🪙` : ""),
    ),
  );
  return lines;
}
