import type { FC } from 'react';
import { SiteTitle } from '@/components';
import { Projects as ProjectList } from '@/features';

const Projects: FC = () => (
  <main className="container">
    <SiteTitle page="projects" />
    <ProjectList />
  </main>
);

export { Projects };
