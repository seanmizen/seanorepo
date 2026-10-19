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
  /** One line, lowercase, no repetition of the name. */
  blurb?: string;
  /** A longer note, in Sean's words. It takes the place of the blurb. */
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
        blurb: 'art portfolio',
      },
      {
        href: 'https://planning-poker.seanmizen.com',
        repo: MONOREPO,
        path: 'apps/planning-poker',
        blurb: 'agile estimation for teams',
      },
      {
        href: 'https://github.com/seanmizen/shist',
        repo: 'seanmizen/shist',
        blurb: "sean's history tool",
      },
      {
        href: 'https://seanmizen.com',
        repo: MONOREPO,
        path: 'apps/seanmizen.com',
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

interface Stats {
  commits: number;
  touched: Date;
}

/*
  One request gives both numbers. With per_page=1, the response holds the
  newest commit, and the page number of the `rel="last"` link is the commit
  count. No `last` link means the whole history fits on the one page.
*/
const fetchStats = async ({ repo, path }: Project): Promise<Stats> => {
  const query = new URLSearchParams({ per_page: '1' });
  if (path) query.set('path', path);
  const response = await fetch(
    `https://api.github.com/repos/${repo}/commits?${query}`,
  );
  if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
  const [latest] = await response.json();
  const last = response.headers
    .get('Link')
    ?.match(/[?&]page=(\d+)>; rel="last"/);
  return {
    commits: last ? Number(last[1]) : latest ? 1 : 0,
    touched: new Date(latest.commit.committer.date),
  };
};

const DAY = 24 * 60 * 60 * 1000;

const ago = (date: Date) => {
  const days = Math.floor((Date.now() - date.getTime()) / DAY);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
};

const useStats = () => {
  const [stats, setStats] = useState<Record<string, Stats>>({});
  useEffect(() => {
    for (const project of sections.flatMap((s) => s.projects)) {
      fetchStats(project)
        .then((s) => setStats((all) => ({ ...all, [project.href]: s })))
        .catch((error) =>
          console.error(`Failed to fetch commits for ${project.href}:`, error),
        );
    }
  }, []);
  return stats;
};

const Projects: FC = () => {
  const stats = useStats();
  return (
    <div className={styles.listing}>
      <div className={styles.columns} aria-hidden="true">
        <span className={styles.commits}>commits</span>
        <span className={styles.touched}>last</span>
        <span className={styles.name}>name</span>
        <span className={styles.what}>what</span>
      </div>
      {sections.map(({ title, projects }) => (
        <section key={title}>
          <h2 className={styles.title}># {title}</h2>
          <EntityList>
            {projects.map((project) => {
              const { href, blurb, description } = project;
              const s = stats[href];
              return (
                <Entity key={href} className={styles.row}>
                  <span className={styles.name}>
                    <ExternalLink href={href}>{cleanUrl(href)}</ExternalLink>
                  </span>
                  <span className={styles.what}>{description ?? blurb}</span>
                  <span className={styles.commits}>
                    {s?.commits}
                    {s && <span className={styles.unit}> commits</span>}
                  </span>
                  <span className={styles.touched}>
                    {s && <span className="sr-only">last commit </span>}
                    {s && ago(s.touched)}
                  </span>
                </Entity>
              );
            })}
          </EntityList>
        </section>
      ))}
    </div>
  );
};

export { Projects };
