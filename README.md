# Blackhat

Mermaid Office from the terminal. Run it bare and you get a main menu; open an
item and you get that feature's screen. Four features so far — the
**Hatchery**, **Notifications**, **The Still** and the **Browser Scripts** —
and the shell is built for more.

```
 🧜 BLACKHAT                                       you@example.com  10:05:36 PM

   🥚  Hatchery          Tend and watch your critters
   🔔  Notifications     What's been happening
   🍶  The Still         Keep a batch of Bilge Brew going
   📜  Browser Scripts   Copy a script for the browser console

 4 features                                          ↑/↓ move · ↵ open · q quit
```

**Every feature's background work starts with the app**, not with its screen. The
Hatchery is refreshed and the chores are done on a timer from the moment you
launch, whether you're looking at the board, sitting on the menu, or off in some
other feature. Its *status* only gets drawn when you open it.

| Key           | Does                                     |
| ------------- | ---------------------------------------- |
| `↑` `↓`       | Move (`j` / `k` also work)               |
| `↵`           | Open the selected feature                |
| `q` / `Esc`   | Inside a feature: back to the menu       |
| `q`           | On the menu: quit                        |
| `Ctrl-C`      | Quit, from any depth                     |

A menu row shows no status of its own — no counts, no coins. The one thing it
borrows from the background is an activity glyph on the right: `⟳` while a round
is in flight, `⚠` while that feature can't reach the server. So a server that has
gone away is visible from the front door instead of failing quietly for an hour;
for anything more than that, open the item.

## This folder is standalone

It has **no dependencies** — no npm packages, and nothing imported from the
Mermaid Office repo. Copy or move the folder anywhere you like and it keeps
working. All it needs is Node 18+ and a reachable server.

```
blackhat.mjs                       entry point: options, command, credentials
lib/app.mjs                        the shell: screen stack, repaint loop, chrome
lib/menu.mjs                       the main menu
lib/registry.mjs                   the feature list — one line per feature
lib/api.mjs                        REST client, JWT cache (shared by features)
lib/env.mjs                        credentials loading
lib/units.mjs                      counts, durations, clock times
lib/notify.mjs                     asking the OS to show a message
lib/clipboard.mjs                  putting text on the clipboard
lib/term/ansi.mjs                  colours, screen control, terminal width maths
lib/term/screen.mjs                the flicker-free frame, and the keyboard
lib/features/hatchery/index.mjs    the feature descriptor
lib/features/hatchery/service.mjs  polls and tends — runs in the background
lib/features/hatchery/screen.mjs   draws the board — only while it's open
lib/features/hatchery/care.mjs     deciding and doing the chores (the only writes)
lib/features/hatchery/format.mjs   board → lines of text
lib/features/notifications/…       the same five parts, for the live feed
lib/features/scripts/…             the browser scripts, and the screen that copies them
```

**Node 22+** for the app itself, because the notification stream uses the global
`WebSocket` that arrived in Node 22. The one-shot commands (`--once`, `--json`,
anything piped) don't open a socket and still run on Node 18 — so an existing
cron line keeps working on an older runtime.

## Setup

```sh
cp .env.example .env
chmod 600 .env          # it holds your password
$EDITOR .env
```

Then:

```sh
./blackhat.mjs
```

Credentials are read from environment variables, or from `KEY=VALUE` lines in
the first file that exists of:

1. `.env` beside the script (this folder)
2. `~/.blackhat.env`

A real environment variable always wins over the file, so you can also do:

```sh
MERMAID_URL=https://mermaid.example MERMAID_EMAIL=you@example.com \
  MERMAID_PASSWORD=... ./blackhat.mjs
```

| Variable            | Meaning                                           |
| ------------------- | ------------------------------------------------- |
| `MERMAID_URL`       | Server base URL (default `http://localhost:8601`) |
| `MERMAID_EMAIL`     | Your login email                                  |
| `MERMAID_PASSWORD`  | Your password                                     |
| `BLACKHAT_ENV_FILE` | Read this credentials file instead                |

## Usage

```sh
./blackhat.mjs                        # the main menu
./blackhat.mjs hatchery               # the same app, opened on the Hatchery
./blackhat.mjs hatchery --once        # one round, print it, exit
./blackhat.mjs brew --once            # check the still, start one if it's empty
./blackhat.mjs scripts coast-bot > bot.js   # a browser script, to a file
./blackhat.mjs --help
./blackhat.mjs hatchery --help
```

