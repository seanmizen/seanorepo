#!/usr/bin/env node
/*
 * A browser test of the morph (crm-fe/src/morph.ts, REQ-CRM-MORPH-001).
 *
 * Where: run from the repo root, after `yarn`:
 *   node apps/crm/scripts/morph-test.mjs
 * When: after a change to morph.ts, to a form or a link of a page, or to the
 * search, the stage keys, the sort keys or the pager of the list (/ and
 * /orgs).
 * Why: the morph runs in the browser, so a test of the HTML cannot show it.
 * The script builds crm-fe, starts crm-be on PORT (default 4127) with a new
 * SQLite file in a temp folder, and puts four organisations and an admin
 * passkey session in it. It touches no other database. Then Playwright
 * (from the repo node_modules) checks these steps in Chromium. A mark on
 * `window` from before a press shows that the page did not load again.
 *
 * 1. Type `sw11` in the search field and press Enter. The URL has
 *    `q=sw11`, the list shows only the rows that match, and the focus and
 *    the caret stay in the search field.
 * 2. Tap a stage key, then a sort key. Each one updates the list and the
 *    URL in place, and the key that had the focus has it again. The arrow
 *    of the order on the LCD legend moves in place: from Next action to
 *    Organisation, in the arrow column, and from `▲` to `▼`.
 * 3. On an organisation page in a short window, scroll down, type a note
 *    and tap a Log key. The note saves, the page does not load again, the
 *    Log key keeps the focus, the scroll position does not change, and the
 *    history has no new entry (the post redirects to the same URL).
 * 4. Open an organisation from the list. The URL goes into history. Back
 *    shows the list, and Forward shows the organisation, with no load.
 *    A link from /account to /account/passkeys adds the passkey script,
 *    and the Add a passkey key turns on. After one more morph of the same
 *    page, the key is still on.
 * 5. When the fetch of a press fails, the browser sends the same post as a
 *    normal submit, so the note still saves.
 * 6. With `?theme=bare` (no scripts), and with JavaScript off, the search
 *    and a Log press load the full page and still work.
 *
 * The script exits with 1 on a failure. At the end it stops crm-be and
 * deletes the database.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const CRM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4127);
const BASE = `http://localhost:${PORT}`;
const ADMIN = 'admin@example.com';
const dataDir = mkdtempSync(path.join(tmpdir(), 'crm-morph-db-'));
const dbPath = path.join(dataDir, 'crm.db');

/** Run SQL on the temp database. */
const sql = (text) => execFileSync('sqlite3', [dbPath, text]);
/** A SQL string literal. */
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** The organisations: [name, postcode, stage]. Two match `sw11`. */
const ORGS = [
  ['Battersea Bakery', 'SW11 1AA', 'lead'],
  ['Clapham Cafe', 'SW4 0AA', 'lead'],
  ['Lavender Hill Florist', 'sw11 5bb', 'quoted'],
  ['East End Garage', 'E1 6AN', 'lead'],
];

const seed = (token) => {
  const hash = createHash('sha256').update(token).digest('hex');
  const admin = `(SELECT id FROM person WHERE email = ${q(ADMIN)})`;
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const rows = ORGS.map(
    ([name, postcode, stage]) =>
      `INSERT INTO organisation (id, slug, name, postcode, stage, lawful_basis, source, created_at)
       VALUES (${q(randomUUID())}, ${q(name.toLowerCase().replaceAll(' ', '-'))}, ${q(name)}, ${q(postcode)}, ${q(stage)}, 'legitimate_interests', 'door', ${q(now)});`,
  );
  rows.push(
    `INSERT INTO passkey (id, person_id, name, public_key, created_at, last_used_at)
     VALUES ('morph-passkey', ${admin}, 'iPhone', x'00', ${q(now)}, ${q(now)});`,
    `INSERT INTO session (id, person_id, token_hash, user_agent, created_at, expires_at, method)
     VALUES (${q(randomUUID())}, ${admin}, ${q(hash)}, 'Morph test', ${q(now)}, ${q(later)}, 'passkey');`,
  );
  sql(rows.join('\n'));
};

const waitForHealth = async () => {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`crm-be did not answer on ${BASE}.`);
};

/** The names in the list, in order. */
const names = (page) => page.locator('.lcd .menu .name').allTextContents();

