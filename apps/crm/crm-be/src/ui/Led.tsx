/**
 * An LED on metal: the chassis seam at the left of one band row. It is lit
 * red when `on`. One LED position has one meaning: the seam of a band row
 * is "due" (REQ-CRM-LCD-002). An LED is never inside the glass and never on
 * the paper of a row: `Band` is the only part that shows one. A latching
 * key draws its own LED on its top (`ui/LatchKey.tsx`).
 *
 * An LED has no text. The row tells the same state in text, so the state
 * shows with no page styles and to a screen reader (REQ-CRM-BARE-001).
 */
export const Led = ({ on }: { on: boolean }) => (
  <span className={on ? 'led on' : 'led'} aria-hidden="true" />
);
