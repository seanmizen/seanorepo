import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { buildApp } from './index';
import {
  addOrg,
  bodyText,
  postForm,
  signInAdmin,
  testApp,
} from './test-helpers';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
let cookie: string;

beforeEach(() => {
  ({ app, db, close } = testApp());
  cookie = signInAdmin(app);
});

afterEach(async () => {
  await close();
});

/** The id of the organisation with `slug`. */
const orgId = (slug: string) =>
  (
    db.query('SELECT id FROM organisation WHERE slug = ?;').get(slug) as {
      id: string;
    }
  ).id;

/** The slug of the organisation `id` now: an Undo can change it. */
const slugOf = (id: string) =>
  (
    db.query('SELECT slug FROM organisation WHERE id = ?;').get(id) as {
      slug: string;
    }
  ).slug;

/** What a person sees of the organisation `id`: its row and its visible records. */
const state = (id: string) => ({
  org: db
    .query(
      `SELECT name, slug, source, address_line_1, address_line_2, postcode,
              stage, next_action, next_action_on
       FROM organisation WHERE id = ?;`,
    )
    .get(id),
  visits: db
    .query(
      'SELECT id, number, outcome, note FROM visit WHERE organisation_id = ? AND hidden_at IS NULL ORDER BY number;',
    )
    .all(id),
  notes: db
    .query(
      'SELECT id, number, body FROM note WHERE organisation_id = ? AND hidden_at IS NULL ORDER BY number;',
    )
    .all(id),
  contacts: db
    .query(
      `SELECT m.number, m.role, p.name, p.phone, p.email
       FROM membership AS m JOIN person AS p ON p.id = m.person_id
       WHERE m.organisation_id = ? AND m.hidden_at IS NULL ORDER BY m.number;`,
    )
    .all(id),
});

/** The rows of the tables that Undo, Redo and Restore must never shrink. */
const counts = () =>
  db
    .query(
      `SELECT (SELECT count(*) FROM visit) AS visit, (SELECT count(*) FROM note) AS note,
              (SELECT count(*) FROM membership) AS membership,
              (SELECT count(*) FROM org_event) AS org_event,
              (SELECT count(*) FROM person) AS person`,
    )
    .get() as Record<string, number>;

const get = async (url: string) =>
  (await app.inject({ method: 'GET', url, headers: { cookie } })).body;

const post = (url: string, fields: Record<string, string> = {}) =>
  postForm(app, url, fields, cookie);

/**
 * Tap the Undo or the Redo key of the page of the organisation `id`, as a
 * browser does: post its form with the event number on the page. Returns
 * false when the key is off.
 */
const press = async (id: string, kind: 'undo' | 'redo') => {
  const slug = slugOf(id);
  const html = await get(`/orgs/${slug}`);
  const form = html.match(
    new RegExp(
      `<form action="/orgs/${slug}/${kind}" method="post">([\\s\\S]*?)</form>`,
    ),
  )?.[1];
  if (!form) throw new Error(`The page has no ${kind} form.`);
  if (form.includes('disabled=""')) return false;
  const event = form.match(/name="event" value="(\d+)"/)?.[1];
  if (!event) throw new Error(`The ${kind} form has no event number.`);
  const response = await post(`/orgs/${slug}/${kind}`, { event });
  expect(response.statusCode).toBe(303);
  return true;
};

/**
 * One kind of event: `setup` makes the state before it (not part of the
 * test), and `act` does the change, as the page posts it.
 */
interface Scenario {
  setup?: (slug: string) => Promise<unknown>;
  act: (slug: string) => Promise<unknown>;
}

