# REQ-CRM-LCD — The LCD acts as a real display

The LCD of the device is a glass in a faceplate, as the display of an
instrument. A real display has no LEDs behind its glass, and its characters
do not move. The LCD of the crm, the glass of the rack and the rows of the
band follow the same rules.

---

## REQ-CRM-LCD-001 — No LED in the glass, characters that do not move, and LEDs in the bezel

- **Status:** superseded
- **Source:** sean
- **Origin:** #1074
- **Type:** constraint
- **Priority:** P1
- **Statement:** The LCD (`crm-be/src/ui/Lcd.tsx`, the one component that
  owns these rules) shall have no LED inside its glass, characters that
  never move, and menu rows of one fixed height with the LED of each row
  in the bezel. A status inside the glass is a solid circle in the ink
  color of the LCD, which blinks slowly. With `prefers-reduced-motion` it
  does not blink, and with no page styles the status is text. Each menu row
  has a reserved arrow column at its left, always present. A hover or a
  focus shows the arrow in that column, and changes no other layout. Text
  that does not fit a row ends in an ellipsis, and the `title` of the row
  holds the full text. The red LED of a row is in the bezel (the faceplate
  around the glass), at the right of the row and aligned to it, so the
  LEDs are a straight column at equal steps. The legend of the column
  that sets the order of a menu shows an arrow, `▲` or `▼`, in a space
  that the legend keeps for it: the arrow column for the name legend, and
  the free space at the left of a legend at the right. With no
  page styles, text tells the order.
- **Rationale:** Sean: "no red LEDs inside a LCD - that makes no sense. a
  flashing lcd-greyblack circle makes more sense than a LED light. also,
  characters generally don't move. hovering or focusing e.g. example
  plumbers adds an arrow which pushes the chars right. the chars shouldn't
  move - the arrow should appear in a reserved space on the left ...
  perhaps we can retain the red LED by putting it inside the bezel to the
  right of each company. please try to make each company a set height so
  the LEDs look uniform and mechanically placed". The glass is the
  background of the window, so a long menu scrolls over a glass that stays
  still, and the LED of each row scrolls with its row. Sean, about the
  order: "add an arrow on the LCD screen up/down whenever we have sorted
  by that column".
- **Verification:**
  - Test — `apps/crm/crm-be/src/ui/Lcd.test.tsx` › "no LED is inside the glass, and each menu row has the arrow column and an LED in the bezel (REQ-CRM-LCD-001)"
  - Test — `apps/crm/crm-be/src/ui/Lcd.test.tsx` › "each page follows the LCD rules, and the theme fixes the row height and the arrow column (REQ-CRM-LCD-001)"
  - Test — `apps/crm/crm-be/src/routes/index.test.ts` › "the LCD legend shows the arrow of the order on the column that sets it, and text tells the order (REQ-CRM-LCD-001)"
  - Demonstration — `node apps/crm/scripts/morph-test.mjs`: a sort key moves the arrow in place. The arrow of the name legend is in the arrow column.
  - Demonstration — `node apps/crm/scripts/shoot.mjs`: compare `home-hover-*` with `home-*`. The pointer on a row shows the arrow, and no character moves.
- **Relations:** superseded-by REQ-CRM-LCD-002

## REQ-CRM-LCD-002 — LEDs on metal, one mark in the glass, and rows that do not move

- **Status:** active
- **Source:** sean
- **Origin:** #1116, #1122
- **Type:** constraint
- **Priority:** P1
- **Statement:** The crm shall put each LED on metal and keep each
  character of a glass and of a list row in its place. An LED is on the
  plate, on the top of a key, or on the chassis seam at the left of a band
  row. Each LED position has one meaning: the seam of a band row is due
  (today or overdue), and the LED on the top of a latching key is a pressed
  key, filter or mode. No LED is inside a glass: the LCD (`ui/Lcd.tsx`) or
  the glass of the display unit (`ui/DisplayUnit.tsx`). A status in a
  glass is a solid circle in the ink of the glass, which blinks slowly, and
  it is the only mark in a glass. With `prefers-reduced-motion` it does
  not blink, and with no page styles the status is text. A list of records
  is a band (`ui/Band.tsx`), not a menu in the glass. Each band row and
  each menu row has one fixed height, and a reserved arrow column at the
  left of its name. A hover or a focus shows the arrow in that column, and
  changes no other layout. Text that does not fit a row ends in an
  ellipsis, and a `title` holds the full text. The legend of the column
  that sets the order of a band shows an arrow, `▲` or `▼`, in a space
  that the legend keeps for it: the arrow column for the name legend, and
  the end of any other legend. With no page styles, text tells the order,
  and the seam cell of each row says whether the row is due.
- **Rationale:** Sean: "no red LEDs inside a LCD - that makes no sense. a
  flashing lcd-greyblack circle makes more sense than a LED light. also,
  characters generally don't move. hovering or focusing e.g. example
  plumbers adds an arrow which pushes the chars right. the chars shouldn't
  move - the arrow should appear in a reserved space on the left ...
  please try to make each company a set height so the LEDs look uniform and
  mechanically placed". Round 2 of the design competition
  (`apps/crm/docs/002-rack.md`) moved the list out of the glass and into
  the band, because the glass holds 2 columns of a record and the band
  holds 8. The LED of a row moved from the bezel to the chassis seam of
  the band, which is metal too (detail 4, decision 6). The Card Index pick
  gives each LED position one meaning, so that a lit LED never needs a
  legend. Overdue shows three times: the LED, the name of the group and
  the words, for example "3 days overdue" (detail 5).
- **Verification:**
  - Test — `apps/crm/crm-be/src/ui/Lcd.test.tsx` › "no LED is inside a glass, and each menu row has the arrow column (REQ-CRM-LCD-002)"
  - Test — `apps/crm/crm-be/src/ui/Lcd.test.tsx` › "each page follows the glass rules, and the theme fixes the row height and the arrow column (REQ-CRM-LCD-002)"
  - Test — `apps/crm/crm-be/src/routes/index.test.ts` › "the band lists every organisation in its due group, with the LED of each row on the seam, and text tells each value (REQ-CRM-LCD-002)"
  - Test — `apps/crm/crm-be/src/routes/index.test.ts` › "the band legend shows the arrow of the order on the column that sets it, and text tells the order (REQ-CRM-LCD-002)"
  - Demonstration — `node apps/crm/scripts/morph-test.mjs`: a sort key moves the arrow of the order in place. The arrow of the name legend is in the arrow column.
  - Demonstration — `node apps/crm/scripts/shoot.mjs`: compare `home-hover-*` with `home-*`. The pointer on a row shows the arrow, and no character moves.
- **Relations:** supersedes REQ-CRM-LCD-001
