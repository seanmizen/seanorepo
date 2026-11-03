import type { ReactNode } from 'react';

/**
 * A silkscreen label: small spaced capitals in mono, as printed on the panel
 * of an instrument. With no page styles it is plain text.
 */
export const Label = ({ children }: { children: ReactNode }) => (
  <span className="label">{children}</span>
);
