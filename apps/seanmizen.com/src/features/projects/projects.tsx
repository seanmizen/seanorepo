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
