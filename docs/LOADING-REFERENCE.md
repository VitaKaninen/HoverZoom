# Hover Zoom: what loads, and in what order (v0.464.0)

The user's reference card. "HQ" means a picture's full-size original. **[Load all]** means only with "Load all of a
gallery's originals" ticked, and **[Endless]** only with Endless on and Last off. Each moment's list runs top to
bottom: a line waits for the ones above it. The thumbnail lines (L12, L20, L21) go straight to the browser, so
they overlap the lines around them.

## The loads (L-IDs)

**On a results page, nothing open**
- **L1** HQ of the single pictures on screen and the next screen or two (gallery covers included)
- **L2** HQ of the single pictures on the rest of the page
- **L3** Gallery lists: each gallery's page is read for its picture list, which also gives its count
- **L4** Gallery thumbnails, 10 per gallery per round, 3 rounds
- **L5** Gallery HQ, 1 per gallery per round
- **L6** After a gallery preview: that gallery's whole first page of thumbnails
- **L7** The full list of long galleries, past what their page lists (slow)
- **L8** The next results page: its pictures near the top, then its galleries' lists and rounds

**On a hover**
- **L9** HQ of the hovered picture
- **L10** HQ of the pictures around it on screen, nearest first, then the rest of that section
- **L11** Gallery preview: the hovered gallery's first page of thumbnails

**In an open gallery**
- **L12** Thumbnails of the page on screen
- **L13** The rest of the gallery's list (slow)
- **L14** HQ of the rest of the gallery: to the end, then 2 pages behind
- **L15** Bigger thumbnail files for cells drawn large
- **L16** HQ of the clicked picture (the one in the corner)
- **L20** Thumbnails of the next page
- **L21** Thumbnails of the pages after that (up to 5 once you step)
- **L22** HQ of the 3 either side of the picture you hovered, nearest first
- **L23** HQ of the page on screen
- **L24** First frame of GIF thumbnails, and the ▶ mark on clips
- **L25** Full clips
- **UC** Upgrade clips: the page on screen's clips in full
- **L26** *(new)* HQ of the places you usually look, learned from your last 20 galleries on that site (up to 6 pictures)

**Endless**
- **L17** The next galleries: page read plus their first 2 pages of thumbnails, 2 galleries ahead (5 once you move on)
- **L17a** *(new)* The first part of L17: the very next gallery's first page. It runs earlier than the rest of L17.
- **L18** HQ of the next gallery's first page, once you are within 2 pages of this gallery's end

**Slideshow**
- **L19** HQ ahead of the slideshow, and behind it

## The moments (M-IDs) and their order

- **M1 Landed on a results page:** L1 → L3 → L4/L5 round 1 → round 2 → round 3 → L2 → L7
- **M2 Hovering a single picture:** L9 → L10 → back to M1
- **M3 Gallery preview:** L11 → L6 → M1 from this gallery on
- **M4 Scrolling the results page:** L1 up to 2 screens below → L3 for galleries on and near the screen → L4 round 1
  for the same. Galleries that leave the screen are dropped. Once you stop: M1 from the first gallery on screen.
- **M5 Reached the bottom:** whatever is left of M1 (but not L7) → L8
- **M6 Opened a gallery (click):** L12 → L16 → L20 → UC [Load all] → L26 → L21 → L23 [Load all] → L14 + L25
  [Load all] → L17 [Endless] → L18 [Endless, Load all] → L13
- **M7 Stepped a page forward:** L12 → L20 → UC [Load all] → L26 → L17a [Endless] → L21 → L23 [Load all] → L17
  [Endless] → L14 [Load all] → L18 [Endless, Load all] → L13
- **M8 Hovered a picture in the gallery:** L9 → L22 → then as M7 from L12 on
- **M9 Stepped a page back:** as M7, but L23 runs from the page's end backward
- **M10 G: pressed, stepping whole galleries:** L12 → L16 → L17 for the first next gallery → L20 → L17 for the rest →
  L13. No HQ until you hover (then M8).
- **M11 Endless moved you to the next gallery:** as M6 (or M10 with G:), except **L17a runs right after L26, before L23**
- **M12 Slideshow on a results page:** L19 ahead, nearest first → L19 behind
- **M13 Slideshow in a gallery:** HQ of the next 10 in its direction (20 if it caught up with what is loaded) → L12 →
  L20/L21 → L17 [Endless] → L23 [Load all] → L14 + L25 [Load all] → L18 [Endless, Load all] → L13
- **M14 Closed the gallery:** M1 from the first gallery on screen

## Rules for every moment

- Your own actions come first: a hover pauses all other loading until its own picture is in. A page step stops the
  page you left. Closing a gallery drops everything queued for it.
- When a new moment starts, whatever is still waiting is re-queued in the new order. Nothing is lost: it is asked for
  again when its turn comes.
- A hidden tab loads nothing.

## What changed in v0.464.0

- **L17a:** the next gallery's first page used to wait behind this gallery's HQ (L23, and L14 on an Endless arrival).
  Your prediction log showed that wait was 76% of all thumbnail waiting. It now goes before L23 in M7, M8, M9 and M11.
  A click-open (M6) keeps the old order.
- **L26:** learned places. It counts from the start or the end of the gallery, the middle, the place on the page, row
  and column, the end of a row, the last row, and the first landscape / portrait / square picture (in the gallery or
  on the page). It also counts the widest and tallest picture on the page. A place counts when at least half of your
  last 20 galleries on the site share it, and at least twice as often as chance would give. Settings → Galleries
  shows what it learned, with Forget.
