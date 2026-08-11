# Blackhat app shell — a menu, and features that keep working behind it

`hatchery-cli` becomes `blackhat-cli`: a small app shell that draws a main menu
and hands the screen to whichever feature you open. The Hatchery is the first
(and for now only) entry. The load-bearing change is splitting `runDashboard()`
into a **service** that polls and does the chores — started at launch, running
whether or not you're looking — and a **screen** that only turns that state into
lines when its menu item is open.

## Key decisions

- **Services do the work, screens only draw** (new). Today `lib/tui.mjs:133`
  fuses the polling timer, the chores and the rendering into one closure, so the
  refresh loop exists only while the dashboard is on screen. A service owns
  `state`, its own timer, and every write; a screen is a pure function from that
  state to lines. This split *is* the feature request — nothing else in the spec
  matters as much.
- **Every registered service starts at boot and stops only on quit** (new). The
  app starts all services before drawing the first frame, regardless of which
  screen is frontmost. Chores therefore run from launch even if you never open
  the Hatchery, and state accumulated while it was closed (last chore round,
  last error) is there when you do open it.
- **Redraw is unconditional and cheap** (reuses). The app calls `draw()` on every
  key, every 1 s tick, and every service `change` event — with no dirty tracking
  and no subscribe/unsubscribe on screen entry. This is only affordable because
  `Screen.paint()` already diffs line-by-line and writes nothing when nothing
  changed (`lib/tui.mjs:86`). Leaning on that existing property deletes a whole
  category of design problem.
- **The service schedules itself; the app's interval is redraw-only** (extends).
  Today one 1 Hz `setInterval` both repaints and decides when to refresh
  (`lib/tui.mjs:428`). The service instead holds a single `setTimeout` aimed at
  `state.nextAt`, rescheduled after each round; `refreshNow()` clears and fires
  it. The app keeps a 1 Hz interval purely to repaint clocks and countdowns.
- **The app owns chrome and scrolling** (extends). Header bar, rules, footer
  layout, the `fit()` hint-shedding and all scroll clamping move to `lib/app.mjs`
  and work for every screen. `HEADER_ROWS` / `FOOTER_ROWS` stop being the
  constants `4` / `2` and become computed per draw, because screens contribute a
  variable number of header lines (Hatchery two, the menu one).
- **`Api` stays app-level; `fetchSnapshot()` moves into the feature** (extends).
  Login, the JWT cache and `get`/`post` are shared Mermaid Office plumbing that a
  second feature will want as-is. `fetchSnapshot()` is Hatchery-shaped — it knows
  `/api/critter` — so it moves to `lib/features/hatchery/service.mjs`.
- **Flags belong to the feature that owns them** (new). `--interval`, `--once`,
  `--no-care` and `--plain` are only accepted after a command name; bare
  `blackhat` takes only app flags and runs every service on its defaults. No
  global flag namespace to keep de-conflicted as features are added.
- **Clean-break rename** (breaking). Binary `blackhat`, credentials file
  `~/.blackhat.env`, override `BLACKHAT_ENV_FILE`, token cache
  `~/.cache/blackhat/`. `MERMAID_URL` / `MERMAID_EMAIL` / `MERMAID_PASSWORD` are
  unchanged — they name the server, not this CLI. Existing cron lines and a
  `~/.mermaid-office.env` need editing; the README says so.
- **`q` pops instead of quitting** (breaking). On a feature screen `q` / `Esc` /
  `←` return to the menu; only on the menu does `q` exit. `Ctrl-C` still exits
  from anywhere. This changes an existing habit for the Hatchery view.

## Goals

- A main menu as the app's front door, generated from a feature registry, with
  the Hatchery as its one entry.
- The Hatchery's polling and chores run from launch to quit, independent of what
  is on screen.
- Adding feature #2 is a folder plus one line in the registry — no edits to the
  app shell, the CLI parser, or the menu.
- Nothing outside `lib/features/hatchery/` carries Hatchery vocabulary, and the
  tool's own names (binary, credentials file, cache) stop saying `hatchery`.
- The one-shot / `--json` / piped paths keep working, for cron.

## Non-goals

- **No daemon.** Background means "while the app is open". Keeping critters
  tended with no terminal open stays cron's job.
- **No second feature.** The registry gets exactly one entry.
- No change to the care policy: `CARE_FLOOR`, `needsCare()`, the endpoints called
  and the never-hatch rule are all untouched.
