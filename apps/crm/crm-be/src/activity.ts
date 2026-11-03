import type { Database } from 'bun:sqlite';
import { type Change, type Payload, writeEvent } from './events';
import { NOTE_ONLY } from './forms/activity';
import type { FormValues } from './forms/form';
import { nextNumber, type Org, type Outcome, pipelineChange } from './org';

/**
 * The activity of an organisation: its visits and its notes. The routes
 * `routes/orgs/[slug]/activity.ts`, `routes/orgs/[slug]/activity/[number].tsx`
 * and the organisation page call these functions.
 *
 * A visit is a row of `visit`, and a note is a row of `note`. The Log
 * module (`forms/activity.ts`) makes both. An entry (a visit or a note) has
 * one id and one number in both tables, so an edit can change a visit to a
 * note and back. Only one row of an entry is visible: the other one, if it
 * exists, has `hidden_at`. Each write is one event (`writeEvent` in
 * `events.ts`), and no write deletes a row (REQ-CRM-UNDO-001).
 */
export interface Activity {
  kind: 'visit' | 'note';
  id: string;
  /**
   * The activity number in the organisation. A visit and a note share one
   * counter. The URL and the page show it (REQ-CRM-ID-001).
   */
  number: number;
  /** The time of the visit, or the time that the note was added. */
  at: string;
  /** The outcome of a visit. A note has none. */
  outcome: Outcome | null;
  /** The note of a visit, or the text of a note. */
  note: string | null;
  /** The time that an Undo or a Remove hid it, or null when it shows. */
  hidden_at: string | null;
  /** The event that hid it. */
  hidden_by: number | null;
}

const ACTIVITY_SQL = `
  SELECT 'visit' AS kind, id, number, at, outcome, note, hidden_at, hidden_by
    FROM visit WHERE organisation_id = ?1
  UNION ALL
  SELECT 'note', id, number, created_at, NULL, body, hidden_at, hidden_by
    FROM note WHERE organisation_id = ?1`;

/**
 * Each entry of an organisation, by id: the visible row, or the row that
 * was hidden last when no row of the entry is visible.
 */
export const listEntries = (db: Database, orgId: string) => {
  const entries = new Map<string, Activity>();
  const rows = db
    .query<Activity, [string]>(
      `SELECT * FROM (${ACTIVITY_SQL})
       ORDER BY hidden_at IS NULL, coalesce(hidden_by, 0);`,
    )
    .all(orgId);
  // The visible row comes last, and then the row hidden last.
  for (const row of rows) entries.set(row.id, row);
  return entries;
};

/** The visible visit or note with `number` of an organisation, or null. */
export const findActivity = (db: Database, orgId: string, number: number) =>
  db
    .query<Activity, [string, number]>(
      `SELECT * FROM (${ACTIVITY_SQL}) WHERE number = ?2 AND hidden_at IS NULL;`,
    )
    .get(orgId, number);

/**
 * The hidden entry with `number` of an organisation, which Restore can
 * show again: the row that was hidden last. Null when the entry has a
 * visible row, so a second Restore does nothing (REQ-CRM-UNDO-003).
 */
export const findHiddenActivity = (
  db: Database,
  orgId: string,
  number: number,
) => {
  if (findActivity(db, orgId, number)) return null;
  return db
    .query<Activity, [string, number]>(
      `SELECT * FROM (${ACTIVITY_SQL}) WHERE number = ?2
       ORDER BY hidden_by DESC LIMIT 1;`,
    )
    .get(orgId, number);
};

/**
 * The outcome `do_not_knock` sets the stage to lost and clears the next
 * action, so the organisation is not due again. Returns the change and
 * the display fields, or null when the pipeline is lost already.
 */
const lostChange = (org: Org) =>
  pipelineChange(org, {
    stage: 'lost',
    next_action: null,
    next_action_on: null,
  });

/**
 * Add a visit or a note to `org`, from the values of the Log module, with
 * the next activity number, as one event. The display fields of the event
 * never copy the text: it is relationship data.
 */
