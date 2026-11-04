import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import {
  addDays,
  dueWords,
  formatDate,
  fullDateTime,
  isoDateTime,
  today,
} from '../dates';
import { type ModeCounts, modeCounts, modeKeys } from '../modes';
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
import { Key, Keys, keyClass } from '../ui/Key';
import { LatchKey } from '../ui/LatchKey';
import { Module } from '../ui/Module';
import { Rack } from '../ui/Rack';
import { When } from '../ui/When';

/**
 * The sort keys of the list that have a direction: the text on each key,
 * and the text of each direction. The legends of the band use the same
 * words. With `Due`, the sorts are due, date added and name, and no other
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

/**
 * A sort of the list. `due` is the Due key: the oldest due date first, with
 * no direction. `added` and `name` have a direction.
 */
export type Sort = 'due' | keyof typeof SORTS;

export type Direction = 'asc' | 'desc';

/**
 * `text` in a sentence: a capital that starts a word of more than one
 * letter becomes small. "Oldest first" gives "oldest first", and "A to Z"
 * does not change.
 */
const lower = (text: string) =>
  text.replace(/\b[A-Z](?=[a-z])/g, (letter) => letter.toLowerCase());

const isSort = (value: string): value is Sort =>
  value === 'due' || Object.hasOwn(SORTS, value);

/** The number of rows on one page of the list. */
export const PAGE_SIZE = 50;

/**
 * The two pages of the list. One handler serves both.
 *
 * - `/` is the Plan, the home: the band is grouped by due date, and the
 *   default sort is Due (`apps/crm/docs/002-rack.md`, decision 1).
 * - `/orgs` is the address book: the band is grouped by the sort (the
 *   first letter of the name, the month added, or the due date), and the
 *   default sort is Name, A to Z (Timeline, /orgs).
 */
export const LIST_PATHS = ['/', '/orgs'] as const;

export type ListPath = (typeof LIST_PATHS)[number];

/** The sort of each page of the list when its URL has none. */
export const DEFAULT_SORT: Record<ListPath, Sort> = {
  '/': 'due',
  '/orgs': 'name',
};

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
 * The group of each organisation in SQL, for each grouping of the band:
 * the due group, the first letter of the name (`#` for a name that does
 * not start with a letter), or the month added (`YYYY-MM`).
 */
const GROUPS: Record<Sort, string> = {
  due: DUE_GROUP,
  name: `CASE WHEN upper(substr(name, 1, 1)) BETWEEN 'A' AND 'Z'
    THEN upper(substr(name, 1, 1)) ELSE '#' END`,
  added: 'substr(created_at, 1, 7)',
};

/**
 * The grouping of the band of `path` with the sort `sort`. The Plan is
 * always grouped by due date. The address book is grouped by its sort.
 */
const groupingOf = (path: ListPath, sort: Sort): Sort =>
  path === '/' ? 'due' : sort;

/**
 * The state of the list. The URL holds all of it:
 * `?q=<text>&stage=<stage>&sort=<sort>&dir=<asc|desc>&page=<n>`. A URL
 * with no sort has the default sort of its page (`DEFAULT_SORT`).
 */
export interface ListQuery {
  q: string;
  stage: Stage | '';
  sort: Sort;
  dir: Direction;
  page: number;
}

/**
 * Read the state of the list at `path` from its URL. A value that is not
 * valid gives the default: no search, all stages, the default sort of the
 * page, page 1. Due has no direction.
 */
export const parseListQuery = (
  query: unknown,
  path: ListPath = '/',
): ListQuery => {
  const params = (query ?? {}) as Record<string, unknown>;
  const stage = formText(params.stage);
  const sortText = formText(params.sort);
  const sort = isSort(sortText) ? sortText : DEFAULT_SORT[path];
  const page = Number(formText(params.page));
  return {
    q: formText(params.q),
    stage: isStage(stage) ? stage : '',
    sort,
    dir: sort !== 'due' && formText(params.dir) === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
};

/**
 * The `sort` and `dir` fields of the URL of a sort at `path`. The default
 * sort of the page, ascending, has none, and Due has no `dir`.
 */
const sortFields = (
  path: ListPath,
  { sort, dir }: Pick<ListQuery, 'sort' | 'dir'>,
) =>
  sort === DEFAULT_SORT[path] && dir === 'asc'
    ? { sort: '', dir: '' }
    : { sort, dir: sort === 'due' ? '' : dir };

/** The URL of the list at `path` with `state`. It has no empty parameter. */
export const listHref = (path: ListPath, state: ListQuery) => {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.stage) params.set('stage', state.stage);
  const { sort, dir } = sortFields(path, state);
  if (sort) params.set('sort', sort);
  if (dir) params.set('dir', dir);
  if (state.page > 1) params.set('page', String(state.page));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
};

