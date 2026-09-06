-- The great rename (SEAN-189).
--
-- Three vocabularies were in play: the database said `pitches` and `projects`,
-- the URLs were heading for `jobs` and `bids`, and the UI copy said something
-- else again. One vocabulary now, everywhere, before more is built on top.
--
--   pitches          -> bids                       a designer's response to a brief
--   projects         -> portfolio_projects         a designer's completed work
--   project_images   -> portfolio_project_images
--   project_type     -> work_type                  the KIND of work
--
-- `project_type` had to go: once "project" means a portfolio piece, a column
-- called `project_type` on a *brief* is ambiguous, and ambiguity in a column
-- name is the kind of thing that is still confusing people two years later.
--
-- This is a rename and nothing else. No column changes shape, no data moves,
-- no behaviour changes. Earlier migrations are history and are left untouched.
--
-- SQLite updates references inside triggers and views automatically on RENAME,
-- and the only trigger here is on designer_profiles, which is not renamed.
-- Index NAMES do not follow their table, so they are dropped and recreated.

ALTER TABLE pitches RENAME TO bids;
ALTER TABLE projects RENAME TO portfolio_projects;
ALTER TABLE project_images RENAME TO portfolio_project_images;

ALTER TABLE portfolio_projects RENAME COLUMN project_type TO work_type;
ALTER TABLE briefs RENAME COLUMN project_type TO work_type;
ALTER TABLE enquiries RENAME COLUMN project_type TO work_type;
ALTER TABLE portfolio_project_images RENAME COLUMN project_id TO portfolio_project_id;

-- Indexes: names carry the old vocabulary, so replace them.
DROP INDEX idx_pitches_brief_id;
DROP INDEX idx_pitches_designer_profile_id;
DROP INDEX idx_pitches_status;
CREATE INDEX idx_bids_brief_id ON bids (brief_id);
-- Not a rename: RESTORED. 001 created idx_pitches_brief_status_created_at,
-- and 003 rebuilt the table (which drops its indexes) while recreating only
-- three of the four, silently losing this one. Rebuilding a table takes its
-- indexes with it — recreate every index, not the ones you remember.
CREATE INDEX idx_bids_brief_status_created_at ON bids (brief_id, status, created_at);
CREATE INDEX idx_bids_designer_profile_id ON bids (designer_profile_id);
CREATE INDEX idx_bids_status ON bids (status);

DROP INDEX idx_projects_cover_image_id;
DROP INDEX idx_projects_designer_profile_id;
DROP INDEX idx_projects_designer_status_order;
DROP INDEX idx_projects_project_type;
DROP INDEX idx_projects_slug;
DROP INDEX idx_projects_status;
DROP INDEX idx_projects_type_status_designer;
CREATE INDEX idx_portfolio_projects_cover_image_id ON portfolio_projects (cover_image_id);
CREATE INDEX idx_portfolio_projects_designer_profile_id ON portfolio_projects (designer_profile_id);
CREATE INDEX idx_portfolio_projects_designer_status_order ON portfolio_projects (designer_profile_id, status, display_order);
CREATE INDEX idx_portfolio_projects_work_type ON portfolio_projects (work_type);
CREATE INDEX idx_portfolio_projects_slug ON portfolio_projects (slug);
CREATE INDEX idx_portfolio_projects_status ON portfolio_projects (status);
CREATE INDEX idx_portfolio_projects_type_status_designer ON portfolio_projects (work_type, status, designer_profile_id);

DROP INDEX idx_project_images_image_id;
DROP INDEX idx_project_images_project_id;
DROP INDEX idx_project_images_project_order;
CREATE INDEX idx_portfolio_project_images_image_id ON portfolio_project_images (image_id);
CREATE INDEX idx_portfolio_project_images_project_id ON portfolio_project_images (portfolio_project_id);
CREATE INDEX idx_portfolio_project_images_project_order ON portfolio_project_images (portfolio_project_id, display_order);

DROP INDEX idx_briefs_project_type;
CREATE INDEX idx_briefs_work_type ON briefs (work_type);
