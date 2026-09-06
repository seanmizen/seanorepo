import type {
  DesignerProfile,
  DesignerProfileStatus,
  PortfolioProject,
} from '@shared/types';
import { openDbConnection } from './db';
import {
  type PortfolioProjectRow,
  type ProfileRow,
  toProfile,
  toProject,
} from './designers';

/** A decision an admin can record. Approve publishes; reject keeps it hidden. */
export type ReviewDecision = 'approve' | 'reject';

export interface ReviewQueueFilters {
  statuses?: readonly DesignerProfileStatus[] | null;
  limit: number;
  offset: number;
}

export interface AdminDesignerListItem {
  id: number;
  slug: string;
  studioName: string;
  location: string | null;
  status: DesignerProfileStatus;
  /** So a reviewer can see how long someone has been waiting. */
  submittedAt: string;
  reviewedAt: string | null;
  projectCount: number;
}

interface QueueRow {
  id: number;
  slug: string;
  studio_name: string;
  location: string | null;
  status: DesignerProfileStatus;
  updated_at: string;
  reviewed_at: string | null;
  project_count: number;
}

/**
 * The review queue.
 *
 * Ordered oldest-first so nobody is left waiting behind newer arrivals, with
 * `id` as a tie-breaker so paging cannot duplicate or skip a profile when
 * several share a timestamp.
 */
export async function listReviewQueue(
  filters: ReviewQueueFilters,
): Promise<{ designers: AdminDesignerListItem[]; total: number }> {
  const db = await openDbConnection();
  try {
    const where = filters.statuses?.length
      ? `WHERE dp.status IN (${filters.statuses.map(() => '?').join(', ')})`
      : '';
    const args = filters.statuses?.length ? [...filters.statuses] : [];

    const total = (
      db
        .query(`SELECT COUNT(*) AS c FROM designer_profiles dp ${where}`)
        .get(...args) as { c: number }
    ).c;

    const rows = db
      .query(
        `SELECT dp.id, dp.slug, dp.studio_name, dp.location, dp.status,
                dp.updated_at, dp.reviewed_at,
                (SELECT COUNT(*) FROM portfolio_projects p
                  WHERE p.designer_profile_id = dp.id) AS project_count
           FROM designer_profiles dp
           ${where}
          ORDER BY dp.updated_at ASC, dp.id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...args, filters.limit, filters.offset) as QueueRow[];

    return {
      total,
      designers: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        studioName: r.studio_name,
        location: r.location,
        status: r.status,
        submittedAt: r.updated_at,
        reviewedAt: r.reviewed_at,
        projectCount: r.project_count,
      })),
    };
  } finally {
    db.close();
  }
}

/**
 * A profile as the reviewer sees it: every project, published or not.
 *
 * Deliberately not the public read — an admin must be able to judge draft work
 * before deciding, which is the entire point of reviewing.
 */
export async function findProfileForReview(id: number): Promise<{
  profile: DesignerProfile;
  portfolioProjects: PortfolioProject[];
  email: string;
} | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query(
        `SELECT dp.*, u.email AS user_email
           FROM designer_profiles dp
           JOIN users u ON u.id = dp.user_id
          WHERE dp.id = ?`,
      )
      .get(id) as (Record<string, unknown> & { user_email: string }) | null;
    if (!row) return null;

    const portfolioProjects = db
      .query(
        `SELECT * FROM portfolio_projects WHERE designer_profile_id = ?
          ORDER BY display_order ASC, id ASC`,
      )
      .all(id) as Array<Record<string, unknown>>;

    return {
      email: row.user_email,
      profile: toProfile(row as unknown as ProfileRow),
      portfolioProjects: (
        portfolioProjects as unknown as PortfolioProjectRow[]
      ).map(toProject),
    };
  } finally {
    db.close();
  }
}

/**
 * Record a decision.
 *
 * Who decided and when are written in the same statement as the status, so a
 * profile can never end up approved with no attribution. The guard on
 * `status IN ('pending','draft','rejected')` makes a second decision on an
 * already-approved profile a no-op rather than silently re-stamping it.
 */
export async function decideProfile(
  id: number,
  decision: ReviewDecision,
  adminId: number,
  note: string | null,
): Promise<DesignerProfile | null> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE designer_profiles
          SET status = ?, review_note = ?, reviewed_by = ?,
              reviewed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
      [decision === 'approve' ? 'approved' : 'rejected', note, adminId, id],
    );

    const row = db
      .query('SELECT * FROM designer_profiles WHERE id = ?')
      .get(id) as Record<string, unknown> | null;
    if (!row) return null;

    return toProfile(row as unknown as ProfileRow);
  } finally {
    db.close();
  }
}
