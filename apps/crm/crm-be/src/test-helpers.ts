import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hash, newToken, SESSION_COOKIE } from './auth';
import { openDatabase } from './db';
import { devOutbox } from './email';
import { buildApp } from './index';

/** The admin email in tests. testApp() sets CRM_ADMIN_EMAIL to it. */
export const TEST_ADMIN_EMAIL = 'admin@example.com';

/** The database of each test app, for signInAdmin(app). */
const databases = new WeakMap<ReturnType<typeof buildApp>, Database>();

/**
 * A fresh app on a fresh SQLite file in a temp folder, with TEST_ADMIN_EMAIL
 * as the admin. Call `close()` at the end of the test.
 */
export const testApp = () => {
  process.env.CRM_ADMIN_EMAIL = TEST_ADMIN_EMAIL;
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-test-'));
  const db = openDatabase(path.join(dir, 'crm.db'));
  const app = buildApp(db);
  databases.set(app, db);
  const close = async () => {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { app, db, close };
};

/**
 * POST `fields` to `url` as a form (`application/x-www-form-urlencoded`), the
 * same as a browser `<form method="post">`. `cookie` is optional.
 */
export const postForm = (
  app: ReturnType<typeof buildApp>,
  url: string,
  fields: Record<string, string>,
  cookie?: string,
) =>
  app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    payload: new URLSearchParams(fields).toString(),
  });

/**
 * Add an organisation through `POST /orgs/new`, as the person of `cookie`.
 * Returns its slug.
 */
export const addOrg = async (
  app: ReturnType<typeof buildApp>,
  cookie: string,
  fields: Record<string, string>,
) => {
  const response = await postForm(app, '/orgs/new', fields, cookie);
  if (response.statusCode !== 303) {
    throw new Error(`POST /orgs/new returned ${response.statusCode}.`);
  }
  return String(response.headers.location).slice(1);
};

/** The text that a person reads in the `<body>`, with no markup. */
export const bodyText = (html: string) =>
  html
    .slice(Math.max(0, html.indexOf('<body>')))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The element that starts at the first `<div class="${className}">` of
 * `html`, to its matching `</div>`. Returns '' when there is none.
 */
export const divOf = (html: string, className: string) => {
  const start = html.indexOf(`<div class="${className}">`);
  if (start === -1) return '';
  const tags = /<div[\s>]|<\/div>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  throw new Error(`The <div class="${className}"> has no end.`);
};

/** Add a person with this email. Returns the person id. */
export const addPerson = (db: Database, email: string) => {
  const id = crypto.randomUUID();
  db.query('INSERT INTO person (id, email, name) VALUES (?, ?, ?);').run(
    id,
    email,
    email,
  );
  return id;
};

/**
 * The link, the token and the code from the last sign-in email to `email` in
 * the dev-mode outbox.
 */
export const lastLoginEmail = (email: string) => {
  const sent = devOutbox.filter((item) => item.to === email).at(-1);
  if (!sent) throw new Error(`No email to ${email} in devOutbox.`);
  const url = new URL(sent.text.match(/https?:\/\/\S+/)?.[0] ?? '');
  const code = sent.text.match(/code on the sign-in page: (\d{6})/)?.[1] ?? '';
  return { url, token: url.searchParams.get('token') ?? '', code };
};

/**
 * Sign in as `email` through the real email-link flow. Adds the person if it
 * is missing. Returns the `cookie` header value for the next requests.
 */
export const signIn = async (
  app: ReturnType<typeof buildApp>,
  db: Database,
  email: string,
) => {
  const known = db.query('SELECT id FROM person WHERE email = ?;').get(email);
  if (!known) addPerson(db, email);
  await postForm(app, '/login', { email });
  const { token } = lastLoginEmail(email);
  const response = await postForm(app, '/login/verify', { token });
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error(`Sign-in as ${email} set no session cookie.`);
  return `${SESSION_COOKIE}=${cookie.value}`;
};

/**
 * A session for the admin (TEST_ADMIN_EMAIL), as if a passkey sign-in made
 * it. It adds the admin person if it is missing, and puts the session row
 * into the database directly: a test has no WebAuthn. Returns the `cookie`
 * header value. Use it for an admin route (`config: { admin: true }`).
 */
export const signInAdmin = (
  app: ReturnType<typeof buildApp>,
  db = databases.get(app),
) => {
  if (!db) throw new Error('signInAdmin needs an app from testApp().');
  const known = db
    .query<{ id: string }, [string]>('SELECT id FROM person WHERE email = ?;')
    .get(TEST_ADMIN_EMAIL);
  const personId = known?.id ?? addPerson(db, TEST_ADMIN_EMAIL);
  const token = newToken();
  db.query(
    `INSERT INTO session (id, person_id, token_hash, expires_at, method)
     VALUES (?, ?, ?, ?, 'passkey');`,
  ).run(
    crypto.randomUUID(),
    personId,
    hash(token),
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  );
  return `${SESSION_COOKIE}=${token}`;
};
