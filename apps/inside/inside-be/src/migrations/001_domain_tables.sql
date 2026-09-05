-- Domain tables for the `inside` marketplace.
--
-- Additive on top of 000_initial_schema.sql; that baseline is never edited.
--
-- NAMING WARNING — "project" is overloaded in this domain. Three distinct things:
--   `projects` a designer's COMPLETED work, shown in their portfolio
--   `briefs`   a homeowner's POSTED job, which designers pitch on
--   `pitches`  a designer's RESPONSE to a brief
-- Do not conflate them.

-- The sellable designer. One row per `users` row with role 'designer'.
--
-- APPROVAL GATE: `status` defaults to 'draft', so a freshly created profile is
-- never publicly visible. Discovery only ever selects status = 'approved'.
-- `slug` is the public, SEO-facing URL segment: /designers/:slug.
CREATE TABLE designer_profiles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  slug           TEXT NOT NULL UNIQUE,
  studio_name    TEXT NOT NULL,
  headline       TEXT,
  bio            TEXT,
  location       TEXT,
  website_url    TEXT,
  instagram_url  TEXT,
  -- Bands, not numbers — designers quote ranges, not prices.
  budget_band    TEXT CHECK (budget_band IN ('under_10k', '10k_25k', '25k_50k', '50k_100k', '100k_250k', '250k_plus')),
  cover_image_id INTEGER REFERENCES images (id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  -- Stamped by an admin when status moves to 'approved' or 'rejected'.
  reviewed_at    DATETIME,
  reviewed_by    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  review_note    TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_designer_profiles_user_id ON designer_profiles (user_id);
CREATE INDEX idx_designer_profiles_slug ON designer_profiles (slug);
CREATE INDEX idx_designer_profiles_cover_image_id ON designer_profiles (cover_image_id);
CREATE INDEX idx_designer_profiles_reviewed_by ON designer_profiles (reviewed_by);
-- Discovery: the approved list, filtered by location, newest first.
CREATE INDEX idx_designer_profiles_status ON designer_profiles (status);
CREATE INDEX idx_designer_profiles_status_location ON designer_profiles (status, location);
CREATE INDEX idx_designer_profiles_status_created_at ON designer_profiles (status, created_at);

-- PORTFOLIO PIECES. A designer's completed work — NOT a homeowner's job (see `briefs`).
-- `slug` is unique site-wide so a project has a stable canonical URL.
CREATE TABLE projects (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  designer_profile_id INTEGER NOT NULL REFERENCES designer_profiles (id) ON DELETE CASCADE,
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  summary             TEXT,
  description         TEXT,
  location            TEXT,
  project_type        TEXT CHECK (project_type IN ('full_home', 'single_room', 'kitchen', 'bathroom', 'extension', 'new_build', 'renovation', 'commercial', 'styling', 'other')),
  budget_band         TEXT CHECK (budget_band IN ('under_10k', '10k_25k', '25k_50k', '50k_100k', '100k_250k', '250k_plus')),
  completed_year      INTEGER,
  cover_image_id      INTEGER REFERENCES images (id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  -- Curatorial order within the designer's portfolio; lower sorts first.
  display_order       INTEGER NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_projects_designer_profile_id ON projects (designer_profile_id);
CREATE INDEX idx_projects_slug ON projects (slug);
CREATE INDEX idx_projects_cover_image_id ON projects (cover_image_id);
CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_project_type ON projects (project_type);
-- Rendering one portfolio: the designer's published pieces in curated order.
CREATE INDEX idx_projects_designer_status_order ON projects (designer_profile_id, status, display_order);

-- Images attached to a portfolio project, in an explicit curatorial sequence.
-- `display_order` is authoritative — insertion order is not a design decision.
CREATE TABLE project_images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  image_id      INTEGER NOT NULL REFERENCES images (id) ON DELETE CASCADE,
  caption       TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, image_id)
);

CREATE INDEX idx_project_images_project_id ON project_images (project_id);
CREATE INDEX idx_project_images_image_id ON project_images (image_id);
CREATE INDEX idx_project_images_project_order ON project_images (project_id, display_order);

-- A buyer's shortlist. Powers the "sign up to save this designer" CTA, which is
-- the main reason an anonymous browser ever creates an account.
-- The unique pair makes saving idempotent.
CREATE TABLE saved_designers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  designer_profile_id INTEGER NOT NULL REFERENCES designer_profiles (id) ON DELETE CASCADE,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, designer_profile_id)
);

CREATE INDEX idx_saved_designers_user_id ON saved_designers (user_id);
CREATE INDEX idx_saved_designers_designer_profile_id ON saved_designers (designer_profile_id);

