-- 001-init: the first crm tables.
-- IDs are text UUIDs. Times are ISO 8601 UTC text. Dates are YYYY-MM-DD text.
-- One deal for each organisation, so the pipeline stage is on the organisation.

CREATE TABLE organisation (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address_line_1 TEXT,
  address_line_2 TEXT,
  postcode TEXT,
  stage TEXT NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead', 'visited', 'follow_up', 'quoted', 'won', 'lost')),
  next_action TEXT,
  next_action_on TEXT,
  lawful_basis TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE person (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE membership (
  person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  PRIMARY KEY (person_id, organisation_id)
);

CREATE INDEX membership_organisation_id ON membership (organisation_id);

CREATE TABLE visit (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('no_answer', 'spoke', 'call_back', 'not_interested', 'do_not_knock')
  ),
  note TEXT
);

CREATE INDEX visit_organisation_id ON visit (organisation_id);

CREATE TABLE note (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX note_organisation_id ON note (organisation_id);

-- entity_id has no foreign key, so the log keeps its rows for deleted records.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT CHECK (detail IS NULL OR json_valid(detail))
);
