import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { Projects as ProjectList } from '@/features';
import styles from './projects.module.css';

/*
  The title is the path. Its first part is the way home, so the page needs
  no other home link.
*/
const Projects: FC = () => (
  <main className="container">
    <h1 className={styles.path}>
      <Link to="/">~/seanmizen.com</Link>
      <span className={styles.here}>/projects</span>
    </h1>
    <ProjectList />
  </main>
);

export { Projects };