Naming a feature opens the app with that screen in front — and it's the only way
to pass that feature's own options, so no global flag namespace has to be kept
untangled as features are added:

```sh
./blackhat.mjs hatchery --interval 30s --no-care
```

The app's own options are few, and go before the command:

| Option              | Meaning                                    |
| ------------------- | ------------------------------------------ |
| `--env-file <path>` | Read a specific credentials file           |
| `--no-color`        | Plain output (`NO_COLOR` is honoured too)  |
| `-h, --help`        | App help; after a command, that command's  |

Exit code is `0` on success, `1` on failure. A bare `blackhat` needs a terminal —
piped, there is no sensible reading of "the main menu", so it tells you to name a
command instead.

### Install it on your PATH

```sh
npm link          # from this folder; gives you a `blackhat` command
```

## Hatchery

What phase each critter is in, how its two care meters are doing, what it's
earning — and **it does the chores for you**.

```
🧜 Hatchery — 8/10/2026, 10:03:54 PM
Ingvar (ingvar) · 12,340 🪙 · critters earned 11,290 🪙
Active slots: 4/5 in use (cap 10, next slot 13,000 🪙)

Bubbles — Pufferfish (tier 2 · lavender)
   🥚 Egg · 🍽️ hungry · 1d old · hatches in ~1d 3h
   Warmth   ████░░░░░░░░  35%  ·  Humidity █████████░░░  78%
   40 🪙/day (reduced while an egg) · not paid today · earned 20 🪙 so far
   ⚠ Warm it.

Big Nige — Kraken (tier 6 · abyss)
   🐟 Adult · 😊 happy · 21d old
   Hunger   ███████████░  88%  ·  Tank     ████████░░░░  64%
   500 🪙/day · paid today ✓ · earned 10,500 🪙 so far
   🛟 With the sitter for another 1d 15h

1 critter needs attention.
```

| Option                  | Meaning                                              |
| ----------------------- | ---------------------------------------------------- |
| `-1, --once`            | One round, then exit (the default when not a TTY)     |
| `--loop`                | Keep going even when piped                           |
| `-i, --interval <time>` | Refresh + tend cadence; default 5m (`-w` also works)  |
| `--no-care`             | Only look; do no chores                              |
| `--plain`               | Re-print the report instead of opening the app        |
| `--json`                | Print the raw board as JSON instead                  |

### Doing the chores

**This writes to your account by default.** Every round it feeds and cleans every
critter that needs it — on an egg the same two endpoints read as warming and
misting:

```
✓ Bubbles — warmed + misted · +40 🪙
✓ Sicky — fed + cleaned · saved from sickness, but today's coins are forfeit
Tended 2 critters · earned 40 🪙
```

`--no-care` turns this off if you only want to look. On the Hatchery screen, `c`
does a round of chores on the spot without waiting for the next refresh — even in
a session started with `--no-care`.

**"Needs it" means there's something to gain**, so a five-minute loop doesn't
hammer the server: a critter is tended when it hasn't been paid today (the
chores collect the daily coins), when it isn't happy, or when a meter has fallen
below **80%** (`CARE_FLOOR` in `lib/features/hatchery/care.mjs`). One that's paid
and still above the line is skipped, as is one away with the sitter — its clocks
are frozen and the server refuses chores anyway. Run it twice in a row and the
second run does nothing at all.

That floor is really **the worst state the tool may leave a critter in**, for the
times it isn't running — laptop shut, server down. A meter is the fraction of the
way to death, so 80% leaves ~58 h on an adult's hunger clock, ~38 h on its tank,
and ~29 h on an egg in the worst case: an overnight gap is comfortable, and a
whole day of downtime still doesn't kill anything. (Those are _effective_ hours —
weekends don't count against either clock.) Lower it and you get fewer writes but
a thinner safety net.

Two things it deliberately won't do:

- **It never hatches an egg.** A matured egg is still only reported as ready.
  Cracking it is three taps and a random colour reveal — that's the fun bit, and
  it's yours.
- **It won't skip a sick critter to protect your coins.** Tending one that has
  slipped into the sick band saves its life but forfeits that day's payout (the
  server's rule, not ours). Staying alive wins, and the report says so when it
  happens.

### The screen

