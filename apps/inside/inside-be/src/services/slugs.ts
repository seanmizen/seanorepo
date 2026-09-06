import { openDbConnection } from './db';

/**
 * URL-safe slug from a human name.
 *
 * Strips diacritics first so "EstúdioÃo" becomes "estudio-ao" rather than
 * losing those characters entirely — studio names in this market are often
 * not ASCII.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/**
 * A slug not already taken in `table`, suffixing -2, -3, … on collision.
 *
 * `excludeId` lets a row keep its own slug when it is being updated.
 * Slugs are public URLs, so they are only ever generated, never guessed.
 */
export async function uniqueSlug(
  table: 'designer_profiles' | 'projects',
  desired: string,
  excludeId?: number,
): Promise<string> {
  const base = slugify(desired) || 'untitled';
  const db = await openDbConnection();
  try {
    for (let attempt = 0; ; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const clash = db
        .query(`SELECT id FROM ${table} WHERE slug = ? AND id IS NOT ?`)
        .get(candidate, excludeId ?? null) as { id: number } | null;
      if (!clash) return candidate;
    }
  } finally {
    db.close();
  }
}
