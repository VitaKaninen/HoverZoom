# The tour — next/previous navigation through a page's pictures

**Status: §0-§8 and §11 are BUILT (v0.96.0-v0.97.0); §7 was built earlier (v0.88.0-v0.89.0).** What is
left is §9 (the scroll excursion) and §10 (cross-page harvesting).
Sections that are built are kept because the reasoning still explains the shape; where the build
departed from the plan the section says so.

The live account of what the code does is `INTERACTION.md` `S25`, `S26`, `T29`-`T34`, `E54`-`E57`.

A *tour* is next/previous navigation through every picture on the page, driven from a pinned
preview window. The window stays put; the page does not move; each step swaps a different picture
into the same frame.

**No line numbers into `Hover-Zoom.user.js` appear below, deliberately.** They were here, taken at
v0.79.0, and v0.80.0–v0.85.0 moved the probe region ~110 lines; a plan this long outlives any of
them. `grep -n` the symbol name. (Refs into *other* scripts — Forum Stumbler, OLINT — keep their
numbers; those files are not moving under us.)

### What shipped since this was written, that the plan assumed was missing

v0.80.0–v0.85.0 landed the resolver work §14 was measuring, so three items below are done:

- **CSP refusal is detected and routed** (`cspRefused()` → `bytesFor()`, v0.83.0). A page whose
  `img-src` refuses off-site images now gets the bytes via GM_xhr and displays them as `blob:`, or
  `data:` where `blob:` is also refused. `@connect *` is in the header for this.
- **Brave's base64url originals decode** (v0.84.0), generically — any imgproxy-shaped path, not a
  Brave rule. Verified end-to-end in a real browser 2026-09-07: a Brave result whose only candidate
  was a 500 px proxy thumbnail previews as the 564×752 original.
- **Size parameters drop from extensionless CDN paths** (v0.83.0), plus Reddit/Flickr/gelbooru
  rules and leading thumbnail markers (v0.85.0).

v0.86.0-v0.87.0 then took the marker vocabulary out of HZ+'s plugins and added Pinterest's size
segment, and **v0.88.0-v0.89.0 built §7 and §8** — the retry model, the size-derived timeout budget,
and showing the page's own picture with a reason when one fails. Those were the parts that were
*not* about the tour, and they are done. `RESOLVER.md` holds the live account of all of it.

---

## 0. The invariant rewrite — DONE, v0.96.0

The rule in `../CLAUDE.md` was rewritten, and so was the script's own header comment. What follows
is why, kept because the reason is the part that stops it being rewritten back.

`../CLAUDE.md` used to carry, under "Design invariants":

> **Nothing is decided before hover time.** … Do not add a MutationObserver or a pre-pass "for
> performance", and never bind state to an element that might change under it.

Replace it with:

> **Nothing is cached that the DOM can invalidate.** Everything resolves from a read taken at the
> moment it is needed — hover time for a preview, press time for next/prev. Do not add a
> MutationObserver or a pre-pass "for performance", and do not hold a reference to a page element
> across an interaction; re-derive instead. Reading the document ahead of a hover is fine, and the
> navigation list does exactly that — keeping the answer is what causes the bugs.

The old wording banned reading the document ahead of a hover. What it was actually protecting
against was *keeping* the answer: stale `src`, SPA navigation, images added after a scan, dead
references. The list below re-reads on every press and keeps nothing, so it has none of those
failure modes.

Approved by the user 2026-09-07. The rule is not a veto on the feature; it is being changed
because it outlived its scope.

---

## 1. The list is derived, never stored

On every press: `document.querySelectorAll('img,video')` → sort into reading order → find the
anchor → step. No observer, no scroll listener, no maintained array.

Why this shape rather than a maintained list:

- A maintained list fills with nodes a virtualised feed has already destroyed, and you then owe
  reconciliation code to notice.
- Re-deriving is ~5ms on a keypress. That is a keypress budget, not a hover budget.
- Lazy-loaded and newly appended images are picked up for free, because every press re-reads.

`coveredMedia()` is the existing precedent: a read performed at the
moment of need, caching nothing.

### The anchor is an element, not an index

Store the current element, its URL, and its last known document-space position. Each press locates
the anchor by, in order:

1. element identity
2. URL match
3. nearest by last known position, in the direction of travel

Step 3 is what survives a virtualised feed deleting the node under you. Never store an index — the
list length changes under you.

### Ordering

- Sort in **document coordinates** (`rect.top + scrollY`), never viewport coordinates, or the
  order changes as the page scrolls.
- Reading order is a **row-band sort**: group items whose vertical extents overlap into a row,
  then sort by `left` within the row. A plain `(top, left)` sort scrambles masonry and any ragged
  grid where a neighbour sits a few px lower.
- Ties break on document order.

### Membership

An entry is eligible if `eligibleDirect(el)` returns it. That guarantees the list can
only hold things that would preview if hovered, and it inherits every existing gate — `videoMode`,
the block list, banner/furniture rules — with no new code. Clips and images share one list.

**Never drop an entry for failing to resolve.** The user's stated reason: a page with 50 images
must give a tour of 50, and a picture they spotted half way down is their landmark for "half
done". A failure shows the thumbnail and a reason (§8); it does not vanish.

That extends to the size gate. `sizeOf(el)` reads the layout rect, and a below-the-fold
`loading="lazy"` image with no width/height attributes is often 0×0 until it loads. Fall back, in
order: layout rect → `width`/`height` attributes → probed dimensions. Only something that is
genuinely not a picture leaves the list.

