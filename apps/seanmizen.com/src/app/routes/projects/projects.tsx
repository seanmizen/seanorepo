import type { FC } from 'react';
import { SiteTitle } from '@/components';
import { Projects as ProjectList } from '@/features';
import styles from './projects.module.css';

const Projects: FC = () => (
  <main className="container">
    <div className={styles.half}>
      <SiteTitle path="projects" />
      <ProjectList />
    </div>
  </main>
);

export { Projects };
