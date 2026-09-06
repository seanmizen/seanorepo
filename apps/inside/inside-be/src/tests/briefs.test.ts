import { describe, expect, test } from 'bun:test';
import type {
  DesignerProfile,
  OwnedBrief,
  Pitch,
  PublicBrief,
  ReceivedPitch,
  SentPitch,
} from '@shared/types';
import { getApp, uniqueEmail } from './setup';

/**
 * Post-a-project: a buyer posts a brief, designers pitch on it.
 *
 * The suite shares one database with every other suite, so nothing here
 * assumes an empty table — every assertion is scoped to rows this file made,
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
  const brief = await buyer.postBrief({ status: 'open', ...payload });
  return { buyer, brief };
};

const pitch = (cookie: string, id: number, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/briefs/${id}/pitches`,
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
    expect(brief.status).toBe('draft');
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
    expect(brief.status).toBe('open');
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
      { projectType: 'spaceship' },
      { budgetBand: 'infinite' },
      { timeline: 'eventually' },
      { closesAt: 'next tuesday-ish' },
      { status: 'awarded' },
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
      url: `/api/briefs/${brief.id}`,
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
      status: 'open',
      location,
      projectType: 'kitchen',
      budgetBand: '10k_25k',
    });
    const bathroom = await buyer.postBrief({
      status: 'open',
      location,
      projectType: 'bathroom',
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
    expect(await ids('&projectType=kitchen')).toEqual([kitchen.id]);
    expect(await ids('&budgetBand=50k_100k')).toEqual([bathroom.id]);
    expect(await ids('&projectType=kitchen&budgetBand=50k_100k')).toEqual([]);
  });

  test('a malformed filter is rejected rather than ignored', async () => {
    for (const query of [
      'projectType=spaceship',
      'budgetBand=infinite',
      'limit=0',
      'limit=1000',
      'limit=abc',
      'offset=-1',
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
            status: 'open',
            location,
            title: `Page ${n}`,
          })
        ).id,
      );
    }

    const page = async (offset: number) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/briefs?location=${encodeURIComponent(location)}&limit=2&offset=${offset}`,
        })
      ).json<{ briefs: PublicBrief[]; total: number }>();

    const first = await page(0);
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
    const live = await buyer.postBrief({ status: 'open', title: 'Live One' });

    const hidden = await app.inject({
      method: 'GET',
      url: `/api/briefs/${draft.id}`,
    });
    expect(hidden.statusCode).toBe(404);

    const shown = await app.inject({
      method: 'GET',
      url: `/api/briefs/${live.id}`,
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
    expect(updated.status).toBe('open');
  });

  test('publishing a draft opens it, and publishing twice is refused', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({ title: 'To Publish' });

    const publish = () =>
      app.inject({
        method: 'POST',
        url: `/api/me/briefs/${brief.id}/publish`,
        cookies: { token: buyer.cookie },
      });

    const first = await publish();
    expect(first.json<{ brief: OwnedBrief }>().brief.status).toBe('open');
    expect(
      first.json<{ brief: OwnedBrief }>().brief.publishedAt,
    ).not.toBeNull();
    expect((await publish()).statusCode).toBe(409);
  });

  test('closing a brief takes it off the board, and closing twice is refused', async () => {
    const location = uniqueLocation('Closing');
    const { buyer, brief } = await openBrief({ location });

    const close = () =>
      app.inject({
        method: 'POST',
        url: `/api/me/briefs/${brief.id}/close`,
        cookies: { token: buyer.cookie },
      });

    expect((await close()).json<{ brief: OwnedBrief }>().brief.status).toBe(
      'closed',
    );
    expect((await close()).statusCode).toBe(409);

    const board = await app.inject({
      method: 'GET',
      url: `/api/briefs?location=${encodeURIComponent(location)}`,
    });
    expect(board.json<{ briefs: PublicBrief[] }>().briefs).toEqual([]);
  });

  test('a closed brief can be reopened, keeping its original published stamp', async () => {
    const { buyer, brief } = await openBrief();
    await app.inject({
      method: 'POST',
      url: `/api/me/briefs/${brief.id}/close`,
      cookies: { token: buyer.cookie },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/me/briefs/${brief.id}/publish`,
      cookies: { token: buyer.cookie },
    });
    const reopened = res.json<{ brief: OwnedBrief }>().brief;
    expect(reopened.status).toBe('open');
    expect(reopened.publishedAt).toBe(brief.publishedAt);
  });

  test('deleting a brief removes it and its pitches', async () => {
    const { buyer, brief } = await openBrief();
    const designer = await asDesigner('Doomed Pitch Studio');
    await pitch(designer.cookie, brief.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/me/briefs/${brief.id}`,
      cookies: { token: buyer.cookie },
    });
    expect(res.statusCode).toBe(204);

    const gone = await app.inject({
      method: 'GET',
      url: `/api/briefs/${brief.id}`,
    });
    expect(gone.statusCode).toBe(404);

    const db = await openDbConnection();
    const left = db
      .query('SELECT COUNT(*) AS n FROM pitches WHERE brief_id = ?')
      .get(brief.id) as { n: number };
    db.close();
    expect(left.n).toBe(0);
  });
});

describe('pitching', () => {
  test('an approved designer can pitch, and the count shows on the board', async () => {
    const { brief } = await openBrief();
    const designer = await asDesigner('Keen Studio');

    const res = await pitch(designer.cookie, brief.id, {
      budgetBand: '25k_50k',
      availability: 'within_3_months',
    });
    expect(res.statusCode).toBe(201);

    const created = res.json<{ pitch: Pitch }>().pitch;
    expect(created.briefId).toBe(brief.id);
    expect(created.designerProfileId).toBe(designer.profile.id);
    expect(created.status).toBe('sent');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/briefs/${brief.id}`,
    });
    expect(detail.json<{ brief: PublicBrief }>().brief.pitchCount).toBe(1);
  });

  test('the same designer cannot pitch the same brief twice', async () => {
    const { brief } = await openBrief();
    const designer = await asDesigner('Twice Studio');

    expect((await pitch(designer.cookie, brief.id)).statusCode).toBe(201);

    const again = await pitch(designer.cookie, brief.id, {
      message: 'Actually, we would love it even more',
    });
    // The schema's UNIQUE constraint, surfaced as a conflict rather than a 500.
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: string }>().error).not.toContain('UNIQUE');
    expect(again.json<{ error: string }>().error).not.toContain('SQLITE');

    const db = await openDbConnection();
    const count = db
      .query('SELECT COUNT(*) AS n FROM pitches WHERE brief_id = ?')
      .get(brief.id) as { n: number };
    db.close();
    expect(count.n).toBe(1);
  });

  test('a race between two identical pitches still resolves to one 409', async () => {
    const { brief } = await openBrief();
    const designer = await asDesigner('Racing Studio');

    // Both requests pass the "already pitched?" check before either inserts,
    // so the loser is caught by the UNIQUE constraint rather than the lookup.
    const [a, b] = await Promise.all([
      pitch(designer.cookie, brief.id),
      pitch(designer.cookie, brief.id),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  });

  test('a designer whose profile is not approved cannot pitch', async () => {
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

      const res = await pitch(designer.cookie, brief.id);
      // The approval gate is the entire point of the review queue.
      expect(res.statusCode).toBe(403);
    }

    const db = await openDbConnection();
    const count = db
      .query('SELECT COUNT(*) AS n FROM pitches WHERE brief_id = ?')
      .get(brief.id) as { n: number };
    db.close();
    expect(count.n).toBe(0);
  });

  test('a designer with no profile at all cannot pitch', async () => {
    const { brief } = await openBrief();
    const { cookie } = await login('designer');
    expect((await pitch(cookie, brief.id)).statusCode).toBe(403);
  });

  test('a buyer cannot pitch', async () => {
    const { brief } = await openBrief();
    const buyer = await asBuyer();
    expect((await pitch(buyer.cookie, brief.id)).statusCode).toBe(403);
  });

  test('an anonymous caller cannot pitch', async () => {
    const { brief } = await openBrief();
    const res = await app.inject({
      method: 'POST',
      url: `/api/briefs/${brief.id}/pitches`,
      payload: { message: 'Hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('a closed, awarded or draft brief takes no new pitches', async () => {
    const buyer = await asBuyer();
    const designer = await asDesigner('Too Late Studio');

    const draft = await buyer.postBrief({ title: 'Unpublished' });
    // A draft is not on the board, so it must read as missing.
    expect((await pitch(designer.cookie, draft.id)).statusCode).toBe(404);

    for (const status of ['closed', 'awarded'] as const) {
      const brief = await buyer.postBrief({ status: 'open' });
      const db = await openDbConnection();
      db.run('UPDATE briefs SET status = ? WHERE id = ?', [status, brief.id]);
      db.close();

      const res = await pitch(designer.cookie, brief.id);
      expect(res.statusCode).toBe(409);
    }
  });

  test('a brief past its closing date takes no new pitches', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({
      status: 'open',
      closesAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const designer = await asDesigner('Deadline Studio');
    expect((await pitch(designer.cookie, brief.id)).statusCode).toBe(409);
  });

  test('a future closing date still takes pitches', async () => {
    const buyer = await asBuyer();
    const brief = await buyer.postBrief({
      status: 'open',
      closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const designer = await asDesigner('In Time Studio');
    expect((await pitch(designer.cookie, brief.id)).statusCode).toBe(201);
  });

  test('a brief that does not exist 404s', async () => {
    const designer = await asDesigner('Ghost Brief Studio');
    expect((await pitch(designer.cookie, 99999999)).statusCode).toBe(404);
  });

  test('a pitch needs a message, and its enums are checked', async () => {
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
        url: `/api/briefs/${brief.id}/pitches`,
        cookies: { token: designer.cookie },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('who can see a pitch', () => {
  /** A brief with one pitch on it, plus the cast of characters around it. */
  async function briefWithPitch() {
    const { buyer, brief } = await openBrief();
    const designer = await asDesigner('Visible Studio');
    const created = await pitch(designer.cookie, brief.id, {
      message: 'A very private pitch',
    });
    return {
      buyer,
      brief,
      designer,
      pitch: created.json<{ pitch: Pitch }>().pitch,
    };
  }

  test('the brief owner sees the pitches received, with the designer', async () => {
    const { buyer, brief, designer } = await briefWithPitch();
    const res = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}/pitches`,
      cookies: { token: buyer.cookie },
    });
    const received = res.json<{ pitches: ReceivedPitch[] }>().pitches;
    expect(received).toHaveLength(1);
    expect(received[0].message).toBe('A very private pitch');
    expect(received[0].designer.slug).toBe(designer.profile.slug);
  });

  test('the pitching designer sees their own pitch and the brief', async () => {
    const { brief, designer } = await briefWithPitch();
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/pitches',
      cookies: { token: designer.cookie },
    });
    const sent = res.json<{ pitches: SentPitch[] }>().pitches;
    expect(sent.map((p) => p.briefId)).toEqual([brief.id]);
    // Even here, the brief carries no route back to the buyer.
    expect(sent[0].brief).not.toHaveProperty('buyerId');
  });

  test('another buyer cannot see the pitches on a brief', async () => {
    const { brief } = await briefWithPitch();
    const stranger = await asBuyer();
    const res = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}/pitches`,
      cookies: { token: stranger.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  test('another designer sees neither the pitch nor the route to it', async () => {
    const { brief } = await briefWithPitch();
    const rival = await asDesigner('Nosy Studio');

    // The buyer's inbox is a buyer-only route, so a designer is refused outright.
    const inbox = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}/pitches`,
      cookies: { token: rival.cookie },
    });
    expect(inbox.statusCode).toBe(403);

    // And their own list contains only their own work: none.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/me/pitches',
      cookies: { token: rival.cookie },
    });
    expect(mine.json<{ pitches: SentPitch[] }>().pitches).toEqual([]);
  });

  test('an anonymous caller sees no pitch content anywhere public', async () => {
    const { brief } = await briefWithPitch();

    const inbox = await app.inject({
      method: 'GET',
      url: `/api/me/briefs/${brief.id}/pitches`,
    });
    expect(inbox.statusCode).toBe(401);

    const mine = await app.inject({ method: 'GET', url: '/api/me/pitches' });
    expect(mine.statusCode).toBe(401);

    // The public detail exposes the count and nothing else.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/briefs/${brief.id}`,
    });
    expect(detail.body).not.toContain('A very private pitch');
    expect(detail.json<{ brief: PublicBrief }>().brief.pitchCount).toBe(1);
  });

  test('a designer with no profile has no pitch list', async () => {
    const { cookie } = await login('designer');
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/pitches',
      cookies: { token: cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('a deleted buyer account', () => {
  test('leaves the brief and its pitches intact with a null buyer', async () => {
    const location = uniqueLocation('Orphaned');
    const { buyer, brief } = await openBrief({
      location,
      title: 'Outlives Its Author',
    });
    const designer = await asDesigner('Loyal Studio');
    const created = await pitch(designer.cookie, brief.id);
    expect(created.statusCode).toBe(201);

    // Deleting the account. `buyer_id` is SET NULL rather than CASCADE, so an
    // open brief with live pitches must not vanish from under the designers
    // who responded to it.
    const db = await openDbConnection();
    db.run('DELETE FROM users WHERE email = ?', [buyer.email]);
    const row = db
      .query('SELECT buyer_id FROM briefs WHERE id = ?')
      .get(brief.id) as { buyer_id: number | null } | null;
    const pitches = db
      .query('SELECT COUNT(*) AS n FROM pitches WHERE brief_id = ?')
      .get(brief.id) as { n: number };
    db.close();

    expect(row).not.toBeNull();
    expect(row?.buyer_id).toBeNull();
    expect(pitches.n).toBe(1);

    // Still on the board, and still readable.
    const board = await app.inject({
      method: 'GET',
      url: `/api/briefs?location=${encodeURIComponent(location)}`,
    });
    expect(
      board.json<{ briefs: PublicBrief[] }>().briefs.map((b) => b.id),
    ).toEqual([brief.id]);

    // And the designer still has their pitch, with the brief attached.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/me/pitches',
      cookies: { token: designer.cookie },
    });
    const sent = mine.json<{ pitches: SentPitch[] }>().pitches;
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