**Scope limit:** `img`/`video` only. Elements with a CSS background image stay hoverable but are
not in the tour — enumerating them needs `getComputedStyle` on every node in the document.

---

## 2. The swap

Three functions now put media in the window, and they are not interchangeable:

| Function | Used when | Keeps |
|---|---|---|
| `showViewer()` | opening a new window | nothing; positions from the pointer, fades in |
| `upgradeViewer()` | a better version of **the same** picture arrived | zoom and pan — you stay on the same spot |
| **`swapViewer()`** — new | a **different** picture, same window | position, and the hand-set size if there is one |

`swapViewer()` resets `scale` to `fitScale` and recentres `ox`/`oy` — carrying a pan offset into a
different picture is meaningless. Borrow the centre-preserving arithmetic from `upgradeViewer()`.

It must also update `active` and `activeShown`, or ⊘ blocks the wrong image and unpinning
misbehaves.

### The anchored corner

**The bottom-right corner of the window does not move during a tour.** The nav buttons live at the
bottom-right of the strip, so pinning that corner keeps them under the pointer across every swap.

Capture `right = view.left + outerW()` and `bottom = view.top + outerH()` before the swap; after
`reflow()` recomputes the frame, set `view.left = right - outerW()` and
`view.top = bottom - outerH()`. `clampPosition()` still runs after.

### Growing and shrinking — already free

Frame follows the picture unless the user hand-resized. This is existing behaviour and needs no
new code: `view.fixedW`/`fixedH` are null until a hand resize, `resizeBy()` is their only
writer, and `reflow()` already branches on them. `swapViewer()` calls `reflow()` and gets
the right answer either way.

### Size floors

- **Width is already floored.** `reflow()` floors `frameW` at `minFrameW()` → `barMinW()` when
  placed, and centres a narrower picture inside it. Small images letterbox rather than
  shrinking the controls.
- **Height is not.** `frameH` floors at `MIN_FRAME` (48), while the strip hides below `VCTL_MIN_H`
  (110). A short image mid-tour would make the nav buttons vanish. Add a height floor during a
  tour.
- **One deliberate decision reverses.** The comment above the bar metrics constants says the strip's metrics
  intentionally never reach `btnGutter()`, `barMinW()` or `bottomGap()` — floating it means it
  reserves nothing. That was right for optional video controls. It is wrong once the strip holds
  the only mouse route to next/prev: `barMinW()` must account for the strip's width when nav is
  present, or a narrow frame clips the buttons off.
- **Cap the frame at the viewport during a tour.** `maxSizeMultiple` defaults to 1.2 (`growBox()`), so a frame can exceed the viewport; anchored bottom-right, a large picture would then
  run off the top-left and be clipped there for the whole tour. Treat a tour as a lightbox.

---

## 3. Entering tour mode

| From | Gesture | Result |
|---|---|---|
| hovering, not pinned | → or Next | pin, relocate, **and advance** |
| pinned by mouse | → or Next (first time) | relocate **and advance** |
| pinned, already relocated | → or Next | advance only |

Relocation puts the anchored corner at `vpW() - EDGE_GAP`, `vpH() - EDGE_GAP`. Not flush:
`bottomGap()`'s 20px allowance is for the browser's link-target tooltip, which is painted
bottom-**left**, so the bottom-right corner does not owe it.

**Relocation happens exactly once per pinned window.** One boolean, set on the first arrow/next
press, never consulted again. After that the window is the user's: if they drag or resize it, use
what is there and never touch the position again — including when they walk back to the start with
◀ and forward again.

Dragging needs no flag. Each swap recomputes `left`/`top` from the bottom-right corner, so a drag
moves that corner and later swaps hold the new one.

The flag is per pinned window. Unpinning and pinning a different picture starts a fresh tour and
relocates again on its first arrow press.

Animate the move over **100ms**. Try it; a jump is acceptable if the animation looks worse.

---

## 4. The strip

One element holds both groups. Do not build a second floating box.

```
[ ▶ 0:04/0:31 ══slider══ 100% 🔊 ]  [ ◀  124 / 294  ▶ ]
 └────── video group, .hasvid only ──┘ └── nav group, always ──┘
```

- **Video:** full-width strip; scrubber flexes into whatever the nav group leaves.
- **Image:** the same strip shrinks to the nav group and sits right, same height, same background,
  same blur.

The mechanism is one line: `.vctl` currently pins both edges in `layoutChrome()`. Make
`left` conditional — `grabInset()` with a clip, `auto` without. An absolutely positioned box with
only `right` set shrinks to content. Transitions between the two are free because `layoutChrome()`
runs from every `layout()`, which runs from `setMedia()`.

Give the nav-only state an **explicit width** rather than relying on shrink-to-fit — `../CLAUDE.md`
records that shrink-to-fit for an abspos box diverges between Chromium and Firefox, and the Browser
pane cannot see a Firefox-only fault.

### Style is shared by construction

- Build ◀ ▶ with `mkVBtn()`. Identical box, hover wash, tooltip, and mousedown/click
  swallowing, for free.
- Hoist the four `.vctl .vbtn` rules to bare `.vbtn` so a restyle is one place.
  Only `.vsound .vbtn` sizing stays scoped.
- Hide the video group with a **class, not `hidden`**. `../CLAUDE.md`: `[hidden]` loses to an
  explicit `display`, and the group carries `display:flex`. This has cost a version twice.

### The counter

`124 / 294` between the buttons, matching the reference. The total updates as scrolling and
cross-page harvesting grow the list. It is the user's sense of how far through the page they are,
which is also why entries are never silently dropped (§1).

### Five places currently assume "strip means video"

