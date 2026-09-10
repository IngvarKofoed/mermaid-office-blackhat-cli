# The Still — a menu item that keeps a batch fermenting

A third feature folder, for the prison's Bilge Brew still. Its background
service watches whether you are in The Brig, starts a batch whenever the still
is empty, and nags you — once, on the OS — when the odds say holding is no
longer worth it. Bottling itself stays yours: the whole game is deciding when
to stop, so the tool never makes that call. It is the Hatchery's `--no-care`
split applied to a second feature — automate the free action, leave the gamble
to the player.

## Outcome

**What you get:**

- A third menu item, The Still, whose service keeps a batch fermenting
  whenever you are in The Brig, whether or not its screen is open.
- One OS banner per session when the odds say the batch has stopped being
  worth holding, and no repeat on a poll that found nothing new.
- The nightly patrol notification rendered with its die, its DC and its
  outcome, in place of today's bare kind name.
- Bottling as a confirmed keypress, on a screen showing tonight's odds, last
  night's roll, and what you have already banked.

**How to verify:**

- Jailed with an empty still, launch the app and stay on the menu. Within one
  poll interval the still holds a batch, and the header names when it started.
- Let a weekday night pass. The patrol notification reads with its die, its DC
  and the new unit count, rather than as a bare kind name.
- With a batch past the point where holding pays, one banner arrives, and a
  later poll that finds nothing new raises no second one.
- Press the bottle key once, then any other key: nothing moves. Press it
  twice: the banked total in the header rises by the batch's units without
  waiting for the next poll.

## Key decisions

- **Its own feature folder** (reuses). `lib/features/brew/` exporting the
  descriptor shape, plus one line in `lib/registry.mjs`. Nothing in the shell
  changes; `requires()` is not needed, since this is plain `fetch` with no
  WebSocket.
- **Auto-start on by default, auto-bottle never** (extends). `--no-start` is
  the exact analogue of the Hatchery's `--no-care`. It earns the default by
  being weakly dominant rather than free: a fresh batch carries the lowest
  possible DC and a zero-unit batch poured by the guard loses nothing, so on
  a weekday the tool can only gain you nights. The one exception is real and
  is disclosed, not waved away — see *The restart night* below. Bottling is
  the decision the feature exists to protect, so it never happens without a
  keypress.
- **Jailed-ness comes from `GET /api/prison`** (new). `GET /api/prison/brew`
  answers `{ batch: null }` both for a free player and for a jailed player with
  an empty still — opposite situations for a reminder tool. `/api/prison`
  returns the caller's own `cellIndex`, non-null exactly while imprisoned, and
  it is the only REST signal for this: `/api/auth/me` does not carry it.
- **The bottle rule needs no mirrored constants** (new). Hold while
  `odds × (units + 1) > units`, both fields shipped by the server on every
  read. The comparison is strict, and a tie means hold — at +2 with three
  units it is exactly equal, and the game's published advice there is to hold
  for a fourth. The game's own tuning lever (`BREW_BASE_DC`) never enters the
  CLI, so the README's "staying in sync" list does not grow.
- **A weekday label, not a countdown** (reuses). The next patrol is a team-day
  string with no instant attached, and the team timezone is not served by any
  endpoint. Rendering "tonight" / "Monday night" / "the still sleeps this
  weekend" copies what the website does rather than mirroring a third constant
  for a cosmetic clock.
- **Bottling asks first** (diverges). `b` arms a confirmation in the footer and
  a second `b` commits it. Every other screen here holds no state of its own;
  this one holds a single transient boolean, because a stray keypress on a
  four-unit batch banks it early and costs the next batch a night.
- **The night's result is a Notifications toast, not a brew toast** (extends).
  `lib/features/notifications/format.mjs` gains copy for `brew_patrol` and
  `brew_bottled`, which today fall through its generic renderer and read
  "Brew patrol" with no die and no outcome. The brew service toasts only the
  states that want a decision, which is a different set from the night's
  result — but not a disjoint one. A night that adds a unit and leaves the
  batch across the line raises both, and that pairing is accepted rather than
  suppressed: the two say different things, and the second is the one that
  wants an action.
