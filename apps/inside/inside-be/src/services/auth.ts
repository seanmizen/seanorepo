import { randomBytes } from 'node:crypto';
import type { User, UserRole } from '@shared/types';
import { openDbConnection } from './db';

/**
 * REQ-AUTH-001: the magic link is the only credential this app accepts, so
 * there is no password path anywhere below — that absence is the requirement,
 * not an omission.
 *
 * Short-lived by design: a magic link is a bearer credential sitting in an
 * inbox. Expiry bounds the window; REQ-AUTH-002 closes replay inside it.
 */
export const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Roles a person may choose at signup. `admin` is never self-assignable. */
export type SignupRole = Exclude<UserRole, 'admin'>;

export const isSignupRole = (value: unknown): value is SignupRole =>
  value === 'buyer' || value === 'designer';

interface UserRow {
  id: number;
  email: string;
  role: UserRole;
  created_at: string;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  role: row.role,
  createdAt: row.created_at,
});

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** Deliberately permissive — the magic link is what actually proves ownership. */
export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;

function getAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Resolve the role for a login.
 *
 * Two rules, and the second is where carolinemizen.art gets it wrong:
 *
 * 1. REQ-AUTH-004 — `admin` comes only from the ADMIN_EMAILS whitelist. It is
 *    never chosen at signup, so the role column cannot be used for privilege
 *    escalation. Signup is unauthenticated, so a role taken from the request
 *    body would be a role an attacker can simply ask for.
 * 2. REQ-AUTH-003 — an EXISTING user's buyer/designer role is never rewritten
 *    by logging in.
 *    Caroline recomputes the role on every login, which here would silently
 *    demote a designer to buyer — destroying the link to their profile and
 *    portfolio. The signup role only applies when the account is created.
 */
function resolveRole(
  email: string,
  existing: UserRole | null,
  requested: SignupRole,
): UserRole {
  if (getAdminEmails().has(normaliseEmail(email))) return 'admin';
  if (existing === null) return requested;
  // An existing admin who is dropped from the whitelist falls back to buyer;
  // otherwise the stored role stands.
  return existing === 'admin' ? 'buyer' : existing;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query('SELECT id, email, role, created_at FROM users WHERE email = ?')
      .get(normaliseEmail(email)) as UserRow | null;
    return row ? toUser(row) : null;
  } finally {
    db.close();
  }
}

export async function findUserById(id: number): Promise<User | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query('SELECT id, email, role, created_at FROM users WHERE id = ?')
      .get(id) as UserRow | null;
    return row ? toUser(row) : null;
  } finally {
    db.close();
  }
}

/**
 * Find or create the user, then mint a single-use token.
 *
 * Returns the raw token for the caller to email. It is never stored anywhere
 * else and never logged outside the dev bypass.
 */
export async function createMagicToken(
  email: string,
  requestedRole: SignupRole = 'buyer',
): Promise<{ token: string; user: User; isNewUser: boolean }> {
  const normalised = normaliseEmail(email);
  const existing = await findUserByEmail(normalised);
  const role = resolveRole(normalised, existing?.role ?? null, requestedRole);

  const db = await openDbConnection();
  try {
    let userId: number;

    if (existing) {
      userId = existing.id;
      // Only ever writes when the whitelist has changed the admin status.
      if (existing.role !== role) {
        db.run(
          "UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?",
          [role, userId],
        );
      }
    } else {
      db.run('INSERT INTO users (email, role) VALUES (?, ?)', [
        normalised,
        role,
      ]);
      userId = (
        db.query('SELECT last_insert_rowid() AS id').get() as {
          id: number;
        }
      ).id;
    }

    const token = randomBytes(32).toString('hex');
    db.run(
      'INSERT INTO magic_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [userId, token, new Date(Date.now() + MAGIC_TOKEN_TTL_MS).toISOString()],
    );

    const user = db
      .query('SELECT id, email, role, created_at FROM users WHERE id = ?')
      .get(userId) as UserRow;

    return { token, user: toUser(user), isNewUser: !existing };
  } finally {
    db.close();
  }
}

/**
 * Consume a token. Single-use and expiry are enforced in the WHERE clause, so
 * a replayed or stale token simply matches nothing.
 */
export async function verifyMagicToken(token: string): Promise<User | null> {
  const db = await openDbConnection();
  try {
    // REQ-AUTH-002. `used_at IS NULL` is what makes the link single-use, and it
    // is not made redundant by the expiry check beside it: a link replayed
    // inside its window is still a second sign-in nobody asked for, out of an
    // inbox that forwards, syncs and archives.
    const row = db
      .query(
        `SELECT id, user_id FROM magic_tokens
         WHERE token = ?
           AND used_at IS NULL
           AND expires_at > datetime('now')`,
      )
      .get(token) as { id: number; user_id: number } | null;

    if (!row) return null;

    db.run("UPDATE magic_tokens SET used_at = datetime('now') WHERE id = ?", [
      row.id,
    ]);

    const user = db
      .query('SELECT id, email, role, created_at FROM users WHERE id = ?')
      .get(row.user_id) as UserRow | null;

    return user ? toUser(user) : null;
  } finally {
    db.close();
  }
}
