import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SESSION_COOKIE } from './auth';
import { DEMO_TEXT, demoConfigError } from './demo';
import { seedDemo } from './demo-seed';
import type { buildApp } from './index';
import {
  addOrg,
  bodyText,
  postForm,
  signInAdmin,
  TEST_ADMIN_EMAIL,
  testApp,
} from './test-helpers';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
const savedEnv = { ...process.env };

beforeEach(() => {
  ({ app, db, close } = testApp());
});

afterEach(async () => {
  await close();
  for (const name of ['CRM_UNSAFE_DEMO_LOGIN', 'CRM_PUBLIC_URL']) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

const demoOn = () => {
  process.env.CRM_UNSAFE_DEMO_LOGIN = 'true';
};

const all = <T>(sql: string) => db.query<T, []>(sql).all();

describe('the boot check', () => {
  const demo = {
    CRM_UNSAFE_DEMO_LOGIN: 'true',
    CRM_ADMIN_EMAIL: 'demo@example.com',
  };

  test('refuses the demo switch on the live host', () => {
    for (const url of [
      'https://crm.seanmizen.com',
      'https://CRM.seanmizen.com/',
      'https://crm.seanmizen.com.:443/x',
    ]) {
      expect(demoConfigError({ ...demo, CRM_PUBLIC_URL: url })).toContain(
        'crm.seanmizen.com',
      );
    }
  });

  test('accepts the demo host, and the switch off on the live host', () => {
    expect(
      demoConfigError({
        ...demo,
        CRM_PUBLIC_URL: 'https://demo-crm.seanmizen.com',
      }),
    ).toBeUndefined();
    expect(demoConfigError({ ...demo })).toBeUndefined();
    for (const value of [undefined, '', 'false']) {
      expect(
        demoConfigError({
          CRM_UNSAFE_DEMO_LOGIN: value,
          CRM_PUBLIC_URL: 'https://crm.seanmizen.com',
        }),
      ).toBeUndefined();
    }
  });

  test('refuses a value that is not true or false, and the switch with no admin', () => {
    expect(demoConfigError({ CRM_UNSAFE_DEMO_LOGIN: 'yes' })).toContain(
      'must be true, false or unset',
    );
    expect(demoConfigError({ CRM_UNSAFE_DEMO_LOGIN: 'true' })).toContain(
      'CRM_ADMIN_EMAIL',
    );
  });

  test('crm-be stops at boot with the switch on the live host, before it opens the database', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crm-demo-boot-'));
    const dbPath = path.join(dir, 'crm.db');
    try {
      const run = Bun.spawnSync(
        ['bun', path.join(import.meta.dir, 'index.ts')],
        {
          env: {
            ...process.env,
            ...demo,
            NODE_ENV: 'production',
            CRM_PUBLIC_URL: 'https://crm.seanmizen.com',
            DB_PATH: dbPath,
            PORT: '0',
          },
          timeout: 15_000,
        },
      );
      expect(run.exitCode).not.toBe(0);
      expect(run.stderr.toString()).toContain(
        'CRM_UNSAFE_DEMO_LOGIN is true and the host of CRM_PUBLIC_URL is crm.seanmizen.com',
      );
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the demo switch on', () => {
  test('the Enter as admin (demo) button starts an admin passkey session', async () => {
    demoOn();
    const login = await app.inject({ method: 'GET', url: '/login' });
    expect(login.body).toContain('action="/login/demo"');
    expect(bodyText(login.body)).toContain('Enter as admin (demo)');

    const response = await postForm(app, '/login/demo', { next: '/orgs/new' });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs/new');
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();

    // `/orgs/new` is an admin route: it opens only in an admin passkey session.
    const page = await app.inject({
      method: 'GET',
      url: '/orgs/new',
      headers: { cookie: `${SESSION_COOKIE}=${cookie?.value}` },
    });
    expect(page.statusCode).toBe(200);

    const rows = all<{ method: string; email: string }>(
      `SELECT json_extract(a.detail, '$.method') AS method, p.email
       FROM audit_log AS a JOIN person AS p ON p.id = a.actor
       WHERE a.action = 'sign_in';`,
    );
    expect(rows).toEqual([{ method: 'demo', email: TEST_ADMIN_EMAIL }]);
    const sessions = all<{ method: string }>('SELECT method FROM session;');
    expect(sessions).toEqual([{ method: 'passkey' }]);
  });

  test('every page shows the demo line at the top', async () => {
    demoOn();
    const cookie = signInAdmin(app);
    for (const url of ['/login', '/', '/account', '/orgs/nobody']) {
      const page = await app.inject({
        method: 'GET',
        url,
        headers: { cookie },
      });
      expect(page.body).toContain(`<body><p class="demo">${DEMO_TEXT}</p>`);
    }
  });

  test('Reset demo data replaces the data and keeps the session', async () => {
    demoOn();
    const cookie = signInAdmin(app);
    await addOrg(app, cookie, { name: 'Real Name Ltd' });
    const account = await app.inject({
      method: 'GET',
      url: '/account',
      headers: { cookie },
    });
    expect(bodyText(account.body)).toContain('Reset demo data');

    const reset = await postForm(app, '/account/reset-demo', {}, cookie);
    expect(reset.statusCode).toBe(303);
    expect(reset.headers.location).toBe('/');
    const names = all<{ name: string }>('SELECT name FROM organisation;').map(
      (row) => row.name,
    );
    expect(names).not.toContain('Real Name Ltd');
    expect(names).toContain('The Example Bakery');
    const list = await app.inject({
      method: 'GET',
      url: '/',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
  });
});

describe('the demo switch off', () => {
  test('/login has no demo button, and POST /login/demo returns 404', async () => {
    const login = await app.inject({ method: 'GET', url: '/login' });
    expect(login.body).not.toContain('/login/demo');
    expect(bodyText(login.body)).not.toContain('Enter as admin');
    const response = await postForm(app, '/login/demo', {});
    expect(response.statusCode).toBe(404);
    expect(
      response.cookies.find((c) => c.name === SESSION_COOKIE),
    ).toBeUndefined();
    expect(all('SELECT id FROM session;')).toEqual([]);
  });

  test('no page shows the demo line, and Reset demo data is off (REQ-CRM-BUTTON-001)', async () => {
    const cookie = signInAdmin(app);
    for (const url of ['/login', '/', '/account']) {
      const page = await app.inject({
        method: 'GET',
        url,
        headers: { cookie },
      });
      expect(page.body).not.toContain(DEMO_TEXT);
      expect(page.body).not.toContain('Enter as admin (demo)');
    }
    const account = await app.inject({
      method: 'GET',
      url: '/account',
      headers: { cookie },
    });
    expect(account.body).toContain(
      '<button type="submit" class="key" id="reset-demo" disabled="" title="Only the demo site has demo data."',
    );
    const reset = await postForm(app, '/account/reset-demo', {}, cookie);
    expect(reset.statusCode).toBe(404);
  });
});

describe('the demo seed', () => {
  /** The data of the crm, with no ids: two seeds on one day give the same. */
  const snapshot = () => ({
    organisations: all(
      `SELECT slug, name, address_line_1, address_line_2, postcode, stage,
         next_action, next_action_on, source, created_at, updated_at
       FROM organisation ORDER BY slug;`,
    ),
    people: all(
      'SELECT name, email, phone, created_at FROM person ORDER BY name;',
    ),
    memberships: all(
      `SELECT o.slug, p.name, m.role FROM membership AS m
       JOIN organisation AS o ON o.id = m.organisation_id
       JOIN person AS p ON p.id = m.person_id ORDER BY o.slug, p.name;`,
    ),
    visits: all(
      `SELECT o.slug, v.at, v.outcome, v.note FROM visit AS v
       JOIN organisation AS o ON o.id = v.organisation_id ORDER BY v.at;`,
    ),
    notes: all(
      `SELECT o.slug, n.created_at, n.body FROM note AS n
       JOIN organisation AS o ON o.id = n.organisation_id ORDER BY n.created_at;`,
    ),
    events: all(
      `SELECT o.slug, e.number, e.at, e.kind FROM org_event AS e
       JOIN organisation AS o ON o.id = e.organisation_id ORDER BY o.slug, e.number;`,
    ),
    audit: all(
      'SELECT at, action, entity FROM audit_log ORDER BY at, action, entity;',
    ),
  });

  test('two runs give the same data, and the seed replaces the data that was there', async () => {
    const cookie = signInAdmin(app);
    await addOrg(app, cookie, { name: 'Real Name Ltd' });
    const first = seedDemo(db, TEST_ADMIN_EMAIL);
    const once = snapshot();
    const second = seedDemo(db, TEST_ADMIN_EMAIL);
    expect(second).toEqual(first);
    expect(snapshot()).toEqual(once);
    expect(first.organisations).toBe(10);
    expect(
      all<{ name: string }>('SELECT name FROM organisation;').map(
        (r) => r.name,
      ),
    ).not.toContain('Real Name Ltd');
    // The admin stays, with the session.
    const me = await app.inject({
      method: 'GET',
      url: '/account',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
  });

  test('each name, address, phone and email is fictional', () => {
    seedDemo(db, TEST_ADMIN_EMAIL);
    for (const { email, phone } of all<{
      email: string | null;
      phone: string | null;
    }>('SELECT email, phone FROM person;')) {
      if (email) expect(email).toMatch(/@example\.com$/);
      if (phone) expect(phone).toMatch(/^07700 900\d{3}$/);
    }
    for (const { postcode } of all<{ postcode: string }>(
      'SELECT postcode FROM organisation;',
    )) {
      expect(postcode).toMatch(/^ZZ/);
    }
  });

  test('each write has its event and its audit row, and every time is in the past', () => {
    seedDemo(db, TEST_ADMIN_EMAIL);
    // Each visit and note has the event that added it.
    const logged = (table: string) =>
      all<{ n: number }>(
        `SELECT count(*) AS n FROM ${table} WHERE id NOT IN (
           SELECT json_extract(payload, '$.record_id') FROM org_event
            WHERE kind IN ('visit', 'note'));`,
      )[0].n;
    expect(logged('visit')).toBe(0);
    expect(logged('note')).toBe(0);
    // Each organisation starts with its create event.
    expect(
      all<{ n: number }>(
        `SELECT count(*) AS n FROM organisation WHERE id NOT IN (
           SELECT organisation_id FROM org_event WHERE number = 1 AND kind = 'create');`,
      )[0].n,
    ).toBe(0);
    // Each event has one audit row.
    expect(
      all<{ n: number }>(
        `SELECT (SELECT count(*) FROM org_event)
              - (SELECT count(*) FROM audit_log WHERE entity = 'organisation') AS n;`,
      )[0].n,
    ).toBe(0);
    const stages = all<{ n: number }>(
      `SELECT count(*) AS n FROM org_event WHERE kind = 'stage';`,
    )[0].n;
    expect(stages).toBeGreaterThan(10);
    // The removed contact is hidden, at the time of its step.
    const now = new Date().toISOString();
    expect(
      all<{ n: number }>(
        'SELECT count(*) AS n FROM membership WHERE hidden_at IS NOT NULL;',
      )[0].n,
    ).toBe(1);
    const future = all<{ n: number }>(
      `SELECT (SELECT count(*) FROM visit WHERE at > '${now}')
            + (SELECT count(*) FROM note WHERE created_at > '${now}')
            + (SELECT count(*) FROM membership WHERE hidden_at > '${now}')
            + (SELECT count(*) FROM org_event WHERE at > '${now}')
            + (SELECT count(*) FROM audit_log WHERE entity != 'session' AND at > '${now}') AS n;`,
    )[0].n;
    expect(future).toBe(0);
  });

  test('refuses to run on the live host', () => {
    process.env.CRM_PUBLIC_URL = 'https://crm.seanmizen.com';
    expect(() => seedDemo(db, TEST_ADMIN_EMAIL)).toThrow('crm.seanmizen.com');
  });
});

describe('the compose file', () => {
  type Service = {
    image?: string;
    profiles?: string[];
    ports?: string[];
    environment?: string[];
    volumes?: string[];
    env_file?: (string | { path: string })[];
  };
  const compose = Bun.YAML.parse(
    readFileSync(
      path.join(import.meta.dir, '..', '..', 'docker-compose.yml'),
      'utf8',
    ),
  ) as { services: Record<string, Service> };
  const env = (service: Service, name: string) =>
    service.environment
      ?.find((line) => line.startsWith(`${name}=`))
      ?.slice(name.length + 1);

  test('prod and the demo back up to different prefixes', () => {
    const prefixes = Object.values(compose.services)
      .filter((service) => service.image?.startsWith('litestream/'))
      .map((service) => env(service, 'CRM_R2_PATH'));
    expect(prefixes.sort()).toEqual(['crm.db', 'demo-crm.db']);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(env(compose.services.litestream, 'CRM_R2_PATH')).toBe('crm.db');
  });

  test('each container reads only its own env files', () => {
    const files = (service: Service) =>
      (service.env_file ?? []).map((entry) =>
        typeof entry === 'string' ? entry : entry.path,
      );
    const sidecars = Object.values(compose.services).filter((service) =>
      service.image?.startsWith('litestream/'),
    );
    const apps = [compose.services.crm, compose.services['crm-demo']];
    const sidecarFiles = sidecars.flatMap(files);
    const appFiles = apps.flatMap(files);
    // Each sidecar has its own R2 file. The two R2 keys reach different
    // buckets, and the demo has an unsafe sign-in.
    expect(sidecars.map((service) => files(service).length)).toEqual([1, 1]);
    expect(new Set(sidecarFiles).size).toBe(sidecarFiles.length);
    // An app container never reads an R2 file.
    for (const file of appFiles) expect(sidecarFiles).not.toContain(file);
    // Each file is a server secret file (REQ-SERVER-021). The prod files are
    // on the list that deploy.sh checks. The demo files are not: the demo is
    // off without them.
    for (const file of [...appFiles, ...sidecarFiles]) {
      expect(file).toMatch(/^\/etc\/seanorepo\/[a-z0-9-]+\.env$/);
    }
    const required = readFileSync(
      path.join(
        import.meta.dir,
        '..',
        '..',
        '..',
        '..',
        'utils/debbie/2026-09-17/services/server-secrets.list',
      ),
      'utf8',
    )
      .split('\n')
      .filter((line) => line.startsWith('/'));
    expect(required).toContain('/etc/seanorepo/crm.env');
    expect(required).toContain('/etc/seanorepo/crm-r2.env');
    expect(required).not.toContain('/etc/seanorepo/crm-demo.env');
    expect(required).not.toContain('/etc/seanorepo/crm-demo-r2.env');
    // A sidecar gets only CRM_R2_PATH from compose. Its R2 file has the rest.
    for (const service of sidecars) {
      expect(service.environment?.map((line) => line.split('=')[0])).toEqual([
        'CRM_R2_PATH',
      ]);
    }
  });

  test('the demo has its own port, volume and host', () => {
    const { crm, 'crm-demo': demo } = compose.services;
    expect(env(crm, 'CRM_PUBLIC_URL')).toBe('https://crm.seanmizen.com');
    expect(env(demo, 'CRM_PUBLIC_URL')).toBe('https://demo-crm.seanmizen.com');
    expect(demo.ports).toHaveLength(1);
    expect(demo.ports?.[0]).toMatch(
      /^\$\{PUBLISH_ADDR:-127\.0\.0\.1\}:4101:4100$/,
    );
    expect(demo.volumes).toEqual(['crm_demo_sqlite_data:/data']);
    expect(demo.profiles).toEqual(['demo']);
  });
});
