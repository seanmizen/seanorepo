import { describe, expect, test } from 'bun:test';
import type {
  DesignerListItem,
  DesignerListResponse,
  DesignerPortfolioResponse,
  DesignerProfile,
  PortfolioProject,
} from '@shared/types';
import { getApp, uniqueEmail } from './setup';

/**
 * Discovery: GET /api/designers and GET /api/designers/:slug/portfolio.
 *
 * Suites share one process, one server and one database, so nothing here
 * assumes an empty table. Every fixture carries a token unique to this run —
 * a nonsense location for the filter and pagination tests, a nonsense word in
 * the searchable text for the search tests — and every assertion is made
 * against a list scoped by one of those tokens, or by checking membership
 * rather than length. Every write is scoped to a row this file created.
 */

const app = await getApp();
const { openDbConnection } = await import('../services/db');
const { listApprovedDesignersSql } = await import('../services/discovery');

let counter = 0;
/** Unique per call — slugs and studio names are shared across the database. */
const unique = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${counter++}`;

/**
 * A token unique to this process, used to carve private slices out of shared
 * tables. Letters only, so FTS5's tokenizer keeps it as one term.
 */
const SUITE = `zq${Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x')}`;

async function login(role: 'buyer' | 'designer' = 'designer') {
  const email = uniqueEmail(role);
  const link = await app.inject({
    method: 'POST',
    url: '/api/auth/magic-link',
    payload: { email, role },
  });
  const token = new URL(
    link.json<{ devLink: string }>().devLink,
  ).searchParams.get('token') as string;
  const verified = await app.inject({
    method: 'GET',
    url: `/api/auth/verify?token=${token}`,
  });
  return verified.cookies.find((c) => c.name === 'token')?.value as string;
}

interface Fixture {
  studioName?: string;
  headline?: string;
  bio?: string;
  location?: string;
  budgetBand?: string;
  availability?: string;
  status?: DesignerProfile['status'];
  portfolio_projects?: Array<{
    title: string;
    workType?: string;
    status?: 'draft' | 'published';
  }>;
}

/**
 * Build a designer through the public write API, then set the review status
 * directly.
 *
 * Going through the API matters: the FTS document is maintained by the write
 * paths in `services/designers.ts`, so a fixture inserted straight into SQL
 * would be invisible to search and would quietly make the search tests test
 * nothing. The status UPDATE is scoped to the one row just created — the admin
 * approval API is a separate ticket.
 */
async function makeDesigner(fixture: Fixture = {}) {
  const cookie = await login('designer');
  const studioName = fixture.studioName ?? unique('Studio');

  const created = await app.inject({
    method: 'POST',
    url: '/api/me/profile',
    cookies: { token: cookie },
    payload: {
      studioName,
      headline: fixture.headline,
      bio: fixture.bio,
      location: fixture.location,
      budgetBand: fixture.budgetBand,
      availability: fixture.availability,
    },
  });
  expect(created.statusCode).toBe(201);
  const profile = created.json<{ profile: DesignerProfile }>().profile;

  for (const project of fixture.portfolio_projects ?? []) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
      payload: {
        title: project.title,
        workType: project.workType,
        status: project.status ?? 'published',
      },
    });
    expect(res.statusCode).toBe(201);
  }

  if (fixture.status && fixture.status !== 'draft') {
    await setStatus(profile.id, fixture.status);
  }
  return { cookie, profile };
}

/** Scoped to one row — never a bulk UPDATE on a table other suites share. */
async function setStatus(
  profileId: number,
  status: DesignerProfile['status'],
): Promise<void> {
  const db = await openDbConnection();
  db.run('UPDATE designer_profiles SET status = ? WHERE id = ?', [
    status,
    profileId,
  ]);
  db.close();
}

const approved = (fixture: Fixture = {}) =>
  makeDesigner({ ...fixture, status: 'approved' });

