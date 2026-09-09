import { openDbConnection } from './db';

/** The entities that own a public, history-backed slug. */
export type SlugEntity = 'designer_profile' | 'portfolio_project' | 'brief';

/** Which table holds the active slug for each entity type. */
const ACTIVE_SLUG_TABLE: Record<SlugEntity, string> = {
  designer_profile: 'designer_profiles',
  portfolio_project: 'portfolio_projects',
  brief: 'briefs',
};

/**
 * Slugs nobody may claim, because each one shadows a real route.
 *
 * A designer who registers the slug `admin` would sit at `/designers/admin`,
 * which is harmless — but buyers get a top-level page if the opt-in profile
 * ever lands, and then `/admin` is genuinely reachable by registration. The
 * list is cheap now and impossible to add retroactively once someone holds one.
 */
const RESERVED_SLUGS = new Set([
  'account',
  'admin',
  'api',
  'assets',
  'bids',
  'briefs',
  'designers',
  'login',
  'logout',
  'me',
  'new',
  'portfolio',
  'search',
  'settings',
  'signup',
  'static',
  'uploads',
  'verify',
]);

export const isReservedSlug = (slug: string): boolean =>
  RESERVED_SLUGS.has(slug);

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

/** Thrown when a caller-supplied slug cannot be honoured, with a reason to show. */
export class SlugRejected extends Error {
  constructor(
    message: string,
    readonly reason: 'reserved' | 'taken' | 'empty',
  ) {
    super(message);
    this.name = 'SlugRejected';
  }
}

interface SlugRow {
  entity_id: number;
}

/**
 * Who, if anyone, holds this slug — now or at any point in the past.
 *
 * This checks history rather than just the live column, because a released slug
 * must never be handed to a different entity. Someone still has the old link.
 */
async function holderOf(
  entityType: SlugEntity,
  slug: string,
): Promise<number | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query('SELECT entity_id FROM slugs WHERE entity_type = ? AND slug = ?')
      .get(entityType, slug) as SlugRow | null;
    return row ? row.entity_id : null;
  } finally {
    db.close();
  }
}

/**
 * Pick a slug that is free to use, WITHOUT recording it.
 *
 * Separate from recording because a new row has no id until the insert runs, and
 * the slug has to be chosen first to be inserted with it. Callers create the
 * row and then call `recordSlug`.
 *
 * `desired` is either a name to derive from or a slug the user typed, and the
 * two differ on collision — which is the point:
 *
 * - **Derived** (`custom: false`) — a collision is not the user's problem, so
 *   it suffixes `-2`, `-3`, … until one is free.
 * - **Custom** (`custom: true`) — they asked for something specific, so a
 *   collision is an error they need to see. Silently handing back
 *   `north-house-4` when they typed `north-house` is worse than refusing.
 *
 * Pass `entityId` when renaming an existing entity: a slug it already holds in
 * this returns history as-is, so going back to an old name never fails on
 * the entity's own past.
 */
export async function chooseSlug(
  entityType: SlugEntity,
  desired: string,
  { custom = false, entityId }: { custom?: boolean; entityId?: number } = {},
): Promise<string> {
  const base = slugify(desired);

  if (base.length === 0) {
    if (custom) {
      throw new SlugRejected(
        'That has no letters or numbers in it, so it cannot be part of a web address.',
        'empty',
      );
    }
    return chooseSlug(entityType, 'untitled', { entityId });
  }

  if (isReservedSlug(base) && custom) {
    throw new SlugRejected(
      `"${base}" is reserved by the site and cannot be used.`,
      'reserved',
    );
  }

  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (isReservedSlug(candidate)) continue;

    const holder = await holderOf(entityType, candidate);
    if (holder === null || holder === entityId) return candidate;

    if (custom) {
      throw new SlugRejected(
        `"${candidate}" is already taken. Try another.`,
        'taken',
      );
    }
  }
}

/**
 * Record a slug in an entity's history. Idempotent.
 *
 * The UNIQUE (entity_type, slug) constraint is what actually enforces
 * permanence, so a race between `chooseSlug` and this insert fails here rather
 * than quietly handing one slug to two entities.
 */
export async function recordSlug(
  entityType: SlugEntity,
  entityId: number,
  slug: string,
): Promise<void> {
  const db = await openDbConnection();
  try {
    db.run(
      'INSERT OR IGNORE INTO slugs (entity_type, entity_id, slug) VALUES (?, ?, ?)',
      [entityType, entityId, slug],
    );
  } finally {
    db.close();
  }
}

/**
 * Choose and record in one step, for renaming an entity that already exists.
 *
 * Returns the slug claimed. The caller writes it to the entity's own `slug`
 * column — this module owns the history, not the pointer to the active one.
 */