- **Three reads while jailed, one while free** (new). A free player's round
  stops after `/api/prison`; there is no still to report and nothing to start.

## Goals

- Never lose a night to having forgotten to start a batch.
- Say plainly, while you can still act on it, when the batch has stopped being
  worth holding.
- Make the nightly patrol legible in the notification you already get, instead
  of a bare kind name.
- Show what bottling has actually banked, so the decision has a visible
  consequence.
- Add a third feature without the shell or the menu knowing anything about it.
  The Notifications formatter is the one deliberate exception, and the Key
  decision above says why.

## Non-goals

- No auto-bottling, at a threshold or otherwise.
- Nothing else in The Brig: no tunnel, no lock, no commissary, no swaps, no
  Meyer. The still only.
- No spending brew, and no coins anywhere — this feature moves one contraband
  currency and never touches the balance.
- No countdown to the patrol, and no deriving or shifting team days on the
  client. Naming the weekday of a day the server already chose is the one
  piece of date handling here, and *The screen* says how to get it right.
- No cross-feature event bus. Services stay independent.

## Design

### Layout

```
lib/features/brew/
  index.mjs     descriptor: id, flags, help, runOnce
  service.mjs   the poll timer, the auto-start, all the state
  format.mjs    a batch → lines; the phrases and the hold rule
  screen.mjs    state → lines, and the three keys
```

One line in `lib/registry.mjs` puts it third on the menu, after the Hatchery
and Notifications. Id `brew`, title "The Still", icon 🍶.

### What a round reads

`GET /api/prison` first, for `cellIndex`. When it is null the round is over:
the player is not in The Brig, and the screen says so. When it is a number the
round also reads `GET /api/prison/brew` for the batch and
`GET /api/prison/contraband` for `stash.brew`, the units already banked, so
bottling has a visible consequence on screen.

The batch, as the server ships it:

```js
{ batch: { startedDay, units,
           tonight: { dc, modifier, odds, firstPatrolDay, isTonight },
           lastPatrol: { roll, modifier, total, dc, success, … } | null,
           weekendPause } }
```

`lastPatrol` is null until the first survived night, and on a live batch it is
always a success — a pour deletes the row, and the loss lives only in its
notification. Bottling answers `{ brew }`, which is the units taken out of
*this batch*, not the new stash total; the total comes from the contraband
read. All three reads are free of side effects, unlike the Hatchery's board
poll.

The poll defaults to 5 minutes, `--interval` to change it, matching the
Hatchery. The interval is about screen freshness rather than correctness: a
batch started at 09:00 and one started at 09:05 are patrolled the same night.
The one place it bites is the boundary — jailed at 23:58, polled at 00:03, and
the night is gone — which is the argument against making it much longer.

### Auto-start

A round starts a batch when all three hold: `cellIndex` is non-null, `batch` is
null, and both reads succeeded. That last condition is the one worth stating,
because the failure it prevents is the obvious bug — offering or attempting a
start against a stale or errored read, whose only possible answer is a
conflict.

Two error codes from `POST /api/prison/brew/start` are not failures and must
not surface as one. `409 batch_exists` means the website started a batch a
moment ago; `403 not_imprisoned` means the player was released between the two
calls. Both are answered by re-reading, not by an error in the header. Both
arrive as `err.code` on the throw from `lib/api.mjs`, which already lifts the
body's `error` field for exactly this. A successful start returns the whole
batch view, the same shape the GET returns, so the round can use it directly
instead of re-reading.

The service records what it did and when, exactly as the Hatchery records its
chores, so a batch started at 09:14 is still reportable when you open the
screen at 11:00. It does not toast — an action you did not have to think about
does not deserve a banner.

