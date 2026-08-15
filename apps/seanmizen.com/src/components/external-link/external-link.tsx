import type { FC, ReactNode } from 'react';
import styles from './external-link.module.css';

interface ExternalLinkProps {
  href: string;
  children: ReactNode;
}

/**
 * A link that leaves the site, opening in a new tab and saying so.
 *
 * Centralised for two reasons. `rel="noopener noreferrer"` is easy to forget
 * on a hand-rolled `target="_blank"` and was already missing in places. And
 * the "opens in a new tab" warning belongs to every such link or none — a tab
 * that opens unannounced is a change of context the reader did not ask for
 * (WCAG 3.2.5), and the arrow alone only tells people who can see it.
 *
 * Note there is no `aria-label` here, by design. An aria-label replaces the
 * accessible name outright, so the old `aria-label="URL for this website"` on
 * a link reading "seanmizen.com" left the two with nothing in common — a
 * WCAG 2.5.3 Label in Name failure, and worse for a screen reader than the
 * link text it was overriding. The visible text already names the target.
 */
const ExternalLink: FC<ExternalLinkProps> = ({ href, children }) => (
  <a
    className={styles.link}
    href={href}
    target="_blank"
    rel="noopener noreferrer"
  >
    {children}
    <span className={styles.marker} aria-hidden="true">
      ↗
    </span>
    <span className="sr-only"> (opens in a new tab)</span>
  </a>
);

export { ExternalLink };
