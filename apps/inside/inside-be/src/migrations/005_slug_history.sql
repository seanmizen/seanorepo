-- Slug history (SEAN-192).
--
-- Slugs are public, shared and indexed, so they have to change without breaking
-- every link already pointing at them. The rule: A SLUG, ONCE ISSUED, IS
-- PERMANENT. It stays in this table forever, bound to the entity that first
-- claimed it, and every later visit resolves it to that entity's CURRENT slug.
-- One brief may accumulate twenty slugs over a messy edit history; all twenty
-- keep working, and all twenty resolve to the newest.
--
-- The entity row KEEPS its own `slug` column as the pointer to the active slug.
-- That is deliberate: every existing query keeps working unchanged, and there
-- is exactly one place to look for "what is this thing called now". This table
-- is the full history, the active slug included.
--
-- Uniqueness is per entity TYPE, not global. `/designers/oak` and `/briefs/oak`
-- are different namespaces and may coexist. What must never happen is one
-- entity claiming a slug another entity of the same type has ever held — that
-- would silently send people to the wrong studio, which is worse than a 404
-- because nothing looks broken.

CREATE TABLE slugs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('designer_profile', 'portfolio_project', 'brief')),
  entity_id   INTEGER NOT NULL,
  slug        TEXT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The permanence rule, enforced rather than intended.
  UNIQUE (entity_type, slug)
);

-- Resolution reads by (type, slug) — covered by the UNIQUE above. This index
-- serves the other direction: every slug an entity has ever held.
CREATE INDEX idx_slugs_entity ON slugs (entity_type, entity_id);

-- Backfill: every slug in use today becomes the first entry of its own history,
-- so there is no "before history started" gap to special-case in the resolver.
INSERT INTO slugs (entity_type, entity_id, slug)
  SELECT 'designer_profile', id, slug FROM designer_profiles;

INSERT INTO slugs (entity_type, entity_id, slug)
  SELECT 'portfolio_project', id, slug FROM portfolio_projects;

-- Briefs had no slug: they were addressed by sequential integer id. #158 cannot
-- build link-only visibility on that, because /briefs/3 is readable by anyone
-- counting upwards.
--
-- NOT NULL needs a default in SQLite's ALTER TABLE. The empty string is that
-- default rather than a plausible-looking placeholder: it is backfilled away
-- immediately below, and the unique index means a second row that ever forgets
-- to set a slug fails loudly instead of quietly sharing one.
ALTER TABLE briefs ADD COLUMN slug TEXT NOT NULL DEFAULT '';

-- Existing briefs are demo and test data. No brief UI exists, so no link to one
-- has ever been shared, and there is nothing to preserve. An id-derived slug is
-- honest about that rather than inventing a pretty one; the seed regenerates
-- its own from titles on the next run.
UPDATE briefs SET slug = 'brief-' || id WHERE slug = '';

INSERT INTO slugs (entity_type, entity_id, slug)
  SELECT 'brief', id, slug FROM briefs;

CREATE UNIQUE INDEX idx_briefs_slug ON briefs (slug);
