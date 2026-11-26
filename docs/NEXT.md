# Shelved: keep pictures on disk (user 2026-11-26: not needed)

Asked because every reload/Back re-downloaded every picture in LibreWolf. Cause: LibreWolf's
`browser.cache.disk.enable` false (its `librewolf.cfg`); the user enlarged the memory cache in about:config and it
was fixed. User: no script changes to adapt to one browser. If revived, the spec was: galleries keep thumbnails +
originals 2 pages back and all ahead, nothing behind older than 5 min, cap 1 GB; elsewhere a 512 MB cap; both
settings; extend `HELD_DB`. The measurements below stand.

Measured 2026-11-26 in Chrome (window 1314×826, screen 1920×1080), bytes from `fetch` → `blob.size`:
- Google Images, "4k landscape photography", 10 screens: 200 results, originals 638 MP in all (Google's `imgurl`
  w/h). Thumbnails 34 KB avg (60/60) → ~7 MB. Originals: 105/200 fetchable = 57 MB, 0.142 MB/MP, median 0.1 MB,
  p90 1.3 MB, max 6.1 MB; the 95 refused average 2.5 MP → ~34 MB more. **~100 MB per 10 screens, every original.**
- eporner gallery: thumbnails 27 KB avg (40); originals 2.81 MB avg, median 3.0, max 4.0, 20 MP (30 of 30).
- Pictures per gallery page (`galPer`, `galleryRowMin` 120): 1314×826 → 48 (thumb shape 1.17, eporner's) to 72
  (0.75); 1920×970 → 84–126; 2560×1300 → 135–207.
- `<img>` vs GM_xhr → blob → shown, one at a time, cache-busted, alternating order (v0.392.0's temporary
  `hover-zoom:fetch-speed`, removed v0.393.0), Chrome + Tampermonkey, eporner, 15 files each:
  thumbnails 31 KB: `<img>` median 293 ms, GM 410 ms (+117 ms, +40 %); originals 2.0 MB: 523 vs 658 ms (+135 ms,
  +26 %; GM faster on 3/15). **A fixed ~120–135 ms per request**, not per byte. Not measured: with 6 in flight.
- Back/Forward: v0.391.0 adds `beforeunload` only while downloads are queued; Back then restored from bfcache in Chrome.
- So 2 back + current + 2 ahead of eporner originals at 1920×970 = 5 × 84 × 2.8 MB ≈ 1.2 GB: the 1 GB cap binds.
  Thumbnails are noise (10 galleries × 2 pages × 84 × 27 KB ≈ 45 MB).

# Built 2026-11-26 (v0.387.0) — loading ahead, by what the user is doing. Reference: GALLERY.md "Loading ahead"

**Unreproduced (user, v0.388.0, Endless on):** once, the main page loaded counts + thumbnails for the screen, then
all traffic stopped for minutes; the galleries below stayed grey until a small scroll restarted it. Not seen again;
the fixture (`door-long`) keeps going down the page at ~1.8 galleries/s. Suspect a stuck gate in `galPreNext`
(`galPre`, `galGrowing`, `ahBehind`, or `ahMainPick` returning null) — ask for the `loading ahead:` debug lines.

**Last asked:** user to try v0.387.0 on pornpics (both browsers refuse it to Claude). Not answered yet.

The spec as agreed (kept until the user confirms it works):

Replaces the scroll-pace preload (`galPreNext`/`galPaceNote`, v0.350.0 "fast → further ahead" — reversed by the user)
and `galChainWarm`. Terms: **gallery** = the middle-click view (code: peek); **gallery preview** = the new hover view.

- **Main page:** counts (HTML, cheap) → thumbnails → first 2 originals per gallery, from the first gallery on screen.
  Slow scroll: keep going. Scrolling faster than thumbnails finish: thumbnails/originals stop (counts go on). Scroll
  stops: 1 s for a hover → that gallery first; no hover → restart from the first gallery on screen. Expensive counts
  (frame, `galGrow`) only when nothing else waits. Cover originals (`hoverPreload`) wait behind counts (revisit later).
- **Gallery preview:** hover a door 500 ms → its thumbnails laid out as the gallery, cover left in place, no bars, no
  controls; closes on leaving the cover or a page scroll.
- **Gallery, endless:** thumbnails 2 galleries ahead; stepping forward → 5, then 10. A hover / slideshow → originals:
  this page + next 2, slideshow: as far ahead as it runs; ahead galleries first page only until next. Backward step →
  next 5 originals that way, followed, then forward resumes. Closing the preview: originals go on until pages are
  skipped (→ thumbnails) or a new preview. Closing the gallery drops its queue → main-page rules.
- **Endless off:** originals of the first gallery, thumbnails of the next few, more originals only once ≥ 40 % of the
  page's galleries were opened. Endless default on.
- **Pacing:** pictures random 50–200 ms between starts, ≤ 6 in flight; page reads 300–800 ms (Forum Stumbler's gap).
  Hidden tab pauses, 429 stops. Log every load; on arrival log whether loaded-ahead files were still cached.

# Handoff 2026-11-19 (~355k tokens, v0.367.0–v0.374.0) — read this first

**Asked, in order (all built, pushed):** (1) wheel on fullscreen black space left fullscreen after a page
change → v0.367.0 (`commitSwap` refits with `fitFull()`; VIEWER.md E35 list). (2) nsfw.xxx gallery cells of
multi-picture posts showed 480 px → v0.368.0 (slider slides get the card link; `pageUrlLists`/`pairedUrl`
pair thumbnails[i] ↔ urls[i]; RESOLVER.md "Card link"). (3) xmoviesforyou galleries not recognised →
v0.369.0–v0.370.0 (og:image that is a grid cell, by path, is dropped; GATES.md measured list); **user
confirmed it works**. (4) nsfw.xxx home → `/user/NAME` whose posts are galleries should be results, and
`/user/NAME` post cards should be gallery doors → v0.371.0–v0.374.0 (GATES.md P17 "Card pictures are
doors too": `doorLink`, `doorImgs`, grid-cell copy = door, script-built kind via `galLoad`, per-door kind
`galDoorKindRead`/`galResultsAt`).
**Verified:** (1) pane A/B; (2)(4) live in Chrome — (4) by injecting the pushed commit (Chrome's
Tampermonkey was stuck on v0.368.0, not tracking disk); (3) fixture `door-og.html` A/B + user live.
**Not verified:** (4) in LibreWolf; per-door kind only runs on hover (chip drops after 2 post reads).
**Last asked:** user to try v0.374.0 in LibreWolf; send `door kind of this one door` if wrong. Not answered yet.

# Handoff 2026-11-18 (~370k tokens, fullscreen + endless polish)

**Asked, in order (all built, pushed v0.365.0–v0.366.0; reasons in GALLERY.md "Endless", TOUR.md wheel bullet,
VIEWER.md E76 and the status-bar section):** fullscreen middle-click on the black saves; no status bar in fullscreen;
⛶ on the clicked picture = slideshow from picture 1 in fullscreen (now bottom-right; in fullscreen it leaves); the
clicked picture's size changing after fullscreen and on gallery switches (`galBoxKeep`); saved mark on the preview
(now pinned to the picture's top-left when pinned); ⓘ top-left, ✕ top-right, ↗ moved to the right-click menu; back
into the previous gallery showed the old picture for seconds and closing then stuck the preview open
(`galLandShow`, `galHide` `mine`); stepping back past the landing picture waited 6 s (`galFedAll`); wheel in a
gallery/fullscreen flips, a click on the picture toggles zoom for it (v0.364.0's rule reverted); endless scrolls the
page underneath so lazy/more galleries load (`galChainFollow`). Also fixed: v0.365.0's `galKept` name clash broke
kept gallery lists; `test-resolver.js` now fails on duplicate function names.
**Verified:** Browser pane fixture door-long only (synthetic events; stand-in fullscreen). **Not verified:** LibreWolf;
the "about double" size after a real fullscreen exit; the middle-click-on-black failure (never reproduced in the pane —
if it persists, read `middle press not taken as a save {full, inPreview, galTop…}`); the landing picture painting
(the hidden pane never settles `img.decode()`); a real site's infinite scroll under `galChainFollow`.
**Last asked:** nothing pending.

# Handoff 2026-11-17 #4 (~333k tokens, endless galleries)

**Asked, in order:** endless mode (☐ Endless on the clicked picture: at a gallery's end the next door on the page
opens, back goes to the one before, slideshow across, P/G/T counters, ⓘ help, ⤓ stays per gallery; viewed doors
judged once when queued) → v0.359.0. Then fullscreen: corner picture small, sized by the strip's text; a switch hid
it till the pointer moved; no seam stop or note in endless, dead stop at the queue's last picture → v0.360.0. Then
the ⓘ box (never over its button, next press only closes it), the wheel off the picture in fullscreen steps, portraits
not cropped, the size restored on leaving fullscreen → v0.361.0. All pushed; design and reasons in GALLERY.md "Endless".
**Verified** on fixture door-long in the Browser pane only (stand-in fullscreen, no real `requestFullscreen`; resize
dispatched by hand). Chrome's Tampermonkey shows no chips on localhost (no learned doors there), so not tested live.
**Last asked:** nothing pending. Unverified in LibreWolf: the size restored after a REAL fullscreen exit — if it
still changes, ask for the `gallery refit {full, W, H, wentIn, restored}` debug lines. Offered, not taken: the queue
crossing into the site's next results page (`nextPageIn`).

# Handoff 2026-11-17 #3 (~337k tokens)

**Asked, in order:** run the open eporner download tests (done, below; bugs fixed v0.344.0 stall, v0.345.0 folder,
v0.346.0 folder debug lines); check Downloads (done, misfiles moved, then the whole folder recycled at the user's
request); summary of issues (given); then: pornpics look-ahead / categories previewing, middle press before the
preview (`E79`), queue start delay, `saveRename` → always (v0.347.0), the user's one-read door signal + a Debug log
toggle in the Tampermonkey menu (v0.348.0). All pushed. Details in the sections below.
**Waiting on the user (asked in the last reply, not answered yet):** try pornpics home + `/lingerie/` on v0.348.0;
if category tiles still preview, send `door scan` / `doorAreas` debug lines; and one failing early middle press with
debug on (`middle press not taken as a save {…}`). Nothing else open.
**User trace, 2026-11-17 #5 (v0.348.0, LibreWolf, a pornpics gallery page):** `middle press before the preview opened:
saved once it shows` then the preview painted 733 ms later — the early press IS taken in LibreWolf (no `not taken` line).
Whether the file was written was not logged; v0.349.0 adds `middle press: saving <url>` / `middle press: saved <url>`
(a failure already logs `saving the original failed`). Still owed by the user: home + `/lingerie/` category check
(`door scan` / `doorAreas` lines), and whether that press's file landed in Downloads.
**Second trace (v0.349.0):** no file, no `middle press: saving` — the early press on a *gallery* thumbnail was held but
`galPv` never consumed `saveOnShow` (nor `pinOnShow`); fixed v0.350.0. Same version: chip counts read to the end in the
background (GALLERY.md "The preload reads each on-screen door to its end"). Both unverified on pornpics.
The press on a results-page door (`active: null, door: true`) is still not a save — the known gap.
**v0.351.0–v0.352.0 (user, same day):** off-screen doors read at the user's pace, one request per page, counts no
longer wait on a frame (GALLERY.md); frame counted sexygirlspics cam spots (24 for 15), fixed and verified in Chrome
(15/16/16/16 = the pages). **Asked the user, unanswered:** (1) LibreWolf on v0.351.0+: half the chips blank, the
rest `N+` — send `gallery count from its page` / `gallery read to its end` debug lines; suspected cause (counts
behind the frame guard, 10 s per frame that never reports) fixed in v0.351.0, unverified there. (2) What a middle
press on a results-page door should do: opens a tab now in both browsers (`galleryMiddle` off, the user's
2026-11-12 default; on = peek its gallery). Options offered: turn the setting on, or make it save the gallery.
**v0.353.0–v0.354.0:** ⤓ ready from the first known list, jobs grow with the read (GALLERY.md "⤓ is ready as soon as
any list is known"; fixture-verified, not live); download bar bottom-right when no gallery is open (fixture-verified).
Non-porn gallery sites were suggested to the user for testing (Flickr albums, Behance, ArtStation, DeviantArt,
Imgur, wallhaven) — none tried with the script yet.
**v0.356.0:** middle-press "load was cancelled" fixed (GALLERY.md, not reproduced); the download bar still sat
mid-page after closing a gallery for the user (LibreWolf, v0.355.0) — not reproduced; asked for the `download bar:`
debug lines.

# Handoff 2026-11-17 #2 (~326k tokens)

**Asked:** (1) v0.342.0: save originals without a second download (bytes kept on disk in the site's IndexedDB
while a queue runs) and a picture count on the ▦ chip — done, pushed. (2) Why counts take minutes, why a
visited gallery's count stays unknown; test everything live on eporner (counts, ⤓ readiness, links remembered,
Back mid-download, multiple tabs and sites); ticks missing after middle-click; pornpics middle-click opens a new
tab — partly done, v0.343.0 (below). (3) Mid-turn: a middle press on a thumbnail before its preview opens should
save the original, not cancel it — done, `E79`, v0.343.0.
**Last asked the user:** the save folder (answered 2026-11-17 #3: the default); a `hover-zoom:gallery-state` trace
from a pornpics page — not answered yet.

# Download tests, 2026-11-17 #3 (v0.343.0 → v0.344.0) — done

Save folder set to `Hover Zoom/[site]/[page_title]` (user's pick) through the settings panel; the old Chrome tab
602234578 may still show the first `prompt()` — answering Cancel there would blank the folder again.
Chrome, eporner, synthetic presses (recipe in TESTING.md "Live sites in Claude in Chrome"), ~1.2 pictures/s:
- ⤓ on page 2 (100), Back to page 1 mid-queue: carried on, **Saved 100/100**.
- ⤓ on page 1 (153), Forward to page 2: carried on, no gap. Start took 10–15 s before the first count (not looked into).
- Left for example.com ~15 s mid-queue, Back: resumed (103 → 121 in 28 s).
- Second eporner tab queued 147: one site-wide queue, jobs one after the other, same rate — no doubling.
- girlstop.info (⤓ ready in 14 s) saved 19/19 while eporner's queue ran: two sites at once work.
- **Bug found, fixed v0.344.0:** eporner froze at 146/147, 0 failed, 3+ min — `galBestOf` had no deadline (GALLERY.md).
  A reload under v0.344.0 finished it (⤓ again then found all 147 saved). The deadline itself has not fired live.
On disk (user said yes to checking Downloads): all 100+153+147+19 present (one Sophy picture twice — redone after a
navigation, by design), but 67 in `Hover Zoom/Eporner/` named `Eporner - …`: saved by a page that never read that
gallery. Fixed v0.345.0. Live: page 6 (25) and page 7 (21+1 redone), ⤓ then Back at once → all in
`EPORNER.COM/<gallery> Photo Gallery/`. **Unexplained:** the first run on v0.345.0 (page 5, 13 pictures) still went to
`Eporner/`, before the debug lines existed. v0.346.0 logs `download queue: title at press {…}` and `download queue:
names {…}` (JSON) — if a misfile recurs, read those first. **Cleanup owed:** drop both lines once it has not recurred.
(The freeze on page 4 was the "all saved already, save again?" `confirm()`; the user answered yes.)
**User, 2026-11-17 #4:** pornpics middle-click no longer opens a tab (fixed); a background tab's scroll does NOT close
the gallery (suspect ruled out); the page-5 misfile was probably the user dismissing a dialog. Asked for, open:
- **pornpics categories previewed (user trace): root cause found and fixed v0.348.0** — one-word category links were one area each
  (GATES.md P17 "One-word links"), plus the one-read door test. Not verified live (pornpics refused): user to check the home page and
  `/lingerie/` with the menu's new ☑ Debug log.
- **pornpics look-ahead:** scrolling onto new thumbnails, a hover previews first, then the gallery opens under the
  pointer and shrinks it. Scan path: scroll → `twRecount` (waits for the scroll to settle) → `twRefresh` →
  `doorScanSoon` (1.5 s) → `doorScan` (unruled chains, 3 linked pages 400 ms apart). Suspected: that latency, or new
  rows with a chain/path no rule covers. Not reproducible here (pornpics refused). Needs the user's debug `hover {…}`
  and `door scan` lines from such a hover before changing anything.
- **Middle press before the preview (`E79`) does not save in LibreWolf;** synthetic presses work. v0.347.0 logs
  `middle press not taken as a save {…}` (active, onActive, resolving, door…) — one real press settles it. Known gap:
  on a door (results thumbnail) `active` is null, so a middle press there never saves.
- **Queue start 10–15 s:** not a stall. Count moves only when a file finishes. Press → first tick claims, work starts
  the next tick (≤ `DLQ_TICK_MS` 2 s, deliberate: two tabs claiming at once) → per picture, if not preloaded, its own
  page + the whole original as bytes, then the save. Measured: Brunette (preloaded) first file 3 s; Sophy (not) 8 s.
  Not changed; option: show in-flight pictures in the bar.
- `saveRename` default → `always` (v0.347.0), stored `meaningless` migrated once (`saveRenameV2`). Verified live.
**Open lead:** Downloads held 11 eporner thumbnails (`NN_small.jpg`, 3–5 KB, 4 as `(1)` copies) saved 19:35, before
this session — likely the previous session's synthetic middle presses (`E79`) saving the thumbnail, not the original.
Not reproduced. Downloads was emptied (to the Recycle Bin) at the user's request, 2026-11-17.
Still unverified: a real middle press in Chrome (`E79`, synthetic only); the missing ticks after middle-click (the
self-scroll suspect is ruled out by the user; cause unknown).

# Handoff 2026-11-17 (~305k tokens)

**Asked, in order (all built, pushed v0.335.0–v0.341.0):** (1) clicked gallery picture: fade rejected →
preview on top unless the pointer is on the picture (v0.336.0, `galFlyHost`/`galFlyZ`); (2) eporner ⤓
stayed grey: the reading frame never loads in the user's browser (no `frame loaded`), now counts as
read from HTML (v0.337.0–v0.338.0); (3) no tooltips on picture/strip, their text in the right-click
menu; download row inside the gallery strip above the page row; menu over the raised picture
(v0.339.0); (4) one progress bar; preloaded originals fetched once as bytes, kept (512 MB) and saved
by ⤓ from memory, any site that serves GM_xhr (v0.340.0); (5) downloads stalled after Back and links
were forgotten: worker try/catch, `pagehide` → `dlqHalt`, lists kept per tab in sessionStorage
`hzGalLists` (v0.341.0). Reasons: GALLERY.md (sections named in each commit).

**Verified:** Browser pane fixtures (strip rows, menu stacking, queue across Back/Forward, kept list →
⤓ ready in 1.5 s); Chrome on eporner: 112 originals via bytes, 29.6 MB, no `<img>` loads.
**Not verified:** saving from held bytes into real files (`saveHeld` → GM_download of a page blob URL
in Tampermonkey/the user's manager; refusal falls back to `saveAsServed`); Back with the real script
manager. The user's main browser is not Chrome (frames never load there).

**Last question asked:** none open. The final reply asked the user to try ⤓ + Back on a gallery
they don't mind saving and report.

# Handoff 2026-11-16 (~355k tokens)

**Asked, in order:** (1) status bar hidden until the preview is pinned, fading 500 ms after the
pointer stops, with an option to disable the fade; (2) on girlstop.info, gallery originals were not
loading until hovered; (3) a peek's originals still downloaded on hover minutes later, and a new
window showed black ~1 s before its picture; (4) opened galleries preload all originals, pages stay a
screen ahead, byte logging; (5) "build the next index page preloading now".

**Done, all pushed:** v0.322.0 status bar (`barPinOnly`, `barStillFade`; VIEWER.md E41 section).
v0.323.0–v0.324.0: every original of an opened gallery loads and is held (`plKeepImage`); a new window
stays invisible until decoded and paints from the held copy (`holdUntilDecoded`, `heldImage`,
`preDecode`; VIEWER.md); pages load a screen ahead, the whole page when `pgFromDoor()` (TOUR.md);
us-log rows carry bytes `b` (shared/us-log.js, synced to Forum Stumbler v0.90.0). v0.325.0–v0.327.0:
next page of galleries loaded ahead (GALLERY.md "Next page"). Measured: girlstop galleries 30–52 MB
for 41 originals; the user measured 32.91 MB for psto.php?id=256380 (theirs includes thumbnails).

**Verified only in the Browser pane** with an injected build (TESTING.md: the fetch stub cannot read
cross-origin, so `bytes` log 0 B there): hover-to-picture ~200 ms with no black frame (pane visible);
skim → nothing loaded; 12 of 37 opened → page 11's first 3 galleries (123 originals) in ~30 s; page 11
peeks open from the stored lists; 12 of 17 originals still cached there. **Not verified:** the
user's browser/Tampermonkey; real byte counts; whether their cache keeps originals across pages
(read the `nextwarm` rows — if few kept, load only lists + thumbnails a page ahead).

**Last question asked:** none open. The user's earlier ideas not built: on a skimmed page, load a
gallery's originals after a 1 s hover.

**2026-11-16 later:** cache across pages measured in Chrome (kept: 2-5 ms vs 325 ms cold; GALLERY.md
"Next page"). v0.328.0: ⤓ ⧉ ↗ tools on the clicked picture (`G10`), `saveFolder` setting asked on
the first quiet save (SETTINGS.md). Pane-checked only; Chrome's Tampermonkey copy was still v0.327.0
and girlstop has no learned door there. Not verified: Tampermonkey creating subfolders / saving .avif.

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
