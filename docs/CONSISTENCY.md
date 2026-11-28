# Consistency inventory

A good practice built in one place, and every other place of the same kind. Reasons live in the doc named in
the last column; this file only says where each pattern applies. Update a row when a sibling is added.

**The user's standing principles** (sessions 2026-11-13 and 2026-11-26): the same control behaves the same
whatever the mode, page type or route that opened it; fewer settings and fewer variants, judged for a newcomer;
a good idea built in one place goes everywhere it makes sense.

| Pattern | Holder | Siblings checked | Verdict | Reason in |
|---|---|---|---|---|
| A text box of ours owns input: nothing previews while it has focus | `typingOurs()` in `onOver`, `galPv` | number boxes (`twAsk`), zoom box (`zinEl`), Settings text/number boxes, rate and teach boxes | applied v0.426.0 (rate/teach only exist on a pinned preview, where nothing hovers anyway) | TOUR.md "Typed numbers" |
| A press away from a box goes only if the value changed, and does nothing else | `twAsk` (`twAskEatUntil`) | zoom box (`commitZoomField` in `onBoxDown`) | applied v0.426.0; teach box n/a (a dialog with its own buttons); rate box n/a (a menu: a press away closes it) | VIEWER.md zoom field |
| Going to another page closes any preview first | `twPageBtn` | page row ◀ ▶ (both widgets), ↑ ↓, PageUp/PageDown, typed page / gallery | applied v0.426.0 (keys: user's answer); typed picture keeps the slideshow | TOUR.md page row |
| ▶ with no page after says so | `galNoMore` | page widget's ▶ (`twNoMore`) | applied v0.426.0; ◀ at the first page: neither widget (not asked) | TOUR.md page row |
| Tooltips via `setTip`, terse, none on ◀ ▶ | `setTip` | no `.title =` left; gallery ◀ ▶ lost theirs, ⇅ gained one | applied v0.426.0 (user) | VIEWER.md tooltips |
| One label per setting everywhere | — | Settings panel, right-click menu, manager menu, gallery buttons | applied v0.426.0 | SETTINGS.md |
| Destructive buttons `confirm()` | miss log Clear | Reset to defaults, colours reset, request log Clear, rule-health Clear, learned-gallery Forget | applied v0.426.0; activity Clear and list-row ✕ n/a | SETTINGS.md |
| One home per help text | ⓘ box (`galInfoShow`) | right-click menu's "Using the gallery" lines (duplicated, drifted) | replaced by a menu item opening ⓘ, v0.426.0 | GALLERY.md tooltips |
| On-screen words are the user's: widget, gallery button, download bar | — | "strip" in menu, ⓘ box, join prompt, toasts | fixed v0.426.0; code names unchanged | — |
| Every right-click menu entry is also in Settings | `galMenuShow` | all 13 entries | already true | GALLERY.md |
| Right-click opens the one menu | `galMenuShow` | widget, gallery widget, corner picture | already true; the preview keeps the browser's menu (E9, deliberate) | VIEWER.md |
| Hold to repeat | `twHoldOn` | picture ◀ ▶ on both widgets | already true; page ◀ ▶ none on either (consistent) | TOUR.md |
| Wheel: over a widget or the corner picture flips pictures, never pages; over a preview zooms; elsewhere closes a pinned one | `twWheel`, `galWheel` | page and gallery | already true; ⓘ text claimed the wheel turned pages (fixed v0.426.0) | TOUR.md |
| State menu items flip their label and toast 3 s | `refreshSiteMenu` | site, slideshow lines, debug | already true | ../CLAUDE.md |
| Esc / a press away closes our menus | `galMenuHide`, `closePops` | gallery menu, ⓘ box, preview pops | already true | — |

| The wheel over an overlay of ours never scrolls the page behind | widgets (`twWheel`), gallery (`galWheel`), Settings (`overscroll-behavior:contain`) | right-click menu / ⓘ box | applied v0.427.0; the download bar n/a (a status bar, not a surface you scroll on) | — |
| Text that does not fit: numbers shrink, then a word drops; never cut | `galStripSqueeze`, `twAsk` | page widget (sizes to its text), preview caption and download bar (file names ellipsize) | n/a: a cut file name loses nothing a tip does not give back; a cut number would | — |
| `[hidden]` must beat the element's own `display` | per-rule `[hidden]` lines | Settings: `.entries`, `.addrow` (flex) stayed up in "Edit as text" | fixed v0.427.0 with one `[hidden]{display:none!important}` in the panel sheet | CLAUDE.md trap |
| CLAUDE.md traps: `isTopFrame` on per-page listeners that store; held flags cleared on mouseup; `pointer-events` classes removed on hide | `missPress`, `savePanelState`, `releaseSliders`, `twHoldStop`, `hideViewer` | every top-level listener; every range input; `.hot`, `.catch` | already true (swept v0.427.0) | CLAUDE.md |
| Close (and the picture's ⛶) never vanish: 60 % at rest, full on hover; the rest fades out | corner picture ✕ ⛶ | the preview's corner ✕ (used to ride the bar's fade out) | applied v0.428.0 (user) | VIEWER.md E68 |
| Copy buttons say "Copied" for 1.5 s, then their label again | `copyText` | activity window Copy (own code, already did), Settings request/miss log Copy, gallery diagnosis Copy (stayed "Copied"), preview menu "Copy image address" (said nothing: now a "Copied" note by the pointer) | applied v0.429.0 | — |
| One builder per kind of Settings row | `dataRows` | every collected log (was `logRow` + the rules notice + the activity row) | merged v0.462.0 | SETTINGS.md |
| No dead code | — | swept v0.429.0: `widgetFloor`, `plBudget`, `galPagePics`, `galPics`, `VCTL_PAD`, `PASS_CONTROL` removed; the size formatters (`humanBytes`, the R/P/D readout's rounded MB) differ on purpose | done | — |
