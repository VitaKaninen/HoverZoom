# Shared widget positioning — Hover Zoom, Forum Stumbler, RNFP

**Status: built in Hover Zoom v0.120.0; Forum Stumbler and RNFP in progress.** Once all three carry
it, this belongs in `../CLAUDE.md` (it spans three scripts); move it there and leave a pointer.

**The code is `dock/us-dock.js`, and it is the only copy to edit.** `node dock/sync-dock.js` writes it
between the `// ==== us-dock begin/end ====` markers of all three scripts (re-indented; RNFP uses
2 spaces); `--check` fails if any copy differs. `node dock/test-dock.js` tests the layout and drops;
`test-pages/dock.html` runs three stand-in widgets from three separate copies, as three scripts would.

## Behaviour (all decided by the user, 2026-09-22)

- **Anchors are only ever chosen by the user's drop.** Growth, pushes and window resizes never
  create or change one.
- **Window anchor: three zones per axis** (start / centre / end thirds). The point measured depends on
  the CURRENT anchor — bottom-anchored measures its bottom edge, centre its centre, top its top — which
  gives half the widget's size of hysteresis at each boundary. An edge-anchored widget grows away
  from its edge; a centre-anchored one grows both ways.
- **Snap 8px** to window edges, the window's centre, and other widgets' edges. **Ctrl** held during a
  drag disables it (read from the move event; no key listener). **Not Alt** — Firefox reserves it.
- **Widget anchor**: a widget dropped against another's edge attaches to that edge; on the other
  axis it takes a window edge it also touches, else the other widget's nearest left/centre/right.
  Only the DROPPED widget attaches.
- **Group moves**: dragging a widget carries everything attached to it. Dragging an attached widget
  pulls it off and re-anchors it where it lands. (Chosen over breaking attachments on drag: that
  needed one script to rewrite another's saved state.)
- **Attached widget absent** (script inactive here, HZ hidden): use the window anchor stored with the
  drop (`fx`/`fy`); the attachment is kept for when it returns.
- **No overlap unless the user dropped it overlapping** (recorded in `ov`). A widget that grows pushes
  unattached ones away; if they cannot move without leaving the screen, the grower is pushed back.
- **Kept inside the viewport** always; the clamp is display-only, the stored anchor is kept.
- **Memory**: FS and HZ store per site; a new site uses the last drop anywhere.
- **RNFP** stretches: its top stays; its bottom gives way to the window and to widgets below it,
  down to its minimum height, before it moves (`stretchMin`).

## Mechanism

- **Every script runs the same `solve()` over ALL widgets and positions only its own.** Inputs are
  attributes on each widget's element: `data-us-dock` (id), `-a` (anchor spec JSON), `-s` (natural
  size), `-t` (when that size last changed — the newer one is the grower), `-d` (live position, only
  while dragged), `-st` (stretch minimum), and `hidden`.
- **Never read another widget's displayed position as a layout input** (the drag position excepted;
  only its own script writes it). Inputs never change as a result of outputs, so the scripts cannot
  fight; two different versions give a wrong-looking layout until both update, never a loop.
- **Publish the NATURAL size only.** RNFP's squeezed height is an output; publishing it would feed
  back. Sizes are rounded UP, or a fractional width hangs off the window edge.
- **The widget's size must not depend on its position**: `width:max-content` or `nowrap` content.
  A fixed box with only `left` set shrinks as it nears the right edge, which would loop.
- **Call `sizeChanged()` after re-rendering the widget.** `ResizeObserver` also calls it, but the
  Browser pane never fires `ResizeObserver`, so a test there sees stale sizes without it.
- **A scrollbar appearing fires no `resize`**; the root element is watched with `ResizeObserver`.
- Other docks are noticed through a `MutationObserver` on the direct children of `<body>` and
  `<html>` (so a widget must be one) plus attribute observers on each widget.