async function list(query: string): Promise<DesignerListResponse> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/designers${query}`,
  });
  expect(res.statusCode).toBe(200);
  return res.json<DesignerListResponse>();
}

const slugsOf = (designers: DesignerListItem[]) => designers.map((d) => d.slug);

const expectStatus = async (url: string, code: number) => {
  const res = await app.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(code);
  return res;
};

describe('listing', () => {
  test('is open to anonymous callers and returns a page envelope', async () => {
    const body = await list('');
    expect(Array.isArray(body.designers)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(24);
    expect(typeof body.total).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
  });

  test('lists an approved designer and omits an unapproved one', async () => {
    const location = `${SUITE}-basics`;
    const shown = await approved({ location });
    const hidden = await makeDesigner({ location });

    const body = await list(`?location=${location}`);
    expect(slugsOf(body.designers)).toEqual([shown.profile.slug]);
    expect(slugsOf(body.designers)).not.toContain(hidden.profile.slug);
    expect(body.total).toBe(1);
  });

  test('a filter that matches nothing is an empty page, not a 404', async () => {
    const body = await list(`?location=${SUITE}-nowhere-at-all`);
    expect(body.designers).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
  });

  test('a page past the end is an empty page, not a 404', async () => {
    const location = `${SUITE}-shortlist`;
    await approved({ location });

    const body = await list(`?location=${location}&limit=10&page=9`);
    expect(body.designers).toEqual([]);
    // The total still describes the whole result set, not the empty page.
    expect(body.total).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  test('the list carries srcset-ready image variants', async () => {
    const location = `${SUITE}-imagery`;
    const { cookie, profile } = await makeDesigner({
      location,
      portfolio_projects: [{ title: unique('Shot PortfolioProject') }],
    });
    await setStatus(profile.id, 'approved');

    // A real images row with its variants. The payload shape is what is under
    // test, so the rows are made directly rather than by re-uploading a file.
    const db = await openDbConnection();
    const path = `images/${crypto.randomUUID()}.webp`;
    db.run(
      "INSERT INTO images (storage_path, mime_type, byte_size, alt) VALUES (?, 'image/webp', 1, 'A room')",
      [path],
    );
    const imageId = (
      db.query('SELECT last_insert_rowid() AS id').get() as { id: number }
    ).id;
    for (const [variant, width] of [
      ['thumb', 400],
      ['grid', 800],
      ['full', 1600],
    ] as const) {
      db.run(
        `INSERT INTO image_variants (image_id, variant, storage_path, width, height, byte_size)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [imageId, variant, `${path}.${variant}`, width, width],
      );
    }
    db.close();

    const portfolio_projects = await app.inject({
      method: 'GET',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
    });
    const portfolioProjectId = portfolio_projects.json<{
      portfolio_projects: PortfolioProject[];
    }>().portfolio_projects[0].id;
    await app.inject({
      method: 'PUT',
      url: `/api/me/portfolio/${portfolioProjectId}/images`,
      cookies: { token: cookie },
      payload: { images: [{ imageId }] },
    });

    const body = await list(`?location=${location}`);
    const cover = body.designers[0].coverImage;
    expect(cover).not.toBeNull();
    expect(Object.keys(cover?.variants ?? {}).sort()).toEqual([
      'full',
      'grid',
      'thumb',
    ]);
    expect(cover?.variants.grid.width).toBe(800);
    expect(cover?.variants.grid.url).toContain('.grid');
    expect(cover?.alt).toBe('A room');
    expect(body.designers[0].projectCount).toBe(1);
  });
});

