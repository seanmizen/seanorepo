-- 005-events: the history of each organisation, and records that hide in
-- place of a delete (REQ-CRM-UNDO-001).
--
-- org_event has one row for each change to an organisation. The crm only
-- appends rows: Undo, Redo and Restore append rows too, and change no row.
-- A visit, a note or a contact (a membership) that an Undo or a Remove takes
-- away gets hidden_at and hidden_by (the number of that event). The row
-- stays in the database and in the backups.
--
-- payload is a JSON object:
-- - The display fields, with no personal data: the same fields as the
--   detail of an audit_log row (fields, from, stage, ...), and the ids of
--   the visit or note (record_id) and of the person (person_id).
-- - changes: the values before and after each row that the event changed.
--   Undo writes the before values, and Redo writes the after values. An
--   event with no changes cannot be undone. The values can be personal
--   data, for example an old phone number.
--
-- This migration fills org_event from the old history of each
-- organisation, in time order: the organisation row, the visits, the notes
-- and the audit_log rows of the organisation. Only the old visits and
-- notes get changes, because audit_log kept no values. The old rows have
-- "migrated": true.

ALTER TABLE visit ADD COLUMN hidden_at TEXT;
ALTER TABLE visit ADD COLUMN hidden_by INTEGER;
ALTER TABLE note ADD COLUMN hidden_at TEXT;
ALTER TABLE note ADD COLUMN hidden_by INTEGER;
ALTER TABLE membership ADD COLUMN hidden_at TEXT;
ALTER TABLE membership ADD COLUMN hidden_by INTEGER;

-- number is the event number in the organisation, counted from 1
-- (REQ-CRM-ID-001). No code deletes a row of an organisation that exists,
-- so the next number is the last number + 1, and a number is never used
-- again. actor is a person id.
CREATE TABLE org_event (
  organisation_id TEXT NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'create', 'visit', 'note', 'stage', 'next_action', 'details',
    'contact_add', 'contact_edit', 'contact_remove', 'activity_edit',
    'undo', 'redo', 'restore'
  )),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (organisation_id, number)
);

-- The old history. rank orders the rows with the same time: the
-- organisation first, then a visit or a note, then a change that it caused
-- (the outcome do_not_knock sets the stage).
CREATE TEMP TABLE old_event AS
  SELECT o.id AS organisation_id, o.created_at AS at,
         coalesce((SELECT a.actor FROM audit_log AS a
                    WHERE a.action = 'create' AND a.entity = 'organisation'
                      AND a.entity_id = o.id), 'migration') AS actor,
         'create' AS kind,
         json_object('stage', 'lead', 'migrated', json('true')) AS payload,
         0 AS rank, o.rowid AS seq
    FROM organisation AS o
  UNION ALL
  SELECT v.organisation_id, v.at,
         coalesce((SELECT a.actor FROM audit_log AS a
                    WHERE a.action = 'create' AND a.entity_id = v.id), 'migration'),
         'visit',
         json_object(
           'record_id', v.id, 'migrated', json('true'),
           'changes', json_array(json_object(
             'table', 'visit', 'id', v.id,
             'before', json_object('hidden', json('true')),
             'after', json_object('hidden', json('false'))))),
         1, v.rowid
    FROM visit AS v
  UNION ALL
  SELECT n.organisation_id, n.created_at,
         coalesce((SELECT a.actor FROM audit_log AS a
                    WHERE a.action = 'create' AND a.entity_id = n.id), 'migration'),
         'note',
         json_object(
           'record_id', n.id, 'migrated', json('true'),
           'changes', json_array(json_object(
             'table', 'note', 'id', n.id,
             'before', json_object('hidden', json('true')),
             'after', json_object('hidden', json('false'))))),
         1, n.rowid
    FROM note AS n
  UNION ALL
  SELECT org_id, at, actor,
         CASE
           WHEN pair IN ('create membership') THEN 'contact_add'
           WHEN pair IN ('update person', 'update membership') THEN 'contact_edit'
           WHEN pair = 'delete membership' THEN 'contact_remove'
           WHEN pair IN ('update visit', 'update note') THEN 'activity_edit'
           WHEN EXISTS (SELECT 1 FROM json_each(detail, '$.fields') WHERE value = 'stage')
             OR (json_type(detail, '$.fields') IS NULL
                 AND json_extract(detail, '$.stage') IS NOT NULL) THEN 'stage'
           WHEN EXISTS (SELECT 1 FROM json_each(detail, '$.fields')
                         WHERE value IN ('next_action', 'next_action_on'))
             OR json_type(detail, '$.fields') IS NULL THEN 'next_action'
           ELSE 'details'
         END,
         -- json_patch adds no key whose value is null.
         json_patch(detail, json_object(
           'migrated', json('true'),
           'record_id', CASE WHEN entity IN ('visit', 'note') THEN entity_id END,
           'person_id', coalesce(json_extract(detail, '$.person_id'),
                                 CASE WHEN entity = 'person' THEN entity_id END))),
         2, seq
    FROM (
      SELECT CASE WHEN a.entity IN ('organisation', 'membership') THEN a.entity_id
                  ELSE json_extract(a.detail, '$.organisation_id') END AS org_id,
             a.at, a.actor, a.action || ' ' || a.entity AS pair, a.entity,
             a.entity_id, coalesce(a.detail, '{}') AS detail, a.rowid AS seq
        FROM audit_log AS a
       WHERE a.action || ' ' || a.entity IN (
               'update organisation', 'create membership', 'update person',
               'update membership', 'delete membership', 'update visit',
               'update note')
    )
   WHERE org_id IN (SELECT id FROM organisation);

INSERT INTO org_event (organisation_id, number, at, actor, kind, payload)
  SELECT organisation_id,
         row_number() OVER (PARTITION BY organisation_id ORDER BY at, rank, seq),
         at, actor, kind, payload
    FROM old_event;

DROP TABLE old_event;
