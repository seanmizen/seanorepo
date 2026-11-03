import type { Database } from 'bun:sqlite';
import { audit } from './auth';

/**
 * The organisation: its row, its pipeline stages, the visit outcomes and
 * the slug maker. The pages are in `routes/orgs/*`.
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
 * The path of the page of the organisation with `slug`. Each link to an
 * organisation uses it.
 */
export const orgPath = (slug: string) => `/orgs/${slug}`;

/**
 * The one slug that no organisation can have: `/orgs/new` is the new-lead
 * page.
 */
export const RESERVED_SLUG = 'new';

/** The longest slug base. A suffix such as `-2` can come after it. */
export const SLUG_MAX = 60;

/**
 * A slug for `name` that no other organisation has: lowercase ASCII letters,
 * digits and hyphens. If the slug is reserved or taken, add `-2`, `-3`, and
 * so on. `except` is the id of the organisation that the slug is for, when
 * it has a row: its own slug is not taken.
 */
export const makeSlug = (db: Database, name: string, except?: string) => {
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
  const free = (slug: string) =>
    slug !== RESERVED_SLUG && !slugTaken(db, slug, except);
  if (free(base)) return base;
  for (let n = 2; ; n += 1) {
    if (free(`${base}-${n}`)) return `${base}-${n}`;
  }
};

/** True if an organisation other than `except` has `slug`. */
const slugTaken = (db: Database, slug: string, except?: string) =>
  Boolean(
    db
      .query('SELECT 1 FROM organisation WHERE slug = ? AND id IS NOT ?;')
      .get(slug, except ?? null),
  );

/**
 * The slug to save for an organisation, from the `slug` and `name` of its
 * form. An empty slug comes from the name. A typed slug must be free.
 * `except` is the id of the organisation, on its edit page.
 */
export const resolveSlug = (
  db: Database,
  values: Record<string, string>,
  except?: string,
): { slug: string } | { error: string } => {
  if (!values.slug) return { slug: makeSlug(db, values.name, except) };
  if (slugTaken(db, values.slug, except)) {
    return { error: 'Another organisation has this URL name.' };
  }
  return { slug: values.slug };
};

/** The organisation with this slug, or null. */
export const findOrg = (db: Database, slug: string) =>
  db
    .query<Org, [string]>('SELECT * FROM organisation WHERE slug = ?;')
    .get(slug);

/** A form value as trimmed text. A missing value or a repeated field is `''`. */
export const formText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

/** The pipeline of an organisation: its stage and its next action. */
export interface Pipeline {
  stage: Stage;
  next_action: string | null;
  next_action_on: string | null;
}

/**
 * Set the pipeline of `org`, with an audit row for the Activity list. The
 * audit row has the names of the changed fields, the stage before (`from`)
 * and after (`stage`), and the date of the next action. It never copies
 * the text of the next action. With no change, nothing is written.
 */
export const setPipeline = (
  db: Database,
  actor: string,
  org: Org,
  next: Pipeline,
) => {
  const fields = (
    ['stage', 'next_action', 'next_action_on'] as const
  ).filter((name) => org[name] !== next[name]);
  if (fields.length === 0) return;
  db.query(
    `UPDATE organisation SET stage = ?, next_action = ?, next_action_on = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?;`,
  ).run(next.stage, next.next_action, next.next_action_on, org.id);
  audit(db, actor, 'update', 'organisation', org.id, {
    fields,
    from: org.stage,
    stage: next.stage,
    next_action_on: next.next_action_on,
    cleared: !next.next_action && !next.next_action_on,
  });
};
