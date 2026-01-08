import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as authService from '../services/auth';
import { openDbConnection, seedDatabase } from '../services/db';
import * as sessionService from '../services/session';

describe('Auth Integration Tests', () => {
  beforeEach(async () => {
    // Fresh database for each test
    await seedDatabase();
  });

  afterEach(async () => {
    const db = await openDbConnection();
    db.close();
  });

  test('should create session when verifying magic token', async () => {
    const email = 'test@example.com';

    // Create magic token
    const { token } = await authService.createMagicToken(email);

    // Verify token
    const user = await authService.verifyMagicToken(token);
    expect(user).toBeDefined();
    expect(user?.email).toBe(email);

    if (!user) throw new Error('User should be defined');

    // Simulate JWT creation
    const mockJwt = `mock-jwt-token-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // Create session
    const session = await sessionService.createSession(
      user.id,
      mockJwt,
      expiresAt,
    );

    expect(session).toBeDefined();
    expect(session.user_id).toBe(user.id);
    expect(session.revoked_at).toBeNull();
  });

  test('should validate active session', async () => {
    const email = 'session@example.com';

    // Create user and session
    const { userId } = await authService.createMagicToken(email);
    const mockJwt = 'valid-jwt-token';
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await sessionService.createSession(userId, mockJwt, expiresAt);

    // Validate session
    const session = await sessionService.validateSession(mockJwt);
    expect(session).toBeDefined();
    expect(session?.user_id).toBe(userId);
  });

  test('should reject revoked session', async () => {
    const email = 'revoked@example.com';

    // Create user and session
    const { userId } = await authService.createMagicToken(email);
    const mockJwt = 'revoked-jwt-token';
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await sessionService.createSession(userId, mockJwt, expiresAt);

    // Revoke session
    const revoked = await sessionService.revokeSession(mockJwt);
    expect(revoked).toBe(true);

    // Try to validate - should fail
    const session = await sessionService.validateSession(mockJwt);
    expect(session).toBeNull();
  });

  test('should reject expired session', async () => {
    const email = 'expired@example.com';

    // Create user and session
    const { userId } = await authService.createMagicToken(email);
    const mockJwt = 'expired-jwt-token';
    const expiresAt = new Date(Date.now() + 1000); // Valid initially

    await sessionService.createSession(userId, mockJwt, expiresAt);

    // Manually expire it using SQL (same pattern as auth.test.ts)
    const db = await openDbConnection();
    const tokenHash = sessionService.hashToken(mockJwt);
    db.run(
      "UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE token_hash = ?",
      [tokenHash],
    );
    db.close();

    // Try to validate - should fail
    const session = await sessionService.validateSession(mockJwt);
    expect(session).toBeNull();
  });

  test('should revoke all user sessions', async () => {
    const email = 'multidevice@example.com';
    const { userId } = await authService.createMagicToken(email);

    // Create multiple sessions for same user (simulating multiple devices)
    const jwt1 = 'device-1-token';
    const jwt2 = 'device-2-token';
    const jwt3 = 'device-3-token';
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await sessionService.createSession(userId, jwt1, expiresAt);
    await sessionService.createSession(userId, jwt2, expiresAt);
    await sessionService.createSession(userId, jwt3, expiresAt);

    // Revoke all sessions
    const revokedCount = await sessionService.revokeAllUserSessions(userId);
    expect(revokedCount).toBe(3);

    // Verify all are invalid
    expect(await sessionService.validateSession(jwt1)).toBeNull();
    expect(await sessionService.validateSession(jwt2)).toBeNull();
    expect(await sessionService.validateSession(jwt3)).toBeNull();
  });

  test('should not revoke session twice', async () => {
    const email = 'once@example.com';
    const { userId } = await authService.createMagicToken(email);
    const mockJwt = 'once-token';
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await sessionService.createSession(userId, mockJwt, expiresAt);

    // First revocation
    const revoked1 = await sessionService.revokeSession(mockJwt);
    expect(revoked1).toBe(true);

    // Second revocation attempt - should return false (no rows updated)
    const revoked2 = await sessionService.revokeSession(mockJwt);
    expect(revoked2).toBe(false);
  });

  test('should clean up expired sessions', async () => {
    const email = 'cleanup@example.com';
    const { userId } = await authService.createMagicToken(email);

    // Create two sessions
    const expiredJwt = 'cleanup-expired-token';
    const validJwt = 'cleanup-valid-token';
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);

    await sessionService.createSession(userId, expiredJwt, futureDate);
    await sessionService.createSession(userId, validJwt, futureDate);

    // Manually expire one session
    const db = await openDbConnection();
    const expiredTokenHash = sessionService.hashToken(expiredJwt);
    db.run(
      "UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE token_hash = ?",
      [expiredTokenHash],
    );
    db.close();

    // Run cleanup
    await sessionService.cleanupExpiredSessions();

    // Expired session should be gone
    const db2 = await openDbConnection();
    const expiredSession = db2
      .query('SELECT * FROM sessions WHERE token_hash = ?')
      .get(expiredTokenHash);
    expect(expiredSession).toBeFalsy();

    // Valid session should still exist
    const validSession = await sessionService.validateSession(validJwt);
    expect(validSession).toBeDefined();

    db2.close();
  });

  test('full magic link flow with session management', async () => {
    const email = 'fullflow@example.com';

    // Step 1: Request magic link
    const { token } = await authService.createMagicToken(email);
    expect(token).toBeString();

    // Step 2: Verify magic token (simulate /auth/verify endpoint)
    const user = await authService.verifyMagicToken(token);
    expect(user).toBeDefined();
    expect(user?.email).toBe(email);

    if (!user) throw new Error('User should be defined');

    // Step 3: Create JWT and session (what backend does on verify)
    const mockJwt = `full-flow-jwt-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const session = await sessionService.createSession(
      user.id,
      mockJwt,
      expiresAt,
    );
    expect(session).toBeDefined();

    // Step 4: Validate session (what middleware does on protected routes)
    const validSession = await sessionService.validateSession(mockJwt);
    expect(validSession).toBeDefined();
    expect(validSession?.user_id).toBe(user.id);

    // Step 5: Logout (revoke session)
    const revoked = await sessionService.revokeSession(mockJwt);
    expect(revoked).toBe(true);

    // Step 6: Try to access with revoked session - should fail
    const invalidSession = await sessionService.validateSession(mockJwt);
    expect(invalidSession).toBeNull();
  });
});
