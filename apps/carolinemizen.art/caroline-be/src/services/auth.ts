import { randomBytes } from 'node:crypto';
import { openDbConnection } from './db';

/**
 * Get admin emails from environment variable
 * Evaluated at runtime to support testing
 */
function getAdminEmails(): Set<string> {
  const TEST_MODE = process.env.TEST_MODE === 'true';

  if (!process.env.ADMIN_EMAILS && !TEST_MODE) {
    throw new Error(
      'ADMIN_EMAILS environment variable is required. Set it in .env file (comma-separated list)',
    );
  }

  const emails = new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean),
  );

  if (emails.size === 0 && !TEST_MODE) {
    throw new Error('ADMIN_EMAILS cannot be empty');
  }

  return emails;
}

interface MagicToken {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

interface User {
  id: number;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
}

/**
 * Generate a random magic link token
 */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Create or get user by email, then generate magic token
 */
export async function createMagicToken(
  email: string,
): Promise<{ token: string; userId: number }> {
  const db = await openDbConnection();

  try {
    // Find or create user
    let user = db.query('SELECT * FROM users WHERE email = ?').get(email) as
      | User
      | undefined;

    const adminEmails = getAdminEmails();
    const expectedRole = adminEmails.has(email.toLowerCase())
      ? 'admin'
      : 'guest';

    if (!user) {
      // Create new user with correct role
      db.run('INSERT INTO users (email, role) VALUES (?, ?)', [
        email,
        expectedRole,
      ]);
      const result = db.query('SELECT last_insert_rowid() as id').get() as {
        id: number;
      };
      const userId = Number(result.id);
      user = { id: userId, email, role: expectedRole } as User;
    } else if (user.role !== expectedRole) {
      // Upgrade/downgrade existing user if their role doesn't match whitelist
      db.run('UPDATE users SET role = ? WHERE id = ?', [expectedRole, user.id]);
      user.role = expectedRole;
    }

    // Generate token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Insert magic token
    db.run(
      'INSERT INTO magic_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, token, expiresAt.toISOString()],
    );

    return { token, userId: user.id };
  } finally {
    db.close();
  }
}

/**
 * Verify a magic token and return the user
 * Returns null if token is invalid, expired, or already used
 */
export async function verifyMagicToken(token: string): Promise<User | null> {
  const db = await openDbConnection();

  try {
    // Find token
    const magicToken = db
      .query(
        `SELECT * FROM magic_tokens
         WHERE token = ?
         AND used_at IS NULL
         AND expires_at > datetime('now')`,
      )
      .get(token) as MagicToken | undefined;

    if (!magicToken) {
      return null;
    }

    // Mark token as used
    db.run("UPDATE magic_tokens SET used_at = datetime('now') WHERE id = ?", [
      magicToken.id,
    ]);

    // Get user
    const user = db
      .query('SELECT * FROM users WHERE id = ?')
      .get(magicToken.user_id) as User;

    return user;
  } finally {
    db.close();
  }
}

/**
 * Clean up expired magic tokens (should be run periodically)
 */
export async function cleanupExpiredTokens(): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run("DELETE FROM magic_tokens WHERE expires_at < datetime('now')");
  } finally {
    db.close();
  }
}
