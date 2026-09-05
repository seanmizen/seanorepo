-- Baseline schema for `inside`.
--
-- This is the single source of truth for the starting shape of the database.
-- Everything after it is an additive NNN_*.sql migration; there is no separate
-- "seed creates the tables" path to drift out of sync with.
--
-- Domain tables (designers, projects, enquiries, briefs) land in SEAN-144.

-- Accounts. Both sides of the marketplace live here, separated by `role`.
-- Buyers may browse anonymously and only ever create a row when they sign up
-- to save a designer or send an enquiry.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'designer', 'admin')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users (email);

-- Single-use, short-lived magic-link tokens. Consumed by setting `used_at`.
CREATE TABLE magic_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at    DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_magic_tokens_token ON magic_tokens (token);

-- Server-side sessions, so a logout can actually revoke a live JWT.
-- `token_hash` is sha256(jwt) — the raw JWT is never stored.
CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_token_hash ON sessions (token_hash);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);

-- Uploaded assets. One row per original; derivatives are recorded in
-- image_variants so the frontend can build a srcset.
CREATE TABLE images (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  byte_size    INTEGER NOT NULL,
  alt          TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_images_owner_id ON images (owner_id);

CREATE TABLE image_variants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id     INTEGER NOT NULL REFERENCES images (id) ON DELETE CASCADE,
  variant      TEXT NOT NULL CHECK (variant IN ('thumb', 'grid', 'full')),
  storage_path TEXT NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  byte_size    INTEGER NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (image_id, variant)
);

CREATE INDEX idx_image_variants_image_id ON image_variants (image_id);
