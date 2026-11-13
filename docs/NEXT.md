# Next work — consistency pass (handoff 2026-11-12, session ended at ~340k tokens)

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

## Not verified

Only local fixtures in the Browser pane. Not tried on nsfw.xxx or in LibreWolf + Tampermonkey.
The pane sends no scroll events, so the reading frame dispatches its own; pages that load via
IntersectionObserver are untested. ~100-picture galleries now take 2 pages (row floor 120) — the
user may want `GAL_MIN_H` lower.

## Remaining proposal (recommendations, each waits on the user's yes)

B (rest). The slideshow widget inside an open gallery, counting that gallery's pictures.
C. User's idea: widget ◀ ▶ flip gallery pages showing "page n / N". Recommended instead: ◀ ▶ always
   mean next picture; the gallery follows a slideshow to the page holding it. Undecided.
Retire gallery mode (per-site switch, previews off, widget hidden) now that peek works without it.
D. One slideshow scope whatever the start (old reason: a forum post's pictures without the replies;
   `S25`, `E60`); one remembered window position instead of two (`E64`); a slideshow keeps the
   window where it is; same frame rules pinned or touring (`E21` vs `growBox`).
E. Arrows always step; pan by drag (today → pans when the picture can pan sideways, `T30`).
F. Newcomer: first-use hint line in the bar, a `?` gesture sheet, tooltips on seen/visited/saved
   marks, settings split into ~8 basic and the rest of the 70 advanced.

## Last exchange

User tested B on sexygirlspics.com: expected the gallery widget and menu item gone (that is "Retire
gallery mode" above — never built, still waits on a yes), and saw no chip. v0.283.0 fixes the chip
cause; the user then saw home-page tiles (→ result lists) get the chip — v0.284.0. No question is outstanding.
