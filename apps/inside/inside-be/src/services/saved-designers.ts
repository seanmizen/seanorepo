import type { DesignerListItem } from '@shared/types';
import { openDbConnection } from './db';
import { countPublishedProjects, resolveCoverImageIds } from './discovery';
import { findStoredImages } from './image-library';

/**
 * The buyer's shortlist — `saved_designers`. REQ-PRODUCT-003: saving a
 * designer is the point of value a signed-out visitor is asked to sign up
 * for, so this is the mechanism behind that CTA.
 *
 * Ownership is never a request parameter. Every function here takes the
 * caller's own `userId` from the session (see `controllers/saved-designers.ts`),
 * so there is no argument shape that could save or unsave on behalf of
 * someone else — the pending-save intent the frontend carries through signup
 * (`pending-save.ts`) only ever names WHICH designer, never WHO for.
 */

/**
 * An approved designer's id, or null.
 *
 * Same paranoia as `findApprovedProfileBySlug`: an unapproved profile must be
 * indistinguishable from one that does not exist, or a buyer's save requests
 * become a way to probe the approval queue for ids that exist but are not yet
 * listed.
 */
export async function findApprovedProfileId(
  id: number,
): Promise<number | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query(
        "SELECT id FROM designer_profiles WHERE id = ? AND status = 'approved'",
      )
      .get(id) as { id: number } | null;
    return row ? row.id : null;
  } finally {
    db.close();
  }
}

/**
 * Save a designer for a buyer. Idempotent by construction: the schema's
 * UNIQUE (user_id, designer_profile_id) pair means a duplicate save is
 * silently ignored and still answers success, never a 500. Same pattern as
 * `slugs.ts` and `briefs.ts` (`brief_invitees`).
 */
export async function saveDesigner(
  userId: number,
  designerProfileId: number,
): Promise<void> {
  const db = await openDbConnection();
  try {
    db.query(
      'INSERT OR IGNORE INTO saved_designers (user_id, designer_profile_id) VALUES (?, ?)',
    ).run(userId, designerProfileId);
  } finally {
    db.close();
  }
}

/** Idempotent too: removing something already absent is still success. */
export async function unsaveDesigner(
  userId: number,
  designerProfileId: number,
): Promise<void> {
  const db = await openDbConnection();
  try {
    db.query(
      'DELETE FROM saved_designers WHERE user_id = ? AND designer_profile_id = ?',
    ).run(userId, designerProfileId);
  } finally {
    db.close();
  }
}

export async function isSaved(
  userId: number,
  designerProfileId: number,
): Promise<boolean> {
  const db = await openDbConnection();
  try {
    const row = db
      .query(
        'SELECT 1 FROM saved_designers WHERE user_id = ? AND designer_profile_id = ?',
      )
      .get(userId, designerProfileId);
    return row !== null;
  } finally {
    db.close();
  }
}

interface SavedRow {
  designer_profile_id: number;
  saved_at: string;
  slug: string;
  studio_name: string;
  headline: string | null;
  location: string | null;
  budget_band: DesignerListItem['budgetBand'];
  availability: DesignerListItem['availability'];
  cover_image_id: number | null;
  created_at: string;
}

export interface SavedDesignerItem extends DesignerListItem {
  savedAt: string;
}

/**
 * The buyer's shortlist, paginated, newest save first.
 *
 * `saved_designers.designer_profile_id` is `ON DELETE CASCADE`, so this join
 * can never dangle — a deleted profile takes its saves with it. A designer
 * who is later UNAPPROVED (not deleted) is deliberately left on the
 * shortlist: silently dropping it would be data loss the buyer never asked
 * for. Their profile link will 404 like any other unapproved slug
 * (`findApprovedProfileBySlug`). That is an honest answer, not a bug.
 */
export async function listSavedDesigners(
  userId: number,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ items: SavedDesignerItem[]; total: number }> {
  const db = await openDbConnection();
  let rows: SavedRow[];
  let total: number;
  try {
    total = (
      db
        .query('SELECT COUNT(*) AS c FROM saved_designers WHERE user_id = ?')
        .get(userId) as { c: number }
    ).c;

    rows = db
      .query(
        `SELECT sd.designer_profile_id, sd.created_at AS saved_at,
                p.slug, p.studio_name, p.headline, p.location,
                p.budget_band, p.availability, p.cover_image_id, p.created_at
         FROM saved_designers sd
         JOIN designer_profiles p ON p.id = sd.designer_profile_id
         WHERE sd.user_id = ?
         ORDER BY sd.created_at DESC, sd.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as SavedRow[];
  } finally {
    db.close();
  }

  if (rows.length === 0) return { items: [], total };

  const [covers, counts] = await Promise.all([
    resolveCoverImageIds(
      rows.map((r) => ({
        id: r.designer_profile_id,
        cover_image_id: r.cover_image_id,
      })),
    ),
    countPublishedProjects(rows.map((r) => r.designer_profile_id)),
  ]);
  const images = await findStoredImages([...covers.values()]);

  return {
    items: rows.map((row) => {
      const coverImageId = covers.get(row.designer_profile_id);
      return {
        id: row.designer_profile_id,
        slug: row.slug,
        studioName: row.studio_name,
        headline: row.headline,
        location: row.location,
        budgetBand: row.budget_band,
        availability: row.availability,
        projectCount: counts.get(row.designer_profile_id) ?? 0,
        coverImage:
          coverImageId === undefined
            ? null
            : (images.get(coverImageId) ?? null),
        createdAt: row.created_at,
        savedAt: row.saved_at,
      };
    }),
    total,
  };
}
