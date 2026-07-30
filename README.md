# Hatchery CLI

Keep an eye on your Mermaid Office Hatchery critters from the terminal — what
phase each one is in, how its two care meters are doing, what it's earning — and
**let it do the chores for you**. Run it bare; it needs no arguments.

```
🧜 Hatchery — 7/30/2026, 8:23:20 AM
Ingvar (ingvar) · 12,340 🪙
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

## This folder is standalone

It has **no dependencies** — no npm packages, and nothing imported from the
Mermaid Office repo. Copy or move the folder anywhere you like and it keeps
working. All it needs is Node 18+ and a reachable server.

```
hatchery-status.mjs   entry point: arguments, credentials, mode
lib/api.mjs           REST client, JWT cache
lib/format.mjs        board → lines of text (shared by both views)
lib/care.mjs          deciding and doing the chores (the only writes)
lib/tui.mjs           the live dashboard
lib/ansi.mjs          colours, screen control, terminal width maths
lib/env.mjs           credentials loading
```

## Setup

```sh
cp .env.example .env
chmod 600 .env          # it holds your password
$EDITOR .env
```

Then:

```sh
./hatchery-status.mjs
```

Credentials are read from environment variables, or from `KEY=VALUE` lines in
the first file that exists of:

1. `.env` beside the script (this folder)
2. `~/.mermaid-office.env`

A real environment variable always wins over the file, so you can also do:

```sh
MERMAID_URL=https://mermaid.example MERMAID_EMAIL=you@example.com \
  MERMAID_PASSWORD=... ./hatchery-status.mjs
```

| Variable           | Meaning                                           |
| ------------------ | ------------------------------------------------- |
| `MERMAID_URL`      | Server base URL (default `http://localhost:8601`) |
| `MERMAID_EMAIL`    | Your login email                                  |
| `MERMAID_PASSWORD` | Your password                                     |
| `MERMAID_ENV_FILE` | Read this credentials file instead                |

## Usage

Run it bare and it does the useful thing:

```sh
./hatchery-status.mjs
```

In a terminal that's a live dashboard, refreshing **and doing the chores** every
5 minutes. Piped or run from cron, it does one round and exits — cron is already
the scheduler, so looping there would be wrong.

```sh
./hatchery-status.mjs --once           # one round, even in a terminal
./hatchery-status.mjs --interval 30s   # a different cadence
./hatchery-status.mjs --no-care        # look, don't touch
./hatchery-status.mjs --json           # machine-readable
./hatchery-status.mjs --help
```

| Option                  | Meaning                                              |
| ----------------------- | ---------------------------------------------------- |
| `-1, --once`            | One round, then exit (the default when not a TTY)    |
| `--loop`                | Keep going even when piped                           |
| `-i, --interval <time>` | Refresh + tend cadence; default 5m (`-w` also works) |
| `--no-care`             | Only look; do no chores                              |
| `--plain`               | Re-print the report instead of drawing the dashboard |
| `--json`                | Print the raw board as JSON instead                  |
| `--env-file <path>`     | Read a specific credentials file                     |
| `--no-color`            | Plain output (`NO_COLOR` is honoured too)            |

Exit code is `0` on success, `1` on failure.

## Doing the chores

**This tool writes to your account by default.** Every round it feeds and cleans
every critter that needs it — on an egg the same two endpoints read as warming
and misting:

```
✓ Egg-Unpaid — warmed + misted · +625 🪙
✓ Sicky — fed + cleaned · saved from sickness, but today's coins are forfeit
✓ Drifting — fed + cleaned · already paid today
Tended 3 critters · earned 625 🪙
```

`--no-care` turns this off if you only want to look. In the dashboard, `c` does
a round of chores on the spot without waiting for the next refresh.

**"Needs it" means there's something to gain**, so a five-minute loop doesn't
hammer the server: a critter is tended when it hasn't been paid today (the
chores collect the daily coins), when it isn't happy, or when a meter has fallen
below **80%** (`CARE_FLOOR` in `lib/care.mjs`). One that's paid and still above
the line is skipped, as is one away with the sitter — its clocks are frozen and
the server refuses chores anyway. Run it twice in a row and the second run does
nothing at all.

