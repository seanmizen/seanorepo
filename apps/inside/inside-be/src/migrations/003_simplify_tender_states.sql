-- KISS pass over the tender workflow (SEAN-185).
--
-- The audit found state machines nothing could drive:
--
--   * `pitches.status` declared six values — sent, read, shortlisted,
--     accepted, declined, withdrawn — and NO code set or read a single one.
--     There is only a create route; no transition exists. Worse, `draft`,
--     the one state the product actually wants ("continue the bid you had in
--     draft"), was not among them.
--   * `briefs.status` declared `awarded`, which nothing can produce. Three
--     guard clauses defended against it — defensive code for an impossible
--     condition.
--
-- Speculative states are not free: they are branches that must be reasoned
-- about, tested around and migrated later, all in service of a workflow nobody
-- has committed to. They are replaced here by the smallest set that supports
-- the behaviour we actually want.
--
-- SQLite cannot alter a CHECK constraint, so each table is rebuilt. No data is
-- lost: existing rows are carried across and mapped onto the new values.

-- Briefs: drop the unreachable `awarded`.
CREATE TABLE briefs_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  project_type TEXT CHECK (project_type IN ('full_home', 'single_room', 'kitchen', 'bathroom', 'extension', 'new_build', 'renovation', 'commercial', 'styling', 'other')),
  budget_band  TEXT CHECK (budget_band IN ('under_10k', '10k_25k', '25k_50k', '50k_100k', '100k_250k', '250k_plus')),
  location     TEXT,
  timeline     TEXT CHECK (timeline IN ('asap', 'within_3_months', 'within_6_months', 'within_12_months', 'exploring')),
  -- 'draft' is never listed; 'open' takes bids; 'closed' does not.
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  closes_at    DATETIME,
  published_at DATETIME,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO briefs_new
  SELECT id, buyer_id, title, description, project_type, budget_band, location,
         timeline,
         -- Anything previously awarded is simply closed.
         CASE status WHEN 'awarded' THEN 'closed' ELSE status END,
         closes_at, published_at, created_at, updated_at
    FROM briefs;

DROP TABLE briefs;
ALTER TABLE briefs_new RENAME TO briefs;

CREATE INDEX idx_briefs_buyer_id ON briefs (buyer_id);
CREATE INDEX idx_briefs_status ON briefs (status);
CREATE INDEX idx_briefs_project_type ON briefs (project_type);
CREATE INDEX idx_briefs_status_created_at ON briefs (status, created_at);
CREATE INDEX idx_briefs_status_location ON briefs (status, location);

-- Pitches: a bid is being written, or it has been sent, or it was taken back.
-- `read_at` goes too: nothing set it, and read-receipts are a product decision
-- nobody has made.
CREATE TABLE pitches_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id            INTEGER NOT NULL REFERENCES briefs (id) ON DELETE CASCADE,
  designer_profile_id INTEGER NOT NULL REFERENCES designer_profiles (id) ON DELETE CASCADE,
  message             TEXT NOT NULL,
  budget_band         TEXT CHECK (budget_band IN ('under_10k', '10k_25k', '25k_50k', '50k_100k', '100k_250k', '250k_plus')),
  availability        TEXT CHECK (availability IN ('asap', 'within_3_months', 'within_6_months', 'within_12_months')),
  -- Started but not sent; sent; taken back. Nothing else has a behaviour yet.
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'withdrawn')),
  submitted_at        DATETIME,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brief_id, designer_profile_id)
);

INSERT INTO pitches_new
  SELECT id, brief_id, designer_profile_id, message, budget_band, availability,
         -- Everything that existed had been sent; only 'withdrawn' survives as
         -- itself. The rest collapse to 'submitted'.
         CASE status WHEN 'withdrawn' THEN 'withdrawn' ELSE 'submitted' END,
         created_at,
         created_at, updated_at
    FROM pitches;

DROP TABLE pitches;
ALTER TABLE pitches_new RENAME TO pitches;

CREATE INDEX idx_pitches_brief_id ON pitches (brief_id);
CREATE INDEX idx_pitches_designer_profile_id ON pitches (designer_profile_id);
CREATE INDEX idx_pitches_status ON pitches (status);