const SCENARIOS: Record<string, Scenario> = {
  visit: {
    act: (slug) =>
      post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: 'Keen' }),
  },
  'visit, Do not knock (the stage changes too)': {
    setup: (slug) =>
      post(`/orgs/${slug}/stage`, {
        stage: 'visited',
        next_action: 'Knock',
        next_action_on: '2030-01-01',
      }),
    act: (slug) =>
      post(`/orgs/${slug}/activity`, { outcome: 'do_not_knock', note: '' }),
  },
  note: {
    act: (slug) =>
      post(`/orgs/${slug}/activity`, { outcome: 'note', note: 'Owner is Ann' }),
  },
  'stage change': {
    act: (slug) =>
      post(`/orgs/${slug}/stage`, {
        stage: 'quoted',
        next_action: '',
        next_action_on: '',
      }),
  },
  'next action': {
    setup: (slug) =>
      post(`/orgs/${slug}/stage`, {
        stage: 'lead',
        next_action: 'Call',
        next_action_on: '2030-01-01',
      }),
    act: (slug) =>
      post(`/orgs/${slug}/stage`, {
        stage: 'lead',
        next_action: 'Call again',
        next_action_on: '2030-02-02',
      }),
  },
  'details edit (with a new URL slug)': {
    act: (slug) =>
      post(`/orgs/${slug}/edit`, {
        name: 'Renamed Ltd',
        slug: 'renamed',
        source: 'web',
        postcode: 'e1 6an',
      }),
  },
  'contact added': {
    act: (slug) =>
      post(`/orgs/${slug}/contacts`, {
        name: 'Bob',
        phone: '07700 900002',
        role: 'staff',
      }),
  },
  'contact edited': {
    act: (slug) =>
      post(`/orgs/${slug}/contacts/1`, {
        name: 'Ann Jones',
        phone: '',
        email: 'jones@example.com',
        role: 'staff',
      }),
  },
  'contact removed': {
    act: (slug) => post(`/orgs/${slug}/contacts/1/remove`),
  },
  'activity edit (a new outcome and text)': {
    setup: (slug) =>
      post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: 'Hi' }),
    act: (slug) =>
      post(`/orgs/${slug}/activity/1`, { outcome: 'call_back', note: 'Bye' }),
  },
  'activity edit (a visit to a note)': {
    setup: (slug) =>
      post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: 'Hi' }),
    act: (slug) =>
      post(`/orgs/${slug}/activity/1`, { outcome: 'note', note: 'Hi' }),
  },
  'activity edit (a note to a visit, Do not knock)': {
    setup: (slug) =>
      post(`/orgs/${slug}/activity`, { outcome: 'note', note: 'Hi' }),
    act: (slug) =>
      post(`/orgs/${slug}/activity/1`, { outcome: 'do_not_knock', note: 'Hi' }),
  },
  restore: {
    setup: async (slug) => {
      await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: 'Hi' });
      await press(orgId(slug), 'undo');
      // A new change empties the redo list, so only Restore shows it.
      await post(`/orgs/${slug}/activity`, { outcome: 'note', note: 'Later' });
    },
    act: (slug) => post(`/orgs/${slug}/activity/1/restore`),
  },
};

