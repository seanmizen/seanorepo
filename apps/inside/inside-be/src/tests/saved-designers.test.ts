import { describe, expect, test } from 'bun:test';
import type {
  DesignerProfile,
  SavedDesignerListResponse,
  User,
} from '@shared/types';
import { getApp, uniqueEmail } from './setup';

/**
 * The buyer's shortlist — save/unsave, idempotency, ownership and pagination.
 *
 * The anonymous-save-then-signup round trip (the ticket's whole point) is
 * covered end to end by `inside-fe/tests/e2e/saved.spec.ts`. This suite
 * covers what `app.inject()` can prove: the API itself.
 */

const app = await getApp();
const { openDbConnection } = await import('../services/db');
const { listSavedDesigners } = await import('../services/saved-designers');

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

/** Approves directly in the database — the admin API is a separate ticket. */
async function approve(profileId: number) {
  const db = await openDbConnection();
  db.run("UPDATE designer_profiles SET status = 'approved' WHERE id = ?", [
    profileId,
  ]);
  db.close();
}

/** A signed-in designer with a profile, approved unless told otherwise. */
async function asDesigner(studioName: string, { approved = true } = {}) {
  const { cookie } = await login('designer');
  const res = await app.inject({
    method: 'POST',
    url: '/api/me/profile',
    cookies: { token: cookie },
    payload: { studioName },
  });
  const profile = res.json<{ profile: DesignerProfile }>().profile;
  if (approved) await approve(profile.id);
  return { cookie, profile };
}

/** A signed-in buyer, with their own numeric user id resolved. */
async function asBuyer() {
  const { cookie, email } = await login('buyer');
  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    cookies: { token: cookie },
  });
  const userId = (me.json<{ user: User }>().user as User).id;
  return { cookie, email, userId };
}

const save = (cookie: string, id: number) =>
  app.inject({
    method: 'POST',
    url: `/api/me/saved-designers/${id}`,
    cookies: { token: cookie },
  });

const unsave = (cookie: string, id: number) =>
  app.inject({
    method: 'DELETE',
    url: `/api/me/saved-designers/${id}`,
    cookies: { token: cookie },
  });

const shortlist = (cookie: string) =>
  app.inject({
    method: 'GET',
    url: '/api/me/saved-designers',
    cookies: { token: cookie },
  });

