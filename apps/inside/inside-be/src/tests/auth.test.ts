import { describe, expect, test } from 'bun:test';
import { getApp, uniqueEmail } from './setup';

// Shared instance — see setup.ts, which sets ADMIN_EMAILS to boss@inside.test.
const app = await getApp();
const { openDbConnection } = await import('../services/db');
const { safeReturnTo } = await import('../controllers/auth');

/** Requests a link and pulls the raw token out of the dev-bypass response. */
async function requestToken(
  email: string,
  role?: string,
  returnTo?: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/magic-link',
    payload: { email, role, returnTo },
  });
  const { devLink } = res.json<{ devLink: string }>();
  return new URL(devLink).searchParams.get('token') as string;
}

async function login(email: string, role?: string): Promise<string> {
  const token = await requestToken(email, role);
  const res = await app.inject({
    method: 'GET',
    url: `/api/auth/verify?token=${token}`,
  });
  return res.cookies.find((c) => c.name === 'token')?.value as string;
}

describe('the dev sign-in link', () => {
  test('is returned in the test environment, where email is unconfigured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: uniqueEmail('devlink') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ devLink?: string }>().devLink).toBeString();
  });

  test('is a working credential, not a decorative string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: uniqueEmail('devlink-works') },
    });
    const link = res.json<{ devLink: string }>().devLink;
    const token = new URL(link).searchParams.get('token') as string;

    const verified = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${token}`,
    });
    expect(verified.statusCode).toBe(200);
  });

  test('the endpoint does not 502 when SMTP is unconfigured', async () => {
    // The regression: .env.example ships a host with blank credentials, so the
    // send failed and a developer could not sign in at all.
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: uniqueEmail('no-smtp') },
    });
    expect(res.statusCode).not.toBe(502);
  });
});

describe('POST /api/auth/magic-link', () => {
  test('issues a link for a new address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'new@inside.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ sent: boolean }>().sent).toBe(true);
  });

  test('rejects a malformed email', async () => {
    for (const email of ['', 'nope', 'a@b', '@b.c', 'a b@c.d']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/magic-link',
        payload: { email },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  test('does not leak whether an account exists', async () => {
    const known = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'new@inside.test' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'stranger@inside.test' },
    });
    expect(known.statusCode).toBe(unknown.statusCode);
    expect(known.json<{ sent: boolean }>().sent).toBe(
      unknown.json<{ sent: boolean }>().sent,
    );
  });
});

describe('GET /api/auth/verify', () => {
  test('signs the user in and sets an httpOnly cookie', async () => {
    const token = await requestToken('verify@inside.test');
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${token}`,
    });

    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'token');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
  });

  test('the cookie maxAge matches the session TTL', async () => {
    const { SESSION_TTL_SECONDS } = await import('../services/session');
    const token = await requestToken('ttl@inside.test');
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${token}`,
    });
    // The mismatch this guards: caroline's 1-hour session vs 7-day cookie
    // silently 401s users who still hold a valid-looking cookie.
    expect(res.cookies.find((c) => c.name === 'token')?.maxAge).toBe(
      SESSION_TTL_SECONDS,
    );
  });

  test('a token cannot be used twice', async () => {
    const token = await requestToken('once@inside.test');
    const first = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${token}`,
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${token}`,
    });
    expect(replay.statusCode).toBe(401);
  });

  test('an expired token is rejected', async () => {
    const token = await requestToken('expired@inside.test');
    const db = await openDbConnection();
    db.run(
      "UPDATE magic_tokens SET expires_at = datetime('now', '-1 minute') WHERE token = ?",
      [token],
    );
    db.close();

    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${token}`,
    });
    expect(res.statusCode).toBe(401);
  });

  test('an unknown token is rejected', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/verify?token=deadbeef',
    });
    expect(res.statusCode).toBe(401);
  });

  test('a missing token is a 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/verify' });
    expect(res.statusCode).toBe(400);
  });
});