| Key           | Does                              |
| ------------- | --------------------------------- |
| `u` (or `r`)  | Refresh right now                 |
| `c`           | Do the chores now                 |
| `↑` `↓`       | Scroll (`j` / `k` also work)      |
| `PgUp` `PgDn` | Scroll a page (space = page down) |
| `g` / `G`     | Jump to top / end                 |
| `q` / `Esc`   | Back to the menu (`Ctrl-C` quits) |

The header carries your balance, slot usage, when the board was last fetched, a
live countdown to the next refresh, and what the last round of chores did — which
may well have happened while you were somewhere else in the app.

**It doesn't blink.** The usual way to build one of these — clear the screen,
print the frame — flickers, because the terminal can render the blank moment in
between. Instead each frame is diffed against what's already on screen and only
the lines that actually changed are rewritten, in a single write. An idle second
repaints just the clock and the countdown; an unchanged screen writes nothing.
That's also why the shell needs no bookkeeping about *when* to repaint: it simply
redraws on every key, every second, and every service event, and the diff makes
the redundant ones free.

If the server goes away mid-session the screen keeps the last good board up,
shows the error and a retry countdown in the header, and carries on — it won't
blank or exit.

### Run it on a schedule

The app is for a terminal you leave open. To keep the critters tended while
you're away, cron suits it better — a piped run already does exactly one round,
so no flags are needed. Note cron has almost no `PATH`, so use absolute paths:

```cron
0 * * * * /usr/local/bin/node /path/to/blackhat-cli/blackhat.mjs hatchery --no-color >> /tmp/hatchery.log 2>&1
```

Add `--no-care` to that line if you want the log without the chores.

The Still suits cron for the same reason, and one run a day is enough — the
patrol happens once a night, so all a scheduled run has to do is make sure
there's something in the still for it to walk past:

```cron
30 8 * * * /usr/local/bin/node /path/to/blackhat-cli/blackhat.mjs brew --no-color >> /tmp/still.log 2>&1
```

A scheduled run never raises a banner — it prints its report instead, nag and
all, which is what a log wants.

## Notifications

A live feed of everything the server tells you about — critters getting hungry,
eggs ready to hatch, coins arriving, chat messages — as a menu item, and as
**OS notifications** the moment they land.

```
 🧜 BLACKHAT · NOTIFICATIONS                        you@example.com  8:51:44 AM
 3 unread · listening
 ──────────────────────────────────────────────────────────────────────────────
 • 🍽️  Bubbles is getting hungry · Feed it before things get worse.  2m 8s ago
 • 🥚  Cracky is ready to hatch! · Head to the Hatchery and tap it t… 1h 0m ago
   💀  Departed has died · 14 days alive · earned 140 🪙 total.       1d 2h ago
   🥚  Yolky spoiled before hatching · It went too cold and dry. Ado… 1d 6h ago
 • 🔔  Wreck raided · Nemo · 250 🪙                                   5m 8s ago
   💬  Chat message · Coral · Standup · “anyone seen my kraken”      1h 30m ago
 ──────────────────────────────────────────────────────────────────────────────
 3 unread                     u refresh · a mark all read · ↑/↓ scroll · q back
```

One row each, unread in bold with a bullet. The age is always kept — a long
preview is cut with a `…` rather than pushing the timestamp off the edge.

Like the Hatchery, the stream runs from launch: a WebSocket is held open
whatever screen you're on, so a banner appears whether you're on the menu, in
the Hatchery, or looking at nothing at all.

| Option          | Meaning                                          |
| --------------- | ------------------------------------------------ |
| `--limit <n>`   | How many to fetch (default 50, max 200)          |
| `--no-toast`    | List them, but raise no OS notifications         |
| `-1, --once`    | Print the list and exit (the default when piped) |
| `--json`        | The raw notifications as JSON                    |

**The backlog never pops up.** Whatever was already waiting when the app started
is listed but never raised — otherwise launching on a Monday would fire fifty
banners at once. Only what arrives afterwards is announced, and a burst raises at
most three plus a "5 more notifications" summary. That same rule covers a
reconnect, which announces whatever it missed while the connection was down.

macOS uses `osascript`; Linux uses `notify-send` if it's installed; anywhere else
the screen says OS notifications aren't available rather than quietly doing
nothing. Notification text contains other players' names and chat previews, so it
is passed to `osascript` as *arguments* to an `on run argv` script, never
interpolated into the script — a critter named `" & (do shell script "…") & "` is
just an odd-looking name.