/**
 * The sort after a press on the key `key`. The Due key sets Due. The first
 * press on Date added or Name sorts ascending, the second press
 * descending, and the third press sets `fallback`: the default sort of the
 * page. A press on a different key replaces the sort.
 */
export const nextSort = (
  { sort, dir }: Pick<ListQuery, 'sort' | 'dir'>,
  key: Sort,
  fallback: Sort = 'due',
): Pick<ListQuery, 'sort' | 'dir'> => {
  if (key === 'due') return { sort: 'due', dir: 'asc' };
  if (sort !== key) return { sort: key, dir: 'asc' };
  if (dir === 'asc') return { sort: key, dir: 'desc' };
  return { sort: fallback, dir: 'asc' };
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
  /** The key of the group of the row in the band (`GROUPS`). */
  grp: number | string;
};

/** One group of the band: its key in SQL, its name and its count. */
export interface ListGroup {
  key: number | string;
  name: string;
  count: number;
  /** True when the group covers more than one day (`DUE_GROUPS`). */
  days: boolean;
}

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

/** The URL of the new lead page, with the search text as its name. */
export const newLeadHref = (q: string) =>
  q ? `/orgs/new?${new URLSearchParams({ name: q })}` : '/orgs/new';

/** The text of the sort of the band, under its head. */
const orderText = (path: ListPath, { sort, dir }: ListQuery) => {
  if (sort === 'due') return 'Sorted by due date, oldest first';
  const text = `sorted by ${lower(SORTS[sort].text)}, ${lower(SORTS[sort][dir])}`;
  return path === '/' ? `In each group, ${text}` : `S${text.slice(1)}`;
};

/**
 * The columns of a band of organisations, after the name: Stage, Next
 * action, Due date, Last activity (Date added with that sort) and
 * Postcode. The legend of the column that sets the order has its arrow.
 */
export const listColumns = ({ sort, dir }: Pick<ListQuery, 'sort' | 'dir'>) => [
  { label: 'Stage', name: 'c-stage' },
  { label: 'Next action', name: 'c-action' },
  {
    label: 'Due date',
    name: 'c-due',
    order: sort === 'due' ? ('asc' as const) : undefined,
  },
  sort === 'added'
    ? { label: SORTS.added.text, name: 'c-last', order: dir }
    : { label: 'Last activity', name: 'c-last' },
  { label: 'Postcode', name: 'c-postcode' },
];

/**
 * The groups of a band of organisations: the rows of each group of
 * `groups`, in the order of `rows`. Each row links to `href(row, index)`,
 * where `index` is the place of the row in `rows`, from 0, so the link
 * can carry the running order. The LED of a row is lit when its next
 * action is due on `date` or before.
 */
