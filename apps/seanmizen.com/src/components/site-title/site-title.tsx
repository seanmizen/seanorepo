import type { FC } from 'react';
import { Link } from 'react-router-dom';
import styles from './site-title.module.css';

interface SiteTitleProps {
  /** The page under home, e.g. "projects". Absent on the home page. */
  page?: string;
}

/**
 * The title of every page is its path. On a page under home, the
 * `seanmizen.com` part is the link home, so the page needs no other one.
 */
const SiteTitle: FC<SiteTitleProps> = ({ page }) =>
  page ? (
    <h1 className={styles.title}>
      <Link to="/">seanmizen.com</Link>
      <span className={styles.page}>/{page}</span>
    </h1>
  ) : (
    <h1 className={styles.title}>seanmizen.com</h1>
  );

export { SiteTitle };