### The restart night

A batch started on a day its brewer has already bottled forfeits its first
*rolling* night, which is the rule that makes holding a small batch a real
choice rather than an obvious loss. On a weekday it costs the tool nothing:
bottle on Monday and restart at once and the first roll is Tuesday night,
which is exactly where a Monday-forgotten, Tuesday-started batch would land
it.

On a weekend it does cost something. Bottle on a Saturday and restart at once
and the marker is stamped at Monday, so the first roll is Tuesday night —
where waiting until Sunday would have rolled on Monday. Auto-start therefore
spends one real night, about a third of a unit, in exchange for never
forgetting.

That trade is accepted rather than engineered around. The alternative is a
local-clock guess at "have I already bottled today", which the CLI cannot ask
the server for: the team day is only ever visible on a batch that already
exists, and a bottling done on the website is invisible either way. So the
design keeps the unconditional start and makes the cost legible instead —
whenever the returned view comes back with `isTonight` false, the screen names
the forfeited night in the website's own words, "first patrol Tuesday night —
the guards saw the bottles go out", rather than quietly showing a batch that
will not roll tonight.

Note the one-way door: a zero-unit bottling writes no ledger row, so bottling
the fresh batch and starting again does not clear the penalty. Once it has
landed it is spent.

### The bottle nag

Holding *u* units through tonight is worth `odds × (u + 1)`; bottling now is
worth `u`. So the batch has stopped paying once `odds × (units + 1) < units`,
and that is the whole rule. The comparison is strict, so an exact tie holds:
at +2 with three units the two sides are both 3, and the game's published
advice is to hold for a fourth. Compare in whole numbers —
`odds × 20 × (units + 1)` against `20 × units` — because the interesting cases
are exact ties and `odds` is always a twentieth.

At no Dexterity modifier the nag fires at three units, at +2 at four, and it
stays correct if the server retunes the curve, because both numbers come down
the wire.

It toasts when the state changes, never on a poll that found nothing new: once
when a round first sees the batch across the line, and again on each later
night that adds a unit while it is still across. First sight counts as a
change, so opening the app to an already-ripe batch nags immediately rather
than waiting for a crossing it missed. A weekend pause changes nothing here —
the advice is the same, there is just no roll coming.

The dedup is in memory, like every other piece of state here bar the cached
token, so it is per-process: two app sessions on one evening will each nag
once. That is the Notifications precedent rather than a shortcut — and for the
same reason, `runOnce` never toasts at all. A piped or cron round prints the
nag as a line in its report, which is the whole point of that path.

With `--no-start`, the empty still gets the same treatment: one toast when a
round finds you jailed with nothing fermenting. With auto-start on, that state
resolves itself and never toasts.

### The screen

```
🍶 THE STILL                                    cell 3 · banked 7 🍶

  Batch    ●●●  3 units             started Tuesday
  Tonight  DC 8 · Stealth +2 · about 75%
  Last     rolled 14 +2 = 16 vs DC 7 · survived

  ⚠ holding no longer pays — bottle it

  auto-started this batch at 09:14

  b bottle · u refresh · q back
```

Three states, and the copy differs in each. Free: "Not in The Brig — nothing
fermenting." Jailed with no batch: the invitation to start, or the note that
one is being started. Jailed with a batch: the block above.

The patrol line is a phrase, not a clock, and one helper owns all three cases
so they cannot contradict each other. A weekend pause wins over "tonight",
which is the specific bug the website hit and fixed: a Saturday start rendered
"the first patrol is tonight" directly against "the guards are off".

The weekday name is the one piece of date arithmetic here, and the obvious way
to write it is wrong: `new Date("2026-09-14")` is parsed as UTC midnight, so
`getDay` reports the day before anywhere west of it. Split the string and use
`Date.UTC` with `getUTCDay`. The team day is already the server's answer; all
this does is name it.

