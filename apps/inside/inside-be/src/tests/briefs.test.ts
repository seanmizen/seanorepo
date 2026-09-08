import { describe, expect, test } from 'bun:test';
import type {
  Bid,
  DesignerProfile,
  OwnedBrief,
  PublicBrief,
  ReceivedBid,
  SentBid,
} from '@shared/types';
import { getApp, uniqueEmail } from './setup';

/**
 * Post-a-project: a buyer posts a brief, designers bid on it.
 *
 * The suite shares one database with every other suite, so nothing here
 * assumes an empty table — every assertion targets rows this file made,
 * and location filters use a unique token per test.
 */

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

/** Unique per call, so a filter assertion only ever sees its own rows. */
let counter = 0;
const uniqueLocation = (prefix = 'Loc'): string =>
  `${prefix}-${Date.now()}-${counter++}`;

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
  const { cookie, email } = await login('designer');
  const res = await app.inject({
    method: 'POST',
    url: '/api/me/profile',
    cookies: { token: cookie },
    payload: { studioName },
  });
  const profile = res.json<{ profile: DesignerProfile }>().profile;
  if (approved) await approve(profile.id);
  // The email is what a buyer invites by — invitees are users, not designers.
  return { cookie, email, profile };
}

/** A signed-in buyer, plus a helper to post briefs as them. */
async function asBuyer() {
  const { cookie, email } = await login('buyer');

  const postBrief = async (
    payload: Record<string, unknown>,
  ): Promise<OwnedBrief> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/briefs',
      cookies: { token: cookie },
      payload: { title: 'A Brief', description: 'Some work', ...payload },
    });
    return res.json<{ brief: OwnedBrief }>().brief;
  };

  return { cookie, email, postBrief };
}

const openBrief = async (payload: Record<string, unknown> = {}) => {
  const buyer = await asBuyer();
  const brief = await buyer.postBrief({
    visibility: 'public',
    publish: true,
    ...payload,
  });
  return { buyer, brief };
};

