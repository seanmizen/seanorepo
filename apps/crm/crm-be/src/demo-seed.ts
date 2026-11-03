/**
 * Where: `bun run demo:seed` in crm-be, and the `Reset demo data` button of
 * `/account` on the demo site (`routes/account/reset-demo.ts`).
 * When: to give the demo site a fresh, fixed set of data before a client
 * sees it.
 * Why: the demo must look like real use (stage changes, visits, notes and
 * contacts, with an Activity list), and must hold no real data.
 *
 * The seed deletes each organisation, each person except the admin
 * (CRM_ADMIN_EMAIL), and their audit rows. Then it adds the fixed set. It
 * writes through the same functions as the routes (`addOrg`, `addContact`,
 * `saveContact`, `removeContact`, `logActivity`, `setPipeline`), so each
 * write has its audit row. Then it moves the times of each step back to a
 * day relative to today. Two runs give the same data.
 *
 * Every name, address, phone number and email address is fictional:
 * `example.com` emails, `07700 900xxx` phone numbers (Ofcom keeps them for
 * drama) and `ZZ` postcodes. The seed refuses to run when the host of
 * CRM_PUBLIC_URL is the live host.
 */
import type { Database } from 'bun:sqlite';
import { logActivity } from './activity';
import { ensureAdmin, normalizeEmail } from './auth';
import {
  addContact,
  listContacts,
  removeContact,
  saveContact,
} from './contacts';
import { today } from './dates';
import { DB_PATH, openDatabase } from './db';
import { isLiveHost, LIVE_HOST } from './demo';
import { NOTE_ONLY } from './forms/activity';
import { contactForm } from './forms/contact';
import { type FormValues, parseForm } from './forms/form';
import { organisationForm } from './forms/organisation';
import {
  findOrg,
  type Outcome,
  resolveSlug,
  type Stage,
  setPipeline,
} from './org';
import { addOrg } from './routes/orgs/new';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One fictional contact, as the contact form posts it. */
type DemoContact = {
  name: string;
  phone?: string;
  email?: string;
  role?: 'owner' | 'staff';
};

/** One step in the story of an organisation. */
type Step =
  | { visit: Outcome; note?: string }
  | { note: string }
  | { stage: Stage; next?: string; due?: number }
  | { contact: DemoContact }
  | { change: string; to: DemoContact }
  | { remove: string };

/**
 * One fictional organisation. `steps` are `[days ago, time, step]`, oldest
 * first. The organisation and its first contact come at the first step.
 * `due` is the days from today to the date of the next action.
 */
type DemoOrg = {
  org: FormValues;
  contact?: DemoContact;
  added: [number, string];
  steps: [number, string, Step][];
};

