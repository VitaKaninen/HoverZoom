# Prediction log (v0.435.0, user 2026-11-26)

Purpose: compare what the user does in galleries with what loading ahead (GALLERY.md "Loading ahead") had
ready, so the guesses are tuned from evidence. **It is not learning**: nothing in it changes behaviour. The
user rejected per-user/per-site behaviour learning (shared computer; behaviour differs by site).

**Anonymous by rule (user):** no hostnames, URLs, titles or picture addresses — ever. A site is `s` + FNV-1a
of (random salt + host), the salt stored with the log; a gallery is its door's number on its page
(`galDoorList` order, 1-based, 0 = not on the page); pictures are numbers. Adding a field: keep it this way.

- Setting `predictLog` (default on, Settings → Diagnostics, Copy / Show / Clear). GM key `hoverZoomPredict`
  `{salt, ev}`, one log for all sites, last `PRED_MAX` 8000 events. Written every 3 s and on `pagehide`
  (`predFlush` re-reads first, so tabs append, not overwrite). Top frame only.
- Events (`pg` = page-load id, `t` = seconds since its first event):
  `page` {site, doors, n: pictures per door or null} once per page load, at its first event ·
  `open` {g, sw: 1 = the queue switched to it, land, th} · `look` {g, th} (gallery preview) ·
  `page` {g, dir, p: page stepped to, th} · `mode` {m: P|G} · `gstep` {dir} · `pv` / `slide` {g, i, pre} ·
  `set` {k: endless|last|loadall, v} · `close` {g, p} · `sum` {why: close|leave, g: [{g, n, th, or}]}.
- `th` = [thumbnails of that page already loaded, of the page's size] at the moment of the step (`galPer`; before
  a gallery is open, `galPer(null)` is a window-based guess). `pre` = its original was loaded before the preview
  (`hqTried && hit`). `sum.th`/`sum.or` = picture numbers loaded (thumbnails in `galThumbDone`, originals found),
  as ranges.
- Reading it: for each `open`/`page`/`pv`, was it ready (`th` full, `pre` 1)? From `sum`, what loaded that the
  user never reached (wasted traffic).
