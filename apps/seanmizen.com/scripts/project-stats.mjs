#!/usr/bin/env node
/*
  Writes the git facts that the /projects listing shows.

    yarn projects:stats

  Where: run from the app folder (the yarn script does). It reads the
  history of the whole repository, so the checkout must have the full
  history (no shallow clone).
  When: before a release, or when the numbers on /projects look old. The
  Docker build has no .git folder, so the build cannot do this itself. The
  output is committed.
  Why: each column of the listing is a fact. A visitor can count on the
  numbers, so they come from git and nobody types them.

  Output: src/features/projects/stats.json. One entry for each project id:
  the commit count, the date of the last commit, and the commits in each of
  the last 12 months (the oldest month first, the current month last).
*/
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const OUT = 'src/features/projects/stats.json';
const MONTHS = 12;

/* The id is the `id` of the project in projects.tsx. A project has paths in
   this repository, or a GitHub repository of its own. */
const SOURCES = {
  caroline: { paths: ['apps/carolinemizen.art'] },
  'planning-poker': { paths: ['apps/planning-poker'] },
  shist: { github: 'seanmizen/shist' },
  seanmizen: { paths: ['apps/seanmizen.com'] },
  minecraft: { paths: ['apps/minecraft.seanmizen.com', 'utils/swindowzig'] },
  inside: { paths: ['apps/inside'] },
};

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

/* The commit dates (YYYY-MM-DD) that touch any of the paths. */
const gitDates = (paths) =>
  execFileSync('git', ['-C', root, 'log', '--format=%as', '--', ...paths], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

/* The commit dates on the default branch of a GitHub repository. */
const githubDates = async (repo) => {
  const dates = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits?per_page=100&page=${page}`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) {
      throw new Error(`GitHub API: ${res.status} for ${repo}`);
    }
    const commits = await res.json();
    dates.push(...commits.map((c) => c.commit.author.date.slice(0, 10)));
    if (commits.length < 100) return dates;
  }
};

/* The last MONTHS months as YYYY-MM, the oldest first. */
const now = new Date();
const months = Array.from({ length: MONTHS }, (_, i) => {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1 - i), 1),
  );
  return d.toISOString().slice(0, 7);
});

const projects = {};
for (const [id, source] of Object.entries(SOURCES)) {
  const dates = source.github
    ? await githubDates(source.github)
    : gitDates(source.paths);
  projects[id] = {
    commits: dates.length,
    touched: dates.reduce((a, b) => (a > b ? a : b), ''),
    months: months.map(
      (month) => dates.filter((d) => d.startsWith(month)).length,
    ),
  };
}

const stats = { months, projects };
writeFileSync(OUT, `${JSON.stringify(stats, null, 2)}\n`);
console.log(`Wrote ${OUT}`);
