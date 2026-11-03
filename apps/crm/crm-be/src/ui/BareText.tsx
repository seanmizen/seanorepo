import type { ReactNode } from 'react';

/**
 * Text for a page with no page styles, and for a screen reader. The page
 * styles hide it from view, because a legend or an LED shows the same thing
 * there. So the state shows as text with no page styles (REQ-CRM-BARE-001).
 * `id` is the target of an `aria-describedby`.
 */
export const BareText = ({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) => (
  <span className="bare-text" id={id}>
    {children}
  </span>
);
