import { openDbConnection } from './db';

/**
 * Free-text search over designer profiles, backed by SQLite FTS5.
 *
 * The index lives in `designer_search` (migration 002). One document per
 * profile, keyed by `rowid = designer_profiles.id`, holding the studio name,
 * headline, bio, location and the titles of the designer's published portfolio_projects.
 *
 * INDEX MAINTENANCE — rebuild on write, not triggers.
 *
 * A designer's document folds in the titles of their published portfolio_projects, so a
 * trigger would have to re-aggregate across two tables on every insert, update
 * and delete of `portfolio_projects`, in SQL, duplicated three times, and again for the
 * profile's own columns. Writes here all pass through `services/designers.ts`,
 * so one `reindexDesigner()` call per write path is a single readable
 * implementation instead of six trigger bodies that can drift apart. It is
 * also cheap: rebuilding one designer's document is a handful of indexed reads.
 *
 * The one exception is DELETE of a profile, which migration 002 handles with a
 * trigger — deleting a row is a row-level event with no aggregate in it, and a
 * trigger covers cascades that never touch this service.
 *
 * A stale or orphaned index row cannot leak anything: `status` is not in the
 * index, and every search INNER JOINs `designer_profiles` and filters
 * `status = 'approved'` there. The join is the approval gate.
 */

/** Long enough for a real query; a longer one is a mistake or an attack. */
export const MAX_SEARCH_LENGTH = 200;

/** Beyond this the query is noise, and each term costs an index lookup. */
const MAX_TERMS = 12;
const MAX_TERM_LENGTH = 40;

/**
 * Turn raw user input into an FTS5 MATCH expression.
 *
 * User input is never passed to MATCH as-is. FTS5 has its own query syntax —
 * `AND`, `OR`, `NOT`, `NEAR`, `*`, `:`, `^`, parentheses, quotes — so a bare
 * apostrophe or a stray colon is a syntax error, and `NOT` in a search box
 * would silently mean set subtraction. Instead the input is tokenised down to
 * letters, digits and apostrophes, and each term is re-emitted as a quoted
 * phrase with a prefix marker: `"o'brien"*`.
 *
 * That gives three of the four things the search has to do:
 * - apostrophes are safe, because quoting makes them content rather than
 *   syntax (unicode61 splits "o'brien" into two tokens, and the quotes make
 *   that an exact phrase, so it still matches the indexed name);
 * - partial words match, because of the trailing `*`;
 * - multi-word queries AND together, which is FTS5's default between terms —
 *   "kitchen london" means both, not either.
 *
 * Relevance ranking is the fourth, and comes from bm25() at query time.
 *
 * Returns null when the input holds nothing searchable ("???"), which the
 * caller renders as an empty page rather than as "no filter".
 */
export function buildMatchExpression(raw: string): string | null {
  const terms = (raw.match(/[\p{L}\p{N}']+/gu) ?? [])
    // A token of only apostrophes carries no meaning and quotes to nothing.
    .map((term) => term.replace(/^'+|'+$/g, ''))
    .filter((term) => term.length > 0)
    .slice(0, MAX_TERMS)
    .map((term) => term.slice(0, MAX_TERM_LENGTH));

  if (terms.length === 0) return null;

  // Double quotes cannot survive the tokenise regex, so the quoting below
  // cannot be escaped out of. Belt and braces all the same.
  return terms.map((term) => `"${term.replace(/"/g, '')}"*`).join(' ');
}

/**
 * bm25 weights, in the column order of `designer_search`.
 *
 * A hit on the studio name is what the buyer typed if they know who they are
 * looking for, so it outranks everything. PortfolioProject titles and headline come
 * next — both are curated, deliberate text. The bio is long and rambling, so a
 * hit there is weak evidence and is weighted down accordingly.
 *
 * bm25() returns a NEGATIVE score where a better match is more negative, so
 * every relevance sort is ASC.
 */
export const BM25_WEIGHTS = {
  studioName: 10.0,
  headline: 4.0,
  bio: 1.0,
  location: 3.0,
  projectTitles: 5.0,
} as const;

export const BM25_EXPRESSION = `bm25(designer_search, ${BM25_WEIGHTS.studioName}, ${BM25_WEIGHTS.headline}, ${BM25_WEIGHTS.bio}, ${BM25_WEIGHTS.location}, ${BM25_WEIGHTS.projectTitles})`;

const REINDEX_SELECT = `
  SELECT
    p.id,
    p.studio_name,
    COALESCE(p.headline, ''),
    COALESCE(p.bio, ''),
    COALESCE(p.location, ''),
    COALESCE(
      (SELECT group_concat(pr.title, ' ')
       FROM portfolio_projects pr
       WHERE pr.designer_profile_id = p.id AND pr.status = 'published'),
      ''
    )
  FROM designer_profiles p
  WHERE p.id = ?`;

/**
 * Rebuild one designer's search document.
 *
 * Delete-then-insert in a transaction: FTS5 has no UPSERT, and a half-applied
 * rebuild would leave a designer either unfindable or findable by text they
 * have since removed.
 */
export async function reindexDesigner(profileId: number): Promise<void> {
  const db = await openDbConnection();
  try {
    const rebuild = db.transaction(() => {
      db.run('DELETE FROM designer_search WHERE rowid = ?', [profileId]);
      db.run(
        `INSERT INTO designer_search (rowid, studio_name, headline, bio, location, project_titles)
         ${REINDEX_SELECT}`,
        [profileId],
      );
    });
    rebuild();
  } finally {
    db.close();
  }
}

/**
 * Rebuild the document of whichever designer owns `portfolioProjectId`.
 *
 * Resolving the owner here keeps every project write path down to one call and
 * means no caller has to remember that a project edit changes a *designer's*
 * document. A project that has already been deleted resolves to nothing and is
 * a no-op — callers that delete must capture the owner first.
 */
export async function reindexDesignerForProject(
  portfolioProjectId: number,
): Promise<void> {
  const db = await openDbConnection();
  let ownerId: number | null;
  try {
    const row = db
      .query(
        'SELECT designer_profile_id AS id FROM portfolio_projects WHERE id = ?',
      )
      .get(portfolioProjectId) as { id: number } | null;
    ownerId = row?.id ?? null;
  } finally {
    db.close();
  }
  if (ownerId !== null) await reindexDesigner(ownerId);
}
