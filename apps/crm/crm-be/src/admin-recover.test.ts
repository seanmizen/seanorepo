import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recover } from './admin-recover';
import { RECOVERY_MINUTES, SESSION_COOKIE, SESSION_DAYS } from './auth';
import { openDatabase } from './db';
import type { buildApp } from './index';
import {
  addTestPasskey,
  cookieAfter,
  signInWithPasskey,
  TestAuthenticator,
} from './test-authenticator';
import {
  addPerson,
  postForm,
  signIn,
  TEST_ADMIN_EMAIL,
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

const count = (table: string) =>
  (db.query(`SELECT count(*) AS n FROM ${table};`).get() as { n: number }).n;

const get = (url: string, cookie?: string) =>
  app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

/** The admin with two passkeys and three sessions. */
const adminWithPasskeys = async () => {
  const cookie = await signIn(app, db, TEST_ADMIN_EMAIL);
  const first = new TestAuthenticator();
  await addTestPasskey(app, cookie, first);
  const { cookie: passkeyCookie } = await signInWithPasskey(app, first);
  await addTestPasskey(app, passkeyCookie, new TestAuthenticator());
  await signInWithPasskey(app, first);
  return { cookie, passkeyCookie };
};

describe('admin:recover', () => {
  test('removes the passkeys, revokes the sessions, and prints a single-use enrolment link', async () => {
    const { passkeyCookie } = await adminWithPasskeys();
    const other = await signIn(app, db, 'client@example.com');
    expect(count('passkey')).toBe(2);
    expect(count('session')).toBe(4);

    const link = new URL(recover(db, TEST_ADMIN_EMAIL));
    expect(link.pathname).toBe('/login/recover');
    expect(count('passkey')).toBe(0);
    // Only the session of the other person stays.
    expect(count('session')).toBe(1);
    expect((await get('/', passkeyCookie)).statusCode).toBe(303);
    expect((await get('/account/sessions', other)).statusCode).toBe(200);

    const row = db
      .query<{ action: string; detail: string }, []>(
        "SELECT action, detail FROM audit_log WHERE action = 'recover';",
      )
      .get();
    const detail = JSON.parse(row?.detail ?? '{}');
    expect(detail.passkeys_deleted).toHaveLength(2);
    expect(detail.sessions_revoked).toHaveLength(3);

    // A GET only shows the button.
    const token = link.searchParams.get('token') ?? '';
    const page = await get(`${link.pathname}${link.search}`);
    expect(page.statusCode).toBe(200);
    expect(page.cookies).toEqual([]);
    expect(page.body).toContain('<form action="/login/recover" method="post">');

    const started = await postForm(app, '/login/recover', { token });
    expect(started.statusCode).toBe(303);
    expect(started.headers.location).toBe('/account/passkeys');
    const cookie = started.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie?.maxAge).toBe(RECOVERY_MINUTES * 60);
    const again = await postForm(app, '/login/recover', { token });
    expect(again.statusCode).toBe(400);
  });

  test('the recovery session opens only /account/passkeys, and its first passkey makes it a passkey session', async () => {
    await adminWithPasskeys();
    const token =
      new URL(recover(db, TEST_ADMIN_EMAIL)).searchParams.get('token') ?? '';
    const started = await postForm(app, '/login/recover', { token });
    const value = started.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
    const cookie = `${SESSION_COOKIE}=${value}`;

    expect((await get('/account/passkeys', cookie)).body).toContain(
      'This recovery session can only add a passkey,',
    );
    for (const url of ['/', '/account/sessions']) {
      const page = await get(url, cookie);
      expect(page.statusCode).toBe(303);
      expect(page.headers.location).toBe('/account/passkeys');
    }

    const key = new TestAuthenticator();
    const added = await addTestPasskey(app, cookie, key);
    expect(added.statusCode).toBe(200);
    // The first passkey makes the recovery session a passkey session, with a
    // new token, for SESSION_DAYS. It opens the admin pages now.
    const upgraded = cookieAfter(added, cookie);
    expect(added.cookies.find((c) => c.name === SESSION_COOKIE)?.maxAge).toBe(
      SESSION_DAYS * 24 * 60 * 60,
    );
    expect((await get('/', upgraded)).statusCode).toBe(200);
    expect((await get('/', cookie)).statusCode).toBe(303);
    const { response } = await signInWithPasskey(app, key);
    expect(response.statusCode).toBe(200);

    const actions = db
      .query<{ action: string; detail: string | null }, []>(
        'SELECT action, detail FROM audit_log ORDER BY at, rowid;',
      )
      .all()
      .slice(-4);
    expect(actions.map((row) => row.action)).toEqual([
      'sign_in',
      'passkey_add',
      'session_upgrade',
      'sign_in',
    ]);
    expect(actions[0].detail).toBe('{"method":"recovery"}');
    expect(actions[2].detail).toBe('{"from":"recovery","to":"passkey"}');
  });

  test('an expired enrolment link fails', async () => {
    addPerson(db, TEST_ADMIN_EMAIL);
    const token =
      new URL(recover(db, TEST_ADMIN_EMAIL)).searchParams.get('token') ?? '';
    db.query('UPDATE recovery_token SET expires_at = ?;').run(
      new Date(Date.now() - 1000).toISOString(),
    );
    const response = await postForm(app, '/login/recover', { token });
    expect(response.statusCode).toBe(400);
    expect(response.cookies).toEqual([]);
  });

  test('an unknown email throws', () => {
    expect(() => recover(db, 'nobody@example.com')).toThrow(
      'No person has the email',
    );
  });

  test('`bun run admin:recover <email>` prints the link', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crm-recover-'));
    const file = path.join(dir, 'crm.db');
    const cliDb = openDatabase(file);
    addPerson(cliDb, TEST_ADMIN_EMAIL);
    cliDb.close();
    const run = Bun.spawnSync(
      ['bun', 'run', 'admin:recover', TEST_ADMIN_EMAIL],
      {
        cwd: path.join(import.meta.dir, '..'),
        env: { ...process.env, DB_PATH: file },
      },
    );
    rmSync(dir, { recursive: true, force: true });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toMatch(/\/login\/recover\?token=\S+/);
  });
});
