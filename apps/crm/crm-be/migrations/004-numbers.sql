-- 004-numbers: the short number of each contact and each activity entry of
-- an organisation (REQ-CRM-ID-001). A URL and a page show the number, never
-- a UUID. The UUIDs stay the primary keys and the foreign keys.
--
-- Each organisation counts from 1 for each kind of record. A visit and a
-- note are both activity, so they share one counter: an edit can change a
-- visit to a note, and the entry keeps its number. A number is never used
-- again: org_counter keeps the last number given, also after a delete.
--
-- SQLite cannot add a NOT NULL column with no default, so this migration
-- makes the three tables again with the number. The existing rows get numbers in creation
-- order: a contact by the order of its membership row, an activity entry by
-- its time.

CREATE TABLE org_counter (
  organisation_id TEXT NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('contact', 'activity')),
  last INTEGER NOT NULL CHECK (last > 0),
  PRIMARY KEY (organisation_id, kind)
);

-- The contact number is on the membership: a person who is a contact of two
-- organisations has a number in each.
CREATE TABLE membership_new (
  person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  number INTEGER NOT NULL CHECK (number > 0),
  PRIMARY KEY (person_id, organisation_id),
  UNIQUE (organisation_id, number)
);

INSERT INTO membership_new (person_id, organisation_id, role, number)
  SELECT person_id, organisation_id, role,
         row_number() OVER (PARTITION BY organisation_id ORDER BY rowid)
    FROM membership;

DROP TABLE membership;
ALTER TABLE membership_new RENAME TO membership;

-- The visits and the notes of each organisation, in one list by time.
CREATE TEMP TABLE activity_number AS
  SELECT id, row_number() OVER (
           PARTITION BY organisation_id ORDER BY at, kind DESC, seq
         ) AS number
    FROM (
      SELECT 'visit' AS kind, id, organisation_id, at, rowid AS seq FROM visit
      UNION ALL
      SELECT 'note', id, organisation_id, created_at, rowid FROM note
    );

CREATE TABLE visit_new (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('no_answer', 'spoke', 'call_back', 'not_interested', 'do_not_knock')
  ),
  note TEXT,
  UNIQUE (organisation_id, number)
);

INSERT INTO visit_new (id, organisation_id, number, at, outcome, note)
  SELECT visit.id, organisation_id, activity_number.number, at, outcome, note
    FROM visit JOIN activity_number ON activity_number.id = visit.id
   ORDER BY visit.rowid;

DROP TABLE visit;
ALTER TABLE visit_new RENAME TO visit;

CREATE TABLE note_new (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organisation_id, number)
);

INSERT INTO note_new (id, organisation_id, number, body, created_at)
  SELECT note.id, organisation_id, activity_number.number, body, created_at
    FROM note JOIN activity_number ON activity_number.id = note.id
   ORDER BY note.rowid;

DROP TABLE note;
ALTER TABLE note_new RENAME TO note;

DROP TABLE activity_number;

-- The counters start at the last number of each organisation.
INSERT INTO org_counter (organisation_id, kind, last)
  SELECT organisation_id, 'contact', max(number)
    FROM membership GROUP BY organisation_id;

INSERT INTO org_counter (organisation_id, kind, last)
  SELECT organisation_id, 'activity', max(number)
    FROM (
      SELECT organisation_id, number FROM visit
      UNION ALL
      SELECT organisation_id, number FROM note
    )
   GROUP BY organisation_id;
