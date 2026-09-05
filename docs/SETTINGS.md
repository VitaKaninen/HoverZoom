# Settings, storage and the manager menu

The settings panel, how `cfg` is read and written, the per-tab staleness trap, the site and block list editors, the manager's menu command, and the two in-window controls that are not stored settings.

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

- **It commits on BLUR.** "Click away and it turns back into the list" was the asked-for shape,
  and blur is also the only exit, so there is no Done button to miss and no way to leave the
  panel holding text that was never parsed.
- **Save flushes it too** (`sites.flush()` / `blocks.flush()`), for the one case blur cannot
  cover: pressing Save moves focus, but the click handler may run before the blur is delivered.
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

**One deliberate difference from OLINT: entries stage in a local array and reach storage only on
Save**, like every other control on this panel. OLINT's lists write straight through, which is
right there because it has no Save button; copying that here would make Cancel a lie.

`list(key, opts)` returns `{ items, clear }` rather than the old textarea element, so *Clear all*
calls `blocks.clear()`. `addLine()` is gone. Removal is **by value, not index** — entries are
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
  called at boot, from `toggleSite()`, from the panel's Save and Reset, and from the
  `GM_addValueChangeListener` handler. `GM_unregisterMenuCommand` is feature-detected and needs
  its own `@grant`; a manager without it keeps the label it had at load rather than growing a
  second entry underneath the first.
- **`toggleSite()` removes EVERY entry that covers the host, not an exact match.** `siteEnabled()`
  matches by suffix, so on `www.example.com` a listed `example.com` is what is in force —
  removing only an exact `www.example.com` would leave the site listed and the menu would report
  that nothing had happened.
- **`reloadSettings()` first**, for the same reason `blockCurrent()` does it: this writes the
  whole `cfg` object back, and it is written from outside the panel.

**The panel's Save row is `position: sticky`.** The negative margins (`margin:18px -20px -18px`)
pull it out to the panel's own edges and down into its bottom padding, so nothing shows under it
while it is stuck. The panel is ~3300px of scroll against a ~700px viewport, which is why hunting
for Save was worth a fix.

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
