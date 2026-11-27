# Test plan: loading ahead, the gallery preview and galleries (v0.387.0 – v0.397.0)

Written for the user to run by hand (user, 2026-11-26). Each test says what to do, what should happen,
which console line proves it, and what counts as a failure. **When a later version changes a behaviour
tested here, update its test in the same commit.** Report a bug by its number ("4.3 fails: …") plus the
console lines around it.

Spec: `docs/GALLERY.md` "Loading ahead". IDs such as `G13` are in `INTERACTION.md`.

---

## 0. Setup (once per session)

0.1 **Version.** Open Hover Zoom's settings. The grey line at the bottom right must show the version you
    expect (v0.395.0 or later).

0.2 **Debug on.** Settings → *Enable debug mode*. Reload the page. In the console (F12 → Console), type
    `loading ahead` in the filter box. Every decision in this plan prints a line starting
    `loading ahead:`. The other lines to watch for are `gallery originals:` and `gallery preload stopped:`.

0.3 **Request log on.** Settings → *Keep a request log*, on by default. It holds the `gallery` and
    `aheadwarm` rows.

0.4 **Network panel.** Open F12 → Network and leave *Disable cache* **off**, or test 10 means nothing.
    What to look for there:
    - Gallery page reads (counts) are `fetch` requests for the gallery pages' HTML.
    - Thumbnails and originals are image requests.

    Sort by start time to see the order. I don't know whether LibreWolf lists the script's requests in
    the page's own Network panel. If the panel stays empty while the console shows loads, say so;
    don't take it as the script doing nothing.

0.5 **Start each test in a new tab.** Since v0.390.0 the tab keeps every gallery list it has read
    (sessionStorage). In a tab you've already used, counts and lists come from memory and no page reads
    happen. Test 11 tests exactly that, but in every other test it hides what you're looking for. A new
    tab starts empty. The browser's own image cache still carries across tabs, so for a truly cold run
    use a gallery page you haven't visited.

0.6 **Know your page size.** How many thumbnails a gallery page holds depends on the window
    (`galPer`): about 48–72 at 1314×826 and 84–126 at 1920×970. "One page of thumbnails" below means
    that many.

0.7 **Optional timing snippet.** Paste this into the console right after the page loads:

    ```js
    performance.setResourceTimingBufferSize(10000)
    ```

    After the test, paste this. It reports the gaps between image start times:

    ```js
    (() => { const s = performance.getEntriesByType('resource').filter(r => r.initiatorType === 'img').map(r => r.startTime).sort((a, b) => a - b); const g = s.slice(1).map((t, i) => Math.round(t - s[i])).sort((a, b) => a - b); return { images: s.length, minGap: g[0], medianGap: g[g.length >> 1], maxGap: g[g.length - 1] }; })()
    ```

    Caveats:
    - The page's own images are counted too. Run it on a stretch where the page itself is quiet, such as
      after scrolling has stopped.
    - Cached images may not appear.
    - I haven't confirmed that LibreWolf records the script's images here (see 0.4).

Test pages:
- **Live:** a pornpics search (e.g. `?q=standing`), since that's where the complaint came from, and any
  other site with learned gallery doors (eporner, girlstop).
- **Local:** `python test-server.py`, then `http://localhost:8899/test-pages/door-long.html` (150
  galleries of 40 pictures each).
- **Claude's runs (user, 2026-11-26):** in Claude in Chrome on live sites (eporner, girlstop), not the test server;
  pornpics is refused to Claude. Measure with the trace (`hover-zoom:ahead-trace`, `docs/TESTING.md`). A new tab
  clears the script's memory; Chrome's image cache stays, so use listing pages not visited before for cold runs.

---

## 1. Pacing (every test depends on it)

1.1 **Picture start spacing.** On a fresh tab of a search page, wait 10 s, then run the 0.7 snippet.
    - **Expect:** `minGap` ≥ ~50 ms and a median in the 100–150 ms range. Claude's fixture run measured
      58 / 141 / 453 ms (min / median / max).
    - **Fail:** many gaps of 0–10 ms, meaning a burst.

