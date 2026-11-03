import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from './index';
import { PAGE_SIZE } from './routes/index';
import { addTestPasskey, TestAuthenticator } from './test-authenticator';
import { signIn, signInAdmin, TEST_ADMIN_EMAIL, testApp } from './test-helpers';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;

beforeEach(() => {
  ({ app, db, close } = testApp());
});

afterEach(async () => {
  delete process.env.CRM_UNSAFE_DEMO_LOGIN;
  await close();
});

const get = async (url: string, cookie?: string) =>
  (await app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} }))
    .body;

/** The attributes of a tag, by name. */
const attrsOf = (tag: string) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );

/**
 * Check the button `id` with `label` on `html`: it is present. When it is
 * off, it has the native `disabled`, its reason is in `title`, and the
 * element that `aria-describedby` names has the same text. Returns the
 * reason, or null when the button is on.
 */
const reason = (html: string, id: string, label: string) => {
  const tag = html.match(
    new RegExp(`<button[^>]* id="${id}"[^>]*>${label}</button>`),
  )?.[0];
  expect(`${id}: ${tag ? 'present' : 'missing'}`).toBe(`${id}: present`);
  const attrs = attrsOf(String(tag));
  if (!('disabled' in attrs)) return null;
  expect(attrs.title).toBeTruthy();
  const why = attrs['aria-describedby'];
  expect(why).toBeTruthy();
  const text = html.match(
    new RegExp(`<(?:span|p) [^>]*id="${why}"[^>]*>([^<]*)</(?:span|p)>`),
  )?.[1];
  expect(text).toBe(attrs.title);
  return attrs.title;
};

/** Add `count` organisations with no activity. */
const addOrgs = (count: number) => {
  const rows = Array.from({ length: count }, (_, i) => {
    const n = String(i).padStart(2, '0');
    return `('id-${n}', 'org-${n}', 'Org ${n}', 'lead', '2026-01-01T10:00:${n}.000Z')`;
  });
  db.exec(
    `INSERT INTO organisation (id, slug, name, stage, created_at) VALUES ${rows.join(', ')};`,
  );
};

describe('each button that cannot act (REQ-CRM-BUTTON-001)', () => {
  test('each button is present in each state, and an off button has the native disabled, and its reason in title and in its accessible description (REQ-CRM-BUTTON-001)', async () => {
    const admin = signInAdmin(app);

    // The pager: an empty list, the first page and the last page.
    const pager = async (url: string) => {
      const html = await get(url, admin);
      return [
        html.includes('rel="prev"')
          ? 'link'
          : reason(html, 'page-previous', 'previous'),
        html.includes('rel="next"')
          ? 'link'
          : reason(html, 'page-next', 'next'),
      ];
    };
    const FIRST = 'This is the first page.';
    const LAST = 'This is the last page.';
    expect(await pager('/')).toEqual([FIRST, LAST]);
    addOrgs(PAGE_SIZE + 1);
    expect(await pager('/')).toEqual([FIRST, 'link']);
    expect(await pager('/orgs?page=2')).toEqual(['link', LAST]);

    // The sessions: "Everywhere else", and Revoke of this session.
    const sessions = async (cookie: string) => {
      const html = await get('/account/sessions', cookie);
      return [
        reason(html, 'revoke-others', 'Everywhere else'),
        reason(html, 'revoke-this', 'Revoke'),
      ];
    };
    const THIS = 'You use this session now. To end it, tap sign out.';
    const person = await signIn(app, db, 'a@example.com');
    expect(await sessions(person)).toEqual([
      'No other session is signed in.',
      THIS,
    ]);
    await signIn(app, db, 'a@example.com');
    expect(await sessions(person)).toEqual([null, THIS]);

    // Reset demo data: off on the live site, on in the demo.
    const reset = async () =>
      reason(await get('/account', admin), 'reset-demo', 'Reset demo data');
    expect(await reset()).toBe('Only the demo site has demo data.');
    process.env.CRM_UNSAFE_DEMO_LOGIN = 'true';
    expect(await reset()).toBeNull();
    delete process.env.CRM_UNSAFE_DEMO_LOGIN;

    // The passkey keys. With no JavaScript, each one is off, and the note
    // that says passkeys need JavaScript is its reason. The script turns it
    // on (crm-fe/src/passkeys.ts).
    const NO_JS =
      'Passkeys need JavaScript. Turn on JavaScript to add a passkey.';
    const passkeys = async (cookie: string) => {
      const html = await get('/account/passkeys', cookie);
      return [
        reason(html, 'passkey-add', 'Add a passkey'),
        ...(html.includes('id="delete-1"')
          ? [reason(html, 'delete-1', 'Delete')]
          : []),
      ];
    };
    expect(await passkeys(person)).toEqual([NO_JS]);
    expect(
      reason(await get('/login'), 'passkey-sign-in', 'Sign in with a passkey'),
    ).toBe(
      'Passkeys need JavaScript. Use the email form, or turn on JavaScript.',
    );
    // An email session of an admin with a passkey cannot add or delete one.
    const email = await signIn(app, db, TEST_ADMIN_EMAIL);
    await addTestPasskey(app, email, new TestAuthenticator());
    const later = await signIn(app, db, TEST_ADMIN_EMAIL);
    expect(await passkeys(later)).toEqual([
      'To add a passkey, sign in with a passkey.',
      'To delete a passkey, sign in with a passkey.',
    ]);
    // A passkey session can: Add waits for the script, Delete is on.
    expect(await passkeys(admin)).toEqual([NO_JS, null]);

    // A link that cannot sign in or start a recovery.
    expect(reason(await get('/login/verify'), 'sign-in', 'Sign in')).toBe(
      'This link is not complete.',
    );
    expect(
      reason(await get('/login/verify?token=x'), 'sign-in', 'Sign in'),
    ).toBeNull();
    expect(
      reason(await get('/login/recover'), 'start-recovery', 'Start recovery'),
    ).toBe('This link is not complete.');

    // The consent page of an app that the crm does not know.
    const UNKNOWN =
      'The crm does not know this app. Add the connection again in the app.';
    const consent = await get(
      '/account/connections/authorize?response_type=code&client_id=nobody&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback',
      admin,
    );
    expect([
      reason(consent, 'allow', 'Allow'),
      reason(consent, 'deny', 'Deny'),
    ]).toEqual([UNKNOWN, UNKNOWN]);
  });
});
