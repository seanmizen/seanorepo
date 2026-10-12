-- Migration 002: Add the columns for the smaller versions of each upload
-- services/media.ts fills these columns after an upload.
-- variants holds a JSON array of { width, path }. NULL means not processed.

ALTER TABLE images ADD COLUMN thumbhash TEXT;
ALTER TABLE images ADD COLUMN variants TEXT;
ALTER TABLE images ADD COLUMN poster_path TEXT;