- No config file, no plugin loading from disk — the registry is a source file.
- No new dependencies. The folder stays standalone Node 18+ with zero packages.

## Design

### Layout

```
blackhat.mjs                    entry: app flags, command dispatch, credentials
lib/app.mjs                     screen stack, ticker, key dispatch, chrome, scroll
lib/menu.mjs                    the main-menu screen
lib/registry.mjs                the feature list — one line per feature
lib/api.mjs                     Mermaid Office client: login, JWT cache, get/post
lib/env.mjs                     credentials loading
lib/term/ansi.mjs               (was lib/ansi.mjs, unchanged)
lib/term/screen.mjs             the diff-painting Screen + parseKeys (was in tui.mjs)
lib/features/hatchery/index.mjs the feature descriptor
lib/features/hatchery/service.mjs  polls, tends, holds state  ← always running
lib/features/hatchery/screen.mjs   renders that state         ← only when open
lib/features/hatchery/care.mjs     (was lib/care.mjs, unchanged)
lib/features/hatchery/format.mjs   (was lib/format.mjs, unchanged)
```

`lib/tui.mjs` is deleted: its `Screen` class and `parseKeys` go to
`lib/term/screen.mjs` verbatim, its run loop becomes `lib/app.mjs`, its
`refresh()` becomes the Hatchery service, and its `headerLines` / `bodyLines` /
`footerLines` become the Hatchery screen.

### The two contracts

A **feature descriptor** is a plain object, so the registry is a list of imports:

```js
export default {
  id: "hatchery",
  title: "Hatchery",
  icon: "🥚",
  blurb: "Tend and watch your critters",
  parseFlags(argv),            // → feature options, or fail()
  createService(ctx, flags),   // ctx = { api }
  createScreen(service),
  runOnce(ctx, flags),         // the piped / --once path; returns { json, lines }
};
```

A **service** exposes state and a way to hear about it. No base class — the
shape is small enough to write out, and one feature can't tell us what a shared
`Poller` helper should look like. Extract that when the second one lands:

```js
{ state, start(), stop(), subscribe(fn) /* → unsubscribe */,
  activity() /* "idle" | "working" | "error" */ }
```

A **screen** is a renderer plus a key handler:

```js
{ title, headerLines(cols), bodyLines(), footerBits(), keyHints(),
  onKey(key) /* → true if handled */ }
```

`onKey` returning `false` hands the key to the app's defaults: `↑↓ jk PgUp PgDn
g G` scroll, `q Esc ←` pop, `Ctrl-C` quit. So a screen overrides only what it
cares about — the menu takes `↑↓` for its selection, the Hatchery screen takes
`u` and `c` and lets scrolling fall through.

### The app loop

`lib/app.mjs` walks the registry once at boot into a list of
`{ feature, service, screen }` — the map the menu draws from and the app starts,
stops and dispatches keys against. It then opens the alternate screen, puts stdin
in raw mode, starts every service, pushes the menu, and draws. A frame is
`[titleBar, ...screen.headerLines(cols), rule, ...window, rule, footer]`, where
`window` is the screen's body clamped to the space left over — the same
arithmetic as `lib/tui.mjs:272`, but with the header height read from the screen
instead of the constant `4`, and still floored at one body row so a very short
terminal can't compute a negative height.

Scroll position lives on the app, keyed by screen, so returning to a feature puts
you back where you were. Screens are constructed once at startup alongside their
service, not per visit.

Cleanup is the existing `lib/tui.mjs:334` block plus `service.stop()` for each
service, still wired to `SIGINT` / `SIGTERM` / `process.on("exit")` so a thrown
bug can't leave the terminal in the alternate buffer with a hidden cursor.

### The menu

```
 🧜 BLACKHAT                              you@example.com  14:32:07
 ──────────────────────────────────────────────────────────────────
   🥚  Hatchery              Tend and watch your critters        ⟳
 ──────────────────────────────────────────────────────────────────
 1 feature                              ↑/↓ move · ↵ open · q quit
