import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { buildApp } from './index';
import { FE_DIST } from './render';
import {
  addTestPasskey,
  cookieAfter,
  postJson,
  signInWithPasskey,
  TestAuthenticator,
} from './test-authenticator';
import {
  postForm,
  signIn,
  signInAdmin,
  TEST_ADMIN_EMAIL,
  testApp,
} from './test-helpers';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;

beforeEach(() => {
  ({ app, db, close } = testApp());
  // A test-only admin route. Only the admin in a passkey session opens it.
  app.get('/test/admin', { config: { admin: true } }, async () => 'admin ok');
});

afterEach(async () => {
  await close();
});

const get = (url: string, cookie?: string) =>
  app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

const auditActions = () =>
  db
    .query<{ action: string; detail: string | null }, []>(
      'SELECT action, detail FROM audit_log ORDER BY at, rowid;',
    )
    .all();

describe('/account/passkeys', () => {
  test('a client adds a passkey with a name, sees its last-used date, and deletes it', async () => {
    let cookie = await signIn(app, db, 'client@example.com');
    const key = new TestAuthenticator();

    const empty = await get('/account/passkeys', cookie);
    expect(empty.statusCode).toBe(200);
    expect(empty.body).toContain('You have no passkeys.');

    const added = await addTestPasskey(app, cookie, key, 'My phone');
    expect(added.statusCode).toBe(200);
    // The first passkey makes this session a passkey session, with a new
    // token.
    cookie = cookieAfter(added, cookie);
    const listed = await get('/account/passkeys', cookie);
    expect(listed.body).toContain('<td data-label="Name">My phone</td>');
    expect(listed.body).toContain('<td data-label="Last used">Never</td>');

    const { cookie: passkeyCookie } = await signInWithPasskey(app, key);
    expect(passkeyCookie).not.toBe('');
    const used = await get('/account/passkeys', passkeyCookie);
    expect(used.body).not.toContain('<td data-label="Last used">Never</td>');
    expect(used.body).toMatch(
      /<td data-label="Last used"><time dateTime="\d{4}-\d\d-\d\dT[^"]+"/,
    );

    const deleted = await postForm(
      app,
      '/account/passkeys',
      { delete: key.id },
      cookie,
    );
    expect(deleted.statusCode).toBe(303);
    expect(deleted.headers.location).toBe('/account/passkeys');
    expect((await get('/account/passkeys', cookie)).body).toContain(
      'You have no passkeys.',
    );
    expect(auditActions().map((row) => row.action)).toEqual([
      'sign_in',
      'passkey_add',
      'session_upgrade',
      'sign_in',
      'passkey_delete',
    ]);
  });

  test('a person cannot delete the passkey of a different person', async () => {
    const a = await signIn(app, db, 'a@example.com');
    const b = await signIn(app, db, 'b@example.com');
    const key = new TestAuthenticator();
    await addTestPasskey(app, a, key);
    await postForm(app, '/account/passkeys', { delete: key.id }, b);
    const row = db.query('SELECT id FROM passkey WHERE id = ?;').get(key.id);
    expect(row).not.toBeNull();
  });

  test('a passkey needs a name', async () => {
    const cookie = await signIn(app, db, 'a@example.com');
    const response = await addTestPasskey(
      app,
      cookie,
      new TestAuthenticator(),
      '  ',
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Type a name');
  });

  test('a response from a different origin is refused', async () => {
    const cookie = await signIn(app, db, 'a@example.com');
    const response = await addTestPasskey(
      app,
      cookie,
      new TestAuthenticator('https://evil.example'),
    );
    expect(response.statusCode).toBe(400);
    expect(db.query('SELECT id FROM passkey;').all()).toEqual([]);
  });
});

