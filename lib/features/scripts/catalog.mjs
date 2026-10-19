/**
 * The browser scripts, in list order. Each is a `<id>.js` file beside this one,
 * for pasting into the DevTools console — they run in the browser, not here.
 *
 * To add one: drop the file in this folder and give it an entry below. Keep each
 * script whole — a pasted script can't import anything — and have it replace its
 * own earlier copy when pasted again, the way both of these do.
 */

export const SCRIPTS = [
  {
    id: "coast-bot",
    title: "Coast Bot",
    icon: "🧭",
    blurb: "Sails an island's coast and fishes the sonar's pings",
    how: [
      "Sails your ship round an island's coast in the shallows, and stops the",
      "moment the sonar pings — then flashes the tab title, beeps and raises a",
      "desktop notification.",
      "",
      "1. Board your ship with the fishing kit and sail to an island — any but",
      "   the home harbour, where no ping ever rolls.",
      "2. Press c to copy the script.",
      "3. On /treasure-world, open DevTools → Console, paste it, press Enter.",
      "4. Click Start in the 🧭 panel at the bottom left of the page.",
      "",
      "Or turn on 🎣 and pick the eggs to keep: it sails onto each ping that can",
      "hold one, casts and reels all ten casts, lets every other egg go, and",
      "keeps the first one you picked. Axoblooms bite only in the far north, so",
      "fish round Dead Bay or Coral Cay for those; Silk Bettas only on shore",
      "pings, which is what the shallows give. Pings that can hold none of your",
      "eggs are left to fade.",
      "",
      "Pressing an arrow key, WASD, E, F or Space yourself pauses it, and Start",
      "hands back. Left alone after a ping, it sails on once the ping fades. It",
      "stops for good once today's egg is kept or the egg crate is full.",
      "",
      "Keep the browser window visible — not minimised, not fully covered — as",
      "the game only moves the ship while the page is drawing.",
    ],
  },
  {
    id: "lights-out",
    title: "Lights Out",
    icon: "🏮",
    blurb: "Shows the bilge's two eggs through the dark",
    how: [
      "Rings the Brig bilge's two eggs, the Evil Sea Urchin's and the Evil",
      "Anglerfish's, whether or not they're glowing and wherever the lantern is.",
      "",
      "1. Press c to copy the script.",
      "2. On any Mermaid Office page, open DevTools → Console, paste it, press",
      "   Enter. A 🏮 panel shows at the bottom right.",
      "3. Go down into the bilge as usual. Pasting mid-run works too.",
      "4. Put the lantern on a ring and press: click the anglerfish egg, and",
      "   hold the urchin egg for a second, as letting go early stings.",
      "",
      "The bilge's top right corner says what the run holds, often nothing:",
      "about one run in six has an urchin egg, one in 25 an anglerfish egg.",
      "It makes no requests. It only reads the scene the page already holds.",
    ],
  },
  {
    id: "plinko-bot",
    title: "Plinko Bot",
    icon: "⚡",
    blurb: "Plays all of today's Live Wire Plinko batteries",
    how: [
      "Buys a Live Wire Plinko battery, drops every spark from the chute with",
      "the best odds of the Eelectra egg, closes the board when the sparks run",
      "out and buys the next, until today's ten are gone. An egg ends it: the",
      "bot keeps it, as keeping one ends the day's batteries anyway.",
      "",
      "1. Go to The Brig (/rooms/prison). You must be a prisoner there.",
      "2. Press c to copy the script.",
      "3. Open DevTools → Console, paste it, press Enter.",
      "4. The ⚡ panel at the bottom left says how many batteries are left today.",
      "   Click Start. Each battery costs 🪙2,000, so ten are 🪙20,000.",
      "",
      "The best chute is worked out from the board, the drain and the flags,",
      "which are all public. It is often beside the drain rather than over it,",
      "away from a fuse and towards a recharge, and with the Lid on it goes",
      "after sparks. That finds the egg in about 1 battery in 21, where aiming",
      "at the drain manages 1 in 24.5. The panel shows the chance as it goes.",
      "",
      "Touching the page yourself pauses it, and Start hands back. Keep the",
      "browser window visible, as a spark only lands once the board has drawn",
      "it falling.",
    ],
  },
];

export function findScript(id) {
  return SCRIPTS.find((s) => s.id === id) ?? null;
}
