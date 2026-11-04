import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { dayRange, today } from '../dates';
import { type ModeCounts, modeCounts, modeKeys } from '../modes';
import { OUTCOMES, type Outcome, orgPath } from '../org';
import { type PageParts, renderPage } from '../render';
import { Band, type BandGroup, Bands } from '../ui/Band';
import { DisplayUnit } from '../ui/DisplayUnit';
import { Rack } from '../ui/Rack';
import { When } from '../ui/When';
import {
  bandGroups,
  type ListGroup,
  type ListRow,
  listColumns,
  listOrgs,
  type OrderRow,
  orderedOrgs,
  orderHref,
  parseListQuery,
  type RunningOrder,
} from './index';

/** One visit or note that was logged today, with its organisation. */
export interface LoggedEntry {
  kind: 'visit' | 'note';
  number: number;
  at: string;
  outcome: Outcome | null;
  note: string | null;
  slug: string;
  name: string;
}

/**
 * The visits and the notes logged on the London day `date`, the newest
 * first. A hidden visit or note does not show (REQ-CRM-UNDO-001).
 */
export const loggedOn = (db: Database, date: string): LoggedEntry[] => {
  const { from, to } = dayRange(date);
  return db
    .query<LoggedEntry, [string, string]>(
      `SELECT 'visit' AS kind, visit.number, visit.at, visit.outcome,
         visit.note, organisation.slug, organisation.name
       FROM visit JOIN organisation ON organisation.id = visit.organisation_id
       WHERE visit.hidden_at IS NULL AND visit.at >= ?1 AND visit.at < ?2
       UNION ALL
       SELECT 'note', note.number, note.created_at, NULL, note.body,
         organisation.slug, organisation.name
       FROM note JOIN organisation ON organisation.id = note.organisation_id
       WHERE note.hidden_at IS NULL AND note.created_at >= ?1
         AND note.created_at < ?2
       ORDER BY 3 DESC;`,
    )
    .all(from, to);
};

/** The running order of the Plan with no search: the default order. */
const PLAN: RunningOrder = {
  path: '/',
  query: parseListQuery({}, '/'),
  at: null,
};

/**
 * Review, the evening view (`apps/crm/docs/002-rack.md`, decision 1): the
 * visits and notes logged today, and what is still due. The page is a rack
 * over the bands (REQ-CRM-LAYOUT-002), with no control unit: it only reads.
 *
 * - The display unit. The glass reads the day, the number of visits and
 *   notes logged today, and the numbers of Overdue and Today. The plate
 *   holds the mode keys, with Review on.
 * - Logged today: each visit and note of today, the newest first, with its
 *   organisation (a link), its number and its text.
 * - Still due: the organisations with a next action due today or overdue,
 *   in the order of the Plan. Each link carries the running order of the
 *   Plan, so Prev and Next on the organisation page walk them.
 */
export const reviewPage = ({
  date,
  logged,
  rows,
  groups,
  counts,
  total,
  start,
  modes,
}: {
  date: string;
  logged: LoggedEntry[];
  /** The rows of the Plan that are due today or overdue. */
  rows: ListRow[];
  /** The Overdue and Today groups of the Plan. */
  groups: ListGroup[];
  /** The number of organisations in each group of `DUE_GROUPS`. */
  counts: number[];
  /** The number of organisations in the Plan, for the Work key. */
  total: number;
  /** The first organisation of the Plan, for the Work key. */
  start: OrderRow | undefined;
  modes: ModeCounts;
}): PageParts => {
  const visits = logged.filter((entry) => entry.kind === 'visit').length;
  const notes = logged.length - visits;
  const loggedGroups: BandGroup[] = [
    {
      name: 'Today',
      count: logged.length,
      rows: logged.map((entry) => ({
        key: `${entry.slug}/${entry.number}`,
        href: orgPath(entry.slug),
        name: entry.name,
        cells: [
          { value: <When value={entry.at} /> },
          {
            value: `${entry.kind === 'note' ? 'Note' : 'Visit'} ${entry.number}${
              entry.outcome ? ` · ${OUTCOMES[entry.outcome]}` : ''
            }`,
          },
          entry.note
            ? { value: entry.note, title: entry.note }
            : { value: <span className="none">No note</span> },
        ],
      })),
    },
  ];
  return {
    title: 'Review',
    rack: (
      <Rack>
        <DisplayUnit
          readings={[
            {
              label: 'Today',
              kind: 'name',
              value: <When value={date} />,
              lines: [
                {
                  value: `${visits} ${visits === 1 ? 'visit' : 'visits'}, ${notes} ${notes === 1 ? 'note' : 'notes'}`,
                },
              ],
            },
            { label: 'Visits', kind: 'count', value: visits },
            { label: 'Notes', kind: 'count', value: notes },
            { label: 'Overdue', kind: 'count', value: counts[0] ?? 0 },
            { label: 'Due today', kind: 'count', value: counts[1] ?? 0 },
          ]}
          modes={modeKeys({
            mode: 'review',
            work: start
              ? {
                  href: orderHref(start.slug, PLAN, 1),
                  caption: `${total} in list`,
                }
              : { caption: 'No organisations' },
            counts: modes,
          })}
        />
      </Rack>
    ),
    band: (
      <Bands>
        <Band
          id="logged"
          title="Logged today"
          name="logged"
          info={`${visits} ${visits === 1 ? 'visit' : 'visits'} and ${notes} ${notes === 1 ? 'note' : 'notes'}, newest first`}
          gutter="Day"
          nameLabel="Organisation"
          columns={[
            { label: 'When', name: 'c-when' },
            { label: 'Event', name: 'c-entry' },
            { label: 'Text', name: 'c-text' },
          ]}
          groups={loggedGroups}
          empty="No visits or notes today."
        />
        <Band
          id="still-due"
          title="Still due"
          info="Due today or overdue, as on the Plan"
          gutter="Due"
          seam="Due now"
          nameLabel="Organisation"
          columns={listColumns(PLAN.query)}
          groups={bandGroups({
            groups,
            rows,
            date,
            sort: PLAN.query.sort,
            href: (row, index) => orderHref(row.slug, PLAN, index + 1),
          })}
          empty="Nothing is due."
        />
      </Bands>
    ),
  };
};

/**
 * `GET /review`: Review, for the admin. The first rows of the Plan are the
 * Overdue and Today groups, so the Still due band takes them from the
 * first page of the Plan.
 */
export const reviewRoute = (app: FastifyInstance, db: Database) => {
  app.get('/review', { config: { admin: true } }, async (request, reply) => {
    const date = today();
    const { rows, counts, groups } = listOrgs(db, PLAN.query, date, '/');
    const due = rows.filter((row) => row.due_group <= 1);
    const plan = orderedOrgs(db, PLAN.query, date, '/');
    return reply.type('text/html; charset=utf-8').send(
      renderPage(
        request,
        reviewPage({
          date,
          logged: loggedOn(db, date),
          rows: due,
          groups: groups.filter((group) => Number(group.key) <= 1),
          counts,
          total: plan.length,
          start: plan[0],
          modes: modeCounts(db, date),
        }),
      ),
    );
  });
};