describe('passkey sign-in', () => {
  test('starts a passkey session and returns next', async () => {
    const cookie = await signIn(app, db, 'a@example.com');
    const key = new TestAuthenticator();
    await addTestPasskey(app, cookie, key);
    const { response, cookie: passkeyCookie } = await signInWithPasskey(
      app,
      key,
      '/account/sessions',
    );
    expect(response.statusCode).toBe(200);
    expect(response.json<{ next: string }>()).toEqual({
      next: '/account/sessions',
    });
    expect((await get('/account/sessions', passkeyCookie)).statusCode).toBe(
      200,
    );
    const methods = db
      .query<{ method: string }, []>(
        'SELECT method FROM session ORDER BY created_at, rowid;',
      )
      .all()
      .map((row) => row.method);
    // The first session became a passkey session when it added the passkey.
    expect(methods).toEqual(['passkey', 'passkey']);
    expect(auditActions().at(-1)?.detail).toBe('{"method":"passkey"}');
  });

  test('a sign-in with another host in next returns /', async () => {
    const cookie = await signIn(app, db, 'a@example.com');
    const key = new TestAuthenticator();
    await addTestPasskey(app, cookie, key);
    const { response } = await signInWithPasskey(app, key, '//evil.example');
    expect(response.json<{ next: string }>()).toEqual({ next: '/' });
  });

  test('each challenge works one time, for 5 minutes', async () => {
    const cookie = await signIn(app, db, 'a@example.com');
    const key = new TestAuthenticator();
    await addTestPasskey(app, cookie, key);

    const options = (
      await postJson(app, '/api/passkeys/sign-in-options', {})
    ).json();
    const first = await postJson(app, '/api/passkeys/sign-in', {
      response: key.signIn(options),
    });
    expect(first.statusCode).toBe(200);
    const again = await postJson(app, '/api/passkeys/sign-in', {
      response: key.signIn(options),
    });
    expect(again.statusCode).toBe(400);

    const late = (
      await postJson(app, '/api/passkeys/sign-in-options', {})
    ).json();
    db.query('UPDATE webauthn_challenge SET expires_at = ?;').run(
      new Date(Date.now() - 1000).toISOString(),
    );
    const expired = await postJson(app, '/api/passkeys/sign-in', {
      response: key.signIn(late),
    });
    expect(expired.statusCode).toBe(400);
    expect(expired.cookies).toEqual([]);
  });

  test('an unknown passkey gets 400', async () => {
    const { response, cookie } = await signInWithPasskey(
      app,
      new TestAuthenticator(),
    );
    expect(response.statusCode).toBe(400);
    expect(cookie).toBe('');
  });
});

describe('the admin pages', () => {
  const sessionMethods = () =>
    db
      .query<{ method: string }, []>(
        'SELECT method FROM session ORDER BY created_at, rowid;',
      )
      .all()
      .map((row) => row.method);

  test('signInAdmin gives a session that opens an admin route', async () => {
    const response = await get('/test/admin', signInAdmin(app));
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('admin ok');
  });

  test('an email session of the admin with no passkey gets the add-passkey step at the same URL, and the first passkey opens the page', async () => {
    const cookie = await signIn(app, db, TEST_ADMIN_EMAIL);
    const page = await get('/', cookie);
    expect(page.statusCode).toBe(403);
    expect(page.headers.location).toBeUndefined();
    expect(page.body).toContain('<title>Passkey needed - crm</title>');
    expect(page.body).toContain(
      'This page needs a passkey. Add one to this device.',
    );
    expect(page.body).toContain(
      '<form hidden="" data-passkey="register" data-next="/">',
    );

    const passkeys = await get('/account/passkeys', cookie);
    expect(passkeys.body).toContain(
      'The admin pages need a passkey, so add one to this device',
    );
    expect(passkeys.body).not.toContain('sign out and sign in');

    const added = await addTestPasskey(
      app,
      cookie,
      new TestAuthenticator(),
      'Phone',
      '/',
    );
    expect(added.statusCode).toBe(200);
    expect(added.json<{ next: string }>()).toEqual({ next: '/' });
    const upgraded = cookieAfter(added, cookie);
    expect(upgraded).not.toBe(cookie);
    expect((await get('/', upgraded)).statusCode).toBe(200);
    // The same session, with a new token: the old cookie stops working.
    expect(sessionMethods()).toEqual(['passkey']);
    expect((await get('/orgs', cookie)).statusCode).toBe(303);
    expect(auditActions().slice(-2)).toEqual([
      expect.objectContaining({ action: 'passkey_add' }),
      { action: 'session_upgrade', detail: '{"from":"email","to":"passkey"}' },
    ]);
  });

  test('the add-passkey step returns only a local next', async () => {
    const cookie = await signIn(app, db, TEST_ADMIN_EMAIL);
    const added = await addTestPasskey(
      app,
      cookie,
      new TestAuthenticator(),
      'Phone',
      '//evil.example',
    );
    expect(added.json<{ next: string }>()).toEqual({ next: '/' });
  });

  test('an email session of the admin with a passkey gets the passkey sign-in step, and cannot change passkeys', async () => {
    const first = await signIn(app, db, TEST_ADMIN_EMAIL);
    const key = new TestAuthenticator();
    await addTestPasskey(app, first, key);
    const cookie = await signIn(app, db, TEST_ADMIN_EMAIL);

    const page = await get('/test/admin?x=1', cookie);
    expect(page.statusCode).toBe(403);
    expect(page.headers.location).toBeUndefined();
    expect(page.body).toContain('This page needs a passkey sign-in.');
    expect(page.body).toContain(
      'data-passkey="sign-in" data-next="/test/admin?x=1"',
    );
    expect(page.body).toContain('Sign in with a passkey');

    // A second passkey needs a passkey session.
    const second = await addTestPasskey(app, cookie, new TestAuthenticator());
    expect(second.statusCode).toBe(403);
    const list = await get('/account/passkeys', cookie);
    expect(list.body).toContain(
      'To add or delete a passkey, sign in with a passkey.',
    );
    expect(list.body).not.toContain('data-passkey="register"');
    const deleted = await postForm(
      app,
      '/account/passkeys',
      { delete: key.id },
      cookie,
    );
    expect(deleted.statusCode).toBe(403);
    expect(db.query('SELECT id FROM passkey;').all()).toHaveLength(1);
  });

  test('a passkey sign-in from an email session replaces that session', async () => {
    const first = await signIn(app, db, TEST_ADMIN_EMAIL);
    const key = new TestAuthenticator();
    await addTestPasskey(app, first, key);
    const cookie = await signIn(app, db, TEST_ADMIN_EMAIL);
    const emailSession = db
      .query<{ id: string }, []>(
        "SELECT id FROM session WHERE method = 'email';",
      )
      .get()?.id;

    const { response, cookie: passkeyCookie } = await signInWithPasskey(
      app,
      key,
      '/test/admin?x=1',
      cookie,
    );
    expect(response.json<{ next: string }>()).toEqual({
      next: '/test/admin?x=1',
    });
    expect((await get('/test/admin?x=1', passkeyCookie)).statusCode).toBe(200);
    expect(
      db.query('SELECT id FROM session WHERE id = ?;').get(emailSession ?? ''),
    ).toBeNull();
    expect(sessionMethods()).toEqual(['passkey', 'passkey']);
    expect((await get('/account/sessions', cookie)).statusCode).toBe(303);
    expect(JSON.parse(auditActions().at(-1)?.detail ?? '{}')).toEqual({
      method: 'passkey',
      replaced: emailSession,
    });
  });

  test('a passkey session of the admin opens the admin route and can change passkeys', async () => {
    const cookie = await signIn(app, db, TEST_ADMIN_EMAIL);
    const key = new TestAuthenticator();
    await addTestPasskey(app, cookie, key);
    const { cookie: passkeyCookie } = await signInWithPasskey(app, key);
    expect((await get('/test/admin', passkeyCookie)).statusCode).toBe(200);
    const second = await addTestPasskey(
      app,
      passkeyCookie,
      new TestAuthenticator(),
    );
    expect(second.statusCode).toBe(200);
  });

  test('a different person gets the admin-only page, in an email or a passkey session', async () => {
    const cookie = await signIn(app, db, 'client@example.com');
    const email = await get('/', cookie);
    expect(email.statusCode).toBe(403);
    expect(email.headers.location).toBeUndefined();
    expect(email.body).toContain('This page is for the admin only.');
    expect(email.body).not.toContain('data-passkey');

    const key = new TestAuthenticator();
    await addTestPasskey(app, cookie, key);
    const { cookie: passkeyCookie } = await signInWithPasskey(app, key);
    const page = await get('/test/admin', passkeyCookie);
    expect(page.statusCode).toBe(403);
    expect(page.body).toContain('This page is for the admin only.');
  });

  test('a signed-out visitor goes to /login', async () => {
    const page = await get('/test/admin');
    expect(page.statusCode).toBe(303);
    expect(page.headers.location).toBe('/login?next=%2Ftest%2Fadmin');
  });
});

