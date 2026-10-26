# REQ-PIXEL — Pixel-1 and Pixel-2 cover the fewest pixels

Pixel-1 is the autosam theme that covers the smallest area of the screen
that still shows everything. Pixel-2 is Pixel-1, smaller. REQ-PIXEL-001 to
004 apply to both themes. REQ-PIXEL-005 and 006 apply to Pixel-2. REQ-BARE-001 applies here too: a theme changes
the look, never the function. Pixel-1 uses the colors of Tone, because a
change of fill separates two things for no space at all.

`public/pixel.css` holds both themes. `test/pixel.test.ts` reads it.

---

## REQ-PIXEL-001 — Each box is as small as its content

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** While Pixel-1 or Pixel-2 is on, the page shall start at the top left
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
- **Statement:** Pixel-1 and Pixel-2 shall set all text that shows at one
  size, 9 px.
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
- **Statement:** Pixel-1 and Pixel-2 shall draw no border, box shadow,
  rounded corner or gradient.
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
  in Pixel-1 and Pixel-2 shall be at least 24 CSS px high.
- **Rationale:** WCAG 2.2 success criterion 2.5.8 (target size, minimum).
  A finger needs the space that a mouse does not.
- **Verification:** Test — `apps/autosam/test/pixel.test.ts` › "pixel.css keeps touch targets 24px high (REQ-PIXEL-004)"
- **Relations:** none

## REQ-PIXEL-005 — Pixel-2 shows no text twice

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** Pixel-2 shall show each state and each control of the page,
  and no text that repeats another element or explains how to use the page,
  except the shortcuts and the song notes.
- **Rationale:** The measured empty space of Pixel-1 showed that most text
  outside the chart repeats something: the slug repeats the title, the key
  sentence repeats the key value, the hand names repeat the swatches. The
  help prose shows in every other theme. The shortcuts stay, because no
  control on the page shows them.
- **Verification:** Inspection — `apps/autosam/public/pixel.css`, the
  `display: none` list in the Pixel-2 block.
- **Relations:** none

## REQ-PIXEL-006 — Pixel-2 tiles its controls

- **Status:** active
- **Source:** sean
- **Origin:** #971
- **Type:** constraint
- **Priority:** P2
- **Statement:** In the Pixel-2 song view, the title and the controls shall
  fill rows as wide as the chart, with no empty place between blocks.
- **Rationale:** In Pixel-1 each control took a line of its own, and the
  ends of the short lines were empty. Blocks that wrap in rows, and grow to
  fill each row, tile one rectangle.
- **Verification:** Demonstration — open `/american-pie?theme=pixel-2`. The
  blocks above the chart fill each row to the width of the chart.
- **Relations:** none
