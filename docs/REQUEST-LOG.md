# Shared request log (`us-log`)

Source: `shared/us-log.js`. Copied verbatim between `// ==== us-log begin/end ====` into
Forum Stumbler and Hover Zoom by `node shared/sync-shared.js` (run from HoverZoom; `--check`
reports drift). **Never edit a synced copy.** Tests: `node shared/test-log.js` — the module, and
Hover Zoom's wiring pulled out of `Hover-Zoom.user.js` by name. Forum Stumbler's wiring is in its
own `CLAUDE.md` and `tests/bar-render.test.js`.

## Why it exists — and what not to add yet

The user's decision (2026-10-28): **collect logs first; the user brings them after a rate limit;
analyse them together; only then rewrite the pacing.** Still the rule for **Hover Zoom** (permanent
per-host one-at-a-time). **Forum Stumbler** got a learned per-host pace the same day at the user's
explicit request (design: `Forum-Stumbler/docs/PAGE-READING.md` "Learned pace per host") — its
constants are guesses; tune them from FS `pace` rows rather than adding more logic.

Original candidate design (FS built a simpler variant; check HZ work against the logs):
- Honour `Retry-After` (seconds or HTTP date — `retryAfterOf` already parses both).
- In-run retry with backoff on the refused page; that alone may cover the transient case.
- Per-host tier = one integer, a ladder of request-gap multipliers (×1 ×2 ×4 ×8, then serial).
  Demote two tiers on a hard refusal; promote one after *k* consecutive clean reads (event-driven,
  not a timer); remember the tier last refused at and double the patience each time it fails
  again; after a long settled span, allow one probe up (time-driven). Never above tier 0.
- A soft block (challenge page) is usually bot detection, not rate — it must not move the ladder.
- One tier per read. Changing pace mid-read makes every row uninterpretable.

## Privacy — the invariant

- Rows hold counts, timings, status codes and short codes. The only identifying field is the
  hostname; `text({ anon: true })` replaces it with `siteN`.
- `hostName()` reduces even a whole URL to its host; `clean()` cuts every label at the first
  `/ ? #`. A URL handed in by mistake keeps none of its path. Asserted in `test-log.js`.
- **The log never holds a host the script did not already store.** Forum Stumbler reads only
  opted-in forums; Hover Zoom logs only hosts that refused, which `hoverZoomNoRush` already keeps.
  Hover Zoom runs on every site: logging its ordinary requests would be a browsing history.
- `clean()` cutting at `?` means a label must never contain one — a `'?'` fallback version once
  emptied the whole pace label.

## Format

Stored (GM, one key per script): `{ v: 1, hosts: { h: { reads, reqs, limits, first, last } }, rows }`,
rows capped at 400 (front evicted); the host summary outlives eviction.

| row field | meaning |
|---|---|
| `t` `ms` | start (epoch ms), elapsed |
| `h` `i` | hostname; random per-page-instance id (two at once = two tabs or a re-render) |
| `k` | kind: `range` `quick` `verify` `tail` `hunt` (FS reads; `quick` = arrival read that stops at the last read, `verify` = its slow background re-check), `busy` `norush` (HZ) `pace` (FS) (notes) |
| `p` | pace label the read ran under, e.g. `v0.84.0 w6 g300-800 d400` (workers, start gap, serial delay) |
| `n` `ok` `pg` | requests made; answered 2xx/3xx; pages that had topics |
| `sp` | measured gap between request starts, `[min, median, max]` ms |
| `since` | ms from this host's previous read *ending* — the refresh-a-minute-later signal |
| `nr` | the host was already on the one-at-a-time list |
| `out` | `done` `end` `limited` `error` `cancelled` `cut`; notes: `set` `clear` `first` `slowed` (HZ), `slower` `faster` `normal` `clear` (FS `pace`; `p` = new gap `g<ms>`), `missed` (FS `quick`: its background check found a link the quick read did not show) |
| `ev` | refusals: `{ a: request #, s: status, w: hard/soft, ra: Retry-After s, dt: ms into the read }` |

A successful request logs status 200 whatever 2xx/3xx it was. Text export: one line per row,
columns as the header names them; **times are UTC** (a fingerprinting-resistant browser may report
UTC as local, so local would be ambiguous).

## Rules that prevent regressions

- `end()` and `note()` **re-read the store before writing** — another tab may have written since;
  the same stale-copy loss Forum Stumbler's visit history had (its 0.65.0). Test: *another tab's
  row is kept*.
- A read is one row, written once at `end()`; a second `end()` is ignored.
- `cutOpen()` on `pagehide` (Forum Stumbler) writes a read cut by a navigation or refresh as
  `cut`. **Unverified:** whether a `GM_setValue` made during `pagehide` survives in the user's
  manager on LibreWolf. If real logs never show `cut` after a mid-read refresh, that is why.

## Hover Zoom's wiring

- `diagnose()` → `logBusy(url, r)` **before** `hardBlock()`, or every refusal reads as `slowed`.
  One row per host per page (`loggedBusy`); `out` is `first`, or `slowed` if the host was already
  one-at-a-time — the row that says the climb-down did not stop the refusals.
- `hardBlock()` adds a `norush set` row. `hzLog()` re-reads `cfg.logRequests` on every call
  (another tab may have changed it). No `start()` in Hover Zoom: its requests are per picture.
- **Hover Zoom's one-at-a-time list has no undo** — nothing ever deletes from `hoverZoomNoRush`.
- Settings → Diagnostics: the switch, the count, Copy for sharing / Show / Clear.
- The test page stubs no `GM_xmlhttpRequest`, so `rangeGet` returns null and `diagnose()` can only
  answer `unknown` there. `test-server.py` refuses anything under `/limited/` with 429 +
  `Retry-After: 120`. To drive it: shim `window.GM_xmlhttpRequest` with `fetch` at run time, inject
  a link to `/limited/<new name>.jpg` (verdicts are cached per URL), hover it. The pane must be
  **visible** — hidden, the page gets no frames and the hover never starts.

## When the user brings a log — what to check first

- `since` on the refused read: a refresh re-reads the whole span on arrival (by design, Forum
  Stumbler 0.31.0). Before 0.85.0 **closing Forum Stumbler's Settings did too** (`closeAll` → `rescan()`
  rebuilds the panel). Two reads seconds apart on one host is the leading suspect.
- `ev.a` and `sp` on refused reads: refused at a consistent request count/gap = a real rate limit
  (that number is the limit); refused on request 1 = not caused by our pacing.
- The same window across hosts: refusals on several hosts at once point at the user's connection,
  not any one site.
- `nr`/`slowed`: refusals while already one-at-a-time mean the current climb-down does not work.
- Known small gap: Forum Stumbler's hand-off from the page-address probe to the range walk starts
  the next request one round trip after the last, skipping the configured gap.
