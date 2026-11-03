import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { buildApp } from './index';
import { FE_DIST } from './render';
import {
  addTestPasskey,
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
    const cookie = await signIn(app, db, 'client@example.com');
    const key = new TestAuthenticator();

    const empty = await get('/account/passkeys', cookie);
    expect(empty.statusCode).toBe(200);
    expect(empty.body).toContain('You have no passkeys.');

    const added = await addTestPasskey(app, cookie, key, 'My phone');
    expect(added.statusCode).toBe(200);
    const listed = await get('/account/passkeys', cookie);
    expect(listed.body).toContain('<td>My phone</td>');
    expect(listed.body).toContain('<td>Never</td>');

    const { cookie: passkeyCookie } = await signInWithPasskey(app, key);
    expect(passkeyCookie).not.toBe('');
    const used = await get('/account/passkeys', passkeyCookie);
    expect(used.body).not.toContain('<td>Never</td>');
    expect(used.body).toMatch(/<td><time dateTime="\d{4}-\d\d-\d\dT[^"]+">/);

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
    expect(methods).toEqual(['email', 'passkey']);
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
  test('signInAdmin gives a session that opens an admin route', async () => {
    const response = await get('/test/admin', signInAdmin(app));
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('admin ok');
  });

  test('an email session of the admin with no passkey goes to /account/passkeys and can add the first one', async () => {
    const cookie = await signIn(app, db, TEST_ADMIN_EMAIL);
    const page = await get('/test/admin', cookie);
    expect(page.statusCode).toBe(303);
    expect(page.headers.location).toBe('/account/passkeys');
    const passkeys = await get('/account/passkeys', cookie);
    expect(passkeys.body).toContain('You are the admin.');

    const added = await addTestPasskey(app, cookie, new TestAuthenticator());
    expect(added.statusCode).toBe(200);
    // One passkey now, so the email session can add no more.
    const second = await addTestPasskey(app, cookie, new TestAuthenticator());
    expect(second.statusCode).toBe(403);
  });

  test('an email session of the admin with a passkey gets 403, and cannot change passkeys', async () => {
    const cookie = await signIn(app, db, TEST_ADMIN_EMAIL);
    const key = new TestAuthenticator();
    await addTestPasskey(app, cookie, key);

    const page = await get('/test/admin', cookie);
    expect(page.statusCode).toBe(403);
    expect(page.body).toContain('<a href="/account/passkeys">');
    expect(page.body).toContain('signed in with a passkey');

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

  test('a passkey session of a different person gets 403', async () => {
    const cookie = await signIn(app, db, 'client@example.com');
    const key = new TestAuthenticator();
    await addTestPasskey(app, cookie, key);
    const { cookie: passkeyCookie } = await signInWithPasskey(app, key);
    const page = await get('/test/admin', passkeyCookie);
    expect(page.statusCode).toBe(403);
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

  test('only the sign-in page and the passkeys page load it', async () => {
    const cookie = await signIn(app, db, 'a@example.com');
    const [script] = passkeysScript();
    expect((await get('/login')).body).toContain(`<script src="${script}"`);
    expect((await get('/account/passkeys', cookie)).body).toContain(
      `<script src="${script}"`,
    );
    expect((await get('/account/sessions', cookie)).body).not.toContain(
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
    expect(passkeys).toContain('<form hidden="" data-passkey="register">');
  });
});
