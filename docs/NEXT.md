# Handoff 2026-11-13 (second session, ~411k tokens) — read this first

**Asked:** (1) audit the window and widget for mode-dependent differences (done, report given in chat);
(2) then: gallery stepping identical to the page slideshow; a hand-set size never carried to the next
picture; failure reason + ↻ only in debug mode; panel debug row renamed "Enable debug mode"; ↑ ↓ turn
the page (screens on a page, layout pages in a gallery); one widget for page and gallery (hold-repeat,
start number that follows page turns); click a number to type a target (Forum Stumbler's box); a
right-click menu on the widget with preview-position and widget settings; wheel: over preview zooms,
over widget flips, elsewhere scrolls the page and closes a pinned preview; cut the tuning settings.
Avatars/emoji left as they are (user).

**Done:** all of it, v0.317.0 (commit 7b14836, pushed). Where it lives: INTERACTION.md `S25`, `T24`,
`T30`, `T41`, `E22`, `E53`, `E56`, `G6`, `G9`; GALLERY.md "The widget" and "Stepping is the
slideshow's"; TOUR.md widget section (typed numbers, menu, wheel); SETTINGS.md "Tuning knobs folded
into constants". Verified only in the Browser pane on test-page.html and test-pages/door-search.html
(d6, 240 pictures): widget counts, steps, ↑ ↓, wheel on/off preview, typed picture and page, menu.
**Not verified:** a real site, LibreWolf, Tampermonkey; hand-resize reset (code only).

**User's answers (same day):** a wheel off a pinned preview closes it (keep as built). The gallery
widget change was wrong: v0.318.0 brings the strip back (in the picture's frame, dock/out, join
prompt, own memory) and hides the page widget in a gallery again; everything else of v0.317.0 stays,
including stepping through the slideshow engine (the strip's picture row → `galStep` → `twPress`).

**v0.319.0 (user's picks from that list):** the gallery widget got the start number, hold-to-repeat,
typed numbers, the page row as `galPageStep`, and the fade. The typed box closes on any press outside it.
The wheel flips pictures over either widget or the gallery's clicked picture, and never turns pages.
The fade is by distance (0 at 75 px). The page widget uses the gallery's palette and 4 px edge.
Originals preload for the page on screen plus `galAhead` pages.
**Open:** the user asked whether ⇅ is worth keeping (my answer: no, the wheel over the widget already
opens at the start number) and awaits their call. Typed numbers past what is loaded tested in Chrome
(v0.320.0): Google Images 100 → 300 → 380 over three tries, Bing 43 → 135; first try ~5 s cold, later ~0.2 s.

---

# Next work — consistency pass (handoff 2026-11-13, session ended at ~311k tokens)

## What the user asked for

Every mode (hover, pinned, slideshow, gallery) behaving the same however it was reached; fewer ways
to do one thing; a design a newcomer can learn without being told. Search/listing thumbnails that
only lead to another page must not preview (a click pinned a preview instead of opening the result).
Trigger: a 683-picture gallery on nsfw.xxx showed only 9–15 pictures. The user's own idea (item C)
is still undecided.

## Done (all committed and pushed)

- **A, v0.281.0** — door areas (`GATES.md` `P17`, INTERACTION.md `P17`): a thumbnail whose link leads
  to a page with no copy > 1.5× drawn stops previewing after 3 of a kind; out of the slideshow and
  widget count; 10 % silent recheck drops a wrong rule; Settings → Per-site fixes → Forget.
- **B, v0.282.0** — INTERACTION.md `G1`–`G8`, `GALLERY.md` "Peek, pages, reading on": middle-click on
  a door peeks on any site (▦ hint chip on hover); galleries page at 120 px rows (wheel,
  PageUp/PageDown, "Page n / N" line); an open gallery's page is read on by a scrolling hidden frame;
  originals preload for the page on screen only.
- **v0.283.0** — door verdict counts only the linked page's own copy (`trusted`); the thumbnail's own
  file / URL-rule upgrade no longer makes a leaf. Found on sexygirlspics.com (no door ever learned:
  no ▦ chip, gallery links kept previewing).
- **v0.284.0** — a linked page's grid cells are not a "bigger copy" (`gridMedia()`); doors split into
  gallery / results (`galKindOf()`, `GATES.md` P17): results doors get no chip and no peek. Checked
  against sexygirlspics' real pages by hand-run fetch snippet only; user tests it in Tampermonkey.
- INTERACTION.md was out of date (no gallery IDs at all); the `G` section now covers it.
- **v0.285.0–v0.289.0** (nsfw.xxx, tested live in Chrome — `TESTING.md`): chip shows on every door
  hover; clicking the chip opens the gallery; middle-click peek is now a setting, **off by default**;
  chip kind decided once per area per page; `<picture>` left out of the signature; seen mark, hole
  and ring sit on the visible (clipped) card, not the picture the site enlarges.
- **v0.290.0** — marks and chip read the card's own badges (`galMarkBlockers`, not hit-tested), so
  they land clear of nsfw.xxx's count badge from the start; a saved card shows disc and tick side by side.
- **v0.291.0** — gallery mode retired (`GALLERY.md` top). Peek on doors is the only way in.
- **v0.292.0** (nsfw.xxx, checked in Chrome by synthetic events): chip is a mark in the card (keeps
  the site's hover zoom), on every door by default, ✕ while open; ring yellow + pulsing + Close tab;
  the original card closes; presses between pictures are swallowed; cell click opens its post;
  cell previews and linkless pictures use the card's post link (`og:image` original); press-to-pin
  works through a site card over the picture; `toast()` showed the old tip text (fixed).
- **v0.293.0** (nsfw.xxx, Chrome, synthetic events): clicked picture flies to the bottom-right
  corner (1/5 window tall, full-size original) and back on close; blue border again, no tab; chip,
  tick, disc in one dark pill drawn in a shadow root (Dark Reader turned the inline one light);
  press on a gallery cell pins its preview like on a page (`composedPath`).
- **v0.294.0**: middle press on the corner picture closes again; right-click menu on it; move /
  resize mode remembered per site (`GALLERY.md`); ticks and saved discs can be switched off.
  Checked in Chrome by synthetic events; the user's stored place was reset after the test.
- **v0.295.0–v0.298.0**: the gallery eats the wheel with one page; dark from the flight; the first
  page of every gallery on screen read ahead (setting, on); reading stops at the site's appended feed.
- **v0.299.0** (user's design, 2026-11-13; this is B-rest and C, settled): the dock widget's `– / 0`
  stickiness removed (it hides under 2 pictures); the widget hides while a gallery is open; a
  two-row strip under the clicked picture (◀ Page ▶, ◀ picture ▶) replaces the top line; wheel /
  ← → step pictures in a pinned preview, the page follows; corner resize snaps to row edges, gap
  middles and the window's centre lines (Alt free); a browser-window resize keeps the gallery and
  lays it out again. Checked in the Browser pane by synthetic events on `door-big.html` (240).
- **v0.300.0** (user's design, 2026-11-13): Ctrl (not Alt, which moved the browser window) frees the
  snapping; the strip sits inside the picture's blue frame by default; in move-and-resize mode it
  detaches by dragging it, docks to the picture's top/bottom at its width and asks to join; edges
  also snap to the gallery's margin; an edge on a line follows that line on a window resize; the
  menu's "Put it back…" is "Reset position". Checked in the pane on `door-big.html` (detach, dock,
  join, keep apart, margin snap, centre/margin anchors after 1024×768 → 1400×900, Ctrl, reset).
- **v0.301.0–v0.306.0** (user, 2026-11-13): row floor setting; strip above a pinned preview (second
  ◀ ▶ press landed on the preview); a still pointer no longer moves the counter; no move/resize
  mode (drag anytime, invisible corners, drop saves, Reset position gone); page row only with 2+
  pages; text squeezes; detached strip text-wide; rows touching the picture stay whole; first-list
  feed judged (Chrome-verified on a post page); ⌕ chip previews a picture shown full size
  (`bigChip`). All but the feed checked in the pane by synthetic events.
- **v0.307.0–v0.309.0** (user, 2026-11-13): slideshow start = pinned preview or page's first, never
  a hover; wheel over any gallery preview zooms (a hover one is pinned); strip row gaps equal
  (`.pn`); full count read with pictures blanked in the frame, thumbnails fed by the user's
  page-ahead ramp; rows keep the standard gap at margins and beside the clicked picture; closing a
  gallery closes its pinned preview; ⌕ on the drawn picture's top-left. Pane-checked by synthetic
  events (feed 100 → 130 → 182 → 240 on pages 3–5). Blanking measured in Chrome by a plain frame;
  the full open on nsfw.xxx not run with v0.309.0. The snapped-row gap was an outdated install.
  nsfw.xxx "Irina" (/post/27358429): the site's copy is 960×1710, its source imgur (NSFW purged
  2023) — no bigger file exists to find.

- **v0.310.0–v0.311.0**: gallery frame lists video posts; boot fix (constant declared late).
- **v0.312.0** (D, part): one remembered window position (`spot`); a slideshow keeps a window already
  placed by hand or beside the pointer (`tour.hold`). Syntax + 587 assertions only; not tried in the
  pane or Tampermonkey. D left alone: scope (a pin on a widget-counted picture already opens the
  widget's list since v0.188.0; the start-picture scope only serves pictures the widget does not
  count, TOUR.md §1a) and the lightbox cap vs `E21` — both need the user's call.

- **v0.313.0** (user's design, 2026-11-13; most of E and part of F): the wheel flips anywhere off a
  pinned window (over it, it zooms); the blue ⇅ button starts the slideshow (at the pinned picture)
  and a second click closes it; arrows and `[ ]` always step, nothing pans from the keyboard (the
  `tourKeys` and `panStep` settings gone); `{ }` and the post/reply scope gone; the "scroll the page
  along on these sites" list and its learning gone (every site scrolls; `growsHere` removed); the frame
  is capped at the viewport pinned or touring (`maxSizeMultiple` gone); a click off the window never
  reaches the page except the sibling scripts' widgets; the widget gets a page row (◀ Page n / N ▶):
  it scrolls like Page Down and an open window jumps ahead by the pictures on that screen. Checked in
  the pane by synthetic events (widget wheel starts at 1, wheel off the window steps, over it does not,
  page ▶ jumped 2 and scrolled, button closes). Not tried in Tampermonkey; click-off not tried; the
  gallery was not touched. TOUR.md §1a and INTERACTION.md S25 prose still describe the old scope.

- **v0.314.0**: a pinned picture shows its number in the widget (`tourSync` at `place()`); a wheel over a hover preview or its picture pins and zooms it (`twWheel`) instead of scrolling the page. Pane-checked by synthetic events.

- **v0.315.0** (user's design, 2026-11-13): the window may fill the whole viewport (no widget floor, no link-bar strip unless `keepClearStatus`); `clearWidget` nudges it off the widget (`keepClearWidget` shrinks instead); `position` default `auto` (centre, else under the pointer; `last` retired → `remember`); flips go back to the centre unless dragged, drops held per tab in `sessionStorage`; `tour.hold` gone. Pane-checked: fills, no overlap at 1500×800. Nudge fallbacks, shrink option, tab memory not exercised; Tampermonkey not tried. Gallery's corner picture unchanged.

- **v0.316.0** (user, 2026-11-13): the idle widget shows the start number (first picture at/below the screen top, `twStartOf`); wheel/⇅ open at it, ▶ at +1, ◀ at −1; the widget fades to 0.25 under a covering window (`twOpacity`). Pane-checked by synthetic events (scroll → 4 / 25; wheel opened at 4; fade 0.25 covered, 1 after close). ▶/◀ buttons and Page ▶ at the end of a page not exercised.

## Not verified

Not tried in LibreWolf + Tampermonkey (incl. v0.300.0–v0.309.0).
The pane sends no scroll events, so the reading frame dispatches its own; pages that load via
IntersectionObserver are untested. Row floor is a setting since v0.301.0 (user: 120 is a good start). On a one-page gallery the snapped corner picture
stops lining up after ✓ (rows grow to fill) — told the user in v0.299.0's report, no answer. A row-line
anchor was checked by unit test only, not live.

## Remaining proposal (recommendations, each waits on the user's yes)

D. One slideshow scope whatever the start (old reason: a forum post's pictures without the replies;
   `S25`, `E60`); one remembered window position instead of two (`E64`); a slideshow keeps the
   window where it is; same frame rules pinned or touring (`E21` vs `growBox`).
E. Arrows always step; pan by drag (today → pans when the picture can pan sideways, `T30`).
F. Newcomer: first-use hint line in the bar, a `?` gesture sheet, tooltips on seen/visited/saved
   marks, settings split into ~8 basic and the rest of the 70 advanced. **Shelved (user, 2026-11-13):
   the script is unfinished, has one user and is not near publishing; do not propose it until asked.**

## Last exchange

2026-11-13: gallery strip and snapping (v0.299.0–v0.300.0), row floor (v0.301.0), then the user's
seven-point round (v0.302.0–v0.306.0), then v0.307.0–v0.309.0 (see above; user keeps video posts). Nothing asked.
