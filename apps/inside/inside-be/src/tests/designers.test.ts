import { describe, expect, test } from 'bun:test';
import type {
  DesignerProfile,
  PortfolioProject,
  PortfolioProjectImage,
} from '@shared/types';
import { getApp, uniqueEmail } from './setup';

const app = await getApp();
const { openDbConnection } = await import('../services/db');

/** Signs in via the dev bypass and returns the session cookie. */
async function login(role: 'buyer' | 'designer', email = uniqueEmail(role)) {
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
  return {
    email,
    cookie: verified.cookies.find((c) => c.name === 'token')?.value as string,
  };
}

const asDesigner = async (studioName: string) => {
  const { cookie } = await login('designer');
  const res = await app.inject({
    method: 'POST',
    url: '/api/me/profile',
    cookies: { token: cookie },
    payload: { studioName },
  });
  return { cookie, profile: res.json<{ profile: DesignerProfile }>().profile };
};

/** Approves directly in the database — the admin API is a separate ticket. */
async function approve(profileId: number) {
  const db = await openDbConnection();
  db.run("UPDATE designer_profiles SET status = 'approved' WHERE id = ?", [
    profileId,
  ]);
  db.close();
}

describe('profile creation', () => {
  test('a designer can create a profile, and it starts unlisted', async () => {
    const { profile } = await asDesigner('Atelier Bloom');
    expect(profile.studioName).toBe('Atelier Bloom');
    // The approval gate: never publicly visible until an admin says so.
    expect(profile.status).toBe('draft');
    expect(profile.slug).toBe('atelier-bloom');
  });

  test('slugs are unique across studios sharing a name', async () => {
    const a = await asDesigner('Same Name Studio');
    const b = await asDesigner('Same Name Studio');
    expect(a.profile.slug).not.toBe(b.profile.slug);
    expect(b.profile.slug).toMatch(/^same-name-studio-\d+$/);
  });

  test('a second profile for the same designer is refused', async () => {
    const { cookie } = await asDesigner('Only One');
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/profile',
      cookies: { token: cookie },
      payload: { studioName: 'Another' },
    });
    expect(res.statusCode).toBe(409);
  });

  test('a buyer cannot create a designer profile', async () => {
    const { cookie } = await login('buyer');
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/profile',
      cookies: { token: cookie },
      payload: { studioName: 'Not Allowed' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('an anonymous caller is rejected', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/me/profile' });
    expect(res.statusCode).toBe(401);
  });
});

describe('profile validation', () => {
  test('studio name is required', async () => {
    const { cookie } = await login('designer');
    for (const payload of [{}, { studioName: '' }, { studioName: '   ' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/profile',
        cookies: { token: cookie },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  test('a javascript: url is rejected', async () => {
    const { cookie } = await login('designer');
    // Stored unchecked, this becomes live XSS the moment it is an href.
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/profile',
      cookies: { token: cookie },
      payload: {
        studioName: 'Bad Link',
        websiteUrl: 'javascript:alert(1)',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test('an unknown budget band is rejected', async () => {
    const { cookie } = await login('designer');
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/profile',
      cookies: { token: cookie },
      payload: { studioName: 'Bad Band', budgetBand: 'infinite' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('public visibility', () => {
  test('an unapproved profile is not publicly reachable', async () => {
    const { profile } = await asDesigner('Hidden House');
    const res = await app.inject({
      method: 'GET',
      url: `/api/designers/${profile.slug}`,
    });
    // 404, not 403 — a 403 would confirm the profile exists.
    expect(res.statusCode).toBe(404);
  });

  test('an approved profile is publicly reachable with no auth', async () => {
    const { profile } = await asDesigner('Open Studio');
    await approve(profile.id);
    const res = await app.inject({
      method: 'GET',
      url: `/api/designers/${profile.slug}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ profile: DesignerProfile }>().profile.studioName).toBe(
      'Open Studio',
    );
  });

  test('only published portfolio projects appear publicly', async () => {
    const { cookie, profile } = await asDesigner('Curated Works');
    await approve(profile.id);
    await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
      payload: { title: 'Public Piece', status: 'published' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
      payload: { title: 'Secret Piece', status: 'draft' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/designers/${profile.slug}`,
    });
    const titles = res
      .json<{ portfolioProjects: PortfolioProject[] }>()
      .portfolioProjects.map((p) => p.title);
    expect(titles).toContain('Public Piece');
    expect(titles).not.toContain('Secret Piece');
  });
});

describe('editing', () => {
  test('an approved profile stays approved and keeps its slug', async () => {
    const { cookie, profile } = await asDesigner('Stable Slug Studio');
    await approve(profile.id);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/profile',
      cookies: { token: cookie },
      payload: { studioName: 'Completely Renamed' },
    });

    const updated = res.json<{ profile: DesignerProfile }>().profile;
    expect(updated.studioName).toBe('Completely Renamed');
    // The URL is public and indexed by now, so it must not move.
    expect(updated.slug).toBe(profile.slug);
    expect(updated.status).toBe('approved');
  });

  test('submitting moves draft to pending', async () => {
    const { cookie, profile } = await asDesigner('Ready For Review');
    expect(profile.status).toBe('draft');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/profile/submit',
      cookies: { token: cookie },
    });
    expect(res.json<{ profile: DesignerProfile }>().profile.status).toBe(
      'pending',
    );
  });

  test('submitting twice is refused', async () => {
    const { cookie } = await asDesigner('Double Submit');
    await app.inject({
      method: 'POST',
      url: '/api/me/profile/submit',
      cookies: { token: cookie },
    });
    const again = await app.inject({
      method: 'POST',
      url: '/api/me/profile/submit',
      cookies: { token: cookie },
    });
    expect(again.statusCode).toBe(409);
  });

  test('a rejected profile can be resubmitted', async () => {
    const { cookie, profile } = await asDesigner('Second Chance');
    const db = await openDbConnection();
    db.run(
      "UPDATE designer_profiles SET status = 'rejected', review_note = 'Needs more work' WHERE id = ?",
      [profile.id],
    );
    db.close();

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/profile/submit',
      cookies: { token: cookie },
    });
    const updated = res.json<{ profile: DesignerProfile }>().profile;
    expect(updated.status).toBe('pending');
    // The old rejection reason must not linger on a fresh submission.
    expect(updated.reviewNote).toBeNull();
  });
});

describe('project ownership', () => {
  test("a designer cannot read another designer's project", async () => {
    const a = await asDesigner('Studio A');
    const b = await asDesigner('Studio B');

    const created = await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: a.cookie },
      payload: { title: 'A Private PortfolioProject' },
    });
    const portfolioProjectId = created.json<{ project: PortfolioProject }>()
      .project.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/me/portfolio/${portfolioProjectId}`,
      cookies: { token: b.cookie },
    });
    // 404 rather than 403, so ids cannot be probed for existence.
    expect(res.statusCode).toBe(404);
  });

  test("a designer cannot edit or delete another designer's project", async () => {
    const a = await asDesigner('Owner Studio');
    const b = await asDesigner('Intruder Studio');

    const created = await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: a.cookie },
      payload: { title: 'Hands Off' },
    });
    const id = created.json<{ project: PortfolioProject }>().project.id;

    const edit = await app.inject({
      method: 'PUT',
      url: `/api/me/portfolio/${id}`,
      cookies: { token: b.cookie },
      payload: { title: 'Stolen' },
    });
    expect(edit.statusCode).toBe(404);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/me/portfolio/${id}`,
      cookies: { token: b.cookie },
    });
    expect(remove.statusCode).toBe(404);

    // And the original is untouched.
    const check = await app.inject({
      method: 'GET',
      url: `/api/me/portfolio/${id}`,
      cookies: { token: a.cookie },
    });
    expect(check.json<{ project: PortfolioProject }>().project.title).toBe(
      'Hands Off',
    );
  });

  test("a project list only ever contains the caller's own work", async () => {
    const a = await asDesigner('Mine Only A');
    const b = await asDesigner('Mine Only B');
    await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: a.cookie },
      payload: { title: 'Belongs To A' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/portfolio',
      cookies: { token: b.cookie },
    });
    expect(
      res.json<{ portfolioProjects: PortfolioProject[] }>().portfolioProjects,
    ).toEqual([]);
  });
});

