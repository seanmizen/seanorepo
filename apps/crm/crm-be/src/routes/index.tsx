import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { dueWords, today } from '../dates';
import {
  formText,
  isStage,
  type Org,
  orgPath,
  STAGES,
  type Stage,
} from '../org';
import { type PageParts, renderPage } from '../render';
import { BareText } from '../ui/BareText';
import { Device } from '../ui/Device';
import { Key, Keys } from '../ui/Key';
import { LatchKey } from '../ui/LatchKey';
import { Lcd } from '../ui/Lcd';
import { Module } from '../ui/Module';
import { When } from '../ui/When';

/**
 * The sort keys of the list, in order: the text on each key, and the text
 * of each direction. The list legend uses the same words.
 */
export const SORTS = {
  activity: {
    text: 'Last activity',
    asc: 'Oldest first',
    desc: 'Newest first',
  },
  added: { text: 'Date added', asc: 'Oldest first', desc: 'Newest first' },
  name: { text: 'Name', asc: 'A to Z', desc: 'Z to A' },
} as const;

export type Sort = keyof typeof SORTS;

export type Direction = 'asc' | 'desc';

const isSort = (value: string): value is Sort => Object.hasOwn(SORTS, value);

/** The number of rows on one page of the list. */
export const PAGE_SIZE = 50;

/** The two paths of the list. One handler serves both. */
export const LIST_PATHS = ['/', '/orgs'] as const;

export type ListPath = (typeof LIST_PATHS)[number];

/**
 * The state of the list. The URL holds all of it:
 * `?q=<text>&stage=<stage>&sort=<sort>&dir=<asc|desc>&page=<n>`. An empty
 * `sort` is the default order.
 */
export interface ListQuery {
  q: string;
  stage: Stage | '';
  sort: Sort | '';
  dir: Direction;
  page: number;
}

/**
 * Read the state of the list from its URL. A value that is not valid gives
 * the default: no search, all stages, the default order, page 1.
 */
export const parseListQuery = (query: unknown): ListQuery => {
  const params = (query ?? {}) as Record<string, unknown>;
  const stage = formText(params.stage);
  const sort = formText(params.sort);
  const page = Number(formText(params.page));
  return {
    q: formText(params.q),
    stage: isStage(stage) ? stage : '',
    sort: isSort(sort) ? sort : '',
    dir: formText(params.dir) === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
};

/** The URL of the list at `path` with `state`. It has no empty parameter. */
export const listHref = (path: ListPath, state: ListQuery) => {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.stage) params.set('stage', state.stage);
  if (state.sort) {
    params.set('sort', state.sort);
    params.set('dir', state.dir);
  }
  if (state.page > 1) params.set('page', String(state.page));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
};

/**
 * The sort after a press on the key `key`. The first press sorts
 * ascending, the second press descending, and the third press removes the
 * sort. A press on a different key replaces the sort.
 */
export const nextSort = (
  { sort, dir }: Pick<ListQuery, 'sort' | 'dir'>,
  key: Sort,
): Pick<ListQuery, 'sort' | 'dir'> => {
  if (sort !== key) return { sort: key, dir: 'asc' };
  if (dir === 'asc') return { sort: key, dir: 'desc' };
  return { sort: '', dir: 'asc' };
};

/**
 * Hidden fields that keep a state in a GET form. A field with an empty
 * value is left out, so the URL has no empty parameter.
 */
const Hidden = ({ fields }: { fields: Record<string, string> }) =>
  Object.entries(fields)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => (
      <input key={name} type="hidden" name={name} value={value} />
    ));

/** One row of the list. */
export type ListRow = Pick<
  Org,
  'slug' | 'name' | 'stage' | 'next_action_on' | 'created_at'
> & {
  /** The newest of the last visit, the last note and `created_at`. */
  last_activity: string;
};

