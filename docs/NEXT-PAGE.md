# Next-page finding — the shared `us-next` block

One copy, `shared/us-next.js`, synced into Hover Zoom, Forum Stumbler and Open Links in New Tab by
`node shared/sync-shared.js` (never edit a synced copy). Suite: `node shared/test-next.js`. Pure apart
from reading the DOM it is given; no storage, no `location`.

## Two questions, kept apart

- **Which link is the next page** — `usNext.find(root, base, o)` → `{ url, a, how }` or null. HZ
  (`nextPageIn`) and FS (`detectNextRecord`) use it.
- **Is this link a pager control at all**, either direction — `usNext.pagerReason(link, extra)` → a
  sentence or null. OLINT (`nextPageReason`) uses it to keep pager links in the same tab.

## `find`: rungs, best first

1. `rel="next"` (`<link>` or `<a>`), same site.
2. `o.learned(base)` — the caller's own layer. FS passes its learned page address (`learnedNext`).
3. A numbered pager (skipped with `o.noNumbers`; FS passes its `cfg.scroll`):
   `pickPagerGroup` picks the group of bare-number links by `groupSig` (FS's `signature(a, true)`
   algorithm) whose numbers start ≤ 2 with a consecutive run and pass `pagerShapeOk` (comment counts
   are refused there: FS `docs/PAGE-READING.md`). `pickNumericNext` then locates "here" by, in order:
   the URL's own page number (`pageNumOf`), the lone narrow hole (`pagerCurrentFromGap` — works on
   windowed `1 … 5 6 [7] 8 9 … 42`), the pager's active/aria-current marker, the smallest unlinked
   number; first one whose `+1` is linked wins; one at the top of the list means last page.
4. A forward word (`pickTextNext`), two tiers: **exact** (whole label is a control — `nextText`,
   arrows stripped — or an icon-only link labelled/classed next) before **loose** (a forward word in a
   label ≤ 40 chars, nothing backward in it). The exact tier exists so a blog's ten `Read more`
   links cannot drown its one `← Older posts`.

**Ambiguity is refused, never guessed (user, 2026-11-27).** Two different `rel=next` → rung 1 is
skipped; a number linking two places → no numeric answer; two different destinations in a word tier
→ none. A wrong next page walks a slideshow or tour into the wrong pages in silence. FS used to take
the first; it now refuses like HZ did.

Exceptions inside the pager rung, each for a real shape: numbers exactly `1,3` pass the run check
(page 2 of 3); a group whose URLs carry no digit (`/gallery/two/`) skips the shape check.
A window that does not show page 1 (`4 5 6 [7] 8 9`, eporner) needs a run of 3. `groupSig` takes the link's
own tag without classes: eporner marks pager links `extrapages1`/`extrapages2`, which split the group.

Options: `o.norm(url, base)` (FS passes its `norm`: no trailing slash, collapsed slashes; default
strips the hash), `o.skip(url)` (HZ refuses pictures and clips).

## What stays in each script

- **FS:** the taught pager (`cfg.nextSig`) is authoritative and runs *instead of* `find` — falling
  through let a comment-count link become the next page. It reuses `pickNumericNext`/`pickTextNext`
  on the taught group. Learned page address and its probe stay FS's (user: not shared).
- **OLINT:** sort controls (`new`, `top`, …), `reply`, `refresh`, `show more related videos`, and
  "more replies/comments" are not pager controls; OLINT passes them as `extra` / checks them itself.
- **HZ:** nothing beyond `skip`.

`deriveTemplateFromChain` (page N → URL from this page and its next) lives in the block because
`pagerShapeOk` needs it; its two shapes are in FS `docs/PAGE-READING.md`. Testing trap: a shape-A
"ambiguous" fixture returns null down another path and asserts nothing — only shape B can be ambiguous.
