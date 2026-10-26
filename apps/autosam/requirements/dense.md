# REQ-DENSE — The dense themes spend few pixels

autosam has three dense themes: Hairline, Tone and Term. Each one is a
different answer to the same constraints. The page sits at the top left,
fits the screen, and gives each pixel to the music. REQ-BARE-001 applies to
these themes too: a theme changes the look, never the function.

Borders and outlines: a border takes layout space on each side of a box, and
two neighbours draw two lines. An outline takes no layout space, but it draws
over the neighbours. So the dense themes use no border. Where a theme draws a
line between two boxes, the boxes sit 1 px apart and each has a 1 px outline.
The two outlines fall on the same pixels, so the boxes share one line. An
outline also shows a state that must not move the layout: focus, the cursor
bar and a queued jump.

`public/dense.css` holds the dense themes. `test/dense.test.ts` reads it.

---

## REQ-DENSE-001 — The page starts at the top left

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** While a dense theme is on, the page shall start at the
  top-left corner of the viewport, with no centred layout and no width limit.
- **Rationale:** A centred column with a width limit leaves empty bands at
  each side. A long chart needs those bands.
- **Verification:** Test — `apps/autosam/test/dense.test.ts` › "dense.css centres nothing and limits no width (REQ-DENSE-001)"
- **Relations:** none

## REQ-DENSE-002 — The page fits the screen

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** functional
- **Priority:** P2
- **Statement:** While a dense theme is on, the page shall use the largest
  base text size from 10 px to 16 px at which the page does not scroll, or
  16 px when no size in that range fits.
- **Rationale:** A short song gets large text. A long song gets small text,
  and all of it shows. On a phone even the smallest size does not fit, and
  10 px text on a phone helps nobody, so the page scrolls at the normal
  size.
- **Verification:** Demonstration — open `/american-pie` at 1280 × 720 in
  each dense theme. The whole chart, the now panel, the settings and the
  keyboard show with no scrollbar.
- **Relations:** none

## REQ-DENSE-003 — No decoration

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** A dense theme shall draw no border, box shadow, rounded
  corner or gradient.
- **Rationale:** Each of these spends pixels on a look. A line that
  separates two things is a 1 px outline in a 1 px gap.
- **Verification:** Test — `apps/autosam/test/dense.test.ts` › "dense.css draws no border, shadow, radius or gradient (REQ-DENSE-003)"
- **Relations:** none

## REQ-DENSE-004 — Small spaces

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** A dense theme shall use no padding, margin or gap larger
  than 0.5 em, except the place that it keeps for the theme pane.
- **Rationale:** Space between things is the largest cost of a normal
  layout. A small space still groups things. A line or a change of fill
  separates them.
- **Verification:** Test — `apps/autosam/test/dense.test.ts` › "dense.css has no space larger than 0.5em (REQ-DENSE-004)"
- **Relations:** none

## REQ-DENSE-005 — Controls and sections show at rest

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** In a dense theme, with no hover and no focus, each control
  and each section shall look different from plain text and from its
  neighbours.
- **Rationale:** A dense page with no borders can become one block of text.
  A person must see what they can press, and where one part ends, before
  they move the pointer.
- **Verification:** Demonstration — look at the song page in each dense
  theme, in light and dark, with the pointer off the page.
- **Relations:** none

## REQ-DENSE-006 — Touch targets stay large enough

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** When the primary pointer is coarse, each button and label
  in a dense theme shall be at least 24 CSS px high.
- **Rationale:** WCAG 2.2 success criterion 2.5.8 (target size, minimum).
  A finger needs the space that a mouse does not.
- **Verification:** Test — `apps/autosam/test/dense.test.ts` › "dense.css keeps touch targets 24px high (REQ-DENSE-006)"
- **Relations:** none
