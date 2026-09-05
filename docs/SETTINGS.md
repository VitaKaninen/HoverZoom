# Settings, storage and the manager menu

The settings panel, how `cfg` is read and written, the per-tab staleness trap, the site and block list editors, the manager's menu command, and the in-window controls that are not stored settings.

## Everything saves as it is changed (v0.40.0)

There is no Save button. Every control writes `cfg` and calls `persist()` (`saveSettings()` +
`probeCache.clear()` + `refreshSiteMenu()`) on its own `change` event, and the footer is
**Reset to defaults · Undo changes · Close**.

- **Undo is a snapshot, not an inverse.** `openPanel()` deep-copies `cfg` into `opened`; the
  button writes that back and re-renders. It undoes the whole visit, not the last edit, which is
  what "revert it to the way it was before they started editing" asks for — and it costs one
  `JSON.parse(JSON.stringify())` instead of a change log.
- **Cancel could not survive auto-save**, and Save had nothing left to do; both went with it.
- **Numbers commit on `change`, not `input`.** A half-typed number is not a value anyone meant,
  and `input` fires on every keystroke. `num()` also clamps to its own min/max now — the
  attributes never bound anything on their own.
- **Lists write through on every mutation** (`store()` inside `list()`), which is what OLINT
  always did. The note below about entries reaching storage only on Save is history: it was
  right while a Cancel button existed to be made a lie.
- **The two remaining exits still flush the text editor.** Close and the backdrop call
  `sites.flush()` / `blocks.flush()`, because a click can outrun the textarea's own blur.

Three more settings went in the same pass, for the same reason as v0.39.0's seven:

| Retired | Why |
|---|---|
| `enabled` | A master off switch for a script the manager can disable, and which already has a per-site switch two rows below it. |
| `maxDisplayed` | "Ignore pictures displayed larger than N." Nobody could name the case. |
| `noReferrer` | Converted to a site list rather than deleted — see "Strip the referrer, per site" below. |
| `smoothing` (panel row) | The value stays; the *row* went. It is chosen from the AA menu on the picture itself (`E31`). |
| `cursorGap` | **It never did anything.** The window opens at `pointer.x + gap` and `nudgeIntoReach()` then pulls it back until the pointer is 10 px inside the frame — which is unconditional, because a pointer-transparent preview is pinned by a press *inside its rectangle* (`E1`). The gap was overwritten on every path, at every value. |

**The first section is ordered by what people change**, not by topic: *Show a preview* →
*Opens* → *Pin preview with*, then the two gates. `Opens` and `Pin preview with` came up out of
Advanced to sit there; `Opens` carries a hint that **changes with the value**, because the centred
answer needs one sentence the cursor answer does not (how to pin it — `E30`).

**The footer is not sticky any more.** `.panel` is a flex column, `.body` is the scroller and
`.foot` sits below it — reported as "there is open space below the buttons and text scrolling
under them", which is what `position:sticky` with negative margins looked like in practice.

### "Done editing" was eaten by its own blur

Pressing the button blurred the textarea, `commitText()` closed the editor, and the click that
followed found `editing()` false and re-opened it — so the button looked dead. `mousedown` +
`preventDefault()` on the button keeps focus in the textarea, so the click arrives while the
editor is still open. **Both lists had it**; it showed on whichever one was tried second.

*Clear all* is gone with it — the ✕ per row and the text editor both already do the job.

## The script runs in every iframe · `E29`

`@match *://*/*` with no `@noframes`, so an ad or embed frame gets its own copy — with its own
`cfg`, its own hostname, and, until v0.40.0, **its own pair of menu commands.** Tampermonkey
lists the commands of every frame together, so the "Disable for this site" that was clicked was
often an iframe's: it added *that* frame's host to the list, the page went on previewing, and a
second click on the other entry finally hit the top frame. The tell was both labels showing at
once — two frames disagreeing about whether the site was listed.

- **Menu commands are registered only when `window.top === window.self`.**
- **`pageHost()` is what the site list matches**, not `location.hostname`: the top frame's host
  where it can be read (`ancestorOrigins`, then a same-origin `window.top.location`, then
  `document.referrer`), so a disabled site is disabled inside its frames too.

Frames still preview — the fix is about *which host* the decision is made against, not about
running there.

## Smoothing, and the AA menu · `E31`

