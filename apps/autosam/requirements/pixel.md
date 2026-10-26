# REQ-PIXEL — Pixel-1 covers the fewest pixels

Pixel-1 is the autosam theme that covers the smallest area of the screen
that still shows everything. REQ-BARE-001 applies here too: a theme changes
the look, never the function. Pixel-1 uses the colors of Tone, because a
change of fill separates two things for no space at all.

`public/pixel.css` holds Pixel-1. `test/pixel.test.ts` reads it.

---

## REQ-PIXEL-001 — Each box is as small as its content

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** While Pixel-1 is on, the page shall start at the top left
  with each box no wider than its content or the chart, and with no space
  larger than 1 px between two boxes.
- **Rationale:** Sean asked for a theme that uses as few pixels as possible.
  A box that stretches, a centred column and a margin each cover pixels that
  show nothing. The spaces between words come from the HTML.
- **Verification:** Test — `apps/autosam/test/pixel.test.ts` › "pixel.css has no space larger than 1px (REQ-PIXEL-001)"
- **Relations:** none

## REQ-PIXEL-002 — One text size

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** Pixel-1 shall set all text at one size, 9 px.
- **Rationale:** Large text for one thing covers pixels for every other
  thing. 9 px is the smallest size at which the system font stays easy to
  read on a normal screen. Weight and fill show what matters most.
- **Verification:** Test — `apps/autosam/test/pixel.test.ts` › "pixel.css sets all text at one size (REQ-PIXEL-002)"
- **Relations:** none

## REQ-PIXEL-003 — No decoration

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** Pixel-1 shall draw no border, box shadow, rounded corner or
  gradient.
- **Rationale:** Each of these spends pixels on a look.
- **Verification:** Test — `apps/autosam/test/pixel.test.ts` › "pixel.css draws no border, shadow, radius or gradient (REQ-PIXEL-003)"
- **Relations:** none

## REQ-PIXEL-004 — Touch targets stay large enough

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** When the primary pointer is coarse, each button and label
  in Pixel-1 shall be at least 24 CSS px high.
- **Rationale:** WCAG 2.2 success criterion 2.5.8 (target size, minimum).
  A finger needs the space that a mouse does not.
- **Verification:** Test — `apps/autosam/test/pixel.test.ts` › "pixel.css keeps touch targets 24px high (REQ-PIXEL-004)"
- **Relations:** none
