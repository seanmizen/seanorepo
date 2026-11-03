import type { Database } from 'bun:sqlite';
import { audit } from './auth';
import { NOTE_ONLY } from './forms/activity';
import type { FormValues } from './forms/form';
import { type Org, type Outcome, setPipeline } from './org';

/**
 * The activity of an organisation: its visits and its notes, in one list.
 * The routes `routes/orgs/[slug]/activity.ts`,
 * `routes/orgs/[slug]/activity/[id].tsx` and the organisation page call
 * these functions.
 *
 * A visit is a row of `visit`, and a note is a row of `note`. The Log
 * module (`forms/activity.ts`) makes both.
 */
export interface Activity {
  kind: 'visit' | 'note';
  id: string;
  /** The time of the visit, or the time that the note was added. */
  at: string;
  /** The outcome of a visit. A note has none. */
  outcome: Outcome | null;
  /** The note of a visit, or the text of a note. */
  note: string | null;
}

const ACTIVITY_SQL = `
  SELECT 'visit' AS kind, id, at, outcome, note, rowid AS seq
    FROM visit WHERE organisation_id = ?1
  UNION ALL
  SELECT 'note', id, created_at, NULL, body, rowid
    FROM note WHERE organisation_id = ?1`;

/**
 * One line of the Activity list of an organisation.
 *
 * - `visit` and `note`: a visit or a note, from its table, with its text.
 * - `change`: a row of `audit_log` about the organisation, its contacts or
 *   its visits and notes. The row that made a visit or a note does not
 *   show, because the visit or the note shows. `audit_log` keeps no
 *   personal data, so the names come from the current tables.
 */
export interface Event {
  kind: 'visit' | 'note' | 'change';
  /** The id of the visit or the note, or of the audit row. */
  id: string;
  at: string;
  /** A visit: its outcome. */
  outcome: Outcome | null;
  /** A visit: its note. A note: its text. */
  note: string | null;
  /** A change: the `action`, `entity` and JSON `detail` of the audit row. */
  action: string | null;
  entity: string | null;
  detail: string | null;
  /**
   * A change to a contact: the current name of the person. Null when the
   * person is not in the crm now.
   */
  person: string | null;
  /**
   * A change to a visit or a note: its time. Null when it is not in the
   * crm now.
   */
  record_at: string | null;
}

/**
 * Every event of an organisation, newest first: its visits, its notes and
 * the changes in `audit_log`. When a change and a visit have the same
 * time, the change comes first, because a visit can cause a change (the
 * outcome `do_not_knock` sets the stage).
 */
export const listEvents = (db: Database, orgId: string) =>
  db
    .query<Event, [string]>(
      `SELECT kind, id, at, outcome, note, action, entity, detail, person, record_at FROM (
         SELECT 'visit' AS kind, id, at, outcome, note, NULL AS action, NULL AS entity,
                NULL AS detail, NULL AS person, NULL AS record_at, 1 AS rank, rowid AS seq
           FROM visit WHERE organisation_id = ?1
         UNION ALL
         SELECT 'note', id, created_at, NULL, body, NULL, NULL, NULL, NULL, NULL, 1, rowid
           FROM note WHERE organisation_id = ?1
         UNION ALL
         SELECT 'change', a.id, a.at, NULL, NULL, a.action, a.entity, a.detail,
                p.name, COALESCE(v.at, n.created_at), 0, a.rowid
           FROM audit_log AS a
           LEFT JOIN person AS p ON p.id = CASE a.entity
             WHEN 'person' THEN a.entity_id
             WHEN 'membership' THEN json_extract(a.detail, '$.person_id') END
           LEFT JOIN visit AS v ON a.entity IN ('visit', 'note') AND v.id = a.entity_id
           LEFT JOIN note AS n ON a.entity IN ('visit', 'note') AND n.id = a.entity_id
           WHERE (a.entity_id = ?1 OR json_extract(a.detail, '$.organisation_id') = ?1)
             AND NOT (a.action IN ('create', 'delete')
                      AND a.entity IN ('visit', 'note', 'person'))
       )
       ORDER BY at DESC, rank, seq DESC;`,
    )
    .all(orgId);

/** The visit or the note `id` of an organisation, or null. */
export const findActivity = (db: Database, orgId: string, id: string) =>
  db
    .query<Activity, [string, string]>(
      `SELECT kind, id, at, outcome, note FROM (${ACTIVITY_SQL}) WHERE id = ?2;`,
    )
    .get(orgId, id);

/**
 * The outcome `do_not_knock` sets the stage to lost and clears the next
 * action, so the organisation is not due again.
 */
const setLost = (db: Database, actor: string, org: Org) =>
  setPipeline(db, actor, org, {
    stage: 'lost',
    next_action: null,
    next_action_on: null,
  });

/**
 * Add a visit or a note to `org`, from the values of the Log module, with
 * an audit row. The audit row never copies the text: it is relationship
 * data.
 */
export const logActivity = (
  db: Database,
  actor: string,
  org: Org,
  values: FormValues,
) =>
  db.transaction(() => {
    const id = crypto.randomUUID();
    if (values.outcome === NOTE_ONLY) {
      db.query(
        'INSERT INTO note (id, organisation_id, body) VALUES (?, ?, ?);',
      ).run(id, org.id, values.note);
      audit(db, actor, 'create', 'note', id, { organisation_id: org.id });
      return;
    }
    db.query(
      'INSERT INTO visit (id, organisation_id, outcome, note) VALUES (?, ?, ?, ?);',
    ).run(id, org.id, values.outcome, values.note || null);
    audit(db, actor, 'create', 'visit', id, {
      organisation_id: org.id,
      outcome: values.outcome,
    });
    if (values.outcome === 'do_not_knock') setLost(db, actor, org);
  })();

/**
 * Save the Log module of the edit page over `current`. A different key
 * changes the outcome, or changes a visit to a note, or a note to a visit.
 * The record keeps its id and its time. The audit row has the names of the
 * changed fields.
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
    const fields = [
      ...(outcome !== current.outcome ? ['outcome'] : []),
      ...((current.note ?? '') !== values.note ? ['note'] : []),
    ];
    if (fields.length === 0) return;
    if (kind !== current.kind) {
      db.query(`DELETE FROM ${current.kind} WHERE id = ?;`).run(current.id);
    }
    if (kind === 'note') {
      db.query(
        `INSERT INTO note (id, organisation_id, body, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (id) DO UPDATE SET body = ?3;`,
      ).run(current.id, org.id, values.note, current.at);
    } else {
      db.query(
        `INSERT INTO visit (id, organisation_id, at, outcome, note) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (id) DO UPDATE SET outcome = ?4, note = ?5;`,
      ).run(current.id, org.id, current.at, outcome, values.note || null);
    }
    audit(db, actor, 'update', kind, current.id, {
      organisation_id: org.id,
      fields,
      saved_as: values.outcome,
      ...(kind !== current.kind ? { was: current.kind } : {}),
    });
    if (outcome === 'do_not_knock' && current.outcome !== 'do_not_knock') {
      setLost(db, actor, org);
    }
  })();