| Where | Now | Change to |
|---|---|---|
| `.box.hot.hasvid.tall .vctl` | `.box.hot.hasvid.tall .vctl{display:flex}` | drop `.hasvid`; gate the **video group** on it |
| `barHoverBand()` | widens the band only for a clip | widen whenever the strip is up |
| `pointerOverBar()` | `if (mediaEl !== vidEl) return false` | must include the strip for images, or it fades out from under the hand reaching for ◀ |
| `layoutChrome()` | sets both edges | `left` conditional as above |
| `VCTL_MIN_H` (110) | strip hides on short frames | a lower threshold for nav-only, or the §2 height floor |

`isBoxControl()` already exempts the whole `vctlEl` subtree, so buttons inside the strip
are safe from the capture-listener trap with no extra code. A separate box would have to be
registered there by hand — and the symptom of forgetting is silence.

---

## 5. Keys

`onPinKey()`.

- **Left/Right navigate when the picture cannot pan horizontally**, and pan when it can. Test
  `view.imgW > view.frameW + 0.5` — per-axis, not `pannable()`, which is either-axis.
  Correct edge case falls out: a tall picture at fit-width pans vertically, so Up/Down pan while
  Left/Right navigate.
- **Up/Down always pan.** Unchanged.
- **Add an always-navigates pair** (`[` / `]`, or PageUp/PageDown), or zooming in traps the user on
  the current picture.
- `capOwns()` already stands the arrows down while the zoom field, scrubber or volume
  slider has focus. Unchanged, works for free.

### Scrub

OS key repeat is ~30/s, ten times the target rate, and would outrun any buffer instantly.

- **Holding an arrow scrubs**: step through the list without resolving, and start resolving only
  once the key has been still for ~150ms.
- **Throttle the scrub to 5 steps/sec.** Faster than that and the user cannot see the pictures well
  enough to know when to stop. Start at 5/s and tune.

---

## 6. The preloader — BUILT, v0.97.0

**What the build settled, beyond the plan:**

- **A speculative resolve issues one request at a time, not eight.** The plan feared "six
  concurrent resolves is up to 48 simultaneous requests" and asked for a global in-flight cap.
  There is none, because `resolve()`'s candidate loop `await`s each probe: a resolve has at most
  two requests open, its current probe and the linked-page fetch running beside it. The worker
  count IS the cap. **Slot spacing is still what bounds the request rate** — `plReserve()` hands
  out start times `PL_GAP_MS` apart, computed synchronously before any `await`.
- **A preload answer is only usable while the picture is still the size it was measured at.**
  `plRun` records the `displayed` rect it applied the `minRatio` gate against; `tourShow` refuses
  a buffered answer whose rect no longer matches (`sameDisplayed`). Without that, a below-the-fold
  entry measured at 0×0 passes the size gate trivially and caches an answer the foreground would
  have rejected.
- **`probeCache` dedup is worth more than expected.** Five separate entries in one window resolved
  to the same slow URL and cost one request between them, because the cache holds the *promise*.
- **The buffer is bounded by eviction, not by a cap.** `plFill` keeps `tourWindow` entries either
  side of the anchor and deletes the rest — which is also what stops the map holding element
  references a virtualised feed has already destroyed.
- **The no-rush list rides on the diagnosis that already exists.** `diagnose()` classifies a 429 /
  `Retry-After` as `busy`; `hardBlock()` hangs off that one line and needs no request of its own.
  It is remembered in GM storage across sessions, and it drops the pool to strictly serial.

Measured against localhost, buffered arrivals land in **~25 ms with no spinner and no upgrade
flash**. The local server cannot show the concurrency win — latency is what six workers multiply,
and there is none here; §14's live measurement is what that rests on.

### Why depth alone does not work

Measured by the user, 2026-09-07, on a Google image search results page: hovering 20 images in
sequence, each started when the previous finished, took **29 seconds — 1.45s per image**. The
target is 3 images/second.

Serial preloading N ahead still finishes one image every 1.45s regardless of N. Consuming at 3/s
while producing at 0.69/s drains the buffer at 2.31/s: a 10-deep buffer lasts ~4 seconds, about 13
images, then you are back to waiting. **Depth buys a burst; only concurrency buys a rate.**

With P resolves in flight, throughput is P/1.45 per second:

| P | images/sec |
|---|---|
| 1 | 0.7 |
| 3 | 2.1 |
| **5** | **3.4** |
| 6 | 4.1 |

**Target: 6 concurrent, window 10–15.** The window absorbs bursts; the concurrency sustains the
rate. Forum Stumbler independently landed on `PAGE_WORKERS = 6`, and **§14 measured 5.9× at 6
workers on live Google Images results — 5.3 images/sec, latency-bound as predicted.** Do not raise
the worker count without re-measuring.

**Clips are the exception**: they are 5–10× larger, so the window preloads video *metadata* only
and fully buffers just 1–2 ahead. See §14.

The two are separate settings and scale in opposite directions with connection quality: a slow link
wants a **deeper window** (more buffer), while **concurrency** only multiplies if the 1.45s is
latency rather than bandwidth. Google Images is expected to be latency-dominated — every result is
on a different third-party host, so each pays fresh DNS + TLS, and `collectCandidates` must pull
the real URL out of Google's `imgres?imgurl=` link via `linkParamCandidates` before
probing. **Not verified.** The test is to re-run the same 20-image walk against the concurrent
preloader and compare wall-clock.

### Structure — take this from Forum Stumbler

Read `../Forum-Stumbler/Forum-Stumbler.user.js`:

