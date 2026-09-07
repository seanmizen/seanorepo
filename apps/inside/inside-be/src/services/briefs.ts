import type {
  Bid,
  Brief,
  BriefInvitee,
  BriefVisibility,
  OwnedBrief,
  PublicBrief,
  ReceivedBid,
  SentBid,
} from '@shared/types';
import { openDbConnection } from './db';
import { chooseSlug, claimSlug, recordSlug, resolveSlug } from './slugs';
import { sqliteNow } from './validation';

/**
 * Post-a-project data access.
 *
 * `briefs` are homeowners' posted jobs and `bids` are designers' responses
 * to them — neither is a portfolio `project`, which lives in `designers.ts`.
 */

/** Raw column shapes, mapped to the camelCase shared types below. */
interface BriefRow {
  id: number;
  buyer_id: number | null;
  slug: string;
  title: string;
  description: string;
  work_type: Brief['workType'];
  budget_band: Brief['budgetBand'];
  location: string | null;
  timeline: Brief['timeline'];
  visibility: BriefVisibility;
  closes_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

type CountedBriefRow = BriefRow & { bid_count: number };

interface BidRow {
  id: number;
  brief_id: number;
  designer_profile_id: number;
  message: string;
  budget_band: Bid['budgetBand'];
  availability: Bid['availability'];
  status: Bid['status'];
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

type BidWithDesignerRow = BidRow & {
  designer_slug: string;
  designer_studio_name: string;
  designer_headline: string | null;
  designer_location: string | null;
  designer_budget_band: Bid['budgetBand'];
};

const toBrief = (r: BriefRow): Brief => ({
  id: r.id,
  buyerId: r.buyer_id,
  slug: r.slug,
  title: r.title,
  description: r.description,
  workType: r.work_type,
  budgetBand: r.budget_band,
  location: r.location,
  timeline: r.timeline,
  visibility: r.visibility,
  closesAt: r.closes_at,
  publishedAt: r.published_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toOwnedBrief = (r: CountedBriefRow): OwnedBrief => ({
  ...toBrief(r),
  bidCount: r.bid_count,
});

/**
 * Drops `buyerId` on the way out — the public board never carries it.
 *
 * Built field by field rather than by deleting from a spread, so a column
 * added to `Brief` later is not published by accident.
 */
const toPublicBrief = (r: CountedBriefRow): PublicBrief => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  description: r.description,
  workType: r.work_type,
  budgetBand: r.budget_band,
  location: r.location,
  timeline: r.timeline,
  visibility: r.visibility,
  closesAt: r.closes_at,
  publishedAt: r.published_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  bidCount: r.bid_count,
});

const toBid = (r: BidRow): Bid => ({
  id: r.id,
  briefId: r.brief_id,
  designerProfileId: r.designer_profile_id,
  message: r.message,
  budgetBand: r.budget_band,
  availability: r.availability,
  status: r.status,
  submittedAt: r.submitted_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toReceivedBid = (r: BidWithDesignerRow): ReceivedBid => ({
  ...toBid(r),
  designer: {
    id: r.designer_profile_id,
    slug: r.designer_slug,
    studioName: r.designer_studio_name,
    headline: r.designer_headline,
    location: r.designer_location,
    budgetBand: r.designer_budget_band,
  },
});

/**
 * The bid count, as a correlated subquery so one round trip serves a list.
 *
 * Drafts are excluded: a bid nobody has sent is not a bid, and counting them
 * would tell a buyer they have interest they cannot see, and tell a designer
 * the board is busier than it is.
 */
const BID_COUNT =
  "(SELECT COUNT(*) FROM bids WHERE brief_id = b.id AND status = 'submitted')";

/** `%` and `_` are wildcards; a location typed with one must match literally. */
const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, (char) => `\\${char}`);

export interface BriefFilters {
  workTypes?: readonly string[] | null;
  budgetBands?: readonly string[] | null;
  location?: string | null;
  limit: number;
  offset: number;
}

/**
 * The public board: open briefs only, newest first.
 *
 * `id` is the tie-breaker because `created_at` has one-second resolution, so
 * without it two briefs posted in the same second could swap places between
 * pages and be served twice or never.
 */
export async function listOpenBriefs(
  filters: BriefFilters,
): Promise<{ briefs: PublicBrief[]; total: number }> {
  // REQ-BRIEF-002. Two conditions, because they are two different questions:
  // `public` is who may ever see it, `published_at` is whether they can now.
  // A `link` or `private` brief must never reach a listing, whatever its
  // publication state.
  const clauses = [
    "b.visibility = 'public'",
    'b.published_at IS NOT NULL',
    // Past its close date is off the board. Closing stops the invitation to
    // bid, so a listing nobody may answer has no business on a board of
    // things to answer — this is what the old `closed` status did, preserved.
    '(b.closes_at IS NULL OR b.closes_at > ?)',
  ];
  const boardParams: string[] = [sqliteNow()];
  const params: Array<string | number> = [...boardParams];

  // OR within a facet, AND across facets — what a filter panel implies.
  const placeholders = (values: readonly unknown[]) =>
    values.map(() => '?').join(', ');

  if (filters.workTypes?.length) {
    clauses.push(`b.work_type IN (${placeholders(filters.workTypes)})`);
    params.push(...filters.workTypes);
  }
  if (filters.budgetBands?.length) {
    clauses.push(`b.budget_band IN (${placeholders(filters.budgetBands)})`);
    params.push(...filters.budgetBands);
  }
  if (filters.location) {
    clauses.push("b.location LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(filters.location)}%`);
  }

  const where = clauses.join(' AND ');
  const db = await openDbConnection();
  try {
    const total = (
      db
        .query(`SELECT COUNT(*) AS n FROM briefs b WHERE ${where}`)
        .get(...params) as { n: number }
    ).n;

    const rows = db
      .query(
        `SELECT b.*, ${BID_COUNT} AS bid_count FROM briefs b
         WHERE ${where}
         ORDER BY b.created_at DESC, b.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filters.limit, filters.offset) as CountedBriefRow[];

    return { briefs: rows.map(toPublicBrief), total };
  } finally {
    db.close();
  }
}

/**
 * Public detail for one brief.
 *
 * A `draft` is nobody's business but its author's, so it reads as missing.
 * Closed briefs stay readable: designers who bid must still be
 * able to see what they answered.
 */
/**
 * A brief as a given viewer may see it, addressed by any slug it has held.
 *
 * REQ-BRIEF-001 — the whole access model, in one place so no caller can
 * assemble a different version of it:
 *
 *   owner                       -> always, published or not
 *   published + public          -> anyone
 *   published + link            -> anyone who reaches the URL
 *   published + private         -> users on the invitee list
 *   unpublished, not the owner  -> null, invitee or otherwise
 *
 * Returns null for "you may not see this" and for "this does not exist"
 * alike. That is deliberate: a private brief that 404s differently from a
 * missing one tells an unauthorised viewer it is there.
 *
 * `viewerId` is null for an anonymous visitor, which is a first-class case —
 * the public board is readable without an account (REQ-PRODUCT-001).
 */
export async function findVisibleBrief(
  slug: string,
  viewerId: number | null,
): Promise<{ brief: PublicBrief; isOwner: boolean } | null> {
  const resolved = await resolveSlug('brief', slug);
  if (!resolved) return null;

  const db = await openDbConnection();
  try {
    const row = db
      .query(
        `SELECT b.*, ${BID_COUNT} AS bid_count FROM briefs b WHERE b.id = ?`,
      )
      .get(resolved.entityId) as CountedBriefRow | null;
    if (!row) return null;

    const isOwner = viewerId !== null && row.buyer_id === viewerId;
    if (isOwner) return { brief: toPublicBrief(row), isOwner };

    // Unpublished is invisible to everyone else, whatever the visibility says
    // and whoever is on the invitee list. Unpublishing has to actually hide it,
    // or the switch means nothing.
    if (row.published_at === null) return null;

    if (row.visibility === 'private') {
      if (viewerId === null) return null;
      const invited = db
        .query(
          'SELECT 1 FROM brief_invitees WHERE brief_id = ? AND user_id = ?',
        )
        .get(row.id, viewerId);
      if (!invited) return null;
    }

    return { brief: toPublicBrief(row), isOwner: false };
  } finally {
    db.close();
  }
}

/** The raw row, `buyerId` included. Callers must check ownership themselves. */
export async function findBrief(id: number): Promise<Brief | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query('SELECT * FROM briefs WHERE id = ?')
      .get(id) as BriefRow | null;
    return row ? toBrief(row) : null;
  } finally {
    db.close();
  }
}

export async function findOwnedBrief(id: number): Promise<OwnedBrief | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query(
        `SELECT b.*, ${BID_COUNT} AS bid_count FROM briefs b WHERE b.id = ?`,
      )
      .get(id) as CountedBriefRow | null;
    return row ? toOwnedBrief(row) : null;
  } finally {
    db.close();
  }
}

/** Every brief a buyer has posted, whatever its status. */
export async function listBriefsByBuyer(
  buyerId: number,
): Promise<OwnedBrief[]> {
  const db = await openDbConnection();
  try {
    return (
      db
        .query(
          `SELECT b.*, ${BID_COUNT} AS bid_count FROM briefs b
           WHERE b.buyer_id = ?
           ORDER BY b.created_at DESC, b.id DESC`,
        )
        .all(buyerId) as CountedBriefRow[]
    ).map(toOwnedBrief);
  } finally {
    db.close();
  }
}

export interface BriefFields {
  title: string;
  description: string;
  workType: string | null;
  budgetBand: string | null;
  location: string | null;
  timeline: string | null;
  closesAt: string | null;
}

/** `published_at` is stamped the moment a brief first goes `open`. */
export async function insertBrief(
  buyerId: number,
  fields: BriefFields,
  visibility: BriefVisibility,
  { publish = false }: { publish?: boolean } = {},
): Promise<OwnedBrief> {
  // Chosen before the insert, because the row is created with it (REQ-SLUG-002),
  // and recorded into history after, once there is an id to bind it to.
  const slug = await chooseSlug('brief', fields.title);

  const db = await openDbConnection();
  let id: number;
  try {
    db.run(
      `INSERT INTO briefs
        (buyer_id, title, description, work_type, budget_band, location,
         timeline, visibility, closes_at, published_at, slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        buyerId,
        fields.title,
        fields.description,
        fields.workType,
        fields.budgetBand,
        fields.location,
        fields.timeline,
        visibility,
        fields.closesAt,
        publish ? sqliteNow() : null,
        slug,
      ],
    );
    id = (db.query('SELECT last_insert_rowid() AS id').get() as { id: number })
      .id;
    const row = db
      .query(
        `SELECT b.*, ${BID_COUNT} AS bid_count FROM briefs b WHERE b.id = ?`,
      )
      .get(id) as CountedBriefRow;
    db.close();
    await recordSlug('brief', id, slug);
    return toOwnedBrief(row);
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Content edits only. Status moves through `setBriefStatus` so that publishing
 * and closing — the transitions that decide whether bids are accepted —
 * cannot happen as a side effect of a typo fix.
 */
export async function updateBrief(
  id: number,
  fields: BriefFields,
): Promise<OwnedBrief> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE briefs SET
         title = ?, description = ?, work_type = ?, budget_band = ?,
         location = ?, timeline = ?, closes_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        fields.title,
        fields.description,
        fields.workType,
        fields.budgetBand,
        fields.location,
        fields.timeline,
        fields.closesAt,
        id,
      ],
    );
    return (await findOwnedBrief(id)) as OwnedBrief;
  } finally {
    db.close();
  }
}

/**
 * Publish or unpublish. REQ-BRIEF-003.
 *
 * Unpublishing clears `published_at` and touches nothing else — in particular
 * it does NOT clear the invitee list, so republishing restores access to
 * exactly the same people without re-inviting anyone. That is the whole reason
 * invitees live in their own table rather than as brief state.
 *
 * Publishing re-stamps rather than COALESCEing, because with unpublish in the
 * model `published_at` is the current publication, not a first-ever milestone.
 */
export async function setBriefPublished(
  id: number,
  published: boolean,
): Promise<OwnedBrief> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE briefs SET published_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [published ? sqliteNow() : null, id],
    );
  } finally {
    db.close();
  }
  return (await findOwnedBrief(id)) as OwnedBrief;
}

