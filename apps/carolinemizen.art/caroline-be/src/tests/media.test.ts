import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDbConnection } from '../services/db';
import {
  IMAGE_WIDTHS,
  mediaFilePaths,
  queueMediaProcessing,
  queueUnprocessedMedia,
  type Variant,
  variantWidths,
} from '../services/media';
import { storage } from '../services/storage';

interface ImageRow {
  id: number;
  width: number | null;
  height: number | null;
  thumbhash: string | null;
  variants: string | null;
  poster_path: string | null;
  storage_path: string;
}

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const insertUpload = async (
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<number> => {
  const { path: storagePath } = await storage.upload(buffer, filename, {
    mimeType,
    folder: 'images',
  });
  const db = await openDbConnection();
  try {
    db.run(
      `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
       VALUES (?, ?, ?, ?, ?)`,
      [filename, filename, mimeType, buffer.length, storagePath],
    );
    return (
      db.query('SELECT last_insert_rowid() as id').get() as { id: number }
    ).id;
  } finally {
    db.close();
  }
};

const getRow = async (id: number): Promise<ImageRow> => {
  const db = await openDbConnection();
  try {
    return db.query('SELECT * FROM images WHERE id = ?').get(id) as ImageRow;
  } finally {
    db.close();
  }
};

const removeFiles = async (row: ImageRow) => {
  await Promise.all(mediaFilePaths(row).map((p) => storage.delete(p)));
};

const solidJpeg = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: '#c0603a' },
  })
    .jpeg()
    .toBuffer();

describe('variantWidths', () => {
  test('uses every standard width below a large source', () => {
    expect(variantWidths(4000, IMAGE_WIDTHS)).toEqual([480, 960, 1600, 2400]);
  });

  test('ends at the source width when the source is smaller', () => {
    expect(variantWidths(1200, IMAGE_WIDTHS)).toEqual([480, 960, 1200]);
  });

  test('makes one version at the source width for a tiny source', () => {
    expect(variantWidths(300, IMAGE_WIDTHS)).toEqual([300]);
  });

  test('does not make the same width two times', () => {
    expect(variantWidths(2400, IMAGE_WIDTHS)).toEqual([480, 960, 1600, 2400]);
  });
});

describe('processMedia', () => {
  test('makes WebP variants, dimensions and a thumbhash for a photo', async () => {
    const id = await insertUpload(
      await solidJpeg(3000, 2000),
      'photo-large.jpg',
      'image/jpeg',
    );
    await queueMediaProcessing(id);
    const row = await getRow(id);

    expect(row.width).toBe(3000);
    expect(row.height).toBe(2000);
    expect(row.thumbhash).toBeTruthy();
    expect(row.poster_path).toBeNull();

    const variants: Variant[] = JSON.parse(row.variants ?? '[]');
    expect(variants.map((v) => v.width)).toEqual(IMAGE_WIDTHS);
    for (const variant of variants) {
      const meta = await sharp(await storage.read(variant.path)).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(variant.width);
    }

    await removeFiles(row);
  });

  test('records the displayed dimensions of a rotated photo', async () => {
    // EXIF orientation 6 means "rotate 90 degrees to display".
    const rotated = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#000' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const id = await insertUpload(rotated, 'photo-rotated.jpg', 'image/jpeg');
    await queueMediaProcessing(id);
    const row = await getRow(id);

    expect(row.width).toBe(200);
    expect(row.height).toBe(300);
    const [variant]: Variant[] = JSON.parse(row.variants ?? '[]');
    const meta = await sharp(await storage.read(variant.path)).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(300);

    await removeFiles(row);
  });

  test.skipIf(!hasFfmpeg)(
    'makes a poster and a smaller MP4 for a video',
    async () => {
      const workDir = mkdtempSync(path.join(tmpdir(), 'caroline-media-test-'));
      try {
        const source = path.join(workDir, 'source.mp4');
        execFileSync('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=1921x1080:rate=10:duration=1',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv444p',
          source,
        ]);
        const id = await insertUpload(
          readFileSync(source),
          'clip.mp4',
          'video/mp4',
        );
        await queueMediaProcessing(id);
        const row = await getRow(id);

        expect(row.width).toBe(1921);
        expect(row.height).toBe(1080);
        expect(row.thumbhash).toBeTruthy();
        expect(row.poster_path).toBeTruthy();

        const variants: Variant[] = JSON.parse(row.variants ?? '[]');
        expect(variants).toHaveLength(1);
        expect(variants[0].width).toBe(1280);
        expect((await storage.read(variants[0].path)).length).toBeGreaterThan(
          0,
        );

        await removeFiles(row);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    30000,
  );

  test('queueUnprocessedMedia processes old uploads and skips done ones', async () => {
    const id = await insertUpload(
      await solidJpeg(800, 600),
      'photo-old.jpg',
      'image/jpeg',
    );

    await queueUnprocessedMedia();
    await queueMediaProcessing(-1); // Resolves after the queued jobs.
    const first = await getRow(id);
    expect(first.variants).toBeTruthy();

    await queueUnprocessedMedia();
    await queueMediaProcessing(-1);
    const second = await getRow(id);
    expect(second.variants).toBe(first.variants);

    await removeFiles(second);
  });

  test('skips a file that is not a photo or video', async () => {
    const id = await insertUpload(
      Buffer.from('not media'),
      'notes.txt',
      'application/octet-stream',
    );
    await queueMediaProcessing(id);
    const row = await getRow(id);

    expect(row.variants).toBeNull();
    await removeFiles(row);
  });
});
