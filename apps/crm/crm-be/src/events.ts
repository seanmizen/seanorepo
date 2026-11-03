import type { Database } from 'bun:sqlite';
import { audit } from './auth';

/**
 * The history of each organisation (REQ-CRM-UNDO-001, REQ-CRM-UNDO-002,
 * REQ-CRM-UNDO-003): the table `org_event`, and Undo, Redo and Restore.
 *
 * - Each change to an organisation is one row of `org_event`, and
 *   `writeEvent` is the one function that adds a row. Each write path of an
 *   organisation calls it once: the new lead, a visit, a note, the stage,
 *   the next action, the details, a contact (added, changed or removed),
 *   the edit of a visit or a note, and Undo, Redo and Restore.
 * - No function here runs DELETE, and no function changes a row of
 *   `org_event`. A visit, a note or a contact that an Undo or a Remove
 *   takes away gets `hidden_at` and `hidden_by` (the event number).
 * - The payload of an event has its display fields (no personal data, the
 *   same as the detail of an `audit_log` row) and `changes`: the values
 *   before and after each row that it changed. Undo writes the before
 *   values in a new `undo` event. Redo writes the after values in a new
 *   `redo` event.
 */

/** The kinds of event, as the CHECK of `org_event.kind` lists them. */
export type EventKind =
  | 'create'
  | 'visit'
  | 'note'
  | 'stage'
  | 'next_action'
  | 'details'
  | 'contact_add'
  | 'contact_edit'
  | 'contact_remove'
  | 'activity_edit'
  | 'undo'
  | 'redo'
  | 'restore';

/**
 * The values of the columns of one row. The key `hidden` is not a column:
 * true sets `hidden_at` and `hidden_by`, and false clears them.
 */
export type Values = Record<string, string | boolean | null>;

/** The tables that an event can change. */
export type ChangeTable =
  | 'organisation'
  | 'person'
  | 'membership'
  | 'visit'
  | 'note';

/** One row that an event changed, with its values before and after. */
export interface Change {
  table: ChangeTable;
  /** The id of the row. For a membership, the person id. */
  id: string;
  before: Values;
  after: Values;
}

/** The JSON payload of an event. */
export interface Payload {
  /** The rows that the event changed. With none, Undo cannot reverse it. */
  changes?: Change[];
  /** `undo` and `redo`: the number of the event that it reverses or applies. */
  target?: number;
  /** A visit or a note: its id, the same in both tables. */
  record_id?: string;
  /** A contact: the person id. */
  person_id?: string;
  /** An event from the history before migration 005. */
  migrated?: boolean;
  /**
   * An event whose personal values an erasure removed (see "Undo and
   * history" in docs/001-guiding-design.md). Undo and Redo stop at it.
   */
  redacted?: boolean;
  /** The other display fields: `fields`, `from`, `stage`, `role`, ... */
  [key: string]: unknown;
}

/** One row of `org_event`, with its payload parsed. */
export interface OrgEvent {
  number: number;
  at: string;
  actor: string;
  kind: EventKind;
  payload: Payload;
}

/**
 * How to find a row of each table that an event changes. `org` adds the
 * organisation to the WHERE clause. `hides` is true for a table with
 * `hidden_at` and `hidden_by`. `stamp` sets `updated_at`.
 */
const TABLES: Record<
  ChangeTable,
  { key: string; org: boolean; hides: boolean; stamp: boolean }
> = {
  organisation: { key: 'id', org: false, hides: false, stamp: true },
  person: { key: 'id', org: false, hides: false, stamp: true },
  membership: { key: 'person_id', org: true, hides: true, stamp: false },
  visit: { key: 'id', org: true, hides: true, stamp: false },
  note: { key: 'id', org: true, hides: true, stamp: false },
};

/** A column name that is safe in SQL: lowercase letters, digits and `_`. */
const COLUMN = /^[a-z][a-z0-9_]*$/;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Write `values` to the row of `change`. `number` is the event that writes
 * them: a row that it hides gets it in `hidden_by`.
 */
