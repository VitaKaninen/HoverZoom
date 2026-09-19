# Handoff — the learned wait for a late player (`E62`), open issue

Written 2026-09-18 at v0.112.0 for the session that picks this up. The reasoning for every
decision is in [`GATES.md`](GATES.md) under `E62`; this file is only what that session needs to
resume the troubleshooting, and it should be deleted when the issue below is closed.

## Where things stand

Seven versions in one day, v0.106.0 → v0.112.0, all on this one feature. The shape that survived
(read `GATES.md` `E62` for why each earlier shape was wrong):

- **Trigger** = a preview that was on screen closes with the pointer still inside the rectangle
  the picture had at hover time — `selfClosed(why, x, y)`, called from every page-driven close.
  Not from Escape / right-click / scroll / blur / keyup / `verifyMedia`. Not within 2.5 s of a
  press or key (`lastUserAct`). Not while `holding`.
- **Grace** = nothing paints before 150 ms on any site (`PLAYER_GRACE_MS`); the 100 ms poll
  (`watchTimer`) checks for a player rectangle and for the picture leaving the document.
- **Rule** = `{dom, path}` prefixes, learned from 3 flashes sharing ≥2 chain levels;
  `domChain(el)` is the picture's tag then up to 7 ancestors as `tag.classes` with digits → `#`.
  Several rules per site, one `ms` per site, never site-wide unless the user adds the site.
- **Storage** = `cfg.videoDelays[host] = {ms, rules, samples, fixes, user}`; panel section
  "Wait for the page's own video preview on these sites" at the bottom of Advanced; the number
  on a learned row is click-to-edit and stays learned.
- **Pure arithmetic** — `vdLearn`, `vdRuleFor`, `chainPrefix`, `pathPrefix`, `vdNorm` — is
  sliced into `test-resolver.js` (312 assertions pass). Browser-verified on
  `test-pages/late-player.html` in all four modes (default, `?slow`, `?instant`, `?swap`).

## The open issue

The user's site: **one page of videos in a 4×9 grid — one area, from the user's point of view.**
The panel says the site has **learned 2 areas**; previews **still flash** there; and the row is
**not** showing `· another area, n of 3` — so the flashes are neither being sampled as a new area
nor, apparently, as an update.

The user deleted and relearned the entry several times under earlier versions, so the stored
entry may hold rules learned under the v0.106.0–v0.111.0 key (converted by `vdNorm()` into rules
on `/`; their `dom` strings were built without digit normalisation and with a 4-class cap, so they
may or may not prefix-match v0.112.0 chains). **First step: have the user delete the entry and
relearn under v0.112.0 before diagnosing anything.**

### Hypotheses, in the order to test them

1. **The flashes are covered by a rule and are going to `fixes`, not to a new area.** Then the
   row reads `· updating, n of 3` and the `late player:` debug line says `resampled`. If so the
   only problem is that `ms` is too short, and three flashes fix it. Check the row first.
2. **The flashes are not being recorded at all.** Debug on; hover; a flash must print
   `the page took the preview away — <why>`. If a flash prints nothing:
   - the close went through a path that is **not a `selfClosed` call site**. The strongest
     candidate is the **`scroll` listener** (window capture, `if (!placed && !panelOwns(e)) cancel()`):
     a site whose player insertion shifts layout fires `scroll` on some ancestor, and that cancel
     records nothing. Second: `verifyMedia`'s size-mismatch cancel (`E45`). Third: `blur`.
     Diagnose by adding a `dbg()` inside `cancel()` printing `new Error().stack.split('\n')[2]`.
   - the pointer is judged **outside `activeRect`**: the card scales on hover (CSS transform), or
     the grid reflows when the player loads, so the picture's hover-time rectangle no longer holds
     the pointer. `selfClosed` uses the rect from hover time on purpose; if this is the cause, the
     test should tolerate growth (compare against the element's *current* rect too, when it is
     still connected).
   - `lastUserAct` is under 2.5 s: the user is clicking or scrolling with keys between hovers.
     The debug line for that case is `closed on its own, but after a press or key — not counted`.
3. **The flashes are recorded but every sample is dropped as "another area".** `vdLearn` keeps
   only samples sharing ≥ `RULE_MIN` (2) chain levels with the newest. Level 0 is always `img`, so
   if **level 1 varies between cards** — `a.thumb` vs `a.thumb.hd`, or a class that carries
   non-digit state (`new`, `watched`, `loaded`) — every pair shares exactly 1 level, each new
   sample evicts the last, and the count never reaches 3. The row would show
   `· another area, 1 of 3` forever, or flicker. The `late player: sampled` debug line prints the
   chain; compare two cards' chains. Fixes, in order of preference: normalise more than digits at
   level 1 (Forum Stumbler's `signature()` keeps only the first two classes); or let `RULE_MIN`
   be 1 when level 1 differs only by class and the tags agree; or compute the prefix ignoring one
   differing level.
4. **The two learned areas are both the grid**, learned under two different keys (one old, one
   new, or two class variants of the same card), and the flashes are on a third variant. Same
   root cause as 3, seen from the other side. The stored rules' `dom` strings show it.

### What to collect from the user, verbatim

Debug on (settings → Diagnostics, or `document.dispatchEvent(new CustomEvent('hover-zoom:debug',
{detail: true}))` in the console for this page only), then one flash:

- the `hover` line's `lateWait` field — says whether a rule applies to this picture and which;
- the `preview withdrawn` / `the page took the preview away` line, or its **absence**;
- the `late player: <change>` line — its `chain` and `path`;
- the stored entry — the `loaded` line prints a summary; the panel row prints the rest;
- the `chain` of a **second** card in the same grid, for comparison.

## Do not redo

- Do not reintroduce a fixed grace longer than 150 ms, remembered exclusions, site-wide
  widening, or learning from silent (never-painted) withdrawals — each was shipped and reversed,
  and `GATES.md` `E62` says why.
- Do not test the wheel or hover timing through the Browser pane's `scroll`/`hover` actions
  without first probing the coordinate mapping (`TESTING.md`); the pane's `scroll` delivers no
  `wheel` events to the page at all.
- The settings panel now survives a same-site navigation (v0.110.0, sessionStorage); close it
  before hovering fixtures in the pane or the hovers land on the panel.
