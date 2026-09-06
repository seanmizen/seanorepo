import type { ImageVariant, StoredImage } from '@shared/types';
import { openDbConnection } from './db';
import { type ProcessedImage, processAndStoreImage } from './images';
import { storage } from './storage';

/** Per-account ceiling, so one designer cannot fill the disk. */
export const IMAGE_QUOTA_PER_USER = Number(
  process.env.IMAGE_QUOTA_PER_USER ?? 500,
);

export class QuotaExceededError extends Error {}

interface ImageRow {
  id: number;
  owner_id: number | null;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  alt: string | null;
  created_at: string;
}

interface VariantRow {
  image_id: number;
  variant: ImageVariant;
  storage_path: string;
  width: number;
  height: number;
}

/** Shapes rows into the srcset-ready payload the frontend consumes directly. */
function toStoredImage(row: ImageRow, variants: VariantRow[]): StoredImage {
  const byVariant = {} as StoredImage['variants'];
  for (const v of variants) {
    byVariant[v.variant] = {
      url: storage.getUrl(v.storage_path),
      width: v.width,
    };
  }
  return {
    id: row.id,
    path: row.storage_path,
    variants: byVariant,
    alt: row.alt,
  };
}

export async function countImages(ownerId: number): Promise<number> {
  const db = await openDbConnection();
  try {
    return (
      db
        .query('SELECT COUNT(*) AS c FROM images WHERE owner_id = ?')
        .get(ownerId) as { c: number }
    ).c;
  } finally {
    db.close();
  }
}

/**
 * Process, store, and record one upload.
 *
 * Objects necessarily reach storage before the rows exist, so a failed insert
 * would otherwise leave files nothing references. The catch deletes everything
 * this call wrote, and the two inserts share a transaction, so the outcome is
 * either a complete image with all its variants or nothing at all.
 */
export async function addImage(
  ownerId: number,
  file: Buffer,
  filename: string,
  mimeType: string,
  alt: string | null,
): Promise<StoredImage> {
  if ((await countImages(ownerId)) >= IMAGE_QUOTA_PER_USER) {
    throw new QuotaExceededError(
      `You have reached the limit of ${IMAGE_QUOTA_PER_USER} images`,
    );
  }

  const processed: ProcessedImage = await processAndStoreImage(file, filename, {
    mimeType,
    folder: 'images',
  });

  const db = await openDbConnection();
  try {
    let imageId = 0;
    const insert = db.transaction(() => {
      db.run(
        'INSERT INTO images (owner_id, storage_path, mime_type, byte_size, alt) VALUES (?, ?, ?, ?, ?)',
        [
          ownerId,
          processed.original.path,
          mimeType,
          processed.original.byteSize,
          alt,
        ],
      );
      imageId = (
        db.query('SELECT last_insert_rowid() AS id').get() as { id: number }
      ).id;

      for (const v of processed.variants) {
        db.run(
          `INSERT INTO image_variants (image_id, variant, storage_path, width, height, byte_size)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [imageId, v.variant, v.path, v.width, v.height, v.byteSize],
        );
      }
    });

    try {
      insert();
    } catch (error) {
      // Roll the filesystem back to match the database.
      await storage.delete(processed.original.path);
      await Promise.all(processed.variants.map((v) => storage.delete(v.path)));
      throw error;
    }

    const row = db
      .query('SELECT * FROM images WHERE id = ?')
      .get(imageId) as ImageRow;
    const variants = db
      .query('SELECT * FROM image_variants WHERE image_id = ?')
      .all(imageId) as VariantRow[];
    return toStoredImage(row, variants);
  } finally {
    db.close();
  }
}

export async function listImages(
  ownerId: number,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ images: StoredImage[]; total: number }> {
  const db = await openDbConnection();
  try {
    const total = (
      db
        .query('SELECT COUNT(*) AS c FROM images WHERE owner_id = ?')
        .get(ownerId) as { c: number }
    ).c;

    const rows = db
      .query(
        // id as tie-breaker so paging stays stable when rows share a timestamp.
        `SELECT * FROM images WHERE owner_id = ?
         ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(ownerId, limit, offset) as ImageRow[];

    if (rows.length === 0) return { images: [], total };

    const placeholders = rows.map(() => '?').join(',');
    const variants = db
      .query(`SELECT * FROM image_variants WHERE image_id IN (${placeholders})`)
      .all(...rows.map((r) => r.id)) as VariantRow[];

    return {
      images: rows.map((row) =>
        toStoredImage(
          row,
          variants.filter((v) => v.image_id === row.id),
        ),
      ),
      total,
    };
  } finally {
    db.close();
  }
}

export async function findOwnedImage(
  id: number,
  ownerId: number,
): Promise<ImageRow | null> {
  const db = await openDbConnection();
  try {
    const row = db
      .query('SELECT * FROM images WHERE id = ? AND owner_id = ?')
      .get(id, ownerId) as ImageRow | null;
    return row ?? null;
  } finally {
    db.close();
  }
}

/**
 * Delete an image, its variants, and every stored object.
 *
 * Storage is cleared first: if the row went first and a delete then failed we
 * would have files nothing references and no record to find them by. Doing it
 * this way, a failure leaves a row whose objects are already gone — visible,
 * and fixable — rather than invisible litter.
 */
export async function deleteImage(id: number): Promise<void> {
  const db = await openDbConnection();
  try {
    const image = db
      .query('SELECT storage_path FROM images WHERE id = ?')
      .get(id) as { storage_path: string } | null;
    if (!image) return;

    const variants = db
      .query('SELECT storage_path FROM image_variants WHERE image_id = ?')
      .all(id) as Array<{ storage_path: string }>;

    await storage.delete(image.storage_path);
    await Promise.all(variants.map((v) => storage.delete(v.storage_path)));

    // image_variants rows go with it via ON DELETE CASCADE.
    db.run('PRAGMA foreign_keys = ON');
    db.run('DELETE FROM images WHERE id = ?', [id]);
  } finally {
    db.close();
  }
}
