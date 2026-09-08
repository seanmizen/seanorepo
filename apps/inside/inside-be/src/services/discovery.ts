import type {
  Availability,
  BudgetBand,
  DesignerListItem,
  DesignerProfile,
  DesignerSort,
  PublicProject,
  StoredImage,
  WorkType,
} from '@shared/types';
import { openDbConnection } from './db';
import { findApprovedProfileBySlug, listProjects } from './designers';
import { findStoredImages } from './image-library';
import { BM25_EXPRESSION, buildMatchExpression } from './search';
import { resolveSlug } from './slugs';

/**
 * The public read side of the marketplace: browse, filter, sort, search.
 *
 * THE APPROVAL GATE — REQ-PRODUCT-002, enforced here and in the schema
 * (REQ-DATA-003). Every query in this file anchors on
 * `designer_profiles.status = 'approved'`, and this file writes that predicate
 * into the base WHERE clause before it appends any caller-supplied filter — it
 * is not a filter that a parameter could displace. Search hits arrive from the
 * FTS index, which holds no status at all, and the INNER JOIN gates them
 * back to `designer_profiles` carrying the same predicate. There is no code
 * path here, and no combination of parameters, that can return a row whose
 * status is not 'approved'.
 *
 * STABLE PAGINATION. Every ORDER BY ends in a unique column (`p.id`), so no
 * two rows can compare equal. Without that, two designers sharing a
 * `created_at` — which SQLite's second-resolution CURRENT_TIMESTAMP makes
 * likely, not exotic — could swap places between requests and be duplicated on
 * one page and skipped on the next.
 */

export interface DesignerListFilters {
  q: string | null;
  workTypes: readonly WorkType[] | null;
  location: string | null;
  budgetBands: readonly BudgetBand[] | null;
  availability: readonly Availability[] | null;
  sort: DesignerSort;
  limit: number;
  offset: number;
}

/** Only the columns a list needs. Bio and the review trail stay server-side. */
interface ListRow {
  id: number;
  slug: string;
  studio_name: string;
  headline: string | null;
  location: string | null;
  budget_band: BudgetBand | null;
  availability: Availability | null;
  cover_image_id: number | null;
  created_at: string;
}

const LIST_COLUMNS = `
  p.id, p.slug, p.studio_name, p.headline, p.location,
  p.budget_band, p.availability, p.cover_image_id, p.created_at`;

/**
 * Ordering per sort, each closed with the `p.id` tie-breaker.
 *
 * bm25() scores are negative and more negative is better, so relevance sorts
 * ASC. Its tie-breaker is `p.id DESC` so that equally relevant designers show
 * the newest first rather than in insertion order.
 */
const ORDER_BY: Record<DesignerSort, string> = {
  relevance: `${BM25_EXPRESSION} ASC, p.id DESC`,
  newest: 'p.created_at DESC, p.id DESC',
  oldest: 'p.created_at ASC, p.id ASC',
  name: 'p.studio_name ASC, p.id ASC',
};

interface BuiltQuery {
  from: string;
  where: string;
  params: Array<string | number>;
}

function buildQuery(filters: DesignerListFilters): BuiltQuery | null {
  const match = filters.q === null ? null : buildMatchExpression(filters.q);
  // A query made only of punctuation searched for nothing, which is an empty
  // result — not an absent filter that would list every designer on the site.
  if (filters.q !== null && match === null) return null;

  const from = match
    ? 'FROM designer_search JOIN designer_profiles p ON p.id = designer_search.rowid'
    : 'FROM designer_profiles p';

  // The approval gate goes in first and unconditionally.
  const where = ["p.status = 'approved'"];
  const params: Array<string | number> = [];

  if (match) {
    where.push('designer_search MATCH ?');
    params.push(match);
  }
  if (filters.location !== null) {
    // NOCASE so "london" finds "London". Migration 002 indexes this collation.
    where.push('p.location = ? COLLATE NOCASE');
    params.push(filters.location);
  }
  // Multi-value filters are OR within a facet and AND across facets, which is
  // what a filter panel implies: "kitchens or bathrooms, in London".
  const placeholders = (values: readonly unknown[]) =>
    values.map(() => '?').join(', ');

  if (filters.budgetBands?.length) {
    where.push(`p.budget_band IN (${placeholders(filters.budgetBands)})`);
    params.push(...filters.budgetBands);
  }
  if (filters.availability?.length) {
    where.push(`p.availability IN (${placeholders(filters.availability)})`);
    params.push(...filters.availability);
  }
  if (filters.workTypes?.length) {
    // "Has published work of any of these kinds." EXISTS rather than a join,
    // so a designer with three published kitchens is still one row.
    where.push(`EXISTS (
      SELECT 1 FROM portfolio_projects pr
      WHERE pr.designer_profile_id = p.id
        AND pr.status = 'published'
        AND pr.work_type IN (${placeholders(filters.workTypes)}))`);
    params.push(...filters.workTypes);
  }

  return { from, where: where.join(' AND '), params };
}

