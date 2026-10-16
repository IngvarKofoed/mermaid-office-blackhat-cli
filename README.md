# Blackhat

Mermaid Office from the terminal. Run it bare and you get a main menu; open an
item and you get that feature's screen. Four features so far — the
**Hatchery**, **Notifications**, **The Still** and the **Coast Bot** — and the
shell is built for more.

```
 🧜 BLACKHAT                                       you@example.com  10:05:36 PM

   🥚  Hatchery        Tend and watch your critters
   🔔  Notifications   What's been happening
   🍶  The Still       Keep a batch of Bilge Brew going
   🧭  Coast Bot       Copy the Treasure World fishing script

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
lib/features/coast-bot/…           a browser script, and the screen that copies it
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
./blackhat.mjs coast-bot > bot.js     # the Coast Bot's browser script, to a file
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

## Coast Bot

Not a status screen: a script for the browser that sails your Treasure World
ship round an island while you get on with something else, and calls you back
the moment the egg-fishing sonar pings.

```
 🧜 BLACKHAT · COAST BOT                            you@example.com  2:07:13 PM
 Treasure World egg fishing · a script for the browser console
 ──────────────────────────────────────────────────────────────────────────────

   Sails your ship round an island's coast in the shallows, and stops the
   moment the sonar pings — then flashes the tab title, beeps and raises a
   desktop notification.
   …
   ✓ On the clipboard since 2:07:13 PM · 547 lines
 ──────────────────────────────────────────────────────────────────────────────
 copied                                         c copy · ↑/↓ scroll · q back
```

Press `c` and the script is on your clipboard. Then board your ship with the
fishing kit, sail to an island — any but the home harbour, where no ping ever
rolls — paste it into the DevTools console on `/treasure-world`, and click
**Start** in the 🧭 panel it adds at the bottom left. Piped, the command prints
the script instead: `blackhat coast-bot | pbcopy` does the same as `c`.

| Option        | Meaning                                                |
| ------------- | ------------------------------------------------------ |
| `-1, --once`  | Print the script and exit (the default when piped)     |

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

The Coast Bot makes no requests from here. Its script, running in your browser
as you, reads `GET /api/treasure-world` and the tile map once when pasted.

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
ids. Those are the website's internals, not an API, so a change to any of them
can stop the bot — it fails by not moving or not stopping, never by writing
anything the game wouldn't take from a keyboard.
