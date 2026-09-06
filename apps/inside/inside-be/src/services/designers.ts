import type { DesignerProfile, Project, ProjectImage } from '@shared/types';
import { openDbConnection } from './db';

/** Raw column shapes, mapped to the camelCase shared types below. */
interface ProfileRow {
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
  cover_image_id: number | null;
  status: DesignerProfile['status'];
  reviewed_at: string | null;
  reviewed_by: number | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectRow {
  id: number;
  designer_profile_id: number;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  project_type: Project['projectType'];
  budget_band: Project['budgetBand'];
  completed_year: number | null;
  cover_image_id: number | null;
  status: Project['status'];
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface ProjectImageRow {
  id: number;
  project_id: number;
  image_id: number;
  caption: string | null;
  display_order: number;
  created_at: string;
}

const toProfile = (r: ProfileRow): DesignerProfile => ({
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
  coverImageId: r.cover_image_id,
  status: r.status,
  reviewedAt: r.reviewed_at,
  reviewedBy: r.reviewed_by,
  reviewNote: r.review_note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  designerProfileId: r.designer_profile_id,
  slug: r.slug,
  title: r.title,
  summary: r.summary,
  description: r.description,
  location: r.location,
  projectType: r.project_type,
  budgetBand: r.budget_band,
  completedYear: r.completed_year,
  coverImageId: r.cover_image_id,
  status: r.status,
  displayOrder: r.display_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toProjectImage = (r: ProjectImageRow): ProjectImage => ({
  id: r.id,
  projectId: r.project_id,
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
 * Public lookup. Approved only — an unapproved profile must be
 * indistinguishable from one that does not exist, or the approval gate leaks
 * who has signed up.
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
  try {
    db.run(
      `INSERT INTO designer_profiles
        (user_id, slug, studio_name, headline, bio, location, website_url, instagram_url, budget_band)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    );
    const row = db
      .query('SELECT * FROM designer_profiles WHERE user_id = ?')
      .get(userId) as ProfileRow;
    return toProfile(row);
  } finally {
    db.close();
  }
}

export async function updateProfile(
  id: number,
  fields: Record<string, unknown>,
): Promise<DesignerProfile> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE designer_profiles SET
         studio_name = ?, headline = ?, bio = ?, location = ?,
         website_url = ?, instagram_url = ?, budget_band = ?,
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
        id,
      ],
    );
    const row = db
      .query('SELECT * FROM designer_profiles WHERE id = ?')
      .get(id) as ProfileRow;
    return toProfile(row);
  } finally {
    db.close();
  }
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

export async function listProjects(
  profileId: number,
  { publishedOnly = false }: { publishedOnly?: boolean } = {},
): Promise<Project[]> {
  const db = await openDbConnection();
  try {
    const sql = publishedOnly
      ? `SELECT * FROM projects WHERE designer_profile_id = ? AND status = 'published'
         ORDER BY display_order ASC, id ASC`
      : `SELECT * FROM projects WHERE designer_profile_id = ?
         ORDER BY display_order ASC, id ASC`;
    return (db.query(sql).all(profileId) as ProjectRow[]).map(toProject);
  } finally {
    db.close();
  }
}

export async function findProject(id: number): Promise<Project | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query('SELECT * FROM projects WHERE id = ?')
      .get(id) as ProjectRow | null;
    return row ? toProject(row) : null;
  } finally {
    db.close();
  }
}

export async function insertProject(
  profileId: number,
  slug: string,
  fields: Record<string, unknown>,
): Promise<Project> {
  const db = await openDbConnection();
  try {
    db.run(
      `INSERT INTO projects
        (designer_profile_id, slug, title, summary, description, location,
         project_type, budget_band, completed_year, status, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         COALESCE((SELECT MAX(display_order) + 1 FROM projects WHERE designer_profile_id = ?), 0))`,
      [
        profileId,
        slug,
        fields.title as string,
        fields.summary as string | null,
        fields.description as string | null,
        fields.location as string | null,
        fields.projectType as string | null,
        fields.budgetBand as string | null,
        fields.completedYear as number | null,
        (fields.status as string) ?? 'draft',
        profileId,
      ],
    );
    const row = db
      .query('SELECT * FROM projects WHERE slug = ?')
      .get(slug) as ProjectRow;
    return toProject(row);
  } finally {
    db.close();
  }
}

export async function updateProject(
  id: number,
  fields: Record<string, unknown>,
): Promise<Project> {
  const db = await openDbConnection();
  try {
    db.run(
      `UPDATE projects SET
         title = ?, summary = ?, description = ?, location = ?,
         project_type = ?, budget_band = ?, completed_year = ?, status = ?,
         display_order = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        fields.title as string,
        fields.summary as string | null,
        fields.description as string | null,
        fields.location as string | null,
        fields.projectType as string | null,
        fields.budgetBand as string | null,
        fields.completedYear as number | null,
        fields.status as string,
        fields.displayOrder as number,
        id,
      ],
    );
    const row = db
      .query('SELECT * FROM projects WHERE id = ?')
      .get(id) as ProjectRow;
    return toProject(row);
  } finally {
    db.close();
  }
}

export async function deleteProject(id: number): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run('DELETE FROM projects WHERE id = ?', [id]);
  } finally {
    db.close();
  }
}

export async function listProjectImages(
  projectId: number,
): Promise<ProjectImage[]> {
  const db = await openDbConnection();
  try {
    return (
      db
        .query(
          `SELECT * FROM project_images WHERE project_id = ?
           ORDER BY display_order ASC, id ASC`,
        )
        .all(projectId) as ProjectImageRow[]
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
  projectId: number,
  images: Array<{ imageId: number; caption: string | null }>,
): Promise<ProjectImage[]> {
  const db = await openDbConnection();
  try {
    db.run('PRAGMA foreign_keys = ON');
    const apply = db.transaction(() => {
      db.run('DELETE FROM project_images WHERE project_id = ?', [projectId]);
      images.forEach((image, index) => {
        db.run(
          `INSERT INTO project_images (project_id, image_id, caption, display_order)
           VALUES (?, ?, ?, ?)`,
          [projectId, image.imageId, image.caption, index],
        );
      });
    });
    apply();

    return (
      db
        .query(
          `SELECT * FROM project_images WHERE project_id = ?
           ORDER BY display_order ASC, id ASC`,
        )
        .all(projectId) as ProjectImageRow[]
    ).map(toProjectImage);
  } finally {
    db.close();
  }
}