-- Buyer -> designer, direct. One of the two connection directions; the other is
-- post-a-project (`briefs` + `pitches`).
--
-- THREADING: an enquiry is the ROOT of an in-app thread. Replies will land in a
-- future `enquiry_messages` table keyed on `enquiries.id`; the opening message
-- lives here so a zero-reply enquiry is still a complete record. Nothing on this
-- table needs reshaping when threading ships.
--
-- `buyer_id` is SET NULL rather than CASCADE: the designer keeps the enquiry in
-- their inbox even if the sender deletes their account. Contact details are
-- snapshotted on the row for exactly that reason.
CREATE TABLE enquiries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id            INTEGER REFERENCES users (id) ON DELETE SET NULL,
  designer_profile_id INTEGER NOT NULL REFERENCES designer_profiles (id) ON DELETE CASCADE,
  -- Snapshot of who sent it, so the record survives the account.
  contact_name        TEXT NOT NULL,
  contact_email       TEXT NOT NULL,
  contact_phone       TEXT,
  -- What a homeowner actually briefs on.
  project_type        TEXT CHECK (project_type IN ('full_home', 'single_room', 'kitchen', 'bathroom', 'extension', 'new_build', 'renovation', 'commercial', 'styling', 'other')),
  budget_band         TEXT CHECK (budget_band IN ('under_10k', '10k_25k', '25k_50k', '50k_100k', '100k_250k', '250k_plus')),
  location            TEXT,
  timeline            TEXT CHECK (timeline IN ('asap', 'within_3_months', 'within_6_months', 'within_12_months', 'exploring')),
  message             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'archived', 'declined')),
  -- Stamped when the designer first opens it; drives the unread badge.
  read_at             DATETIME,
  -- Denormalised so an inbox can sort by thread activity without a join.
  last_message_at     DATETIME,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_enquiries_buyer_id ON enquiries (buyer_id);
CREATE INDEX idx_enquiries_designer_profile_id ON enquiries (designer_profile_id);
CREATE INDEX idx_enquiries_status ON enquiries (status);
-- The designer's inbox: their enquiries, by status, newest first.
CREATE INDEX idx_enquiries_designer_status_created_at ON enquiries (designer_profile_id, status, created_at);

-- POST-A-PROJECT. A homeowner's public listing that designers pitch on —
-- NOT a portfolio piece (see `projects`).
--
-- `buyer_id` is SET NULL so an open brief with live pitches outlives a deleted
-- account rather than vanishing from under the designers who responded.
CREATE TABLE briefs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  project_type TEXT CHECK (project_type IN ('full_home', 'single_room', 'kitchen', 'bathroom', 'extension', 'new_build', 'renovation', 'commercial', 'styling', 'other')),
  budget_band  TEXT CHECK (budget_band IN ('under_10k', '10k_25k', '25k_50k', '50k_100k', '100k_250k', '250k_plus')),
  location     TEXT,
  timeline     TEXT CHECK (timeline IN ('asap', 'within_3_months', 'within_6_months', 'within_12_months', 'exploring')),
  -- 'draft' is never listed; 'open' takes pitches; 'closed' and 'awarded' do not.
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'awarded')),
  -- Optional soft deadline after which the listing stops accepting pitches.
  closes_at    DATETIME,
  published_at DATETIME,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_briefs_buyer_id ON briefs (buyer_id);
CREATE INDEX idx_briefs_status ON briefs (status);
CREATE INDEX idx_briefs_project_type ON briefs (project_type);
-- Discovery: the open board, newest first, optionally narrowed by location.
CREATE INDEX idx_briefs_status_created_at ON briefs (status, created_at);
CREATE INDEX idx_briefs_status_location ON briefs (status, location);

-- A designer's response to a brief. One pitch per designer per brief.
CREATE TABLE pitches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id            INTEGER NOT NULL REFERENCES briefs (id) ON DELETE CASCADE,
  designer_profile_id INTEGER NOT NULL REFERENCES designer_profiles (id) ON DELETE CASCADE,
  message             TEXT NOT NULL,
  -- The designer's own read of the budget, which may differ from the brief's.
  budget_band         TEXT CHECK (budget_band IN ('under_10k', '10k_25k', '25k_50k', '50k_100k', '100k_250k', '250k_plus')),
  availability        TEXT CHECK (availability IN ('asap', 'within_3_months', 'within_6_months', 'within_12_months')),
  status              TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'read', 'shortlisted', 'accepted', 'declined', 'withdrawn')),
  read_at             DATETIME,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brief_id, designer_profile_id)
);

CREATE INDEX idx_pitches_brief_id ON pitches (brief_id);
CREATE INDEX idx_pitches_designer_profile_id ON pitches (designer_profile_id);
CREATE INDEX idx_pitches_status ON pitches (status);
-- The buyer reviewing one brief's responses, newest first.
CREATE INDEX idx_pitches_brief_status_created_at ON pitches (brief_id, status, created_at);
