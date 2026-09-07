import type {
  DesignerProfile,
  PortfolioProject,
  PortfolioProjectImage,
} from '@shared/types';
import { openDbConnection } from './db';
import { reindexDesigner, reindexDesignerForProject } from './search';

/** Raw column shapes, mapped to the camelCase shared types below. */
export interface ProfileRow {
  id: number;
  user_id: number;
  slug: string;
  studio_name: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  website_url: string | null;
  instagram_url: string | null;
  budget_band: DesignerProfile['budgetBand'];
  availability: DesignerProfile['availability'];
  cover_image_id: number | null;
  status: DesignerProfile['status'];
  reviewed_at: string | null;
  reviewed_by: number | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortfolioProjectRow {
  id: number;
  designer_profile_id: number;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  work_type: PortfolioProject['workType'];
  budget_band: PortfolioProject['budgetBand'];
  completed_year: number | null;
  cover_image_id: number | null;
  status: PortfolioProject['status'];
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface ProjectImageRow {
  id: number;
  portfolio_project_id: number;
  image_id: number;
  caption: string | null;
  display_order: number;
  created_at: string;
}

/**
 * Row -> DesignerProfile. Exported so admin and discovery map identically:
 * a private copy silently loses any column added later.
 */
export const toProfile = (r: ProfileRow): DesignerProfile => ({
  id: r.id,
  userId: r.user_id,
  slug: r.slug,
  studioName: r.studio_name,
  headline: r.headline,
  bio: r.bio,
  location: r.location,
  websiteUrl: r.website_url,
  instagramUrl: r.instagram_url,
  budgetBand: r.budget_band,
  availability: r.availability,
  coverImageId: r.cover_image_id,
  status: r.status,
  reviewedAt: r.reviewed_at,
  reviewedBy: r.reviewed_by,
  reviewNote: r.review_note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toProject = (r: PortfolioProjectRow): PortfolioProject => ({
  id: r.id,
  designerProfileId: r.designer_profile_id,
  slug: r.slug,
  title: r.title,
  summary: r.summary,
  description: r.description,
  location: r.location,
  workType: r.work_type,
  budgetBand: r.budget_band,
  completedYear: r.completed_year,
  coverImageId: r.cover_image_id,
  status: r.status,
  displayOrder: r.display_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toProjectImage = (r: ProjectImageRow): PortfolioProjectImage => ({
  id: r.id,
  portfolioProjectId: r.portfolio_project_id,
  imageId: r.image_id,
  caption: r.caption,
  displayOrder: r.display_order,
  createdAt: r.created_at,
});

export async function findProfileByUserId(
  userId: number,
): Promise<DesignerProfile | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query('SELECT * FROM designer_profiles WHERE user_id = ?')
      .get(userId) as ProfileRow | null;
    return row ? toProfile(row) : null;
  } finally {
    db.close();
  }
}

/**
 * Public lookup. REQ-DISCOVERY-001: approved only, and this is the requirement
 * rather than REQ-PRODUCT-002's list-level one. Omitting a profile from the
 * listing is a presentation choice; refusing to serve it by slug is the actual
 * control — slugs derive from studio names and are guessable, and a designer
 * awaiting review has every reason to share their own URL.
 *
 * An unapproved profile must be indistinguishable from one that does not
 * exist, or the gate leaks who has signed up.
 */
export async function findApprovedProfileBySlug(
  slug: string,
): Promise<DesignerProfile | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query(
        "SELECT * FROM designer_profiles WHERE slug = ? AND status = 'approved'",
      )
      .get(slug) as ProfileRow | null;
    return row ? toProfile(row) : null;
  } finally {
    db.close();
  }
}

export async function insertProfile(
  userId: number,
  slug: string,
  fields: Record<string, unknown>,
): Promise<DesignerProfile> {
  const db = await openDbConnection();
  let row: ProfileRow;
  try {
    db.run(
      `INSERT INTO designer_profiles
        (user_id, slug, studio_name, headline, bio, location, website_url, instagram_url, budget_band, availability)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        slug,
        fields.studioName as string,
        fields.headline as string | null,
        fields.bio as string | null,
        fields.location as string | null,
        fields.websiteUrl as string | null,
        fields.instagramUrl as string | null,
        fields.budgetBand as string | null,
        fields.availability as string | null,
      ],
    );
    row = db
      .query('SELECT * FROM designer_profiles WHERE user_id = ?')
      .get(userId) as ProfileRow;
  } finally {
    db.close();
  }
  // Reindexed on its own connection, after this one is closed — two live
  // handles writing the same file is how you earn an intermittent SQLITE_BUSY.
  // The profile is searchable from the moment it exists; the approval gate is
  // applied at query time, not by withholding the index row.
  await reindexDesigner(row.id);
  return toProfile(row);
}

export async function updateProfile(
  id: number,
  fields: Record<string, unknown>,
): Promise<DesignerProfile> {
  const db = await openDbConnection();
  let row: ProfileRow;
  try {
    db.run(
      `UPDATE designer_profiles SET
         studio_name = ?, headline = ?, bio = ?, location = ?,
         website_url = ?, instagram_url = ?, budget_band = ?, availability = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        fields.studioName as string,
        fields.headline as string | null,
        fields.bio as string | null,
        fields.location as string | null,
        fields.websiteUrl as string | null,
        fields.instagramUrl as string | null,
        fields.budgetBand as string | null,
        fields.availability as string | null,
        id,
      ],
    );
    row = db
      .query('SELECT * FROM designer_profiles WHERE id = ?')
      .get(id) as ProfileRow;
  } finally {
    db.close();
  }
  // Studio name, headline, bio and location are all indexed text.
  await reindexDesigner(id);
  return toProfile(row);
}

/** draft | rejected -> pending. Approved profiles are already live. */
export async function submitProfileForReview(
  id: number,
): Promise<DesignerProfile> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE designer_profiles
       SET status = 'pending', review_note = NULL, updated_at = datetime('now')
       WHERE id = ? AND status IN ('draft', 'rejected')`,
      [id],
    );
    const row = db
      .query('SELECT * FROM designer_profiles WHERE id = ?')
      .get(id) as ProfileRow;
    return toProfile(row);
  } finally {
    db.close();
  }
}

/**
 * REQ-DISCOVERY-002. `publishedOnly` defaults to false because the designer's
 * own editor needs their drafts; every PUBLIC caller must pass true. A separate
 * gate from the approval one — an approved designer may still have unfinished
 * work, and publishing it early is a cost borne by them, not by us.
 */
export async function listProjects(
  profileId: number,
  { publishedOnly = false }: { publishedOnly?: boolean } = {},
): Promise<PortfolioProject[]> {
  const db = await openDbConnection();
  try {
    const sql = publishedOnly
      ? `SELECT * FROM portfolio_projects WHERE designer_profile_id = ? AND status = 'published'
         ORDER BY display_order ASC, id ASC`
      : `SELECT * FROM portfolio_projects WHERE designer_profile_id = ?
         ORDER BY display_order ASC, id ASC`;
    return (db.query(sql).all(profileId) as PortfolioProjectRow[]).map(
      toProject,
    );
  } finally {
    db.close();
  }
}

export async function findProject(
  id: number,
): Promise<PortfolioProject | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query('SELECT * FROM portfolio_projects WHERE id = ?')
      .get(id) as PortfolioProjectRow | null;
    return row ? toProject(row) : null;
  } finally {
    db.close();
  }
}

export async function insertProject(
  profileId: number,
  slug: string,
  fields: Record<string, unknown>,
): Promise<PortfolioProject> {
  const db = await openDbConnection();
  let row: PortfolioProjectRow;
  try {
    db.run(
      `INSERT INTO portfolio_projects
        (designer_profile_id, slug, title, summary, description, location,
         work_type, budget_band, completed_year, status, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         COALESCE((SELECT MAX(display_order) + 1 FROM portfolio_projects WHERE designer_profile_id = ?), 0))`,
      [
        profileId,
        slug,
        fields.title as string,
        fields.summary as string | null,
        fields.description as string | null,
        fields.location as string | null,
        fields.workType as string | null,
        fields.budgetBand as string | null,
        fields.completedYear as number | null,
        (fields.status as string) ?? 'draft',
        profileId,
      ],
    );
    row = db
      .query('SELECT * FROM portfolio_projects WHERE slug = ?')
      .get(slug) as PortfolioProjectRow;
  } finally {
    db.close();
  }
  // A published title becomes part of its designer's search document.
  await reindexDesigner(profileId);
  return toProject(row);
}

export async function updateProject(
  id: number,
  fields: Record<string, unknown>,
): Promise<PortfolioProject> {
  const db = await openDbConnection();
  let row: PortfolioProjectRow;
  try {
    db.run(
      `UPDATE portfolio_projects SET
         title = ?, summary = ?, description = ?, location = ?,
         work_type = ?, budget_band = ?, completed_year = ?, status = ?,
         display_order = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        fields.title as string,
        fields.summary as string | null,
        fields.description as string | null,
        fields.location as string | null,
        fields.workType as string | null,
        fields.budgetBand as string | null,
        fields.completedYear as number | null,
        fields.status as string,
        fields.displayOrder as number,
        id,
      ],
    );
    row = db
      .query('SELECT * FROM portfolio_projects WHERE id = ?')
      .get(id) as PortfolioProjectRow;
  } finally {
    db.close();
  }
  // Retitling, or publishing/unpublishing, both change what the designer is
  // findable by.
  await reindexDesignerForProject(id);
  return toProject(row);
}