`image-rendering` on the preview's media element. **There are only two real answers**, measured
in the browser rather than assumed: Chromium accepts `auto`, `pixelated`, `crisp-edges` and
`-webkit-optimize-contrast` and rejects `smooth` and `high-quality` outright — and it renders
`crisp-edges` the same as `pixelated`. So `SMOOTHING_OPTS` is two entries, and offering
`crisp-edges` as a third would be the fake choice v0.39.0 spent a version deleting.

Anything else people associate with resampling — Lanczos, bicubic, Mitchell — is not reachable
from CSS at all. It would mean drawing the picture into a `<canvas>` at every zoom step, which
costs a re-resample per notch on a full-size image and, worse, puts a canvas where the `<img>`
was: *Save image as…* and *Copy image* then act on the resample rather than the original, which
is `E9`, a core feature.

**It is a stored setting, not a per-tab one** (unlike the ▶), chosen from the frame rather than
the panel because the only way to pick one is to look at a picture while you do it.

- **Hovering an option applies it; leaving puts the saved one back.** `smoothingPreview` is the
  live value and `cfg.smoothing` the committed one; `smoothingMode()` prefers the preview.
  `chooseSmoothing()` does `reloadSettings()` first, like `blockCurrent()` — it writes the whole
  object from outside the panel.
- **The panel has no smoothing row at all.** Two places to set one value is how they get out of
  step, and the panel cannot show you the difference.
- **It goes in `isBoxControl()`** with the ⊘ and the ▶ — *and so do both popovers*, or the
  capture listeners on `.box` eat the clicks inside them and the symptom is silence.
- **The buttons are placed right-to-left in `layoutChrome()`** from `BTN_RIGHT`/`BTN_STEP`, and
  the caption's right padding is whatever that walk ends at. The old fixed `right:` per button
  could not survive a third one that is sometimes beside the ▶ and sometimes not.

### The two popovers

`.pop` — one for the AA menu, one for the ⊘ confirmation — are children of `.box`, anchored
`bottom: BAR_MIN_H + 4` so they open **upward** from the status bar and stay inside the frame
(`.box` has `overflow:hidden`). Both are built by `buildPop()`, which swallows `mousedown` so
opening one never places, drags or dismisses the window. `showBar()`'s idle timer checks
`popOpen()`, or the bar fades out from under an open menu.

## Strip the referrer, per site

`noReferrer` was a global checkbox, and that was the wrong shape: stripping the referrer fixes
hosts that refuse a request naming another site and breaks hosts that require their own site as
the referrer, so one switch means flipping it at every navigation. It is now `referrerSites`, a
suffix-matched host list beside the block list under **Exceptions**, with a *+ This Site*
button; `noReferrerHere()` reads it against `pageHost()`.

The site to add is the one you are **on**, not the image's host — that is what the browser sends
as the referrer and what `pageHost()` returns.

## Live mode — the panel stops being modal · `E33`

**Test settings live**, at the top of *Advanced options*, keeps the panel open and hands the page
back: the backdrop is hidden, the host gets `pointer-events:none` (only `.panel` takes input), the
panel loses its centring transform and is dragged by its title bar. So you can hover a picture,
watch the preview, and change numbers against it.

- **`persist()` calls `applyLook()` and re-`layout()`s an open window**, which is what makes it
  live: border, radius, shadow, fade and the bar timings are re-written to the window that is
  already up instead of waiting for the next one.
- **The panel host covers the viewport** (`inset:0`), so without `pointer-events:none` it eats
  every hover on the page — the mode would do nothing but hide the backdrop.
- **`ours()` now counts `panelHost` too.** Otherwise a hover over the panel is a hover over an
  ordinary page element and `onOver` tries to preview it.
- **The mode and the fold survive the re-render.** Toggling calls `openPanel()` again, so
  `panelLive`, `panelPos` and `advOpen` are module-level; without `advOpen` the fold you pressed
  the button in closes under you.

### Whatever is on top owns the keyboard and the wheel

Reported: with a preview pinned, the settings panel could not be scrolled or typed in — the
preview's `window`-capture wheel and key listeners took them first (they outrank the page by
design, `E22`).

`panelOwns(e)` is the arbiter, and `onPinKey` / `onPinWheel` / the `scroll` cancel all defer to
it: while the panel is up **and modal** it owns everything; in live mode it owns only what
`composedPath()` says is inside it. Escape is handled at the document level in the same order —
panel first, then the preview — so one Escape closes the panel and leaves the pinned window
alone.

## Dark Reader repaints the loading ring

