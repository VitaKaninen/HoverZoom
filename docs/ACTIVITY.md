# Activity window (v0.412.0, user 2026-11-26)

What the script loads in the background and why, in plain words, so the user can say what to correct.
Code: the `act*` functions above `ahT`.

- **Window**: `actOpen()` — `window.open('', 'hzActivity', 'popup=yes,…')`, a real browser window the user can move
  off the page. Built from the opener with `createElement` + `style.cssText` only (it inherits the page's CSP and
  Trusted Types). Opened from the manager menu ("Hover Zoom activity window") and Settings → Diagnostics. A blocked
  pop-up (a menu command carries no user activation in Chrome) arms `actArmed`: the next press on the page opens it
  (`actPress` in the capture mousedown).
- **Lines**: `act(kind, text)` → `actBuf` (this page, `ACT_KEEP` 3000), drawn at once while the window is open; opening
  later replays the page's lines under a `── this page ──` separator. The window keeps its lines across navigation
  (its DOM is its own) but goes quiet: after a page change the user reopens it from the menu on the new page — no
  automatic re-attach, because `window.open` on the existing name raises the window over the browser.
- **Sources**: every `ahT` event (`actTrace`: thumbnail / full size / page read done, with the reason from its gate tag
  — `ACT_WHY`), plus a `job` line where each kind of work starts (page loading stages, idle count, open gallery's
  first thumbnails / more thumbnails / full-size run start and end, next galleries, scroll pause/resume, page preload,
  slideshow queue, each slideshow step with whether its full size was ready, and the full search it waited on).
- **Names**: `actGal(href)` = "the open gallery" / "the next gallery" / "N galleries ahead" / "gallery N on the page", plus
  a title (img alt, link title, else the address's last words). `actPic(thumb)` = the open gallery's picture number
  first, else the first known list holding it, plus the file name (`actFile`: folder/name when the name is short).
- Tool read-out: `document.dispatchEvent(new CustomEvent('hover-zoom:activity'))` → `<html data-hz-activity>`.
- Fixture trap: `gallery-a.html`'s 40 pictures differ only by query (`?g1`), and `galItemKeys` keys by host + path, so
  an open set never grows past its first build there. Use `door-whole.html` (distinct `/many/whole-N.jpg`).
