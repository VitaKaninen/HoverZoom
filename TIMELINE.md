# Hover Zoom — feature timeline (what was asked for, in order)

Built from the 96 session transcripts (2026-09-03 → 2026-11-12) plus commit subjects, to fill gaps where long
messages were truncated. Versions are approximate anchors. **[REMOVED]**, **[REVERTED]** and **[REPLACED]**
mark things that were built and later taken out or superseded.

## The original idea (v0.1 – v0.2)

Hover Zoom+ (a browser extension) only expanded *some* images on a page, even on the same page. Claude confirmed it was
the extension's design (per-site plugins, pre-scan once and bind), not a user setting. Asked whether the author
would fix it (long-open issues), then: "I think we can just write a script to do what we want." Result: a
Tampermonkey userscript, **images only, no frills**, that resolves the larger original at hover time instead of pre-scanning
the page, so late-loaded and lazy images work. Public GitHub repo created.

## Phase 1 — the preview window (v0.3 – v0.12)

- Header matched to the other scripts. Click the preview to **pin** it; **X** in the corner and click-outside to close; scroll-wheel
  zoom and drag-pan for large images. (v0.3)
- Preview spawns under the cursor; pin-mode on/off checkbox **[REMOVED]** (no case for turning it off). (v0.4)
- Spinning loading ring (bright, transparent centre) instead of a dark blob. (v0.5)
- **Progressive resolution:** show the first match at once, keep searching in the background, upgrade in place when a bigger original
  is found, ring docked in the frame's corner. (v0.6)
- Loading **pie chart [REMOVED]** (never finished when it claimed); ring gets an opaque background matching light/dark page. Right-click dismiss fixed
  to not swallow the context menu. (v0.7–0.8)
- Scanning across a row of thumbnails gives one preview per thumbnail (preview no longer covers the next ones). (v0.9)
- You asked for a written description of every preview state → `INTERACTION.md` with permanent IDs (S05, T17, E22…) so
  bugs could be reported by ID. An HTML rendering of it **[REMOVED]**. (v0.10)
- Right-click: first pins, second opens the browser menu. In-bar image-actions menu **[REMOVED]**. Status bar fades after 2 s of
  pointer stillness so it doesn't cover meme text. (v0.11–0.12)

## Phase 2 — video, banners, and what *shouldn't* preview (v0.13 – v0.27)

- YouTube hover previews / poster overlays wrongly producing a preview (v0.13–0.15); status-bar fade timing and
  hover-keeps-bar visible (v0.16); 30 px reserved at window bottom for the browser's status bubble (v0.17).
- **Imgur/gif:** "visit the next page and bring the better video/image back here" — page-fetch to get the real original of gifs
  and videos, no comparison needed, the linked page's file is always the one wanted. (v0.18–0.20)
- Generic (non-site-specific) fix for gifwow-style overlays (v0.21).
- **Banner / page-furniture gate:** rotating forum banners, YouTube channel banners, 1000×577 header images previewing. Several rounds
  (v0.22–0.27), then a corpus of ~40 live pages in `banner-test-sites.md` and a full **rewrite of the banner gate** (v0.38).

## Phase 3 — window geometry, zoom, status bar (v0.28 – v0.55)

- Allow the preview partly off-screen; **detached vs pinned states collapsed**; zoom pins the window; edge-drag resize like a normal
  window; move by grabbing the middle. Went back and forth several times (v0.28–0.32). Scroll *pins* **[REVERTED]** →
  click/move pins, scroll passes through to the page until pinned.
- Move-freeze of window size **[REMOVED]** (v0.34); the X **[REMOVED]** (v0.34; a corner close was re-added later, see Phase 8).
- Invisible resize band outside/inside the border, move zone inside it (v0.33). Settings-load bug found and fixed (readSettings was silently failing).
- Bar behaviour below the viewport fixed (v0.35–0.37).
- Settings menu rework: reword "modifier key" mode (press key after hovering works), per-site disable menu fixed (iframes registered
  duplicate commands), "Opens" description, Dark Reader–proof ring colour, **live preview toggle [REMOVED]** → settings always live,
  Reset no longer wipes site lists. (v0.39–0.45)