/** Change who may ever see a brief. Orthogonal to whether it is published. */
export async function setBriefVisibility(
  id: number,
  visibility: BriefVisibility,
): Promise<OwnedBrief> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE briefs SET visibility = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [visibility, id],
    );
  } finally {
    db.close();
  }
  return (await findOwnedBrief(id)) as OwnedBrief;
}

/** Stop accepting bids now, without hiding the brief from anyone. */
export async function closeBriefToBids(id: number): Promise<OwnedBrief> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE briefs SET closes_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [sqliteNow(), id],
    );
  } finally {
    db.close();
  }
  return (await findOwnedBrief(id)) as OwnedBrief;
}

/** A brief accepts bids while it is published and not past its close date. */
export const acceptsBids = (brief: Brief): boolean =>
  brief.publishedAt !== null &&
  (brief.closesAt === null || brief.closesAt > sqliteNow());

/* ------------------------------------------------------------------ *
 * Invitees — who may see a private brief
 * ------------------------------------------------------------------ */

export async function listInvitees(briefId: number): Promise<BriefInvitee[]> {
  const db = await openDbConnection();
  try {
    return (
      db
        .query(
          `SELECT * FROM brief_invitees WHERE brief_id = ?
           ORDER BY invited_at ASC, id ASC`,
        )
        .all(briefId) as Array<{
        id: number;
        brief_id: number;
        user_id: number;
        invited_at: string;
      }>
    ).map((r) => ({
      id: r.id,
      briefId: r.brief_id,
      userId: r.user_id,
      invitedAt: r.invited_at,
    }));
  } finally {
    db.close();
  }
}