describe('project images', () => {
  /** Creates a real images row so the foreign key is satisfied. */
  async function makeImage(): Promise<number> {
    const db = await openDbConnection();
    db.run(
      "INSERT INTO images (storage_path, mime_type, byte_size) VALUES (?, 'image/webp', 1)",
      [`images/${crypto.randomUUID()}.webp`],
    );
    const id = (
      db.query('SELECT last_insert_rowid() AS id').get() as { id: number }
    ).id;
    db.close();
    return id;
  }

  test('order round-trips from the array position', async () => {
    const { cookie } = await asDesigner('Ordered Studio');
    const created = await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
      payload: { title: 'Ordered PortfolioProject' },
    });
    const portfolioProjectId = created.json<{ project: PortfolioProject }>()
      .project.id;

    const first = await makeImage();
    const second = await makeImage();
    const third = await makeImage();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/me/portfolio/${portfolioProjectId}/images`,
      cookies: { token: cookie },
      payload: {
        images: [{ imageId: third }, { imageId: first }, { imageId: second }],
      },
    });

    expect(
      res
        .json<{ images: PortfolioProjectImage[] }>()
        .images.map((i) => i.imageId),
    ).toEqual([third, first, second]);
  });

  test('reordering replaces the previous sequence', async () => {
    const { cookie } = await asDesigner('Reorder Studio');
    const created = await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
      payload: { title: 'Reorder PortfolioProject' },
    });
    const portfolioProjectId = created.json<{ project: PortfolioProject }>()
      .project.id;
    const a = await makeImage();
    const b = await makeImage();

    const put = (images: unknown) =>
      app.inject({
        method: 'PUT',
        url: `/api/me/portfolio/${portfolioProjectId}/images`,
        cookies: { token: cookie },
        payload: { images },
      });

    await put([{ imageId: a }, { imageId: b }]);
    const res = await put([{ imageId: b }]);

    expect(
      res
        .json<{ images: PortfolioProjectImage[] }>()
        .images.map((i) => i.imageId),
    ).toEqual([b]);
  });

  test('the same image twice in one project is rejected', async () => {
    const { cookie } = await asDesigner('Dupe Studio');
    const created = await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
      payload: { title: 'Dupe PortfolioProject' },
    });
    const portfolioProjectId = created.json<{ project: PortfolioProject }>()
      .project.id;
    const image = await makeImage();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/me/portfolio/${portfolioProjectId}/images`,
      cookies: { token: cookie },
      payload: { images: [{ imageId: image }, { imageId: image }] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('an image that does not exist is rejected', async () => {
    const { cookie } = await asDesigner('Ghost Image Studio');
    const created = await app.inject({
      method: 'POST',
      url: '/api/me/portfolio',
      cookies: { token: cookie },
      payload: { title: 'Ghost PortfolioProject' },
    });
    const portfolioProjectId = created.json<{ project: PortfolioProject }>()
      .project.id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/me/portfolio/${portfolioProjectId}/images`,
      cookies: { token: cookie },
      payload: { images: [{ imageId: 999999 }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
