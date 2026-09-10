/**
 * A notification → the three strings we show for it.
 *
 * DELIBERATELY PARTIAL. The website formats ~60 kinds in 847 lines
 * (frontend/src/features/notifications/format.ts), each with its own payload
 * type. Copying that here would be the largest thing in this repo to keep in
 * sync, for a tool whose README already apologises for mirroring two constants.
 *
 * So: the seven critter kinds are written out, because they're why this CLI
 * exists, with copy matching the site. Everything else goes through a generic
 * renderer that reads whichever well-known keys the payload happens to carry.
 * The generic path is unglamorous on purpose — its job is that a kind the server
 * adds next month shows up as *something* readable rather than vanishing.
 */

import { num } from "../../units.mjs";

/** A few kinds common enough to be worth an icon without full copy. */
const GENERIC_ICON = {
  chat_message: "💬",
  coins_received: "🪙",
  coin_request_received: "🪙",
  coin_request_paid: "🪙",
  daily_bonus: "🎁",
  birthday_gift: "🎂",
  shop_sale: "🛍️",
  poll_closed: "🗳️",
  prison_jailed: "🚨",
  prison_released: "🕊️",
  lottery_resolved: "🎟️",
  ruler_crowned: "👑",
  duel_challenge_received: "⚔️",
  duel_resolved: "⚔️",
  treasure_chest_found: "💰",
};

