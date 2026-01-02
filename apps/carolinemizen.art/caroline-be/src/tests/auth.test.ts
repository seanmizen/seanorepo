import { describe, expect, test } from 'bun:test';
import * as authService from '../services/auth';
import { openDbConnection } from '../services/db';

describe('Auth Service', () => {
  test('should generate a random token', () => {
    const token1 = authService.generateToken();
    const token2 = authService.generateToken();

    expect(token1).toBeString();
    expect(token1.length).toBe(64); // 32 bytes -> 64 hex chars
    expect(token1).not.toBe(token2); // Should be unique
  });

  test('should create magic token for new user', async () => {
    const email = 'newuser@test.com';
    const { token, userId } = await authService.createMagicToken(email);

    expect(token).toBeString();
    expect(userId).toBeNumber();

    // Verify user was created
    const db = await openDbConnection();
    const user = db.query('SELECT * FROM users WHERE id = ?').get(userId) as
      | { id: number; email: string; role: string }
      | undefined;
    db.close();

    expect(user).toBeDefined();
    expect(user?.email).toBe(email);
    expect(user?.role).toBe('guest');
  });

  test('should reuse existing user when creating magic token', async () => {
    const email = 'existing@test.com';

    const { userId: userId1 } = await authService.createMagicToken(email);
    const { userId: userId2 } = await authService.createMagicToken(email);

    expect(userId1).toBe(userId2); // Same user ID
  });

  test('should verify valid magic token', async () => {
    const email = 'verify@test.com';
    const { token } = await authService.createMagicToken(email);

    const user = await authService.verifyMagicToken(token);

    expect(user).toBeDefined();
    expect(user?.email).toBe(email);
  });

  test('should reject invalid magic token', async () => {
    const user = await authService.verifyMagicToken('invalid-token');
    expect(user).toBeNull();
  });

  test('should reject used magic token', async () => {
    const email = 'used@test.com';
    const { token } = await authService.createMagicToken(email);

    // Use token once
    await authService.verifyMagicToken(token);

    // Try to use again
    const user = await authService.verifyMagicToken(token);
    expect(user).toBeNull();
  });

  test('should reject expired magic token', async () => {
    const email = 'expired@test.com';

    // Create token
    const { token } = await authService.createMagicToken(email);

    // Manually expire it
    const db = await openDbConnection();
    db.run(
      "UPDATE magic_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = ?",
      [token],
    );
    db.close();

    // Try to verify
    const user = await authService.verifyMagicToken(token);
    expect(user).toBeNull();
  });

  test('should clean up expired tokens', async () => {
    const email = 'cleanup@test.com';
    const { token } = await authService.createMagicToken(email);

    // Manually expire it
    const db = await openDbConnection();
    db.run(
      "UPDATE magic_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = ?",
      [token],
    );
    db.close();

    // Clean up
    await authService.cleanupExpiredTokens();

    // Verify it's gone
    const db2 = await openDbConnection();
    const expired = db2
      .query('SELECT * FROM magic_tokens WHERE token = ?')
      .get(token);
    db2.close();

    expect(expired).toBeFalsy();
  });
});