export const bandGroups = ({
  groups,
  rows,
  date,
  sort,
  href,
}: {
  groups: ListGroup[];
  rows: ListRow[];
  date: string;
  sort: Sort;
  href: (row: ListRow, index: number) => string;
}): BandGroup[] =>
  groups.map((group) => ({
    name: group.name,
    count: group.count,
    rows: rows
      .filter((row) => row.grp === group.key)
      .map((row) => ({
        href: href(row, rows.indexOf(row)),
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

/** The legend of the gutter of the band, for each grouping. */
const GUTTERS: Record<Sort, string> = {
  due: 'Due',
  name: 'Letter',
  added: 'Added',
};

/**
 * The list, at `/` (the Plan, the home) and at `/orgs` (the address book).
 * The page is a rack over a band (REQ-CRM-LAYOUT-002).
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
 *   its own stage. Sort has three latching keys: Due, Date added and Name.
 *   Date added and Name sort ascending (green LED), then descending (red
 *   LED), then go back to the default sort of the page. New lead carries
 *   the search text, and a search with no match offers it in the band too.
 * - The band. Each organisation is one row, with an LED on the chassis
 *   seam that is lit when the next action is due today or overdue.
 *   - On the Plan the groups are `DUE_GROUPS`: Overdue, Today, Next 7 days,
 *     Later, None. The sort sets the order in each group. Due puts the
 *     oldest due date first, then the newest last activity. Overdue shows
 *     three times: the LED, the group name and the words, for example
 *     "3 days overdue".
 *   - In the address book the sort sets the groups: the first letter of
 *     the name (the default, A to Z), the month added, or `DUE_GROUPS`.
 *   With the Date added sort, the last column is the date added in place
 *   of the last activity, so the band shows the value that it is in order
 *   of.
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
  groups: listGroups,
  start,
  modes,
}: {
  path: ListPath;
  date: string;
  query: ListQuery;
  rows: ListRow[];
  total: number;
  /** The number of organisations in each group of `DUE_GROUPS`. */
  counts: number[];
  /** The groups of the band, in order (`listOrgs`). */
  groups: ListGroup[];
  /** The first organisation of the whole list, for Start and Work. */
  start: OrderRow | undefined;
  /** The counts of the mode keys (`modeCounts`). */
  modes: ModeCounts;
}): PageParts => {
  const { q, stage, sort, dir, page } = query;
  const grouping = groupingOf(path, sort);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = (page - 1) * PAGE_SIZE + 1;
  const first = rows[0];
  const noMatch = total === 0 && q !== '' && stage === '';
  const order: RunningOrder = { path, query: { ...query, page: 1 }, at: null };
  const groups = bandGroups({
    groups: listGroups,
    rows,
    date,
    sort,
    href: (row, index) => orderHref(row.slug, order, firstRow + index),
  });
  const startHref = start ? orderHref(start.slug, order, 1) : undefined;
  /** The reason that Start and Work are off: the list is empty. */
  const empty = q || stage ? 'No match' : 'No organisations';
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
    start && startHref
      ? { id: 'start', label: 'Start', caption: start.name, href: startHref }
      : { id: 'start', label: 'Start', caption: empty, off: true },
  ];
  const { sort: sortField, dir: dirField } = sortFields(path, query);
  return {
    title: path === '/' ? 'Organisations' : 'Address book',
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
          modes={modeKeys({
            mode: path === '/' ? 'plan' : null,
            work: startHref
              ? { href: startHref, caption: `${total} in list` }
              : { caption: empty },
            counts: modes,
          })}
        />
        <ControlUnit
          tabs={[
            { id: 'search', label: 'Search' },
            { id: 'stage', label: 'Stage' },
            { id: 'sort', label: 'Sort' },
          ]}
        >
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
                  <Hidden fields={{ sort: sortField, dir: dirField }} />
                  <Key
                    name={stage ? 'stage' : undefined}
                    value={stage || undefined}
                  >
                    Search
                  </Key>
                </span>
              </div>
              <a className={keyClass(noMatch)} href={newLeadHref(q)}>
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
            value={sort === 'due' ? 'Due first' : SORTS[sort][dir]}
            span={3}
          >
            <SortKeys path={path} query={query} keys={['due', 'added']} />
            <SortKeys path={path} query={query} keys={['name']} />
          </Module>
        </ControlUnit>
      </Rack>
    ),
    band: (
      <Band
        id="orgs-band"
        title={path === '/' ? 'Organisations' : 'Organisations A to Z'}
        info={orderText(path, query)}
        gutter={GUTTERS[grouping]}
        seam="Due now"
        nameLabel="Organisation"
        orderName={sort === 'name' ? dir : undefined}
        columns={listColumns(query)}
        groups={groups}
        empty={
          noMatch ? (
            <>
              No organisation matches “{q}”.{' '}
              <a href={newLeadHref(q)}>New lead: {q}</a>
            </>
          ) : q || stage ? (
            'No organisation matches.'
          ) : (
            'No organisations yet.'
          )
        }
      />
    ),
  };
};

/**
 * One row of sort keys. Each key is a GET form that keeps the search and
 * the stage, and sends the sort of the next press. The keys are two rows,
 * so each label fits its key at the breakpoint: Due and Date added, then
 * Name.
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
      const next = nextSort(query, key, DEFAULT_SORT[path]);
      const on = query.sort === key;
      return (
        <form key={key} method="get" action={path}>
          <Hidden
            fields={{
              q: query.q,
              stage: query.stage,
              ...sortFields(path, next),
            }}
          />
          {key === 'due' ? (
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
 * The order in each group, for each sort. Due puts the oldest due date
 * first, then the newest last activity.
 */
const ORDER: Record<Sort, string> = {
  due: 'next_action_on, last_activity DESC',
  added: 'created_at',
  name: 'name COLLATE NOCASE',
};

/** The parameters of `WHERE` for the search and the stage of `query`. */
const filterOf = (query: ListQuery) => ({
  q: query.q,
  name: `%${likeText(query.q)}%`,
  postcode: `%${likeText(query.q.toUpperCase().replace(/\s+/g, ''))}%`,
  stage: query.stage,
});

/** The parameters of `DUE_GROUP` on the London day `date`. */
const daysOf = (date: string) => ({ today: date, week: addDays(date, 7) });

/**
 * The SQL of every organisation that matches `query` on the page `path`,
 * in the order of the list: group by group, and in each group by the
 * sort. `listOrgs` adds the page to it, and `orderedOrgs` takes all of it,
 * so the list and the running order have one order.
 */
const orderedSql = (query: ListQuery, path: ListPath) => {
  const grouping = groupingOf(path, query.sort);
  const descending = query.sort !== 'due' && query.dir === 'desc';
  const groupDirection = grouping !== 'due' && descending ? ' DESC' : '';
  const direction = descending ? ' DESC' : '';
  return `SELECT slug, name, stage, next_action, next_action_on, postcode,
       created_at, ${DUE_GROUP} AS due_group, ${GROUPS[grouping]} AS grp,
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
     ORDER BY grp${groupDirection}, ${ORDER[query.sort]}${direction},
       name COLLATE NOCASE, slug`;
};

/** One organisation of a running order: its slug and its name. */
export type OrderRow = Pick<Org, 'slug' | 'name'>;

/**
 * Every organisation that matches `query` on the page `path`, in the order
 * of the list, on all pages. The crm has one seller, so the list is short
 * enough to read whole for each organisation page.
 */
export const orderedOrgs = (
  db: Database,
  query: ListQuery,
  date: string,
  path: ListPath = '/',
): OrderRow[] =>
  db
    .query<OrderRow, ReturnType<typeof filterOf> & ReturnType<typeof daysOf>>(
      `SELECT slug, name FROM (${orderedSql(query, path)});`,
    )
    .all({ ...filterOf(query), ...daysOf(date) });

/**
 * The running order of an organisation page (`apps/crm/docs/002-rack.md`):
 * the list that Sean came from, and the place of the organisation in it.
 * There is no round record: the URL of the organisation page holds all of
 * it, as a short query string (`orderSearch`).
 *
 * - `path`: the list. `/` (the Plan) is the default. `list=orgs` is the
 *   address book.
 * - `query`: the search, the stage and the sort of the list, as in its own
 *   URL. The running order has no page: it is the whole list.
 * - `at`: the place of the organisation in the list when Sean opened it,
 *   from 1. A save can move the organisation in the list (a new due date)
 *   or out of it (a new stage), and `at` keeps Prev and Next on the
 *   organisations that were before it and after it.
 */
export interface RunningOrder {
  path: ListPath;
  query: ListQuery;
  at: number | null;
}

/**
 * Read the running order from the query of an organisation page, or of a
 * post under it. A value that is not valid gives the default, as in
 * `parseListQuery`. With no query, the running order is the Plan, and the
 * place is where the organisation is now.
 */
export const parseOrder = (query: unknown): RunningOrder => {
  const params = (query ?? {}) as Record<string, unknown>;
  const path: ListPath = formText(params.list) === 'orgs' ? '/orgs' : '/';
  const at = Number(formText(params.at));
  return {
    path,
    query: { ...parseListQuery(params, path), page: 1 },
    at: Number.isInteger(at) && at > 0 ? at : null,
  };
};

/**
 * The query string of a running order, with `?`, or '' for the Plan with
 * no search, stage, sort or place. The fields are those of the list URL
 * (`listHref`), after `list=orgs` for the address book, then `at`, then
 * `extra` (for example `hidden=1`). It has no empty parameter, and no
 * UUID (REQ-CRM-ID-001).
 */
export const orderSearch = (
  order: RunningOrder,
  extra: Record<string, string> = {},
) => {
  const params = new URLSearchParams();
  if (order.path === '/orgs') params.set('list', 'orgs');
  const list = listHref(order.path, { ...order.query, page: 1 });
  for (const [name, value] of new URLSearchParams(list.split('?')[1] ?? '')) {
    params.set(name, value);
  }
  if (order.at) params.set('at', String(order.at));
  for (const [name, value] of Object.entries(extra)) params.set(name, value);
  const search = params.toString();
  return search ? `?${search}` : '';
};

/** The URL of the organisation `slug` at the place `at` of `order`. */
export const orderHref = (slug: string, order: RunningOrder, at: number) =>
  `${orgPath(slug)}${orderSearch({ ...order, at })}`;

/** A neighbour in a running order: the organisation and its place now. */
export interface OrderStep extends OrderRow {
  at: number;
}

/**
 * Where the organisation `slug` is in its running order, for Prev and Next
 * on its plate (`apps/crm/docs/002-rack.md`, Running order).
 *
 * - `total`: the number of organisations in the list now.
 * - `place`: the place of the organisation in the list now, from 1, or
 *   null when it is not in the list (a save moved it out).
 * - `first`: the first organisation of the list, for Start and Work.
 * - `prev` and `next`: the organisations before it and after it, or null
 *   at an end of the list.
 *
 * The neighbours come from the place where the organisation was (`at`), in
 * the list without the organisation. A save moves only this organisation,
 * so the others keep their order, and Next opens the organisation that was
 * after it, also when the save moved it to the end or out of the list.
 * With no `at`, the place is where the organisation is now.
 */
export const walkOrder = (
  db: Database,
  order: RunningOrder,
  slug: string,
  date: string,
) => {
  const rows = orderedOrgs(db, order.query, date, order.path);
  const here = rows.findIndex((row) => row.slug === slug);
  const was = order.at !== null ? order.at - 1 : here;
  const others = rows.filter((row) => row.slug !== slug);
  const step = (row: OrderRow | undefined): OrderStep | null =>
    row ? { ...row, at: rows.indexOf(row) + 1 } : null;
  return {
    total: rows.length,
    place: here >= 0 ? here + 1 : null,
    first: step(rows[0]),
    prev: was > 0 ? step(others[was - 1]) : null,
    next: was >= 0 ? step(others[was]) : null,
  };
};

/** The name of a group of the band, from its key. */
const groupName = (grouping: Sort, key: number | string) => {
  if (grouping === 'due') return DUE_GROUPS[Number(key)]?.name ?? 'None';
  if (grouping === 'added') {
    return formatDate(`${key}-01`, { time: false }).slice(0, 8);
  }
  return String(key);
};

/**
 * One page of the organisations that match `query` on the page `path`, in
 * its order, the count of all the organisations that match, the count of
 * each group of `DUE_GROUPS`, and the groups of the band (`groupingOf`),
 * each with its count. The rows come group by group. A page after the
 * last page gives the last page.
 */
export const listOrgs = (
  db: Database,
  query: ListQuery,
  date: string,
  path: ListPath = '/',
) => {
  const filter = filterOf(query);
  const days = daysOf(date);
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
  const grouping = groupingOf(path, query.sort);
  const descending = query.sort !== 'due' && query.dir === 'desc';
  // The groups of a letter or a month are in the order of the sort too.
  const groupDirection = grouping !== 'due' && descending ? ' DESC' : '';
  const groups: ListGroup[] =
    grouping === 'due'
      ? DUE_GROUPS.map((group, index) => ({
          key: index,
          name: group.name,
          count: counts[index] ?? 0,
          days: group.days,
        }))
      : db
          .query<
            { grp: string; n: number },
            Pick<typeof filter, 'q' | 'name' | 'postcode' | 'stage'>
          >(
            `SELECT ${GROUPS[grouping]} AS grp, count(*) AS n
             FROM organisation ${WHERE}
             GROUP BY grp ORDER BY grp${groupDirection};`,
          )
          .all(filter)
          .map((row) => ({
            key: row.grp,
            name: groupName(grouping, row.grp),
            count: row.n,
            days: true,
          }));
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const rows = db
    .query<ListRow, typeof filter & typeof days & { offset: number }>(
      `${orderedSql(query, path)} LIMIT ${PAGE_SIZE} OFFSET $offset;`,
    )
    .all({ ...filter, ...days, offset: (page - 1) * PAGE_SIZE });
  return { rows, total, page, counts, groups };
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
 * `GET /` (the Plan) and `GET /orgs` (the address book), with
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
      const query = parseListQuery(request.query, path);
      const { rows, total, page, counts, groups } = listOrgs(
        db,
        query,
        date,
        path,
      );
      const start =
        page === 1 ? rows[0] : orderedOrgs(db, query, date, path)[0];
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
            groups,
            start,
            modes: modeCounts(db, date),
          }),
        ),
      );
    });
  }
};
