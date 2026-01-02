import { createHash } from 'node:crypto';
import { openDbConnection } from './db';

interface Session {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Hash a JWT token for storage (never store raw JWTs)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new session for a user
 */
export async function createSession(
  userId: number,
  jwtToken: string,
  expiresAt: Date,
): Promise<Session> {
  const db = await openDbConnection();
  const tokenHash = hashToken(jwtToken);

  try {
    db.run(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [userId, tokenHash, expiresAt.toISOString()],
    );

    const result = db.query('SELECT last_insert_rowid() as id').get() as {
      id: number;
    };
    const sessionId = Number(result.id);

    const session = db
      .query('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as Session;

    return session;
  } finally {
    db.close();
  }
}

/**
 * Validate a session by token hash
 * Returns null if session is invalid, expired, or revoked
 */
export async function validateSession(
  jwtToken: string,
): Promise<Session | null> {
  const db = await openDbConnection();
  const tokenHash = hashToken(jwtToken);

  try {
    const session = db
      .query(
        `SELECT * FROM sessions
         WHERE token_hash = ?
         AND revoked_at IS NULL
         AND expires_at > datetime('now')`,
      )
      .get(tokenHash) as Session | undefined;

    return session || null;
  } finally {
    db.close();
  }
}

/**
 * Revoke a specific session (logout)
 */
export async function revokeSession(jwtToken: string): Promise<boolean> {
  const db = await openDbConnection();
  const tokenHash = hashToken(jwtToken);

  try {
    const result = db.run(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL",
      [tokenHash],
    );

    return result.changes > 0;
  } finally {
    db.close();
  }
}

/**
 * Revoke all sessions for a user (logout everywhere)
 */
export async function revokeAllUserSessions(userId: number): Promise<number> {
  const db = await openDbConnection();

  try {
    const result = db.run(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL",
      [userId],
    );

    return result.changes;
  } finally {
    db.close();
  }
}

/**
 * Clean up expired and revoked sessions (should be run periodically)
 */
export async function cleanupExpiredSessions(): Promise<void> {
  const db = await openDbConnection();
  try {
    // Delete sessions that are expired or revoked more than 30 days ago
    db.run(
      "DELETE FROM sessions WHERE expires_at < datetime('now') OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-30 days'))",
    );
  } finally {
    db.close();
  }
}
