import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { Entity, EntityList, ExternalLink, Subtitle } from '@/components';
import styles from './projects.module.css';

interface Project {
  /** The name column shows this URL without the protocol. A path that
      starts with "/" is a page of this site. */
  href: string;
  /** One line, lowercase, no repetition of the name. */
  blurb?: string;
  /** A longer note, in Sean's words, in a paragraph of its own. */
  description?: string;
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
        href: 'https://carolinemizen.art',
        blurb: 'art portfolio for Mum',
      },
      {
        href: 'https://autosam.seanmizen.com',
        description: 'I automated a piano player so I could practice vocals.',
      },
      {
        href: 'https://action.seanmizen.com',
        description: 'I created an FPS with my own engine. zig, WASM, WebGPU.',
      },
      {
        href: 'https://planning-poker.seanmizen.com',
        blurb: 'agile estimation tool for teams',
      },
      {
        href: 'https://github.com/seanmizen/shist',
        blurb: 'my own CLI history tool, written in Go',
      },
      {
        href: 'https://seanmizen.com',
        blurb: 'this site',
      },
    ],
  },
  {
    title: 'things which are notable',
    projects: [
      {
        href: '/projects/shaders',
        blurb: 'ripple playground',
      },
      {
        href: 'https://minecraft.seanmizen.com',
        description:
          "I created a zig-based game engine from scratch. My first demo is a minecraft clone - it's up until Microsoft find out and sue me! It compiles to WASM and utilises WebGPU. dead fast.",
      },
    ],
  },
  {
    title: 'things which are certainly not done',
    projects: [
      {
        href: 'https://inside.seanmizen.com',
        blurb: 'a marketplace for interior designers',
      },
    ],
  },
];

/* The clean URL: no protocol, no trailing slash. */
const cleanUrl = (href: string) => {
  const url = new URL(href, 'https://seanmizen.com');
  return `${url.host}${url.pathname}`.replace(/\/$/, '');
};

const Projects: FC = () => (
  <>
    {sections.map(({ title, projects }) => (
      <section key={title} className={styles.section}>
        <Subtitle>{title}</Subtitle>
        <EntityList>
          {projects.map(({ href, blurb, description }) => (
            <Entity key={href} className={styles.row}>
              <span className={styles.name}>
                {href.startsWith('/') ? (
                  <Link to={href}>{cleanUrl(href)}</Link>
                ) : (
                  <ExternalLink href={href}>{cleanUrl(href)}</ExternalLink>
                )}
              </span>
              {blurb && <span className={styles.blurb}>{blurb}</span>}
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
