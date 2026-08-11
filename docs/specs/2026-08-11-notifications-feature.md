# Notifications — a menu item, and OS toasts

A second feature: `lib/features/notifications/`. Its service holds a WebSocket to
`/ws` from app launch, keeps a feed of your notifications, and raises a macOS
notification for each one that arrives *live*. Its screen lists the feed when you
open the menu item.

This is the first real test of the claim that adding a feature is a folder plus
one line in `lib/registry.mjs`, and it very nearly holds: the one shell change is
a *generic* hook, `requires()`, that exists because this feature needs a runtime
capability the app can't assume.

## Key decisions

- **The socket lives in the feature's service** (reuses). Exactly the shape
  `lib/features/hatchery/service.mjs` established: the service owns the
  connection, the state and the writes; the screen is a pure renderer. Because
  `lib/app.mjs` starts every service at boot, the socket opens at launch and
  toasts fire from the menu, the Hatchery, anywhere. `lib/app.mjs` is untouched;
  `blackhat.mjs` gains only the generic `requires()` check below.
- **Only live arrivals toast; the backlog never does** (new). `start()` fetches
  `GET /api/notifications?limit=50` and records every id in a `seen` set with no
  toasts at all. After that, anything unseen raises one. Without this, launching
  on a Monday fires fifty notifications at once — which is the single worst thing
  this feature could do.
- **Bursts coalesce at 3** (new). Any batch of newly-seen notifications toasts at
  most three individually; beyond that, one summary ("and 7 more"). One rule
  covers both a burst and the re-sync after a reconnect, so neither needs a
  special case.
- **We do not mirror the frontend's formatter** (diverges). `frontend/src/features/notifications/format.ts`
  is 847 lines across ~60 kinds. Copying it would be the largest sync liability in
  this repo. Instead `format.mjs` hand-writes the seven `critter_*` kinds and
  renders every other kind generically from well-known `data` keys. It never
  returns null — an unrecognised kind still reads sensibly.
- **`osascript` is invoked through argv, never a built string** (new).
  Notification text contains other players' names and chat previews — untrusted
  input. `execFile("osascript", ["-e", "on run argv", …, "--", body, title])`
  passes text as arguments, so a critter named `" & (do shell script "…") & "`
  cannot inject AppleScript. Verified against exactly that string.
- **`lib/notify.mjs` is app-level** (new). A thin platform wrapper, sibling to
  `lib/api.mjs` — it knows nothing about notifications as a domain, only how to
  ask this OS to show a message. Unlike the `Poller` helper the last spec
  deliberately didn't extract, this isn't an abstraction over a pattern we've
  only seen once; it's a wrapper over a platform API.
- **Node < 22 stops the app, via a generic `requires()` hook** (extends). Global
  `WebSocket` needs Node 22, and an unmet runtime requirement is fatal — the same
  loud treatment `blackhat.mjs:132` already gives a missing `fetch`, not the soft
  `⚠` an unreachable server gets. The check itself does *not* go in the shell:
  the descriptor gains an optional `requires()` returning an error string or
  null, and the shell fails with whichever feature's requirement isn't met. That
  keeps the shell free of feature knowledge and stops the next feature with a
  runtime need from adding a second bespoke guard.
- **`requires()` is about the *service*, so only the app enforces it** (new). The
  socket is opened by the background service and by nothing else — the
  notifications `runOnce()` is a plain REST fetch. The check therefore runs where
  services are started, not at process startup, so `blackhat hatchery --once` in
  cron still works on Node 18. `engines.node` becomes `>=22` for the app while
  the one-shot paths stay usable below it, and the README says which is which.
- **Holding the socket open claims your daily login bonus** (new). The server
  does this on connect (`ws/index.ts:1726`) and again every 30 s heartbeat
  (`ws/index.ts:2471`). This is the app's second write after the Hatchery chores,
  it is not optional while connected, and README and `--help` say so plainly.

## Goals

- A Notifications menu item listing what has happened, newest first, unread
  marked.
- An OS notification the moment something arrives, wherever you are in the app.
- Prove the feature contract: a folder and a registry line, with the only shell
  change being a generic hook no future feature has to re-add.
- Notifications the CLI has never heard of still render as something readable.

## Non-goals

- **No per-kind toast filtering.** Everything toasts; `--no-toast` turns the lot
  off. The coalescing rule is what bounds the noise.
- **No acting on a notification.** No opening the Hatchery from a `critter_ready`,
  no replying to a chat. The web app owns those; `href` is dropped.
- **The Hatchery does not react to pushes.** A `critter_ready` will not pull its
  refresh forward — that was approach B, and it needs the socket on `ctx`.
- No Windows toasts in this version — win32 is a no-op.
- No local persistence: the feed is the server's, re-fetched at each launch.

## Design

### Layout

```
lib/notify.mjs                          ask the OS to show a message
lib/features/notifications/index.mjs    the descriptor
lib/features/notifications/service.mjs  socket, feed, toast policy
lib/features/notifications/screen.mjs   the list
lib/features/notifications/format.mjs   kind → { icon, title, preview }
```

plus one line in `lib/registry.mjs`, the `engines` bump in `package.json`, and
the `requires()` hook.

### The `requires()` hook

The descriptor gains one optional method:

```js
requires() {
  return typeof WebSocket === "function"
    ? null
    : `Node 22+ is required for notifications (this is ${process.version}) — no global WebSocket.`;
}
```

`blackhat.mjs` walks the registry and `fail()`s with the first non-null message,
**on the paths that start services** — the two `runApp()` calls — and not on the
`--once` / `--json` / `--plain` paths, which never open a socket. A feature
without the method is assumed satisfied, so the Hatchery doesn't declare one.

