-- Brief visibility (SEAN-158).
--
-- Replaces the enquiry-as-a-second-object model. A buyer posts a brief and
-- controls who can see it: a PRIVATE brief with one invitee *is* an enquiry, a
-- PUBLIC one is an open tender. One object covers both directions.
--
-- ## Two orthogonal axes
--
-- `visibility` is who may EVER see it. `published_at` is whether they can see
-- it RIGHT NOW. Conflating the two is what made "unpublish" ambiguous:
-- unpublishing must hide the brief without discarding the invitee list, so
-- republishing restores access to exactly the same people. The invitee list is
-- durable state; publication is a switch.
--
-- ## `status` is retired
--
-- It duplicated `published_at`: `draft` was exactly `published_at IS NULL`, and
-- a terminal `closed` cannot express publish/unpublish-at-will. Everything now
-- derives from two timestamps — unpublished is `published_at IS NULL`, closed
-- to bids is `closes_at <= now`. Three behaviours, no enum, and no state that
-- nothing can produce. This is the CLAUDE.md rule that a nullable timestamp
-- beats an enum when there are two real states.
--
-- SQLite cannot drop a column with a CHECK or alter one, so the table is
-- rebuilt — the same technique as 003, which is also why the foreign key from
-- `bids` survives: PRAGMA foreign_keys is per-connection and off here.

CREATE TABLE briefs_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  work_type    TEXT CHECK (work_type IN ('full_home', 'single_room', 'kitchen', 'bathroom', 'extension', 'new_build', 'renovation', 'commercial', 'styling', 'other')),
  budget_band  TEXT CHECK (budget_band IN ('under_10k', '10k_25k', '25k_50k', '50k_100k', '100k_250k', '250k_plus')),
  location     TEXT,
  timeline     TEXT CHECK (timeline IN ('asap', 'within_3_months', 'within_6_months', 'within_12_months', 'exploring')),
  -- Private by default, so a brief can never become public by accident. The
  -- default is the safe answer, not the common one.
  visibility   TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'link', 'private')),
  -- NULL means unpublished: hidden from everyone but its owner, whatever the
  -- visibility says and whoever is on the invitee list.
  published_at DATETIME,
  -- Past means no longer accepting bids. Replaces the old 'closed' status.
  closes_at    DATETIME,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO briefs_new
  SELECT id, buyer_id, slug, title, description, work_type, budget_band,
         location, timeline,
         -- An open tender was public by definition; a draft nobody has seen
         -- becomes private, which is the safer of the two readings.
         CASE status WHEN 'draft' THEN 'private' ELSE 'public' END,
         -- A draft is unpublished by definition, whatever it happened to hold.
         CASE status WHEN 'draft' THEN NULL ELSE published_at END,
         -- A closed brief with no deadline gets one at the moment it was last
         -- touched, which is when it was closed.
         CASE
           WHEN status = 'closed' AND closes_at IS NULL THEN updated_at
           ELSE closes_at
         END,
         created_at, updated_at
    FROM briefs;

DROP TABLE briefs;
ALTER TABLE briefs_new RENAME TO briefs;

CREATE UNIQUE INDEX idx_briefs_slug ON briefs (slug);
CREATE INDEX idx_briefs_buyer_id ON briefs (buyer_id);
CREATE INDEX idx_briefs_work_type ON briefs (work_type);
-- The open board: public, published, newest first, optionally by location.
CREATE INDEX idx_briefs_board ON briefs (visibility, published_at);
CREATE INDEX idx_briefs_board_location ON briefs (visibility, published_at, location);

-- Who may see a private brief. Users, not designers: a buyer may invite their
-- partner or their architect alongside a studio, and the access check must not
-- care which kind of account it is looking at.
--
-- Surviving an unpublish is the whole point of storing this separately from
-- the brief's own state.
CREATE TABLE brief_invitees (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id   INTEGER NOT NULL REFERENCES briefs (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Inviting the same person twice is one invitation, not two.
  UNIQUE (brief_id, user_id)
);

CREATE INDEX idx_brief_invitees_user ON brief_invitees (user_id);

-- `enquiries` is dropped, not kept "for later".
--
-- No code ever read or wrote it, it declared five statuses nothing could set,
-- and a private brief with one invitee replaces it completely. Keeping it would
-- be exactly the speculative state apps/inside/CLAUDE.md warns about: a shape
-- that must be reasoned about, tested around and migrated later, in service of
-- a workflow nobody committed to.
DROP TABLE enquiries;
