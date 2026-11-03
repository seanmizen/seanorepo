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
 * The path of the page of the organisation with `slug`, or of a page under
 * it: `orgPath('bakery', 'edit')` is `/orgs/bakery/edit`. Each link to an
 * organisation, and each redirect, uses it or a sibling below. A path has
 * no UUID (REQ-CRM-ID-001).
 */
export const orgPath = (slug: string, ...rest: (string | number)[]) =>
  ['/orgs', slug, ...rest].join('/');

/** The path of contact `number` of the organisation with `slug`. */
export const contactPath = (slug: string, number: number, ...rest: string[]) =>
  orgPath(slug, 'contacts', number, ...rest);

/** The path of activity entry `number` (a visit or a note) of `slug`. */
export const activityPath = (slug: string, number: number) =>
  orgPath(slug, 'activity', number);

/**
 * The kinds of record that an organisation numbers. A visit and a note are
 * both `activity`, so they share one counter.
 */
export type NumberKind = 'contact' | 'activity';

/**
 * The next number of a `kind` of record of the organisation `orgId`,
 * counted from 1 (REQ-CRM-ID-001). The counter in `org_counter` keeps the
 * last number given, so a number is never used again, also after a
 * delete. Run it in the transaction that adds the record.
 */
export const nextNumber = (db: Database, orgId: string, kind: NumberKind) => {
  const row = db
    .query<{ last: number }, [string, NumberKind]>(
      `INSERT INTO org_counter (organisation_id, kind, last) VALUES (?1, ?2, 1)
       ON CONFLICT (organisation_id, kind) DO UPDATE SET last = last + 1
       RETURNING last;`,
    )
    .get(orgId, kind);
  if (!row) throw new Error(`No ${kind} number for organisation ${orgId}.`);
  return row.last;
};

/**
 * The last number that `nextNumber` gave to a `kind` of record of the
 * organisation `orgId`, or null. Run it in the transaction that added the
 * record, to get its number.
 */
export const lastNumber = (db: Database, orgId: string, kind: NumberKind) =>
  db
    .query<{ last: number }, [string, NumberKind]>(
      'SELECT last FROM org_counter WHERE organisation_id = ? AND kind = ?;',
    )
    .get(orgId, kind)?.last ?? null;

/**
 * The number in a path segment, such as the `2` of `/contacts/2`, or null
 * when the segment is not a number from 1. The routes send 404 for null.
 */
export const parseNumber = (segment: string) =>
  /^[1-9]\d{0,8}$/.test(segment) ? Number(segment) : null;

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
    return { error: 'Another organisation has this URL slug.' };
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
 * Read a pipeline from a post: `stage`, `next_action` and `next_action_on`
 * (a date, `YYYY-MM-DD`). An empty next action or date is null. Returns the
 * pipeline, or the error for the first value that is not valid. The route
 * `POST /orgs/<slug>/stage` and the MCP tools `set_stage` and
 * `set_next_action` use it, so they accept the same values.
 */
export const parsePipeline = (
  body: unknown,
): { pipeline: Pipeline } | { error: string } => {
  const post = (body ?? {}) as Record<string, unknown>;
  const stage = formText(post.stage);
  const nextAction = formText(post.next_action) || null;
  const nextActionOn = formText(post.next_action_on) || null;
  if (!isStage(stage)) return { error: 'Choose a stage.' };
  if (nextActionOn && !/^\d{4}-\d{2}-\d{2}$/.test(nextActionOn)) {
    return { error: 'The Due date is not valid.' };
  }
  return {
    pipeline: { stage, next_action: nextAction, next_action_on: nextActionOn },
  };
};

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
  const fields = (['stage', 'next_action', 'next_action_on'] as const).filter(
    (name) => org[name] !== next[name],
  );
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
