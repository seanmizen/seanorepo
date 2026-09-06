import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { getTestEnv, uniqueEmail } from './setup';

/**
 * Constraint coverage for 001_domain_tables.sql.
 *
 * The seven domain tables landed with 16 CHECK constraints, unique keys and a
 * deliberately asymmetric set of FK delete rules — all verified by hand,
 * because the harness did not exist yet. This backfills that, so a future
 * migration cannot quietly relax a guarantee.
 *
 * Suites share one database, so nothing here assumes an empty table: every
 * test creates its own users, profiles and briefs with unique emails and
 * slugs, and every write is scoped to a row this file made.
 */

const env = getTestEnv();

// Imported after getTestEnv so DB_PATH is already set.
const { runMigrations } = await import('../services/migrations');

await runMigrations();

/**
 * A fresh connection with foreign keys on.
 *
 * `PRAGMA foreign_keys` is per-connection and off by default — without this
 * every FK expectation below would pass while enforcing nothing.
 */
const open = (): Database => {
  const db = new Database(join(env.dbPath, 'database.db'));
  db.run('PRAGMA foreign_keys = ON');
  return db;
};

type Binding = string | number | null;
type Row = Record<string, Binding>;

let counter = 0;
/** Unique per call — slugs are unique site-wide and suites share the file. */
const uniqueSlug = (prefix: string): string =>
  `${prefix}-${Date.now()}-${counter++}`;

