# REQ-CRM-LCD — The LCD acts as a real display

The LCD of the device is a glass in a faceplate, as the display of an
instrument. A real display has no LEDs behind its glass, and its characters
do not move. The LCD of the crm follows the same rules.

---

## REQ-CRM-LCD-001 — No LED in the glass, characters that do not move, and LEDs in the bezel

- **Status:** active
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
  LEDs are a straight column at equal steps.
- **Rationale:** Sean: "no red LEDs inside a LCD - that makes no sense. a
  flashing lcd-greyblack circle makes more sense than a LED light. also,
  characters generally don't move. hovering or focusing e.g. example
  plumbers adds an arrow which pushes the chars right. the chars shouldn't
  move - the arrow should appear in a reserved space on the left ...
  perhaps we can retain the red LED by putting it inside the bezel to the
  right of each company. please try to make each company a set height so
  the LEDs look uniform and mechanically placed". The glass is the
  background of the window, so a long menu scrolls over a glass that stays
  still, and the LED of each row scrolls with its row.
- **Verification:**
  - Test — `apps/crm/crm-be/src/ui/Lcd.test.tsx` › "no LED is inside the glass, and each menu row has the arrow column and an LED in the bezel (REQ-CRM-LCD-001)"
  - Test — `apps/crm/crm-be/src/ui/Lcd.test.tsx` › "each page follows the LCD rules, and the theme fixes the row height and the arrow column (REQ-CRM-LCD-001)"
  - Demonstration — `node apps/crm/scripts/shoot.mjs`: compare `home-hover-*` with `home-*`. The pointer on a row shows the arrow, and no character moves.
- **Relations:** none