1.2 **At most 6 originals in flight.** In the Network waterfall during an originals run (test 7.2), count
    the image bars open at any one moment.
    - **Expect:** never more than 6 for the script's originals. On a fast line, fewer overlap: a 100 ms
      download with a 125 ms gap finishes before the next one starts.

1.3 **Page read spacing.** Look at the `fetch` rows for gallery pages while counts run (test 2.1).
    - **Expect:** starts 300–800 ms apart, at most 4 open at once.
    - **Fail:** dozens of gallery pages starting within a second.

1.4 **A hidden tab pauses.** While pictures are loading, switch to another tab for 10 s, then come back.
    - **Expect:** no new requests start while the tab is hidden (requests already in flight may finish).
      Loading resumes within a second of coming back.
    - **Fail:** traffic carries on in the hidden tab, or nothing resumes on return.

1.5 **A refusal stops it** (only if it happens on its own; it can't be triggered on demand).
    - **Expect:** a 429 or 503 on a gallery page prints `gallery preload stopped: …`, and nothing more
      loads ahead on that page until a reload. The request log's `gallery` row shows the refusal.

---

## 2. Counts and the ▦ chip

2.1 **Counts first, for every gallery.** On a fresh tab, without moving the mouse, watch the chips.
    - **Expect:** numbers appear on the chips, starting with the galleries nearest the middle of the
      screen and spreading outward, at the 1.3 pace. Counts keep coming during fast scrolls.
    - The number is `N+` when it came from the gallery page's HTML alone, and `N` once the gallery was
      read to its end (test 6.1).
    - Doors to another site (a different origin) get no count. That's by design.

2.2 **Grey until round 1 is in** (v0.388.0; round 1 = 10 since v0.418.0).
    - **Expect:** a chip's ▦ icon is grey until that gallery's first 10 thumbnails (round 1, or its whole first page, if
      smaller) have loaded, then it turns blue. A gallery with a broken thumbnail still turns blue. The open gallery's yellow ✕ is
      never grey.
    - **Fail:** a chip that stays grey after its gallery's thumbnails are visibly in (open the preview
      to check), or a chip that turns blue before any thumbnail request.

2.3 **The count is the gallery's own, and stays a gallery** (v0.405.0). eporner `/search-photos/standing/`:
    `standing-pose` (`PzRdoVKzNwD`) and `Standing DP's` (`Woq5tDLi910`).
    - **Expect:** their chips read 5 and 19, as the site's own badges do. The preview and the open gallery show the
      gallery's own pictures. Hover, leave and hover again 4+ times: the chip stays and the preview keeps opening.
    - **Fail:** 8 (the site menu's category tiles), or the chip vanishing after a hover (`door leads to: results`
      in the log). Before v0.405.0 both happened and stuck for the tab, even across a cache clear.
    - eporner, Chrome, v0.405.0: verified. Door kinds settled ~3 s after load; counts were read about one page every 0.5 s,
      done by ~14 s; thumbnails 30 per gallery (whole galleries under 30), ~110 ms each from a warm cache.

---

## 3. Main page: rounds of 10 thumbnails + 1 original per gallery (v0.415.0)

3.1 **Order from the first gallery on screen.** Load a fresh tab and don't hover anything. Open the activity window.
    - **Expect, round 1:** from the first gallery visible on screen down the page, one gallery at a time, a header
      `Page: gallery N “…” — round 1: thumbnails 1–10 + full-size picture 1`, ending ✓ `11/11` with its time. With
      Endless on, this reaches the last gallery on the page before any round 2 starts.
    - **Expect, rounds 2 and 3:** then, from the same first gallery down, `thumbnails 11–20 + full-size picture 2`,
      then `21–30 + full-size picture 3` (galleries under that size skip the thumbnail part).
    - Galleries above the first one on screen get counts but no thumbnails.

3.1b **The next gallery after a preview.** Once the 3 rounds are done, open a gallery preview (5.1) on gallery N
    and move off it.
    - **Expect:** `loading ahead: the next gallery's first page, after a preview` for gallery N+1: the rest of its
      first page of thumbnails (beyond 30). Only when nothing else is waiting.