/** Idempotent: inviting the same person twice is one invitation, not two. */
export async function inviteToBrief(
  briefId: number,
  userId: number,
): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run(
      'INSERT OR IGNORE INTO brief_invitees (brief_id, user_id) VALUES (?, ?)',
      [briefId, userId],
    );
  } finally {
    db.close();
  }
}

export async function uninviteFromBrief(
  briefId: number,
  userId: number,
): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run('DELETE FROM brief_invitees WHERE brief_id = ? AND user_id = ?', [
      briefId,
      userId,
    ]);
  } finally {
    db.close();
  }
}

/** Rename a brief's public slug, keeping every old one alive (REQ-SLUG-001). */
export async function renameBriefSlug(
  id: number,
  desired: string,
): Promise<OwnedBrief> {
  const slug = await claimSlug('brief', id, desired, { custom: true });
  const db = await openDbConnection();
  try {
    db.run(
      "UPDATE briefs SET slug = ?, updated_at = datetime('now') WHERE id = ?",
      [slug, id],
    );
  } finally {
    db.close();
  }
  return (await findOwnedBrief(id)) as OwnedBrief;
}

export async function deleteBrief(id: number): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run('DELETE FROM briefs WHERE id = ?', [id]);
  } finally {
    db.close();
  }
}

const BID_WITH_DESIGNER = `SELECT p.*,
    d.slug AS designer_slug,
    d.studio_name AS designer_studio_name,
    d.headline AS designer_headline,
    d.location AS designer_location,
    d.budget_band AS designer_budget_band
  FROM bids p
  JOIN designer_profiles d ON d.id = p.designer_profile_id`;

