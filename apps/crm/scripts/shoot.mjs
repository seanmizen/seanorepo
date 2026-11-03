#!/usr/bin/env node
/*
 * Screenshot each crm page, for a design review.
 *
 * Where: run from the repo root, after `yarn`:
 *   node apps/crm/scripts/shoot.mjs [out-dir]
 * The PNGs go to out-dir (default: a new temp folder). The script prints the
 * folder at the end.
 * When: after a change to a page, the ui parts or the theme. Look at every
 * image before a PR.
 * Why: the crm renders on the server, so a test of the HTML cannot show the
 * layout. The script builds crm-fe, starts crm-be on PORT (default 4110)
 * with a new SQLite file in a temp folder, and puts sample organisations,
 * a passkey and an admin passkey session in it. It touches no other
 * database. There are more than 50 organisations, so the list (/ and
 * /orgs) has a second page. Then Playwright (from the repo node_modules)
 * takes each page in light and dark mode at these widths: the breakpoint
 * minus 1px, the breakpoint, the breakpoint plus 24px, 390px, 1200px and
 * 1440px (REQ-CRM-LAYOUT-001). The script reads the breakpoint from
 * crm-fe/src/theme.css. It takes each sort and filter of the list at
 * 1200px in light mode and at 390px in dark mode, and a few pages with
 * ?theme=bare. "home-hover" has the pointer on a menu row: compare it with
 * "home" to see that no character moves (REQ-CRM-LCD-001). The script
 * prints each page that scrolls sideways. At the end it stops crm-be and
 * deletes the database.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const CRM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4110);
const BASE = `http://localhost:${PORT}`;
const ADMIN = 'admin@example.com';
const out = path.resolve(
  process.argv[2] || mkdtempSync(path.join(tmpdir(), 'crm-shots-')),
);
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(path.join(tmpdir(), 'crm-shots-db-'));
/** The one breakpoint of the layout, from its media query in the theme. */
const BREAKPOINT = Number(
  /@media \(width < (\d+)px\)/.exec(
    readFileSync(path.join(CRM, 'crm-fe', 'src', 'theme.css'), 'utf8'),
  )?.[1],
);
if (!BREAKPOINT) throw new Error('theme.css has no (width < Npx) query.');
/** The widths of the shots. A phone (390px) has a phone height. */
const WIDTHS = [BREAKPOINT - 1, BREAKPOINT, BREAKPOINT + 24, 390, 1200, 1440];
const dbPath = path.join(dataDir, 'crm.db');

/** Run SQL on the temp database. */
const sql = (text) => execFileSync('sqlite3', [dbPath, text]);
/** A SQL string literal. */
const q = (value) =>
  value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
/** The ISO time `days` from now, at `hour` UTC. */
const at = (days, hour = 10) => {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(hour, 15, 0, 0);
  return date.toISOString();
};
/** The date `days` from now, as YYYY-MM-DD. */
const day = (days) => at(days).slice(0, 10);

