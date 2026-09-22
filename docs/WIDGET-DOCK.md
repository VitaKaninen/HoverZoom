# Shared widget positioning — Hover Zoom, Forum Stumbler, RNFP

**Status: decided 2026-09-22, not built.** Once built, this belongs in `../CLAUDE.md` (it spans three
scripts); move it there and leave a pointer.

Today: FS anchors bottom-right only, 12px snap on right/bottom, no resize handling, global position,
can be dragged off the left/top. RNFP: nearest-edge anchoring (`adaptGeometry`), 8px snap on all four
edges, clamped while dragging and on resize, left edge anchored to Reddit's sidebar.

## Decided

- **Anchor = nearest window edge per axis**, measured at drop (RNFP's `adaptGeometry` rule), for FS and
  HZ. RNFP keeps its sidebar left edge and its window-top anchor; its bottom follows the window bottom.
- **Snap 8px, all four edges, all three scripts.** Holding **Alt or Ctrl** during a drag disables
  snapping. Read from `ev.altKey`/`ev.ctrlKey` on the move event; no key listener, nothing claimed.
- **Constrained to the viewport** while dragging and on window resize (`clientWidth/Height`; HZ uses
  `vpW()`/`vpH()`). The clamp is display-only: the stored anchor is kept, so the widget returns when
  space comes back.
- **Memory**: FS and HZ store per site; a site with no entry uses the last position saved anywhere.
- **Growth** (FS, HZ): away from the anchored edges. Top-left anchored grows right/down; bottom-right
  grows up/left. RNFP is untouched here.
- **Widget-to-widget**: widgets snap to each other's edges (8px) and anchor to that edge. When the
  anchor widget grows, shrinks or moves, the dependent follows. RNFP stacked above a widget: its
  BOTTOM follows that widget's top (the panel's top stays put, as with a window-bottom change).
- **Corner ownership needs no rule**: per-site memory puts each widget where the user last put it,
  whatever the load order.
- **No arrow keys in FS** for now. (FS never had them; the user misremembered.)

## Open — see the 2026-09-22 session for the questions asked