describe('Undo and Redo (REQ-CRM-UNDO-002)', () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    test(`${name}: undo twice, then redo twice, gives each state again, and no row count goes down (REQ-CRM-UNDO-001, REQ-CRM-UNDO-002)`, async () => {
      const slug = await addOrg(app, cookie, {
        name: 'Acme',
        source: 'door',
        contact_name: 'Ann',
        contact_phone: '07700 900001',
      });
      const id = orgId(slug);
      await scenario.setup?.(slug);
      // A second change after the one under test, so Undo goes back twice.
      await post(`/orgs/${slug}/activity`, { outcome: 'note', note: 'Before' });
      const s0 = state(id);
      const steps = [counts()];
      const step = async (action: () => Promise<unknown>) => {
        const before = counts().org_event;
        await action();
        steps.push(counts());
        // Each write path and each Undo and Redo adds exactly one event.
        expect(counts().org_event).toBe(before + 1);
      };
      await step(() => scenario.act(slug));
      const s1 = state(id);
      expect(s1).not.toEqual(s0);
      await step(() =>
        post(`/orgs/${slugOf(id)}/activity`, {
          outcome: 'no_answer',
          note: '',
        }),
      );
      const s2 = state(id);

      await step(() => press(id, 'undo'));
      expect(state(id)).toEqual(s1);
      await step(() => press(id, 'undo'));
      expect(state(id)).toEqual(s0);
      await step(() => press(id, 'redo'));
      expect(state(id)).toEqual(s1);
      await step(() => press(id, 'redo'));
      expect(state(id)).toEqual(s2);
      // Nothing is left to redo.
      expect(await press(id, 'redo')).toBe(false);

      for (let i = 1; i < steps.length; i += 1) {
        for (const table of Object.keys(steps[i])) {
          expect(steps[i][table]).toBeGreaterThanOrEqual(steps[i - 1][table]);
        }
      }
    });
  }

  test('a new change after an Undo empties the redo list (REQ-CRM-UNDO-002)', async () => {
    const slug = await addOrg(app, cookie, { name: 'Acme' });
    const id = orgId(slug);
    await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: 'One' });
    await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: 'Two' });
    await press(id, 'undo');
    await press(id, 'undo');
    const html = await get(`/orgs/${slug}`);
    const event = html.match(
      /action="\/orgs\/acme\/redo" method="post"><input type="hidden" name="event" value="(\d+)"/,
    )?.[1];
    expect(event).toBeDefined();

    await post(`/orgs/${slug}/stage`, { stage: 'visited' });
    expect(await press(id, 'redo')).toBe(false);
    expect(await get(`/orgs/${slug}`)).toContain(
      'title="Nothing to redo. A new change clears the redo list."',
    );
    // A stale Redo post changes nothing.
    const before = counts();
    await post(`/orgs/${slug}/redo`, { event: String(event) });
    expect(counts()).toEqual(before);
    expect(state(id).visits).toEqual([]);
  });

  test('a second tap on Undo changes nothing: the post names the event that the page showed (REQ-CRM-UNDO-002)', async () => {
    const slug = await addOrg(app, cookie, { name: 'Acme' });
    const id = orgId(slug);
    await post(`/orgs/${slug}/stage`, { stage: 'visited' });
    await post(`/orgs/${slug}/stage`, { stage: 'quoted' });
    const html = await get(`/orgs/${slug}`);
    const event = String(
      html.match(/name="event" value="(\d+)"/)?.[1] ?? 'none',
    );
    await post(`/orgs/${slug}/undo`, { event });
    await post(`/orgs/${slug}/undo`, { event });
    expect(state(id).org).toMatchObject({ stage: 'visited' });
  });

  test('Undo stops at the new lead, at an event older than Undo and at an erased event, and says why (REQ-CRM-UNDO-002)', async () => {
    const slug = await addOrg(app, cookie, { name: 'Acme' });
    const id = orgId(slug);
    const undoKey = async () =>
      (await get(`/orgs/${slug}`)).match(/<button[^>]*id="undo"[^>]*>/)?.[0];
    expect(await undoKey()).toContain('title="Nothing to undo."');

    // An event from the history before Undo has no values to write back.
    db.query(
      `INSERT INTO org_event (organisation_id, number, actor, kind, payload)
       VALUES (?, 2, 'x', 'details', '{"fields":["source"],"migrated":true}');`,
    ).run(id);
    expect(await undoKey()).toContain(
      'title="The newest change is older than Undo. Undo cannot reverse it."',
    );
    db.query(
      `INSERT INTO org_event (organisation_id, number, actor, kind, payload)
       VALUES (?, 3, 'x', 'details', '{"fields":["source"],"redacted":true,"changes":[]}');`,
    ).run(id);
    expect(await undoKey()).toContain(
      'title="The newest change held personal data that was erased. Undo cannot reverse it."',
    );
    expect(await press(id, 'undo')).toBe(false);
  });

  test('Undo of a URL slug that another organisation has now changes nothing and says why (REQ-CRM-UNDO-002)', async () => {
    const slug = await addOrg(app, cookie, { name: 'Acme' });
    const id = orgId(slug);
    await post(`/orgs/${slug}/edit`, { name: 'Acme', slug: 'acme-ltd' });
    await addOrg(app, cookie, { name: 'Acme' });
    const html = await get('/orgs/acme-ltd');
    const event = html.match(/name="event" value="(\d+)"/)?.[1] ?? '';
    const before = counts();
    const response = await post('/orgs/acme-ltd/undo', { event });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      'Undo did not change anything. Another organisation has the URL slug.',
    );
    expect(counts()).toEqual(before);
    expect(slugOf(id)).toBe('acme-ltd');
  });
});