Reported: the ring is always light while Dark Reader is on, and obeys `spinnerTheme` with it off.
`applySpinTheme()` runs on every hover and reads the setting first, so nothing inside the script
explains it — DR is rewriting our rules.

**The fix comes from Sudokupad-Tools' `docs/LESSONS_LEARNED.md`, "Beating DarkReader",** which
settled this against a real DR install over many versions. Two of its findings are exactly our
case:

- **DR rewrites `var()` usage inside STYLESHEETS, not inline.** Our ring was themed by setting
  `--spin-arc` on the host and consuming it in a shadow-root rule — the losing shape.
- **A stylesheet `!important` does not help** (DR emits an equal-specificity counter-rule after
  ours), but **an inline `!important` literal is not fought at all**, and once you also strip the
  `data-darkreader-inline-*` marker DR does not come back to the element.

So `applySpinTheme()` keeps the custom properties (they cost nothing and work with no DR) and
then calls `paintOver()` on each circle: `style.setProperty(prop, literal, 'important')` plus
`removeAttribute('data-darkreader-inline-' + prop)`. `applyLook()` does the same for the frame's
background and border colour, the other two colours a user picks.

**What was tried and removed:** `class="darkreader"` on our `<style>` elements — the one lever
the DR issue tracker offers. It is DR's own marker for sheets *it* injects, and DR's teardown
removes every `style.darkreader` on the page (measured in the Sudokupad work: 43 → 0 when a
`darkreader-lock` meta went in), so it invites our stylesheet being deleted out from under us.
A page-wide `<meta name="darkreader-lock">` — what Sudokupad-Tools uses — is right there and
wrong here: this script runs on every site and does not get to turn the user's dark mode off.

Still true: in **Filter / Filter+** mode DR inverts the whole page as a post-process and nothing
in the page can help. Unverified here — this machine has no Dark Reader.

## The settings panel, rewritten around decisions (v0.39.0)

The test a settings panel has to pass, in the user's words on reading the old one: *"there are
several options that even I don't know what they do, and I am the one who told you what I
wanted. How can that be?"* Thirty controls had accumulated, each one added because a behaviour
was arguable at the moment it was written, and nothing had ever asked whether the argument was
still live.

**A setting whose second answer nobody would ever pick is not a choice — it is a thing the
script should get right.** Seven went, and each one names the question it was pretending to ask:

| Retired | Why there was never a second answer |
|---|---|
| `sameShapeOnly` | "May an upgrade be a completely different picture?" No. The gate is loose (4×) precisely so that cropped thumbnails still pass; turning it off is asking for the rotating-banner bug back. |
| `keepSearching` | "Should it stop at the first hit rather than the best one?" The whole point is the best size. |
| `followLinks` | "Should a guess be preferred over the site's own answer?" The item page's media *is* what the thumbnail stands for. The cost — one request per link hovered — is real and is now stated in **How it works** instead of behind a switch. |
| `hoverThroughOverlays` | "Should a card with a click-catcher over it do nothing?" That is the bug it was built to fix. |
| `skipWhileMouseDown` | "Should previews fire while you are dragging a selection across the page?" |
| `skipBanners`, `skipDecorative` | Not their own idea — both are "is this page furniture", which is what `skipPageBackgrounds` already asked. Three switches for one question is three chances to leave it half on. |

Two were **inverted or merged** rather than deleted, and those conversions are real arithmetic
in `migrate()`, which runs before `RETIRED` deletes the old keys:

- **`skipVideos` → `previewVideos`, off by default.** Same behaviour, stated as the thing you
  would turn ON. A double negative in a checkbox label is a reliable way to make a panel
  unreadable, and this one was "Never preview videos", which two negatives deep.
- **`skipPageBackgrounds` → `skipFurniture`.** Only that key converts; the other two are dropped,
  because it is the one that was ever plausibly turned off on purpose.

`playVideos` left storage altogether — see the ▶ section below.

**Everything else moved rather than went.** `hoverDelay`, `minDisplayed`, `minRatio`,
`wheelZoomStep`, `frameMargin`, the colours — every number and colour is now inside a collapsed
`<details>` labelled *Advanced options*. Nobody opens this panel to change them, and together
they buried the four that people do change.

### Plain language is a behaviour change, not a rewording

