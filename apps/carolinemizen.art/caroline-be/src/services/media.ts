// Makes the smaller versions of each upload, so the site never serves the
// original file to a visitor.
//
// Photos: WebP at each width in IMAGE_WIDTHS that is smaller than the original.
// Videos: an H.264 MP4 at VIDEO_WIDTH and a WebP poster frame (needs ffmpeg).
// Both: the real width and height, and a thumbhash for the placeholder.
//
// One job runs at a time, so a large upload batch cannot use all the memory.
// The site serves the original file until the job for that image completes.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { openDbConnection } from './db';
import { storage } from './storage';

export const IMAGE_WIDTHS = [480, 960, 1600, 2400];
export const VIDEO_WIDTH = 1280;

export interface Variant {
  width: number;
  path: string;
}

interface MediaRow {
  id: number;
  filename: string;
  mime_type: string;
  storage_path: string;
  variants: string | null;
  poster_path: string | null;
}

interface MediaResult {
  width: number;
  height: number;
  thumbhash: string;
  variants: Variant[];
  posterPath: string | null;
}

/**
 * The widths to make for a source of this width. The largest version is the
 * source width or the largest standard width, whichever is smaller. A source
 * smaller than every standard width gets one version at its own width.
 */
export const variantWidths = (
  sourceWidth: number,
  widths: number[],
): number[] => {
  const smaller = widths.filter((w) => w < sourceWidth);
  const largest = widths[widths.length - 1];
  return sourceWidth <= largest ? [...smaller, sourceWidth] : smaller;
};

const thumbhashOf = async (input: Buffer): Promise<string> => {
  const { data, info } = await sharp(input)
    .autoOrient()
    .resize(100, 100, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hash = rgbaToThumbHash(info.width, info.height, data);
  return Buffer.from(hash).toString('base64');
};

const processImage = async (
  row: MediaRow,
  original: Buffer,
): Promise<MediaResult> => {
  const { width, height } = (await sharp(original).metadata()).autoOrient;
  const animated = row.mime_type === 'image/gif';
  const folder = `variants/${row.id}`;

  const variants: Variant[] = [];
  for (const w of variantWidths(width, IMAGE_WIDTHS)) {
    const output = await sharp(original, { animated })
      .autoOrient()
      .resize({ width: w })
      .webp({ quality: 80 })
      .toBuffer();
    const { path: variantPath } = await storage.upload(output, `${w}.webp`, {
      mimeType: 'image/webp',
      folder,
    });
    variants.push({ width: w, path: variantPath });
  }

  return {
    width,
    height,
    thumbhash: await thumbhashOf(original),
    variants,
    posterPath: null,
  };
};

const ffmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      (error, _stdout, stderr) => {
        if (error) reject(new Error(`ffmpeg failed: ${stderr || error}`));
        else resolve();
      },
    );
  });