/**
 * Every bid on one brief.
 *
 * Served only to that brief's owner — the caller proves ownership before
 * calling, because this returns identifying detail about every designer who
 * responded.
 */
export async function listBidsForBrief(
  briefId: number,
): Promise<ReceivedBid[]> {
  const db = await openDbConnection();
  try {
    return (
      db
        .query(
          `${BID_WITH_DESIGNER}
           WHERE p.brief_id = ?
           ORDER BY p.created_at DESC, p.id DESC`,
        )
        .all(briefId) as BidWithDesignerRow[]
    ).map(toReceivedBid);
  } finally {
    db.close();
  }
}

/** A designer's own bids, each with the brief it answers. */
export async function listBidsByDesigner(
  designerProfileId: number,
): Promise<SentBid[]> {
  const db = await openDbConnection();
  try {
    const bids = db
      .query(
        `SELECT * FROM bids WHERE designer_profile_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(designerProfileId) as BidRow[];

    const briefQuery = db.query(
      `SELECT b.*, ${BID_COUNT} AS bid_count FROM briefs b WHERE b.id = ?`,
    );

    return bids.map((row) => ({
      ...toBid(row),
      // The FK is NOT NULL and cascades, so the brief always exists here.
      brief: toPublicBrief(briefQuery.get(row.brief_id) as CountedBriefRow),
    }));
  } finally {
    db.close();
  }
}

export async function findBid(
  briefId: number,
  designerProfileId: number,
): Promise<Bid | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query(
        'SELECT * FROM bids WHERE brief_id = ? AND designer_profile_id = ?',
      )
      .get(briefId, designerProfileId) as BidRow | null;
    return row ? toBid(row) : null;
  } finally {
    db.close();
  }
}

export interface BidFields {
  message: string;
  budgetBand: string | null;
  availability: string | null;
}

export async function insertBid(
  briefId: number,
  designerProfileId: number,
  fields: BidFields,
): Promise<Bid> {
  const db = await openDbConnection();
  try {
    db.run(
      `INSERT INTO bids
        (brief_id, designer_profile_id, message, budget_band, availability)
       VALUES (?, ?, ?, ?, ?)`,
      [
        briefId,
        designerProfileId,
        fields.message,
        fields.budgetBand,
        fields.availability,
      ],
    );
    const row = db
      .query(
        'SELECT * FROM bids WHERE brief_id = ? AND designer_profile_id = ?',
      )
      .get(briefId, designerProfileId) as BidRow;
    return toBid(row);
  } finally {
    db.close();
  }
}

/**
 * True when the database refused a write because of the
 * `UNIQUE (brief_id, designer_profile_id)` constraint.
 *
 * The pre-check for an existing bid handles the ordinary case; this catches
 * the race between two concurrent submissions, which would otherwise surface
 * as a 500 with raw SQLite text in it.
 */
export function isDuplicateBidError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code ?? '';
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    /UNIQUE constraint failed:\s*bids/i.test(message)
  );
}

/** One bid by id, regardless of owner. Callers check ownership. */
export async function findBidById(id: number): Promise<Bid | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query('SELECT * FROM bids WHERE id = ?')
      .get(id) as BidRow | null;
    return row ? toBid(row) : null;
  } finally {
    db.close();
  }
}

/** Edit a draft bid in place. */
export async function updateBid(id: number, fields: BidFields): Promise<Bid> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE bids
          SET message = ?, budget_band = ?, availability = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [fields.message, fields.budgetBand, fields.availability, id],
    );
    return toBid(db.query('SELECT * FROM bids WHERE id = ?').get(id) as BidRow);
  } finally {
    db.close();
  }
}

/**
 * Send a draft bid.
 *
 * The status guard is in the WHERE clause as well as the caller, so two
 * concurrent submits cannot both stamp a submitted_at.
 */
export async function submitBid(id: number): Promise<Bid> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE bids
          SET status = 'submitted', submitted_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ? AND status = 'draft'`,
      [id],
    );
    return toBid(db.query('SELECT * FROM bids WHERE id = ?').get(id) as BidRow);
  } finally {
    db.close();
  }
}
