# Shared widget positioning — Hover Zoom, Forum Stumbler, RNFP

**Status: design in progress 2026-09-22, not built.** Once built, this belongs in `../CLAUDE.md` (it
spans three scripts); move it there and leave a pointer.

Today: FS anchors bottom-right only, 12px snap on right/bottom, no resize handling, global position,
can be dragged off the left/top. RNFP: nearest-edge anchoring (`adaptGeometry`), 8px snap on all four
edges, clamped while dragging and on resize, left edge anchored to Reddit's sidebar.

## Decided

- **Anchors are only ever chosen by the user's drop.** Touching an edge or a widget later — by
  growth, push, or window resize — never creates or changes an anchor.
- **Window anchor: three zones per axis** (start / centre / end thirds of the viewport). The widget
  point measured depends on the CURRENT anchor — bottom-anchored measures its bottom edge, centre its
  centre, top its top — which gives half the widget's size of hysteresis at each boundary. Same
  horizontally. A centre-anchored widget grows equally both ways; an edge-anchored one grows away from
  its edge.
- **Snap 8px** to window edges and to other widgets, all three scripts. **Ctrl** held during a drag
  disables snapping, read from `ev.ctrlKey` on the move event (no key listener). **Not Alt**: Firefox
  reserves it (user tested).
- **Widget anchor**: a widget dropped against another's edge attaches to that edge. On the other axis
  it snaps to the other widget's left/centre/right (or top/centre/bottom) — unless it is snapped to a
  window edge, which wins. Only the DRAGGED widget attaches; the other keeps its own anchors.
- **Dragging either widget of an attached pair breaks the attachment.** The attached widget converts
  to a window-zone anchor where it stands. No group moves.
- **The widget attached to is absent** (script inactive on this page, HZ hidden): use the window-zone
  anchor derived at drop time; keep the stored attachment for when it returns.
- **No overlap unless the user dropped it overlapping.** Growth pushes other widgets out of the way;
  a widget that cannot be pushed without leaving the screen pushes the grower back instead.
- **Constrained to the viewport** while dragging and on window resize. The clamp is display-only; the
  stored anchor is kept.
- **Memory**: FS and HZ store per site; a site with no entry uses the last position saved anywhere.
- **RNFP**: keeps its sidebar left edge and window-top anchor; its BOTTOM follows the window bottom or
  a widget below it (it stretches rather than moves).
- **No arrow keys in FS** for now.

## Mechanism

- **Every script runs the same layout over ALL widgets and positions only its own.** Inputs are
  published on each widget's element: its anchor, its NATURAL size (not the displayed, stretched or
  clamped one — RNFP's pushed height is an output), and when that size last changed.
- **Never read another widget's displayed position as an input** (the one exception: the live
  position of a widget being dragged, which only its own script writes). Inputs never change as a
  result of outputs, so the scripts cannot fight — two different versions of the layout code give a
  wrong-looking layout until both are updated, never a loop. No version handshake (sole user,
  updates together; decided 2026-09-22).