/** The SQL the list endpoint runs, for `EXPLAIN QUERY PLAN` in a test. */
export function listApprovedDesignersSql(filters: DesignerListFilters): {
  sql: string;
  params: Array<string | number>;
} {
  const built = buildQuery(filters);
  if (!built) return { sql: '', params: [] };
  return {
    sql: `SELECT ${LIST_COLUMNS} ${built.from} WHERE ${built.where}
          ORDER BY ${ORDER_BY[filters.sort]} LIMIT ? OFFSET ?`,
    params: [...built.params, filters.limit, filters.offset],
  };
}

/**
 * Resolve a cover image for each designer on the page.
 *
 * Falls back through the portfolio because nothing sets
 * `designer_profiles.cover_image_id` yet, and a list of designers with no
 * pictures is not this product. Order of preference: the profile's own cover,
 * then the cover of their first published project, then the first image on
 * their first published project that has one.
 *
 * Narrowed to the page's ids, so page size bounds the cost, not the
 * size of the result set.
 */
async function resolveCoverImageIds(
  profiles: ListRow[],
): Promise<Map<number, number>> {
  const needed = profiles.filter((p) => p.cover_image_id === null);
  const covers = new Map<number, number>();
  for (const p of profiles) {
    if (p.cover_image_id !== null) covers.set(p.id, p.cover_image_id);
  }
  if (needed.length === 0) return covers;

  const db = await openDbConnection();
  try {
    const placeholders = needed.map(() => '?').join(',');
    const rows = db
      .query(
        `SELECT pr.designer_profile_id AS pid,
                pr.cover_image_id AS project_cover_id,
                (SELECT pi.image_id FROM portfolio_project_images pi
                 WHERE pi.portfolio_project_id = pr.id
                 ORDER BY pi.display_order ASC, pi.id ASC LIMIT 1) AS first_image_id
         FROM portfolio_projects pr
         WHERE pr.status = 'published'
           AND pr.designer_profile_id IN (${placeholders})
         ORDER BY pr.designer_profile_id ASC, pr.display_order ASC, pr.id ASC`,
      )
      .all(...needed.map((p) => p.id)) as Array<{
      pid: number;
      project_cover_id: number | null;
      first_image_id: number | null;
    }>;

    // Rows arrive in curatorial order, so the first usable one per designer
    // wins and this loop skips later ones.
    for (const row of rows) {
      if (covers.has(row.pid)) continue;
      const id = row.project_cover_id ?? row.first_image_id;
      if (id !== null) covers.set(row.pid, id);
    }
    return covers;
  } finally {
    db.close();
  }
}

async function countPublishedProjects(
  profileIds: number[],
): Promise<Map<number, number>> {
  if (profileIds.length === 0) return new Map();
  const db = await openDbConnection();
  try {
    const placeholders = profileIds.map(() => '?').join(',');
    const rows = db
      .query(
        `SELECT designer_profile_id AS pid, COUNT(*) AS c FROM portfolio_projects
         WHERE status = 'published' AND designer_profile_id IN (${placeholders})
         GROUP BY designer_profile_id`,
      )
      .all(...profileIds) as Array<{ pid: number; c: number }>;
    return new Map(rows.map((r) => [r.pid, r.c]));
  } finally {
    db.close();
  }
}

export async function listApprovedDesigners(
  filters: DesignerListFilters,
): Promise<{ designers: DesignerListItem[]; total: number }> {
  const built = buildQuery(filters);
  if (!built) return { designers: [], total: 0 };

  const db = await openDbConnection();
  let rows: ListRow[];
  let total: number;
  try {
    total = (
      db
        .query(`SELECT COUNT(*) AS c ${built.from} WHERE ${built.where}`)
        .get(...built.params) as { c: number }
    ).c;

    rows = db
      .query(
        `SELECT ${LIST_COLUMNS} ${built.from} WHERE ${built.where}
         ORDER BY ${ORDER_BY[filters.sort]} LIMIT ? OFFSET ?`,
      )
      .all(...built.params, filters.limit, filters.offset) as ListRow[];
  } finally {
    db.close();
  }

  if (rows.length === 0) return { designers: [], total };

  const [covers, counts] = await Promise.all([
    resolveCoverImageIds(rows),
    countPublishedProjects(rows.map((r) => r.id)),
  ]);
  const images = await findStoredImages([...covers.values()]);

  return {
    designers: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      studioName: row.studio_name,
      headline: row.headline,
      location: row.location,
      budgetBand: row.budget_band,
      availability: row.availability,
      projectCount: counts.get(row.id) ?? 0,
      coverImage: coverOf(row.id, covers, images),
      createdAt: row.created_at,
    })),
    total,
  };
}