export async function deleteProject(id: number): Promise<void> {
  const db = await openDbConnection();
  let owner: { id: number } | null;
  try {
    // The owner has to be read before the row goes, or there is nothing left
    // to reindex and the title lingers in search forever.
    owner = db
      .query(
        'SELECT designer_profile_id AS id FROM portfolio_projects WHERE id = ?',
      )
      .get(id) as { id: number } | null;
    db.run('DELETE FROM portfolio_projects WHERE id = ?', [id]);
  } finally {
    db.close();
  }
  if (owner) await reindexDesigner(owner.id);
}

export async function listProjectImages(
  portfolioProjectId: number,
): Promise<PortfolioProjectImage[]> {
  const db = await openDbConnection();
  try {
    return (
      db
        .query(
          `SELECT * FROM portfolio_project_images WHERE portfolio_project_id = ?
           ORDER BY display_order ASC, id ASC`,
        )
        .all(portfolioProjectId) as ProjectImageRow[]
    ).map(toProjectImage);
  } finally {
    db.close();
  }
}

/**
 * Replace a project's image list in one transaction.
 *
 * Order is taken from the array position, so the client sends the sequence it
 * wants rather than juggling indices. All-or-nothing: a half-applied reorder
 * would leave the portfolio in an order the designer never chose.
 */
export async function setProjectImages(
  portfolioProjectId: number,
  images: Array<{ imageId: number; caption: string | null }>,
): Promise<PortfolioProjectImage[]> {
  const db = await openDbConnection();
  try {
    db.run('PRAGMA foreign_keys = ON');
    const apply = db.transaction(() => {
      db.run(
        'DELETE FROM portfolio_project_images WHERE portfolio_project_id = ?',
        [portfolioProjectId],
      );
      images.forEach((image, index) => {
        db.run(
          `INSERT INTO portfolio_project_images (portfolio_project_id, image_id, caption, display_order)
           VALUES (?, ?, ?, ?)`,
          [portfolioProjectId, image.imageId, image.caption, index],
        );
      });
    });
    apply();

    return (
      db
        .query(
          `SELECT * FROM portfolio_project_images WHERE portfolio_project_id = ?
           ORDER BY display_order ASC, id ASC`,
        )
        .all(portfolioProjectId) as ProjectImageRow[]
    ).map(toProjectImage);
  } finally {
    db.close();
  }
}