This placement is the whole point of the hook. It is checked before `runApp()`
rather than inside it so the failure is an ordinary `fail()` on a normal terminal,
not an exception thrown after the alternate screen is already open.

### The service

State, mirroring the Hatchery's shape closely enough to read at a glance:

```js
{ items, unreadCount, connected, error, updatedAt }
```

`items` is `NotificationView[]` newest-first — `{ id, kind, read, data, createdAt }`,
straight from the server with no local shape of our own.

`start()` runs in a deliberate order:

1. `GET /api/notifications?limit=50` through `ctx.api`. This seeds `items` and
   `unreadCount`, fills the `seen` id set, and — the reason it comes first —
   logs in, so `api.token` is populated before we need it for the socket URL.
   **This first fetch is the silent one**: it records ids without toasting. Every
   later fetch (a reconnect, the `u` key) toasts whatever it finds unseen.
2. Open `ws(s)://<host>/ws?token=<api.token>`, derived from `MERMAID_URL` by
   swapping the scheme.
3. `notification.created` prepends to `items`, bumps `unreadCount`, and toasts.
   `notification.read` updates the read flags in place.

`activity()` reports `working` while connecting, `error` when disconnected or
degraded, `idle` when connected — so the menu glyph means "the stream is up"
without revealing anything about its contents.

**Reconnect.** On close, back off 1 s → 2 → 4 → 8 → 16 → 30 s and hold at 30 s.
Every successful reconnect re-fetches, because anything that arrived while we
were away is missing from `items` — and unlike the launch fetch, that one *does*
toast what it finds unseen, under the same 3-and-summary rule. That is why no
separate "how long were we gone" logic is needed. A
handshake rejected with 401 means the cached JWT expired: call `api.login()` and
retry once immediately before falling into the backoff, mirroring the retry in
`Api.#authed`.

The server pings every 30 s and terminates connections that don't pong; Node's
built-in `WebSocket` answers pings itself, so there is nothing to implement.

### Toasting

`lib/notify.mjs` exports one function:

```js
export function osNotify({ title, subtitle, body })  // fire-and-forget, never throws
```

On darwin it runs `osascript` in the argv form described above. On linux it uses
`notify-send` when present. Anywhere else it is a no-op that sets a flag the
service reads once, so the screen can say OS notifications aren't available here
rather than the user wondering why nothing pops up. Failures are swallowed —
a missing notification is never worth taking the app down.

Title is `blackhat`, subtitle is the feature ("Hatchery" for `critter_*`, else
nothing), body is the formatted title. The summary toast for a coalesced burst
reads `7 more notifications`.

### Rendering

`format.mjs` exports `formatNotification(n) → { icon, title, preview }`, the same
shape the frontend uses minus `href`. The seven `critter_*` kinds are written out
with copy matching `frontend/src/features/notifications/format.ts:522-600` —
"Bubbles is getting hungry", "Cracky is ready to hatch!", and the `phase === "egg"`
branch that makes a dead egg read as *spoiled* rather than *died*.

Everything else falls through to a generic renderer: the kind becomes a title
(`coins_received` → "Coins received"), and the preview is assembled from whichever
of `fromName`, `name`, `preview`, `chatTitle`, `amount` the payload happens to
carry. It is deliberately unglamorous — the point is that a kind added to the
server next month shows up as *something* instead of vanishing or crashing.

The screen:

```
 🧜 BLACKHAT · NOTIFICATIONS                    you@example.com  14:32:07
 3 unread · listening
 ─────────────────────────────────────────────────────────────────────
  🍽️  Bubbles is getting hungry                                   2m ago
      Feed it before things get worse.
  🥚  Cracky is ready to hatch!                                   1h ago
      Head to the Hatchery and tap it to crack it open.
 ─────────────────────────────────────────────────────────────────────
 3 unread · [1–18/50]                    u refresh · a mark all read · q back
```

Unread entries are bold, read ones dim, and `relative()` from `lib/units.mjs`
gives the age. `u` re-fetches; `a` marks everything read via
`POST /api/notifications/read {all:true}` — a write, so it stays an explicit
keystroke rather than a side effect of looking at the screen.

### CLI

`blackhat notifications` opens the app on this screen. Its own flags are
`--limit <n>` (backlog size, default 50), `--no-toast`, plus the shared
`--once` / `--json` / `--plain` that the shell reads off `parseFlags`.
`runOnce()` prints the formatted list, so `blackhat notifications --once` works
in a pipe like the Hatchery does.

## Alternatives considered

- **The socket on `ctx`, shared by every feature.** Would let a `critter_ready`
  push pull the Hatchery's next refresh forward, and matches the fact that
  notifications genuinely span features. Rejected as scope: it puts a reconnect
  policy with two consumers into the shell before anything needs it. Moving the
  service's socket to `ctx` later is contained.
- **Polling `GET /api/notifications` instead.** Keeps zero dependencies and Node
  18 and avoids the daily-bonus write entirely, but throws away the 60 s
  server-side critter ticker that makes push worth having.
- **Mirroring the frontend formatter wholesale.** 847 lines of copy that drifts
  the moment the server adds a kind, in a repo whose README already apologises
  for mirroring two constants.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** Five new files, but they're one thread: the toast
  policy, the `seen` set and the reconnect all live in `service.mjs` and have to
  agree with each other, and `format.mjs` is what the screen and the toasts both
  read. The `(new)` decisions — what toasts and when, where `requires()` is
  enforced — need interpreting rather than transcribing, which is what rules out
  a cheaper tier.
- The one genuinely separable piece is `format.mjs`'s seven `critter_*` cases,
  transcribed from `format.ts:522-600`. Worth splitting off only if you're
  already fanning out for another reason.