/** The search field has the focus, with the caret at the end of `text`. */
const searchHasFocus = (page, text) =>
  page.evaluate((length) => {
    const field = document.activeElement;
    return (
      field instanceof HTMLInputElement &&
      field.name === 'q' &&
      field.selectionStart === length &&
      field.selectionEnd === length
    );
  }, text.length);

/** The organisation page of the test: Battersea Bakery. */
const ORG = '/orgs/battersea-bakery';

/** The number of events in the Activity box. */
const events = (page) => page.locator('.events ol li').count();

/** Type `note` in the Log module, then tap its `Note only` key. */
const logNote = async (page, note) => {
  await page.locator('textarea[name="note"]').fill(note);
  await page.getByRole('button', { name: 'Note only', exact: true }).click();
};

/** Wait until the Activity box has `count` events. */
const waitForEvents = (page, count) =>
  page.waitForFunction(
    (n) => document.querySelectorAll('.events ol li').length === n,
    count,
  );

/** The text of the element that has the focus. */
const focusText = (page) =>
  page.evaluate(() => document.activeElement?.firstChild?.textContent);

/**
 * The arrows of the order on the LCD legend: the arrow in the arrow column
 * of the name legend (`none` when it is blank), and the value and status
 * legends, which hold their arrow in their text. `left` is the left edge of
 * the arrow in the name legend, and `arrowColumn` is the left edge of the
 * arrow column of the first row. They are equal when the arrow is in the
 * arrow column.
 */
const arrows = (page) =>
  page.evaluate(() => {
    const menu = document.querySelector('.lcd .menu');
    const row = menu.querySelector('li');
    const arrow = getComputedStyle(row, '::before');
    const menuLeft = menu.getBoundingClientRect().left;
    return {
      name: arrow.content,
      value: menu.dataset.legendValue,
      status: menu.dataset.legendStatus,
      left:
        arrow.content === 'none'
          ? undefined
          : menuLeft + Number.parseFloat(arrow.left),
      arrowColumn: menu.querySelector('.arrow').getBoundingClientRect().left,
    };
  });

execFileSync('yarn', ['workspace', 'crm-fe', 'build'], { stdio: 'ignore' });
const server = spawn('bun', ['src/index.ts'], {
  cwd: path.join(CRM, 'crm-be'),
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: dbPath,
    CRM_ADMIN_EMAIL: ADMIN,
    CRM_PUBLIC_URL: BASE,
    SMTP_PASS: '',
  },
  stdio: 'ignore',
});

