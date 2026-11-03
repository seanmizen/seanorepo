-- 006-connections: the MCP connections of the admin (`oauth.ts`).
-- The tables store only the SHA-256 hash of each token and code, never the
-- raw value. Times are ISO 8601 UTC text, so text comparison orders them.

-- One row for each OAuth client that registered itself (RFC 7591), for
-- example Claude. Each client is public: it has no secret, and PKCE
-- protects its code. redirect_uris is a JSON array.
CREATE TABLE oauth_client (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL CHECK (json_valid(redirect_uris)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row for each authorization code. The admin makes it on the consent
-- page. The token endpoint deletes the row, so each code works one time.
CREATE TABLE oauth_code (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_client (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- One row for each connection: a personal access token (kind 'token') or
-- an OAuth grant (kind 'oauth'). /account/connections lists them, and a
-- revoke deletes the row. token_hash is the hash of the token that the
-- MCP endpoint takes: a personal access token never expires, and an OAuth
-- access token expires at token_expires_at. An OAuth grant also has a
-- refresh token, which changes at each refresh.
CREATE TABLE connection (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('token', 'oauth')),
  name TEXT NOT NULL,
  client_id TEXT REFERENCES oauth_client (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_expires_at TEXT,
  refresh_hash TEXT UNIQUE,
  refresh_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  CHECK ((kind = 'token') = (client_id IS NULL))
);

CREATE INDEX connection_person_id ON connection (person_id);