Only the kinds with a screen here get hand-written wording — the seven critter
ones and the two from The Still; everything else is rendered generically from
whatever the payload carries. That's deliberate — the website formats ~60 kinds
in 847 lines, and mirroring it here would drift the moment the server adds one.
The cost is that a `wreck_raided` reads as "Wreck raided · Nemo · 250 🪙" rather
than a full sentence. The benefit is that it reads at all.

### It claims your daily login bonus

Holding the stream open writes to your account: the server claims your daily
login bonus when a socket connects, and again on its 30-second heartbeat. That's
the same thing opening the website does — but it means running `blackhat` writes
even with the Hatchery's `--no-care`. Use the one-shot commands if you want a
look with no socket at all.

That's the second of the three writes this tool makes. The Hatchery's chores are
the first, and The Still's automatic start is the third; each is off with its own
flag, and none of them can spend a coin.

## The Still

The prison's Bilge Brew still, for the half of that game you keep forgetting:
having a batch on at all. It puts one in the still whenever you're in The Brig
and it's empty, and it tells you when the odds say to cash out.

```
 🧜 BLACKHAT · THE STILL                            you@example.com  9:14:02 AM
 cell 3 · banked 7 🍶
 updated 12s ago · next check in 4m 48s · started a batch at 09:14
 ──────────────────────────────────────────────────────────────────────────────

   Batch    ●●●●  4 units   started Monday
   Patrol   tonight · DC 9 · Stealth +2 · about 70%
   Last     rolled 14 +2 = 16 vs DC 8 · survived

   ⚠ holding no longer pays — bottle it

 ──────────────────────────────────────────────────────────────────────────────
 bottle it                        b bottle · u refresh · ↑/↓ scroll · q back
```

| Option                | Meaning                                        |
| --------------------- | ---------------------------------------------- |
| `--no-start`          | Only look; never put a batch in the still      |
| `-i, --interval`      | How often to check (default 5m)                |
| `-1, --once`          | One round and exit (the default when piped)    |
| `--json`              | The raw round as JSON                          |

### Starting is automatic, bottling never is

Starting a batch is the free half of the game — a fresh one has the lowest DC,
and a batch with nothing in it loses nothing when the guard pours it out. So it
happens on its own, like the Hatchery's chores, unless you pass `--no-start`.

Bottling is the other half, and it's the whole point of the game: hold for one
more night and you might gain a unit, or lose the lot. So it stays yours. Press
`b` and the footer asks; press `b` again to go through with it. Any other key
backs out.

The reminder does the remembering. It works out when holding has stopped paying
— the survival odds against one more unit versus what's already in there — and
raises one banner when the batch crosses that line, then one more on each later
night that adds a unit. With no Dexterity bonus that's three units; at +2 it's
four. Both numbers come from the server on every read, so the advice stays right
if the game is ever retuned.

### The one time starting costs you something

A batch started on a day you've already bottled forfeits its first patrol —
that's the game's rule, and it's what makes holding a small batch a real choice.
On a weekday it costs nothing, because the night was spent the moment you
bottled. On a **weekend** it costs one real roll, since the skipped night hops
to Monday. The screen says so when it happens rather than quietly showing a
batch that won't roll tonight.

Bottle on a Saturday and you'll see it. It's the price of never forgetting, and
it's one night.

### The nightly patrol shows up in Notifications

The guard rolls at team midnight while you're asleep, so the notification *is*
the reveal — it carries the die, your modifier and the DC. That arrives through
the Notifications feature, not this one, which is why both are worth leaving
running. This screen shows last night's roll and tonight's odds; it never rolls
anything itself.

## Browser Scripts

Not a status screen: scripts for the browser's DevTools console, for the games
that need a hand on the page itself. Each one runs in the browser, not here; this
screen only hands them over.

```
 🧜 BLACKHAT · BROWSER SCRIPTS                      you@example.com  2:07:13 PM
 Scripts for the browser's DevTools console · they run there, not here
 ──────────────────────────────────────────────────────────────────────────────

    🧭  Coast Bot    Sails an island's coast and fishes the sonar's pings
    🏮  Lights Out   Shows the bilge's two eggs through the dark
    ⚡  Plinko Bot   Plays all of today's Live Wire Plinko batteries
    🦀  Tide Digger  Digs an island's tide line for hermits and shells
    ⚓  Homeward     Sails your ship home to the Home Harbour's jetty

   Rings the Brig bilge's two eggs, the Evil Sea Urchin's and the Evil
   …
   ✓ On the clipboard since 2:07:13 PM · 252 lines
 ──────────────────────────────────────────────────────────────────────────────
 Lights Out copied                               ↑/↓ pick · c copy · q back
```

