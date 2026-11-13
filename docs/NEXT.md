# Next work — consistency pass (proposed 2026-11-12, NOT agreed yet)

The user asked for every mode (hover, pinned, slideshow, gallery) to behave the same however it was
reached, fewer ways to do things, and a design a newcomer can learn. Trigger: a 683-picture gallery
shows only 9-15 cells (`galRows` fits everything on one screen). Nothing below is built; each item
waits on the user's yes. Ask before building, quote the old reason where one is overturned.

## Inconsistencies found (from INTERACTION.md / TOUR.md / GALLERY.md)

1. Slideshow list depends on the start: widget = page minus sidebars; from a picture = smallest area
   around it (`S25`, `E60`). Old reason: a forum post's pictures without the replies.
2. Pinned frame may outgrow the screen (`E21`); slideshow frame is capped at it (`growBox`).
3. Two remembered positions, hover's and slideshow's (`E64`); entering a slideshow from a moved
   window jumps it to the slideshow's spot, keeps hand size, resets zoom (`T30`).
4. → / ← pan if the picture can pan sideways, else step (`T30`): a hidden mode keyed to zoom.
5. Gallery mode is per site and turns ordinary previews off and hides the widget (`siteEnabled`).
   Reaching it takes two steps (site list or menu, then the button).
6. Ctrl tap = previews on/off normally, open gallery in gallery mode. Middle = save on a preview,
   open gallery on a result, browser default elsewhere.
7. Gallery mode has no INTERACTION.md IDs at all (v0.246.0-v0.280.0).
8. 70 stored settings (`DEFAULTS`).

## Proposal (recommendations, in build order)

A. **Door/leaf decides, not a mode** — learning + refusal BUILT v0.281.0 (`GATES.md` `P17`); the peek and
   retiring the per-site gallery switch are not. Leaf: preview. Door: no preview; a
   click follows the link (fixes previews pinning on search pages); a peek opens its contact sheet.
   Replaces the per-site gallery switch and "previews off" state. Peek gesture: middle-click (as now)
   plus a small visible chip on a hovered door, for discoverability.
B. **The contact sheet is a page**: inside it hover/pin/slideshow work as anywhere; the widget stays
   and counts that gallery's pictures. Huge galleries: pages of readable cells (pending question
   "Which layout for huge galleries?" — recommend pages, wheel flips, "page 2 / 20" on the sheet).
   Originals preload for the visible page only (683 × `galHqAll` today).
C. User's idea: widget ◀ ▶ flip sheet pages showing "page n / N". Recommended instead: ◀ ▶ always
   mean next picture; the sheet follows a slideshow to the page holding it. Undecided.
D. One slideshow scope whatever the start (start picture only picks the position); one remembered
   window position; a slideshow keeps the window where it is; same frame rules pinned or touring.
E. Arrows always step; pan by drag. Old reason for arrow-pan to be weighed with the user.
F. Newcomer: first-use hint line in the bar, a `?` gesture sheet, tooltips on seen/visited/saved
   marks, settings split into ~8 basic and the rest advanced.

After any of this lands: add gallery/peek IDs to INTERACTION.md.
