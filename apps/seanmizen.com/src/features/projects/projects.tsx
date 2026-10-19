import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { Entity, EntityList, ExternalLink } from '@/components';
import styles from './projects.module.css';

interface Project {
  /** The name column shows this URL without the protocol. */
  href: string;
  /** Where the commits are. One path only: the GitHub API takes one, and a
      sum of two paths counts a commit that touches both twice. */
  repo: string;
  path?: string;
  /** The month of the first commit, YYYY-MM. It is a fixed fact, so it lives
      here with the href and costs no request. */
  since: string;
  /** One line, lowercase, no repetition of the name. */
  blurb?: string;
  /** A longer note, in Sean's words, in a paragraph of its own. */
  description?: string;
}

interface Section {
  title: string;
  projects: Project[];
}

const MONOREPO = 'seanmizen/seanorepo';

const sections: Section[] = [
  {
    title: "things I'd like you to see",
    projects: [
      {
        href: 'https://carolinemizen.art',
        repo: MONOREPO,
        path: 'apps/carolinemizen.art',
        since: '2024-12',
        blurb: 'art portfolio',
      },
      {
        href: 'https://planning-poker.seanmizen.com',
        repo: MONOREPO,
        path: 'apps/planning-poker',
        since: '2025-12',
        blurb: 'agile estimation for teams',
      },
      {
        href: 'https://github.com/seanmizen/shist',
        repo: 'seanmizen/shist',
        since: '2025-04',
        blurb: "sean's history tool",
      },
      {
        href: 'https://seanmizen.com',
        repo: MONOREPO,
        path: 'apps/seanmizen.com',
        since: '2024-12',
        blurb: 'this site',
      },
    ],
  },
  {
    title: 'things which are notable',
    projects: [
      {
        href: 'https://minecraft.seanmizen.com',
        repo: MONOREPO,
        path: 'utils/swindowzig',
        since: '2026-01',
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
        repo: MONOREPO,
        path: 'apps/inside',
        since: '2026-09',
        blurb: 'a marketplace for interior designers',
      },
    ],
  },
];

/* The clean URL: no protocol, no trailing slash. */
const cleanUrl = (href: string) => {
  const url = new URL(href);
  return `${url.host}${url.pathname}`.replace(/\/$/, '');
};

/* Three letters, the same in every browser. */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/* "2024-12" -> "Dec 2024". */
const formatMonth = (yyyyMm: string) => {
  const [year, month] = yyyyMm.split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
};

/*
  The commit count, from one request. With per_page=1, the page number of
  the `rel="last"` link is the number of commits. No `last` link means the
  whole history fits on the one page.
*/
const fetchCommits = async ({ repo, path }: Project): Promise<number> => {
  const query = new URLSearchParams({ per_page: '1' });
  if (path) query.set('path', path);
  const response = await fetch(
    `https://api.github.com/repos/${repo}/commits?${query}`,
  );
  if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
  const page = await response.json();
  const last = response.headers
    .get('Link')
    ?.match(/[?&]page=(\d+)>; rel="last"/);
  return last ? Number(last[1]) : page.length;
};

const useCommits = () => {
  const [commits, setCommits] = useState<Record<string, number>>({});
  useEffect(() => {
    for (const project of sections.flatMap((s) => s.projects)) {
      fetchCommits(project)
        .then((n) => setCommits((all) => ({ ...all, [project.href]: n })))
        .catch((error) =>
          console.error(`Failed to fetch commits for ${project.href}:`, error),
        );
    }
  }, []);
  return commits;
};

const Projects: FC = () => {
  const commits = useCommits();
  return (
    <>
      {sections.map(({ title, projects }) => (
        <section key={title} className={styles.section}>
          <h2 className={styles.title}>{title}</h2>
          <EntityList>
            {projects.map(({ href, since, blurb, description }) => (
              <Entity key={href} className={styles.row}>
                <span className={styles.name}>
                  <ExternalLink href={href}>{cleanUrl(href)}</ExternalLink>
                </span>
                {blurb && <span className={styles.blurb}>{blurb}</span>}
                <span className={styles.commits}>
                  {href in commits &&
                    `${commits[href]} commits since ${formatMonth(since)}`}
                </span>
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
};

export { Projects };