const DEMO_ORGS: DemoOrg[] = [
  {
    org: {
      name: 'The Example Bakery',
      source: 'door',
      address_line_1: '1 Example Street',
      address_line_2: 'Sampleton',
      postcode: 'ZZ1 1AA',
    },
    contact: {
      name: 'Alex Example',
      phone: '07700 900101',
      email: 'alex@example.com',
      role: 'owner',
    },
    added: [41, '10:12'],
    steps: [
      [41, '10:15', { visit: 'no_answer', note: 'Closed for a delivery.' }],
      [
        38,
        '11:40',
        {
          visit: 'spoke',
          note: 'Owner wants to take cake orders on the web. Busy before 11.',
        },
      ],
      [38, '11:45', { stage: 'visited', next: 'Send a price', due: -30 }],
      [33, '16:20', { note: 'Sent a price for an order page by email.' }],
      [33, '16:22', { stage: 'quoted', next: 'Call about the price', due: 0 }],
    ],
  },
  {
    org: {
      name: 'Sample and Sons Hardware',
      source: 'door',
      address_line_1: '22 Sample Road',
      address_line_2: 'Sampleton',
      postcode: 'ZZ1 2BB',
    },
    contact: {
      name: 'Sam Sample',
      phone: '07700 900102',
      email: 'sam@example.com',
      role: 'owner',
    },
    added: [27, '14:02'],
    steps: [
      [
        27,
        '14:05',
        { visit: 'call_back', note: 'Ask for Sam on a weekday afternoon.' },
      ],
      [27, '14:06', { stage: 'visited', next: 'Visit again', due: -20 }],
      [
        20,
        '15:30',
        {
          visit: 'spoke',
          note: 'Stock list is on paper. Wants to see a stock page.',
        },
      ],
      [
        20,
        '15:35',
        { stage: 'follow_up', next: 'Show the stock page', due: -3 },
      ],
      [
        19,
        '09:10',
        {
          contact: {
            name: 'Jo Sample',
            phone: '07700 900103',
            role: 'staff',
          },
        },
      ],
    ],
  },
  {
    org: {
      name: 'Placeholder Cafe',
      source: 'referral',
      address_line_1: '3 Placeholder Lane',
      address_line_2: 'Testford',
      postcode: 'ZZ2 3CC',
    },
    contact: {
      name: 'Pat Placeholder',
      phone: '07700 900104',
      email: 'pat@example.com',
      role: 'owner',
    },
    added: [60, '09:30'],
    steps: [
      [58, '10:00', { visit: 'spoke', note: 'Wants a menu page and a map.' }],
      [58, '10:05', { stage: 'visited', next: 'Send a price', due: -55 }],
      [
        55,
        '17:00',
        { stage: 'quoted', next: 'Call about the price', due: -50 },
      ],
      [
        50,
        '12:30',
        { visit: 'spoke', note: 'Said yes. Start date in two weeks.' },
      ],
      [50, '12:35', { stage: 'won' }],
      [
        12,
        '13:15',
        {
          change: 'pat@example.com',
          to: {
            name: 'Pat Placeholder',
            phone: '07700 900105',
            email: 'pat@example.com',
            role: 'owner',
          },
        },
      ],
      [12, '13:20', { note: 'New phone number for Pat.' }],
    ],
  },
  {
    org: {
      name: 'Demo Dental Practice',
      source: 'door',
      address_line_1: '40 Demo Avenue',
      address_line_2: 'Testford',
      postcode: 'ZZ2 4DD',
    },
    contact: {
      name: 'Casey Demo',
      phone: '07700 900106',
      email: 'reception@example.com',
      role: 'staff',
    },
    added: [9, '11:00'],
    steps: [
      [
        9,
        '11:05',
        {
          visit: 'spoke',
          note: 'Spoke to reception. The practice manager is in on Tuesdays.',
        },
      ],
      [9, '11:10', { stage: 'visited', next: 'Visit on a Tuesday', due: 5 }],
    ],
  },
  {
    org: {
      name: 'Mock Lane Florist',
      source: 'door',
      address_line_1: '7 Mock Lane',
      address_line_2: 'Sampleton',
      postcode: 'ZZ1 5EE',
    },
    contact: { name: 'Morgan Mock', role: 'owner' },
    added: [24, '15:45'],
    steps: [
      [24, '15:50', { visit: 'no_answer' }],
      [24, '15:51', { stage: 'visited', next: 'Visit again', due: -17 }],
      [
        17,
        '10:20',
        { visit: 'do_not_knock', note: 'Sign on the door: no sales calls.' },
      ],
    ],
  },
  {
    org: {
      name: 'Test Street Barbers',
      source: 'web',
      address_line_1: '15 Test Street',
      address_line_2: 'Testford',
      postcode: 'ZZ2 6FF',
    },
    contact: {
      name: 'Robin Test',
      phone: '07700 900107',
      role: 'owner',
    },
    added: [3, '18:30'],
    steps: [
      [3, '18:32', { note: 'Filled in the web form. Wants online booking.' }],
      [3, '18:33', { stage: 'lead', next: 'First visit', due: 1 }],
    ],
  },
  {
    org: {
      name: 'Fictional Fitness',
      source: 'referral',
      address_line_1: 'Unit 2, Fiction Park',
      address_line_2: 'Sampleton',
      postcode: 'ZZ1 7GG',
    },
    contact: {
      name: 'Taylor Trial',
      phone: '07700 900108',
      email: 'taylor@example.com',
      role: 'owner',
    },
    added: [16, '08:50'],
    steps: [
      [
        15,
        '19:00',
        {
          visit: 'spoke',
          note: 'Class timetable is a photo on social media. Wants a booking page.',
        },
      ],
      [
        15,
        '19:05',
        {
          contact: {
            name: 'Jamie Dummy',
            phone: '07700 900109',
            email: 'jamie@example.com',
            role: 'staff',
          },
        },
      ],
      [15, '19:10', { stage: 'visited', next: 'Send a price', due: -10 }],
      [11, '14:00', { note: 'Sent the price for a booking page.' }],
      [11, '14:05', { stage: 'quoted', next: 'Call Taylor', due: 10 }],
    ],
  },
  {
    org: {
      name: 'Dummy Print Co',
      source: 'door',
      address_line_1: '9 Dummy Yard',
      address_line_2: 'Testford',
      postcode: 'ZZ2 8HH',
    },
    contact: {
      name: 'Chris Dummy',
      phone: '07700 900110',
      email: 'chris@example.com',
      role: 'owner',
    },
    added: [34, '13:00'],
    steps: [
      [
        34,
        '13:05',
        {
          contact: {
            name: 'Lee Dummy',
            phone: '07700 900111',
            email: 'lee@example.com',
            role: 'staff',
          },
        },
      ],
      [
        34,
        '13:10',
        { visit: 'spoke', note: 'Wants a page to upload print files.' },
      ],
      [34, '13:15', { stage: 'visited', next: 'Visit again', due: -25 }],
      [21, '10:40', { remove: 'lee@example.com' }],
      [21, '10:45', { note: 'Lee left the company.' }],
      [
        21,
        '10:50',
        { stage: 'follow_up', next: 'Ask Chris about file sizes', due: -1 },
      ],
    ],
  },
  {
    org: {
      name: 'Trial Run Garage',
      source: 'door',
      address_line_1: '50 Trial Road',
      address_line_2: 'Sampleton',
      postcode: 'ZZ1 9JJ',
    },
    added: [6, '16:00'],
    steps: [
      [
        6,
        '16:10',
        {
          visit: 'not_interested',
          note: 'Has a website from a cousin. Try again next year.',
        },
      ],
      [6, '16:15', { stage: 'visited' }],
    ],
  },
  {
    org: {
      name: 'Specimen Books',
      source: 'referral',
      address_line_1: '4 Specimen Row',
      address_line_2: 'Testford',
      postcode: 'ZZ2 1KK',
    },
    contact: { name: 'Drew Specimen', email: 'drew@example.com' },
    added: [1, '12:00'],
    steps: [],
  },
];

