/**
 * An LED in the bezel of the LCD, at the right of one menu row. It is lit
 * red when `on` (REQ-CRM-LCD-001). An LED is never inside the glass: `Lcd`
 * is the only part that shows one.
 *
 * An LED has no text. The row tells the same state in text, so the state
 * shows with no page styles and to a screen reader (REQ-CRM-BARE-001).
 */
export const Led = ({ on }: { on: boolean }) => (
  <span className={on ? 'led on' : 'led'} aria-hidden="true" />
);
