-- 003-passkeys: passkeys (WebAuthn), and how each session started.
-- Times are ISO 8601 UTC text, so text comparison orders them.

-- How the session started. Only a 'passkey' session opens the admin pages.
-- A 'recovery' session opens only /account/passkeys. The sessions from 002
-- started with an email link or code.
ALTER TABLE session ADD COLUMN method TEXT NOT NULL DEFAULT 'email'
  CHECK (method IN ('email', 'passkey', 'recovery'));

-- One row for each passkey. The id is the WebAuthn credential id (base64url).
-- public_key is the COSE public key. transports is a JSON array or NULL.
CREATE TABLE passkey (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT CHECK (transports IS NULL OR json_valid(transports)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);

CREATE INDEX passkey_person_id ON passkey (person_id);

-- One row for each WebAuthn challenge. The first verify deletes the row, so
-- each challenge works one time. A 'register' challenge has the person who
-- adds the passkey. A 'sign_in' challenge has no person.
CREATE TABLE webauthn_challenge (
  challenge TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'sign_in')),
  person_id TEXT REFERENCES person (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- One row for each enrolment link from `bun run admin:recover`. The table
-- stores only the SHA-256 hash of the token.
CREATE TABLE recovery_token (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
