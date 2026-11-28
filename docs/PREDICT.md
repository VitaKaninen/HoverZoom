# Prediction log (v0.435.0, user 2026-11-26; v0.436.0 timings, queue, export)

Purpose: compare what the user does in galleries with what loading ahead (GALLERY.md "Loading ahead") had
ready, so the guesses are tuned from evidence. **It is not learning**: nothing in it changes behaviour. Behaviour
learning is a separate feature, L26 (GALLERY.md "Hover patterns"), which the user asked for 2026-11-28 after first
rejecting it (shared computer; behaviour differs by site) — per site and a rolling 20 galleries answer both.
The user (2026-11-28): most of this logging comes out if the script is published; a hover-wait field would not help
them (they hover for specific shots, unpredictable), so it was not added.

**Anonymous by rule (user):** no hostnames, URLs, titles or picture addresses — ever. A site is `s` + FNV-1a
of (random salt + host), the salt stored with the log; a gallery is its door's number on its page
(`galDoorList` order, 1-based, 0 = not on the page); pictures are numbers. Adding a field: keep it this way.

- Setting `predictLog` (default on, Settings → Diagnostics, Copy / Show / Clear). GM key `hoverZoomPredict`
  `{salt, ev, cut}`, one log for all sites and tabs, last `PRED_MAX` 8000 events. Written every 3 s and on
  `pagehide` (`predFlush` re-reads first, so tabs append, not overwrite). Top frame only.
- **Export** (how the log reaches Claude): manager menu → *Export all collected data*, or the row's Export
  (SETTINGS.md "Collected data"). Export all writes the page's `sum` first. `cut` is no longer read.
  A userscript cannot pick the folder: the save dialog does, and the browser reopens it where it was last. The
  user posts the file into the chat. `cut` shifts down when `PRED_MAX` trims the front.
- Events (`pg` = page-load id, `t` = seconds since its first event):
  `page` {v, at: local time to the minute (v0.464.0, to line up with the request log), tab, site, per, cfg {la: Load all, en: Endless, mb: gallery memory MB}, doors, n: pictures per door
  or null} once per page load · `open` {g, sw: 1 = the queue switched to it, ls: 1 = its list was read before the switch (sw only), land, th, q} · `look` {g, th} ·
  `page` {g, dir, p: page stepped to, th, q} · `more` {g, p, q}: a step past the list read so far (waits on
  `galTourMore`) · `ready` {g, p, ms, first, n}: that page's thumbnails all in, ms from the press; `cut: 1` +
  `th` when the user moved on first · `mode` {m: P|G} · `gstep` {dir, q} · `pv` / `slide` {g, i, pre, pat: 1 = a learned L26 place, q} (`pv` = a preview shown, v0.443.0; before that every cell the pointer crossed) · `save` {g, i, p: its page, on: the page on screen} (a middle-press save of a gallery picture) ·
  `set` {k: endless|last|loadall, v} · `list` {g, from, n, ms, end}: a frame read of the open or a queued gallery
  ended · `halt` {why: limited|memory|froze, g, or} (memory: once per gallery, v0.464.0) · `close` {g, p} · `gsum` {g, n, th, or, dr}: a gallery left
  (closed or the queue moved on) · `sum` {why: leave|export, g: [{gs, th, or, dr}]}: the page, galleries with
  equal totals grouped (`gs` = their numbers).
- `th` = [thumbnails of that page already loaded, of the page's size] (`galPer`; before a gallery is open,
  `galPer(null)` is a window-based guess, so `open`'s `of` can differ from `ready`'s `n`). `pre` = 1 original
  loaded ahead (`hqTried && hit`), 2 = in flight (`hqBusy`), 0 = not started. `q` = the paced gates
  (`ahPics`, `ahPages` as `p.`) per tag `[waiting, in flight]` (`ahGate`'s `on` counts), `vis` = the open
  gallery's own thumbnails loading (ungated). `or` = originals ever loaded ahead (`predOr`, set beside
  `hqTried`; survives the memory keep, which clears `hqTried`), `dr` = those since dropped.
- `ready` hooks: `predWatch` from `galFlip`, `galMiddle`, the read-on step; `predCheck` from `galThumbSettled`
  and `galShow`. A repeat watch of the same page keeps the first press's time.
- Reading it: per `open`/`page`, `ready.ms` is the wait the user saw; `q` at the press says what was ahead of it.
  `pre` per `pv`; `gsum`/`sum` for traffic the user never reached. A `q` taken at a press shows 0 in flight often
  because the press itself just cut them — not a stall.

## Findings, export 2026-11-28 (v0.448–v0.463, one site, Load all + Endless on, 2245 events)

- Thumbnail waits: page steps 221, median 33 ms (217 ready at press). Endless arrivals 155, median 617 ms, 63 > 1 s,
  179 s total = 76 % of all thumbnail waiting. Arrival with the next gallery's p1 already in: median 50 ms; with none
  in (74 of 155): median 1.7 s. Next gallery = this + 1 in 144/155, so the guess is right, it is just not loaded.
- Cause: L17 (`gal`) is waiting in 791/794 logged `q`s, in flight in 206; behind `galp` (L23) by the M7 order, and
  M11 = M6 puts it after L14 (the whole gallery's originals). Median stay before Endless moves on: 16 s.
- Hovers: 14 % `pre=0`; first hover on a gallery page 44/96 miss vs 45/538 later; `galp` in flight in 85/89 misses;
  first hover median 7.1 s after landing. `pv` has no wait time, so the miss cost is unmeasured.
- 130/219 gallery visits had no hover; 9094 originals loaded ahead, 592 distinct pictures hovered.
- M9 (a step back is temporary): 10 back steps → 6 forward, 3 back, 1 open. Supports it; small n.
- Proposed to the user (not built): L17's first gallery p1 ahead of L23/L14 under Endless (as `galL17First` in M10);
  add the hover's wait to `pv`.
- Built v0.464.0 from the gaps below: `at`, `ls`, `pat`, the halt once, request-log `origs` pace names its tags (`galp 12 galo 40`).
  Not built: hover wait (user: no use to them), position on the page, `q` before cuts (not confirmed wrong).
- Log gaps hit in this analysis: `pv` has no wait ms; `i` is gallery-wide and page sizes
  vary, so position on the page cannot be derived (add `pi`); `q` at a press is read after its cuts (read it before);
  `open` sw:1 gives no L17 state for that gallery (none / list read / thumbs n); request-log `origs` rows carry no
  tag, so bytes per line (L23 vs L17) are unknown; no wall-clock on `page`, so it cannot be joined to the request
  log; the memory `halt` repeats on every hover (log once per gallery).