| Piece | Where | Why |
|---|---|---|
| **Slot-based request spacing** | `walkPageRange`, `:4048` | The standout. Reserves request *start times* spaced by `pageGap()`, computed synchronously before any `await` so two workers cannot claim one slot. Its comment: *"This, not the worker count, is what bounds the load on the forum."* Lets us have 6-wide concurrency **and** a bounded request rate. Hover Zoom has no politeness mechanism at all today — fine for one hover, not for a 6-wide preloader. |
| **`hardBlock()`** | `:3843` | Detects 429, Cloudflare interstitials, `Retry-After` on 403/503. |
| **`noRushHosts()` / `workersFor()`** | `:3867`, `:3891` | A host that pushed back drops to strictly serial, remembered in GM storage across sessions. This is the safety valve an aggressive preloader needs, already written. |
| **`ctl.cancelled`** | throughout | Matches Hover Zoom's existing `token.cancelled`. |
| **`ctl.mark(page, SEG_BUSY/DONE/TODO)`** | `:4085` | Per-item state, reported on **arrival** not delivery. What a buffer indicator would use. |
| **Failure containment** | `:4098` | `endAt = Math.min(endAt, page)` — stop scheduling past a failure, still deliver what is in hand. |
| **GM_xhr first, `fetch` fallback** | `fetchRes`, `:3902` | GM_xhr is not subject to the page's CSP/connect-src. Hover Zoom already does this in `headBytes`. |

**Do not take** the ordered-delivery machinery — the `got` map and `flush()` (`:4058`). Forum
Stumbler needs pages in order because `prevKey` and the `n` sequence only mean anything
sequentially. A preload buffer is a set, not a sequence; the user jumps to whichever picture they
are on. Dropping it removes most of the complexity. `PAGE_DELAY`'s 400ms serial politeness is also
an order of magnitude too slow for 3/s — slot spacing replaces it.

### Rules

- **A global cap on in-flight preload requests**, separate from resolve concurrency. `MAX_PROBES`
  is 8, so six concurrent resolves is up to 48 simultaneous requests without one.
- **Cut the probe budget for speculative items.** `resolve()` always tries the `keep` candidates —
  the link and the displayed src — and spends the rest of the 8 on guesses. Keep plus one
  or two guesses is enough for a preload; the full search runs on arrival if it came up empty.
- **Foreground jumps the queue.** A resolve the user is waiting on must never sit behind six
  speculative ones. Two priority tiers.
- **Cancel on direction change.** Reversing with ◀ or blocking with ⊘ drops queued preloads that
  are no longer near the cursor.
- **Preloads never write to `view`.** Own token; `onHit` records only.
- `probeCache` is keyed by URL and holds a promise, so concurrent probes of one URL
  collapse automatically. Free.

### Arrival must be flash-free

`resolve()` emits every improvement as it lands and `upgradeViewer()` swaps it in live — on a tour
that means watching a thumbnail resolve into a mid-size into the original, fifty times. Eliminating
that, not just the latency, is the point of preloading.

So: on arrival, use the **completed** preload result and go straight to the final URL, skipping the
progressive emit path. Fall back to the live path only if the preload has not settled.

### Videos are not preloaded by probing

`probeVideo()` sets `preload='metadata'` and then calls `v.load()` to **abort** the fetch
once it has dimensions. Images land in the HTTP cache as a side effect of probing; clips do not.
Pre-warming a clip needs a separate hidden `<video preload="auto">` for the winning URL.

Also keep the winning `Image` object alive for buffered entries — `probeImage` lets it go and
relies on the HTTP cache, which Chromium can evict.

---

## 7. Retry and timeouts — BUILT, v0.88.0-v0.89.0

**Shipped and verified in a browser. This section is now history; the live account of what the code
does is `RESOLVER.md` "Waiting, diagnosing, retrying".** What follows is kept because the reasoning
still explains the shape, and because one part of it was measured wrong and is worth not repeating.

**The one correction:** this section said a diagnostic that gets no response means the host is dead,
abort now. Built that way, a server that merely answers slowly timed the diagnostic out too and was
declared dead - killing exactly the case the design existed to rescue. Only an explicit refused
connection is fatal now; a timeout means slow and keeps waiting. `E52`.

Two smaller departures, both deliberate: attempts are 3 rather than 4 (the size-derived budget does
the work the extra attempt was for), and the failure display fires on a real failure only - see §8.

### What it replaced

| | |
|---|---|
| Image probe timeout | **20s** (`IMAGE_PROBE_MS`) |
| Video metadata timeout | 6s (`VIDEO_PROBE_MS`) |
| Retry on re-hover | **No, not for 30s.** `probe()` caches the *promise*; a null result schedules its removal after `PROBE_RETRY_MS = 30000`. A re-hover inside that window gets the cached failure instantly. |
| Shown on failure | **Nothing.** `resolve()` never emits, `onHit` never fires, `showViewer` is never called, the `finally` hides the spinner. The ring spins, then vanishes. |
| Can it tell a 404 from a timeout? | **No.** `probeImage`'s `onerror` fires identically for 404, dead host, CORS rejection and corrupt file. `new Image()` exposes no status. |
| Can it tell a CSP refusal from either? | **Yes, since v0.83.0** — the `securitypolicyviolation` listener names the URL, and `probeImage` routes a refusal to `bytesFor()` instead of returning null. This is the one failure kind already classified, and it is the free one. |

### The model to build

The user's analogy: type a URL, wait 3–4s, hit enter again, wait, open a new tab and retry, give up
after 3–4 attempts. **Short timeout, several attempts** — not one long wait.

