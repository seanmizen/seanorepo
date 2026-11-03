import type { ReactNode } from 'react';

/**
 * An LED: a light before its text, lit red when `on`. The text tells the
 * state and the class only gives it its look, so the state shows with no
 * page styles (REQ-CRM-BARE-001).
 */
export const Led = ({ on, children }: { on: boolean; children: ReactNode }) => (
  <span className={on ? 'led on' : 'led'}>{children}</span>
);