/**
 * The list of every organisation, at `/` and at `/orgs`.
 *
 * - The LCD: the organisations as a menu, as the track list of autosam.
 *   Each row is a link to `/orgs/<slug>`, with the name, the stage, the
 *   next action date and the last activity date. The LED of the row, in
 *   the bezel, is lit when the next action is due today or overdue
 *   (REQ-CRM-LCD-001). With the Date added sort, the second date is the
 *   date added, so the list shows the value that it is in order of.
 * - Sort: three latching keys. A lit key has a green LED for ascending, and
 *   a red LED for descending. With no key lit, the order is the default:
 *   due first.
 * - Search and stage: one GET form. The Search key sends the stage that is
 *   lit, so the Enter key in the field keeps it. Each stage key sends its
 *   own stage.
 * - New lead: opens `/orgs/new`.
 *
 * Each key is a GET submit to `path`, so the URL holds the search, the
 * stage and the sort, and each key works with no page styles and no
 * JavaScript. The words on the page are the words of its keys and legends,
 * with no help text.
 */
export const listPage = ({
  path,
  date,
  query,
  rows,
  total,
}: {
  path: ListPath;
  date: string;
  query: ListQuery;
  rows: ListRow[];
  total: number;
}): PageParts => {
  const { q, stage, sort, dir, page } = query;
  const dateName = sort === 'added' ? SORTS.added.text : SORTS.activity.text;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = (page - 1) * PAGE_SIZE + 1;
  return {
    title: 'Organisations',
    device: (
      <Device>
        <Lcd
          menu={{
            legend: ['Organisation', 'Next action'],
            sublegend: ['Stage', dateName],
            empty:
              q || stage ? 'No organisation matches.' : 'No organisations yet.',
            items: rows.map((row) => {
              const due =
                row.next_action_on !== null && row.next_action_on <= date;
              return {
                href: orgPath(row.slug),
                name: row.name,
                title: `${row.name} · ${STAGES[row.stage]}`,
                value: (
                  <>
                    <BareText>· next action </BareText>
                    {row.next_action_on === null ? (
                      <span className="none">None</span>
                    ) : (
                      <When value={row.next_action_on} />
                    )}
                    {due && row.next_action_on && (
                      <BareText> ({dueWords(row.next_action_on)})</BareText>
                    )}
                  </>
                ),
                led: due,
                detail: (
                  <>
                    <BareText>· stage </BareText>
                    {STAGES[row.stage]}
                  </>
                ),
                status: (
                  <>
                    <BareText>· {dateName.toLowerCase()} </BareText>
                    <When
                      value={
                        sort === 'added' ? row.created_at : row.last_activity
                      }
                      time={false}
                    />
                  </>
                ),
              };
            }),
          }}
        />
        <Module label="Sort" value={sort ? SORTS[sort][dir] : 'Due first'}>
          <SortKeys path={path} query={query} keys={['activity', 'added']} />
          <SortKeys path={path} query={query} keys={['name']} />
        </Module>
        <form method="get" action={path}>
          <Hidden fields={{ sort, dir: sort ? dir : '' }} />
          <Module label="Search">
            <div className="search">
              <label className="field">
                <BareText>Name or postcode </BareText>
                <input
                  name="q"
                  type="search"
                  placeholder="Name or postcode"
                  defaultValue={q}
                />
              </label>
              <Key
                name={stage ? 'stage' : undefined}
                value={stage || undefined}
              >
                Search
              </Key>
            </div>
          </Module>
          <Module label="Stage" value={stage ? STAGES[stage] : 'All'}>
            <Keys>
              <LatchKey name="stage" value="" on={stage === ''}>
                All
              </LatchKey>
            </Keys>
            <Keys grid>
              {Object.entries(STAGES).map(([value, text]) => (
                <LatchKey
                  key={value}
                  name="stage"
                  value={value}
                  on={stage === value}
                >
                  {text}
                </LatchKey>
              ))}
            </Keys>
          </Module>
        </form>
        <Module label="Leads">
          <form method="get" action="/orgs/new">
            <Key>New lead</Key>
          </form>
        </Module>
      </Device>
    ),
    pager:
      pages > 1 ? (
        <>
          {page > 1 && (
            <a href={listHref(path, { ...query, page: page - 1 })} rel="prev">
              previous
            </a>
          )}{' '}
          <span>
            {first}–{Math.min(total, page * PAGE_SIZE)} of {total}
          </span>{' '}
          {page < pages && (
            <a href={listHref(path, { ...query, page: page + 1 })} rel="next">
              next
            </a>
          )}
        </>
      ) : undefined,
  };
};