Pick a script with `↑`/`↓` and press `c` to put it on the clipboard; the screen
says which page it wants and what to do once it's pasted. Piped, the command
prints a script instead: `blackhat scripts coast-bot | pbcopy` does the same as
`c`, and `blackhat scripts` with nothing named lists them. Pasting a script again
replaces its earlier copy, and each has a `×` to remove it.

| Option        | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `-1, --once`  | Print the script, or the list, and exit (default when piped) |

Each script is one standalone file in `lib/features/scripts/`, since a pasted
script can't import anything; `catalog.mjs` lists them, with the how-to the
screen shows.

### Coast Bot

Sails your Treasure World ship round an island while you get on with something
else, and calls you back the moment the egg-fishing sonar pings. Board your ship
with the fishing kit, sail to an island — any but the home harbour, where no ping
ever rolls — paste it into the console on `/treasure-world`, and click **Start**
in the 🧭 panel it adds at the bottom left.

What the script does, once started:

- **It follows the island nearest the ship** when you click Start, about 1.7
  tiles off the coast. On this map that is always shallow water, so its rolls
  are shore pings — the only kind that can hook a Silk Betta.
- **It steers with the keyboard's own events** — the same arrow keys you'd
  press — and reads rather than asks: the ship's position from the game's own
  presence messages, pings from the game's own sonar polls. Pasting it costs one
  board fetch and one map fetch, and nothing after.
- **On a ping it stops**, flashes the tab title, beeps every 5 seconds and
  raises a desktop notification (allow it when the browser asks).
- **Your own keys win.** An arrow key, WASD, E, F or Space pauses it, and Start
  hands back. Left alone, it sails on once the ping fades — 30 seconds at most.
- **It stops for good** once today's egg is kept, the egg crate is full, or you
  go ashore.

**Auto-fish.** Turn on 🎣 in the panel and pick the eggs to keep — the toggles
list every kind the rod can bring up, read from the server's catch table, with
each one's odds per cast in its tooltip. Both choices are remembered between
pastes. Then, instead of calling you, the bot fishes each ping itself:

- **It sails onto the ping** by sea, round any land in the way, stops within a
  tile of it, and waits for the hull to stand still as a cast needs.
- **It casts and reels with the game's own F**, reeling a moment after the bite
  it hears on the game's own socket, and goes on until the ping's ten casts are
  spent.
- **It keeps the first egg of a kind you picked** and lets every other go, with
  the game's own Keep and Release buttons. Keeping ends the day's fishing, so it
  then stops and raises the alarm.
- **It skips pings that can't hold your eggs**, leaving them to fade as it sails
  on. Axoblooms bite only in the far north (the top 40 rows: Dead Bay and Coral
  Cay, whose shallows are all in it); Silk Bettas only on shore pings, which is
  what the shallows give. Start refuses an island where none of your eggs bite.

Per cast where both zones meet: Seahorse 31 %, Leafy Seadragon 10 %, Narwhal 4 %,
Axobloom and Silk Betta 0.7 % each, nothing the rest. A ping's ten casts give a
1-in-7 chance of either rarity there, and fishing a ping takes about a minute
and a half.

Why round a coast rather than back and forth on the spot: the sonar only rolls
once the hull is 4 tiles, as the crow flies, from where it last rolled, and it
checks every 2 seconds. Turning about every second never gets that far, so it
never pings at all. Round an island the bot rolls about 16 times a minute — a
ping every couple of minutes — where sailing straight across the wind manages
nearer 30, at the cost of the shallows.

**Keep the browser window visible** — not minimised, not in a background tab,
not fully covered by other windows. The game only moves the ship while the page
is drawing, and macOS counts a fully covered window as hidden.

Nothing on the CLI side talks to the server. `c` only touches the clipboard:
`pbcopy` on macOS, the first of `wl-copy`, `xclip` or `xsel` on Linux. Anywhere
else the screen says so, and the piped form still works.

### Lights Out

A wall hack for the Brig's bilge: a ring and a label on each of its two eggs, the
Evil Sea Urchin's and the Evil Anglerfish's, whether or not they're glowing and
wherever your lantern is. Paste it on any page — the bilge opens over whatever
page you're on — and go down as usual; pasting mid-run works too.

