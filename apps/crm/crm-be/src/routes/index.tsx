import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { addDays, dueWords, fullDateTime, isoDateTime, today } from '../dates';
import {
  formText,
  isStage,
  type Org,
  orgPath,
  STAGES,
  type Stage,
} from '../org';
import { type PageParts, renderPage } from '../render';
import { Band, type BandGroup } from '../ui/Band';
import { BareText } from '../ui/BareText';
import { Box } from '../ui/Box';
import { ControlUnit } from '../ui/ControlUnit';
import { DisplayUnit, type PlateKey } from '../ui/DisplayUnit';
import { Key, Keys } from '../ui/Key';
import { LatchKey } from '../ui/LatchKey';
import { Module } from '../ui/Module';
import { Rack } from '../ui/Rack';
import { When } from '../ui/When';

/**
 * The sort keys of the list, after `Due` (the default order): the text on
 * each key, and the text of each direction. The legends of the band use
 * the same words. The sorts are due, date added and name, and no other
 * (`apps/crm/docs/002-rack.md`, decision 3).
 */
export const SORTS = {
  added: {
    text: 'Date added',
    asc: 'Oldest first',
    desc: 'Newest first',
  },
  name: {
    text: 'Name',
    asc: 'A to Z',
    desc: 'Z to A',
  },
} as const;

export type Sort = keyof typeof SORTS;

export type Direction = 'asc' | 'desc';

/**
 * `text` in a sentence: a capital that starts a word of more than one
 * letter becomes small. "Oldest first" gives "oldest first", and "A to Z"
 * does not change.
 */
const lower = (text: string) =>
  text.replace(/\b[A-Z](?=[a-z])/g, (letter) => letter.toLowerCase());

const isSort = (value: string): value is Sort => Object.hasOwn(SORTS, value);

/** The number of rows on one page of the list. */
export const PAGE_SIZE = 50;

/** The two paths of the list. One handler serves both. */
export const LIST_PATHS = ['/', '/orgs'] as const;

export type ListPath = (typeof LIST_PATHS)[number];

/**
 * The groups of the Plan, in order: each organisation is in one group, by
 * the date of its next action. The gutter of the band names each group.
 * `days` is true when a group covers more than one day, so its rows show
 * their date (`apps/crm/docs/002-rack.md`, Timeline rows).
 */
export const DUE_GROUPS = [
  { name: 'Overdue', days: true },
  { name: 'Today', days: false },
  { name: 'Next 7 days', days: true },
  { name: 'Later', days: true },
  { name: 'None', days: false },
] as const;

/**
 * The number (the index in `DUE_GROUPS`) of the group of each organisation,
 * in SQL. `$today` is today, and `$week` is today plus 7 days.
 */
const DUE_GROUP = `CASE
    WHEN next_action_on IS NULL THEN 4
    WHEN next_action_on < $today THEN 0
    WHEN next_action_on = $today THEN 1
    WHEN next_action_on <= $week THEN 2
    ELSE 3
  END`;

/**
 * The state of the list. The URL holds all of it:
 * `?q=<text>&stage=<stage>&sort=<sort>&dir=<asc|desc>&page=<n>`. An empty
 * `sort` is the default order: due first.
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
 * The sort after a press on the key `key`. `''` is the Due key: it sets the
 * default order. The first press on Date added or Name sorts ascending, the
 * second press descending, and the third press sets the default order. A
 * press on a different key replaces the sort.
 */