`hoverDelay`'s hint was *"milliseconds before resolving"*. Resolving is the right word for what
the code does and it is the wrong word for the panel: nobody outside this file knows what it
means, and what a reader wants to know is *how long before the window appears*. That is not
strictly the same thing — resolving starts at that point and the window appears when a candidate
lands — but it is the function they will associate with the number and the one they care about.
**Where accuracy and usefulness disagree in a hint, usefulness wins**; the accurate version lives
here and in the code comments.

The same pass shortened every hint that had grown into a paragraph. The reasoning behind a gate
belongs in this file; the panel gets the sentence that lets someone decide.

### Three sentences and a button

The panel opens on what the script is and how to use it, then a **How it works** button that
unfolds seven short paragraphs — finding the original, the docked ring, pinning, moving and
zooming, the browser's own context menu, the ⊘, and clips.

**That long text is where the panel's old instruction rows went.** There used to be a section of
`note()` rows — labelled rows with no control — explaining the placed window near the bottom of
the panel, i.e. after everything they were needed to understand and in the middle of a list of
switches. `note()` is deleted with them; if a row with no control is ever wanted again, it comes
back with it.

### `pick()` returns its row, so a dead control can hide

"The key" means nothing while activation is *On hover*, and a control that does nothing is the
whole complaint this rewrite answers. `pick()` now returns `{ el, row }` and the modifier-key row
is hidden unless the mode select says `modifier` — live, on `change`, not only when the panel
opens.

**`.row[hidden]{display:none}` is required.** `.row{display:flex}` outranks the UA's `[hidden]`
rule, so the row would keep its box — the identical trap as `img[hidden]` on the viewer's two
faces, which cost a version there.

### Both lists have an "Edit as text" mode

The row-with-an-✕ list and a plain textarea are good at opposite things and neither replaces the
other: removing one entry is a click in the first and a careful selection in the second, while
pasting forty sites in from somewhere else — or copying the list out — is impossible in the first
and trivial in the second. So both, with the text form as a **mode** rather than a second
permanent control, because two editable views of one list is how they get out of step.

- **It commits on BLUR** — and on the Done editing button, which needs `mousedown` +
  `preventDefault()` to survive its own blur (see above).
- **Close and the backdrop flush it too** (`sites.flush()` / `blocks.flush()`), for the one case
  blur cannot cover: the click handler may run before the blur is delivered.
- **Entries are sorted after every mutation, not at save time.** A list that reorders itself when
  you press Save is a list you cannot proof-read before pressing it. Case-insensitive, with an
  exact comparison as the tie-break so the order is stable.

## The ▶ in the status bar — clips, per tab (v0.39.0)  · `E27`

*Specified as `E27`.* `playVideos` was a stored setting and it was the wrong shape for the
question. Whether a moving preview is wanted is a judgement about the page in front of you: the
answer is usually yes, because some posts have no still form at all, and the times it is no are
one page and one session.

So it is a plain `let playVideos = true` at module scope, turned off from the preview's own
status bar and reset by a reload. Nothing writes it to storage.

- **Shown only while the frame is actually holding a clip** — `.box.hot .cap.hasvid .vidoff`.
  That is the moment the question arises; the rest of the time it is a control for a situation
  that is not happening.
- **`hasvid` is set in `layoutChrome()`, not in `caption()`.** `layout()` calls `layoutChrome()`
  first, and the bar's right-hand gutter has to be wide enough for both buttons — reading the
  class in the wrong order leaves the gutter one frame stale, which is visible as the filename
  running under the ▶ for a moment on every media swap.
- **It goes in `isBoxControl()`**, like the ⊘, or `onBoxDown`/`onBoxClick` eat its click at
  capture and the symptom is silence.
- **It closes the window through `dismiss()`**, so the source element is suppressed and the clip
  you just refused does not immediately re-open under the stationary pointer.

## The modifier key works in either order (v0.39.0)  · `E28`

*Specified as `E28`.* Reported: holding the key and then pointing at a picture worked; pointing
first and then pressing the key did nothing, and the key had to be held before the pointer
arrived every time.

**The gate was fine; there was simply no event.** `P6` is read inside `onOver`, which runs on
`mouseover` — and `mouseover` fires on a *crossing*. When the pointer is already parked on the
picture, pressing the key produces a `keydown` and nothing else, so the gate was never re-asked.

The keydown handler now calls `hoverAtPointer()` the first time the modifier goes down:
`document.elementFromPoint(pointer.x, pointer.y)`, then `onOver({ target, clientX, clientY })` —
a plain object, because `onOver` reads exactly those three fields. **Going through the same
function is the point**, not a convenience: a second copy of the eligibility path would drift
from the first, which is the same argument that made the pointer-transparent press hand its event
to `onBoxDown`.