describe('Restore (REQ-CRM-UNDO-003)', () => {
  test('Show hidden lists each hidden visit, note and contact with Restore, and a second Restore does nothing (REQ-CRM-UNDO-003)', async () => {
    const slug = await addOrg(app, cookie, {
      name: 'Acme',
      contact_name: 'Ann',
    });
    const id = orgId(slug);
    await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: 'Keen' });
    await press(id, 'undo');
    await post(`/orgs/${slug}/contacts/1/remove`);

    // Hidden records do not show by default.
    const plain = await get(`/orgs/${slug}`);
    expect(plain).not.toContain('<span class="what">Visit 1: Spoke.');
    expect(plain).toContain('<span class="what">Undo of Visit 1: Spoke.');
    expect(plain).not.toContain('<th scope="row">Ann</th>');
    expect(plain).not.toContain('Restore');

    const shown = await get(`/orgs/${slug}?hidden=1`);
    expect(shown).toContain('<details class="events" open="">');
    expect(bodyText(shown)).toContain('Visit 1: Spoke. Keen hidden Restore');
    expect(shown).toContain('<th scope="row">Ann</th>');
    // Restore is only on the two hidden records.
    expect(shown.match(/>Restore</g)).toHaveLength(2);
    expect(shown).toContain(
      '<form action="/orgs/acme/activity/1/restore" method="post">',
    );
    expect(shown).toContain(
      '<form action="/orgs/acme/contacts/1/restore" method="post">',
    );

    for (const url of [
      `/orgs/${slug}/activity/1/restore`,
      `/orgs/${slug}/contacts/1/restore`,
    ]) {
      const before = counts().org_event;
      const first = await post(url, { hidden: '1' });
      expect(first.statusCode).toBe(303);
      expect(first.headers.location).toBe('/orgs/acme?hidden=1#activity');
      expect(counts().org_event).toBe(before + 1);
      // Restore of a record that shows already changes and records nothing.
      const again = await post(url, { hidden: '1' });
      expect(again.statusCode).toBe(303);
      expect(counts().org_event).toBe(before + 1);
    }
    expect(state(id).visits).toHaveLength(1);
    expect(state(id).contacts).toHaveLength(1);
    expect(bodyText(await get(`/orgs/${slug}`))).toContain(
      'Contact restored: Ann.',
    );
    // A Restore is a change: Undo hides the record again.
    await press(id, 'undo');
    expect(state(id).contacts).toEqual([]);
    // A number that the organisation never had is not found.
    expect((await post(`/orgs/${slug}/activity/9/restore`)).statusCode).toBe(
      404,
    );
    expect((await post(`/orgs/${slug}/contacts/9/restore`)).statusCode).toBe(
      404,
    );
  });

  test('the old row of a visit changed to a note is not on the Show hidden list (REQ-CRM-UNDO-003)', async () => {
    const slug = await addOrg(app, cookie, { name: 'Acme' });
    await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: 'Hi' });
    await post(`/orgs/${slug}/activity/1`, { outcome: 'note', note: 'Hi' });
    expect(await get(`/orgs/${slug}?hidden=1`)).not.toContain('>Restore<');
    expect(await get(`/orgs/${slug}`)).toContain('title="Nothing is hidden."');
    const before = counts();
    await post(`/orgs/${slug}/activity/1/restore`);
    expect(counts()).toEqual(before);
  });
});

describe('the data is never deleted (REQ-CRM-UNDO-001)', () => {
  test('no row count goes down through a long sequence of changes, Undo, Redo and Restore (REQ-CRM-UNDO-001)', async () => {
    const slug = await addOrg(app, cookie, {
      name: 'Acme',
      contact_name: 'Ann',
    });
    const id = orgId(slug);
    // A fixed pseudo-random sequence, so a failure repeats.
    let seed = 1089;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    let last = counts();
    for (let i = 0; i < 80; i += 1) {
      const choice = next(7);
      const s = slugOf(id);
      if (choice === 0) {
        await post(`/orgs/${s}/activity`, {
          outcome: next(2) ? 'spoke' : 'note',
          note: `Entry ${i}`,
        });
      } else if (choice === 1) {
        await post(`/orgs/${s}/contacts`, { name: `Person ${i}` });
      } else if (choice === 2) {
        const contact = state(id).contacts[0] as { number: number } | undefined;
        if (contact) await post(`/orgs/${s}/contacts/${contact.number}/remove`);
      } else if (choice === 3) {
        await post(`/orgs/${s}/activity/1`, {
          outcome: next(2) ? 'note' : 'call_back',
          note: `Edit ${i}`,
        });
      } else if (choice === 4 || choice === 5) {
        await press(id, choice === 4 ? 'undo' : 'redo');
      } else {
        const html = await get(`/orgs/${s}?hidden=1`);
        const restore = html.match(/action="([^"]+\/restore)"/)?.[1];
        if (restore) await post(restore);
      }
      const now = counts();
      for (const table of Object.keys(now)) {
        expect(now[table]).toBeGreaterThanOrEqual(last[table]);
      }
      last = now;
    }
    expect(last.org_event).toBeGreaterThan(40);
  });

  test('no code of an organisation runs DELETE, and no code changes a row of org_event (REQ-CRM-UNDO-001)', () => {
    const src = import.meta.dir;
    const files = [
      'events.ts',
      'activity.ts',
      'contacts.ts',
      'org.ts',
      'mcp.ts',
      ...readdirSync(path.join(src, 'routes', 'orgs'), {
        recursive: true,
        encoding: 'utf8',
      })
        .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
        .map((file) => path.join('routes', 'orgs', file)),
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const code = readFileSync(path.join(src, file), 'utf8');
      expect(`${file}: ${/\bDELETE\s+FROM\b/i.test(code)}`).toBe(
        `${file}: false`,
      );
    }
    for (const file of readdirSync(src, {
      recursive: true,
      encoding: 'utf8',
    })) {
      if (!/\.tsx?$/.test(file) || file.includes('.test.')) continue;
      const code = readFileSync(path.join(src, file), 'utf8');
      expect(`${file}: ${/UPDATE\s+org_event/i.test(code)}`).toBe(
        `${file}: false`,
      );
    }
  });
});