const ORGS = [
  {
    slug: 'example-plumbing',
    name: 'Example Plumbing',
    address: ['12 Sample Street', null, 'ZZ1 1AA'],
    stage: 'follow_up',
    next: ['Call back about the booking page', day(-2)],
    contact: ['Alex Example', '07700 900001', 'alex@example.com'],
    visits: [
      [-5, 'spoke', 'Owner keen on online booking. Busy until Thursday.'],
      [-9, 'no_answer', null],
    ],
    notes: [[-5, 'Uses a paper diary. Wants something simple.']],
    // Rows of audit_log, as the crm writes them: [days, action, entity,
    // detail]. The Activity list shows each one.
    changes: [
      [-30, 'update', 'organisation', { fields: ['postcode', 'source'] }],
      [
        -9,
        'update',
        'organisation',
        {
          fields: ['stage'],
          from: 'lead',
          stage: 'visited',
          next_action_on: null,
          cleared: true,
        },
      ],
      [
        -4,
        'update',
        'organisation',
        {
          fields: ['stage', 'next_action', 'next_action_on'],
          from: 'visited',
          stage: 'follow_up',
          next_action_on: day(-2),
          cleared: false,
        },
      ],
    ],
  },
  {
    slug: 'corner-cafe',
    name: 'Corner Cafe',
    address: ['1 Corner Road', null, 'ZZ1 2BB'],
    stage: 'lead',
    next: ['First knock', day(0)],
    contact: ['Sam Cafe', '07700 900002', null],
    visits: [],
    notes: [],
  },
  {
    slug: 'north-street-bakery',
    name: 'North Street Bakery',
    address: ['40 North Street', 'Unit 2', 'ZZ2 3CC'],
    stage: 'visited',
    next: ['Bring the menu demo', day(-6)],
    contact: ['Jo Baker', null, 'jo@example.com'],
    visits: [[-12, 'call_back', 'Come back after the lunch rush.']],
    notes: [],
  },
  {
    slug: 'the-high-street-hair-and-beauty-salon',
    name: 'The High Street Hair and Beauty Salon',
    address: ['77 High Street', null, 'ZZ3 4DD'],
    stage: 'lead',
    next: ['Ask for the manager', day(-1)],
    contact: null,
    visits: [],
    notes: [],
  },
  {
    slug: 'riverside-dental',
    name: 'Riverside Dental',
    address: ['3 River Walk', null, 'ZZ4 5EE'],
    stage: 'quoted',
    next: ['Chase the quote', day(3)],
    contact: ['Dr Lee', '07700 900003', 'lee@example.com'],
    visits: [[-20, 'spoke', 'Wants online forms.']],
    notes: [[-19, 'Quote sent by email.']],
  },
  {
    slug: 'smith-and-sons-builders',
    name: 'Smith and Sons Builders',
    address: ['Yard 4', 'Mill Lane', 'ZZ5 6FF'],
    stage: 'won',
    next: null,
    contact: ['Pat Smith', '07700 900004', null],
    visits: [[-40, 'spoke', null]],
    notes: [],
  },
  {
    slug: 'old-mill-garage',
    name: 'Old Mill Garage',
    address: ['Old Mill', null, 'ZZ6 7GG'],
    stage: 'lost',
    next: null,
    contact: null,
    visits: [[-30, 'do_not_knock', 'Sign on the door.']],
    notes: [],
  },
];

/**
 * 56 more organisations, so that the list has more than 50 rows. Each
 * has a different added date. Some have a next action (a few of them due),
 * a visit or a note.
 */
const STREETS = ['Abbey', 'Bridge', 'Castle', 'Church', 'Granary', 'Market'];
const TRADES = [
  'Bakery',
  'Barbers',
  'Butchers',
  'Dental',
  'Florist',
  'Gym',
  'Opticians',
  'Pharmacy',
  'Tailors',
  'Vets',
];
const MORE_STAGES = ['lead', 'visited', 'follow_up', 'quoted', 'won', 'lost'];
for (let i = 0; i < 56; i += 1) {
  const name = `${STREETS[i % 6]} ${TRADES[Math.floor(i / 6)]}`;
  let next = null;
  if (i % 11 === 0) next = ['Knock again', day(-3 - (i % 4))];
  else if (i % 3 === 0) next = ['Send the price list', day(1 + (i % 9))];
  ORGS.push({
    slug: name.toLowerCase().replaceAll(' ', '-'),
    name,
    address: [
      `${i + 1} ${STREETS[i % 6]} Road`,
      null,
      `ZZ${(i % 9) + 1} ${i % 10}AB`,
    ],
    stage: MORE_STAGES[i % 6],
    next,
    contact: null,
    visits: i % 4 === 0 ? [[-(i % 30) - 1, 'spoke', null]] : [],
    notes: i % 5 === 0 ? [[-(i % 20) - 1, 'Asked about prices.']] : [],
    added: -100 + i,
  });
}