const insert = (db: Database, table: string, row: Row): number => {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols
    .map(() => '?')
    .join(', ')})`;
  db.prepare(sql).run(...(cols.map((c) => row[c]) as never[]));
  return (db.query('SELECT last_insert_rowid() AS id').get() as { id: number })
    .id;
};

const makeUser = (db: Database, role: 'buyer' | 'designer'): number =>
  insert(db, 'users', { email: uniqueEmail(role), role });

const makeImage = (db: Database): number =>
  insert(db, 'images', {
    storage_path: `${uniqueSlug('img')}.jpg`,
    mime_type: 'image/jpeg',
    byte_size: 1234,
  });

const makeProfile = (db: Database, extra: Row = {}): number =>
  insert(db, 'designer_profiles', {
    user_id: makeUser(db, 'designer'),
    slug: uniqueSlug('studio'),
    studio_name: 'Test Studio',
    ...extra,
  });

const makeProject = (db: Database, extra: Row = {}): number =>
  insert(db, 'projects', {
    designer_profile_id: makeProfile(db),
    slug: uniqueSlug('project'),
    title: 'A Completed Portfolio Piece',
    ...extra,
  });

const makeBrief = (db: Database, extra: Row = {}): number =>
  insert(db, 'briefs', {
    title: 'Kitchen rework',
    description: 'A homeowner posted job, not a portfolio piece.',
    ...extra,
  });

/** The NOT NULL columns each table needs before the one under test is added. */
const baseRow = (db: Database, table: string): Row => {
  switch (table) {
    case 'designer_profiles':
      return {
        user_id: makeUser(db, 'designer'),
        slug: uniqueSlug('studio'),
        studio_name: 'Test Studio',
      };
    case 'projects':
      return {
        designer_profile_id: makeProfile(db),
        slug: uniqueSlug('project'),
        title: 'A Completed Portfolio Piece',
      };
    case 'enquiries':
      return {
        designer_profile_id: makeProfile(db),
        contact_name: 'Homeowner',
        contact_email: uniqueEmail('buyer'),
        message: 'Could you quote for a kitchen?',
      };
    case 'briefs':
      return {
        title: 'Kitchen rework',
        description: 'A homeowner posted job, not a portfolio piece.',
      };
    case 'pitches':
      return {
        brief_id: makeBrief(db),
        designer_profile_id: makeProfile(db),
        message: 'We would love to take this on.',
      };
    default:
      throw new Error(`no base row for ${table}`);
  }
};

const DOMAIN_TABLES = [
  'designer_profiles',
  'projects',
  'project_images',
  'saved_designers',
  'enquiries',
  'briefs',
  'pitches',
];

describe('001_domain_tables — tables exist', () => {
  test('all seven domain tables are created on a fresh database', () => {
    const db = open();
    const tables = (
      db
        .query("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    db.close();

    for (const expected of DOMAIN_TABLES) {
      expect(tables).toContain(expected);
    }
  });

  test('is recorded as an applied migration', () => {
    const db = open();
    const row = db
      .query('SELECT filename FROM schema_migrations WHERE version = 1')
      .get() as { filename: string } | null;
    db.close();

    expect(row?.filename).toBe('001_domain_tables.sql');
  });
});

/**
 * Every CHECK constraint in 001. Several bad values are deliberately valid on
 * a *different* table ('pending' on projects, 'new' on briefs, 'open' on
 * enquiries, 'exploring' on pitches.availability) so a copy-pasted enum list
 * would be caught.
 */
const CHECK_CASES: Array<{
  table: string;
  column: string;
  bad: string;
  good: string;
}> = [
  {
    table: 'designer_profiles',
    column: 'budget_band',
    bad: '25k_to_50k',
    good: '25k_50k',
  },
  {
    table: 'designer_profiles',
    column: 'status',
    bad: 'live',
    good: 'approved',
  },
  {
    table: 'projects',
    column: 'project_type',
    bad: 'treehouse',
    good: 'kitchen',
  },
  {
    table: 'projects',
    column: 'budget_band',
    bad: '250k+',
    good: '250k_plus',
  },
  { table: 'projects', column: 'status', bad: 'pending', good: 'published' },
  {
    table: 'enquiries',
    column: 'project_type',
    bad: 'shed',
    good: 'extension',
  },
  {
    table: 'enquiries',
    column: 'budget_band',
    bad: 'free',
    good: 'under_10k',
  },
  { table: 'enquiries', column: 'timeline', bad: 'someday', good: 'exploring' },
  { table: 'enquiries', column: 'status', bad: 'open', good: 'archived' },
  {
    table: 'briefs',
    column: 'project_type',
    bad: 'houseboat',
    good: 'new_build',
  },
  {
    table: 'briefs',
    column: 'budget_band',
    bad: '100k-250k',
    good: '100k_250k',
  },
  { table: 'briefs', column: 'timeline', bad: 'immediately', good: 'asap' },
  { table: 'briefs', column: 'status', bad: 'new', good: 'open' },
  {
    table: 'pitches',
    column: 'budget_band',
    bad: '10k-25k',
    good: '10k_25k',
  },
  {
    table: 'pitches',
    column: 'availability',
    bad: 'exploring',
    good: 'within_12_months',
  },
  {
    table: 'pitches',
    column: 'status',
    bad: 'archived',
    good: 'shortlisted',
  },
];

describe('CHECK constraints actually bite', () => {
  for (const { table, column, bad, good } of CHECK_CASES) {
    test(`${table}.${column} rejects '${bad}'`, () => {
      const db = open();
      const row = { ...baseRow(db, table), [column]: bad };
      expect(() => insert(db, table, row)).toThrow();
      db.close();
    });

    test(`${table}.${column} accepts '${good}'`, () => {
      const db = open();
      const row = { ...baseRow(db, table), [column]: good };
      const id = insert(db, table, row);
      const stored = db
        .query(`SELECT ${column} AS v FROM ${table} WHERE id = ?`)
        .get(id) as { v: string };
      db.close();

      expect(stored.v).toBe(good);
    });
  }

  test('covers every CHECK constraint in the migration', () => {
    // 16 CHECKs shipped in 001; a new one must arrive with a case here.
    expect(CHECK_CASES.length).toBe(16);
  });
});

describe('designer_profiles approval gate', () => {
  test('a new profile defaults to draft, not publicly visible', () => {
    const db = open();
    const id = makeProfile(db);
    const row = db
      .query('SELECT status FROM designer_profiles WHERE id = ?')
      .get(id) as { status: string };
    db.close();

    expect(row.status).toBe('draft');
    expect(row.status).not.toBe('approved');
  });

  test('a new profile is invisible to a discovery-shaped query', () => {
    const db = open();
    const id = makeProfile(db);
    const found = db
      .query(
        "SELECT id FROM designer_profiles WHERE id = ? AND status = 'approved'",
      )
      .get(id);
    db.close();

    expect(found).toBeNull();
  });
});

describe('unique keys', () => {
  test('designer_profiles.slug is unique across different users', () => {
    const db = open();
    const slug = uniqueSlug('studio');
    makeProfile(db, { slug });

    expect(() => makeProfile(db, { slug })).toThrow();
    db.close();
  });

  test('designer_profiles.user_id is unique — one profile per designer', () => {
    const db = open();
    const userId = makeUser(db, 'designer');
    insert(db, 'designer_profiles', {
      user_id: userId,
      slug: uniqueSlug('studio'),
      studio_name: 'First',
    });

    expect(() =>
      insert(db, 'designer_profiles', {
        user_id: userId,
        slug: uniqueSlug('studio'),
        studio_name: 'Second',
      }),
    ).toThrow();
    db.close();
  });

  test('projects.slug is unique site-wide, across different designers', () => {
    const db = open();
    const slug = uniqueSlug('project');
    makeProject(db, { slug });

    expect(() => makeProject(db, { slug })).toThrow();
    db.close();
  });

  test('saved_designers rejects a duplicate pair', () => {
    const db = open();
    const userId = makeUser(db, 'buyer');
    const profileId = makeProfile(db);
    insert(db, 'saved_designers', {
      user_id: userId,
      designer_profile_id: profileId,
    });

    expect(() =>
      insert(db, 'saved_designers', {
        user_id: userId,
        designer_profile_id: profileId,
      }),
    ).toThrow();
    db.close();
  });

  test('saved_designers allows the same buyer to save a second designer', () => {
    const db = open();
    const userId = makeUser(db, 'buyer');
    insert(db, 'saved_designers', {
      user_id: userId,
      designer_profile_id: makeProfile(db),
    });

    expect(() =>
      insert(db, 'saved_designers', {
        user_id: userId,
        designer_profile_id: makeProfile(db),
      }),
    ).not.toThrow();
    db.close();
  });

  test('project_images rejects the same image twice on one project', () => {
    const db = open();
    const projectId = makeProject(db);
    const imageId = makeImage(db);
    insert(db, 'project_images', {
      project_id: projectId,
      image_id: imageId,
    });

    expect(() =>
      insert(db, 'project_images', {
        project_id: projectId,
        image_id: imageId,
      }),
    ).toThrow();
    db.close();
  });

  test('pitches rejects a second pitch from one designer on one brief', () => {
    const db = open();
    const briefId = makeBrief(db);
    const profileId = makeProfile(db);
    insert(db, 'pitches', {
      brief_id: briefId,
      designer_profile_id: profileId,
      message: 'First pitch',
    });

    expect(() =>
      insert(db, 'pitches', {
        brief_id: briefId,
        designer_profile_id: profileId,
        message: 'Second pitch',
      }),
    ).toThrow();
    db.close();
  });
});

const MISSING_ID = 999_999_999;

describe('orphan foreign keys are rejected', () => {
  test('designer_profiles.user_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'designer_profiles', {
        user_id: MISSING_ID,
        slug: uniqueSlug('studio'),
        studio_name: 'Ghost',
      }),
    ).toThrow();
    db.close();
  });

  test('designer_profiles.cover_image_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'designer_profiles', {
        user_id: makeUser(db, 'designer'),
        slug: uniqueSlug('studio'),
        studio_name: 'Ghost',
        cover_image_id: MISSING_ID,
      }),
    ).toThrow();
    db.close();
  });

  test('projects.designer_profile_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'projects', {
        designer_profile_id: MISSING_ID,
        slug: uniqueSlug('project'),
        title: 'Orphan',
      }),
    ).toThrow();
    db.close();
  });

  test('project_images.project_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'project_images', {
        project_id: MISSING_ID,
        image_id: makeImage(db),
      }),
    ).toThrow();
    db.close();
  });

  test('project_images.image_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'project_images', {
        project_id: makeProject(db),
        image_id: MISSING_ID,
      }),
    ).toThrow();
    db.close();
  });

  test('saved_designers.user_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'saved_designers', {
        user_id: MISSING_ID,
        designer_profile_id: makeProfile(db),
      }),
    ).toThrow();
    db.close();
  });

  test('saved_designers.designer_profile_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'saved_designers', {
        user_id: makeUser(db, 'buyer'),
        designer_profile_id: MISSING_ID,
      }),
    ).toThrow();
    db.close();
  });

  test('enquiries.designer_profile_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'enquiries', {
        designer_profile_id: MISSING_ID,
        contact_name: 'Homeowner',
        contact_email: uniqueEmail('buyer'),
        message: 'Hello?',
      }),
    ).toThrow();
    db.close();
  });

  test('enquiries.buyer_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'enquiries', {
        buyer_id: MISSING_ID,
        designer_profile_id: makeProfile(db),
        contact_name: 'Homeowner',
        contact_email: uniqueEmail('buyer'),
        message: 'Hello?',
      }),
    ).toThrow();
    db.close();
  });

  test('briefs.buyer_id', () => {
    const db = open();
    expect(() => makeBrief(db, { buyer_id: MISSING_ID })).toThrow();
    db.close();
  });

  test('pitches.brief_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'pitches', {
        brief_id: MISSING_ID,
        designer_profile_id: makeProfile(db),
        message: 'Orphan pitch',
      }),
    ).toThrow();
    db.close();
  });

  test('pitches.designer_profile_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'pitches', {
        brief_id: makeBrief(db),
        designer_profile_id: MISSING_ID,
        message: 'Orphan pitch',
      }),
    ).toThrow();
    db.close();
  });
});

describe('delete behaviour is deliberately asymmetric', () => {
  test('deleting a designer user cascades to profile, projects and images', () => {
    const db = open();
    const userId = makeUser(db, 'designer');
    const profileId = insert(db, 'designer_profiles', {
      user_id: userId,
      slug: uniqueSlug('studio'),
      studio_name: 'Doomed Studio',
    });
    const projectId = insert(db, 'projects', {
      designer_profile_id: profileId,
      slug: uniqueSlug('project'),
      title: 'Doomed Project',
    });
    const linkId = insert(db, 'project_images', {
      project_id: projectId,
      image_id: makeImage(db),
    });

    db.prepare('DELETE FROM users WHERE id = ?').run(userId as never);

    const gone = (table: string, id: number) =>
      db.query(`SELECT id FROM ${table} WHERE id = ?`).get(id);

    expect(gone('designer_profiles', profileId)).toBeNull();
    expect(gone('projects', projectId)).toBeNull();
    expect(gone('project_images', linkId)).toBeNull();
    db.close();
  });

  test('deleting a buyer keeps the enquiry in the designer inbox, buyer_id NULL', () => {
    const db = open();
    const buyerId = makeUser(db, 'buyer');
    const enquiryId = insert(db, 'enquiries', {
      buyer_id: buyerId,
      designer_profile_id: makeProfile(db),
      contact_name: 'Departed Homeowner',
      contact_email: uniqueEmail('buyer'),
      message: 'Still in the inbox after I leave.',
    });

    db.prepare('DELETE FROM users WHERE id = ?').run(buyerId as never);

    const row = db
      .query(
        'SELECT buyer_id, contact_name, message FROM enquiries WHERE id = ?',
      )
      .get(enquiryId) as {
      buyer_id: number | null;
      contact_name: string;
      message: string;
    } | null;
    db.close();

    expect(row).not.toBeNull();
    expect(row?.buyer_id).toBeNull();
    // The snapshotted contact details are the reason the record still means
    // something once the account is gone.
    expect(row?.contact_name).toBe('Departed Homeowner');
  });

  test('deleting a buyer keeps an open brief and its live pitches', () => {
    const db = open();
    const buyerId = makeUser(db, 'buyer');
    const briefId = makeBrief(db, { buyer_id: buyerId, status: 'open' });
    const pitchId = insert(db, 'pitches', {
      brief_id: briefId,
      designer_profile_id: makeProfile(db),
      message: 'My pitch must outlive their account.',
    });

    db.prepare('DELETE FROM users WHERE id = ?').run(buyerId as never);

    const brief = db
      .query('SELECT buyer_id, status FROM briefs WHERE id = ?')
      .get(briefId) as { buyer_id: number | null; status: string } | null;
    const pitch = db
      .query('SELECT id FROM pitches WHERE id = ?')
      .get(pitchId) as { id: number } | null;
    db.close();

    expect(brief).not.toBeNull();
    expect(brief?.buyer_id).toBeNull();
    expect(brief?.status).toBe('open');
    expect(pitch?.id).toBe(pitchId);
  });

  test('deleting a brief cascades to its pitches', () => {
    const db = open();
    const briefId = makeBrief(db, { status: 'open' });
    const pitchId = insert(db, 'pitches', {
      brief_id: briefId,
      designer_profile_id: makeProfile(db),
      message: 'Goes with the brief.',
    });

    db.prepare('DELETE FROM briefs WHERE id = ?').run(briefId as never);

    const pitch = db.query('SELECT id FROM pitches WHERE id = ?').get(pitchId);
    db.close();

    expect(pitch).toBeNull();
  });

  test('deleting a cover image nulls the reference rather than the project', () => {
    const db = open();
    const imageId = makeImage(db);
    const projectId = makeProject(db, { cover_image_id: imageId });

    db.prepare('DELETE FROM images WHERE id = ?').run(imageId as never);

    const row = db
      .query('SELECT cover_image_id FROM projects WHERE id = ?')
      .get(projectId) as { cover_image_id: number | null } | null;
    db.close();

    expect(row).not.toBeNull();
    expect(row?.cover_image_id).toBeNull();
  });
});

describe('project_images display order', () => {
  test('round-trips the curated sequence, not insertion order', () => {
    const db = open();
    const projectId = makeProject(db);

    // Inserted deliberately out of order — display_order is authoritative.
    const third = makeImage(db);
    const first = makeImage(db);
    const second = makeImage(db);
    insert(db, 'project_images', {
      project_id: projectId,
      image_id: third,
      display_order: 2,
      caption: 'third',
    });
    insert(db, 'project_images', {
      project_id: projectId,
      image_id: first,
      display_order: 0,
      caption: 'first',
    });
    insert(db, 'project_images', {
      project_id: projectId,
      image_id: second,
      display_order: 1,
      caption: 'second',
    });

    const ordered = db
      .query(
        'SELECT image_id, display_order, caption FROM project_images WHERE project_id = ? ORDER BY display_order',
      )
      .all(projectId) as Array<{
      image_id: number;
      display_order: number;
      caption: string;
    }>;
    db.close();

    expect(ordered.map((r) => r.image_id)).toEqual([first, second, third]);
    expect(ordered.map((r) => r.display_order)).toEqual([0, 1, 2]);
    expect(ordered.map((r) => r.caption)).toEqual(['first', 'second', 'third']);
  });

  test('defaults display_order to 0', () => {
    const db = open();
    const projectId = makeProject(db);
    const linkId = insert(db, 'project_images', {
      project_id: projectId,
      image_id: makeImage(db),
    });

    const row = db
      .query('SELECT display_order FROM project_images WHERE id = ?')
      .get(linkId) as { display_order: number };
    db.close();

    expect(row.display_order).toBe(0);
  });

  test('reordering persists', () => {
    const db = open();
    const projectId = makeProject(db);
    const linkId = insert(db, 'project_images', {
      project_id: projectId,
      image_id: makeImage(db),
      display_order: 5,
    });

    // Scoped to the row this test created — never a bulk update.
    db.prepare('UPDATE project_images SET display_order = ? WHERE id = ?').run(
      ...([9, linkId] as never[]),
    );

    const row = db
      .query('SELECT display_order FROM project_images WHERE id = ?')
      .get(linkId) as { display_order: number };
    db.close();

    expect(row.display_order).toBe(9);
  });
});
