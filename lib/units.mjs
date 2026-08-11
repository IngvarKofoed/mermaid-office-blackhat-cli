/**
 * Compact human units — counts, durations, clock times.
 *
 * These live outside any one feature because the app shell needs the clock for
 * its title bar while the Hatchery needs all three, and two copies of "format a
 * time" in the same frame is exactly the sort of thing that drifts apart.
 */

export function num(n) {
  return Number(n).toLocaleString("en-US");
}

/** Compact "2d 4h" / "3h 10m" / "12m" / "8s" for a duration in ms. */
export function relative(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  if (ms <= 0) return "now";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function clock(ms) {
  return new Date(ms).toLocaleTimeString();
}