- Session-start optimisation: CLAUDE.md slimmed 147 KB → 12 KB, docs split by topic; **script comments cut to one line per function**.
- Zoom **slider + clickable % readout** in the bar, minimum window width so controls fit (v0.47–0.51); slider stops snapped so it can hit
  100 % (first attempt v0.52 was wrong, redone v0.53); zoom floor 30 % (v0.54); zoom field commits on blur, own quick tooltips (v0.55).
- Quirks-mode pages (no doctype) mis-measured the viewport (v0.46).

## Phase 4 — site compatibility and video modes (v0.56 – v0.62)

evilmilk (fetch the linked page's full image, v0.56–0.57), angryduck video listings (v0.58). The single "don't play videos" checkbox was
answering three questions, so it became a **"Moving pictures" setting with explicit options** (v0.59–0.61). Animated
.webp filtered out when clips are off; an option for previewing videos was dropped/reworked (v0.62).

## Phase 5 — video controls and fullscreen (v0.63 – v0.77)

- Translucent floating **video control strip** (play, mute, speed, etc.) and a **fullscreen button** in the bar. (v0.63)
- Fullscreen remembers/restores size, position, zoom; exits to pinned. A fullscreen bug cancelled YouTube's own fullscreen (v0.65).
- Volume popup tried a "stay until clicked away" design, then you asked for the hover-with-delay version (v0.66–0.68); stuck-slider bug fixed.
- Fullscreen: hide page scrollbar, no border in fullscreen, drag-to-pan no longer pulls the window out (v0.74–0.77).
- Settings copy rewritten to be as short as possible; per-setting defaults added; **grab border / grab bar visual added then [REMOVED]
  within the same day** (v0.70–0.72); fade delay and fade duration separated; zoom % no longer moves with browser zoom
  (display-scale *setting* **[REVERTED/never built]**, fixed differently).
- Independent review by another model (`REVIEW-BRIEF.md` / findings) → all fixes applied (v0.78); the two review files then deleted.

## Phase 6 — robustness and site rules (v0.79 – v0.95)

Load-fail/timeout rework; page `img-src` CSP wall → **fallback that fetches the bytes via GM_xhr** (v0.83); Bing/Brave/Google Images fixes;
a wait derived per URL from file size instead of a flat timeout (v0.88–0.89); mined Hover Zoom+'s 398 plugins for reusable URL rewrites (v0.86);
Pinterest, ArtStation, Etsy, Unsplash, Discord (two stacked `<img>` per attachment), wallpapers, lazy placeholders (v0.84–0.95).

## Phase 7 — the slideshow ("tour"), v0.96 – v0.119

Asked for a next/previous mode across every picture on a page (written up in `docs/TOUR.md` first; design borrowed from Forum Stumbler's page reader).
- Next/prev from a pinned window, derived fresh on every press, scrub-speed capped; preload 6 ahead; make lazy pages load more; carry on onto
  the next page; stay in the area it started in; floor on picture size (v0.96–0.102).
- Preview-flash on videos returned after the tour was added → fixed, then reworked so a video that plays behind the preview *withdraws*
  the preview (v0.103–0.105).
- **Learned wait for sites that swap in their own video preview** (v0.106–0.117): first a per-site delay, then learning only after a preview was shown
  and retracted, then per-page-area rules (`{dom, path}`), editable ms, shorter wait while re-learning, then a tidy-up. This became the
  general "learn, self-correct, age out" pattern recorded in the shared CLAUDE.md.
- Settings panel remembers open/advanced/scroll per tab (v0.110).

## Phase 8 — the widget, shared dock, positions (v0.120 – v0.162)

You wanted the next button to stop moving around. Result: a **separate ◀ n/N ▶ widget** with a shared positioning "dock" across
Hover Zoom, Forum Stumbler and Reddit panel (thirds zones, 8 px snaps, group moves, Reddit's look). Then:
- Count taken at load; scoping so one article doesn't carry onto the next; per-site remembered positions; "Opens: Where I last put it". (v0.122–0.124)
- **"Centred" Opens option [REMOVED]** (folded into "Where I last put it"); **"Pin with" setting [REMOVED]** (one click model everywhere). (v0.125–0.126)
- Hotkey-only mode: no delays; quick double press pins; (v0.127)
- **Slideshow sections (Main / Replies / Sidebars…) [REVERTED]** the next day (v0.129 → 0.130); only the "leave out sidebar pictures" rule kept.
- Corner close button re-added (ring + ✕, 60 % opacity); tooltips open upward (v0.131–0.132).
- Google Images "load more" work: trigger within 10 of either end, page follows the slideshow, stuck-spinner fix (v0.132–0.138).
- Review pass v0.120–v0.138 (v0.139); naming agreed: **preview** = the window, **slideshow** = the stepping mode, **widget** = its control; "gallery" reserved for a grid-of-results mode.
- Scroll-to-bottom to load more: made **learned per site** (v0.141), then both scrolling helpers off until earned (v0.142), forgetting of false positives (v0.143), then the
  **jump to the bottom [REMOVED]** — it just scrolls along ahead of you (v0.144).
- Widget placed above the browser's link bubble (v0.145–0.149); tooltip/never-preview popup fixes.
- Lazy-loading sites: widget counts placeholders by `data-src`, even blocked ones (v0.150–0.153); widget doesn't appear on YouTube feeds (v0.154); once shown it stays even at 0 for debugging (v0.155).
- Forum slideshow stops at the end of the main post (comments skipped); red-line debug marks and Tampermonkey menu toggle (v0.156–0.160).
- Next picture loaded off-screen before resizing, to stop the stretched-old-picture flash (v0.161 — tried, then reverted on disk for testing, kept).

## Phase 9 — wheel button, performance, small-picture rules (v0.162 – v0.205)

- **⇅ wheel button** on the widget: scroll over it to step; wrap at both ends with a note; 1 s pause at each end. (v0.162)
- Delay between wheel steps **[REMOVED]** v0.163, repeat-key/held-button behaviour, "never skips a picture, waits for each to show" (v0.163–0.171); widget tip simplified.
- Preloading explained; memory/metered **preload settings**; size-ratio semantics clarified (v0.167–0.170).
- Performance work after CPU/fan complaints: private perf recorder (v0.177), post-end scan fixed, memoised block list, etc. (v0.178–0.184).
- **Starter block list** for site UI icons (Gmail/Google, X, Facebook…), restored by Reset (v0.174). Small pictures preview only if avatar or emoji; emoji on by default (v0.175–0.176).
- Thumbnail-grid sites (Commons, Lemmy) get a widget (v0.185). Wheel re-throttled (150 ms drop unless a deliberate fast spin) **[the delay returns]** (v0.186–0.188); widget keeps one list per page.
- Widget snaps above the browser status bubble (v0.190–0.191); videos with their own page previews not counted (v0.192).
- **Duplicate skipping** in the slideshow — by URL, then by comparing the file contents/pixels, with a yellow `(n)` count (v0.193–0.196).
- Wikipedia thumbs moved host → rule fixed; **rule-health tracking**, linked-page fallback when originals move host, ⚠ on the widget when
  originals are dead (tried as "looks low-res" **[REPLACED]** by "links return nothing") (v0.199–0.203).
- Amazon `aria-hidden` thumbnails; CSS sprite sheets excluded (v0.204–0.205).

## Phase 10 — learning/self-repair generalised (v0.206 – v0.221)

Avatars got their own regular preview via **learned page areas** (3 samples → rule; no cap on rules; aging: 90 days unused → marked, revival
lengthens the span, deleted a year later). You asked to generalise it: written into the shared Monkey Scripts CLAUDE.md as a rule for all scripts, then
applied to own-player refusal, learned video wait, and linked-page fetch (v0.209–0.212). Also:
- Slideshow frame/picture swap re-fixed three times (v0.213 → 0.215: canvas over the window, one paint) — LibreWolf-specific.
- Widget skips divider strips/logos/overflowing sidebar carousels (v0.216); quoted site-list entry = one exact page (v0.217); **"teach where the original lives"**
  magnifier button in the bar (v0.218); preloaded-picture loss detected (v0.219); preview sits under other scripts' widgets (v0.220); widget ignores notification dropdowns (v0.221).

## Phase 11 — saving and polish (v0.222 – v0.229)

CSP-bytes preview gets its own right-click Save/Open/Copy menu (v0.222); version line at the bottom of settings (v0.223); shared request log in Diagnostics (v0.224);
Tampermonkey menu toggles keep or close the menu with 3 s popups (v0.225, v0.229); **Alt+click save [REMOVED]** → **middle-click saves the original** (v0.226–0.228);
site-list path entries and trailing `*` (v0.227).

## Phase 12 — gallery mode (v0.230 – v0.253), the biggest churn

Brief: on result pages where each result opens a gallery of 20–60 pictures, show those pictures without clicking through. Off by default; per-site toggle.
- v0.230 floating thumbnails around the pointer → hidden-frame reading with the widget's rules, HTML fallback (v0.231–0.232, 0.236) → grid sized to the count (v0.233) **[REPLACED]** by packed rows (v0.234).
- Darkened backdrop; scroll hides it; green ✓ on seen results, remembered for 10,000 (v0.236–0.238); thick green tick, no box; 50 px edge dead zone (v0.239).
- Empty space for the cursor: widest-picture slot (v0.240 — **"take it back to here" bookmark**) **[REPLACED]** by plus-shaped hole (v0.241) **[REPLACED]** by "edge third reveals next" (v0.243) **[REPLACED]** by 9-section looking-out-from-centre (v0.245) **[REPLACED]** by
  page blur + blue ring (v0.246–0.247) **[REPLACED]** by *Ctrl held = this result* (v0.248) → **Ctrl tap toggles and locks a target** (v0.250).
- Double ✓ for galleries actually visited (v0.242); seen counts only after 1 s (v0.249).
- Locked-gallery thumbnails get previews; save-from-gallery workflow with a blue "saved" disc (v0.251); middle-click opens the gallery one-handed, on/off widget button, "visited" = navigation (v0.252).
- Warning when site list blocks thumbnails (v0.253); mode remembered per site (v0.254).

## Phase 13 — gallery reliability and saving options (v0.255 – v0.273)

Dim + pulsing ring after a 3 s wait with a copyable diagnostics popup on failure (v0.255–0.256); **convert on save** (off by default, PNG/JPEG/WebP; v0.257);
**file-naming scheme** with terms, `[orig_name]`, default `[site] - [page_title] - [orig_name]` (v0.258–0.259); seen-tick debug and size fix (v0.260–0.261);
safeguards after a YouTube crash: only the visible tab preloads, no video/embeds in the hidden frame, freeze watchdog (v0.262); preload all full-size originals on open (v0.263);
open-failure trace (v0.264); fewer-than-expected pictures — notice (v0.265) **[REPLACED]** by silent automatic retry (v0.266); gallery hover no longer lags with 0 hover delay (v0.267–0.268);
**Opens: Under the pointer** (v0.269); hover previews use the slideshow's staging so the old picture never flashes (v0.270);
middle-click save once per page visit with "Already saved" (v0.271); small blue saved mark following the pointer (v0.272); fullscreen no longer locks scrolling on feed sites so infinite scroll keeps loading (v0.273).

## Things you decided against (worth remembering)

pin-mode checkbox · pie progress · in-bar menu · live-preview toggle · grab border · Centred opens · "Pin with" setting · slideshow sections · jump-to-bottom ·
Alt+click save · Claude's "looks low-res" ⚠ · notice-on-partial-gallery · all earlier gallery hole/reveal methods.