/** "coins_received" → "Coins received". */
function titleFromKind(kind) {
  const words = String(kind).split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Whatever the payload gives us that a human would recognise. */
function genericPreview(data) {
  if (!data || typeof data !== "object") return "";
  const bits = [];
  if (typeof data.fromName === "string" && data.fromName) bits.push(data.fromName);
  if (typeof data.chatTitle === "string" && data.chatTitle) bits.push(data.chatTitle);
  if (typeof data.name === "string" && data.name) bits.push(data.name);
  if (typeof data.amount === "number") bits.push(`${num(data.amount)} 🪙`);
  if (typeof data.compensation === "number") {
    bits.push(`${num(data.compensation)} 🪙`);
  }
  if (typeof data.preview === "string" && data.preview) {
    bits.push(`“${data.preview}”`);
  }
  return bits.join(" · ");
}

function critter(kind, d) {
  const name = typeof d?.name === "string" && d.name ? d.name : null;
  const it = name ?? "Your critter";
  const egg = name ?? "Your egg";

  switch (kind) {
    case "critter_hungry":
      return {
        icon: "🍽️",
        title: `${it} is getting hungry`,
        preview: "Feed it before things get worse.",
      };
    case "critter_dirty":
      return {
        icon: "🧽",
        title: `${it}'s tank needs cleaning`,
        preview: "Clean it before things get worse.",
      };
    case "critter_ready":
      return {
        icon: "🥚",
        title: `${egg} is ready to hatch!`,
        preview: "Head to the Hatchery and tap it to crack it open.",
      };
    case "critter_hatched":
      return {
        icon: "🐣",
        title: `${egg} hatched!`,
        preview: "Come meet your new hatchling in the Hatchery.",
      };
    case "critter_died":
      // A never-hatched egg spoiled, not "died" — the phase field (captured at
      // the death instant) picks the right framing.
      if (d?.phase === "egg") {
        return {
          icon: "🥚",
          title: `${egg} spoiled before hatching`,
          preview: "It went too cold and dry. Adopt a new egg to try again.",
        };
      }
      return {
        icon: "💀",
        title: `${it} has died`,
        preview: `${d?.daysAlive ?? "?"} days alive · earned ${num(d?.totalEarned ?? 0)} 🪙 total.`,
      };
    case "critter_revived":
      return {
        icon: "🌟",
        title: `The Ruler revived ${name ?? "your critter"}!`,
        preview: "It's back from the graveyard — go tend to it in the Hatchery.",
      };
    case "critter_death_compensated": {
      const paid = `+${num(d?.compensation ?? 0)} 🪙`;
      if (d?.revivedInto === "active") {
        return {
          icon: "🐣",
          title: `${it} is back — a bug had killed it early`,
          preview: `We revived it and paid you ${paid} for the lost days.`,
        };
      }
      if (d?.revivedInto === "pod") {
        return {
          icon: "🐚",
          title: `${it} is back, tucked into your collection`,
          preview: `No free active slot, so we froze it in your Collection instead, and paid you ${paid} for the lost days.`,
        };
      }
      return {
        icon: "😢",
        title: `${it} couldn't be revived — every slot was full`,
        preview: `A bug had killed it early, so we paid you ${paid} for the lost days even though it stays gone.`,
      };
    }
    default:
      return null;
  }
}

const signed = (n) => (Number(n) >= 0 ? `+${Number(n)}` : String(Number(n)));

const units = (n) => `${Number(n ?? 0)} unit${Number(n ?? 0) === 1 ? "" : "s"}`;

/**
 * The Still's two kinds, written out for the same reason the critters are:
 * this CLI has a screen for them, and the generic renderer makes a nonsense of
 * both. `brew_patrol` would read "Brew patrol" with an empty preview — no die,
 * no outcome, no units — which is the one notification you actually need the
 * detail from, since the roll happens overnight while you're away and the
 * notification IS the reveal.
 *
 * Copy matches the site (frontend/src/features/notifications/format.ts), and
 * like the site it names all three numbers rather than only the total.
 */
function brew(kind, d) {
  switch (kind) {
    case "brew_patrol": {
      const c = d?.check ?? {};
      const roll = `Rolled ${c.roll} ${signed(c.modifier)} = ${c.total} against DC ${c.dc}.`;
      if (d?.outcome === "poured") {
        return {
          icon: "🍶",
          title: "The guard found your still",
          preview: `${roll} ${units(d?.unitsLost)} poured out.`,
        };
      }
      return {
        icon: "🍶",
        title: "The night patrol passed",
        preview: `${roll} Your batch is ${units(d?.units)}.`,
      };
    }
    case "brew_bottled":
      // Fires on release only — a batch bottled by hand gets its receipt in
      // the response, not as a notification.
      return {
        icon: "🍶",
        title: "Your batch was bottled as you walked out",
        preview: `${num(d?.brew ?? 0)} 🍶 Bilge Brew in your stash.`,
      };
    default:
      return null;
  }
}

/** Never returns null: an unknown kind still has to render. */
export function formatNotification(n) {
  const kind = n?.kind ?? "";
  const data = n?.data ?? {};

  if (kind.startsWith("critter_")) {
    const known = critter(kind, data);
    if (known) return known;
  }
  if (kind.startsWith("brew_")) {
    const known = brew(kind, data);
    if (known) return known;
  }

  return {
    icon: GENERIC_ICON[kind] ?? "🔔",
    title: titleFromKind(kind),
    preview: genericPreview(data),
  };
}

/** Which feature a notification belongs to, for the toast subtitle. Only the
 * kinds with a screen here have somewhere to belong. */
export function featureOf(kind) {
  const k = String(kind);
  if (k.startsWith("critter_")) return "Hatchery";
  if (k.startsWith("brew_")) return "The Still";
  return "";
}

/**
 * `createdAt` as milliseconds.
 *
 * The column defaults to SQLite's `datetime('now')`, which is UTC written as
 * "2026-08-11 20:15:00" — a space instead of the T, and no zone marker at all.
 * Date.parse reads that as *local* time, so every age would be out by the UTC
 * offset. Normalising to strict ISO is what the website does too
 * (format.ts:835), by a slightly different route.
 */
export function createdAtMs(createdAt) {
  if (typeof createdAt !== "string") return NaN;
  const iso = createdAt.includes("T")
    ? createdAt
    : `${createdAt.replace(" ", "T")}Z`;
  return Date.parse(iso);
}
