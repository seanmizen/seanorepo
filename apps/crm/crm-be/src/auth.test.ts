import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ensureAdmin, SESSION_COOKIE, safeNext } from './auth';
import { devOutbox } from './email';
import type { buildApp } from './index';
import {
  addPerson,
  lastLoginEmail,
  postForm,
  signIn,
  testApp,
} from './test-helpers';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;

beforeEach(() => {
  ({ app, db, close } = testApp());
});

afterEach(async () => {
  await close();
});

const sessionCookie = (response: Awaited<ReturnType<typeof postForm>>) =>
  response.cookies.find((c) => c.name === SESSION_COOKIE);

const count = (table: string) =>
  (db.query(`SELECT count(*) AS n FROM ${table};`).get() as { n: number }).n;

describe('POST /login', () => {
  test('a known and an unknown email get the same response', async () => {
    addPerson(db, 'known@example.com');
    const before = devOutbox.length;
    const known = await postForm(app, '/login', {
      email: 'known@example.com',
      next: '/x',
    });
    const unknown = await postForm(app, '/login', {
      email: 'unknown@example.com',
      next: '/x',
    });
    expect(known.statusCode).toBe(303);
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    const strip = (location: unknown) =>
      String(location).replace(/email=[^&]*/, '');
    expect(strip(unknown.headers.location)).toBe(strip(known.headers.location));
    // Only the known email gets a token and an email.
    expect(count('login_token')).toBe(1);
    expect(devOutbox.length).toBe(before + 1);
    expect(devOutbox.at(-1)?.to).toBe('known@example.com');
  });

  test('the email holds a link and a 6-digit code, and the table holds only hashes', async () => {
    addPerson(db, 'a@example.com');
    await postForm(app, '/login', { email: ' A@Example.com ' });
    const { url, token, code } = lastLoginEmail('a@example.com');
    expect(url.pathname).toBe('/login/verify');
    expect(token.length).toBeGreaterThan(40);
    expect(code).toMatch(/^\d{6}$/);
    const row = db.query('SELECT * FROM login_token;').get() as Record<
      string,
      string
    >;
    expect(Object.values(row)).not.toContain(token);
    expect(Object.values(row)).not.toContain(code);
  });

  test('too many attempts for one email get 429', async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await postForm(app, '/login', { email: 'x@example.com' });
      expect(ok.statusCode).toBe(303);
    }
    const limited = await postForm(app, '/login', { email: 'x@example.com' });
    expect(limited.statusCode).toBe(429);
  });
});

describe('the email link', () => {
  test('a GET shows a Sign in button and does not sign in', async () => {
    addPerson(db, 'a@example.com');
    await postForm(app, '/login', { email: 'a@example.com' });
    const { url, token } = lastLoginEmail('a@example.com');
    const page = await app.inject({
      method: 'GET',
      url: `${url.pathname}${url.search}`,
    });
    expect(page.statusCode).toBe(200);
    expect(page.cookies).toEqual([]);
    expect(page.body).toContain('<form action="/login/verify" method="post">');
    expect(page.body).toContain('Sign in</button>');
    expect(count('session')).toBe(0);
    // The GET did not spend the token.
    const signedIn = await postForm(app, '/login/verify', { token });
    expect(signedIn.statusCode).toBe(303);
    expect(sessionCookie(signedIn)?.httpOnly).toBe(true);
  });

  test('the token is single-use', async () => {
    addPerson(db, 'a@example.com');
    await postForm(app, '/login', { email: 'a@example.com' });
    const { token, code } = lastLoginEmail('a@example.com');
    const first = await postForm(app, '/login/verify', { token });
    expect(first.statusCode).toBe(303);
    const second = await postForm(app, '/login/verify', { token });
    expect(second.statusCode).toBe(400);
    expect(sessionCookie(second)).toBeUndefined();
    // The link spent the row, so its code fails too.
    const byCode = await postForm(app, '/login/code', {
      email: 'a@example.com',
      code,
    });
    expect(byCode.statusCode).toBe(400);
    expect(count('session')).toBe(1);
  });

  test('the token expires', async () => {
    addPerson(db, 'a@example.com');
    await postForm(app, '/login', { email: 'a@example.com' });
    const { token } = lastLoginEmail('a@example.com');
    db.query('UPDATE login_token SET expires_at = ?;').run(
      new Date(Date.now() - 1000).toISOString(),
    );
    const response = await postForm(app, '/login/verify', { token });
    expect(response.statusCode).toBe(400);
    expect(sessionCookie(response)).toBeUndefined();
  });
});

