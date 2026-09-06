import { createHash } from 'node:crypto';
import { openDbConnection } from './db';

/**
 * Sessions exist so a logout can actually revoke a live JWT. A JWT alone is
 * valid until it expires — with no server-side record there is no way to
 * invalidate one.
 *
 * Session lifetime MUST match the cookie's maxAge in controllers/auth.ts.
 * carolinemizen.art sets a 1-hour session against a 7-day cookie, so its users
 * are silently 401'd while still holding a cookie the browser considers good.
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

/** Only the hash is stored — a leaked sessions table must not yield live JWTs. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: number,
  jwt: string,
): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [
        userId,
        hashToken(jwt),
        new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      ],
    );
  } finally {
    db.close();
  }
}

/** True only if the session exists, is unrevoked, and has not expired. */
export async function isSessionValid(jwt: string): Promise<boolean> {
  const db = await openDbConnection();
  try {
    const row = db
      .query(
        `SELECT id FROM sessions
         WHERE token_hash = ?
           AND revoked_at IS NULL
           AND expires_at > datetime('now')`,
      )
      .get(hashToken(jwt));
    return row !== null && row !== undefined;
  } finally {
    db.close();
  }
}

export async function revokeSession(jwt: string): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL",
      [hashToken(jwt)],
    );
  } finally {
    db.close();
  }
}

/** Used when an account is compromised, or to log out everywhere. */
export async function revokeAllUserSessions(userId: number): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL",
      [userId],
    );
  } finally {
    db.close();
  }
}

/** Housekeeping. Scheduling this is part of the hardening ticket. */
export async function cleanupExpired(): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
    db.run("DELETE FROM magic_tokens WHERE expires_at <= datetime('now')");
  } finally {
    db.close();
  }
}
