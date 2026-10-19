import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { Projects as ProjectList } from '@/features';
import styles from './projects.module.css';

/*
  The page is a shell session: a path, a command, its output, a prompt.
  The path is the way home, so the page needs no other home link.
*/
const Projects: FC = () => (
  <main className={`container ${styles.page}`}>
    <nav aria-label="Site">
      <Link to="/" className={styles.home}>
        ~/seanmizen.com
      </Link>
    </nav>
    <h1 className={styles.command}>
      <span className={styles.prompt} aria-hidden="true">
        ${' '}
      </span>
      ls -l projects/
    </h1>
    <ProjectList />
    <p className={styles.cursorLine} aria-hidden="true">
      <span className={styles.prompt}>$ </span>
      <span className={styles.cursor} />
    </p>
  </main>
);

export { Projects };
