-- 002-auth: email sign-in and sessions.
-- The tables store only the SHA-256 hash of each token and code, never the
-- raw value. Times are ISO 8601 UTC text, so text comparison orders them.

-- One row for each sign-in email. The link token and the 6-digit code are two
-- keys for the same row, and the first one used spends the row (used_at).
CREATE TABLE login_token (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX login_token_person_id ON login_token (person_id);

-- One row for each signed-in browser. The cookie holds the raw token.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX session_person_id ON session (person_id);
