import type { FC } from 'react';
import { Entity, EntityList, ExternalLink } from '@/components';
import styles from './projects.module.css';

interface Project {
  /** Doubles as the link text, so it has to stand on its own. */
  name: string;
  /** One line, lowercase, no repetition of the name. */
  blurb?: string;
  /** A longer note, in Sean's words, in a paragraph of its own under the name. */
  description?: string;
  /** Absent for anything not currently reachable. */
  href?: string;
}

interface Section {
  title: string;
  projects: Project[];
}

const sections: Section[] = [
  {
    title: "things I'd like you to see",
    projects: [
      {
        name: 'carolinemizen.art',
        blurb: 'art portfolio',
        href: 'https://carolinemizen.art',
      },
      {
        name: 'Planning Poker',
        blurb: 'agile estimation for teams',
        href: 'https://planning-poker.seanmizen.com',
      },
      {
        name: 'shist',
        blurb: "sean's history tool",
        href: 'https://github.com/seanmizen/shist',
      },
      {
        name: 'seanmizen.com',
        blurb: 'this site',
        href: 'https://seanmizen.com',
      },
    ],
  },
  {
    title: 'things which are notable',
    projects: [
      {
        name: 'voxel.seanmizen.com',
        description:
          'I created a zig-based game engine from scratch. My first demo is a block-building sandbox. It compiles to WASM and utilises WebGPU. dead fast.',
        href: 'https://voxel.seanmizen.com',
      },
    ],
  },
  {
    title: 'things which are certainly not done',
    projects: [
      {
        name: 'inside',
        blurb: 'a marketplace for interior designers',
        href: 'https://inside.seanmizen.com',
      },
    ],
  },
];

const Projects: FC = () => (
  <>
    {sections.map(({ title, projects }) => (
      <section key={title} className={styles.section}>
        <h3 className={styles.title}>{title}</h3>
        <EntityList>
          {projects.map(({ name, blurb, description, href }) => (
            <Entity key={name}>
              {href ? <ExternalLink href={href}>{name}</ExternalLink> : name}
              {blurb && <span className={styles.blurb}> - {blurb}</span>}
              {description && (
                <p className={styles.description}>{description}</p>
              )}
            </Entity>
          ))}
        </EntityList>
      </section>
    ))}
  </>
);

export { Projects };
