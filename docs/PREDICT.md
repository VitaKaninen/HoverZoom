# Prediction log (v0.435.0, user 2026-11-26; v0.436.0 timings, queue, export)

Purpose: compare what the user does in galleries with what loading ahead (GALLERY.md "Loading ahead") had
ready, so the guesses are tuned from evidence. **It is not learning**: nothing in it changes behaviour. The
user rejected per-user/per-site behaviour learning (shared computer; behaviour differs by site).

**Anonymous by rule (user):** no hostnames, URLs, titles or picture addresses — ever. A site is `s` + FNV-1a
of (random salt + host), the salt stored with the log; a gallery is its door's number on its page
(`galDoorList` order, 1-based, 0 = not on the page); pictures are numbers. Adding a field: keep it this way.

- Setting `predictLog` (default on, Settings → Diagnostics, Copy / Show / Clear). GM key `hoverZoomPredict`
  `{salt, ev, cut}`, one log for all sites and tabs, last `PRED_MAX` 8000 events. Written every 3 s and on
  `pagehide` (`predFlush` re-reads first, so tabs append, not overwrite). Top frame only.
- **Export** (user v0.436.0: how the log reaches Claude): manager menu → *Export prediction log* (`predExport`).
  Writes the page's `sum` first, then saves the events after `cut` (the last export's end; all of them when
  nothing is new) as `hover-zoom-predict-<date>_<time>.txt` via `GM_download` `saveAs: true` (anchor fallback).
  A userscript cannot pick the folder: the save dialog does, and the browser reopens it where it was last. The
  user posts the file into the chat. `cut` shifts down when `PRED_MAX` trims the front.
- Events (`pg` = page-load id, `t` = seconds since its first event):
  `page` {v, tab, site, per, cfg {la: Load all, en: Endless, mb: gallery memory MB}, doors, n: pictures per door
  or null} once per page load · `open` {g, sw: 1 = the queue switched to it, land, th, q} · `look` {g, th} ·
  `page` {g, dir, p: page stepped to, th, q} · `more` {g, p, q}: a step past the list read so far (waits on
  `galTourMore`) · `ready` {g, p, ms, first, n}: that page's thumbnails all in, ms from the press; `cut: 1` +
  `th` when the user moved on first · `mode` {m: P|G} · `gstep` {dir, q} · `pv` / `slide` {g, i, pre, q} ·
  `set` {k: endless|last|loadall, v} · `list` {g, from, n, ms, end}: a frame read of the open or a queued gallery
  ended · `halt` {why: limited|memory, g, or} · `close` {g, p} · `gsum` {g, n, th, or, dr}: a gallery left
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
  `pre` per `pv`; `gsum`/`sum` for traffic the user never reached.
