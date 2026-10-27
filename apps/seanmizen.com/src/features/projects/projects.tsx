import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { Entity, EntityList, ExternalLink, Subtitle } from '@/components';
import styles from './projects.module.css';
import { ResetAll, Stamp, StampBoard } from './stamp';
import stampStyles from './stamp.module.css';
import { THUMBS } from './thumbs';

interface Project {
  /** The name column shows this URL without the protocol. A path that
      starts with "/" is a page of this site. */
  href: string;
  /** One line in Sean's words, lowercase except for names, no repetition
      of the name. */
  blurb: string;
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
        blurb:
          'I automated a piano player so I could practice vocals. sorry Sam!',
      },
      {
        href: 'https://action.seanmizen.com',
        blurb: 'online browser-based FPS for the boys using Swindowzig',
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
        href: 'https://github.com/seanmizen/swindowzig',
        blurb: 'my game engine, built from scratch: Zig, WASM, WebGPU',
      },
      {
        href: 'https://minecraft.seanmizen.com',
        blurb: 'a Minecraft clone on swindowzig, live until Microsoft sue me',
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
  <StampBoard>
    {sections.map(({ title, projects }, k) => (
      <section key={title} className={styles.section}>
        <Subtitle>{title}</Subtitle>
        {k === 0 && <ResetAll className={styles.resetAll} />}
        <EntityList>
          {projects.map(({ href, blurb }) => {
            const Thumb = THUMBS[href];
            return (
              <Entity
                key={href}
                className={`${styles.row} ${stampStyles.stampRow}`}
              >
                <span className={styles.name}>
                  {href.startsWith('/') ? (
                    <Link to={href}>{cleanUrl(href)}</Link>
                  ) : (
                    <ExternalLink href={href}>{cleanUrl(href)}</ExternalLink>
                  )}
                </span>
                <span className={styles.blurb}>{blurb}</span>
                {/* A preview stamp. It takes the tight shader mask, as the
                  theme toggle does: the glyphs clear only just around it. */}
                <span className={stampStyles.stamp} data-mask="tight">
                  {Thumb && <Stamp name={cleanUrl(href)} Thumb={Thumb} />}
                </span>
              </Entity>
            );
          })}
        </EntityList>
      </section>
    ))}
  </StampBoard>
);

export { Projects };