/**
 * One row of sort keys. Each key is a GET form that keeps the search and
 * the stage, and sends the sort of the next press. "Last activity" and
 * "Date added" do not fit three to a row on a phone, so the keys are two
 * rows: those two, then "Name".
 */
const SortKeys = ({
  path,
  query,
  keys,
}: {
  path: ListPath;
  query: ListQuery;
  keys: Sort[];
}) => (
  <Keys>
    {keys.map((key) => {
      const next = nextSort(query, key);
      const on = query.sort === key;
      return (
        <form key={key} method="get" action={path}>
          <Hidden
            fields={{
              q: query.q,
              stage: query.stage,
              sort: next.sort,
              dir: next.sort ? next.dir : '',
            }}
          />
          <LatchKey
            on={on}
            direction={on ? query.dir : undefined}
            state={on ? SORTS[key][query.dir] : undefined}
          >
            {SORTS[key].text}
          </LatchKey>
        </form>
      );
    })}
  </Keys>
);

/** `%` and `_` in the search text match only themselves. */
const likeText = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * The search and the stage filter. The name match ignores case. The
 * postcode match ignores case and spaces, so `sw1a1aa` finds `SW1A 1AA`.
 * An empty `q` or `stage` does not filter.
 */
const WHERE = `WHERE ($q = '' OR name LIKE $name ESCAPE '\\'
         OR replace(upper(coalesce(postcode, '')), ' ', '') LIKE $postcode ESCAPE '\\')
    AND ($stage = '' OR stage = $stage)`;

/**
 * The order of each sort. The default order puts a next action that is due
 * today or overdue first, the oldest first. Then it puts the rest, by the
 * last activity, the newest first.
 */
const ORDER: Record<Sort | '', string> = {
  '': `CASE WHEN next_action_on <= $today THEN 0 ELSE 1 END,
       CASE WHEN next_action_on <= $today THEN next_action_on END,
       last_activity DESC`,
  activity: 'last_activity',
  added: 'created_at',
  name: 'name COLLATE NOCASE',
};

/**
 * One page of the organisations that match `query`, in its order, and the
 * count of all the organisations that match. A page after the last page
 * gives the last page.
 */
export const listOrgs = (db: Database, query: ListQuery, date: string) => {
  const filter = {
    q: query.q,
    name: `%${likeText(query.q)}%`,
    postcode: `%${likeText(query.q.toUpperCase().replace(/\s+/g, ''))}%`,
    stage: query.stage,
  };
  const total =
    db
      .query<{ n: number }, typeof filter>(
        `SELECT count(*) AS n FROM organisation ${WHERE};`,
      )
      .get(filter)?.n ?? 0;
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const direction = query.sort && query.dir === 'desc' ? ' DESC' : '';
  const rows = db
    .query<ListRow, typeof filter & { today: string; offset: number }>(
      `SELECT slug, name, stage, next_action_on, created_at,
         max(
           created_at,
           coalesce((SELECT max(at) FROM visit
                     WHERE visit.organisation_id = organisation.id), ''),
           coalesce((SELECT max(created_at) FROM note
                     WHERE note.organisation_id = organisation.id), '')
         ) AS last_activity
       FROM organisation ${WHERE}
       ORDER BY ${ORDER[query.sort]}${direction}, name COLLATE NOCASE, slug
       LIMIT ${PAGE_SIZE} OFFSET $offset;`,
    )
    .all({ ...filter, today: date, offset: (page - 1) * PAGE_SIZE });
  return { rows, total, page };
};

/**
 * `GET /` and `GET /orgs`, with
 * `?q=<text>&stage=<stage>&sort=<sort>&dir=<asc|desc>&page=<n>`. One
 * handler serves both paths, and the forms of each page submit to its own
 * path.
 */
export const listRoute = (app: FastifyInstance, db: Database) => {
  for (const path of LIST_PATHS) {
    app.get(path, { config: { admin: true } }, async (request, reply) => {
      const date = today();
      const query = parseListQuery(request.query);
      const { rows, total, page } = listOrgs(db, query, date);
      return reply
        .type('text/html; charset=utf-8')
        .send(
          renderPage(
            request,
            listPage({ path, date, query: { ...query, page }, rows, total }),
          ),
        );
    });
  }
};