`modifierDown` gates it to the leading edge, so key auto-repeat does not re-run the lookup on
every repeat. Releasing the key still cancels (`K7`) and pressing it again re-opens — verified in
the browser: point without the key → nothing, press → preview, release → gone, press → back.

**Testing note that cost time:** driving this with synthetic events needs the case scrolled into
view first. `elementFromPoint` returns `null` for a point outside the viewport, so a test that
hovers a case 1600 px down the page reports "the key does nothing" and looks exactly like the bug
being fixed. Related, and also worth knowing: **dispatch the placing press at `document`, not at
`window`** — `isBoxControl(e.target)` calls `Node.contains(t)`, and a `Window` is not a `Node`,
so the handler throws before it can place anything.

## The list editor matches the sibling scripts (v0.16.0)

> The **Edit as text** mode and the alphabetical order are v0.39.0 and are described in
> "The settings panel, rewritten around decisions" above. Everything below still holds.

`siteList` and `blockList` were raw textareas with a button row underneath. They are now the same
widget Open Links in New Tab uses — description, an italic examples line, `input` + blue **Add** +
green **+ This Site**, then the entries as rows with a `✕` — because these panels are read side by
side and a second dialect of the same control is a cost with no benefit. Colours come from the
shared palette (`#89b4fa` Add, `#a6e3a1` add-current, `#313244` rows, `#f38ba8` remove).

Entries staged in a local array and reached storage only on Save, because Cancel would otherwise
have been a lie. **Since v0.40.0 they write straight through**, like OLINT's, because there is no
Save and no Cancel.

`list(key, opts)` returns `{ items, flush }` rather than the old textarea element. `addLine()` is
gone. Removal is **by value, not index** — entries are
unique because `add()` dedupes, and an index would be wrong the moment display and storage order
disagree.

## The manager's menu, and the panel's Save row (v0.33.0)

**"Enable / Disable for this site"** sits beside "Hover Zoom settings" in the userscript
manager's menu. Adding or removing the current host is by far the most common single change
anyone makes, and doing it through the panel means opening it and scrolling to the site list.

- **The label is the ACTION, not the mode.** `siteMode` inverts what being on the list means —
  `whitelist` lists the sites where it runs, `blacklist` the sites where it does not — so a fixed
  label would be wrong in one of them. `siteMenuLabel()` just reads `siteEnabled()`: enabled here
  means the command would disable, and the other way round.
- **The label is kept honest by unregistering and re-registering**, from `refreshSiteMenu()`,
  called at boot, from `toggleSite()`, from every panel write (`persist()`), and from the
  `GM_addValueChangeListener` handler. `GM_unregisterMenuCommand` is feature-detected and needs
  its own `@grant`; a manager without it keeps the label it had at load rather than growing a
  second entry underneath the first.
- **`toggleSite()` removes EVERY entry that covers the host, not an exact match.** `siteEnabled()`
  matches by suffix, so on `www.example.com` a listed `example.com` is what is in force —
  removing only an exact `www.example.com` would leave the site listed and the menu would report
  that nothing had happened.
- **`reloadSettings()` first**, for the same reason `blockCurrent()` does it: this writes the
  whole `cfg` object back, and it is written from outside the panel.

**The panel's button row was `position: sticky` here; v0.40.0 made it a flex row below the
scroller instead** — see the top of this file. The panel is ~3000 px of scroll against a ~700 px
viewport, which is why the row has to be pinned somehow.

## Settings are per-tab snapshots — always re-read before rendering the panel

`cfg` is read once at load, so every tab holds its own copy. A tab open for a while is editing a
stale snapshot: the panel renders old values *and*, because Save writes the whole object, it
reverts anything another tab changed since. Symptom as reported: "I change one thing and it
saves other things I had previously disabled."

Two defences, both needed:

- `reloadSettings()` at the top of `openPanel()` — the one that always works, including where
  the manager has no change API.
- `GM_addValueChangeListener` on `KEY`, acting only when `remote` is true. This is the better
  fix because it also keeps the *running* script current, not just the panel, and re-renders an
  already-open panel. It needs the `@grant`, and it must be feature-detected — not every manager
  implements it.

Verified against the `storage`-event stub in `test-page.html`: a silent write is picked up on
open, a signalled write is picked up immediately, and saving afterwards preserves the other
tab's values instead of clobbering them.