export const nextSort = (
  { sort, dir }: Pick<ListQuery, 'sort' | 'dir'>,
  key: Sort | '',
): Pick<ListQuery, 'sort' | 'dir'> => {
  if (key === '') return { sort: '', dir: 'asc' };
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
  | 'slug'
  | 'name'
  | 'stage'
  | 'next_action'
  | 'next_action_on'
  | 'postcode'
  | 'created_at'
> & {
  /**
   * The newest of the last visit, the last note and `created_at`. A hidden
   * visit or note does not count (REQ-CRM-UNDO-001).
   */
  last_activity: string;
  /** The index of the group of the row in `DUE_GROUPS`. */
  due_group: number;
};

/**
 * The date of a next action as a band cell: the date and its status in
 * words. A row in a group of one day (Today) shows only the words, and its
 * `<time>` keeps the date in its attributes. With no date, the cell says
 * None.
 */
const DueCell = ({ date, days }: { date: string | null; days: boolean }) => {
  if (date === null) return <span className="none">None</span>;
  if (!days) {
    return (
      <time dateTime={isoDateTime(date)} title={fullDateTime(date)}>
        {dueWords(date)}
      </time>
    );
  }
  return (
    <>
      <When value={date} />
      <span className="sep"> · </span>
      <span className="words">{dueWords(date)}</span>
    </>
  );
};

/**
 * The home: the Plan (`apps/crm/docs/002-rack.md`, decision 1), at `/` and
 * at `/orgs`. The page is a rack over a band (REQ-CRM-LAYOUT-002).
 *
 * - The display unit. The glass reads the first organisation of the list
 *   (its name, its next action and its due date), the counts of Overdue
 *   and Today, and the rows that show. The plate keys are the pager: Prev
 *   and Next. Both are always in their place, and each caption says the
 *   page that the key opens, or why the key is off: First page, Last page
 *   (REQ-CRM-BUTTON-001).
 * - The control unit. Search (with New lead), Stage and Sort, side by side.
 *   Search and Stage are one GET form. The Search key sends the stage that
 *   is lit, so the Enter key in the field keeps it. Each stage key sends
 *   its own stage. Sort has three latching keys: Due (the default order),
 *   Date added and Name. Date added and Name sort ascending (green LED),
 *   then descending (red LED), then go back to Due.
 * - The band. Each organisation is one row, in a group of `DUE_GROUPS`:
 *   Overdue, Today, Next 7 days, Later, None. The sort sets the order in
 *   each group. Due puts the oldest due date first, then the newest last
 *   activity. The LED of a row, on the chassis seam, is lit when the next
 *   action is due today or overdue. Overdue shows three times: the LED, the
 *   group name and the words, for example "3 days overdue". With the Date
 *   added sort, the last column is the date added in place of the last
 *   activity, so the band shows the value that it is in order of.
 *
 * Each key is a GET submit or a link to `path`, so the URL holds the
 * search, the stage, the sort and the page, and each key works with no page
 * styles and no JavaScript. With JavaScript, each key updates the page in
 * place (REQ-CRM-MORPH-001). Each row has a fixed height, and each key is
 * always present, so the page does not move when its data changes. With a
 * search in the URL, the search field has `autofocus`, so a full page load
 * also puts the cursor back in it.
 */
export const listPage = ({
  path,
  date,
  query,
  rows,
  total,
  counts,
}: {
  path: ListPath;
  date: string;
  query: ListQuery;
  rows: ListRow[];
  total: number;
  /** The number of organisations in each group of `DUE_GROUPS`. */
  counts: number[];
}): PageParts => {
  const { q, stage, sort, dir, page } = query;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = (page - 1) * PAGE_SIZE + 1;
  const first = rows[0];
  const order = sort
    ? `In each group, sorted by ${lower(SORTS[sort].text)}, ${lower(SORTS[sort][dir])}`
    : 'Sorted by due date, oldest first';
  const groups: BandGroup[] = DUE_GROUPS.map((group, index) => ({
    name: group.name,
    count: counts[index] ?? 0,
    rows: rows
      .filter((row) => row.due_group === index)
      .map((row) => ({
        href: orgPath(row.slug),
        name: row.name,
        led: row.next_action_on !== null && row.next_action_on <= date,
        cells: [
          { value: STAGES[row.stage] },
          row.next_action
            ? { value: row.next_action, title: row.next_action }
            : { value: <span className="none">None</span> },
          {
            value: <DueCell date={row.next_action_on} days={group.days} />,
          },
          {
            value: (
              <When
                value={sort === 'added' ? row.created_at : row.last_activity}
                time={false}
              />
            ),
          },
          {
            value: row.postcode || <span className="none">None</span>,
          },
        ],
      })),
  }));
  const keys: PlateKey[] = [
    page > 1
      ? {
          id: 'page-prev',
          label: 'Prev',
          caption: `Page ${page - 1} of ${pages}`,
          href: listHref(path, { ...query, page: page - 1 }),
          rel: 'prev',
        }
      : { id: 'page-prev', label: 'Prev', caption: 'First page', off: true },
    page < pages
      ? {
          id: 'page-next',
          label: 'Next',
          caption: `Page ${page + 1} of ${pages}`,
          href: listHref(path, { ...query, page: page + 1 }),
          rel: 'next',
        }
      : { id: 'page-next', label: 'Next', caption: 'Last page', off: true },
  ];
  return {
    title: 'Organisations',
    rack: (
      <Rack>
        <DisplayUnit
          readings={[
            {
              label: 'First in list',
              kind: 'name',
              value: first?.name ?? 'None',
              lines: [
                { value: first?.next_action || 'No next action' },
                first?.next_action_on
                  ? {
                      value: (
                        <>
                          <When value={first.next_action_on} /> ·{' '}
                          {dueWords(first.next_action_on)}
                        </>
                      ),
                      mark: first.next_action_on < date,
                    }
                  : { value: 'No due date' },
              ],
            },
            { label: 'Overdue', kind: 'count', value: counts[0] ?? 0 },
            { label: 'Today', kind: 'count', value: counts[1] ?? 0 },
            {
              label: 'Showing',
              value:
                total === 0
                  ? '0'
                  : `${firstRow}–${Math.min(total, page * PAGE_SIZE)}`,
              lines: [{ value: `of ${total}` }],
            },
          ]}
          keys={keys}
        />
        <ControlUnit>
          <form method="get" action={path}>
            <Module id="search" label="Search" span={3}>
              <div className="search">
                <label className="field">
                  <BareText>Name or postcode </BareText>
                  <input
                    id="q"
                    name="q"
                    type="search"
                    placeholder="Name or postcode"
                    defaultValue={q}
                    // biome-ignore lint/a11y/noAutofocus: after a search with no JavaScript, the full page load puts the cursor back in the field. Only a URL with a search sets it.
                    autoFocus={q !== ''}
                  />
                </label>
                <span id="search-send" className="send">
                  <Hidden fields={{ sort, dir: sort ? dir : '' }} />
                  <Key
                    name={stage ? 'stage' : undefined}
                    value={stage || undefined}
                  >
                    Search
                  </Key>
                </span>
              </div>
              <a className="key" href="/orgs/new">
                New lead
              </a>
            </Module>
            <Module
              id="stage"
              label="Stage"
              value={stage ? STAGES[stage] : 'All'}
              span={6}
            >
              <Keys four>
                <LatchKey name="stage" value="" on={stage === ''}>
                  All
                </LatchKey>
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
          <Module
            id="sort"
            label="Sort"
            value={sort ? SORTS[sort][dir] : 'Due first'}
            span={3}
          >
            <SortKeys path={path} query={query} keys={['', 'added']} />
            <SortKeys path={path} query={query} keys={['name']} />
          </Module>
        </ControlUnit>
      </Rack>
    ),
    band: (
      <Band
        id="orgs-band"
        title="Organisations"
        info={order}
        gutter="Due"
        seam="Due now"
        nameLabel="Organisation"
        orderName={sort === 'name' ? dir : undefined}
        columns={[
          { label: 'Stage', name: 'c-stage' },
          { label: 'Next action', name: 'c-action' },
          {
            label: 'Due date',
            name: 'c-due',
            order: sort ? undefined : 'asc',
          },
          sort === 'added'
            ? { label: SORTS.added.text, name: 'c-last', order: dir }
            : { label: 'Last activity', name: 'c-last' },
          { label: 'Postcode', name: 'c-postcode' },
        ]}
        groups={groups}
        empty={
          q || stage ? 'No organisation matches.' : 'No organisations yet.'
        }
      />
    ),
  };
};

/**
 * One row of sort keys. Each key is a GET form that keeps the search and
 * the stage, and sends the sort of the next press. `''` is the Due key. The
 * keys are two rows, so each label fits its key at the breakpoint: Due and
 * Date added, then Name.
 */
const SortKeys = ({
  path,
  query,
  keys,
}: {
  path: ListPath;
  query: ListQuery;
  keys: (Sort | '')[];
}) => (
  <Keys>
    {keys.map((key) => {
      const next = nextSort(query, key);
      const on = query.sort === key;
      return (
        <form key={key || 'due'} method="get" action={path}>
          <Hidden
            fields={{
              q: query.q,
              stage: query.stage,
              sort: next.sort,
              dir: next.sort ? next.dir : '',
            }}
          />
          {key === '' ? (
            <LatchKey on={on}>Due</LatchKey>
          ) : (
            <LatchKey
              on={on}
              direction={on ? query.dir : undefined}
              state={on ? SORTS[key][query.dir] : undefined}
            >
              {SORTS[key].text}
            </LatchKey>
          )}
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
 * The order in each group of `DUE_GROUPS`, for each sort. Due puts the
 * oldest due date first, then the newest last activity.
 */
const ORDER: Record<Sort | '', string> = {
  '': 'next_action_on, last_activity DESC',
  added: 'created_at',
  name: 'name COLLATE NOCASE',
};

/**
 * One page of the organisations that match `query`, in its order, the
 * count of all the organisations that match, and the count of each group
 * of `DUE_GROUPS`. The rows come group by group. A page after the last
 * page gives the last page.
 */
export const listOrgs = (db: Database, query: ListQuery, date: string) => {
  const filter = {
    q: query.q,
    name: `%${likeText(query.q)}%`,
    postcode: `%${likeText(query.q.toUpperCase().replace(/\s+/g, ''))}%`,
    stage: query.stage,
  };
  const days = { today: date, week: addDays(date, 7) };
  const counts = DUE_GROUPS.map(() => 0);
  for (const row of db
    .query<{ due_group: number; n: number }, typeof filter & typeof days>(
      `SELECT ${DUE_GROUP} AS due_group, count(*) AS n
       FROM organisation ${WHERE} GROUP BY due_group;`,
    )
    .all({ ...filter, ...days })) {
    counts[row.due_group] = row.n;
  }
  const total = counts.reduce((sum, n) => sum + n, 0);
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const direction = query.sort && query.dir === 'desc' ? ' DESC' : '';
  const rows = db
    .query<ListRow, typeof filter & typeof days & { offset: number }>(
      `SELECT slug, name, stage, next_action, next_action_on, postcode,
         created_at, ${DUE_GROUP} AS due_group,
         max(
           created_at,
           coalesce((SELECT max(at) FROM visit
                     WHERE visit.organisation_id = organisation.id
                       AND visit.hidden_at IS NULL), ''),
           coalesce((SELECT max(created_at) FROM note
                     WHERE note.organisation_id = organisation.id
                       AND note.hidden_at IS NULL), '')
         ) AS last_activity
       FROM organisation ${WHERE}
       ORDER BY due_group, ${ORDER[query.sort]}${direction},
         name COLLATE NOCASE, slug
       LIMIT ${PAGE_SIZE} OFFSET $offset;`,
    )
    .all({ ...filter, ...days, offset: (page - 1) * PAGE_SIZE });
  return { rows, total, page, counts };
};

/** The heading of the public home. */
export const HOME_HEADING = 'seanmizen.com client portal';

/**
 * The public home: `/` for a signed-out visitor. It shows only the heading
 * and two links, in words for a visitor. It reads no data.
 */
export const homePage = (): PageParts => ({
  title: 'Client portal',
  boxes: (
    <Box title={HOME_HEADING}>
      <ul>
        <li>
          <a href="/login">Sign in</a>
        </li>
        <li>
          <a href="/privacy">Privacy notice</a>
        </li>
      </ul>
    </Box>
  ),
});

/**
 * `GET /` and `GET /orgs`, with
 * `?q=<text>&stage=<stage>&sort=<sort>&dir=<asc|desc>&page=<n>`. One
 * handler serves both paths, and the forms of each page submit to its own
 * path.
 *
 * A signed-out visitor can open `/` (`SIGNED_OUT_PATHS` in `auth.ts`), and
 * gets the public home (`homePage`) at the same URL. The list needs the
 * admin.
 */
export const listRoute = (app: FastifyInstance, db: Database) => {
  for (const path of LIST_PATHS) {
    app.get(path, { config: { admin: true } }, async (request, reply) => {
      if (!request.auth) {
        return reply
          .type('text/html; charset=utf-8')
          .send(renderPage(request, homePage()));
      }
      const date = today();
      const query = parseListQuery(request.query);
      const { rows, total, page, counts } = listOrgs(db, query, date);
      return reply.type('text/html; charset=utf-8').send(
        renderPage(
          request,
          listPage({
            path,
            date,
            query: { ...query, page },
            rows,
            total,
            counts,
          }),
        ),
      );
    });
  }
};