const writeValues = (
  db: Database,
  orgId: string,
  number: number,
  change: Change,
  values: Values,
) => {
  const table = TABLES[change.table];
  if (!table) throw new Error(`An event cannot change ${change.table}.`);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [column, value] of Object.entries(values)) {
    if (column === 'hidden') {
      if (!table.hides) throw new Error(`${change.table} has no hidden_at.`);
      sets.push(
        value
          ? `hidden_at = ${NOW}, hidden_by = ?`
          : 'hidden_at = NULL, hidden_by = ?',
      );
      params.push(value ? number : null);
    } else {
      if (!COLUMN.test(column) || column === table.key) {
        throw new Error(`An event cannot set ${change.table}.${column}.`);
      }
      sets.push(`${column} = ?`);
      params.push(typeof value === 'boolean' ? Number(value) : value);
    }
  }
  if (sets.length === 0) return;
  if (table.stamp) sets.push(`updated_at = ${NOW}`);
  params.push(change.id);
  if (table.org) params.push(orgId);
  db.query(
    `UPDATE ${change.table} SET ${sets.join(', ')}
     WHERE ${table.key} = ?${table.org ? ' AND organisation_id = ?' : ''};`,
  ).run(...params);
};

/**
 * Append one event to the history of the organisation `orgId`: apply the
 * after values of each change in `payload.changes`, add the `org_event`
 * row, and add one `audit_log` row (REQ-CRM-UNDO-001). Each write path of
 * an organisation calls it once. Run it in the transaction of the write.
 *
 * The caller adds a new row (a visit, a note, a person, a membership)
 * before the call, and gives the row a change with `before: { hidden: true }`,
 * so Undo hides it. The audit row has the display fields and the event
 * number, never `changes`: `audit_log` keeps no personal data.
 *
 * Returns the event number. The rows of `org_event` are never deleted, so
 * the last number + 1 is a number that was never used (REQ-CRM-ID-001).
 */
export const writeEvent = (
  db: Database,
  actor: string,
  orgId: string,
  kind: EventKind,
  payload: Payload,
) => {
  const number =
    (db
      .query<{ last: number | null }, [string]>(
        'SELECT max(number) AS last FROM org_event WHERE organisation_id = ?;',
      )
      .get(orgId)?.last ?? 0) + 1;
  for (const change of payload.changes ?? []) {
    writeValues(db, orgId, number, change, change.after);
  }
  db.query(
    'INSERT INTO org_event (organisation_id, number, actor, kind, payload) VALUES (?, ?, ?, ?, ?);',
  ).run(orgId, number, actor, kind, JSON.stringify(payload));
  const { changes: _changes, ...detail } = payload;
  audit(db, actor, kind, 'organisation', orgId, { number, ...detail });
  return number;
};

/** Each event of the organisation `orgId`, oldest first. */
export const listOrgEvents = (db: Database, orgId: string): OrgEvent[] =>
  db
    .query<
      {
        number: number;
        at: string;
        actor: string;
        kind: EventKind;
        payload: string;
      },
      [string]
    >(
      'SELECT number, at, actor, kind, payload FROM org_event WHERE organisation_id = ? ORDER BY number;',
    )
    .all(orgId)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload) as Payload }));

/**
 * What Undo and Redo do now: the event that each one would reverse or
 * apply, or the reason that it cannot (REQ-CRM-BUTTON-001).
 */
export interface History {
  undo: { event: OrgEvent } | { off: string };
  redo: { event: OrgEvent } | { off: string };
}

/** The reason that Redo is off when no event waits for it. */
export const NOTHING_TO_REDO =
  'Nothing to redo. A new change clears the redo list.';

