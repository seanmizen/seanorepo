import { describe, expect, test } from 'bun:test';
import type { DesignerProfile, PortfolioProject } from '@shared/types';
import { getApp, uniqueEmail } from './setup';

const app = await getApp();
const { openDbConnection } = await import('../services/db');

/** setup.ts puts boss@inside.test in ADMIN_EMAILS. */
const ADMIN_EMAIL = 'boss@inside.test';

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
  return verified.cookies.find((c) => c.name === 'token')?.value as string;
}

const adminCookie = () => login('buyer', ADMIN_EMAIL);

/** A designer with a submitted (pending) profile, ready to be reviewed. */
async function pendingDesigner(studioName: string) {
  const cookie = await login('designer');
  const created = await app.inject({
    method: 'POST',
    url: '/api/me/profile',
    cookies: { token: cookie },
    payload: { studioName },
  });
  const profile = created.json<{ profile: DesignerProfile }>().profile;
  await app.inject({
    method: 'POST',
    url: '/api/me/profile/submit',
    cookies: { token: cookie },
  });
  return { cookie, profile };
}

const decide = async (
  id: number,
  decision: 'approve' | 'reject',
  note?: string,
) =>
  app.inject({
    method: 'POST',
    url: `/api/admin/designers/${id}/${decision}`,
    cookies: { token: await adminCookie() },
    payload: note === undefined ? {} : { note },
  });

describe('access control', () => {
  test('anonymous callers get 401 on every admin route', async () => {
    for (const url of [
      '/api/admin/designers',
      '/api/admin/designers/1',
      '/api/admin/designers/1/approve',
    ]) {
      const res = await app.inject({
        method: url.endsWith('approve') ? 'POST' : 'GET',
        url,
      });
      expect(res.statusCode).toBe(401);
    }
  });

  test('a signed-in non-admin gets 403, not 401', async () => {
    for (const role of ['buyer', 'designer'] as const) {
      const cookie = await login(role);
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/designers',
        cookies: { token: cookie },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  test('a designer cannot approve their own profile', async () => {
    const { cookie, profile } = await pendingDesigner('Self Approver');
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/designers/${profile.id}/approve`,
      cookies: { token: cookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('the review queue', () => {
  test('lists pending profiles with their project counts', async () => {
    const { profile } = await pendingDesigner('Queue Studio');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/designers?status=pending&limit=100',
      cookies: { token: await adminCookie() },
    });

    expect(res.statusCode).toBe(200);
    const found = res
      .json<{
        designers: Array<{ id: number; status: string; projectCount: number }>;
      }>()
      .designers.find((d) => d.id === profile.id);
    expect(found?.status).toBe('pending');
    expect(found?.projectCount).toBe(0);
  });

  test('rejects an unknown status rather than ignoring it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/designers?status=banished',
      cookies: { token: await adminCookie() },
    });
    expect(res.statusCode).toBe(400);
  });

  test('paginates and reports a total', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/designers?limit=2&page=1',
      cookies: { token: await adminCookie() },
    });
    const body = res.json<{
      designers: unknown[];
      total: number;
      limit: number;
    }>();
    expect(body.designers.length).toBeLessThanOrEqual(2);
    expect(body.total).toBeGreaterThan(0);
    expect(body.limit).toBe(2);
  });

  test('the detail view shows unpublished portfolio_projects too', async () => {
    // The reviewer must be able to judge draft work; that is the whole job.
    const { cookie, profile } = await pendingDesigner('Draft Work Studio');
    await app.inject({
      method: 'POST',
      url: '/api/me/portfolio_projects',
      cookies: { token: cookie },
      payload: { title: 'Unpublished Piece', status: 'draft' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/designers/${profile.id}`,
      cookies: { token: await adminCookie() },
    });
    const titles = res
      .json<{ portfolio_projects: PortfolioProject[] }>()
      .portfolio_projects.map((p) => p.title);
    expect(titles).toContain('Unpublished Piece');
  });

  test('an unknown profile is a 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/designers/999999',
      cookies: { token: await adminCookie() },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('approving', () => {
  test('makes the profile publicly visible', async () => {
    const { profile } = await pendingDesigner('Approve Me');

    const before = await app.inject({
      method: 'GET',
      url: `/api/designers/${profile.slug}`,
    });
    expect(before.statusCode).toBe(404);

    const res = await decide(profile.id, 'approve');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ profile: DesignerProfile }>().profile.status).toBe(
      'approved',
    );

    const after = await app.inject({
      method: 'GET',
      url: `/api/designers/${profile.slug}`,
    });
    expect(after.statusCode).toBe(200);
  });

  test('records who decided and when', async () => {
    const { profile } = await pendingDesigner('Attributed Studio');
    await decide(profile.id, 'approve');

    const db = await openDbConnection();
    const row = db
      .query(
        'SELECT reviewed_by, reviewed_at FROM designer_profiles WHERE id = ?',
      )
      .get(profile.id) as {
      reviewed_by: number | null;
      reviewed_at: string | null;
    };
    const admin = db
      .query('SELECT id FROM users WHERE email = ?')
      .get(ADMIN_EMAIL) as { id: number };
    db.close();

    // A profile must never be approved with no attribution.
    expect(row.reviewed_by).toBe(admin.id);
    expect(row.reviewed_at).toBeString();
  });
});

describe('rejecting', () => {
  test('requires a reason', async () => {
    const { profile } = await pendingDesigner('No Reason Studio');
    const res = await decide(profile.id, 'reject');
    // A rejection the designer cannot act on is a dead end, not a decision.
    expect(res.statusCode).toBe(400);
  });

  test('keeps the profile hidden and records the reason', async () => {
    const { profile } = await pendingDesigner('Rejected Studio');
    const res = await decide(profile.id, 'reject', 'Needs more finished work');

    expect(res.statusCode).toBe(200);
    const updated = res.json<{ profile: DesignerProfile }>().profile;
    expect(updated.status).toBe('rejected');
    expect(updated.reviewNote).toBe('Needs more finished work');

    const publicView = await app.inject({
      method: 'GET',
      url: `/api/designers/${profile.slug}`,
    });
    expect(publicView.statusCode).toBe(404);
  });

  test('a rejected designer can edit and resubmit, clearing the old note', async () => {
    const { cookie, profile } = await pendingDesigner('Second Chance Studio');
    await decide(profile.id, 'reject', 'Too thin');

    await app.inject({
      method: 'PUT',
      url: '/api/me/profile',
      cookies: { token: cookie },
      payload: { studioName: 'Second Chance Studio', bio: 'More detail now' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/profile/submit',
      cookies: { token: cookie },
    });

    const updated = res.json<{ profile: DesignerProfile }>().profile;
    expect(updated.status).toBe('pending');
    // A stale rejection reason must not follow a fresh submission.
    expect(updated.reviewNote).toBeNull();
  });

  test('an over-long note is rejected', async () => {
    const { profile } = await pendingDesigner('Long Note Studio');
    const res = await decide(profile.id, 'reject', 'x'.repeat(1001));
    expect(res.statusCode).toBe(400);
  });
});
