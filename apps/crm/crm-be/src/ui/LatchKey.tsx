import type { ButtonHTMLAttributes } from 'react';
import { BareText } from './BareText';

/**
 * A key that latches: a submit `<button>` with an LED on top, lit when
 * `on`. `aria-pressed` holds the state for a screen reader. With no page
 * styles, the text "(current)" after the label shows the state. The page
 * styles hide that text, and the LED shows the state (REQ-CRM-BARE-001).
 *
 * A sort key also has a `direction` and its `state` text, for example
 * "A to Z". Its LED is green for `asc` and red for `desc`. When the key is
 * on, ", A to Z" comes after the label in place of "(current)". A screen
 * reader reads that text too, because `aria-pressed` does not tell the
 * direction.
 */
export const LatchKey = ({
  on,
  direction,
  state,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  on: boolean;
  direction?: 'asc' | 'desc';
  state?: string;
}) => (
  <button
    type="submit"
    className="key latch"
    aria-pressed={on}
    data-direction={on ? direction : undefined}
    {...props}
  >
    {children}
    {on && state && <BareText>, {state}</BareText>}
    {on && !state && (
      <span className="latch-state" aria-hidden="true">
        {' (current)'}
      </span>
    )}
  </button>
);
