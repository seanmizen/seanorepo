import type { FC } from 'react';
import styles from './projects.module.css';

interface Project {
  linklabel: string;
  description: string;
  href?: string;
  arialabel?: string;
}

const projectList: Project[] = [
  {
    linklabel: 'seanmizen.com',
    description: 'This site',
    href: 'https://seanmizen.com',
    arialabel: 'URL for this website',
  },
  {
    linklabel: 'Planning Poker',
    description: 'Planning Poker - Agile estimation tool for teams',
    href: 'https://pp.seanmizen.com',
    arialabel: 'URL for Planning Poker',
  },
];

const Projects: FC = () => {
  return (
    <ul className={`${styles['ul-link']} ${styles['ul-padded-left']}`}>
      {projectList.map((project) => (
        <li key={project.linklabel}>
          {project.href ? (
            <a
              aria-label={project.arialabel}
              href={project.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {project.linklabel}
            </a>
          ) : (
            <span>{project.linklabel}</span>
          )}
          {' - '}
          {project.description}
        </li>
      ))}
    </ul>
  );
};

export { Projects };
