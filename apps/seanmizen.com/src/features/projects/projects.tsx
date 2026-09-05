import type { FC } from 'react';
import { Entity, EntityList, ExternalLink } from '@/components';
import styles from './projects.module.css';

interface Project {
  /** Doubles as the link text, so it has to stand on its own. */
  name: string;
  /** One line, lowercase, no repetition of the name. */
  blurb: string;
  /** Absent for anything not currently reachable. */
  href?: string;
  /** Only set once something has stopped running. */
  retired?: string;
}

const projectList: Project[] = [
  {
    name: 'seanmizen.com',
    blurb: 'this site',
    href: 'https://seanmizen.com',
  },
  {
    name: 'Planning Poker',
    blurb: 'agile estimation for teams',
    href: 'https://pp.seanmizen.com',
  },
  {
    name: 'carolinemizen.art',
    blurb: 'art portfolio',
    href: 'https://carolinemizen.art',
  },
  {
    name: 'inside',
    blurb: 'a marketplace for interior designers',
    href: 'https://inside.seanmizen.com',
  },
  {
    name: 'shist',
    blurb: "sean's history tool",
    href: 'https://github.com/seanmizen/shist',
  },
  {
    name: 'SeansCards.com',
    blurb: 'RIP - it covered its costs',
    retired: '2024-2025',
  },
];

const Projects: FC = () => (
  <EntityList>
    {projectList.map(({ name, blurb, href, retired }) => (
      <Entity key={name}>
        {href ? <ExternalLink href={href}>{name}</ExternalLink> : name}
        <span className={styles.blurb}> - {blurb}</span>
        {retired && <span className={styles.retired}> ({retired})</span>}
      </Entity>
    ))}
  </EntityList>
);

export { Projects };