- **Per-attempt timeout 5s** (from 20s), up to **4 attempts**, giving up at ~15s total.
- **A user gesture always retries.** Moving off an image and back, or pressing Retry, evicts that
  URL from `probeCache` and tries again. Automatic paths still honour the cached failure, so a page
  with a dead image does not re-probe forever.
- **Failure kind decides the schedule.** A 404/410 is definitive — one attempt, cache it. A timeout
  or network error is worth retrying. A 429 stops and marks the host no-rush. This needs the
  status, which means the GM_xhr diagnosis below.
- **A CSP refusal is definitive and free.** `securitypolicyviolation` names the blocked URL and the
  directive in ~1 ms, before any timeout and with no request spent. Never retry one, and never spend
  the paid diagnostic on it — the answer is already in hand. It is also not per-URL but per-host-set:
  once `img-src` has refused one off-site URL, every other off-site candidate on that page will be
  refused too, so the whole candidate list can be cut at once. See `RESOLVER.md` `E49`.
- **Tour retries are less aggressive but more numerous**: same 5s per attempt, ~6 attempts, backed
  off (2s, 4s, 8s), lowest priority. There is time, and nobody is waiting.

### The trap in shortening the timeout

`probeImage` resolves on `onload`, which is the **whole file**. A large JPEG on a slow link
legitimately takes more than 5s, so a flat 5s timeout would abort real downloads and retry from
scratch — an infinite failure loop on exactly the biggest pictures, which are the ones this script
exists to show.

**One number cannot serve both cases.** 20s is too long for a dead host and too short for an 8 MB
original on a slow link. The budget has to scale with the file.

#### Two dead ends — do not spend time on these

- **Resource Timing cannot report progress.** Entries are queued when a resource *finishes*, not
  while it downloads; there is no entry during the transfer. `transferBytes()` works only
  because it runs after the image has loaded.
- **`new Image()` is a black box** — no progress event, nothing between `src =` and
  `onload`/`onerror`.
- **GM_xhr + blob** gives real `onprogress`, but a blob URL is a different cache entry, so
  `mediaEl.src = res.url` would re-download. That destroys "probing *is* preloading", which the
  whole preload design (§6) rests on.
- **`fetch()` + ReadableStream** would populate the real cache, but a cross-origin image with no
  CORS headers yields an opaque response whose body cannot be read — which is exactly where images
  live, on third-party CDNs.

#### The design: measure the server, derive the budget from the file size

1. **Liveness deadline, ~3s.** If the `Image` has not loaded by then, fire one small ranged
   request. `headBytes()` is already this exact shape — 4KB, `Range` header, GM_xhr so
   CORS does not apply, own 4s timeout.
2. **Route on the answer:**
   - no response / timeout → host is dead. Abort now (~7s, not 20s).
   - 4xx → definitive. Abort, report "404 — not found", do not retry.
   - 429 / Cloudflare / `Retry-After` → `hardBlock()`, mark the host no-rush (§6).
   - 200/206 → alive; keep waiting.
3. **If alive, read the size — from `Content-Range`, never from `Content-Length`.** A 206 sends
   `Content-Range: bytes 0-4095/8388608` (total) alongside `Content-Length: 4096` (the slice).
   Reading the wrong one gives 4096 for an 8 MB file. `Content-Length` is the right source only on
   a **200**. Measured and confirmed — see §14.
   Then set the budget to `max(5s, size / floorRate)` with an absolute ceiling. `floorRate` is
   ~100 KB/s for images and ~500 KB/s for video (§14).

Why this shape:

- The fast path costs nothing; the diagnostic only fires when already waiting.
- **It is the same request as the failure diagnosis in §8.** One round trip decides whether to keep
  waiting *and* supplies the status code for the status-bar reason.
- `probeImage` keeps a plain `Image`, so the browser-cache/preload property survives.
- A dead host fails in ~7s instead of 20s, which is most of the complaint.

`headBytes` currently reads only `r.response` and discards `r.status` and `r.responseHeaders`. Both
are needed here, and `hardBlock()` wants the headers regardless.

Start `floorRate` pessimistic (~100 KB/s): an 8 MB file gets a long leash, small files fall through
to the 5s floor. Measuring the real rate is possible — request 64KB instead of 4KB and time it —
but 4KB is dominated by round-trip time and cannot give a throughput figure. Only add measurement
if the fixed floor misfires.

---

## 8. What a failed picture shows — BUILT in part, v0.88.0

Never blank, never skipped. Show the page's own thumbnail as a placeholder, plus a reason in the
status bar.

**Built, with the condition narrowed: only a genuine failure shows it, not a candidate merely
rejected for being too small.** On an ordinary hover the wider rule would pop a blurry
thumbnail over every un-upgradable picture on the page. The wider rule is still right *inside a
tour*, where an entry must exist even when broken — so when the tour is built, widen it gated on
tour mode. The free/paid tiers below both exist now: `failureText()` reads the diagnosis the
probe already paid for. The Retry button is not built and cannot be until there is a tour.

Note that `minRatio` means a thumbnail is *never* what a normal hover offers, so showing one is a
deliberate exception — which is why the note is mandatory rather than optional. Without it, "why is
this blurry" reads as a bug.

Reasons come in two tiers:

- **Free** — already computed and currently thrown away. `resolve()` knows exactly why it rejected
  each candidate: *"under the required upsize"*, *"a different shape, so a different
  picture"*, blocked, caught changing size. Each is logged under the `debug` flag and
  discarded. Capture the last rejection instead.
- **Paid** — anything needing an HTTP status. On total failure only, fire one `GM_xmlhttpRequest`
  to learn why. Rare path, and it is what makes "404 — not found" vs "site did not respond"
  sayable. The same response feeds `hardBlock()`, so failure diagnosis and 429 detection share one
  request.