const bid = (cookie: string, id: number, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/briefs/${id}/bids`,
    cookies: { token: cookie },
    payload: {
      message: 'We would love to take this on',
      ...(payload as object),
    },
  });

describe('posting a brief', () => {
  test('a buyer posts a draft, and it is not on the public board', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({ title: 'Quiet Draft' });
    // Private and unpublished by omission — the safe answer, not the common
    // one. This is what 'draft' used to mean, now said as two facts.
    expect(brief.visibility).toBe('private');
    expect(brief.publishedAt).toBeNull();

    const res = await app.inject({ method: 'GET', url: '/api/briefs' });
    const titles = res
      .json<{ briefs: PublicBrief[] }>()
      .briefs.map((b) => b.title);
    expect(titles).not.toContain('Quiet Draft');
  });

  test('a brief posted open is on the board and stamped published', async () => {
    const location = uniqueLocation('Published');
    const { brief } = await openBrief({ title: 'Loud Brief', location });
    expect(brief.visibility).toBe('public');
    expect(brief.publishedAt).not.toBeNull();

    const res = await app.inject({
      method: 'GET',
      url: `/api/briefs?location=${encodeURIComponent(location)}`,
    });
    const listed = res.json<{ briefs: PublicBrief[] }>().briefs;
    expect(listed.map((b) => b.id)).toEqual([brief.id]);
  });

  test('a designer cannot post a brief', async () => {
    const { cookie } = await asDesigner('No Briefs Studio');
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/briefs',
      cookies: { token: cookie },
      payload: { title: 'Not Mine', description: 'Nope' },
    });
    // Posting a job is the buyer's side of the marketplace.
    expect(res.statusCode).toBe(403);
  });

  test('an anonymous caller cannot post a brief', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/briefs',
      payload: { title: 'Anonymous', description: 'Nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('title and description are required', async () => {
    const { cookie } = await login('buyer');
    for (const payload of [
      {},
      { title: 'No description' },
      { description: 'No title' },
      { title: '   ', description: 'Blank title' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/briefs',
        cookies: { token: cookie },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  test('unknown enum values are rejected', async () => {
    const { cookie } = await login('buyer');
    for (const payload of [
      { workType: 'spaceship' },
      { budgetBand: 'infinite' },
      { timeline: 'eventually' },
      { closesAt: 'next tuesday-ish' },
      { visibility: 'sideways' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/briefs',
        cookies: { token: cookie },
        payload: { title: 'Bad', description: 'Bad', ...payload },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('the public board', () => {
  test('contact details never appear on a listing or detail', async () => {
    const location = uniqueLocation('Private');
    const { buyer, brief } = await openBrief({ location });

    const list = await app.inject({
      method: 'GET',
      url: `/api/briefs?location=${encodeURIComponent(location)}`,
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/briefs/${brief.slug}`,
    });

    for (const body of [list.body, detail.body]) {
      // Neither the poster's identity nor any route back to it.
      expect(body).not.toContain(buyer.email);
      expect(body).not.toContain('buyerId');
      expect(body).not.toContain('buyer_id');
    }
    expect(list.json<{ briefs: PublicBrief[] }>().briefs[0]).not.toHaveProperty(
      'buyerId',
    );
  });

  test('filters work alone and in combination', async () => {
    const location = uniqueLocation('Filter');
    const buyer = await asBuyer();
    const kitchen = await buyer.postBrief({
      visibility: 'public',
      publish: true,
      location,
      workType: 'kitchen',
      budgetBand: '10k_25k',
    });
    const bathroom = await buyer.postBrief({
      visibility: 'public',
      publish: true,
      location,
      workType: 'bathroom',
      budgetBand: '50k_100k',
    });

    const ids = async (query: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/briefs?location=${encodeURIComponent(location)}${query}`,
        })
      )
        .json<{ briefs: PublicBrief[] }>()
        .briefs.map((b) => b.id)
        .sort();

    expect(await ids('')).toEqual([kitchen.id, bathroom.id].sort());
    expect(await ids('&workTypes=kitchen')).toEqual([kitchen.id]);
    expect(await ids('&budgetBands=50k_100k')).toEqual([bathroom.id]);
    expect(await ids('&workTypes=kitchen&budgetBands=50k_100k')).toEqual([]);
  });

  test('a malformed filter is rejected rather than ignored', async () => {
    for (const query of [
      'workTypes=spaceship',
      'budgetBands=infinite',
      'limit=0',
      'limit=1000',
      'limit=abc',
      'page=0',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/briefs?${query}`,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  test('paging is stable across a set posted in the same second', async () => {
    const location = uniqueLocation('Paged');
    const buyer = await asBuyer();
    const posted: number[] = [];
    for (const n of [1, 2, 3]) {
      posted.push(
        (
          await buyer.postBrief({
            visibility: 'public',
            publish: true,
            location,
            title: `Page ${n}`,
          })
        ).id,
      );
    }

    // Page-based now, matching every other list endpoint.
    const page = async (n: number) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/briefs?location=${encodeURIComponent(location)}&limit=2&page=${n}`,
        })
      ).json<{ briefs: PublicBrief[]; total: number }>();

    const first = await page(1);
    const second = await page(2);
    expect(first.total).toBe(3);
    // Newest first, with id breaking the one-second timestamp tie.
    expect([...first.briefs, ...second.briefs].map((b) => b.id)).toEqual(
      [...posted].reverse(),
    );
  });

  test('an empty result is an empty page, not a 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/briefs?location=${uniqueLocation('Nothing')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ briefs: PublicBrief[]; total: number }>()).toMatchObject({
      briefs: [],
      total: 0,
    });
  });

  test('a draft brief 404s on public detail, an open one does not', async () => {
    const buyer = await asBuyer();
    const draft = await buyer.postBrief({ title: 'Still Drafting' });
    const live = await buyer.postBrief({
      visibility: 'public',
      publish: true,
      title: 'Live One',
    });

    const hidden = await app.inject({
      method: 'GET',
      url: `/api/briefs/${draft.slug}`,
    });
    expect(hidden.statusCode).toBe(404);

    const shown = await app.inject({
      method: 'GET',
      url: `/api/briefs/${live.slug}`,
    });
    expect(shown.statusCode).toBe(200);
    expect(shown.json<{ brief: PublicBrief }>().brief.title).toBe('Live One');
  });
});

describe('managing your own briefs', () => {
  test('a buyer only ever sees their own briefs', async () => {
    const a = await asBuyer();
    const b = await asBuyer();
    const mine = await a.postBrief({ title: 'Belongs To A' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/briefs',
      cookies: { token: b.cookie },
    });
    expect(
      res.json<{ briefs: OwnedBrief[] }>().briefs.map((x) => x.id),
    ).not.toContain(mine.id);
  });

  test("a buyer cannot read, edit or delete another buyer's brief", async () => {
    const a = await asBuyer();
    const b = await asBuyer();
    const brief = await a.postBrief({ title: 'Hands Off' });

    for (const [method, url] of [
      ['GET', `/api/me/briefs/${brief.id}`],
      ['PUT', `/api/me/briefs/${brief.id}`],
      ['DELETE', `/api/me/briefs/${brief.id}`],
      ['POST', `/api/me/briefs/${brief.id}/publish`],
      ['POST', `/api/me/briefs/${brief.id}/close`],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        cookies: { token: b.cookie },
        payload: { title: 'Stolen', description: 'Stolen' },
      });
      // 404 rather than 403, so ids cannot be probed for existence.
      expect(res.statusCode).toBe(404);
    }

    const check = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}`,
      cookies: { token: a.cookie },
    });
    expect(check.json<{ brief: OwnedBrief }>().brief.title).toBe('Hands Off');
  });

  test('editing a brief does not change its status', async () => {
    const { buyer, brief } = await openBrief();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/me/briefs/${brief.id}`,
      cookies: { token: buyer.cookie },
      payload: { title: 'Renamed', description: 'Rewritten' },
    });
    const updated = res.json<{ brief: OwnedBrief }>().brief;
    expect(updated.title).toBe('Renamed');
    // A content edit must not change who can see it or whether it is live.
    expect(updated.visibility).toBe('public');
    expect(updated.publishedAt).not.toBeNull();
  });

  test('publishing is idempotent — a retry is a no-op, not an error', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({ title: 'To Publish' });

    const publish = () =>
      app.inject({
        method: 'POST',
        url: `/api/me/briefs/${brief.id}/publish`,
        cookies: { token: buyer.cookie },
      });

    const first = await publish();
    expect(
      first.json<{ brief: OwnedBrief }>().brief.publishedAt,
    ).not.toBeNull();

    // Publishing an already-published brief is the same intent and the same
    // outcome. A 409 here would make an ordinary retry look like a failure.
    const second = await publish();
    expect(second.statusCode).toBe(200);
    expect(
      second.json<{ brief: OwnedBrief }>().brief.publishedAt,
    ).not.toBeNull();
  });

  test('closing a brief takes it off the board but leaves it published', async () => {
    const location = uniqueLocation('Closing');
    const { buyer, brief } = await openBrief({ location });

    const closed = await app.inject({
      method: 'POST',
      url: `/api/me/briefs/${brief.id}/close`,
      cookies: { token: buyer.cookie },
    });

    // Closing stops the invitation to bid. It is NOT an unpublish: the brief
    // stays readable to anyone holding its link, and the bids already received
    // stay exactly where they are.
    const body = closed.json<{ brief: OwnedBrief }>().brief;
    expect(body.closesAt).not.toBeNull();
    expect(body.publishedAt).not.toBeNull();

    const board = await app.inject({
      method: 'GET',
      url: `/api/briefs?location=${encodeURIComponent(location)}`,
    });
    expect(board.json<{ briefs: PublicBrief[] }>().briefs).toEqual([]);
  });

  test('deleting a brief removes it and its bids', async () => {
    const { buyer, brief } = await openBrief();
    const designer = await asDesigner('Doomed Bid Studio');
    await bid(designer.cookie, brief.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/me/briefs/${brief.id}`,
      cookies: { token: buyer.cookie },
    });
    expect(res.statusCode).toBe(204);

    const gone = await app.inject({
      method: 'GET',
      url: `/api/briefs/${brief.slug}`,
    });
    expect(gone.statusCode).toBe(404);

    const db = await openDbConnection();
    const left = db
      .query('SELECT COUNT(*) AS n FROM bids WHERE brief_id = ?')
      .get(brief.id) as { n: number };
    db.close();
    expect(left.n).toBe(0);
  });
});