function coverOf(
  profileId: number,
  covers: Map<number, number>,
  images: Map<number, StoredImage>,
): StoredImage | null {
  const imageId = covers.get(profileId);
  return imageId === undefined ? null : (images.get(imageId) ?? null);
}

/**
 * One approved designer's public portfolio, paginated.
 *
 * Returns null when the designer is missing OR unapproved — the caller turns
 * both into the same 404, so an unapproved slug is indistinguishable from one
 * that was never taken. Anything else would let a stranger enumerate the
 * approval queue by guessing studio names.
 */
export async function listPublicPortfolio(
  slug: string,
  { limit, offset }: { limit: number; offset: number },
): Promise<{
  profile: DesignerProfile;
  portfolioProjects: PublicProject[];
  total: number;
} | null> {
  const profile = await findApprovedProfileBySlug(slug);
  if (!profile) return null;

  // Published only, already ordered display_order ASC, id ASC — the same
  // curated order with the same unique tie-breaker the list uses.
  const published = await listProjects(profile.id, { publishedOnly: true });
  const page = published.slice(offset, offset + limit);

  if (page.length === 0) {
    return { profile, portfolioProjects: [], total: published.length };
  }

  const db = await openDbConnection();
  let imageRows: Array<{
    portfolio_project_id: number;
    image_id: number;
    caption: string | null;
  }>;
  try {
    const placeholders = page.map(() => '?').join(',');
    imageRows = db
      .query(
        `SELECT portfolio_project_id, image_id, caption FROM portfolio_project_images
         WHERE portfolio_project_id IN (${placeholders})
         ORDER BY portfolio_project_id ASC, display_order ASC, id ASC`,
      )
      .all(...page.map((p) => p.id)) as typeof imageRows;
  } finally {
    db.close();
  }

  const images = await findStoredImages([
    ...imageRows.map((r) => r.image_id),
    ...page.flatMap((p) => (p.coverImageId === null ? [] : [p.coverImageId])),
  ]);

  return {
    profile,
    total: published.length,
    portfolioProjects: page.map((project) => {
      const own = imageRows
        .filter((r) => r.portfolio_project_id === project.id)
        .flatMap((r) => {
          const image = images.get(r.image_id);
          return image ? [{ caption: r.caption, image }] : [];
        });
      const explicitCover =
        project.coverImageId === null
          ? null
          : (images.get(project.coverImageId) ?? null);
      return {
        ...project,
        // Same fallback as the designer list: an explicit cover if the designer
        // chose one, otherwise the first image in their curated order.
        coverImage: explicitCover ?? own[0]?.image ?? null,
        images: own,
      };
    }),
  };
}

/**
 * One published piece from an approved designer's portfolio.
 *
 * Reuses the list path rather than writing a second query: portfolios are
 * small (a studio has a handful of pieces, not thousands), and one code path
 * means the detail page can never disagree with the grid about what is
 * published or what images a piece has.
 */
export async function findPublicPortfolioProject(
  designerSlug: string,
  projectSlug: string,
): Promise<{ profile: DesignerProfile; project: PublicProject } | null> {
  const portfolio = await listPublicPortfolio(designerSlug, {
    limit: 200,
    offset: 0,
  });
  if (!portfolio) return null;

  // Resolved through slug history (REQ-SLUG-001) so a renamed piece still
  // answers on its old slug, then matched by id against the published set —
  // resolution says which piece, publication says whether it may be seen.
  const resolved = await resolveSlug('portfolio_project', projectSlug);
  const project = resolved
    ? portfolio.portfolioProjects.find(
        (candidate) => candidate.id === resolved.entityId,
      )
    : undefined;
  // An unpublished piece is indistinguishable from one that never existed —
  // the same rule the profile itself follows.
  return project ? { profile: portfolio.profile, project } : null;
}
