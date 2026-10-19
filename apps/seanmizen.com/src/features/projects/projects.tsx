import type { CSSProperties, FC } from 'react';
import { ExternalLink } from '@/components';
import styles from './projects.module.css';
import stats from './stats.json';

interface Project {
  /** The key into stats.json. `yarn projects:stats` writes that file. */
  id: keyof typeof stats.projects;
  /** The name column shows this URL without the protocol. */
  href: string;
  /** One line, lowercase, no repetition of the name. */
  blurb?: string;
  /** A longer note, in Sean's words, in a paragraph of its own under the name.
      A project with a description is the notable one: it gets the accent. */
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
        id: 'caroline',
        href: 'https://carolinemizen.art',
        blurb: 'art portfolio',
      },
      {
        id: 'planning-poker',
        href: 'https://planning-poker.seanmizen.com',
        blurb: 'agile estimation for teams',
      },
      {
        id: 'shist',
        href: 'https://github.com/seanmizen/shist',
        blurb: "sean's history tool",
      },
      {
        id: 'seanmizen',
        href: 'https://seanmizen.com',
        blurb: 'this site',
      },
    ],
  },
  {
    title: 'things which are notable',
    projects: [
      {
        id: 'minecraft',
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
        id: 'inside',
        href: 'https://inside.seanmizen.com',
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

/* Three letters each, so every date in the column has the same width. Some
   browsers print "Sept" for en-GB, so the names are not left to the locale. */
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

/* "2026-10-13" -> "13 Oct 2026". */
const formatDate = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
};

/* "2026-10" -> "Oct 2026". */
const formatMonth = (yyyyMm: string) => {
  const [year, month] = yyyyMm.split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
};

/* One bar for each month, one character wide. The busiest month of the row
   is a full bar. A month with no commits is a hairline, so the track stays
   visible. The bars are CSS: the block characters come from a fallback font
   and do not line up. */
const Spark: FC<{ months: number[] }> = ({ months }) => {
  const max = Math.max(...months, 1);
  return months.map((n, i) => (
    <span
      // biome-ignore lint/suspicious/noArrayIndexKey: one bar per month, in month order
      key={i}
      className={styles.bar}
      style={{ '--h': n / max } as CSSProperties}
    />
  ));
};

const first = stats.months[0];
const last = stats.months[stats.months.length - 1];
const activityLabel = `commits each month, ${formatMonth(first)} to ${formatMonth(last)}`;

const all = Object.values(stats.projects);
const totalCommits = all.reduce((sum, p) => sum + p.commits, 0);
const lastTouched = all.reduce((a, p) => (p.touched > a ? p.touched : a), '');

const Projects: FC = () => (
  <div className={styles.listing}>
    <p className={styles.total}>
      total {totalCommits} commits, last {formatDate(lastTouched)}
    </p>
    <div className={styles.columns} aria-hidden="true">
      <span className={styles.commits}>commits</span>
      <span className={styles.touched}>touched</span>
      <span className={styles.activityHeading}>
        {formatMonth(first).slice(0, 3).toLowerCase()}
        <span className={styles.rule} />
        {formatMonth(last).slice(0, 3).toLowerCase()}
      </span>
      <span className={styles.name}>name</span>
      <span className={styles.what}>what</span>
    </div>
    {sections.map(({ title, projects }) => (
      <section key={title}>
        <h2 className={styles.title}># {title}</h2>
        <ul className={styles.rows}>
          {projects.map(({ id, href, blurb, description }) => {
            const { commits, touched, months } = stats.projects[id];
            return (
              <li
                key={id}
                className={[styles.row, description && styles.notable]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.name}>
                  <ExternalLink href={href}>{cleanUrl(href)}</ExternalLink>
                </span>
                {blurb && <span className={styles.what}>{blurb}</span>}
                <span className={styles.commits}>
                  {commits}
                  <span className="sr-only"> commits</span>
                </span>
                <span className={styles.touched}>
                  <span className="sr-only">last commit </span>
                  {formatDate(touched)}
                </span>
                <span
                  className={styles.activity}
                  role="img"
                  aria-label={`${activityLabel}: ${months.join(', ')}`}
                >
                  <Spark months={months} />
                </span>
                {description && (
                  <p className={styles.description}>{description}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    ))}
  </div>
);

export { Projects };
