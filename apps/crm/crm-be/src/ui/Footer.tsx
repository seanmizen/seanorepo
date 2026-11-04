/**
 * The footer of every page, signed in or not: plain text, not a part of the
 * device. It holds the `privacy` link and the `top` link. The pager of a
 * long list is on the plate of the display unit (`ui/DisplayUnit.tsx`). On
 * a wide screen the theme puts the nav links at the left of the footer.
 */
export const Footer = () => (
  <footer className="foot">
    <nav className="foot-links" aria-label="Page">
      <a href="/privacy">privacy</a> <a href="#top">top</a>
    </nav>
  </footer>
);