3.2 **A hovered gallery goes first.** On a fresh tab, hover a gallery near the bottom of the screen within
    the first second.
    - **Expect:** the first `Page: … round 1` header is for the hovered gallery, followed by the
      galleries below it.
    - Not tested before: whether a hover *after* loading has started moves the start point. By the spec
      a hover moves it only when scrolling stops (test 4.3).

3.3 **It keeps going down the page.** Leave a long search page alone for a minute.
    - **Expect:** `loading ahead: thumbnails` lines keep arriving, about one gallery every 4 s on eporner (measured
      cold, Chrome), until the last gallery. The chips below turn blue in order.
    - **Fail, already reported once and never reproduced:** all traffic stops for minutes, the galleries
      below stay grey, and a small scroll restarts it. If you see this, copy every `loading ahead:` line
      from the last 30 s **before** you scroll, and note whether a gallery or preview was open at the
      time. The suspect is a stuck gate in `galPreNext`.

3.4 **Covers' own originals wait behind counts.** This is the hover preview of a normal (non-gallery)
    picture on the same page.
    - **Expect:** while counts are still arriving (test 2.1), the page's own pictures don't preload
      their originals. Once counts are done, they do.
    - You said you'd circle back to this. Note whether the wait bothers you.

---

## 4. Scrolling

4.1 **Slow scroll: loading continues.** Scroll down slowly, a few lines at a time, with pauses shorter
    than a second.
    - **Expect:** no `scrolled past` line as long as the gallery being loaded is still on or below the
      screen. Thumbnails keep arriving.

4.2 **Fast scroll past: loading stops.** From the top, scroll quickly 5+ screens down, past the gallery
    being loaded.
    - **Expect:** `loading ahead: scrolled past what was loading; waiting for the scroll to stop`. No new
      thumbnail or original requests start; requests in flight finish. Counts carry on (`fetch` rows
      continue).
    - **Fail:** the script keeps loading the galleries you scrolled past.

4.3 **Stop, wait 1 s for a hover.** After 4.2, stop scrolling and hover a gallery straight away, within
    about a second.
    - **Expect:** after about 1.25 s, `loading ahead: scroll stopped; from the hovered gallery`. The gallery
      preview opens on that cover at 500 ms, and the main page waits while any preview is up (`galPreNext`), so
      `loading ahead: thumbnails` for that gallery and the ones below come once the pointer leaves the cover.
      eporner, Chrome: verified (v0.404.0).

4.4 **Stop with no hover.** Repeat 4.2, then stop with the pointer on empty space.
    - **Expect:** `loading ahead: scroll stopped; from the first gallery on screen`, and loading restarts
      there.

4.5 **Cut work is redone.** A gallery whose loading 4.2 cut short (its line says `cut: true`) gets loaded
    again later when you scroll back to it.
    - **Fail:** a gallery that stays grey forever after a fast scroll.

---

## 5. Gallery preview (`G13`)

5.1 **Opens after 500 ms.** Rest the pointer on a gallery cover.
    - **Expect:** after half a second, that gallery's first page of thumbnails is laid out around the
      cover, and the cover stays in place. There's no page bar, no picture bar, no controls and no
      strip. The storage readout (RAM / ahead / disk) shows at the cover's bottom right (v0.394.0).
    - **Fail:** it opens instantly, opens over a normal (non-gallery) picture, or shows any bar.

5.2 **Nothing in it is clickable or hoverable.** Move over the thumbnails around the cover.
    - **Expect:** no hover preview and no highlight. Moving off the cover closes the whole preview
      (5.3).

5.3 **Closes on leaving the cover.** Move the pointer off the cover. **Expect:** it closes at once.

5.4 **Closes on leaving the window fast** (v0.388.0–v0.389.0). Move from a cover straight out of the
    browser window, both within half a second of arriving on it and after it has opened.
    - **Expect:** it never opens after you've left, and an open one closes.
    - **Fail:** a preview appears once the pointer is outside, at the spot where it left.

5.5 **Closes on scroll.** Scroll the wheel while it's open. **Expect:** it closes and the page scrolls.

5.6 **A left click follows the link.** **Expect:** the preview closes and the browser opens the gallery's
    page, as with no script.

