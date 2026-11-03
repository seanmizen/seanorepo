import type { ButtonHTMLAttributes } from 'react';

/**
 * A key that latches: a submit `<button>` with an LED on top, lit when
 * `on`. `aria-pressed` holds the state for a screen reader. With no page
 * styles, the text "(current)" after the label shows the state. The page
 * styles hide that text, and the LED shows the state (REQ-CRM-BARE-001).
 */
export const LatchKey = ({
  on,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) => (
  <button type="submit" className="key latch" aria-pressed={on} {...props}>
    {children}
    {on && (
      <span className="latch-state" aria-hidden="true">
        {' (current)'}
      </span>
    )}
  </button>
);
