import type { Database } from 'bun:sqlite';

/**
 * The organisation: its row, its pipeline stages, the visit outcomes, the
 * slug maker and the dates. The pages are in `routes/orgs*` and
 * `routes/[slug]*`.
 */

/** One row of `organisation`. */
export interface Org {
  id: string;
  slug: string;
  name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  postcode: string | null;
  stage: Stage;
  next_action: string | null;
  next_action_on: string | null;
  lawful_basis: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

/** The pipeline stages, in order, with the text that a person reads. */
export const STAGES = {
  lead: 'Lead',
  visited: 'Visited',
  follow_up: 'Follow-up',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
} as const;

export type Stage = keyof typeof STAGES;

export const isStage = (value: string): value is Stage =>
  Object.hasOwn(STAGES, value);

/**
 * The visit outcomes, with the text on each key. `do_not_knock` also sets the
 * stage to lost.
 */
export const OUTCOMES = {
  no_answer: 'No answer',
  spoke: 'Spoke',
  call_back: 'Call back',
  not_interested: 'Not interested',
  do_not_knock: 'Do not knock',
} as const;

export type Outcome = keyof typeof OUTCOMES;

export const isOutcome = (value: string): value is Outcome =>
  Object.hasOwn(OUTCOMES, value);

/**
 * The first path segments of the other pages. A slug is never one of these
 * words, so `/<slug>` never hides a page.
 */
export const RESERVED_SLUGS = new Set([
  'login',
  'logout',
  'account',
  'orgs',
  'static',
  'api',
]);

/** The longest slug base. A suffix such as `-2` can come after it. */
const SLUG_MAX = 60;

/**
 * A slug for `name` that no organisation has: lowercase ASCII letters, digits
 * and hyphens. If the slug is reserved or taken, add `-2`, `-3`, and so on.
 */
export const makeSlug = (db: Database, name: string) => {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, SLUG_MAX)
      .replace(/^-+|-+$/g, '') || 'org';
  const taken = db.query('SELECT 1 FROM organisation WHERE slug = ?;');
  const free = (slug: string) => !RESERVED_SLUGS.has(slug) && !taken.get(slug);
  if (free(base)) return base;
  for (let n = 2; ; n += 1) {
    if (free(`${base}-${n}`)) return `${base}-${n}`;
  }
};

/** The organisation with this slug, or null. */
export const findOrg = (db: Database, slug: string) =>
  db
    .query<Org, [string]>('SELECT * FROM organisation WHERE slug = ?;')
    .get(slug);

/** The seller works in the UK, so "today" is the date in London. */
const TIME_ZONE = 'Europe/London';

/** Today in London, as `YYYY-MM-DD`. */
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());

/** An ISO time as London time that a person reads, for example `3 Nov 2026, 14:05`. */
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** A form value as trimmed text. A missing value or a repeated field is `''`. */
export const formText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
