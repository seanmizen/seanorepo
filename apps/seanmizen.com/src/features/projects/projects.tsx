import type { FC } from 'react';
import styles from './projects.module.css';

interface Project {
  linklabel: string;
  description: string;
  href?: string;
  arialabel: string;
}

const projectList: Project[] = [
  {
    linklabel: 'SeansCards.com',
    description: 'Handwritten cards for sale - by me, for you',
    href: 'https://seanscards.com',
    arialabel: 'URL for SeansCards.com',
  },
  {
    linklabel: 'seanmizen.com',
    description: 'This site',
    arialabel: 'URL for this website',
  },
  {
    linklabel: 'Planning Poker',
    description: 'Planning Poker - Agile estimation tool for teams',
    href: 'https://pp.seanmizen.com',
    arialabel: 'URL for Planning Poker',
  },
  {
    linklabel: 'carolinemizen.art',
    description: 'Art portfolio (under construction)',
    href: 'https://carolinemizen.art',
    arialabel: 'URL for carolinemizen.art',
  },
  {
    linklabel: 'shist',
    description: "Sean's History Tool",
    href: 'https://github.com/seanmizen/shist',
    arialabel: 'Github URL for shist',
  },
];

const Projects: FC = () => {
  return (
    <ul className={`${styles['ul-link']} ${styles['ul-padded-left']}`}>
      {projectList.map((project) => (
        <li key={project.linklabel}>
          <a
            aria-label={project.arialabel}
            href={project.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {project.linklabel}
          </a>
          - {project.description}
        </li>
      ))}
    </ul>
  );
};

export { Projects };