describe('the keys of the Activity box (REQ-CRM-BUTTON-001)', () => {
  /** The attributes of a tag, by name. */
  const attrsOf = (tag: string) =>
    Object.fromEntries(
      [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );

  /**
   * Check the key `id` with `label` on `html`: it is present, and when it
   * is off, its reason is in `title` and in the text that
   * `aria-describedby` names. Returns the reason, or null when it is on.
   */
  const checkKey = (html: string, id: string, label: string) => {
    const tag = html.match(
      new RegExp(`<button[^>]* id="${id}"[^>]*>${label}</button>`),
    )?.[0];
    expect(`${id}: ${tag ? 'present' : 'missing'}`).toBe(`${id}: present`);
    const attrs = attrsOf(String(tag));
    if (!('disabled' in attrs)) return null;
    expect(attrs.title).toBeTruthy();
    expect(attrs['aria-describedby']).toBe(`${id}-why`);
    const why = html.match(
      new RegExp(`<span class="bare-text" id="${id}-why">([^<]*)</span>`),
    )?.[1];
    expect(why).toBe(attrs.title);
    return attrs.title;
  };

  test('Undo, Redo and Show hidden are present in each state, and an off key has its reason in title and in its accessible description (REQ-CRM-BUTTON-001)', async () => {
    const slug = await addOrg(app, cookie, { name: 'Acme' });
    const id = orgId(slug);
    const keys = async (url = `/orgs/${slug}`) => {
      const html = await get(url);
      const hidden = url.includes('hidden=1');
      return [
        checkKey(html, 'undo', 'Undo'),
        checkKey(html, 'redo', 'Redo'),
        checkKey(html, 'show-hidden', hidden ? 'Hide hidden' : 'Show hidden'),
      ];
    };
    const REDO = 'Nothing to redo. A new change clears the redo list.';

    // A new organisation: nothing to undo, redo or show.
    expect(await keys()).toEqual([
      'Nothing to undo.',
      REDO,
      'Nothing is hidden.',
    ]);
    expect(await keys(`/orgs/${slug}?hidden=1`)).toEqual([
      'Nothing to undo.',
      REDO,
      null,
    ]);
    // After a visit: Undo is on.
    await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: '' });
    expect(await keys()).toEqual([null, REDO, 'Nothing is hidden.']);
    // After Undo: Redo is on, and the visit is hidden.
    await press(id, 'undo');
    expect(await keys()).toEqual(['Nothing to undo.', null, null]);
    expect(await keys(`/orgs/${slug}?hidden=1`)).toEqual([
      'Nothing to undo.',
      null,
      null,
    ]);
    // Each key is a plain form with a submit button (REQ-CRM-BARE-001).
    const html = await get(`/orgs/${slug}?theme=bare`);
    expect(html).toContain(
      '<form action="/orgs/acme#activity" method="get"><input type="hidden" name="hidden" value="1"/><button type="submit" class="key" id="show-hidden">Show hidden</button></form>',
    );
    expect(bodyText(html)).toContain('Undo Nothing to undo. Redo');
  });
});