Only the keys that can do something are offered. `s` appears on an empty
still, never beside a live batch, where its only possible answer is the
conflict the auto-start path is careful to treat as benign. `b` appears only
with a batch.

`b` arms a confirmation and the footer asks; a second `b` bottles, any other
key cancels. Arming re-reads the batch first, so the number you are asked to
confirm is not one from a five-minute-old poll, and the prompt names it.
Bottling can still legitimately fail with `409 no_batch`: the server's sweep
runs every thirty seconds and a failed patrol deletes the row, so a batch can
be poured out between the poll and the keypress. That answer is not an error
in the ordinary sense and reads as one line — the guard got there first — and
either outcome is followed by an immediate re-read, so the banked total and
the batch both settle at once rather than after the next poll.

### Notifications copy

`format.mjs` in the notifications feature gains the two kinds, written out the
way the seven critter kinds are, with copy matching the site:

- `brew_patrol`, valence flipping on `outcome` — "The night patrol passed"
  with the roll, the DC and the new unit count, or "The guard found your still"
  with the roll and how many units went down the drain.
- `brew_bottled` — "Your batch was bottled as you walked out", with the units.
  It fires on release only; a manual bottling's receipt is its response.

`featureOf` learns to return "The Still" for both, so the toast subtitle names
the feature the way it already does for the Hatchery.

### CLI

`blackhat brew` opens the screen; piped or in cron it does one round and exits,
which is where the auto-start earns its keep. Flags follow the Hatchery's:
`--once` / `-1`, `--loop`, `--interval` / `-i`, `--plain`, `--json`, `--help`,
and `--no-start` for the one behaviour that writes.

There is deliberately no `--bottle`. A flag is not auto-bottling, but a flag in
a cron line is, and the reminder is what this feature is for.

## Alternatives considered

- **Auto-bottle at a threshold.** Solves "remember to collect" outright, but it
  plays the push-your-luck game on the player's behalf — and the game exists
  because that choice is interesting. It is this design plus one flag if it is
  ever wanted.
- **Watch and remind only, no writes at all.** The purest reading of "don't
  touch my account", and the Hatchery already rejected it for the same reason:
  the free action is free, and leaving it undone is the thing the tool was
  installed to prevent.
- **Fold the still into the Notifications screen.** The reminders are the
  point, and `brew_patrol` already arrives there. But there is state to show
  and two actions to take, which is a screen, not a feed row.
- **A countdown to the next patrol.** Wants the team timezone and a
  weekend-skipping day walk, neither of which the API ships. A weekday name
  costs nothing and cannot drift.
- **Letting a `brew_patrol` on the Notifications socket pull the next round
  forward**, the way the website invalidates its brew query on that kind. It
  would need a cross-service bus the shell does not have, to save at most one
  poll interval on a state that changes once a night.
- **Reading jailed-ness off the contraband response instead**, which carries a
  `rollCalls` object exactly when the caller is imprisoned. It would collapse
  two reads into one, but it infers the fact from a field's presence where
  `/api/prison` states it outright, and a server that starts sending
  `rollCalls` to everyone would break it silently.
- **Suppressing auto-start on a day the tool already bottled**, to dodge the
  restart night's weekend cost. Never worse and sometimes better, but it rests
  on a local-clock guess at the team day, and it cannot see a bottling done on
  the website. One night, rarely, is the cheaper price.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One new folder of four modules whose shapes define
  each other — the service's `state` is what the screen and the formatter both
  render — plus one line in `lib/registry.mjs` and about thirty lines in the
  notifications formatter. Nothing here splits into streams that would not
  immediately need each other's decisions.
- Opus rather than Sonnet because three things have to be interpreted rather
  than transcribed: the confirm state that diverges from this repo's "screens
  hold nothing" rule, the strict tie-holds comparison in the nag, and the
  house comment voice, which carries the reasoning and is most of the review
  surface in a codebase with no tests.
