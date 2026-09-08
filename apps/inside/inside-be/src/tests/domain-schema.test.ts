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
  insert(db, 'portfolio_projects', {
    designer_profile_id: makeProfile(db),
    slug: uniqueSlug('project'),
    title: 'A Completed Portfolio Piece',
    ...extra,
  });

const makeBrief = (db: Database, extra: Row = {}): number =>
  insert(db, 'briefs', {
    title: 'Kitchen rework',
    description: 'A homeowner posted job, not a portfolio piece.',
    // Briefs gained a unique slug in 005. Unique per row, because these suites
    // share one database and stay independent through unique data.
    slug: uniqueSlug('brief'),
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
    case 'portfolio_projects':
      return {
        designer_profile_id: makeProfile(db),
        slug: uniqueSlug('project'),
        title: 'A Completed Portfolio Piece',
      };
    case 'briefs':
      return {
        title: 'Kitchen rework',
        description: 'A homeowner posted job, not a portfolio piece.',
        slug: uniqueSlug('brief'),
      };
    case 'bids':
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
  'portfolio_projects',
  'portfolio_project_images',
  'saved_designers',
  'briefs',
  'brief_invitees',
  'bids',
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
 * Every CHECK constraint in the migrations. Several bad values are
 * deliberately valid on a *different* table ('pending' on portfolio_projects,
 * 'draft' on bids, 'exploring' on bids.availability) so a copy-pasted enum
 * list would be caught.
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
    table: 'portfolio_projects',
    column: 'work_type',
    bad: 'treehouse',
    good: 'kitchen',
  },
  {
    table: 'portfolio_projects',
    column: 'budget_band',
    bad: '250k+',
    good: '250k_plus',
  },
  {
    table: 'portfolio_projects',
    column: 'status',
    bad: 'pending',
    good: 'published',
  },
  {
    table: 'briefs',
    column: 'work_type',
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
  // `status` was retired in 006. Visibility is the enum that replaced the part
  // of it worth keeping. 'draft' is a good probe: it was a legal status and is
  // deliberately NOT a visibility, because unpublished is a timestamp now.
  { table: 'briefs', column: 'visibility', bad: 'draft', good: 'link' },
  {
    table: 'bids',
    column: 'budget_band',
    bad: '10k-25k',
    good: '10k_25k',
  },
  {
    table: 'bids',
    column: 'availability',
    bad: 'exploring',
    good: 'within_12_months',
  },
  {
    table: 'bids',
    column: 'status',
    // 'shortlisted' was one of six speculative states SEAN-185 removed. It is
    // now as invalid as anything else nobody built a behaviour for.
    bad: 'shortlisted',
    good: 'submitted',
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

  test('covers every CHECK constraint in the migrations', () => {
    // 12 after 006. The four enquiries CHECKs went with the table, and both
    // briefs.status cases went with the column — replaced by the single
    // briefs.visibility case. A new or changed constraint must still arrive
    // with a case of its own.
    expect(CHECK_CASES.length).toBe(12);
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

  test('portfolio_projects.slug is unique site-wide, across different designers', () => {
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

  test('portfolio_project_images rejects the same image twice on one project', () => {
    const db = open();
    const portfolioProjectId = makeProject(db);
    const imageId = makeImage(db);
    insert(db, 'portfolio_project_images', {
      portfolio_project_id: portfolioProjectId,
      image_id: imageId,
    });

    expect(() =>
      insert(db, 'portfolio_project_images', {
        portfolio_project_id: portfolioProjectId,
        image_id: imageId,
      }),
    ).toThrow();
    db.close();
  });

  test('bids rejects a second bid from one designer on one brief', () => {
    const db = open();
    const briefId = makeBrief(db);
    const profileId = makeProfile(db);
    insert(db, 'bids', {
      brief_id: briefId,
      designer_profile_id: profileId,
      message: 'First bid',
    });

    expect(() =>
      insert(db, 'bids', {
        brief_id: briefId,
        designer_profile_id: profileId,
        message: 'Second bid',
      }),
    ).toThrow();
    db.close();
  });
});

const SOME_TIME = '2026-01-01 12:00:00';
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

  test('portfolio_projects.designer_profile_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'portfolio_projects', {
        designer_profile_id: MISSING_ID,
        slug: uniqueSlug('project'),
        title: 'Orphan',
      }),
    ).toThrow();
    db.close();
  });

  test('portfolio_project_images.portfolio_project_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'portfolio_project_images', {
        portfolio_project_id: MISSING_ID,
        image_id: makeImage(db),
      }),
    ).toThrow();
    db.close();
  });

  test('portfolio_project_images.image_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'portfolio_project_images', {
        portfolio_project_id: makeProject(db),
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

  test('brief_invitees.brief_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'brief_invitees', {
        brief_id: MISSING_ID,
        user_id: makeUser(db, 'buyer'),
      }),
    ).toThrow();
    db.close();
  });

  test('brief_invitees.user_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'brief_invitees', {
        brief_id: makeBrief(db),
        user_id: MISSING_ID,
      }),
    ).toThrow();
    db.close();
  });

  test('briefs.buyer_id', () => {
    const db = open();
    expect(() => makeBrief(db, { buyer_id: MISSING_ID })).toThrow();
    db.close();
  });

  test('bids.brief_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'bids', {
        brief_id: MISSING_ID,
        designer_profile_id: makeProfile(db),
        message: 'Orphan bid',
      }),
    ).toThrow();
    db.close();
  });

  test('bids.designer_profile_id', () => {
    const db = open();
    expect(() =>
      insert(db, 'bids', {
        brief_id: makeBrief(db),
        designer_profile_id: MISSING_ID,
        message: 'Orphan bid',
      }),
    ).toThrow();
    db.close();
  });
});