The caption is built in `caption()`; `capMetaEl` carries the type/dimensions/bytes line
and is where a reason belongs. Note the `capFor`/`capDims` guard — the caption only rebuilds when
the URL or measured size changes, so a reason must invalidate it (`resetCaption()`).

### The Retry button

In the bar, **only during a tour**, and only on a failed picture. Outside a tour the user already
has re-hover. It clears the URL from `probeCache` and re-resolves at foreground priority.

Any new control in the bar must be added to `isBoxControl()` — not optional, and the
symptom of forgetting is silence.

---

## 9. Loading more of the page — the page does not move

Confirmed with the user: during ordinary navigation **the page never scrolls**. The tour shows
off-screen pictures in the preview and leaves the document where it is.

The list already handles this — `querySelectorAll` sees the whole document regardless of viewport,
and `collectCandidates` reads `data-src`/`data-srcset`, so below-the-fold lazy images
usually resolve to a real URL without ever being displayed. On the user's Google Images case ~50
results are in the DOM at load while only 20 are visible; all 50 are in the tour immediately.

### The hard constraint

**Without moving the viewport there is no reliable way to make a lazy page load more.** Most modern
infinite scroll uses an IntersectionObserver on a sentinel, which fires on genuine viewport
intersection and cannot be spoofed. Synthetic `scroll` events do not help — the handler reads the
real `scrollY` and correctly concludes nothing moved.

Worse on **virtualised** feeds (Twitter, Reddit, most modern infinite feeds): they have already
destroyed the pictures above and below the viewport, keeping ~20 posts in the DOM. A non-scrolling
tour there reaches maybe 10–30 pictures. That is not fixable without moving the viewport. Ordinary
pages — forums, imgur, boorus, blogs, image hosts, search results — keep everything in the DOM and
are fully reachable.

### The excursion

Fires **automatically when fewer than 10 entries remain ahead**, so the refill overlaps with
pictures the user is still looking at rather than stalling them at the wall.

1. Record scroll position.
2. Scroll to the bottom.
3. Bounded poll (~150ms, up to ~2s) for new nodes.
4. Scroll back to the exact prior position.
5. Re-derive; new entries join in document order and feed the preload queue with no extra plumbing.

- **Cooldown**, or it re-fires on every press while content loads.
- **An exhausted flag** — if an excursion returns nothing new, stop trying. A finite page must not
  scroll-and-return on every press near the end.
- The ▶ "load more" affordance surfaces only if the automatic attempt failed or is still running.
- Pass `behavior:'auto'` explicitly to `scrollIntoView`. A page with `scroll-behavior:smooth` in
  its CSS otherwise turns every excursion into a slow animation.

### Fullscreen

Fullscreen is the **easy** case. `borderPx()` returns 0 and `fitFull()` sizes to the
screen, so the frame is always the whole viewport: the corner anchor is a no-op, every picture
re-fits, and the controls are stationary because the frame never changes size. Nothing extra.

Excursions are better there too — `.dim.full` blacks the page out completely, so the scroll is
literally invisible rather than merely subtle.

**One thing to verify:** `lockScroll()` sets `overflow:hidden` on both `documentElement`
and `body`. Programmatic scrolling normally still works through `overflow:hidden`, but confirm it
in a real browser rather than assuming. If it blocks, `scrollLock` already stores the previous
values — restore them for the excursion and re-apply after.

---

## 10. Crossing to the next page

**Never navigate the document.** That destroys the pinned window and, on a non-SPA site, the whole
script instance.

Not needed anyway. Hover Zoom already fetches and parses other pages — `linkedMedia()` /
`pageMediaFrom()` GM_xhr a linked page and `DOMParser` it to find media. The
capability is in the file; it is just pointed at one page at a time.

At 10-from-the-end with no more scroll content: find page 2's URL, fetch and parse it in the
background, harvest its pictures, append to the tour.

### Which detector

They are not interchangeable:

- **`../Open-Links-in-New-Tab/Open-Links-in-New-Tab.user.js:1314`, `nextPageReason()`** — a
  *negative, non-directional* classifier: "is this link a pagination or sort control, so do not
  open it in a new tab." Deliberately lumps in `new`, `best`, `hot`, `top`. **Cannot tell you which
  link is forward.** Useful only as a word list.