- **The server never says what a light is, but the paths do.** The urchin egg is
  the only light that never moves. The anglerfish egg is the only soft light
  drifting *with* the current: lures drift against it, and shards twinkle
  without ever going fully dark. Checked against the server's own scene
  generator over 25,000 scenes, with no light misread.
- **It reads, never sends.** The scene is the one the page already holds, read
  off the bilge canvas every frame. No requests, no clicks: you still put the
  lantern on the ring and press — click the anglerfish egg, hold the urchin egg
  for a second.
- **The bilge's top right corner says what the run holds**, usually nothing: 16 %
  of runs have an urchin egg and 4 % an anglerfish egg. An anglerfish egg that
  hasn't drifted in yet shows as a dashed ring where it will, with a countdown.
- **The rings never block a click.** They sit on a layer the mouse passes through.

### Plinko Bot

Plays the day's Live Wire Plinko for you: buys a battery, drops every spark,
closes the board when the sparks run out and buys the next, until all ten of
today's batteries are gone. **That spends real coins**: 🪙2,000 a battery, so
🪙20,000 for a full day. The ⚡ panel says how many are left before you click
Start. Paste it in The Brig (`/rooms/prison`), where the game is played.

- **Every spark goes down the chute with the best odds of the Eelectra egg.**
  Nothing on the board is secret (the buckets, the drain and the Static /
  Grease / Lid flags are all in the battery), so the bot solves the whole
  battery against the dice: every chute, every bucket, every spark left. That
  often means beside the drain rather than over it, away from a fuse and
  towards a recharge, and with the Lid on it goes after sparks.
- **Checked against the server's own rules.** Its landing odds match the
  server's path writer, and over 50,000 simulated batteries on the server's
  own `playDrop` it found the egg in **1 battery in 21** (4.7 %), where aiming
  at the drain manages 1 in 24.5 and random chutes 1 in 54. Its predicted odds
  matched the simulation to 0.01 points.
- **An egg ends the run.** It keeps the egg, since keeping one ends the day's
  batteries anyway, flashes the tab title, beeps and raises a desktop
  notification. Finishing all ten without one raises a quiet notification.
- **It plays with the board's own controls** (the chute keys and the Drop
  button, the panel's Buy and the ending's Close) and reads the battery from
  the game's own answers, so the board animates as if you were playing.
- **Touching the page yourself pauses it**; Start hands back. The panel moves
  onto the board while it's open, as the board makes the rest of the page
  unclickable.
- **Keep the window visible.** A spark lands only once the board has drawn it
  falling, about 3½ seconds a spark. Steering into recharges stretches a
  battery to about 12 sparks on average (1 in 20 run past 24), so a day of ten
  takes about 7 minutes.

### Tide Digger

Digs a Treasure World island's tide line for hermits and shells. You sail there
and go ashore yourself; paste it on `/treasure-world` and click Start in the 🦀
panel at the top right. It digs every tide-line tile of the island you're
standing on, then stops.

- **The tide line is the game's own rule**: sand with water beside it, on any
  island but the home harbour, which is the only place hermits and shells wash
  up. The script works it out from the public map with the game's island rule,
  and finds the same 315 tiles the server does (23 to 40 an island).
- **It walks and digs with the game's own keys**: the arrow keys a short leg
  at a time, re-reading where the game says the figure stopped before the
  next, and F on each tile. A find's dialog gets "Skip the brushing" and
  "Keep digging". Each dig drinks one water, as by hand, so it stops when the
  water runs out.
- **A hermit raises the alarm** (title, beep, desktop notification), since it
  has two hours in the holding tank to reach the Hatchery. The bot digs on for
  shells. The tank holds one hermit, so a second burrows back in; the bot
  remembers that tile and digs it again on a later run once the tank is empty.
  A full shell crate is handled the same way for shells.
- **It remembers today's dug tiles**, so pasting it again doesn't spend water
  on them twice. A tide that comes in on an island forgets that island's tiles.
  `__tideDigger.forget()` in the console forgets them all.
- **Your own keys win.** An arrow key, WASD, E, F, Q or Space pauses it; Start
  hands back. Keep the window visible, as the figure only walks while the page
  is drawing.

