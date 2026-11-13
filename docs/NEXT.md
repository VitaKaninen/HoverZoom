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
  Not changed: nsfw.xxx post pages refuse the preview because the page already draws the picture
  as tall as the window (`bigEnough`) — offered to the user, no answer yet.

## Not verified

Not tried in LibreWolf + Tampermonkey.
The pane sends no scroll events, so the reading frame dispatches its own; pages that load via
IntersectionObserver are untested. ~100-picture galleries now take 2 pages (row floor 120) — the
user may want `GAL_MIN_H` lower.

## Remaining proposal (recommendations, each waits on the user's yes)

B (rest). The slideshow widget inside an open gallery, counting that gallery's pictures.
C. User's idea: widget ◀ ▶ flip gallery pages showing "page n / N". Recommended instead: ◀ ▶ always
   mean next picture; the gallery follows a slideshow to the page holding it. Undecided.
D. One slideshow scope whatever the start (old reason: a forum post's pictures without the replies;
   `S25`, `E60`); one remembered window position instead of two (`E64`); a slideshow keeps the
   window where it is; same frame rules pinned or touring (`E21` vs `growBox`).
E. Arrows always step; pan by drag (today → pans when the picture can pan sideways, `T30`).
F. Newcomer: first-use hint line in the bar, a `?` gesture sheet, tooltips on seen/visited/saved
   marks, settings split into ~8 basic and the rest of the 70 advanced.

## Last exchange

2026-11-13 session: user asked for the nsfw.xxx gallery changes in v0.292.0–v0.293.0 (above), the
last being: clicked picture flies to the bottom-right corner and back, chip/tick/disc in one dark
pill, press-to-pin the same inside the gallery. All built, checked in Chrome by synthetic events
only (the flight animation itself unseen; LibreWolf untested). One question asked, **unanswered**:
should nsfw.xxx post pages preview a picture the page already draws as tall as the window
(`bigEnough` refuses it today)? Leftover: an empty stray file `C:\Users\VITAKA~1\AppData\Local\Temp\s1.py`
(a safety check blocked deleting it; the user was asked to remove it).
