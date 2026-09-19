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
  sliced into `test-resolver.js` (329 assertions pass). Browser-verified on
  `test-pages/late-player.html` in all four modes (default, `?slow`, `?instant`, `?swap`).

## The open issue — closed in v0.114.0

The user's site: one page of videos in a 4×9 grid. Learned rows as separate areas; a rule did not
cover the next row and its flashes evicted the samples (panel 2 of 3 → 1 of 3). Diagnosed from
one v0.113.0 log: the card's `<a>` carried scroll-in state (`fade` / `fadeUp`), so level 1 of the
chain differed between rows and `chainPrefix` found only `img` in common. Fix in `GATES.md` `E62`:
levels compare by tag + shared classes, and a near-miss narrows the rule instead of starting
another area.

Second finding, same day, from the relearn under v0.114.0: with the wait in place the preview
painted and STAYED — the site's hover preview is a muted looping clip, gif-like once its metadata
is in, and `overVideoSurface()` skipped every gif, so it was caught only while `duration` was
`NaN`. v0.115.0 counts a clip over another picture as a player (`E12`); `?clip` on the fixture
reproduces it and is verified in the pane.

**Not yet confirmed on the site.** What to check after the user deletes the entry and relearns:

- three flashes → one rule whose `dom` is `img>a.<classes>>div.phimage>div.flexibleHeight.wrap`;
- a card in another row: either covered (`lateWait: applies here`) or `late player: widened`,
  never `another area`;
- a flash on a covered card with the wait in place → `resampled` / `updating, n of 3`;
- a withdrawal's `why` reads `(clip, Ns)` — and the preview no longer stays up over a playing
  clip.

Delete this file once that is seen.

## Do not redo

- Do not reintroduce a fixed grace longer than 150 ms, remembered exclusions, site-wide
  widening, or learning from silent (never-painted) withdrawals — each was shipped and reversed,
  and `GATES.md` `E62` says why.
- Do not test the wheel or hover timing through the Browser pane's `scroll`/`hover` actions
  without first probing the coordinate mapping (`TESTING.md`); the pane's `scroll` delivers no
  `wheel` events to the page at all.
- The settings panel now survives a same-site navigation (v0.110.0, sessionStorage); close it
  before hovering fixtures in the pane or the hovers land on the panel.