describe('delete behaviour is deliberately asymmetric', () => {
  test('deleting a designer user cascades to profile, portfolio_projects and images', () => {
    const db = open();
    const userId = makeUser(db, 'designer');
    const profileId = insert(db, 'designer_profiles', {
      user_id: userId,
      slug: uniqueSlug('studio'),
      studio_name: 'Doomed Studio',
    });
    const portfolioProjectId = insert(db, 'portfolio_projects', {
      designer_profile_id: profileId,
      slug: uniqueSlug('project'),
      title: 'Doomed PortfolioProject',
    });
    const linkId = insert(db, 'portfolio_project_images', {
      portfolio_project_id: portfolioProjectId,
      image_id: makeImage(db),
    });

    db.prepare('DELETE FROM users WHERE id = ?').run(userId as never);

    const gone = (table: string, id: number) =>
      db.query(`SELECT id FROM ${table} WHERE id = ?`).get(id);

    expect(gone('designer_profiles', profileId)).toBeNull();
    expect(gone('portfolio_projects', portfolioProjectId)).toBeNull();
    expect(gone('portfolio_project_images', linkId)).toBeNull();
    db.close();
  });

  test('an invitee list survives an unpublish', () => {
    const db = open();
    const briefId = makeBrief(db, { published_at: SOME_TIME });
    const userId = makeUser(db, 'designer');
    insert(db, 'brief_invitees', { brief_id: briefId, user_id: userId });

    // Unpublishing is only a cleared timestamp. If it also dropped invitees,
    // republishing would silently require re-inviting everyone — which is the
    // behaviour REQ-BRIEF-003 exists to rule out.
    db.prepare('UPDATE briefs SET published_at = NULL WHERE id = ?').run(
      briefId as never,
    );

    const still = db
      .query('SELECT user_id FROM brief_invitees WHERE brief_id = ?')
      .get(briefId) as { user_id: number } | null;
    db.close();

    expect(still?.user_id).toBe(userId);
  });

  test('deleting a buyer keeps an open brief and its live bids', () => {
    const db = open();
    const buyerId = makeUser(db, 'buyer');
    const briefId = makeBrief(db, {
      buyer_id: buyerId,
      published_at: SOME_TIME,
    });
    const bidId = insert(db, 'bids', {
      brief_id: briefId,
      designer_profile_id: makeProfile(db),
      message: 'My bid must outlive their account.',
    });

    db.prepare('DELETE FROM users WHERE id = ?').run(buyerId as never);

    const brief = db
      .query('SELECT buyer_id, published_at FROM briefs WHERE id = ?')
      .get(briefId) as {
      buyer_id: number | null;
      published_at: string | null;
    } | null;
    const bid = db.query('SELECT id FROM bids WHERE id = ?').get(bidId) as {
      id: number;
    } | null;
    db.close();

    expect(brief).not.toBeNull();
    expect(brief?.buyer_id).toBeNull();
    expect(brief?.published_at).not.toBeNull();
    expect(bid?.id).toBe(bidId);
  });

  test('deleting a brief cascades to its bids', () => {
    const db = open();
    const briefId = makeBrief(db, { published_at: SOME_TIME });
    const bidId = insert(db, 'bids', {
      brief_id: briefId,
      designer_profile_id: makeProfile(db),
      message: 'Goes with the brief.',
    });

    db.prepare('DELETE FROM briefs WHERE id = ?').run(briefId as never);

    const bid = db.query('SELECT id FROM bids WHERE id = ?').get(bidId);
    db.close();

    expect(bid).toBeNull();
  });

  test('deleting a cover image nulls the reference rather than the project', () => {
    const db = open();
    const imageId = makeImage(db);
    const portfolioProjectId = makeProject(db, { cover_image_id: imageId });

    db.prepare('DELETE FROM images WHERE id = ?').run(imageId as never);

    const row = db
      .query('SELECT cover_image_id FROM portfolio_projects WHERE id = ?')
      .get(portfolioProjectId) as { cover_image_id: number | null } | null;
    db.close();

    expect(row).not.toBeNull();
    expect(row?.cover_image_id).toBeNull();
  });
});