const browser = await chromium.launch();
try {
  await waitForHealth();
  const token = randomBytes(32).toString('base64url');
  seed(token);
  const cookie = { name: 'crm_session', value: token, url: BASE };

  // 1 and 2: with JavaScript, the list updates in place.
  const context = await browser.newContext();
  await context.addCookies([cookie]);
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  assert.equal((await names(page)).length, ORGS.length);
  await page.evaluate(() => {
    window.morphMark = 'still here';
  });

  await page.locator('input[type="search"]').click();
  await page.keyboard.type('sw11');
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.searchParams.get('q') === 'sw11');
  await page.waitForFunction(
    () => document.querySelectorAll('.lcd .menu .name').length === 2,
  );
  assert.deepEqual((await names(page)).sort(), [
    'Battersea Bakery',
    'Lavender Hill Florist',
  ]);
  assert.ok(await searchHasFocus(page, 'sw11'), 'The search field has focus.');
  assert.equal(await page.evaluate(() => window.morphMark), 'still here');
  console.log('ok: Enter in the search field updates the list in place');

  await page.getByRole('button', { name: 'Quoted', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('stage') === 'quoted');
  await page.waitForFunction(
    () => document.querySelectorAll('.lcd .menu .name').length === 1,
  );
  assert.deepEqual(await names(page), ['Lavender Hill Florist']);
  assert.equal(await focusText(page), 'Quoted');
  assert.equal(
    await page.locator('#stage .value').textContent(),
    'Quoted',
    'The Stage value shows the new stage.',
  );
  assert.equal(await page.inputValue('input[type="search"]'), 'sw11');
  assert.equal(await page.evaluate(() => window.morphMark), 'still here');
  console.log('ok: a stage key updates the list in place, with focus kept');

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.waitForURL((url) => !url.searchParams.get('stage'));
  // The default order: the arrow is on Next action, ascending.
  const byDefault = await arrows(page);
  assert.equal(byDefault.name, 'none');
  assert.equal(byDefault.value, '▲ Next action');
  assert.equal(byDefault.status, 'Last activity');
  await page
    .getByRole('button', { name: 'Organisation name', exact: true })
    .click();
  await page.waitForURL((url) => url.searchParams.get('sort') === 'name');
  await page.waitForFunction(
    () => document.querySelector('#sort .value')?.textContent === 'A to Z',
  );
  assert.deepEqual(await names(page), [
    'Battersea Bakery',
    'Lavender Hill Florist',
  ]);
  assert.equal(await focusText(page), 'Organisation name');
  // The arrow moved to Organisation, in the arrow column of the rows.
  const byName = await arrows(page);
  assert.equal(byName.name, '"▲"');
  assert.equal(byName.value, 'Next action');
  assert.equal(byName.status, 'Last activity');
  assert.equal(byName.left, byName.arrowColumn);
  // The Name key keeps the focus, so Enter presses it again.
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.searchParams.get('dir') === 'desc');
  await page.waitForFunction(
    () => document.querySelector('#sort .value')?.textContent === 'Z to A',
  );
  assert.deepEqual(await names(page), [
    'Lavender Hill Florist',
    'Battersea Bakery',
  ]);
  assert.equal(await focusText(page), 'Organisation name');
  assert.equal((await arrows(page)).name, '"▼"');
  // The search form keeps the new sort: Enter sends it.
  await page.locator('input[type="search"]').fill('');
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.searchParams.get('q'));
  assert.equal(new URL(page.url()).searchParams.get('sort'), 'name');
  assert.equal((await names(page))[0], 'Lavender Hill Florist');
  assert.equal(await page.evaluate(() => window.morphMark), 'still here');
  // Last activity: the arrow moves to the status legend.
  await page
    .getByRole('button', { name: 'Last activity', exact: true })
    .click();
  await page.waitForURL((url) => url.searchParams.get('sort') === 'activity');
  await page.waitForFunction(
    () =>
      document.querySelector('.lcd .menu')?.dataset.legendStatus ===
      '▲ Last activity',
  );
  assert.equal((await arrows(page)).name, 'none');
  assert.equal((await arrows(page)).value, 'Next action');
  assert.equal(await page.evaluate(() => window.morphMark), 'still here');
  console.log(
    'ok: a sort key updates the list and the arrow of the order in place, with focus kept',
  );

  // 3: a Log press on an organisation page keeps the focus and the scroll.
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto(`${BASE}${ORG}`);
  await page.evaluate(() => {
    window.morphMark = 'still here';
  });
  const key = page.getByRole('button', { name: 'Note only', exact: true });
  // Scroll so that the Log key is at the bottom of the window.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (element) => element.textContent === 'Note only',
    );
    const bottom = button.getBoundingClientRect().bottom + scrollY;
    scrollTo(0, bottom - innerHeight + 8);
  });
  const before = await page.evaluate(() => ({
    y: scrollY,
    length: history.length,
    url: location.href,
  }));
  assert.ok(before.y > 0, 'The page is scrolled before the press.');
  const count = await events(page);
  await logNote(page, 'First note');
  await waitForEvents(page, count + 1);
  const after = await page.evaluate(() => ({
    y: scrollY,
    length: history.length,
    url: location.href,
    mark: window.morphMark,
    note: document.querySelector('textarea[name="note"]').value,
  }));
  assert.equal(after.mark, 'still here', 'The page did not load again.');
  assert.equal(after.y, before.y, 'The scroll position did not change.');
  assert.equal(await focusText(page), 'Note only');
  assert.ok(
    await key.evaluate((element) => element === document.activeElement),
  );
  assert.equal(after.url, before.url);
  assert.equal(after.length, before.length, 'The same URL replaces.');
  assert.equal(after.note, '', 'The Log form is empty after the save.');
  console.log(
    `ok: a Log press saves in place, with focus and scroll kept (scrollY ${after.y})`,
  );

  // 4: a link goes into history, and Back and Forward work in place.
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.locator('h1 a[href="/"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll('.lcd .menu .name').length === 4,
  );
  assert.equal(new URL(page.url()).pathname, '/');
  assert.equal(
    await page.evaluate(() => history.length),
    before.length + 1,
    'A changed URL goes into history.',
  );
  await page.locator('.lcd .menu a', { hasText: 'Clapham Cafe' }).click();
  await page.waitForURL(`${BASE}/orgs/clapham-cafe`);
  await page.waitForFunction(() => document.title.startsWith('Clapham Cafe'));
  await page.goBack();
  await page.waitForURL(`${BASE}/`);
  await page.waitForFunction(() => document.title.startsWith('Organisations'));
  assert.equal((await names(page)).length, 4);
  await page.goForward();
  await page.waitForURL(`${BASE}/orgs/clapham-cafe`);
  await page.waitForFunction(() => document.title.startsWith('Clapham Cafe'));
  assert.equal(await page.evaluate(() => window.morphMark), 'still here');
  console.log('ok: a link goes into history, and Back and Forward morph');

  await page.goto(`${BASE}/account`);
  await page.evaluate(() => {
    window.morphMark = 'still here';
  });
  const passkeysLink = page.locator('main a[href="/account/passkeys"]');
  await passkeysLink.click();
  await page.waitForURL(`${BASE}/account/passkeys`);
  const addKey = page.locator('#passkey-add');
  await page.waitForFunction(
    () => document.querySelector('#passkey-add')?.disabled === false,
  );
  // One more morph of the same page: the passkey script sets up its key
  // again.
  await page.locator('h1 a[href="/"]').click();
  await page.waitForURL(`${BASE}/`);
  await page.goBack();
  await page.waitForURL(`${BASE}/account/passkeys`);
  await page.waitForFunction(() => document.title.startsWith('Passkeys'));
  assert.equal(await addKey.isDisabled(), false);
  assert.equal(
    await page.locator('script[src*="passkeys"]').count(),
    1,
    'The passkey script loads one time.',
  );
  assert.equal(await page.evaluate(() => window.morphMark), 'still here');
  console.log(
    'ok: a morph to a passkey page adds its script, and its key is on',
  );

  // 5: when the fetch fails, the browser sends the post as a normal submit.
  await page.goto(`${BASE}${ORG}`);
  await page.evaluate(() => {
    window.morphMark = 'still here';
  });
  await page.route('**/activity', (route) =>
    route.request().resourceType() === 'fetch'
      ? route.abort()
      : route.continue(),
  );
  const beforeFail = await events(page);
  await Promise.all([page.waitForNavigation(), logNote(page, 'Offline')]);
  await waitForEvents(page, beforeFail + 1);
  assert.equal(await page.evaluate(() => window.morphMark), undefined);
  await page.unrouteAll();
  console.log('ok: a failed fetch sends the post as a normal submit');
  await context.close();

  // 6: with no scripts (`?theme=bare`, and JavaScript off), the search and
  // a Log press load the full page.
  const themed = await browser.newContext();
  await themed.addCookies([cookie]);
  const bareTheme = await themed.newPage();
  await bareTheme.goto(`${BASE}${ORG}?theme=bare`);
  assert.equal(await bareTheme.locator('script').count(), 0);
  const beforeBare = await events(bareTheme);
  await Promise.all([
    bareTheme.waitForNavigation(),
    logNote(bareTheme, 'Bare note'),
  ]);
  assert.equal(await events(bareTheme), beforeBare + 1);
  console.log('ok: with ?theme=bare, a Log press loads the full page');
  await themed.close();

  const bare = await browser.newContext({ javaScriptEnabled: false });
  await bare.addCookies([cookie]);
  const noScript = await bare.newPage();
  await noScript.goto(`${BASE}/`);
  await noScript.locator('input[type="search"]').click();
  await noScript.keyboard.type('sw11');
  await Promise.all([
    noScript.waitForNavigation(),
    noScript.keyboard.press('Enter'),
  ]);
  assert.equal(new URL(noScript.url()).searchParams.get('q'), 'sw11');
  assert.equal((await names(noScript)).length, 2);
  // The browser applies autofocus at a later frame of the load, so wait
  // for it.
  await noScript.waitForFunction(
    () => document.activeElement?.getAttribute('name') === 'q',
    undefined,
    { timeout: 5000 },
  );
  await noScript.goto(`${BASE}${ORG}`);
  const beforeNoScript = await events(noScript);
  await Promise.all([
    noScript.waitForNavigation(),
    logNote(noScript, 'No script note'),
  ]);
  assert.equal(await events(noScript), beforeNoScript + 1);
  console.log(
    'ok: with JavaScript off, the search and a Log press load the full page',
  );
  await bare.close();
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