describe('roles', () => {
  test('signup role is honoured for a new account', async () => {
    const jwt = await login('designer@inside.test', 'designer');
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { token: jwt },
    });
    expect(me.json<{ user: { role: string } }>().user.role).toBe('designer');
  });

  test('defaults to buyer when no role is given', async () => {
    const jwt = await login('plain@inside.test');
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { token: jwt },
    });
    expect(me.json<{ user: { role: string } }>().user.role).toBe('buyer');
  });

  test('logging in again never rewrites an existing role', async () => {
    // The caroline bug: it recomputes role on every login, which here would
    // demote a designer to buyer and orphan their profile and portfolio.
    await login('keeps@inside.test', 'designer');
    const jwt = await login('keeps@inside.test', 'buyer');
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { token: jwt },
    });
    expect(me.json<{ user: { role: string } }>().user.role).toBe('designer');
  });

  test('admin comes from the whitelist, not the request', async () => {
    const jwt = await login('boss@inside.test');
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { token: jwt },
    });
    expect(me.json<{ user: { role: string } }>().user.role).toBe('admin');
  });

  test('admin cannot be self-assigned via the signup payload', async () => {
    const jwt = await login('sneaky@inside.test', 'admin');
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { token: jwt },
    });
    expect(me.json<{ user: { role: string } }>().user.role).toBe('buyer');
  });
});

describe('session lifecycle', () => {
  test('/me answers 200 with a null user when signed out', async () => {
    // Anonymous browsing is a first-class flow, so "nobody" is an answer, not
    // an error — a 401 here would log a console error on every anonymous load.
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ user: unknown }>().user).toBeNull();
  });

  test('/me still rejects a token that is present but forged', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { token: 'not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('logout revokes the session server-side', async () => {
    const jwt = await login('bye@inside.test');

    const before = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { token: jwt },
    });
    expect(before.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { token: jwt },
    });

    // Same cookie, now dead — a signature-only check would still accept it.
    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { token: jwt },
    });
    expect(after.statusCode).toBe(401);
  });

  test('an expired session is rejected even with a valid signature', async () => {
    const jwt = await login('stale@inside.test');
    const { hashToken } = await import('../services/session');
    const db = await openDbConnection();
    // Scoped to this session only — expiring every live session would sign
    // out accounts the other suites are relying on.
    db.run(
      "UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE token_hash = ?",
      [hashToken(jwt)],
    );
    db.close();

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { token: jwt },
    });
    expect(res.statusCode).toBe(401);
  });

  test('the raw JWT is never stored', async () => {
    const jwt = await login('hashed@inside.test');
    const db = await openDbConnection();
    const hit = db
      .query('SELECT id FROM sessions WHERE token_hash = ?')
      .get(jwt);
    db.close();
    expect(hit).toBeNull();
  });
});

describe('admin scope', () => {
  test('an admin gets through', async () => {
    const jwt = await login('boss@inside.test');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/whoami',
      cookies: { token: jwt },
    });
    expect(res.statusCode).toBe(200);
  });

  test('a signed-in non-admin gets 403, not 401', async () => {
    const jwt = await login('buyer@inside.test');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/whoami',
      cookies: { token: jwt },
    });
    expect(res.statusCode).toBe(403);
  });

  test('an anonymous caller gets 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/whoami' });
    expect(res.statusCode).toBe(401);
  });
});

describe('safeReturnTo', () => {
  test('keeps same-site relative paths', () => {
    expect(safeReturnTo('/designers/alice')).toBe('/designers/alice');
    expect(safeReturnTo('/a?b=c#d')).toBe('/a?b=c#d');
  });

  test('rejects anything that could leave the site', () => {
    // //evil.example is protocol-relative — a leading-slash check alone would
    // let it through and turn our post-login redirect into a phishing hop.
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '',
      undefined,
      null,
      42,
    ]) {
      expect(safeReturnTo(bad)).toBe('/');
    }
  });

  test('the verify response only ever echoes a safe returnTo', async () => {
    const token = await requestToken('ret@inside.test');
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${token}&returnTo=${encodeURIComponent('https://evil.example')}`,
    });
    expect(res.json<{ returnTo: string }>().returnTo).toBe('/');
  });
});