describe('portfolio_project_images display order', () => {
  test('round-trips the curated sequence, not insertion order', () => {
    const db = open();
    const portfolioProjectId = makeProject(db);

    // Inserted deliberately out of order — display_order is authoritative.
    const third = makeImage(db);
    const first = makeImage(db);
    const second = makeImage(db);
    insert(db, 'portfolio_project_images', {
      portfolio_project_id: portfolioProjectId,
      image_id: third,
      display_order: 2,
      caption: 'third',
    });
    insert(db, 'portfolio_project_images', {
      portfolio_project_id: portfolioProjectId,
      image_id: first,
      display_order: 0,
      caption: 'first',
    });
    insert(db, 'portfolio_project_images', {
      portfolio_project_id: portfolioProjectId,
      image_id: second,
      display_order: 1,
      caption: 'second',
    });

    const ordered = db
      .query(
        'SELECT image_id, display_order, caption FROM portfolio_project_images WHERE portfolio_project_id = ? ORDER BY display_order',
      )
      .all(portfolioProjectId) as Array<{
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
    const portfolioProjectId = makeProject(db);
    const linkId = insert(db, 'portfolio_project_images', {
      portfolio_project_id: portfolioProjectId,
      image_id: makeImage(db),
    });

    const row = db
      .query('SELECT display_order FROM portfolio_project_images WHERE id = ?')
      .get(linkId) as { display_order: number };
    db.close();

    expect(row.display_order).toBe(0);
  });

  test('reordering persists', () => {
    const db = open();
    const portfolioProjectId = makeProject(db);
    const linkId = insert(db, 'portfolio_project_images', {
      portfolio_project_id: portfolioProjectId,
      image_id: makeImage(db),
      display_order: 5,
    });

    // Scoped to the row this test created — never a bulk update.
    db.prepare(
      'UPDATE portfolio_project_images SET display_order = ? WHERE id = ?',
    ).run(...([9, linkId] as never[]));

    const row = db
      .query('SELECT display_order FROM portfolio_project_images WHERE id = ?')
      .get(linkId) as { display_order: number };
    db.close();

    expect(row.display_order).toBe(9);
  });
});