5.7 **Moving to the next cover switches it.** Move straight from one cover to the cover beside it.
    - **Expect:** the first preview closes, and after 500 ms the second one opens.
    - **Fail:** nothing opens on the second cover until you leave and come back.

5.8 **Middle-click opens the real gallery from it.** Middle-click the cover while the preview is up.
    **Expect:** the preview closes and the gallery opens (section 7). The chip does the same.

5.9 **No normal hover preview on covers.** **Expect:** a gallery cover never shows the ordinary enlarged
    picture preview, only the gallery preview (`P17`).

5.10 **The preview is not "seen".** Open previews of 3 galleries without middle-clicking.
    **Expect:** none of them gets the seen tick, and they stay in the endless queue.

5.11 **Keys and wheel stay the page's.** With the preview up, press PageDown.
    **Expect:** the page scrolls (and the preview closes, per 5.5).

---

## 6. Idle work

6.1 **Counts read to their end only when idle, last of all.** Leave a page alone until 3.1's two passes (and
    3.1b, if you previewed) have reached the end of the page.
    - **Expect:** `loading ahead: idle, reading a count to its end {href}`, one gallery at a time, and
      that gallery's chip goes from `N+` to its true `N` (e.g. `19+` → `40`).
    - **Fail:** this line appears while thumbnails are still loading, or a chip stays at `N+` forever
      after the page has been idle for minutes.

---

## 7. Opening a gallery (endless on, the default)