```

The selected row is drawn with `inverse()`. `↑↓` / `jk` move, `↵` / `→` / `l`
open, `q` quits.

The row deliberately carries **no status** — no counts, no coins, no "3 need
attention". The only thing it borrows from the background service is a dim
activity glyph on the right: `⟳` while a round is in flight, `⚠` while the
service is in its error state, nothing when it's idle and healthy. That keeps
your "status only when opened" rule while still making a server that has gone
away visible from the front door instead of silently failing for an hour.

The identity on the title bar is `MERMAID_EMAIL` as read from the environment —
not the account name and balance, which would need a `/api/auth/me` fetch the
menu has no other reason to make.

### The Hatchery feature

The service is `lib/tui.mjs:295`'s `refresh()` lifted out with the `draw()` calls
replaced by `emit()`. Its state is today's dashboard state minus the presentation
bits (`scroll`, `bodyLength` stay on the app):

```js
{ data, error, updatedAt, refreshing, caring, lastCare, lastCareAt, nextAt }
```

`refreshNow()` and `careNow({ doCare: true })` are the `u` and `c` keys, now
methods rather than closures. `lastCare` / `lastCareAt` living on the service is
what makes a chore round done at 09:14 still reportable in the header when you
open the screen at 11:00.

The screen is `headerLines` / `bodyLines` / `footerLines` moved across
unchanged in substance — the two header lines (account + status), the critter
list from `renderCritter()`, the `needs attention` / `ready to hatch` footer
bits. `care.mjs` and `format.mjs` move folders with no edits.

### CLI surface

| Invocation | Does |
| --- | --- |
| `blackhat` | Menu app; every service on its defaults |
| `blackhat hatchery` | Same app, opened on the Hatchery screen |
| `blackhat hatchery --interval 30s --no-care` | Same, with that service configured |
| `blackhat hatchery --once` \| piped \| `--json` \| `--plain` | The one-shot / plain-loop paths, no app |
| `blackhat` piped, no command | `blackhat: name a command (try: blackhat hatchery)`, exit 1 |

App flags are `--color` / `--no-color`, `--env-file`, `--help`. Everything else
follows a command name. `blackhat --help` lists the registry; `blackhat hatchery
--help` prints the feature's own help. The entry also owns the `--plain --loop`
repetition, calling the feature's `runOnce()` on a timer and printing what comes
back — the app shell is never constructed on that path.

Two startup failures stay the entry's, because neither is a service's to hold:
a missing `MERMAID_EMAIL` / `MERMAID_PASSWORD` still aborts with `fail()` before
anything is drawn. A *reachability* failure no longer does — in app mode a
refused connection or a rejected login lands in `state.error` like any other
round, showing `⚠` on the menu and the message in the Hatchery header, rather
than exiting. That is a deliberate change from today's behaviour, where the
first fetch throwing kills the process.

Naming changes land in `package.json` (`name`, `bin: { blackhat }`, scripts),
`lib/env.mjs` (`ENV_FILE_CANDIDATES`, `BLACKHAT_ENV_FILE`), `lib/api.mjs`
(`TOKEN_DIR` → `~/.cache/blackhat`), the `fail()` prefix, `.env.example`, and a
README restructured as *the app* → *the Hatchery*, with the new cron line and a
note to `rm -rf ~/.cache/mermaid-office` and rename any `~/.mermaid-office.env`.

## Alternatives considered

- **One central store, features contribute tickers.** A single `app.state` with a
  slice per feature and screens as pure functions of it. Better for a future
  combined dashboard, but every feature's concerns leak into one shared shape and
  the existing refresh/error/retry logic would have to be rewritten as reducer
  steps. Ceremony for one feature.
- **Detached daemon plus thin TUI client.** `blackhat daemon` polls headless, the
  TUI attaches over a socket. It's the only design where chores survive quitting,
  but it buys process lifecycle, a wire protocol, stale-daemon and version-skew
  handling — for a job cron already does. The service contract above is exactly
  what such a daemon would host, so this stays reachable without a rewrite.
- **Keeping the `hatchery-status` bin and env-file fallbacks as shims.** Rejected
  in favour of the clean break: two names for one tool is a permanent tax to
  spare a one-line cron edit.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** It's one refactor with one seam: the service and
  screen contracts have to line up across `lib/app.mjs`, `lib/menu.mjs` and both
  halves of the Hatchery feature, so a second agent would spend its time
  guessing at the other's interface. Most of the volume is moving existing code
  between files, but the `(new)` decisions — where the timer lives, what the app
  redraws on — have to be interpreted rather than transcribed.