const processVideo = async (
  row: MediaRow,
  original: Buffer,
): Promise<MediaResult> => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'caroline-media-'));
  try {
    const input = path.join(workDir, `input${path.extname(row.filename)}`);
    const frame = path.join(workDir, 'frame.png');
    const video = path.join(workDir, 'video.mp4');
    await writeFile(input, original);

    // The thumbnail filter picks a typical frame, so the poster is not a
    // black first frame.
    await ffmpeg(['-i', input, '-vf', 'thumbnail', '-frames:v', '1', frame]);
    const frameBuffer = await readFile(frame);
    const { width, height } = await sharp(frameBuffer).metadata();

    // libx264 with yuv420p needs an even width.
    const videoWidth = Math.floor(Math.min(VIDEO_WIDTH, width) / 2) * 2;
    await ffmpeg([
      '-i',
      input,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      `scale=${videoWidth}:-2`,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      video,
    ]);

    const folder = `variants/${row.id}`;
    const poster = await sharp(frameBuffer)
      .resize({ width: videoWidth })
      .webp({ quality: 80 })
      .toBuffer();
    const { path: posterPath } = await storage.upload(poster, 'poster.webp', {
      mimeType: 'image/webp',
      folder,
    });
    const { path: videoPath } = await storage.upload(
      await readFile(video),
      `${videoWidth}.mp4`,
      { mimeType: 'video/mp4', folder },
    );

    return {
      width,
      height,
      thumbhash: await thumbhashOf(frameBuffer),
      variants: [{ width: videoWidth, path: videoPath }],
      posterPath,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};

/**
 * The storage paths of every file that belongs to an image row: the original,
 * each variant and the poster.
 */
export const mediaFilePaths = (row: {
  storage_path: string;
  variants: string | null;
  poster_path: string | null;
}): string[] => {
  const variants: Variant[] = row.variants ? JSON.parse(row.variants) : [];
  return [
    row.storage_path,
    ...variants.map((v) => v.path),
    ...(row.poster_path ? [row.poster_path] : []),
  ];
};

/**
 * Make the variants for one image row and save them. Does nothing when the row
 * does not exist, already has variants, or is not a photo or video.
 */
export const processMedia = async (imageId: number): Promise<void> => {
  const db = await openDbConnection();
  try {
    const row = db
      .query(
        'SELECT id, filename, mime_type, storage_path, variants, poster_path FROM images WHERE id = ?',
      )
      .get(imageId) as MediaRow | null;
    if (!row || row.variants !== null) return;

    const isVideo = row.mime_type.startsWith('video/');
    if (!isVideo && !row.mime_type.startsWith('image/')) return;

    const original = await storage.read(row.storage_path);
    const result = isVideo
      ? await processVideo(row, original)
      : await processImage(row, original);

    const { changes } = db.run(
      'UPDATE images SET width = ?, height = ?, thumbhash = ?, variants = ?, poster_path = ? WHERE id = ?',
      [
        result.width,
        result.height,
        result.thumbhash,
        JSON.stringify(result.variants),
        result.posterPath,
        imageId,
      ],
    );

    // The admin deleted the image while the job ran. Delete the new files.
    if (changes === 0) {
      const paths = [
        ...result.variants.map((v) => v.path),
        ...(result.posterPath ? [result.posterPath] : []),
      ];
      await Promise.all(paths.map((p) => storage.delete(p)));
    }
  } finally {
    db.close();
  }
};

let queue: Promise<void> = Promise.resolve();

/**
 * Add an image to the processing queue. The returned promise resolves when
 * the job completes. It never rejects: a failed job logs the error, and the
 * next startup tries that image again.
 */
export const queueMediaProcessing = (imageId: number): Promise<void> => {
  queue = queue
    .then(() => processMedia(imageId))
    .catch((error) => {
      // A row without its file fails at each startup. One line is sufficient.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(
          `[Media] Skipped image ${imageId}: the original file does not exist`,
        );
        return;
      }
      console.error(`[Media] Failed to process image ${imageId}:`, error);
    });
  return queue;
};

/**
 * Queue every image that has no variants. This processes the uploads from
 * before this feature, and retries the jobs that failed.
 */
export const queueUnprocessedMedia = async (): Promise<void> => {
  const db = await openDbConnection();
  try {
    const rows = db
      .query(
        "SELECT id FROM images WHERE variants IS NULL AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%') ORDER BY id",
      )
      .all() as { id: number }[];
    if (rows.length > 0) {
      console.log(`[Media] Queued ${rows.length} image(s) for processing`);
    }
    for (const { id } of rows) queueMediaProcessing(id);
  } finally {
    db.close();
  }
};

/**
 * SQL select columns for the media fields of a joined image, named with a
 * prefix. Example: mediaColumns('i', 'cover_image') selects
 * i.thumbhash AS cover_image_thumbhash.
 */
export const mediaColumns = (alias: string, prefix: string): string =>
  ['width', 'height', 'thumbhash', 'variants', 'poster_path']
    .map((column) => `${alias}.${column} AS ${prefix}_${column}`)
    .join(', ');