describe('the code form', () => {
  test('the right code signs in once, and a wrong code fails', async () => {
    addPerson(db, 'a@example.com');
    await postForm(app, '/login', { email: 'a@example.com' });
    const { code } = lastLoginEmail('a@example.com');
    const wrong = await postForm(app, '/login/code', {
      email: 'a@example.com',
      code: code === '000000' ? '111111' : '000000',
    });
    expect(wrong.statusCode).toBe(400);
    const right = await postForm(app, '/login/code', {
      email: 'a@example.com',
      code,
      next: '/account/sessions',
    });
    expect(right.statusCode).toBe(303);
    expect(right.headers.location).toBe('/account/sessions');
    expect(sessionCookie(right)).toBeDefined();
    const again = await postForm(app, '/login/code', {
      email: 'a@example.com',
      code,
    });
    expect(again.statusCode).toBe(400);
  });

  test('too many attempts get 429', async () => {
    for (let i = 0; i < 5; i++) {
      await postForm(app, '/login/code', {
        email: 'a@example.com',
        code: '123456',
      });
    }
    const limited = await postForm(app, '/login/code', {
      email: 'a@example.com',
      code: '123456',
    });
    expect(limited.statusCode).toBe(429);
  });
});

describe('next', () => {
  test('safeNext keeps local paths and rejects other hosts', () => {
    expect(safeNext('/account/sessions?x=1')).toBe('/account/sessions?x=1');
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/.//evil.example',
      '/\n/evil.example',
      'javascript:alert(1)',
      'evil.example',
      '',
      undefined,
      ['/a'],
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
  });

  test('a signed-out visitor goes to /login and comes back after sign-in', async () => {
    const page = await app.inject({ method: 'GET', url: '/account/sessions' });
    expect(page.statusCode).toBe(303);
    expect(page.headers.location).toBe('/login?next=%2Faccount%2Fsessions');

    const login = await app.inject({
      method: 'GET',
      url: page.headers.location,
    });
    expect(login.body).toContain(
      '<input type="hidden" name="next" value="/account/sessions"/>',
    );

    addPerson(db, 'a@example.com');
    await postForm(app, '/login', {
      email: 'a@example.com',
      next: '/account/sessions',
    });
    const { token, url } = lastLoginEmail('a@example.com');
    expect(url.searchParams.get('next')).toBe('/account/sessions');
    const signedIn = await postForm(app, '/login/verify', {
      token,
      next: '/account/sessions',
    });
    expect(signedIn.headers.location).toBe('/account/sessions');
  });

  test('a sign-in with another host in next goes to /', async () => {
    addPerson(db, 'a@example.com');
    await postForm(app, '/login', { email: 'a@example.com' });
    const { token } = lastLoginEmail('a@example.com');
    const response = await postForm(app, '/login/verify', {
      token,
      next: '//evil.example/path',
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/');
  });
});

describe('the session check', () => {
  test('/, /privacy, /login and /api/health are open, other pages need a session', async () => {
    for (const url of ['/', '/privacy', '/login', '/api/health']) {
      const page = await app.inject({ method: 'GET', url });
      expect(page.statusCode).toBe(200);
      expect(page.headers.location).toBeUndefined();
    }
    const orgs = await app.inject({ method: 'GET', url: '/orgs' });
    expect(orgs.statusCode).toBe(303);
    expect(orgs.headers.location).toBe('/login?next=%2Forgs');
    const bad = await app.inject({
      method: 'GET',
      url: '/orgs',
      headers: { cookie: `${SESSION_COOKIE}=not-a-session` },
    });
    expect(bad.statusCode).toBe(303);
  });

  test('/favicon.ico is open and is never a redirect', async () => {
    const icon = await app.inject({ method: 'GET', url: '/favicon.ico' });
    expect(icon.statusCode).toBe(204);
    expect(icon.headers.location).toBeUndefined();
  });

  test('a POST from a different origin gets 403', async () => {
    const cookie = await signIn(app, db, 'a@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/logout',
      headers: { cookie, origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(count('session')).toBe(1);
  });
});

describe('sessions and sign-out', () => {
  test('the list shows each session, and revokes one or all others', async () => {
    const first = await signIn(app, db, 'a@example.com');
    const second = await signIn(app, db, 'a@example.com');
    const third = await signIn(app, db, 'a@example.com');
    const other = await signIn(app, db, 'b@example.com');

    const page = await app.inject({
      method: 'GET',
      url: '/account/sessions',
      headers: { cookie: first },
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('(this session)');
    expect(page.body.match(/<button[^>]*value="[0-9a-f-]{36}"/g)).toHaveLength(
      2,
    );

    const ids = db
      .query<{ id: string }, []>(
        'SELECT id FROM session ORDER BY created_at, rowid;',
      )
      .all()
      .map((row) => row.id);
    const revokeOne = await postForm(
      app,
      '/account/sessions',
      { revoke: ids[1] },
      first,
    );
    expect(revokeOne.statusCode).toBe(303);
    expect(revokeOne.headers.location).toBe('/account/sessions');
    const gone = await app.inject({
      method: 'GET',
      url: '/account/sessions',
      headers: { cookie: second },
    });
    expect(gone.statusCode).toBe(303);

    await postForm(app, '/account/sessions', { revoke: 'others' }, first);
    const thirdPage = await app.inject({
      method: 'GET',
      url: '/account/sessions',
      headers: { cookie: third },
    });
    expect(thirdPage.statusCode).toBe(303);
    // The other person keeps their session.
    const otherPage = await app.inject({
      method: 'GET',
      url: '/account/sessions',
      headers: { cookie: other },
    });
    expect(otherPage.statusCode).toBe(200);
    expect(count('session')).toBe(2);
  });

  test('the cookie is HttpOnly, SameSite=Lax and lasts 90 days', async () => {
    addPerson(db, 'a@example.com');
    await postForm(app, '/login', { email: 'a@example.com' });
    const { token } = lastLoginEmail('a@example.com');
    const response = await postForm(app, '/login/verify', { token });
    const cookie = sessionCookie(response);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.maxAge).toBe(90 * 24 * 60 * 60);
    expect(cookie?.path).toBe('/');
  });

  test('sign-in and sign-out go to audit_log', async () => {
    const cookie = await signIn(app, db, 'a@example.com');
    const out = await postForm(app, '/logout', {}, cookie);
    expect(out.statusCode).toBe(303);
    expect(out.headers.location).toBe('/login');
    expect(count('session')).toBe(0);
    const actions = db
      .query<{ action: string }, []>(
        'SELECT action FROM audit_log ORDER BY at, rowid;',
      )
      .all()
      .map((row) => row.action);
    expect(actions).toEqual(['sign_in', 'sign_out']);
  });
});

describe('?theme=bare', () => {
  test('each sign-in page shows its form with no page styles and no scripts (REQ-CRM-BARE-001)', async () => {
    // A second session, so the sessions page has its sign-out form.
    await signIn(app, db, 'a@example.com');
    const cookie = await signIn(app, db, 'a@example.com');
    const pages: [string, string][] = [
      ['/login?theme=bare', '<form action="/login" method="post">'],
      ['/login/code?theme=bare', '<form action="/login/code" method="post">'],
      [
        '/login/verify?token=t&theme=bare',
        '<form action="/login/verify" method="post">',
      ],
      [
        '/account/sessions?theme=bare',
        '<form action="/account/sessions" method="post">',
      ],
    ];
    for (const [url, form] of pages) {
      const page = await app.inject({
        method: 'GET',
        url,
        headers: { cookie },
      });
      expect(page.statusCode).toBe(200);
      expect(page.body).not.toContain('<link');
      expect(page.body).not.toContain('<script');
      expect(page.body).toContain(form);
    }
  });
});

describe('ensureAdmin', () => {
  test('makes the admin person once, and does nothing with no email', () => {
    ensureAdmin(db, undefined);
    expect(count('person')).toBe(0);
    ensureAdmin(db, 'Sean@Example.com');
    ensureAdmin(db, 'sean@example.com');
    expect(count('person')).toBe(1);
  });
});
