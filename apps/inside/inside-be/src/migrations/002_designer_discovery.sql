-- Discovery: the public, anonymous-facing read side of the marketplace.
--
-- Additive on top of 001_domain_tables.sql; applied migrations are never edited.
--
-- Three things land here:
--   1. `availability` on designer_profiles, so "who can start soon" is a filter
--      rather than something a buyer has to read every bio to find out.
--   2. Composite indexes that let every discovery sort and filter be served
--      from an index rather than a full table scan. Each one leads with
--      `status` because the approval gate is on EVERY discovery query — an
--      index that does not start with it would be useless to the only reads
--      that exist.
--   3. An FTS5 index over the text a buyer actually searches.

-- A designer's own availability. Narrower than `timeline` — a designer is
-- never 'exploring', they either have capacity in some window or they do not.
ALTER TABLE designer_profiles ADD COLUMN availability TEXT
  CHECK (availability IN ('asap', 'within_3_months', 'within_6_months', 'within_12_months'));

-- Discovery sorts. `(status, created_at)` already exists from 001 and serves
-- newest/oldest; these cover the remaining sort and the filterable facets.
CREATE INDEX idx_designer_profiles_status_studio_name ON designer_profiles (status, studio_name);
CREATE INDEX idx_designer_profiles_status_budget_band ON designer_profiles (status, budget_band);
CREATE INDEX idx_designer_profiles_status_availability ON designer_profiles (status, availability);
-- 001 indexed (status, location) with the default BINARY collation, so it can
-- only answer a case-exact match. Buyers type "london", designers type
-- "London" — the filter compares COLLATE NOCASE, and an index is only usable
-- when its collation matches the comparison's.
CREATE INDEX idx_designer_profiles_status_location_nocase
  ON designer_profiles (status, location COLLATE NOCASE);

-- "Designers who have published a kitchen" — the project-type facet is a
-- semi-join from projects back to profiles, so it is led by project_type.
CREATE INDEX idx_projects_type_status_designer ON projects (project_type, status, designer_profile_id);

-- Free-text search.
--
-- One document per designer_profile, keyed by `rowid = designer_profiles.id`,
-- so a hit joins straight back to the profile row and the approval gate is
-- applied there. Deliberately NOT an external-content table: the document
-- folds in the titles of the designer's published projects, which is an
-- aggregate across two tables that FTS5's contentless-delete/external-content
-- machinery cannot express.
--
-- `status` is NOT indexed here, on purpose. Every search joins
-- designer_profiles and filters status = 'approved' there, so approval changes
-- never need a reindex and a stale row can never leak a profile — the join is
-- the gate, not the index.
--
-- prefix='2 3 4' precomputes 2-, 3- and 4-character prefix terms so partial
-- word queries ("kitch") are an index lookup rather than a scan.
-- remove_diacritics 2 folds accents correctly for multi-byte characters, which
-- matters for the studio names in this market.
CREATE VIRTUAL TABLE designer_search USING fts5(
  studio_name,
  headline,
  bio,
  location,
  project_titles,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);

-- Deleting a profile is a plain row event, so a trigger is exactly right here
-- and guarantees the index cannot outlive the row even for a delete that
-- bypasses the service layer. Content updates are NOT triggered — see
-- services/search.ts for why.
CREATE TRIGGER designer_search_after_delete
AFTER DELETE ON designer_profiles
BEGIN
  DELETE FROM designer_search WHERE rowid = old.id;
END;

-- Backfill every profile that already exists. Unapproved ones are indexed too:
-- the index holds no status, and indexing them now means approving a designer
-- makes them searchable immediately with no reindex step to forget.
INSERT INTO designer_search (rowid, studio_name, headline, bio, location, project_titles)
SELECT
  p.id,
  p.studio_name,
  COALESCE(p.headline, ''),
  COALESCE(p.bio, ''),
  COALESCE(p.location, ''),
  COALESCE(
    (SELECT group_concat(pr.title, ' ')
     FROM projects pr
     WHERE pr.designer_profile_id = p.id AND pr.status = 'published'),
    ''
  )
FROM designer_profiles p;