7.0 **Load all on (the default): every original at once** (v0.397.0, `G14`). Middle-click a cover (or click its gallery button)
    and don't hover anything.
    - **Expect:** the main page's loading stops at once. `orig galo` loads start within a second, from picture 1,
      through every picture of the gallery (`gallery originals: done {pictures, found}` at the end), with the next
      2 galleries' thumbnails (`thumbnails of gallery N of the queue`) alongside. eporner, Chrome: 279 pictures,
      49 MB in about 80 s. `gallery originals: restarted` (v0.398.0) is a run replaced by a newer one (layout, hover,
      page step), not a stop; `cut` is a stop.
    - **A hover jumps the queue:** hover a picture far down that hasn't loaded yet. **Expect:** `a preview;
      originals from picture N`, and loading carries on from N.
    - **Page steps don't stop it:** PageDown. **Expect:** no `pages skipped` line; loading carries on.
    - **Next gallery:** step past the last page into the next gallery. **Expect:** its originals start from its
      picture 1.
    - **Memory full:** on a gallery bigger than the memory cap (Settings → *Memory for an open gallery*; set it
      to 64 to try it), **expect** `memory keep: dropped …` and then `gallery originals: memory full`, and no more
      original requests until you page on.

7.1 **Load all off (data saver): 2 galleries of thumbnails ahead, no originals.** Untick Load all in the right-click menu, close the
    gallery, then middle-click a cover and don't hover any picture.
    - **Expect:** the main page's loading stops at once. Then
      `loading ahead: thumbnails of gallery N of the queue {href, ahead: 2}` for the next 2 galleries:
      thumbnails of their first 2 pages, and **no originals**. eporner, Chrome: verified (v0.397.0).
    - Tests 7.2–7.7 are data-saver tests unless they say otherwise; tick Load all (right-click menu) again afterwards.

7.2 **A hover starts originals.** Hover a picture in the gallery, say picture 4.
    - **Expect:** `loading ahead: a preview; originals from picture 4`, then original requests from
      picture 4 through the end of the page after next, paced per 1.1 and 1.2.
    - Pictures before 4 aren't loaded. Pages not laid out yet aren't loaded either; at the start that's
      2 pages.
    - At the end of the run: `gallery originals: done {pictures, found, bytes}`.

7.3 **Hovering inside the run doesn't restart it.** Hover picture 10 while 7.2 runs.
    **Expect:** no new `a preview` line, and the run carries on.

7.4 **Hovers find the originals ready.** After 7.2 finishes, hover pictures 5–20 one after another.
    **Expect:** each preview shows the full-size picture at once, with no loading ring.

7.5 **The ahead ramp: 2 → 5 → 10.**
    - **Expect:** a forward page step (PageDown or ↓), or reaching the 2nd gallery of the queue, raises
      `ahead` to 5. Reaching the 3rd gallery raises it to 10. Each raise prints `thumbnails of gallery N
      of the queue` lines for the newly covered galleries.

7.6 **A forward page step means skipping: thumbnails only** (Load all off). After 7.2, press PageDown.
    - **Expect:** `loading ahead: pages skipped, thumbnails only until the next preview`. Original
      requests stop (in-flight ones finish), and the next galleries' thumbnails continue.
    - Hovering a picture on the new page starts originals again from that picture (7.2's line again).

7.7 **A backward step loads 5 the other way first.** On page 3, hover a picture, then press PageUp (or ↑).
    - **Expect:** originals for the 5 pictures before where you were load first, then forward loading
      resumes. Pressing PageUp again follows you back.
    - "Where you were" is the first picture of the page you stepped back from. eporner, Chrome (v0.404.0): from
      page 5, PageUp loaded 180 → 176 first, then 192 on. With no preview since the last forward step (originals
      off), a backward step loads nothing until the next hover.

7.8 **Slideshow: originals run ahead of it.** In a gallery, start the slideshow (⛶ on the clicked
    picture's bottom right) and step forward with → or `]`.
    - **Expect:** originals load from the slideshow's picture through 2 pages on and move along with it.
      Each picture shows at full size at once. Slideshow steps never trigger the 7.6 "skipped" rule.

7.9 **Slideshow backward.** In the slideshow, step back with ← or `[` several times.
    - **Expect:** the 5 pictures behind load first, following you as you keep going back, and forward
      loading resumes when you go forward again.
    - Not verified by Claude.

7.10 **Reaching the end of a gallery.** In the slideshow, run to within 2 pages of a gallery's end.
     **Expect:** the next gallery's first page of originals starts loading, so the step across galleries
     (`G12`) shows full size at once.
     - eporner, Chrome (v0.405.0): verified. In a 19-picture gallery the next gallery's originals were loading from its
       picture 1, and its picture 1 came from the preload buffer at 1280x1920.

7.11 **Closing the preview doesn't stop originals.** Hover a picture (7.2), then move the pointer between
     pictures so no preview is up. **Expect:** the originals run carries on.

7.12 **Closing the gallery drops its queue.** Press Esc (or the chip's ✕) in the middle of a run.
     - **Expect:** no more original or queue-thumbnail requests start. The main page resumes
       `thumbnails and first originals` from the first gallery on screen.
     - If the slideshow showed pictures loaded ahead, you'll see
       `loading ahead: originals shown that the browser kept {kept, of}` (test 10.1).

7.13 **A missed original is tried again** (v0.395.0). On a site where some originals fail (`found` lower
     than `pictures` in 7.2's `done` line), close the gallery and open it again, then hover.
     - **Expect:** the second run's `found` is equal or higher; the misses were tried again, not skipped
       for good.
     - **Fail:** each hover fetches its own original one at a time (the girlstop report).
     - Not run: on eporner every run found all its originals (5/5, 7/7), so there was nothing to retry.

---

## 8. Endless off

Turn off ☐ Endless at the clicked picture's bottom left (or in Settings), close the gallery, and use a fresh
tab.

8.1 **Main page.**
    - **Expect:** originals only for the first gallery on screen, and thumbnails for the 3 galleries after
      it. Then loading stops (no more `thumbnails…` lines).
    - eporner, Chrome (v0.405.0): verified. Thumbnails for g1–g4, 2 originals for g1, then idle.

8.2 **The 40 % rule.** Open (middle-click) galleries until 40 % of the page's galleries carry the seen
    tick, closing each one.
    - **Expect:** once you're past 40 %, the main page goes on loading thumbnails and 2 originals for
      every gallery below, as in 3.1.
    - eporner, Chrome (v0.405.0): verified. With 11 of 27 seen, thumbnails loaded for g12 with the anchor at g5.

Turn Endless back on afterwards.

---

## 9. Storage readout (v0.394.0) and the memory keep (v0.397.0)

9.1 **Expect:** three lines at the bottom right of the gallery's picture:
    - **RAM:** gallery originals this script holds in memory (exact bytes).
    - **ahead:** an estimate of the pictures loaded ahead, from their pixel counts (over-counts JPEGs about 3×).
    - **disk:** the whole site's storage, as the browser reports it.

    It updates every second while a preview or gallery is open. During 7.0, RAM should climb. It disappears when
    everything closes.

9.2 **Nothing overlaps at the smallest size.** Drag a corner of the clicked picture to make it as small as it goes,
    then hover it. **Expect:** it stops at 160×134 (the picture, without the strip); ⓘ ↗, ⤓ ✕ ⛶, the R/P/D readout
    (spelled out while hovered), ☐ Endless and ☐ All all clear of each other and clickable.
    - Without Ctrl the drag snaps, and stopped at 239x157 here; hold Ctrl to reach the minimum.
9.2b **Last page.** Page to the end of the last gallery. **Expect:** no ✕ beside ▶ until then; the totals stay
    normal colour; ▶ shows "No more pages" in red for 2 s and brings up ✕ beside it, which closes the gallery; ◀
    hides ✕ again. Both strip rows are the same height. Unhovered: only ✕ and ⛶ show on the picture, at 60 % (the R/P/D
    readout hides too).
9.2c **Typing a number blocks previews.** Click the page number ("Page: [n] (n/N)"), then move over thumbnails.
    **Expect:** no preview opens until the box closes.
9.2a **Jump box.** Click the pressed P: on the page row, then click a thumbnail without typing. **Expect:** the box
    closes and nothing else happens. Click G: (it presses), click it again, type 2, click away. **Expect:** gallery 2
    opens and the click does nothing more.
    - eporner, Chrome (v0.405.0): verified. The frame is 196x130 (picture 190x124 inside the border); each control
      hit-tests as itself, and the gaps are 3 px or more.

9.3 **Behind is dropped, ahead kept.** With debug on, open a long gallery with Load all on and page forward 4+ pages.
    **Expect:** `memory keep: dropped N` lines once pictures are more than 2 pages behind you; RAM stops growing
    without bound. Pictures behind you are also dropped after 5 minutes. Page back 5 pages: the dropped ones load
    again (the 5-before rule), not from memory.

## 9b. Same control, same behaviour (v0.426.0)

9b.1 **Every page step closes the preview.** In a gallery of 2+ pages, start the slideshow (fullscreen too), then
     press ↓ (or PageDown). **Expect:** the preview closes and the next page shows. Again with a typed page number
     (click P, type 3, Enter). On a page with the widget's page row, the same with ↓ and ▶. A typed *picture*
     number still moves the slideshow instead.
9b.2 **No more pages, on a page too.** Scroll a page with the widget's page row to its end; press its ▶.
     **Expect:** "No more pages" in red for 2 s, then the page number again.
9b.3 **Zoom box acts like the number boxes.** Pin a preview, click its zoom %, then click the picture without
     typing. **Expect:** the box closes; the picture does not move, zoom or play. Type 150 and click the picture:
     150 %.
9b.4 **No previews while typing in Settings.** Click into a number box in Settings, then move over a thumbnail.
     **Expect:** no preview until you click elsewhere.
9b.5 **One label per setting.** Right-click the widget: the entries read as in Settings (Never cover the widget,
     Fade the widgets away from the pointer, Endless mode, Show all galleries…). The manager's menu reads
     ☑ Enable debug mode. The gallery's menu ends with "ⓘ What the buttons and numbers mean", which opens the ⓘ box.
9b.6 **◀ ▶ have no tooltips** on either widget; ⇅ says "Start / stop the slideshow".
9b.7 **Destructive buttons ask.** Settings → Reset to defaults, the request log's Clear, a learned-gallery Forget:
     each asks first; Cancel leaves everything as it was.
9b.8 **Edit as text** on any Settings list. **Expect:** only the text box shows (no entry list or add row); Done
     brings them back. (v0.427.0)
9b.9 **The wheel over the right-click menu** does not scroll the page behind it. (v0.427.0)
9b.10 **Close never vanishes.** Pin a preview and let its bar fade. **Expect:** the corner ✕ stays at 60 %, full and
     red on hover. On a gallery's picture, unhovered: ✕ ⛶ at 60 %, full while the picture is hovered. (v0.428.0)

## 9c. Last, the P: / G: switch, pictures left (v0.430.0)

9c.1 **Counts.** In Endless, the page row reads "P:2/5 (248)" (this gallery's pages, the queue's in grey) and the
     picture row "41 / 90 (12,574)", centred, totals in grey. Endless off: "41 / 90" alone.
9c.1b **Small pictures are not made taller** (v0.431.0). Shrink the clicked picture as small as it goes (Ctrl), with a
     portrait gallery too. **Expect:** neither strip row is cut off; the box widens with dark bars beside the picture
     instead of the picture growing taller.
9c.2 **P: / G:.** P: is pressed (dark, bold) when a gallery opens. Click G: — it presses; the page row's ▶ ◀ now open
     the next / previous gallery at its first page, closing any preview; ↑ ↓ PageUp PageDown still step pages. At the
     queue's end ▶ shows "No more galleries". Close and reopen: P: is pressed again.
9c.3 **Last.** Click ☑ Endless once: it turns yellow and reads Last, and stays shown when the picture is not hovered;
     the picture count turns yellow. Go to this gallery's last picture (fullscreen too) and press → several times. **Expect:**
     it stays there with "End of this gallery: stopped (Last)"; the next gallery is not opened (no seen tick on its
     card). The page row's ▶ on the last page shows "No more pages". Close the gallery and open another: the box
     reads Endless (blue) again. A third click on the box turns Endless off; a fourth back on.
9c.4 **Right-click menu** with a gallery open: three dots — Endless mode, Endless mode: stop after this gallery
     (Last), Endless mode off — matching the box.
     - Claude, Browser pane, `door-whole.html` (v0.430.0): 9c.1–9c.3 verified (not fullscreen, not the menu).

## 10. Did the files loaded ahead survive in the cache?

10.1 After a slideshow run over pictures loaded ahead (7.8), close the gallery.
     - **Expect:** the console line `originals shown that the browser kept {kept, of}`, and a request-log
       row `aheadwarm` with `of` requests, `kept` of them OK. "Kept" means the picture showed in under
       500 ms.
     - **Good:** kept close to of. **Bad:** kept far below of, meaning the browser threw the files away
       and fetched them again. That's the LibreWolf cache problem; send the row.
     - Hover previews aren't counted here, only slideshow steps.

---

## 11. Reload and Back (v0.390.0, v0.391.0)

11.1 **Reload reads no gallery page again.** After a page has finished 2.1 in a tab, reload it in the same
     tab.
     - **Expect:** every chip shows its count at once, and the Network panel shows **0** gallery-page
       `fetch` requests. Claude's fixture: 150 kept, 0 fetched.
     - Thumbnails come from the browser's image cache if it kept them.

11.2 **Back is instant.** Left-click a cover (it follows the link), then press Back.
     - **Expect:** the search page comes back as it was, scrolled where you left it, with no reload.
       That's the back-forward cache; Chrome is confirmed.
     - With downloads queued (⤓), the page warns on leaving and may reload on Back. That's expected.

---

## 12. What to send when something fails

- The test number.
- Every console line containing `loading ahead:`, `gallery originals:` or `gallery preload stopped:`,
  from just before the problem until just after it.
- For a gallery problem: run `document.dispatchEvent(new CustomEvent('hover-zoom:gallery-state'))` in the
  console, then copy the single line it prints.
- For loading ahead (v0.396.0+): `document.dispatchEvent(new CustomEvent('hover-zoom:ahead-trace', {detail: '{"max":2000}'}))`
  with debug on, then copy the `ahead trace` line. It lists every load and step with times.
- For traffic or timing: the 0.7 snippet's output, or a description of the Network waterfall: how many
  requests start at once, and what kind they are.
- Browser (LibreWolf or Chrome), window size, site.

---

## Not covered by this plan

- Downloads (⤓, `G11`) and the download queue. Unchanged by loading ahead.
- Gallery layout, flying picture and marks (`G3`–`G10`), except where a test above touches them.