Tried on a local copy after an admin tide on Rum Cay (31 tide-line tiles, 2
hermits and 6 shells from the tide, more shells from the seed): it dug all 31 in
66 seconds and brought up every find there, 9 shells and a hermit, leaving only
the second hermit, which the full tank couldn't take.

### Homeward

Sails your Treasure World ship back to the Home Harbour's jetty from anywhere
on the map. Paste it on `/treasure-world` while you're aboard, and the ⚓ panel at
the top right (under the Tide Digger's) says how long the way home is; click
Start. It stops on the jetty's tile, where Space puts you ashore.

- **It sails the fastest way in today's wind, as the game scores it.** Heading
  into the wind's eye makes 45 % speed, close-hauled 75 % and a beam reach
  full speed, so going upwind it tacks rather than crawling straight at the
  harbour. It plans over the whole map by sea, round every island, from the
  game's own wind forecast, and replans whenever the wind has turned 2°.
- **It steers with the game's own arrow keys** and reads the ship's position
  from the page's own move reports, which come four times a second; between
  them it reckons ahead along its heading, so it turns on the right tile.
- **Your own keys win.** An arrow key, WASD, E, F, Q or Space pauses it; Start
  hands back. If the ship stops moving for five seconds (a hidden window, or a
  battle) it stops and says so.

Tried in Node against a copy of the game's sailing loop, on the real map and
wind: from where a ship lay in the far north it was home in 60 seconds, and
from 245 starts across five winds every one ended on the jetty, at most 16 %
slower than planned. Dead upwind it tacked home in 74 seconds where sailing
straight into the wind takes 85.

## Adding a feature

A feature is a folder under `lib/features/` whose `index.mjs` default-exports a
descriptor, plus one line in `lib/registry.mjs`. Nothing in the shell changes —
the menu row, the command name, the help text and the background service are all
derived from what you export:

```js
export default {
  id: "widgets",              // the command name
  title: "Widgets",           // the menu row and the breadcrumb
  icon: "🔧",
  blurb: "Do a thing",
  help: "…",                  // printed for `blackhat widgets --help`
  parseFlags(argv),           // → options object; throw on a bad argument
  createService(ctx, flags),  // → { state, start, stop, subscribe, activity }
  createScreen(service),      // → { title, headerLines, bodyLines, … onKey }
  runOnce(ctx, flags),        // → text to print, for the piped path
  requires(),                 // optional → why the service can't run here, or null
};
```

`requires()` is how a feature declares a runtime it needs — Notifications uses it
for the global `WebSocket`. It's checked only where services actually start, so a
feature that can't run doesn't break the one-shot commands.

The split to respect is that the **service** owns the timers, the writes and the
state, and the **screen** only turns that state into lines. That's what lets the
work carry on while the screen is closed. A screen's `onKey` returns `true` for a
key it handled and `false` to let the shell's scrolling, back and quit take it.

`lib/features/hatchery/` is the worked example.

## How it works

It talks to the ordinary REST API — the same one the website uses:

- `POST /api/auth/login` for a token
- `GET /api/auth/me` for your name and coin balance
- `GET /api/critter` for the critter board
- `POST /api/critter/feed` and `/clean` — the chores, unless `--no-care`
- `GET /api/notifications` and `POST /api/notifications/read`
- `ws://…/ws?token=…` — the live notification stream
- `GET /api/prison` — whether you're in The Brig, and which cell
- `GET /api/prison/brew` and `POST /api/prison/brew/start` — The Still, unless
  `--no-start`; `POST /api/prison/brew/bottle` only when you press `b`
- `GET /api/prison/contraband` — what you've already banked

The Browser Scripts make no requests from here. The Coast Bot's script, running in your browser
as you, reads `GET /api/treasure-world` and the tile map once when pasted. Auto-fish
works the game's own F key and buttons, so the casts, reels, keeps and releases
are the game's own requests; only when it can't find the Keep or Release button
does it send `POST /api/treasure-world/fish/keep` or `…/release` itself.
The Plinko Bot reads `GET /api/prison/plinko` once when pasted. Everything
after that is the page's own requests, made by clicking its buttons: a
`POST /api/prison/plinko/battery` per battery (🪙2,000 each), a
`…/drop` per spark, and `…/keep` if an egg comes up.
The Tide Digger reads `GET /api/treasure-world` and the tile map once when
pasted. Its digs are the page's own `PUT /api/treasure-world/position` and
`POST /api/treasure-world/dig`, sent by the F key, one water each.
Homeward reads `GET /api/treasure-world`, the tile map and
`GET /api/treasure-world/wind` when pasted, and the wind again on Start when
it's ten minutes old. The sailing is all the page's own reports.

The token is cached (mode `0600`) under `~/.cache/blackhat/`, keyed by server +
account, and re-minted automatically when it expires — so polling every few
minutes isn't a fresh login each time. Delete that folder to force a re-login.

Even with `--no-care` there's one server-side effect worth knowing about: `GET
/api/critter` is the same call the Hatchery page makes, and the server derives
critter state on read — so a critter that has _already_ died gets recorded as
dead (and its notification fires) when you poll. Reading never _causes_ a death
and costs no coins.

Bad credentials no longer stop the app from opening: a login that fails is an
error on that feature's service, so you get `⚠` on the menu and the message in
the feature's header, and it keeps retrying. A *missing* `MERMAID_EMAIL` or
`MERMAID_PASSWORD` still aborts before anything is drawn — there's nothing to
retry.

## Coming from `hatchery-cli`

Same tool, renamed and reshaped. Three things need editing once:

```sh
mv ~/.mermaid-office.env ~/.blackhat.env    # if you kept credentials there
rm -rf ~/.cache/mermaid-office             # orphaned token cache; you'll re-login once
```

and the cron line grows a command name (`blackhat.mjs hatchery`, where it used to
be `hatchery-status.mjs`). `MERMAID_URL` / `MERMAID_EMAIL` / `MERMAID_PASSWORD`
are unchanged — they name the server, not this CLI. `MERMAID_ENV_FILE` is now
`BLACKHAT_ENV_FILE`.

One habit changes: `q` on the Hatchery goes back to the menu rather than exiting.
`Ctrl-C` quits from anywhere, and `q q` gets you out in two keys.

## A note on staying in sync

Two display details are copied from the server, since the API doesn't send them:
the hatch-tap count (`HATCH_CLICKS_REQUIRED`) and the species display names
(derived from the `kind` id). Both are marked in the source. If a species is
renamed or the tap count is retuned, only the labels drift — nothing breaks.

The Coast Bot's script leans on the website much harder, because it drives the
page itself: the arrow-key bindings, the `treasure.move` presence message, the
sonar's `state` values, the `token` in `localStorage`, and the map's terrain
ids — and for auto-fish the F key, the `fishing.bite` socket message, the
`Keep` / `Release` button labels, and the `north` / `shore` zone names in the
catch table. Those are the website's internals, not an API, so a change to any of them
can stop the bot — it fails by not moving or not stopping, never by writing
anything the game wouldn't take from a keyboard.

Lights Out leans on the bilge's internals the same way: the canvas's
`aria-label` ("The flooded bilge…"), the `liveRef` and `config` props it reads
through React's fiber on that canvas, and the scene's tells — the urchin egg's
stationary path, the soft lights' dark spells, and the current's direction. A
change there makes it say it can't read the bilge, or ring nothing; it never
sends anything.

The Plinko Bot leans on the board's controls: the pegboard canvas's
`aria-label` ("The pegboard…"), the `1`–`9` chute keys, and the button labels
`Buy a battery`, `Drop from chute N`, `Close`, `Keep` and `Done`. It also
mirrors the server's dice, which aren't on the wire: the kick chance (0.11), at
most two kicks, the up-kick share (0.25), their lane steps, and the 2.5 % catch
chance. A changed label makes it stand still rather than misclick. Changed dice
only make its chute choices a little less than best; the drops are always the
server's.

The Tide Digger mirrors two of the game's rules from the public map: the tide
line (sand with a shallow or deep tile beside it, never the home harbour) and
which island a tile belongs to (the first island whose box of `radius + 4`
holds it). It also leans on the arrow keys and F, the position reports, and
the find dialog's "Skip the brushing" and "Keep digging" buttons. A changed rule
makes it dig the wrong tiles or miss some; a changed button leaves the dialog
open, and the next dig waits behind it until three tries fail and it stops.

Homeward mirrors the game's sailing: the points of sail (sent in the config),
how the forecast's keyframes are read for the wind now, the hull passing as a
point that slides along a coast, and the jetty at `homeDock`. It leans on the
arrow keys and the `treasure.move` and `PUT /api/treasure-world/position`
reports too. A changed rule only makes its way home slower; a changed report
leaves it unable to see the ship, so it stops after five seconds.