That floor is really **the worst state the script may leave a critter in**, for
the times it isn't running — laptop shut, server down. A meter is the fraction
of the way to death, so 80% leaves ~58 h on an adult's hunger clock, ~38 h on
its tank, and ~29 h on an egg in the worst case: an overnight gap is
comfortable, and a whole day of downtime still doesn't kill anything. (Those are
_effective_ hours — weekends don't count against either clock.) Lower it and you
get fewer writes but a thinner safety net.

Two things it deliberately won't do:

- **It never hatches an egg.** A matured egg is still only reported as ready.
  Cracking it is three taps and a random colour reveal — that's the fun bit, and
  it's yours.
- **It won't skip a sick critter to protect your coins.** Tending one that has
  slipped into the sick band saves its life but forfeits that day's payout
  (the server's rule, not ours). Staying alive wins, and the report says so when
  it happens.

## The dashboard

In a terminal you get a full-screen view that refreshes on its own and takes
keystrokes:

| Key           | Does                              |
| ------------- | --------------------------------- |
| `u` (or `r`)  | Refresh right now                 |
| `c`           | Do the chores now                 |
| `↑` `↓`       | Scroll (`j` / `k` also work)      |
| `PgUp` `PgDn` | Scroll a page (space = page down) |
| `g` / `G`     | Jump to top / end                 |
| `q`           | Quit (`Ctrl-C` works too)         |

The header carries your balance, slot usage, when the board was last fetched,
and a live countdown to the next refresh.

**It doesn't blink.** The usual way to build one of these — clear the screen,
print the frame — flickers, because the terminal can render the blank moment in
between. Instead each frame is diffed against what's already on screen and only
the lines that actually changed are rewritten, in a single write. An idle second
repaints just the clock and the countdown; an unchanged screen writes nothing.

If the server goes away mid-session the dashboard keeps the last good board on
screen, shows the error and a retry countdown in the header, and carries on —
it won't blank or exit.

The header also reports the last round of chores — how many were tended and what
they earned.

When output isn't a terminal it runs once and exits instead of drawing anything,
so nothing puts escape codes in your logs. `--plain` gives you the plain report
in a terminal too, and `--loop` keeps a piped run repeating.

### Install it on your PATH

```sh
npm link          # from this folder; gives you a `hatchery-status` command
```

### Run it on a schedule

The dashboard is for a terminal you leave open. To keep the critters tended
while you're away, cron suits it better — a piped run already does exactly one
round, so no flags are needed. Note cron has almost no `PATH`, so use absolute
paths:

```cron
0 * * * * /usr/local/bin/node /path/to/hatchery-cli/hatchery-status.mjs --no-color >> /tmp/hatchery.log 2>&1
```

Add `--no-care` to that line if you want the log without the chores.

## How it works

It talks to the ordinary REST API — the same one the website uses:

- `POST /api/auth/login` for a token
- `GET /api/auth/me` for your name and coin balance
- `GET /api/critter` for the critter board
- `POST /api/critter/feed` and `/clean` — the chores, unless `--no-care`

The token is cached (mode `0600`) under `~/.cache/mermaid-office/`, keyed by
server + account, and re-minted automatically when it expires — so polling every
few minutes isn't a fresh login each time. Delete that folder to force a
re-login.

Even with `--no-care` there's one server-side effect worth knowing about: `GET
/api/critter` is the same call the Hatchery page makes, and the server derives
critter state on read — so a critter that has _already_ died gets recorded as
dead (and its notification fires) when you poll. Reading never _causes_ a death
and costs no coins.

## A note on staying in sync

Two display details are copied from the server, since the API doesn't send them:
the hatch-tap count (`HATCH_CLICKS_REQUIRED`) and the species display names
(derived from the `kind` id). Both are marked in the source. If a species is
renamed or the tap count is retuned, only the labels drift — nothing breaks.