describe('filters', () => {
  const location = `${SUITE}-filters`;

  test('each filter works on its own, and they combine', async () => {
    const target = await approved({
      location,
      budgetBand: '50k_100k',
      availability: 'asap',
      portfolio_projects: [
        { title: unique('Filter Kitchen'), workType: 'kitchen' },
      ],
    });
    const otherBand = await approved({
      location,
      budgetBand: 'under_10k',
      availability: 'asap',
      portfolio_projects: [
        { title: unique('Filter Kitchen'), workType: 'kitchen' },
      ],
    });
    const otherAvailability = await approved({
      location,
      budgetBand: '50k_100k',
      availability: 'within_12_months',
      portfolio_projects: [
        { title: unique('Filter Bath'), workType: 'bathroom' },
      ],
    });

    const band = await list(`?location=${location}&budgetBands=50k_100k`);
    expect(slugsOf(band.designers).sort()).toEqual(
      [target.profile.slug, otherAvailability.profile.slug].sort(),
    );

    const avail = await list(`?location=${location}&availability=asap`);
    expect(slugsOf(avail.designers).sort()).toEqual(
      [target.profile.slug, otherBand.profile.slug].sort(),
    );

    const type = await list(`?location=${location}&workTypes=kitchen`);
    expect(slugsOf(type.designers).sort()).toEqual(
      [target.profile.slug, otherBand.profile.slug].sort(),
    );

    // All four together narrow to exactly one.
    const combined = await list(
      `?location=${location}&budgetBands=50k_100k&availability=asap&workTypes=kitchen`,
    );
    expect(slugsOf(combined.designers)).toEqual([target.profile.slug]);
    expect(combined.total).toBe(1);
  });

  test('location matching ignores case', async () => {
    const mixed = `${SUITE}-CamelTown`;
    const made = await approved({ location: mixed });
    const body = await list(`?location=${mixed.toLowerCase()}`);
    expect(slugsOf(body.designers)).toContain(made.profile.slug);
  });

  test('project type only counts published work', async () => {
    const where = `${SUITE}-drafts`;
    const drafted = await approved({
      location: where,
      portfolio_projects: [
        {
          title: unique('Unpublished Loft'),
          workType: 'extension',
          status: 'draft',
        },
      ],
    });
    const body = await list(`?location=${where}&workTypes=extension`);
    expect(slugsOf(body.designers)).not.toContain(drafted.profile.slug);
    expect(body.total).toBe(0);
  });

  test('several values in one facet are ORed together', async () => {
    // The point of the shared csv param: "kitchens or bathrooms", not a
    // second request per value.
    const where = unique('Multi');
    await approved({
      location: where,
      portfolio_projects: [
        { title: unique('Multi Kitchen'), workType: 'kitchen' },
      ],
    });
    await approved({
      location: where,
      portfolio_projects: [
        { title: unique('Multi Bath'), workType: 'bathroom' },
      ],
    });
    await approved({
      location: where,
      portfolio_projects: [
        { title: unique('Multi Loft'), workType: 'extension' },
      ],
    });

    const both = await list(`?location=${where}&workTypes=kitchen,bathroom`);
    expect(both.total).toBe(2);

    // Repeated keys must give the identical answer to the comma list.
    const repeated = await list(
      `?location=${where}&workTypes=kitchen&workTypes=bathroom`,
    );
    expect(repeated.total).toBe(both.total);
  });

  test('an unknown campaign parameter does not break the page', async () => {
    // ?utm_source must never 400 a marketed link.
    const res = await list('?utm_source=instagram&fbclid=abc123');
    expect(res.total).toBeGreaterThanOrEqual(0);
  });

  test('malformed filter values are rejected, never ignored', async () => {
    for (const query of [
      '?budgetBands=infinite',
      '?availability=whenever',
      '?workTypes=spaceship',
      '?sort=cheapest',
      '?limit=abc',
      '?limit=0',
      '?limit=500',
      '?limit=-1',
      '?page=0',
      '?page=two',
      // Relevance has nothing to rank without a query.
      '?sort=relevance',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/designers${query}`,
      });
      expect({ query, code: res.statusCode }).toEqual({ query, code: 400 });
      expect(res.json<{ error: string }>().error).toBeTruthy();
    }
  });
});

describe('sorting', () => {
  const location = `${SUITE}-sorting`;

  test('newest, oldest and name each order the same set differently', async () => {
    const a = await approved({
      location,
      studioName: `Aardvark ${unique('A')}`,
    });
    const b = await approved({ location, studioName: `Mallow ${unique('M')}` });
    const c = await approved({ location, studioName: `Zephyr ${unique('Z')}` });

    // Distinct timestamps, so newest/oldest have something to order by that is
    // not the tie-breaker. Scoped to these three rows.
    const db = await openDbConnection();
    for (const [i, made] of [a, b, c].entries()) {
      db.run('UPDATE designer_profiles SET created_at = ? WHERE id = ?', [
        `2024-01-0${i + 1} 00:00:00`,
        made.profile.id,
      ]);
    }
    db.close();

    const newest = await list(`?location=${location}&sort=newest`);
    const oldest = await list(`?location=${location}&sort=oldest`);
    const byName = await list(`?location=${location}&sort=name`);

    expect(slugsOf(newest.designers)).toEqual([
      c.profile.slug,
      b.profile.slug,
      a.profile.slug,
    ]);
    expect(slugsOf(oldest.designers)).toEqual(
      [...slugsOf(newest.designers)].reverse(),
    );
    expect(byName.designers.map((d) => d.studioName[0])).toEqual([
      'A',
      'M',
      'Z',
    ]);
  });

  test('newest is the default when nothing is being searched', async () => {
    const where = `${SUITE}-default-sort`;
    const first = await approved({ location: where });
    const second = await approved({ location: where });

    const db = await openDbConnection();
    db.run(
      "UPDATE designer_profiles SET created_at = '2020-01-01 00:00:00' WHERE id = ?",
      [first.profile.id],
    );
    db.run(
      "UPDATE designer_profiles SET created_at = '2030-01-01 00:00:00' WHERE id = ?",
      [second.profile.id],
    );
    db.close();

    const body = await list(`?location=${where}`);
    expect(slugsOf(body.designers)).toEqual([
      second.profile.slug,
      first.profile.slug,
    ]);
  });
});

describe('search', () => {
  test('matches on studio name, headline, bio and project titles', async () => {
    const token = `${SUITE}fields`;
    const byName = await approved({ studioName: `${token} Atelier` });
    const byHeadline = await approved({
      headline: `Quietly ${token} interiors`,
    });
    const byBio = await approved({
      bio: `We have practised ${token} work for years.`,
    });
    const byProject = await approved({
      portfolio_projects: [{ title: `${token} Townhouse` }],
    });

    const body = await list(`?q=${token}`);
    const found = slugsOf(body.designers);
    for (const made of [byName, byHeadline, byBio, byProject]) {
      expect(found).toContain(made.profile.slug);
    }
    expect(body.total).toBe(4);
  });

  test('ranks by relevance — a name hit beats a buried bio hit', async () => {
    const token = `${SUITE}rank`;
    const weak = await approved({
      bio: `A long description that happens to mention ${token} once, among much else.`,
    });
    const strong = await approved({ studioName: `${token} Studio` });

    const body = await list(`?q=${token}`);
    expect(slugsOf(body.designers)).toEqual([
      strong.profile.slug,
      weak.profile.slug,
    ]);
    // Relevance is the default when a query is present.
    const explicit = await list(`?q=${token}&sort=relevance`);
    expect(slugsOf(explicit.designers)).toEqual(slugsOf(body.designers));
  });

  test('multi-word queries mean AND, not OR', async () => {
    const token = `${SUITE}multi`;
    const both = await approved({
      studioName: `Kestrel ${token}`,
      location: `Harborough ${token}`,
    });
    const onlyOne = await approved({ studioName: `Kestrel ${unique('K')}` });

    const together = await list(`?q=kestrel%20harborough%20${token}`);
    expect(slugsOf(together.designers)).toEqual([both.profile.slug]);
    expect(slugsOf(together.designers)).not.toContain(onlyOne.profile.slug);

    // One term present, one absent — AND means no result at all.
    const missing = await list(`?q=kestrel%20${token}%20aeronautics`);
    expect(missing.designers).toEqual([]);
  });

  test('matches partial words', async () => {
    const token = `${SUITE}partial`;
    const made = await approved({ studioName: `Kitchenworks ${token}` });

    for (const partial of ['kit', 'kitch', 'kitchenwo']) {
      const body = await list(`?q=${partial}%20${token}`);
      expect(slugsOf(body.designers)).toContain(made.profile.slug);
    }
  });

  test('handles apostrophes rather than choking on them', async () => {
    const token = `${SUITE}apos`;
    const made = await approved({
      studioName: `O'Mahony & Daughters ${token}`,
    });

    for (const query of ["O'Mahony", "o'mahony", 'mahony', "O'Mah"]) {
      const body = await list(`?q=${encodeURIComponent(query)}%20${token}`);
      expect(slugsOf(body.designers)).toContain(made.profile.slug);
    }
  });

  test('FTS operators in the query are content, not syntax', async () => {
    const token = `${SUITE}ops`;
    const made = await approved({
      studioName: `Northlight ${token}`,
      bio: 'Rooms and light, not gloom.',
    });

    // Every one of these is either a syntax error or a set operation in raw
    // FTS5 — passing user input to MATCH unescaped turns a search box into a
    // 500 and a way to subtract results. They must all answer 200.
    for (const query of [
      `${token} AND northlight`,
      `${token} NOT northlight`,
      `${token} OR "unterminated`,
      `${token} NEAR(northlight)`,
      `${token} northlight*`,
      `${token} col:umn ^caret`,
      '"',
      '*',
      '(((',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/designers?q=${encodeURIComponent(query)}`,
      });
      expect({ query, code: res.statusCode }).toEqual({ query, code: 200 });
    }

    // And they are matched as ordinary words. `${token} not` would be set
    // subtraction in raw FTS5 and return nothing; here 'not' is just a word in
    // the bio, so the designer is still found.
    for (const query of [`${token} and`, `${token} not`]) {
      const body = await list(`?q=${encodeURIComponent(query)}`);
      expect(slugsOf(body.designers)).toContain(made.profile.slug);
    }
  });

  test('a query with nothing searchable in it is an empty page', async () => {
    const body = await list(`?q=${encodeURIComponent('??? --- !!!')}`);
    expect(body.designers).toEqual([]);
    expect(body.total).toBe(0);
  });

  test('an over-long query is rejected', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/designers?q=${'a'.repeat(201)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  test('the index follows edits — renaming makes the old name unfindable', async () => {
    const oldToken = `${SUITE}before`;
    const newToken = `${SUITE}after`;
    const { cookie, profile } = await approved({
      studioName: `${oldToken} Studio`,
    });

    expect(slugsOf((await list(`?q=${oldToken}`)).designers)).toContain(
      profile.slug,
    );

    await app.inject({
      method: 'PUT',
      url: '/api/me/profile',
      cookies: { token: cookie },
      payload: { studioName: `${newToken} Studio` },
    });

    expect((await list(`?q=${oldToken}`)).designers).toEqual([]);
    expect(slugsOf((await list(`?q=${newToken}`)).designers)).toContain(
      profile.slug,
    );
  });

  test('the index follows project writes', async () => {
    const token = `${SUITE}portfolio`;
    const { cookie, profile } = await approved({});

    const created = await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
      payload: { title: `${token} Mews`, status: 'published' },
    });
    const portfolioProjectId = created.json<{ project: PortfolioProject }>()
      .project.id;
    expect(slugsOf((await list(`?q=${token}`)).designers)).toContain(
      profile.slug,
    );

    // Unpublishing takes the title back out of the designer's document.
    await app.inject({
      method: 'PUT',
      url: `/api/me/portfolio/${portfolioProjectId}`,
      cookies: { token: cookie },
      payload: { title: `${token} Mews`, status: 'draft' },
    });
    expect((await list(`?q=${token}`)).designers).toEqual([]);

    // Republishing brings it back, and deleting removes it for good.
    await app.inject({
      method: 'PUT',
      url: `/api/me/portfolio/${portfolioProjectId}`,
      cookies: { token: cookie },
      payload: { title: `${token} Mews`, status: 'published' },
    });
    expect(slugsOf((await list(`?q=${token}`)).designers)).toContain(
      profile.slug,
    );

    await app.inject({
      method: 'DELETE',
      url: `/api/me/portfolio/${portfolioProjectId}`,
      cookies: { token: cookie },
    });
    expect((await list(`?q=${token}`)).designers).toEqual([]);
  });
});

/**
 * The approval gate is the product's entire curation promise, so this is
 * deliberately exhaustive: an unapproved designer is built with every
 * distinguishing attribute the API can filter, sort or search on, and an
 * identical approved twin is built beside it. Every parameter combination is
 * then asserted twice — the twin must be found, proving the query really does
 * match this shape, and the unapproved one must not.
 *
 * Without the twin, a leak test passes just as happily when the query is
 * broken and returns nothing at all.
 */
describe('the approval gate', () => {
  const location = `${SUITE}-gate`;
  const token = `${SUITE}gate`;

  const fixture = (studioName: string): Fixture => ({
    studioName,
    headline: `${token} headline`,
    bio: `A bio that mentions ${token} for the search to find.`,
    location,
    budgetBand: '100k_250k',
    availability: 'within_3_months',
    portfolio_projects: [
      { title: `${token} Kitchen PortfolioProject`, workType: 'kitchen' },
    ],
  });

  /** Every way a caller can ask for a designer of exactly this shape. */
  const probes = [
    '',
    `?location=${location}`,
    '?budgetBands=100k_250k',
    '?availability=within_3_months',
    '?workTypes=kitchen',
    `?location=${location}&budgetBands=100k_250k&availability=within_3_months&workTypes=kitchen`,
    `?q=${token}`,
    `?q=${token}%20kitchen`,
    `?q=${token.slice(0, 6)}`,
    `?q=${token}&sort=relevance`,
    `?q=${token}&location=${location}`,
    `?q=${token}&workTypes=kitchen&budgetBands=100k_250k`,
    `?location=${location}&sort=newest`,
    `?location=${location}&sort=oldest`,
    `?location=${location}&sort=name`,
    `?location=${location}&limit=60&page=1`,
    `?q=${token}&limit=1&page=1`,
    `?q=${token}&limit=1&page=2`,
  ];

  test('an unapproved profile is unreachable through every parameter combination', async () => {
    const twin = await approved(fixture(`Twin ${token}`));
    const hidden = await makeDesigner(fixture(`Hidden ${token}`));

    for (const status of ['draft', 'pending', 'rejected'] as const) {
      await setStatus(hidden.profile.id, status);

      for (const probe of probes) {
        const found = slugsOf((await list(probe)).designers);
        expect({
          status,
          probe,
          leaked: found.includes(hidden.profile.slug),
        }).toEqual({ status, probe, leaked: false });
      }

      // The twin proves the probes are live: at least the scoped ones must
      // find a designer of exactly this shape.
      const scoped = slugsOf((await list(`?location=${location}`)).designers);
      expect(scoped).toEqual([twin.profile.slug]);
      const searched = slugsOf((await list(`?q=${token}`)).designers);
      expect(searched).toContain(twin.profile.slug);
    }

    // And approving it makes it appear — so the assertions above were not
    // passing because the fixtures never matched in the first place.
    await setStatus(hidden.profile.id, 'approved');
    const after = slugsOf((await list(`?location=${location}`)).designers);
    expect(after.sort()).toEqual(
      [hidden.profile.slug, twin.profile.slug].sort(),
    );
  });

  test('paging every page of a filtered set never surfaces an unapproved one', async () => {
    const where = `${SUITE}-gate-paging`;
    const shown = await Promise.all([
      approved({ location: where }),
      approved({ location: where }),
      approved({ location: where }),
    ]);
    const hidden = await makeDesigner({ location: where, status: 'pending' });

    const seen: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const body = await list(`?location=${where}&limit=1&page=${page}`);
      seen.push(...slugsOf(body.designers));
    }
    expect(seen.sort()).toEqual(shown.map((s) => s.profile.slug).sort());
    expect(seen).not.toContain(hidden.profile.slug);
  });

  test('an unapproved portfolio 404s at every status, and 200s once approved', async () => {
    const made = await makeDesigner({
      portfolio_projects: [{ title: unique('Gated Piece') }],
    });

    for (const status of ['draft', 'pending', 'rejected'] as const) {
      await setStatus(made.profile.id, status);
      // 404 rather than 403 — a 403 would confirm the profile exists.
      await expectStatus(`/api/designers/${made.profile.slug}/portfolio`, 404);
    }

    await setStatus(made.profile.id, 'approved');
    await expectStatus(`/api/designers/${made.profile.slug}/portfolio`, 200);
  });

  test('a slug that was never taken 404s the same way', async () => {
    await expectStatus(`/api/designers/${SUITE}-no-such-studio/portfolio`, 404);
  });
});

/**
 * Designers that tie on the sort column, forced to one shared `created_at` and
 * one shared studio name.
 *
 * That is the case the tie-breaker exists for: SQLite's CURRENT_TIMESTAMP has
 * second resolution, so designers signing up in the same second collide
 * routinely, and studios do share names. Without `p.id` closing the ORDER BY
 * the order within a tied group is undefined, and paging can show one row
 * twice while skipping another. Every UPDATE below is scoped to the rows this
 * helper just created.
 */
async function tiedSet(where: string, size: number, studioName: string) {
  const made = [];
  for (let i = 0; i < size; i++) {
    made.push(await approved({ location: where, studioName }));
  }
  const db = await openDbConnection();
  for (const one of made) {
    db.run(
      "UPDATE designer_profiles SET created_at = '2025-06-01 12:00:00' WHERE id = ?",
      [one.profile.id],
    );
  }
  db.close();
  return made.map((m) => m.profile.slug);
}

describe('pagination stability', () => {
  test('tied rows page without duplicating or skipping, on every sort', async () => {
    const where = `${SUITE}-paging`;
    const all = await tiedSet(where, 5, `Tied ${SUITE}`);

    for (const sort of ['newest', 'oldest', 'name'] as const) {
      for (const limit of [1, 2, 3, 5]) {
        const seen: string[] = [];
        for (let page = 1; page <= Math.ceil(all.length / limit); page++) {
          const body = await list(
            `?location=${where}&sort=${sort}&limit=${limit}&page=${page}`,
          );
          seen.push(...slugsOf(body.designers));
        }
        // Every row exactly once: none duplicated across pages, none skipped.
        expect({ sort, limit, count: seen.length }).toEqual({
          sort,
          limit,
          count: all.length,
        });
        expect(new Set(seen).size).toBe(all.length);
        expect([...seen].sort()).toEqual([...all].sort());
      }
    }
  });

  test('the order of tied rows is the same on every request', async () => {
    const where = `${SUITE}-paging-stable`;
    await tiedSet(where, 5, `Stable ${SUITE}`);

    const first = await list(`?location=${where}&sort=newest&limit=60`);
    expect(first.designers).toHaveLength(5);
    for (let i = 0; i < 4; i++) {
      const again = await list(`?location=${where}&sort=newest&limit=60`);
      expect(slugsOf(again.designers)).toEqual(slugsOf(first.designers));
    }
  });

  test('a row added mid-page does not duplicate or skip the rows behind it', async () => {
    const where = `${SUITE}-paging-live`;
    const original = await tiedSet(where, 4, `Live ${SUITE}`);

    const pageOne = await list(`?location=${where}&sort=oldest&limit=2&page=1`);

    // Someone signs up between the two requests, behind everything already
    // paged past. Oldest-first plus a unique tie-breaker means the new row
    // lands at the end and cannot shuffle the rows ahead of the cursor.
    const added = await approved({ location: where });
    const db = await openDbConnection();
    db.run(
      "UPDATE designer_profiles SET created_at = '2030-01-01 00:00:00' WHERE id = ?",
      [added.profile.id],
    );
    db.close();

    const pageTwo = await list(`?location=${where}&sort=oldest&limit=2&page=2`);

    const seen = [...slugsOf(pageOne.designers), ...slugsOf(pageTwo.designers)];
    expect(new Set(seen).size).toBe(4);
    expect([...seen].sort()).toEqual([...original].sort());
    expect(seen).not.toContain(added.profile.slug);
  });
});

describe('public portfolio', () => {
  test('returns published work only, with image variants', async () => {
    const { cookie, profile } = await approved({
      portfolio_projects: [
        { title: unique('Published Piece') },
        { title: unique('Hidden Piece'), status: 'draft' },
      ],
    });

    const db = await openDbConnection();
    const path = `images/${crypto.randomUUID()}.webp`;
    db.run(
      "INSERT INTO images (storage_path, mime_type, byte_size, alt) VALUES (?, 'image/webp', 1, 'Hallway')",
      [path],
    );
    const imageId = (
      db.query('SELECT last_insert_rowid() AS id').get() as { id: number }
    ).id;
    db.run(
      `INSERT INTO image_variants (image_id, variant, storage_path, width, height, byte_size)
       VALUES (?, 'grid', ?, 800, 600, 1)`,
      [imageId, `${path}.grid`],
    );
    db.close();

    const mine = await app.inject({
      method: 'GET',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
    });
    const published = mine
      .json<{ portfolio_projects: PortfolioProject[] }>()
      .portfolio_projects.find(
        (p) => p.status === 'published',
      ) as PortfolioProject;
    await app.inject({
      method: 'PUT',
      url: `/api/me/portfolio/${published.id}/images`,
      cookies: { token: cookie },
      payload: { images: [{ imageId, caption: 'The hallway' }] },
    });

    const res = await expectStatus(
      `/api/designers/${profile.slug}/portfolio`,
      200,
    );
    const body = res.json<DesignerPortfolioResponse>();

    expect(body.designer.slug).toBe(profile.slug);
    expect(body.portfolio_projects.map((p) => p.title)).toEqual([
      published.title,
    ]);
    expect(body.total).toBe(1);
    expect(body.portfolio_projects[0].images[0].caption).toBe('The hallway');
    expect(body.portfolio_projects[0].images[0].image.variants.grid.width).toBe(
      800,
    );
    // No explicit cover was chosen, so the first curated image stands in.
    expect(body.portfolio_projects[0].coverImage?.id).toBe(imageId);
  });

  test('a designer with no published work is an empty page, not a 404', async () => {
    const { profile } = await approved({
      portfolio_projects: [{ title: unique('Only Draft'), status: 'draft' }],
    });
    const res = await expectStatus(
      `/api/designers/${profile.slug}/portfolio`,
      200,
    );
    const body = res.json<DesignerPortfolioResponse>();
    expect(body.portfolio_projects).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
  });

  test('pages in curated order without duplicating or skipping', async () => {
    const titles = [1, 2, 3, 4, 5].map((n) => `${unique('Piece')} ${n}`);
    const { profile } = await approved({
      portfolio_projects: titles.map((title) => ({ title })),
    });

    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await expectStatus(
        `/api/designers/${profile.slug}/portfolio?limit=2&page=${page}`,
        200,
      );
      seen.push(
        ...res
          .json<DesignerPortfolioResponse>()
          .portfolio_projects.map((p) => p.title),
      );
    }
    // Curatorial order is display_order ASC, id ASC — creation order here.
    expect(seen).toEqual(titles);
  });

  test('malformed pagination is rejected', async () => {
    const { profile } = await approved({});
    for (const query of ['?limit=abc', '?limit=0', '?limit=999', '?page=0']) {
      await expectStatus(
        `/api/designers/${profile.slug}/portfolio${query}`,
        400,
      );
    }
  });
});

describe('query plans', () => {
  /**
   * The list endpoint is the busiest read on the site and the one search
   * engines crawl, so a full table scan here is a regression worth failing a
   * build over. This asserts the plan itself rather than a timing, which would
   * be flaky and would only notice once the table was already large.
   */
  const planFor = async (
    overrides: Partial<Parameters<typeof listApprovedDesignersSql>[0]>,
  ) => {
    const { sql, params } = listApprovedDesignersSql({
      q: null,
      workTypes: null,
      location: null,
      budgetBands: null,
      availability: null,
      sort: 'newest',
      limit: 24,
      offset: 0,
      ...overrides,
    });
    const db = await openDbConnection();
    try {
      return (
        db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{
          detail: string;
        }>
      )
        .map((row) => row.detail)
        .join('\n');
    } finally {
      db.close();
    }
  };

  test('the default list path is served from an index', async () => {
    const plan = await planFor({});
    expect(plan).toContain('idx_designer_profiles_status_created_at');
    expect(plan).not.toContain('SCAN designer_profiles');
    // A temp b-tree would mean the tie-breaker is being sorted in memory
    // rather than read off the index in order.
    expect(plan).not.toContain('USE TEMP B-TREE');
  });

  test('every sort and filter has an index behind it', async () => {
    for (const sort of ['newest', 'oldest', 'name'] as const) {
      expect(await planFor({ sort })).not.toContain('SCAN designer_profiles');
    }
    for (const overrides of [
      { location: 'London' },
      { budgetBands: ['50k_100k'] as const },
      { availability: ['asap'] as const },
      { workTypes: ['kitchen'] as const },
      // Several values in one facet must still use the index, not fall back
      // to a scan — an IN list is where that most easily goes wrong.
      { workTypes: ['kitchen', 'bathroom'] as const },
      { budgetBands: ['25k_50k', '50k_100k'] as const },
    ]) {
      const plan = await planFor(overrides);
      expect(plan).not.toContain('SCAN designer_profiles');
      expect(plan).not.toContain('SCAN portfolio_projects');
    }
  });

  test('search goes through the FTS index, not a scan', async () => {
    const plan = await planFor({ q: 'kitchen london', sort: 'relevance' });
    expect(plan).toContain('designer_search');
    expect(plan).toContain('VIRTUAL TABLE INDEX');
    expect(plan).not.toContain('SCAN designer_profiles');
  });
});

/**
 * Schema cover for 002_designer_discovery.sql.
 *
 * Fresh apply and idempotency are covered generically in `migrations.test.ts`
 * — the runner tracks by presence, so a second boot must not try to recreate
 * the virtual table. What is specific to this migration is the new CHECK and
 * the delete trigger, and both are asserted to actually bite rather than
 * merely to exist.
 */
describe('migration 002', () => {
  test('the search index and its columns exist', async () => {
    const db = await openDbConnection();
    try {
      const tables = (
        db
          .query(
            "SELECT name FROM sqlite_master WHERE name IN ('designer_search', 'designer_search_after_delete')",
          )
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(tables).toContain('designer_search');
      expect(tables).toContain('designer_search_after_delete');
    } finally {
      db.close();
    }
  });

  test('the availability CHECK constraint rejects a value outside the list', async () => {
    const db = await openDbConnection();
    try {
      db.run('INSERT INTO users (email, role) VALUES (?, ?)', [
        uniqueEmail('avail'),
        'designer',
      ]);
      const userId = (
        db.query('SELECT last_insert_rowid() AS id').get() as { id: number }
      ).id;

      expect(() =>
        db.run(
          'INSERT INTO designer_profiles (user_id, slug, studio_name, availability) VALUES (?, ?, ?, ?)',
          [userId, unique('bad-avail'), 'Bad Availability', 'whenever'],
        ),
      ).toThrow();

      // 'exploring' is a buyer's timeline, not a designer's availability, and
      // the narrower CHECK is what keeps the two vocabularies apart.
      expect(() =>
        db.run(
          'INSERT INTO designer_profiles (user_id, slug, studio_name, availability) VALUES (?, ?, ?, ?)',
          [userId, unique('exploring'), 'Exploring', 'exploring'],
        ),
      ).toThrow();

      expect(() =>
        db.run(
          'INSERT INTO designer_profiles (user_id, slug, studio_name, availability) VALUES (?, ?, ?, ?)',
          [
            userId,
            unique('good-avail'),
            'Good Availability',
            'within_6_months',
          ],
        ),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  test('deleting a profile takes its search document with it', async () => {
    const token = `${SUITE}deleted`;
    const { profile } = await approved({ studioName: `${token} Studio` });
    expect(slugsOf((await list(`?q=${token}`)).designers)).toContain(
      profile.slug,
    );

    const db = await openDbConnection();
    const indexed = () =>
      (
        db
          .query('SELECT COUNT(*) AS c FROM designer_search WHERE rowid = ?')
          .get(profile.id) as { c: number }
      ).c;
    try {
      expect(indexed()).toBe(1);
      // Straight SQL, bypassing the service layer entirely — this is exactly
      // the case the trigger exists for.
      db.run('DELETE FROM designer_profiles WHERE id = ?', [profile.id]);
      expect(indexed()).toBe(0);
    } finally {
      db.close();
    }

    expect((await list(`?q=${token}`)).designers).toEqual([]);
  });
});