const seed = (adminToken, emailToken) => {
  const hash = (token) => createHash('sha256').update(token).digest('hex');
  const admin = `(SELECT id FROM person WHERE email = ${q(ADMIN)})`;
  const rows = [];
  const audit = (days, action, entity, entityId, detail) =>
    rows.push(
      `INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail)
       VALUES (${q(randomUUID())}, ${q(at(days, 9))}, ${admin}, ${q(action)}, ${q(entity)}, ${q(entityId)}, ${q(JSON.stringify(detail))});`,
    );
  for (const [index, org] of ORGS.entries()) {
    const id = randomUUID();
    const addedDays = org.added ?? -45 + index;
    const added = at(addedDays);
    rows.push(
      `INSERT INTO organisation (id, slug, name, address_line_1, address_line_2, postcode, stage, next_action, next_action_on, lawful_basis, source, created_at)
       VALUES (${q(id)}, ${q(org.slug)}, ${q(org.name)}, ${org.address.map(q).join(', ')}, ${q(org.stage)}, ${q(org.next?.[0] ?? null)}, ${q(org.next?.[1] ?? null)}, 'legitimate_interests', 'door', ${q(added)});`,
    );
    audit(addedDays, 'create', 'organisation', id, { stage: 'lead' });
    if (org.contact) {
      const person = randomUUID();
      const [name, phone, email] = org.contact;
      rows.push(
        `INSERT INTO person (id, email, name, phone) VALUES (${q(person)}, ${q(email)}, ${q(name)}, ${q(phone)});`,
        `INSERT INTO membership (person_id, organisation_id, role, number) VALUES (${q(person)}, ${q(id)}, 'owner', 1);`,
        `INSERT INTO org_counter (organisation_id, kind, last) VALUES (${q(id)}, 'contact', 1);`,
      );
      audit(addedDays, 'create', 'membership', id, {
        person_id: person,
        role: 'owner',
      });
    }
    for (const [days, action, entity, detail] of org.changes ?? []) {
      audit(days, action, entity, id, detail);
    }
    // Each visit and note gets the next activity number, oldest first
    // (REQ-CRM-ID-001).
    const entries = [
      ...org.visits.map(([days, outcome, note]) => ({
        time: at(days),
        sql: (number) =>
          `INSERT INTO visit (id, organisation_id, number, at, outcome, note) VALUES (${q(randomUUID())}, ${q(id)}, ${number}, ${q(at(days))}, ${q(outcome)}, ${q(note)});`,
      })),
      ...org.notes.map(([days, body]) => ({
        time: at(days, 11),
        sql: (number) =>
          `INSERT INTO note (id, organisation_id, number, body, created_at) VALUES (${q(randomUUID())}, ${q(id)}, ${number}, ${q(body)}, ${q(at(days, 11))});`,
      })),
    ].sort((a, b) => a.time.localeCompare(b.time));
    rows.push(...entries.map((entry, i) => entry.sql(i + 1)));
    if (entries.length > 0) {
      rows.push(
        `INSERT INTO org_counter (organisation_id, kind, last) VALUES (${q(id)}, 'activity', ${entries.length});`,
      );
    }
  }
  rows.push(
    `INSERT INTO passkey (id, person_id, name, public_key, created_at, last_used_at)
     VALUES ('shots-passkey', ${admin}, 'iPhone', x'00', ${q(at(-14))}, ${q(at(0, 9))});`,
    `INSERT INTO session (id, person_id, token_hash, user_agent, created_at, expires_at, method)
     VALUES (${q(randomUUID())}, ${admin}, ${q(hash(adminToken))}, 'Screenshot script', ${q(at(-1))}, ${q(at(2))}, 'passkey');`,
    `INSERT INTO session (id, person_id, token_hash, user_agent, created_at, expires_at, method)
     VALUES (${q(randomUUID())}, ${admin}, ${q(hash(emailToken))}, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', ${q(at(-3))}, ${q(at(2))}, 'email');`,
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
  const adminToken = randomBytes(32).toString('base64url');
  const emailToken = randomBytes(32).toString('base64url');
  seed(adminToken, emailToken);

  const signedIn = [
    ['home', '/'],
    ['home-page-2', '/?page=2'],
    ['home-search', '/?q=street&stage=visited'],
    // /orgs is the same list as /.
    ['orgs', '/orgs?sort=name&dir=asc'],
    // The pointer on the second row of the menu.
    ['home-hover', '/', ['hover', '.menu li:nth-child(2) a']],
    ['org', '/orgs/example-plumbing'],
    // The Activity list, open.
    ['org-activity', '/orgs/example-plumbing', ['click', 'summary']],
    ['org-no-contacts', '/orgs/the-high-street-hair-and-beauty-salon'],
    ['org-edit', '/orgs/example-plumbing/edit'],
    ['contact-edit', '/orgs/example-plumbing/contacts/1'],
    ['activity-edit', '/orgs/example-plumbing/activity/2'],
    ['org-new', '/orgs/new'],
    ['account', '/account'],
    ['passkeys', '/account/passkeys'],
    ['sessions', '/account/sessions'],
    ['not-found', '/orgs/no-such-org'],
  ];
  const signedOut = [
    ['login', '/login'],
    ['code', '/login/code?email=admin%40example.com'],
    ['verify', '/login/verify?token=sample'],
    // An error shows in the LCD.
    ['verify-error', '/login/verify'],
  ];
  // Each sort of the list, ascending and descending, and the filters
  // with a sort.
  const homeStates = [
    ['home-activity-asc', '/?sort=activity&dir=asc'],
    ['home-activity-desc', '/?sort=activity&dir=desc'],
    ['home-added-asc', '/?sort=added&dir=asc'],
    ['home-added-desc', '/?sort=added&dir=desc'],
    ['home-name-asc', '/?sort=name&dir=asc'],
    ['home-name-desc', '/?sort=name&dir=desc'],
    ['home-stage-quoted', '/?stage=quoted&sort=name&dir=desc'],
    ['home-no-match', '/?q=nothing-matches'],
  ];
  /** The shots of a page that scrolls sideways. */
  const sideways = [];
  /**
   * Open `url`. Then do `act` if it is set: `['click', selector]` or
   * `['hover', selector]`. Then shoot.
   */
  const shoot = async (page, name, url, tag, act) => {
    await page.goto(`${BASE}${url}`);
    if (act?.[0] === 'click') await page.click(act[1]);
    if (act?.[0] === 'hover') await page.hover(act[1]);
    const file = `${name}-${tag}.png`;
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
    ) {
      sideways.push(file);
    }
    await page.screenshot({ path: path.join(out, file), fullPage: true });
  };
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const height = width === 390 ? 844 : 900;
      const tag = `${scheme}-${width}`;
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: scheme,
      });
      const page = await context.newPage();
      for (const [name, url] of signedOut) await shoot(page, name, url, tag);
      // The admin in an email session gets the passkey step at /.
      await context.addCookies([
        { name: 'crm_session', value: emailToken, url: BASE },
      ]);
      await shoot(page, 'passkey-needed', '/', tag);
      await context.addCookies([
        { name: 'crm_session', value: adminToken, url: BASE },
      ]);
      for (const [name, url, act] of signedIn) {
        await shoot(page, name, url, tag, act);
      }
      if (tag === 'light-1200' || tag === 'dark-390') {
        for (const [name, url] of homeStates) {
          await shoot(page, name, url, tag);
        }
      }
      await context.close();
    }
  }
  // A few pages with no page styles (REQ-CRM-BARE-001).
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  await context.addCookies([
    { name: 'crm_session', value: adminToken, url: BASE },
  ]);
  const page = await context.newPage();
  for (const [name, url] of [
    ['home', '/?sort=name&dir=asc&theme=bare'],
    ['sessions', '/account/sessions?theme=bare'],
    ['org', '/orgs/example-plumbing?theme=bare'],
    ['org-new', '/orgs/new?theme=bare'],
  ]) {
    await shoot(page, name, url, 'bare');
  }
  await context.close();
  for (const file of sideways) console.log(`Scrolls sideways: ${file}`);
  console.log(out);
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