export async function claimSlug(
  entityType: SlugEntity,
  entityId: number,
  desired: string,
  { custom = false }: { custom?: boolean } = {},
): Promise<string> {
  const slug = await chooseSlug(entityType, desired, { custom, entityId });
  await recordSlug(entityType, entityId, slug);
  return slug;
}

/** Every slug an entity has ever held, oldest first. */
export async function slugHistory(
  entityType: SlugEntity,
  entityId: number,
): Promise<string[]> {
  const db = await openDbConnection();
  try {
    const rows = db
      .query(
        'SELECT slug FROM slugs WHERE entity_type = ? AND entity_id = ? ORDER BY id ASC',
      )
      .all(entityType, entityId) as Array<{ slug: string }>;
    return rows.map((row) => row.slug);
  } finally {
    db.close();
  }
}

/** One live slug found with no matching row in `slugs`. */
export interface SlugHistoryGap {
  entityType: SlugEntity;
  entityId: number;
  slug: string;
}

/**
 * Every live slug that has no matching row in `slugs`.
 *
 * `chooseSlug` decides whether a candidate is free by consulting `slugs`
 * alone (REQ-SLUG-002), which is only correct if every live slug is also
 * recorded there — an invariant migration 005 established by backfilling and
 * every write path since maintains via `recordSlug`. Nothing enforces it
 * structurally, so this is the check rather than the assumption. See
 * REQ-SLUG-005.
 */
export async function findUnrecordedSlugs(): Promise<SlugHistoryGap[]> {
  const db = await openDbConnection();
  try {
    const gaps: SlugHistoryGap[] = [];

    for (const entityType of Object.keys(ACTIVE_SLUG_TABLE) as SlugEntity[]) {
      const table = ACTIVE_SLUG_TABLE[entityType];
      const rows = db
        .query(
          `SELECT t.id AS entity_id, t.slug AS slug
             FROM ${table} t
             LEFT JOIN slugs s
               ON s.entity_type = ? AND s.entity_id = t.id AND s.slug = t.slug
            WHERE s.id IS NULL`,
        )
        .all(entityType) as Array<{ entity_id: number; slug: string }>;

      for (const row of rows) {
        gaps.push({ entityType, entityId: row.entity_id, slug: row.slug });
      }
    }

    return gaps;
  } finally {
    db.close();
  }
}

/**
 * Fail loudly, naming every offending row, if any live slug is missing from
 * `slugs`.
 *
 * A row like this hands `chooseSlug` a false negative: it looks free by
 * history, gets offered again, and the second insert dies on the entity
 * table's own UNIQUE constraint instead of on a useful error. Called from
 * `index.ts`'s `start`, right after `runMigrations`, so a drifted database
 * fails at boot rather than on the next unlucky write. REQ-SLUG-005.
 */
export async function checkSlugHistoryInvariant(): Promise<void> {
  const gaps = await findUnrecordedSlugs();
  if (gaps.length === 0) return;

  const offenders = gaps
    .map((gap) => `${gap.entityType} #${gap.entityId} (slug "${gap.slug}")`)
    .join(', ');

  throw new Error(
    `Slug history invariant violated (REQ-SLUG-005): ${gaps.length} row(s) ` +
      `have a live slug never recorded in \`slugs\`, so chooseSlug would hand ` +
      `it out again: ${offenders}. Backfill \`slugs\` for these rows (see ` +
      'migrations/005_slug_history.sql) before the server can start.',
  );
}

export interface ResolvedSlug {
  entityId: number;
  /** The entity's slug NOW, which may differ from the one the caller asked for. */
  canonical: string;
  /** True when the caller used an old slug and should be sent to `canonical`. */
  moved: boolean;
}

/**
 * Resolve any slug an entity has ever held to that entity and its current slug.
 *
 * A chain of renames resolves in one step rather than one hop per rename: every
 * historical slug points at the entity, and the entity knows its current name,
 * so twenty old slugs all land on the newest without walking a linked list.
 *
 * Returns null when nothing has ever held this slug — a genuine 404.
 */
export async function resolveSlug(
  entityType: SlugEntity,
  slug: string,
): Promise<ResolvedSlug | null> {
  const entityId = await holderOf(entityType, slug);
  if (entityId === null) return null;

  const db = await openDbConnection();
  try {
    const row = db
      .query(`SELECT slug FROM ${ACTIVE_SLUG_TABLE[entityType]} WHERE id = ?`)
      .get(entityId) as { slug: string } | null;

    // History outliving its entity is not an error: somebody deleted the row, and
    // the slug stays claimed so it can never be reissued to something else.
    if (!row) return null;

    return { entityId, canonical: row.slug, moved: row.slug !== slug };
  } finally {
    db.close();
  }
}