/** The reason that Undo cannot reverse `event`, or undefined if it can. */
const undoOff = (event: OrgEvent | undefined) => {
  if (!event || event.kind === 'create') return 'Nothing to undo.';
  if (event.payload.redacted) {
    return 'The newest change held personal data that was erased. Undo cannot reverse it.';
  }
  if (!event.payload.changes?.length) {
    return 'The newest change is older than Undo. Undo cannot reverse it.';
  }
  return undefined;
};

/**
 * The state of Undo and Redo, from the events oldest first
 * (REQ-CRM-UNDO-002). It is a stack:
 *
 * - Each new change goes on the done list and empties the redo list.
 * - `undo` moves the newest done event to the redo list.
 * - `redo` moves the newest event of the redo list back to the done list.
 *
 * Undo reverses the newest done event. It stops at an event that it cannot
 * reverse (the new lead, an event older than migration 005, a redacted
 * event), and never goes past it. Redo applies the newest event of the redo
 * list.
 */
export const historyOf = (events: OrgEvent[]): History => {
  const done: OrgEvent[] = [];
  let redo: OrgEvent[] = [];
  for (const event of events) {
    if (event.kind === 'undo') {
      const undone = done.pop();
      if (undone) redo.push(undone);
    } else if (event.kind === 'redo') {
      const redone = redo.pop();
      if (redone) done.push(redone);
    } else {
      done.push(event);
      redo = [];
    }
  }
  const newest = done.at(-1);
  const off = undoOff(newest);
  const next = redo.at(-1);
  return {
    undo:
      off || !newest ? { off: off ?? 'Nothing to undo.' } : { event: newest },
    redo: !next
      ? { off: NOTHING_TO_REDO }
      : next.payload.redacted
        ? {
            off: 'The change to redo held personal data that was erased. Redo cannot apply it.',
          }
        : { event: next },
  };
};

/** The changes that reverse `changes`: in reverse order, before and after swapped. */
const reverse = (changes: Change[]) =>
  [...changes].reverse().map((change) => ({
    ...change,
    before: change.after,
    after: change.before,
  }));

/**
 * Undo or Redo the newest event of the organisation `orgId`
 * (REQ-CRM-UNDO-002). `expected` is the event number that the page showed
 * the person. When the newest event is a different one now (for example a
 * second tap on the key), it changes nothing. Returns the number of the new
 * event, or null when nothing changed.
 */
export const undoOrRedo = (
  db: Database,
  actor: string,
  orgId: string,
  kind: 'undo' | 'redo',
  expected: number,
) =>
  db.transaction(() => {
    const state = historyOf(listOrgEvents(db, orgId))[kind];
    if (!('event' in state) || state.event.number !== expected) return null;
    const { event } = state;
    const changes = event.payload.changes ?? [];
    return writeEvent(db, actor, orgId, kind, {
      target: event.number,
      changes: kind === 'undo' ? reverse(changes) : changes,
    });
  })();

/**
 * Restore a hidden visit, note or contact of the organisation `orgId`
 * (REQ-CRM-UNDO-003): clear its `hidden_at` with a `restore` event. A row
 * that is not hidden changes nothing, and adds no event, so a second
 * Restore does nothing. Returns the event number, or null.
 */
export const restore = (
  db: Database,
  actor: string,
  orgId: string,
  row: { table: 'visit' | 'note' | 'membership'; id: string },
) =>
  db.transaction(() => {
    const { key } = TABLES[row.table];
    const hidden = db
      .query(
        `SELECT 1 FROM ${row.table}
         WHERE ${key} = ? AND organisation_id = ? AND hidden_at IS NOT NULL;`,
      )
      .get(row.id, orgId);
    if (!hidden) return null;
    return writeEvent(db, actor, orgId, 'restore', {
      ...(row.table === 'membership'
        ? { person_id: row.id }
        : { record_id: row.id }),
      changes: [
        {
          table: row.table,
          id: row.id,
          before: { hidden: true },
          after: { hidden: false },
        },
      ],
    });
  })();