export const logActivity = (
  db: Database,
  actor: string,
  org: Org,
  values: FormValues,
) =>
  db.transaction(() => {
    const id = crypto.randomUUID();
    const number = nextNumber(db, org.id, 'activity');
    if (values.outcome === NOTE_ONLY) {
      db.query(
        'INSERT INTO note (id, organisation_id, number, body) VALUES (?, ?, ?, ?);',
      ).run(id, org.id, number, values.note);
      writeEvent(db, actor, org.id, 'note', {
        record_id: id,
        changes: [
          {
            table: 'note',
            id,
            before: { hidden: true },
            after: { hidden: false },
          },
        ],
      });
      return;
    }
    db.query(
      'INSERT INTO visit (id, organisation_id, number, outcome, note) VALUES (?, ?, ?, ?, ?);',
    ).run(id, org.id, number, values.outcome, values.note || null);
    const lost = values.outcome === 'do_not_knock' ? lostChange(org) : null;
    writeEvent(db, actor, org.id, 'visit', {
      record_id: id,
      outcome: values.outcome,
      ...(lost ? { pipeline: lost.detail } : {}),
      changes: [
        {
          table: 'visit',
          id,
          before: { hidden: true },
          after: { hidden: false },
        },
        ...(lost ? [lost.change] : []),
      ],
    });
  })();

/**
 * Save the Log module of the edit page over `current`, as one event. A
 * different key changes the outcome, or changes a visit to a note, or a
 * note to a visit. The entry keeps its id, its number and its time. A
 * change of type hides the row of the old type, and shows the row of the
 * new type: it adds that row the first time. The display fields of the
 * event have the names of the changed fields.
 */
export const saveActivity = (
  db: Database,
  actor: string,
  org: Org,
  current: Activity,
  values: FormValues,
) =>
  db.transaction(() => {
    const kind = values.outcome === NOTE_ONLY ? 'note' : 'visit';
    const outcome = kind === 'visit' ? values.outcome : null;
    const note = kind === 'visit' ? values.note || null : values.note;
    const fields = [
      ...(outcome !== current.outcome ? ['outcome'] : []),
      ...((current.note ?? '') !== values.note ? ['note'] : []),
    ];
    if (fields.length === 0) return;
    const after: Record<string, string | null> =
      kind === 'visit' ? { outcome, note } : { body: note };
    const changes: Change[] = [];
    if (kind === current.kind) {
      const before: Record<string, string | null> =
        kind === 'visit'
          ? { outcome: current.outcome, note: current.note }
          : { body: current.note };
      changes.push({ table: kind, id: current.id, before, after });
    } else {
      // The row of the new type: hidden, with the values that it had last.
      if (kind === 'note') {
        db.query(
          `INSERT INTO note (id, organisation_id, number, body, created_at, hidden_at)
           VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT (id) DO NOTHING;`,
        ).run(current.id, org.id, current.number, values.note, current.at);
      } else {
        db.query(
          `INSERT INTO visit (id, organisation_id, number, at, outcome, note, hidden_at)
           VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT (id) DO NOTHING;`,
        ).run(current.id, org.id, current.number, current.at, outcome, note);
      }
      const old = db
        .query<Record<string, string | null>, [string]>(
          kind === 'note'
            ? 'SELECT body FROM note WHERE id = ?;'
            : 'SELECT outcome, note FROM visit WHERE id = ?;',
        )
        .get(current.id);
      changes.push(
        {
          table: current.kind,
          id: current.id,
          before: { hidden: false },
          after: { hidden: true },
        },
        {
          table: kind,
          id: current.id,
          before: { hidden: true, ...old },
          after: { hidden: false, ...after },
        },
      );
    }
    const lost =
      outcome === 'do_not_knock' && current.outcome !== 'do_not_knock'
        ? lostChange(org)
        : null;
    const payload: Payload = {
      record_id: current.id,
      fields,
      saved_as: values.outcome,
      ...(kind !== current.kind ? { was: current.kind } : {}),
      ...(lost ? { pipeline: lost.detail } : {}),
      changes: [...changes, ...(lost ? [lost.change] : [])],
    };
    writeEvent(db, actor, org.id, 'activity_edit', payload);
  })();
