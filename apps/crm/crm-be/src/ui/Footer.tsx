import type { ReactNode } from 'react';

/**
 * The footer of every page, signed in or not: plain text, not a part of the
 * device. It holds the `pager` of a long list, if there is one, then the
 * `privacy` link and the `top` link. On a wide screen the theme puts the
 * nav links at its left (REQ-CRM-LAYOUT-001).
 */
export const Footer = ({ pager }: { pager?: ReactNode }) => (
  <footer className="foot">
    <nav className="foot-links" aria-label="Page">
      {pager}
      {pager && ' '}
      <a href="/privacy">privacy</a> <a href="#top">top</a>
    </nav>
  </footer>
);
