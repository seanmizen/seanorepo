import type { FC } from 'react';
import { Link } from 'react-router-dom';
import styles from './site-title.module.css';

interface SiteTitleProps {
  /** The page's path under home, e.g. "projects/shaders". Absent on home. */
  path?: string;
}

/**
 * The title of every page is its path. Each part above the page is a link
 * to that page, so the page needs no other way back. The page itself is
 * dimmed.
 */
const SiteTitle: FC<SiteTitleProps> = ({ path }) => {
  if (!path) return <h1 className={styles.title}>seanmizen.com</h1>;
  const parts = path.split('/');
  const page = parts.pop();
  return (
    <h1 className={styles.title}>
      <Link to="/">seanmizen.com</Link>
      <span className={styles.path}>
        {parts.map((part, i) => (
          <span key={part}>
            /<Link to={`/${parts.slice(0, i + 1).join('/')}`}>{part}</Link>
          </span>
        ))}
        <span className={styles.page}>/{page}</span>
      </span>
    </h1>
  );
};

export { SiteTitle };