/** The date `days` from today in London, as `YYYY-MM-DD`. */
const dateIn = (days: number) =>
  new Date(Date.parse(`${today()}T12:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/**
 * The instant `days` before today at `time` (UTC). Each step is one day
 * or more in the past, so the times stay before the time of the seed.
 */
const instant = (days: number, time: string) =>
  new Date(`${dateIn(-Math.max(1, days))}T${time}:00.000Z`).toISOString();

/** The values of the contact form for `contact`. */
const contactValues = (contact: DemoContact) => {
  const { values, error } = parseForm(contactForm, contact);
  if (error) throw new Error(`Demo contact ${contact.name}: ${error}`);
  return values;
};

/**
 * The tables and the time columns that a step writes. A row that a step
 * adds gets the time of the step in each column. A row that a step changes
 * gets it in `updated_at`.
 */
const TIMES: [string, string[]][] = [
  ['organisation', ['created_at', 'updated_at']],
  ['person', ['created_at', 'updated_at']],
  ['visit', ['at']],
  ['note', ['created_at']],
  ['audit_log', ['at']],
];

/**
 * Run `step`, then give each row that it added or changed the time `at`.
 * The functions of the routes write the time of now. The demo needs times
 * in the past.
 */
const backdate = (db: Database, at: string, step: () => void) => {
  const maxRowid = new Map(
    TIMES.map(([table]) => [
      table,
      db
        .query<{ n: number | null }, []>(
          `SELECT max(rowid) AS n FROM ${table};`,
        )
        .get()?.n ?? 0,
    ]),
  );
  const started = new Date().toISOString();
  step();
  for (const [table, columns] of TIMES) {
    const set = columns.map((column) => `${column} = ?1`).join(', ');
    db.query(`UPDATE ${table} SET ${set} WHERE rowid > ?2;`).run(
      at,
      maxRowid.get(table) ?? 0,
    );
    if (columns.includes('updated_at')) {
      db.query(
        `UPDATE ${table} SET updated_at = ?1 WHERE updated_at >= ?2;`,
      ).run(at, started);
    }
  }
};

/** The contact with `email` of the organisation `orgId`. */
const contactByEmail = (db: Database, orgId: string, email: string) => {
  const contact = listContacts(db, orgId).find((c) => c.email === email);
  if (!contact) throw new Error(`Demo contact ${email} is missing.`);
  return contact;
};

/** Do one step of the story of the organisation with `slug`. */
const runStep = (db: Database, actor: string, slug: string, step: Step) => {
  const org = findOrg(db, slug);
  if (!org) throw new Error(`Demo organisation ${slug} is missing.`);
  if ('visit' in step) {
    logActivity(db, actor, org, { outcome: step.visit, note: step.note ?? '' });
  } else if ('note' in step) {
    logActivity(db, actor, org, { outcome: NOTE_ONLY, note: step.note });
  } else if ('stage' in step) {
    setPipeline(db, actor, org, {
      stage: step.stage,
      next_action: step.next ?? null,
      next_action_on: step.due === undefined ? null : dateIn(step.due),
    });
  } else if ('contact' in step) {
    const error = addContact(db, actor, org.id, contactValues(step.contact));
    if (error) throw new Error(error);
  } else if ('change' in step) {
    const contact = contactByEmail(db, org.id, step.change);
    const error = saveContact(
      db,
      actor,
      org.id,
      contact,
      contactValues(step.to),
    );
    if (error) throw new Error(error);
  } else {
    removeContact(db, actor, org.id, contactByEmail(db, org.id, step.remove));
  }
};

/** The number of rows of each kind after a seed. */
export interface SeedCounts {
  organisations: number;
  contacts: number;
  visits: number;
  notes: number;
}

/**
 * Replace the data of the crm with the fixed demo set, in one transaction.
 * `adminEmail` is CRM_ADMIN_EMAIL: the seed keeps that person (and their
 * sessions and passkeys) and makes the person if it is missing. Each other
 * person goes. The audit rows of the organisations, the people, the
 * memberships, the visits and the notes go too. The sign-in rows stay.
 */
export const seedDemo = (
  db: Database,
  adminEmail: string | undefined,
): SeedCounts => {
  if (isLiveHost(process.env.CRM_PUBLIC_URL)) {
    throw new Error(
      `The demo seed does not run when the host of CRM_PUBLIC_URL is ${LIVE_HOST}.`,
    );
  }
  const email = normalizeEmail(adminEmail);
  if (!email) throw new Error('The demo seed needs CRM_ADMIN_EMAIL.');
  ensureAdmin(db, email);
  const admin = db
    .query<{ id: string }, [string]>(
      'SELECT id FROM person WHERE lower(email) = ?;',
    )
    .get(email);
  if (!admin) throw new Error(`No person has the email ${email}.`);
  const actor = admin.id;

  db.transaction(() => {
    db.query('DELETE FROM organisation;').run();
    db.query('DELETE FROM person WHERE id != ?;').run(actor);
    db.query('UPDATE person SET name = email, phone = NULL WHERE id = ?;').run(
      actor,
    );
    db.query(
      `DELETE FROM audit_log
       WHERE entity IN ('organisation', 'person', 'membership', 'visit', 'note');`,
    ).run();

    for (const demo of DEMO_ORGS) {
      const { values, error } = parseForm(organisationForm, demo.org);
      if (error)
        throw new Error(`Demo organisation ${demo.org.name}: ${error}`);
      const slug = resolveSlug(db, values);
      if ('error' in slug) throw new Error(slug.error);
      backdate(db, instant(...demo.added), () =>
        addOrg(
          db,
          actor,
          { ...values, slug: slug.slug },
          demo.contact ? contactValues(demo.contact) : null,
        ),
      );
      for (const [days, time, step] of demo.steps) {
        backdate(db, instant(days, time), () =>
          runStep(db, actor, slug.slug, step),
        );
      }
    }
  })();

  const count = (table: string) =>
    db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table};`).get()
      ?.n ?? 0;
  return {
    organisations: count('organisation'),
    contacts: count('membership'),
    visits: count('visit'),
    notes: count('note'),
  };
};

if (import.meta.main) {
  try {
    const db = openDatabase(DB_PATH);
    const counts = seedDemo(db, process.env.CRM_ADMIN_EMAIL);
    db.close();
    console.log(
      `demo:seed: ${DB_PATH} has the demo data: ${counts.organisations} organisations, ${counts.contacts} contacts, ${counts.visits} visits, ${counts.notes} notes.`,
    );
  } catch (error) {
    console.error(`demo:seed: ${(error as Error).message}`);
    process.exit(1);
  }
}