describe('the passkey script', () => {
  const passkeysScript = () =>
    JSON.parse(readFileSync(path.join(FE_DIST, 'manifest.json'), 'utf8'))
      .entries.passkeys.initial.js as string[];

  test('only the pages with a passkey control load it', async () => {
    const cookie = await signIn(app, db, 'a@example.com');
    const admin = await signIn(app, db, TEST_ADMIN_EMAIL);
    const [script] = passkeysScript();
    expect((await get('/login')).body).toContain(`<script src="${script}"`);
    expect((await get('/account/passkeys', cookie)).body).toContain(
      `<script src="${script}"`,
    );
    expect((await get('/', admin)).body).toContain(`<script src="${script}"`);
    expect((await get('/account/sessions', cookie)).body).not.toContain(
      `<script src="${script}"`,
    );
    expect((await get('/', cookie)).body).not.toContain(
      `<script src="${script}"`,
    );
  });

  test('with no JavaScript, each page says that passkeys need JavaScript, and email sign-in still works (REQ-CRM-BARE-001)', async () => {
    const login = (await get('/login?theme=bare')).body;
    expect(login).not.toContain('<script');
    expect(login).toContain('Passkeys need JavaScript.');
    expect(login).toContain('<form action="/login" method="post">');
    // The passkey button is hidden until the script shows it.
    expect(login).toMatch(/<button type="button" class="key" hidden=""/);

    const cookie = await signIn(app, db, 'a@example.com');
    const passkeys = (await get('/account/passkeys?theme=bare', cookie)).body;
    expect(passkeys).not.toContain('<script');
    expect(passkeys).toContain('Passkeys need JavaScript.');
    expect(passkeys).toContain(
      '<form hidden="" data-passkey="register" data-next="/account/passkeys">',
    );

    const admin = await signIn(app, db, TEST_ADMIN_EMAIL);
    const step = (await get('/?theme=bare', admin)).body;
    expect(step).not.toContain('<script');
    expect(step).toContain('Passkeys need JavaScript.');
    expect(step).toContain(
      '<form hidden="" data-passkey="register" data-next="/?theme=bare">',
    );
  });
});
