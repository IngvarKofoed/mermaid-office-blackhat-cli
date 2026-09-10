/**
 * A batch of Bilge Brew → lines of text, plus the two pieces of judgement the
 * rest of the feature asks this module for: when holding has stopped paying,
 * and what to call the next patrol night.
 *
 * Shared by the one-shot printer and the live screen, so both always say the
 * same thing.
 *
 * NOTHING HERE MIRRORS A SERVER CONSTANT. The DC curve's base is a tuning
 * lever on the server (`BREW_BASE_DC`), and the survival odds are derived from
 * it — but both arrive on every read as `tonight.dc` and `tonight.odds`, so
 * this file can do its arithmetic on what it was told rather than on a second
 * copy of the game's numbers. The README's "staying in sync" list stays at two
 * entries.
 */

import { bold, cyan, dim, green, red, yellow } from "../../term/ansi.mjs";

/**
 * Has the batch stopped being worth holding?
 *
 * Holding *u* units through tonight is worth `odds × (u + 1)` — you either
 * gain a unit or lose the lot. Bottling now is worth exactly `u`. So the
 * moment to cash out is when the first drops below the second.
 *
 * TWO SUBTLETIES, both load-bearing.
 *
 * The comparison is STRICT, so an exact tie holds. At +2 with three units the
 * two sides are both 3, and the game's published advice at that modifier is to
 * hold for a fourth. A `<=` here would bottle a unit early for every brewer
 * with a +2, which is the single easiest thing to get wrong in this feature.
 *
 * And it compares in whole numbers. `odds` is always a whole number of
 * twentieths (the resolver clamps to 1..19 faces), so scaling both sides by 20
 * makes them integers — and the interesting cases are precisely the exact
 * ties, which is where a float comparison would be decided by rounding error
 * rather than by the rule.
 */
export function stopsPaying(batch) {
  if (!batch || batch.units <= 0) return false;
  const faces = Math.round(batch.tonight.odds * 20);
  return faces * (batch.units + 1) < 20 * batch.units;
}

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Name the weekday of a team day like "2026-09-14".
 *
 * The obvious one-liner is wrong. `new Date("2026-09-14")` is parsed as UTC
 * midnight, so `getDay()` reports the day *before* anywhere west of UTC — the
 * patrol line would say Sunday all day Monday for anyone in the Americas.
 * Splitting the string and reading it back in UTC keeps the answer the one the
 * server meant, and a static table keeps the locale out of it entirely.
 *
 * This is the only date arithmetic in the feature, and it is deliberately not
 * arithmetic: the server chose the day, this only says its name.
 */
export function weekdayOf(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ""));
  if (!m) return null;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return WEEKDAY[at.getUTCDay()] ?? null;
}

/**
 * When the guard next walks past, as a phrase.
 *
 * One helper owns all three cases because they sat in two places on the
 * website and promptly contradicted each other: a Saturday start rendered
 * "the first patrol is tonight" directly against "the guards are off". The
 * weekend therefore WINS over `isTonight` — both can be true at once, when a
 * Friday night's patrol has already advanced the marker to Saturday.
 */
export function patrolPhrase(batch) {
  if (batch.weekendPause) return "the still sleeps this weekend";
  if (batch.tonight.isTonight) return "tonight";
  const day = weekdayOf(batch.tonight.firstPatrolDay);
  return day ? `${day} night` : "the next weekday night";
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const signed = (n) => (n >= 0 ? `+${n}` : String(n));

/** The odds as the panel states them: "about 75%". */
const percent = (odds) => `about ${Math.round(odds * 100)}%`;

/**
 * The batch as four labelled rows. Returned unpainted at the left margin; the
 * caller indents.
 *
 * `forfeited` is the restart night — a batch started on a day its brewer had
 * already bottled skips its first rolling patrol. The server tells us by
 * handing back `isTonight: false` on a batch that was created moments ago, and
 * it is called out rather than left as a silently late first roll, because the
 * tool's own auto-start is what spent it.
 */
export function batchLines(batch) {
  const { units, tonight, lastPatrol } = batch;
  const label = (s) => dim(s.padEnd(8));

  const dots = units > 0 ? cyan("●".repeat(Math.min(units, 12))) : dim("·");
  const started = weekdayOf(batch.startedDay);
  const lines = [
    `${label("Batch")} ${dots}  ${bold(plural(units, "unit"))}` +
      (started ? dim(`   started ${started}`) : ""),
    `${label("Patrol")} ${patrolPhrase(batch)}` +
      dim(
        ` · DC ${tonight.dc} · Stealth ${signed(tonight.modifier)}` +
          ` · ${percent(tonight.odds)}`,
      ),
  ];

  if (!tonight.isTonight && !batch.weekendPause) {
    lines.push(`${label("")} ${dim("the guards saw the bottles go out")}`);
  }

  if (lastPatrol) {
    // Always a survival: a failed patrol deletes the row, so the pour lives
    // only in its notification and never in a batch we can still read.
    lines.push(
      `${label("Last")} ${dim(
        `rolled ${lastPatrol.roll} ${signed(lastPatrol.modifier)}` +
          ` = ${lastPatrol.total} vs DC ${lastPatrol.dc} · `,
      )}${green("survived")}`,
    );
  } else {
    lines.push(`${label("Last")} ${dim("no patrol yet")}`);
  }

  return lines;
}

/** The one line that wants an action, or null when nothing does. */
export function adviceLine(batch) {
  if (!batch) return null;
  if (stopsPaying(batch)) {
    return yellow(`⚠ holding no longer pays — bottle it`);
  }
  if (batch.units === 0) return dim("Nothing banked yet — let it ferment.");
  return dim("Worth another night.");
}

/** What the OS banner says when the batch has ripened. */
export function nagText(batch) {
  return (
    `${plural(batch.units, "unit")} in the still — holding no longer pays` +
    ` (DC ${batch.tonight.dc}, ${percent(batch.tonight.odds)}).`
  );
}

/**
 * The whole round as text, for a pipe, a log, or cron. Nothing is truncated:
 * a log file has no width to fit, and cutting a line loses information the
 * reader cannot get back.
 */
export function renderReport(round) {
  const out = [
    `${bold("🍶 The Still")} ${dim(`— ${new Date().toLocaleString()}`)}`,
  ];

  if (!round.jailed) {
    out.push(dim("Not in The Brig — nothing fermenting."));
    return out.join("\n");
  }

  out.push(
    dim(
      `cell ${round.cellIndex}` +
        (round.banked === null ? "" : ` · banked ${round.banked} 🍶`),
    ),
    "",
  );

  if (round.started) {
    out.push(cyan("✓ Started a batch."));
    if (round.started.forfeited) {
      out.push(
        dim(
          "  Its first patrol is not tonight — you had already bottled today," +
            " so this one forfeits a night.",
        ),
      );
    }
    out.push("");
  }

  if (!round.batch) {
    out.push(dim("The still is empty."));
    return out.join("\n");
  }

  out.push(...batchLines(round.batch));
  const advice = adviceLine(round.batch);
  if (advice) out.push("", advice);
  return out.join("\n");
}

/** Painted for the error line, kept here so the screen and the printer agree. */
export const problem = (message) => red(`⚠ ${message}`);