describe('bidding', () => {
  /** Send a draft bid. */
  const submit = (cookie: string, bidId: number) =>
    app.inject({
      method: 'POST',
      url: `/api/me/bids/${bidId}/submit`,
      cookies: { token: cookie },
    });

  test('a bid starts as a draft and only counts once sent', async () => {
    const { brief } = await openBrief();
    const designer = await asDesigner('Keen Studio');

    const res = await bid(designer.cookie, brief.id, {
      budgetBand: '25k_50k',
      availability: 'within_3_months',
    });
    expect(res.statusCode).toBe(201);

    const created = res.json<{ bid: Bid }>().bid;
    expect(created.briefId).toBe(brief.id);
    expect(created.designerProfileId).toBe(designer.profile.id);
    expect(created.status).toBe('draft');
    expect(created.submittedAt).toBeNull();

    // A bid nobody has sent is not a bid: it must not tell the buyer they have
    // interest they cannot see.
    const beforeSubmit = await app.inject({
      method: 'GET',
      url: `/api/briefs/${brief.slug}`,
    });
    expect(beforeSubmit.json<{ brief: PublicBrief }>().brief.bidCount).toBe(0);

    const sent = await submit(designer.cookie, created.id);
    expect(sent.statusCode).toBe(200);
    expect(sent.json<{ bid: Bid }>().bid.status).toBe('submitted');
    expect(sent.json<{ bid: Bid }>().bid.submittedAt).toBeString();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/briefs/${brief.slug}`,
    });
    expect(detail.json<{ brief: PublicBrief }>().brief.bidCount).toBe(1);
  });

  test('starting again returns the draft already in progress', async () => {
    // "Start creating a bid" and "continue the bid you had in draft" are the
    // same button, so they are the same call.
    const { brief } = await openBrief();
    const designer = await asDesigner('Continue Studio');

    const first = await bid(designer.cookie, brief.id);
    const again = await bid(designer.cookie, brief.id);

    expect(again.statusCode).toBe(200);
    expect(again.json<{ bid: Bid }>().bid.id).toBe(
      first.json<{ bid: Bid }>().bid.id,
    );
  });

  test('a draft can be edited, a sent bid cannot', async () => {
    const { brief } = await openBrief();
    const designer = await asDesigner('Editing Studio');
    const created = (await bid(designer.cookie, brief.id)).json<{
      bid: Bid;
    }>().bid;

    const edited = await app.inject({
      method: 'PUT',
      url: `/api/me/bids/${created.id}`,
      cookies: { token: designer.cookie },
      payload: { message: 'A much better bid than before' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<{ bid: Bid }>().bid.message).toBe(
      'A much better bid than before',
    );

    await submit(designer.cookie, created.id);

    const tooLate = await app.inject({
      method: 'PUT',
      url: `/api/me/bids/${created.id}`,
      cookies: { token: designer.cookie },
      payload: { message: 'Sneaking a change in after sending' },
    });
    expect(tooLate.statusCode).toBe(409);
  });

  test('a bid cannot be sent twice', async () => {
    const { brief } = await openBrief();
    const designer = await asDesigner('Double Send Studio');
    const created = (await bid(designer.cookie, brief.id)).json<{
      bid: Bid;
    }>().bid;

    expect((await submit(designer.cookie, created.id)).statusCode).toBe(200);
    expect((await submit(designer.cookie, created.id)).statusCode).toBe(409);
  });

  test("a designer cannot touch another designer's bid", async () => {
    const { brief } = await openBrief();
    const owner = await asDesigner('Owner Bid Studio');
    const intruder = await asDesigner('Intruder Bid Studio');
    const created = (await bid(owner.cookie, brief.id)).json<{
      bid: Bid;
    }>().bid;

    for (const call of [
      app.inject({
        method: 'PUT',
        url: `/api/me/bids/${created.id}`,
        cookies: { token: intruder.cookie },
        payload: { message: 'Not mine to edit at all' },
      }),
      submit(intruder.cookie, created.id),
    ]) {
      // 404 rather than 403, so ids cannot be probed.
      expect((await call).statusCode).toBe(404);
    }
  });

  test('a draft cannot be sent once the brief has closed', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({
      visibility: 'public',
      publish: true,
    });
    const designer = await asDesigner('Slow Studio');
    const created = (await bid(designer.cookie, brief.id)).json<{
      bid: Bid;
    }>().bid;

    // The brief can close while a draft sits unsent. Closing is a past
    // closes_at now, not a status.
    const db = await openDbConnection();
    db.run(
      "UPDATE briefs SET closes_at = datetime('now', '-1 minute') WHERE id = ?",
      [brief.id],
    );
    db.close();

    expect((await submit(designer.cookie, created.id)).statusCode).toBe(409);
  });

  test('the same designer cannot bid the same brief twice once sent', async () => {
    const { brief } = await openBrief();
    const designer = await asDesigner('Twice Studio');

    const created = await bid(designer.cookie, brief.id);
    expect(created.statusCode).toBe(201);
    await submit(designer.cookie, created.json<{ bid: Bid }>().bid.id);

    const again = await bid(designer.cookie, brief.id, {
      message: 'Actually, we would love it even more',
    });
    // The schema's UNIQUE constraint, surfaced as a conflict rather than a 500.
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: string }>().error).not.toContain('UNIQUE');
    expect(again.json<{ error: string }>().error).not.toContain('SQLITE');

    const db = await openDbConnection();
    const count = db
      .query('SELECT COUNT(*) AS n FROM bids WHERE brief_id = ?')
      .get(brief.id) as { n: number };
    db.close();
    expect(count.n).toBe(1);
  });

  test('a race between two identical bids still resolves to one 409', async () => {
    const { brief } = await openBrief();
    const designer = await asDesigner('Racing Studio');

    // Both requests pass the "already started?" check before either inserts,
    // so the loser is caught by the UNIQUE constraint rather than the lookup.
    // Either way exactly one row exists and neither caller sees a 500.
    const [a, b] = await Promise.all([
      bid(designer.cookie, brief.id),
      bid(designer.cookie, brief.id),
    ]);
    for (const res of [a, b]) {
      expect([200, 201, 409]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    }

    const db = await openDbConnection();
    const count = db
      .query('SELECT COUNT(*) AS n FROM bids WHERE brief_id = ?')
      .get(brief.id) as { n: number };
    db.close();
    expect(count.n).toBe(1);
  });

  test('a designer whose profile is not approved cannot bid', async () => {
    const { brief } = await openBrief();

    for (const status of ['draft', 'pending', 'rejected'] as const) {
      const designer = await asDesigner(`Unapproved ${status} Studio`, {
        approved: false,
      });
      const db = await openDbConnection();
      db.run('UPDATE designer_profiles SET status = ? WHERE id = ?', [
        status,
        designer.profile.id,
      ]);
      db.close();

      const res = await bid(designer.cookie, brief.id);
      // The approval gate is the entire point of the review queue.
      expect(res.statusCode).toBe(403);
    }

    const db = await openDbConnection();
    const count = db
      .query('SELECT COUNT(*) AS n FROM bids WHERE brief_id = ?')
      .get(brief.id) as { n: number };
    db.close();
    expect(count.n).toBe(0);
  });

  test('a designer with no profile at all cannot bid', async () => {
    const { brief } = await openBrief();
    const { cookie } = await login('designer');
    expect((await bid(cookie, brief.id)).statusCode).toBe(403);
  });

  test('a buyer cannot bid', async () => {
    const { brief } = await openBrief();
    const buyer = await asBuyer();
    expect((await bid(buyer.cookie, brief.id)).statusCode).toBe(403);
  });

  test('an anonymous caller cannot bid', async () => {
    const { brief } = await openBrief();
    const res = await app.inject({
      method: 'POST',
      url: `/api/briefs/${brief.id}/bids`,
      payload: { message: 'Hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('an unpublished brief reads as missing; a closed one refuses the bid', async () => {
    const buyer = await asBuyer();
    const designer = await asDesigner('Too Late Studio');

    // Unpublished is 404, not 409. A 409 would confirm the brief exists, which
    // is the thing an unpublished brief must not do.
    const unpublished = await buyer.postBrief({ title: 'Unpublished' });
    expect((await bid(designer.cookie, unpublished.id)).statusCode).toBe(404);

    // Closed is 409: the brief is openly readable, it just takes no more bids.
    const closed = await buyer.postBrief({
      visibility: 'public',
      publish: true,
    });
    const db = await openDbConnection();
    db.run(
      "UPDATE briefs SET closes_at = datetime('now', '-1 minute') WHERE id = ?",
      [closed.id],
    );
    db.close();

    expect((await bid(designer.cookie, closed.id)).statusCode).toBe(409);
  });

  test('a brief past its closing date takes no new bids', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({
      visibility: 'public',
      publish: true,
      closesAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const designer = await asDesigner('Deadline Studio');
    expect((await bid(designer.cookie, brief.id)).statusCode).toBe(409);
  });

  test('a future closing date still takes bids', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({
      visibility: 'public',
      publish: true,
      closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const designer = await asDesigner('In Time Studio');
    expect((await bid(designer.cookie, brief.id)).statusCode).toBe(201);
  });

  test('a brief that does not exist 404s', async () => {
    const designer = await asDesigner('Ghost Brief Studio');
    expect((await bid(designer.cookie, 99999999)).statusCode).toBe(404);
  });

  test('a bid needs a message, and its enums are checked', async () => {
    const { brief } = await openBrief();
    const designer = await asDesigner('Sloppy Studio');

    for (const payload of [
      { message: '' },
      { message: '   ' },
      { message: 'Fine', budgetBand: 'infinite' },
      // 'exploring' is a buyer's timeline, not a designer's availability.
      { message: 'Fine', availability: 'exploring' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/briefs/${brief.id}/bids`,
        cookies: { token: designer.cookie },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('who can see a bid', () => {
  /** A brief with one bid on it, plus the cast of characters around it. */
  async function briefWithBid() {
    const { buyer, brief } = await openBrief();
    const designer = await asDesigner('Visible Studio');
    const created = await bid(designer.cookie, brief.id, {
      message: 'A very private bid',
    });
    const draft = created.json<{ bid: Bid }>().bid;
    // A brief "with a bid" means a bid the designer actually sent — a draft is
    // invisible to the buyer by design.
    const sent = await app.inject({
      method: 'POST',
      url: `/api/me/bids/${draft.id}/submit`,
      cookies: { token: designer.cookie },
    });
    return {
      buyer,
      brief,
      designer,
      bid: sent.json<{ bid: Bid }>().bid,
    };
  }

  test('the brief owner sees the bids received, with the designer', async () => {
    const { buyer, brief, designer } = await briefWithBid();
    const res = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}/bids`,
      cookies: { token: buyer.cookie },
    });
    const received = res.json<{ bids: ReceivedBid[] }>().bids;
    expect(received).toHaveLength(1);
    expect(received[0].message).toBe('A very private bid');
    expect(received[0].designer.slug).toBe(designer.profile.slug);
  });

  test('the bidding designer sees their own bid and the brief', async () => {
    const { brief, designer } = await briefWithBid();
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/bids',
      cookies: { token: designer.cookie },
    });
    const sent = res.json<{ bids: SentBid[] }>().bids;
    expect(sent.map((p) => p.briefId)).toEqual([brief.id]);
    // Even here, the brief carries no route back to the buyer.
    expect(sent[0].brief).not.toHaveProperty('buyerId');
  });

  test('another buyer cannot see the bids on a brief', async () => {
    const { brief } = await briefWithBid();
    const stranger = await asBuyer();
    const res = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}/bids`,
      cookies: { token: stranger.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  test('another designer sees neither the bid nor the route to it', async () => {
    const { brief } = await briefWithBid();
    const rival = await asDesigner('Nosy Studio');

    // The buyer's inbox is a buyer-only route, so it refuses a designer outright.
    const inbox = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}/bids`,
      cookies: { token: rival.cookie },
    });
    expect(inbox.statusCode).toBe(403);

    // And their own list contains only their own work: none.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/me/bids',
      cookies: { token: rival.cookie },
    });
    expect(mine.json<{ bids: SentBid[] }>().bids).toEqual([]);
  });

  test('an anonymous caller sees no bid content anywhere public', async () => {
    const { brief } = await briefWithBid();

    const inbox = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}/bids`,
    });
    expect(inbox.statusCode).toBe(401);

    const mine = await app.inject({ method: 'GET', url: '/api/me/bids' });
    expect(mine.statusCode).toBe(401);

    // The public detail exposes the count and nothing else.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/briefs/${brief.slug}`,
    });
    expect(detail.body).not.toContain('A very private bid');
    expect(detail.json<{ brief: PublicBrief }>().brief.bidCount).toBe(1);
  });

  test('a designer with no profile has no bid list', async () => {
    const { cookie } = await login('designer');
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/bids',
      cookies: { token: cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('a deleted buyer account', () => {
  test('leaves the brief and its bids intact with a null buyer', async () => {
    const location = uniqueLocation('Orphaned');
    const { buyer, brief } = await openBrief({
      location,
      title: 'Outlives Its Author',
    });
    const designer = await asDesigner('Loyal Studio');
    const created = await bid(designer.cookie, brief.id);
    expect(created.statusCode).toBe(201);

    // Deleting the account. `buyer_id` is SET NULL rather than CASCADE, so an
    // open brief with live bids must not vanish from under the designers
    // who responded to it.
    const db = await openDbConnection();
    db.run('DELETE FROM users WHERE email = ?', [buyer.email]);
    const row = db
      .query('SELECT buyer_id FROM briefs WHERE id = ?')
      .get(brief.id) as { buyer_id: number | null } | null;
    const bids = db
      .query('SELECT COUNT(*) AS n FROM bids WHERE brief_id = ?')
      .get(brief.id) as { n: number };
    db.close();

    expect(row).not.toBeNull();
    expect(row?.buyer_id).toBeNull();
    expect(bids.n).toBe(1);

    // Still on the board, and still readable.
    const board = await app.inject({
      method: 'GET',
      url: `/api/briefs?location=${encodeURIComponent(location)}`,
    });
    expect(
      board.json<{ briefs: PublicBrief[] }>().briefs.map((b) => b.id),
    ).toEqual([brief.id]);

    // And the designer still has their bid, with the brief attached.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/me/bids',
      cookies: { token: designer.cookie },
    });
    const sent = mine.json<{ bids: SentBid[] }>().bids;
    expect(sent).toHaveLength(1);
    expect(sent[0].brief.title).toBe('Outlives Its Author');
  });

  test('an orphaned brief is nobody’s to manage', async () => {
    const { buyer, brief } = await openBrief();
    const db = await openDbConnection();
    db.run('DELETE FROM users WHERE email = ?', [buyer.email]);
    db.close();

    // A brief with a NULL buyer matches no session, so no account inherits it.
    const other = await asBuyer();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/me/briefs/${brief.id}`,
      cookies: { token: other.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('who can see a brief', () => {
  const fetchAs = (slug: string, cookie?: string) =>
    app.inject({
      method: 'GET',
      url: `/api/briefs/${slug}`,
      ...(cookie ? { cookies: { token: cookie } } : {}),
    });

  const setVisibility = (cookie: string, id: number, visibility: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/me/briefs/${id}/visibility`,
      cookies: { token: cookie },
      payload: { visibility },
    });

  const invite = (cookie: string, id: number, email: string) =>
    app.inject({
      method: 'POST',
      url: `/api/me/briefs/${id}/invitees`,
      cookies: { token: cookie },
      payload: { email },
    });

  test('a brief is private and unpublished unless asked otherwise', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({ title: 'Unasked' });

    expect(brief.visibility).toBe('private');
    expect(brief.publishedAt).toBeNull();
    // The safe default matters more than the common one: a brief must never
    // become public because somebody omitted a field.
    expect((await fetchAs(brief.slug)).statusCode).toBe(404);
  });

  test('the owner always sees their own brief, published or not', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({ title: 'Mine' });

    const res = await fetchAs(brief.slug, buyer.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ isOwner: boolean }>().isOwner).toBe(true);
  });

  test('a link brief is readable by anyone but never listed', async () => {
    const location = uniqueLocation('LinkOnly');
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({
      title: 'Reachable But Unlisted',
      location,
      visibility: 'link',
      publish: true,
    });

    // Anonymous, with the URL: fine. That is what "unlisted" means, and the
    // buyer consented to it by not choosing private.
    expect((await fetchAs(brief.slug)).statusCode).toBe(200);

    const board = await app.inject({
      method: 'GET',
      url: `/api/briefs?location=${encodeURIComponent(location)}`,
    });
    expect(board.json<{ briefs: PublicBrief[] }>().briefs).toEqual([]);
  });

  test('a private brief is invisible to a signed-in stranger', async () => {
    const buyer = await asBuyer();
    const stranger = await asBuyer();
    const brief = await buyer.postBrief({
      title: 'Not For You',
      visibility: 'private',
      publish: true,
    });

    // 404, not 403 — indistinguishable from a brief that does not exist, or
    // the response itself confirms it is there.
    expect((await fetchAs(brief.slug, stranger.cookie)).statusCode).toBe(404);
    expect((await fetchAs(brief.slug)).statusCode).toBe(404);
  });

  test('an invitee sees a private brief, and a designer may be invited', async () => {
    const buyer = await asBuyer();
    const designer = await asDesigner('Invited Studio');
    const brief = await buyer.postBrief({
      title: 'For You Specifically',
      visibility: 'private',
      publish: true,
    });

    expect((await fetchAs(brief.slug, designer.cookie)).statusCode).toBe(404);

    const invited = await invite(buyer.cookie, brief.id, designer.email);
    expect(invited.statusCode).toBe(201);

    const res = await fetchAs(brief.slug, designer.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ isOwner: boolean }>().isOwner).toBe(false);
  });

  test('unpublishing hides the brief and KEEPS the invitee list', async () => {
    const buyer = await asBuyer();
    const guest = await asBuyer();
    const brief = await buyer.postBrief({
      title: 'Paused',
      visibility: 'private',
      publish: true,
    });
    await invite(buyer.cookie, brief.id, guest.email);
    expect((await fetchAs(brief.slug, guest.cookie)).statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/api/me/briefs/${brief.id}/unpublish`,
      cookies: { token: buyer.cookie },
    });

    // Hidden from the invitee too — unpublish has to mean something.
    expect((await fetchAs(brief.slug, guest.cookie)).statusCode).toBe(404);
    // But still hers on the way back: this is the whole reason invitees live
    // in their own table rather than as brief state.
    await app.inject({
      method: 'POST',
      url: `/api/me/briefs/${brief.id}/publish`,
      cookies: { token: buyer.cookie },
    });
    expect((await fetchAs(brief.slug, guest.cookie)).statusCode).toBe(200);
  });

  test('an uninvited guest loses access immediately', async () => {
    const buyer = await asBuyer();
    const guest = await asBuyer();
    const brief = await buyer.postBrief({
      title: 'Revoked',
      visibility: 'private',
      publish: true,
    });
    await invite(buyer.cookie, brief.id, guest.email);

    const invitees = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}/invitees`,
      cookies: { token: buyer.cookie },
    });
    const userId = invitees.json<{ invitees: Array<{ userId: number }> }>()
      .invitees[0].userId;

    await app.inject({
      method: 'DELETE',
      url: `/api/me/briefs/${brief.id}/invitees/${userId}`,
      cookies: { token: buyer.cookie },
    });

    expect((await fetchAs(brief.slug, guest.cookie)).statusCode).toBe(404);
  });

  test('changing visibility takes a brief off the board without unpublishing it', async () => {
    const location = uniqueLocation('Retracted');
    const { buyer, brief } = await openBrief({ location });

    const onBoard = async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/briefs?location=${encodeURIComponent(location)}`,
      });
      return res.json<{ briefs: PublicBrief[] }>().briefs.length;
    };
    expect(await onBoard()).toBe(1);

    await setVisibility(buyer.cookie, brief.id, 'private');

    expect(await onBoard()).toBe(0);
    // Still published — visibility and publication are orthogonal, and only
    // one of them changed.
    const mine = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}`,
      cookies: { token: buyer.cookie },
    });
    expect(mine.json<{ brief: OwnedBrief }>().brief.publishedAt).not.toBeNull();
  });

  test('inviting the same person twice is one invitation', async () => {
    const buyer = await asBuyer();
    const guest = await asBuyer();
    const brief = await buyer.postBrief({ visibility: 'private' });

    await invite(buyer.cookie, brief.id, guest.email);
    const second = await invite(buyer.cookie, brief.id, guest.email);

    expect(second.statusCode).toBe(201);
    expect(second.json<{ invitees: unknown[] }>().invitees).toHaveLength(1);
  });

  test('inviting someone with no account says so rather than silently dropping it', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({ visibility: 'private' });

    const res = await invite(buyer.cookie, brief.id, 'nobody@nowhere.test');
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toMatch(/account/i);
  });

  test('an old slug still resolves to the brief', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({
      title: 'Original Name',
      visibility: 'link',
      publish: true,
    });

    const db = await openDbConnection();
    db.run("UPDATE briefs SET slug = 'renamed-brief-slug' WHERE id = ?", [
      brief.id,
    ]);
    db.run(
      "INSERT INTO slugs (entity_type, entity_id, slug) VALUES ('brief', ?, 'renamed-brief-slug')",
      [brief.id],
    );
    db.close();

    // REQ-SLUG-001: the slug it started with keeps working.
    const res = await fetchAs(brief.slug);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ brief: PublicBrief }>().brief.slug).toBe(
      'renamed-brief-slug',
    );
  });
});