- **`../Forum-Stumbler/Forum-Stumbler.user.js:1198`, `detectNextPage()`** — directional. This is
  the one. Its companions:
  - `derivePageTemplate()` (`:1216`) builds a "page N → URL" function from two numbered pager
    links, so you can jump to page 100 without fetching 99. Note its digit-backoff reasoning —
    `/p12` and `/p13` share the prefix `/p1`, which would put the number in the wrong place.
  - `deriveTemplateFromChain()` (`:1268`) does the same job from just the current URL and its next
    link, for pagers with no numbered links at all ("← Older posts", WordPress's default). This is
    the more useful one here. **Ambiguity is refused, never guessed** — a wrong template silently
    generates plausible URLs for the wrong pages.
  - `pagerInfo()` (`:1296`) reads which page we are on and the highest page named.

### The structural change

**A tour entry becomes either a live DOM element (this page) or a bare URL harvested from a fetched
page.** Most of the pipeline is URL-based and does not care. Two things do:

- `collectCandidates(el)` works fine against an element from the parsed detached document
  — it only reads attributes and `closest('a')`.
- `sizeOf(el)` **cannot** — a detached document has no layout. Fetched entries fall back
  to probed dimensions for the `minDisplayed` gate.

This is the largest piece of the feature. Build it last, after the tour works on one page.

---

## 11. Settings

Proposed keys, added to `DEFAULTS`. Remember the hoisting trap in `../CLAUDE.md`: every
`const` the loader touches must be declared **above** the `cfg =` line, or `readSettings()`'s own
`catch` swallows the `ReferenceError` and the script silently runs on defaults.

| Key | Default | What |
|---|---|---|
| `tourButtons` | `true` | show ◀ ▶ in the strip |
| `tourKeys` | `true` | arrows navigate when the picture cannot pan horizontally |
| `tourWindow` | `12` | how many entries to keep buffered ahead |
| `tourWorkers` | `6` | concurrent preload resolves |
| `tourScrubRate` | `5` | max steps/sec while an arrow is held |
| `tourLoadMore` | `true` | the scroll excursion |
| `tourCrossPage` | `true` | harvest the next page in the background |

Retry timings (5s stall, 4 attempts, 15s ceiling) apply to all hovers, not only tours, and are
probably constants rather than settings unless testing says otherwise.

---

## 12. Build order

1. ~~Rewrite the invariant (§0). Derive-on-demand list, anchor resolution, ordering (§1). Arrow-key
   handoff and scrub (§5). Tour mode entry, corner anchor, one-time relocation, size floors (§2,
   §3).~~ — **done, v0.96.0.**
2. ~~Strip restructure: nav group, counter, the five `hasvid` sites, CSS hoist (§4).~~ — **done,
   v0.96.0**, in the same version as step 1: the counter is what step 1's derivation is *for*, so
   splitting them would have shipped a version whose only new state nothing displayed.
3. ~~Retry and timeout changes (§7)~~ — **done, v0.88.0-v0.89.0.** They stood alone, as predicted.
4. ~~Concurrent preloader with slot spacing and the no-rush list (§6).~~ — **done, v0.97.0.**
5. ~~Failure display and the Retry button (§8)~~ — **done: display v0.88.0, the widened trigger and
   ↻ v0.96.0.**
6. Scroll excursion and load-more (§9).
7. Cross-page harvesting (§10).

Version bump and commit at each step, per `../../CLAUDE.md`.

## 13. Documentation owed

- `INTERACTION.md` needs new IDs. Highest currently used: **S24, T28, E47, P12**. Reserve S25+ for
  tour states, T29+ for the transitions (enter tour, next, previous, relocate, load more, cross
  page), E48+ for the edges — the arrow-key handoff, the scrub throttle, the thumbnail fallback,
  the anchored corner surviving a user drag.
- Add a row to the "Start here" table in `../CLAUDE.md` pointing at this file.
- New traps that belong in `../CLAUDE.md`'s "Traps that fire BEFORE you act": the Retry button and
  any new bar control needing `isBoxControl()`; the stall-vs-total timeout distinction.

## 14. Measured, 2026-09-07

Live browser tests against Google image search, Brave image search and imgur. Run on a fast link
(1.6–4.1 MB/s observed); on a slower connection bandwidth binds sooner and the concurrency figure
below shrinks.

### Concurrency is confirmed latency-bound — ~5.9× at 6 workers

30 Google Images originals, real hosts. Sum of individual load times **33.7s**; wall clock at
6-wide **5.7s**. Serial cost 1.12s/image, corroborating the user's independently measured 1.45s.

At 6-wide that is **0.19s/image = 5.3 images/sec**, clearing both the 3/s target and the 5/s scrub
cap (§5). **Six workers is enough. Do not raise it without re-measuring.**

### Never read `Content-Length` on a 206 — it is the slice, not the file

Proven same-origin: `Content-Range: bytes 0-4095/34494` alongside `Content-Length: 4096`.

- Cross-origin from page JS, `Content-Range` is **hidden** — it is not a CORS-safelisted response
  header — and `Content-Length` reads **4096**. GM_xhr bypasses CORS and sees the real header, so
  the script is fine, but a naive `Content-Length` read yields 4096 for a 9.6 MB video and derives
  a 5s budget for it.
- **Parse the total out of `Content-Range`. Fall back to `Content-Length` only on a 200.**
- All 30+ ranged requests across ~12 hosts answered **206**. The "bare 200 with no size" case this
  section previously asked about did not occur once; the real hazard turned out to be the 206.

### `floorRate` at 100 KB/s is right for images, wrong for video

Where size and time were both measurable: **240–452 KB/s** effective for files of 313 KB–1.3 MB. A
39 KB file measured 36 KB/s effective — latency-dominated — which the `max(5s, …)` term already
covers. The formula behaves correctly at both ends.

Video needs its own floor. At 100 KB/s a 9.6 MB clip gets a 96s budget. Use **~500 KB/s for
video**, giving ~19s.

### `transferBytes()` is already broken for most images — pre-existing, unrelated to the tour

Only **4 of 24** successful loads reported a nonzero `encodedBodySize`; 83% return 0 because the
host sends no `Timing-Allow-Origin`. So the status bar's byte figure is silently absent
for most cross-origin images today. The ranged diagnostic in §7 could supply it instead.

### Failures are a normal path, not an edge case

**6 of 30 (20%)** originals failed to load on a live Google Images page — `preview.redd.it` ×3,
`trvst.world` ×2, `media.istockphoto.com` ×1. This validates §8: a tour hits broken pictures
constantly and must handle them gracefully rather than treat them as exceptional.

**The "almost certainly hotlink/referer protection" attribution was a guess, and it did not hold.**
Re-run 2026-09-07 over 24 Google originals: 3 failed, and retrying each with
`referrerPolicy = 'no-referrer'` rescued **0 of 3**. Do not build a referer-retry rung on this
evidence. What the three actually were:

- one **stall, not a failure** — a 7004×4672 image that passed 12 s untouched and then loaded in
  3.4 s on an immediate retry. This is the §7 model's whole case in one measurement: the first
  attempt was not wrong, it was too patient. Note a *cache-busted* retry of the same file took
  7.2 s, so a flat 5 s per-attempt cap would still have missed it — the size-derived budget is what
  saves it, not the retry count.
- one **dead URL** (a MediaWiki `/thumb/` path with no `NNNpx-` segment — no such file).
- one host that refused all three attempts.

### Raising a size parameter is not safe; deleting it is

`th.bing.com/th/id/OIP.<id>` answers `?w=3000&h=3000` with a real **3000×3000** decode of a file
whose honest maximum is 474×315 — an upscale, and the size gate cannot tell it from detail. Dropping
the parameters instead returned the true 474×315. The existing rule deletes rather than raises, which
is correct; **do not "improve" it into raising one.**

### Brave's base64 rule decodes correctly and then cannot load · see `RESOLVER.md` `E49`

**Both halves shipped — v0.83.0 (the bytes path) and v0.84.0 (the decode) — and were verified
together in Chrome on 2026-09-07.** Kept because the ordering is the lesson: the decode was correct
and useless on its own.

Brave sends `img-src 'self' blob: data: https://*.search.brave.com …`, so the `t4.ftcdn.net` original
this section verified is refused by the page before it is ever probed. The decode below was right and
was **blocked on the GM_xhr → `blob:` path**, not shippable alone.

### Brave image search needs a URL rule, and one is available · shipped v0.84.0

- Results are `imgs.search.brave.com/<sig>/rs:fit:500:0:1:0/<base64>` with **no ancestor anchor**
  (`closest('a')` is null), so the linked-page path finds nothing and the only candidate is a
  500px proxy thumbnail.
- **Rewriting the resize spec fails.** The leading hash signs the whole path (imgproxy signed
  URLs); `rs:fit:2000:…`, `rs:fit:0:…` and dropping the segment all errored.
- **But the source URL is base64url-encoded in the trailing path segments.** Drop segment 1 (the
  signature) and any segment containing `:` (processing options), join the rest, base64url-decode.
  Verified on 5 URLs, e.g. → `https://t4.ftcdn.net/jpg/12/98/25/17/360_F_1298251759_….jpg`.
- Some decode to `favicons.search.brave.com` icons; those fall out under `minDisplayed` on their
  own.
- Some decode to a *thumbnail* on the source host (vecteezy `/thumbnails/…/small/`), so the
  existing `UPGRADES` chaining gets a second step for free.

This belongs in `UPGRADES` with a host check, per the Known Limits rule in `../CLAUDE.md`.

### Video: 5–10× larger, and metadata is 3–13× cheaper than a full load

imgur mp4, four clips: **1.0–9.6 MB** (images on the same run were 40 KB–1.3 MB). Metadata
**169–864ms**; full load **561–3076ms**.

- `VIDEO_PROBE_MS = 6000` is well calibrated — ~7× headroom over the measured worst case.
  No change.
- **Clips need a two-stage preload.** A 12-deep window of 9.6 MB clips is ~115 MB of speculative
  traffic. Stage 1: metadata for the whole window — cheap, and it settles dimensions so the frame
  is right and nothing flashes. Stage 2: full buffer only **1–2 ahead**, which is what makes
  playback instant.
- This is the "videos are different" exception. Everything else in §6 applies unchanged.

## 15. Still unverified

- Whether programmatic scrolling works through `lockScroll()`'s `overflow:hidden` (§9).
- Whether a 100ms relocation animation looks better than a jump (§3). Built as an animation; not
  yet judged by eye.
- The right scrub rate. Shipped at 5/s and measured at 4.7-5.5 steps/sec under a 30/s key repeat,
  so the throttle does what it says; whether 5 is the right *number* is still a guess (§5).
- Whether 6 workers still clears 3/s on a slow connection, where bandwidth binds instead of
  latency (§14).

## 16. Measured while building, 2026-09-07

- **The derivation costs 3 ms** on the 41-case test page (52 `img`/`video`, 40 eligible),
  Chromium. The plan's "~5 ms on a keypress" holds. The cost that would bite is
  `playerSurfaceReason()`'s ancestor walk, which does a `querySelectorAll('img')` per level — it
  breaks at the first ancestor holding more than one image, so on a grid it stops after one or two
  levels rather than scanning the grid per item.
- **The row-band sort is doing real work**, and the log proves it: `doc: 341,1606` → `652,1606` →
  `962,1606` → `31,1835`, i.e. left-to-right along a row and then a wrap, not a `(top, left)`
  scramble. `dbg('tour step', …)` prints the document position for exactly this reason.
- **The strip's two-group layout measures as designed**: 1094 px full-width over a clip with the
  scrubber flexing to 805 px, collapsing to a 106 px nav-only box on the next still picture, and
  back again.
- **`swapViewer()` must call `resetCaption()`.** `caption()` only rebuilds when the URL or the
  measured size changes, and two tour entries routinely share both — the same file, once with a
  failure reason and once without. Without the reset the bar kept "no larger version found" over a
  picture that had resolved fine. §8 said this; it still got missed once.
- **Leaving fullscreen after a step needed `E57`.** `restoreFull()` put back the zoom and top-left
  corner captured on entry, which belong to a picture that is no longer in the frame: the window
  came back 111 px off the right edge at the wrong zoom. A tour step is the only way to reach it.