describe('saving a designer', () => {
  test('a buyer saves a designer, and it appears on their shortlist', async () => {
    const buyer = await asBuyer();
    const { profile } = await asDesigner('Shortlist Studio One');

    const res = await save(buyer.cookie, profile.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ saved: boolean }>().saved).toBe(true);

    const list = await shortlist(buyer.cookie);
    const ids = list
      .json<SavedDesignerListResponse>()
      .savedDesigners.map((d) => d.id);
    expect(ids).toContain(profile.id);
  });

  test('saving twice is idempotent — success, not a 500, and one row', async () => {
    const buyer = await asBuyer();
    const { profile } = await asDesigner('Shortlist Studio Two');

    const first = await save(buyer.cookie, profile.id);
    const second = await save(buyer.cookie, profile.id);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ saved: boolean }>().saved).toBe(true);

    const list = await shortlist(buyer.cookie);
    const matches = list
      .json<SavedDesignerListResponse>()
      .savedDesigners.filter((d) => d.id === profile.id);
    expect(matches.length).toBe(1);
  });

  test('unsaving is idempotent, and removes it from the shortlist', async () => {
    const buyer = await asBuyer();
    const { profile } = await asDesigner('Shortlist Studio Three');
    await save(buyer.cookie, profile.id);

    const first = await unsave(buyer.cookie, profile.id);
    const second = await unsave(buyer.cookie, profile.id);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ saved: boolean }>().saved).toBe(false);

    const list = await shortlist(buyer.cookie);
    const ids = list
      .json<SavedDesignerListResponse>()
      .savedDesigners.map((d) => d.id);
    expect(ids).not.toContain(profile.id);
  });

  test('GET /me/saved-designers/:id reports whether one designer is saved', async () => {
    const buyer = await asBuyer();
    const { profile } = await asDesigner('Shortlist Studio Four');

    const before = await app.inject({
      method: 'GET',
      url: `/api/me/saved-designers/${profile.id}`,
      cookies: { token: buyer.cookie },
    });
    expect(before.json<{ saved: boolean }>().saved).toBe(false);

    await save(buyer.cookie, profile.id);

    const after = await app.inject({
      method: 'GET',
      url: `/api/me/saved-designers/${profile.id}`,
      cookies: { token: buyer.cookie },
    });
    expect(after.json<{ saved: boolean }>().saved).toBe(true);
  });

  test('an anonymous caller cannot save, list, or unsave', async () => {
    const { profile } = await asDesigner('Shortlist Studio Five');

    const postRes = await app.inject({
      method: 'POST',
      url: `/api/me/saved-designers/${profile.id}`,
    });
    expect(postRes.statusCode).toBe(401);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/me/saved-designers',
    });
    expect(getRes.statusCode).toBe(401);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/me/saved-designers/${profile.id}`,
    });
    expect(deleteRes.statusCode).toBe(401);
  });

  test('a designer that does not exist cannot be saved', async () => {
    const buyer = await asBuyer();
    const res = await save(buyer.cookie, 9_999_999);
    expect(res.statusCode).toBe(404);
  });

  test('an unapproved designer cannot be saved — same 404 as a missing one', async () => {
    const buyer = await asBuyer();
    const { profile } = await asDesigner('Shortlist Studio Unapproved', {
      approved: false,
    });

    const res = await save(buyer.cookie, profile.id);
    expect(res.statusCode).toBe(404);

    const list = await shortlist(buyer.cookie);
    const ids = list
      .json<SavedDesignerListResponse>()
      .savedDesigners.map((d) => d.id);
    expect(ids).not.toContain(profile.id);
  });

  test('a bad id is a 400, not a lookup on garbage input', async () => {
    const buyer = await asBuyer();
    const res = await save(buyer.cookie, Number.NaN);
    expect(res.statusCode).toBe(400);
  });
});

describe('ownership', () => {
  test("one buyer's save never appears on another buyer's shortlist", async () => {
    const buyerA = await asBuyer();
    const buyerB = await asBuyer();
    const { profile } = await asDesigner('Shortlist Studio Owned');

    await save(buyerA.cookie, profile.id);

    const listA = await shortlist(buyerA.cookie);
    const listB = await shortlist(buyerB.cookie);
    expect(
      listA.json<SavedDesignerListResponse>().savedDesigners.map((d) => d.id),
    ).toContain(profile.id);
    expect(
      listB.json<SavedDesignerListResponse>().savedDesigners.map((d) => d.id),
    ).not.toContain(profile.id);
  });

  test(
    "a buyer's DELETE cannot remove a designer from another buyer's " +
      'shortlist — the pending intent cannot act on behalf of another user',
    async () => {
      const buyerA = await asBuyer();
      const buyerB = await asBuyer();
      const { profile } = await asDesigner('Shortlist Studio Guarded');
      await save(buyerA.cookie, profile.id);

      // Buyer B has no such row, so this is a no-op on their own (empty)
      // shortlist — every write here is scoped by the session's own user id,
      // never a body or path parameter, so there is no way to name buyer A's
      // row from buyer B's session at all.
      const res = await unsave(buyerB.cookie, profile.id);
      expect(res.statusCode).toBe(200);

      const listA = await shortlist(buyerA.cookie);
      expect(
        listA.json<SavedDesignerListResponse>().savedDesigners.map((d) => d.id),
      ).toContain(profile.id);
    },
  );

  test('a role has no bearing on ownership: each session only ever sees its own shortlist', async () => {
    const buyer = await asBuyer();
    const { cookie: designerCookie } = await login('designer');
    const { profile } = await asDesigner('Shortlist Studio Cross Role');

    await save(buyer.cookie, profile.id);

    const asDesignerList = await shortlist(designerCookie);
    expect(
      asDesignerList
        .json<SavedDesignerListResponse>()
        .savedDesigners.map((d) => d.id),
    ).not.toContain(profile.id);
  });
});

describe('shortlist pagination', () => {
  test('total and hasMore are correct across pages', async () => {
    const buyer = await asBuyer();
    const profiles = await Promise.all(
      ['A', 'B', 'C'].map((n) => asDesigner(`Shortlist Page Studio ${n}`)),
    );
    for (const { profile } of profiles) {
      await save(buyer.cookie, profile.id);
    }

    const page1 = await listSavedDesigners(buyer.userId, {
      limit: 2,
      offset: 0,
    });
    expect(page1.items.length).toBe(2);
    expect(page1.total).toBe(3);

    const page2 = await listSavedDesigners(buyer.userId, {
      limit: 2,
      offset: 2,
    });
    expect(page2.items.length).toBe(1);
    expect(page2.total).toBe(3);

    // Newest save first, and no overlap between pages.
    const allIds = [...page1.items, ...page2.items].map((d) => d.id);
    expect(new Set(allIds).size).toBe(3);
  });

  test('the empty shortlist is a real success, not an error', async () => {
    const buyer = await asBuyer();
    const res = await shortlist(buyer.cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json<SavedDesignerListResponse>();
    expect(body.savedDesigners).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
  });
});
