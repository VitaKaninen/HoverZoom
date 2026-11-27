# Activity window (v0.412.0; grouped + reload-proof v0.415.0, user 2026-11-26)

What the script loads in the background and why, in plain words, so the user can say what to correct. The user
reads it for **what changes and how long each piece takes**, not file names. Code: the `act*` functions above `ahT`.

- **Jobs** (`actJob(text, total)` → `actKid(job, ok, text)` per file → `actEnd(job, state, note)`): one bold header
  per piece of work with a live `done/total`, `(N failed)`, and on end ✓ / ⏹ stopped / ✗ plus its time and a note.
  Its file lines sit in a collapsed box under it; a click on the header (▸/▾) opens it; Open all / Close all. **Export** (user, v0.444.0) saves every line, collapsed boxes
  included, as `hover-zoom-activity-<date>_<time>.txt` (a blob link in the window; Copy takes only open boxes). A load
  reaches its job through `ahT(ev, o, job)` (`galImg(…, job)`, `ahImg(…, job)`, `tok.job` for `ahOrig`/`galHqAll`,
  `galCountLoad(…, job)`). With no job the line stands alone with its reason (`ACT_WHY`). Plain `act(kind, text)`
  lines remain for what the user did (`you`) and notes (`info`/`warn`); every background job has a header.
- Jobs today: area check (`galKindOf`: "are pictures like this links to galleries", ends yes/no/unknown with how
  many on the page), counts (`galCountNext`, one job per burst, `actCountJob`; ends N galleries / too few / failed),
  each main-page round, the open gallery's first thumbnails (`galShow`), more thumbnails (`galAppend`), full-size
  run (`galHqAll`, ends with found + bytes or why it stopped), next galleries' thumbnails and next gallery's
  full-size first page (`ahGalAhead`), idle count to the end (`ahIdleGrow` → `ahGrowJob`; its count is pictures known,
  `actCount` from `galMore`; `ahGrowEnd` from `galGrow`'s end: N in all / stopped, not to the end).
- **Follows the bottom**: `receive` checks "at the bottom" before *every* message and scrolls after (v0.448.0) — not
  only in `put()`: checklist lines (`mline`) and job headers grow the page without `put`.
- **The window runs its own code** (`actPopup(win, own)`, injected as a string by `actInject`: `GM_addElement`
  first — it passes the page's CSP — else a `<script>` with the page's nonce and a Trusted Types policy). Listeners
  made by the page's script die with a reload of the page (that was "stops updating, Clear does nothing"), so the
  page never owns the window's listeners. Page ↔ window talk over `BroadcastChannel('hz-activity')` (same origin):
  the window says `here` (with its opener's URL) on start and in answer to `who`; a booting page says `who`; the
  page whose URL matches replays its `actBuf` and then streams (`actLive`). The window accepts only messages whose
  `url` is its opener's current URL (other tabs of the site are ignored). A new page draws a `── page: … ──` line
  (once per page id, `data-pids`). Across origins the channel does not reach: reopen from the menu there.
- **Window code version**: `<html data-hz-act-ver>`. `actOpen` re-injects when it differs from `version()`; the new
  copy closes the old one's channel (`win.__hzActCh`) and clones the list, or both copies would draw. A page that
  only reloads does not re-inject (no `window.open` unasked), so an old window can meet new message states: unknown
  states draw `·`. A job that ends with nothing done ends as `skip` and its header is removed (empty cover batches).
  On a new page's `hello`, headers of other page ids still `data-s="run"` become ⏹ "cut off: the page was left".
- **Fallback**, when the injected code does not mark `<html data-hz-act="live">` (a CSP that refuses both ways):
  `actPopup(w, false)` runs in the page's script and returns `receive`, which `actSend` calls directly; a `warn`
  line says a reload needs a reopen. A reopen rebuilds the bar and clones the list (drops dead listeners).
- **Window**: `actOpen()` — `window.open('', 'hzActivity', 'popup=yes,…')`, from the manager menu and Settings →
  Diagnostics. A blocked pop-up (a menu command carries no user activation in Chrome) arms `actArmed`: the next
  press on the page opens it (`actPress`). No automatic `window.open` on a page change: it raises the window.
- **Names**: `actGal(href)` = "the open gallery" / "the next gallery" / "N galleries ahead" / "gallery N on the page", plus
  a title. `actPic(thumb)` = the open gallery's picture number first, else the first known list holding it, plus the
  file name (`actFile`).
- **Checklist** (user, v0.445.0): one block per moment (PRELOAD.md M1–M14), `actMoment(id, temp)`; its lines are
  the moment's L-numbers with the user's short labels (`ACT_L`, `ACT_M` — keep them in step with PRELOAD.md). Line
  states: wait • / run … / done ✓ / skip – (why: Load all off, Endless off, not built) / nt · (built, no job to
  watch: L10, L13) / cut ⏹ (started, then the next moment came: named) / none – (never started: already loaded or not
  reached). A job names its line (`actJob(text, total, L)`; rounds are `L4r1`, `L5r1`, `r2`, `r3`); a full-size run
  (`galHqAll`) has no single line, so its pictures' tags tick L22/L23/L14/L18 (`ACT_TAG`, `actTagEv`). A line is done
  when its jobs end with none of it left running — lines served by one job per gallery (rounds, L17) flip ✓ → … as the
  next gallery's job starts; the last state is right. M2/M3 are temporary: they sit over M1 (`actMs` stack) and pop
  (`actMomentPop`) without ending it. Window: moment row `data-mg`, checklist `data-cl` (always shown, lines
  `data-n`), detail box after it; jobs/lines carry `mom` and are drawn in that box. Copy/Export walk nested boxes.
- **Failures are red where they can be seen closed:** a job header with any `bad` kid, and the moment over it, are
  red; a failed line carries its diagnosis under it (`actDiag`: thumbnail, its link, every try with its answer from
  `galTry`/`tok.tries`, the page, version, browser). **A download stopped mid-way is kind `cut` (⏸, grey), never ✗**:
  before v0.445.0 a hover's cut was written `✗ no full size found` (the user's eporner report: pictures 35–39 at one
  instant; all load fine). `⚠ only the thumbnail found` is `warn` (yellow), no red corner (a site whose thumbnails are
  the files would turn all red).
- Tool read-out: `document.dispatchEvent(new CustomEvent('hover-zoom:activity'))` → `<html data-hz-activity>`: lines,
  and each job as `job[state] text · done/total · time — note` with its files indented.
- Fixture trap: `gallery-a.html`'s 40 pictures differ only by query (`?g1`), and `galItemKeys` keys by host + path, so
  an open set never grows past its first build there. Use `door-whole.html` (distinct `/many/whole-N.jpg`).
