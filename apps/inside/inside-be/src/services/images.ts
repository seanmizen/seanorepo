import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ImageVariant } from '@shared/types';
import sharp from 'sharp';
import { storage } from './storage';

/**
 * Widths generated for every upload. A luxury portfolio site is judged on its
 * imagery, so we serve a real srcset rather than shipping one huge original to
 * a phone.
 *
 * `full` is capped rather than upscaled — an image smaller than the target is
 * left at its natural width (see `withoutEnlargement`).
 */
export const VARIANT_WIDTHS: Record<ImageVariant, number> = {
  thumb: 400,
  grid: 900,
  full: 2000,
};

export interface GeneratedVariant {
  variant: ImageVariant;
  path: string;
  url: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface ProcessedImage {
  /** The untouched upload, kept so we can regenerate variants later. */
  original: { path: string; url: string; byteSize: number };
  variants: GeneratedVariant[];
}

/** Formats we accept, decided by decoding the bytes rather than trusting labels. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

const FORMAT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export class UnsupportedImageError extends Error {}

/**
 * Identify an upload by decoding it.
 *
 * The declared mime type and the filename extension are both attacker-supplied
 * and prove nothing — a .exe renamed to .jpg carries `image/jpeg` quite
 * happily. sharp either decodes the bytes or it does not, which is the only
 * answer worth having. A corrupt or non-image file fails here with a clean
 * error rather than an unhandled throw deeper in the pipeline.
 */
export async function identifyImage(file: Buffer): Promise<{
  format: string;
  mimeType: string;
  width: number;
  height: number;
}> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(file).metadata();
  } catch {
    throw new UnsupportedImageError('That file could not be read as an image');
  }

  const format = metadata.format ?? '';
  if (!ACCEPTED_FORMATS.has(format)) {
    throw new UnsupportedImageError(
      `Unsupported image type. Accepted formats: ${[...ACCEPTED_FORMATS].join(', ')}`,
    );
  }
  if (!metadata.width || !metadata.height) {
    throw new UnsupportedImageError('That image has no readable dimensions');
  }

  return {
    format,
    mimeType: FORMAT_MIME[format],
    width: metadata.width,
    height: metadata.height,
  };
}

/**
 * Store an uploaded image and its derivatives.
 *
 * Derivatives are WebP — every browser we care about supports it, and it
 * roughly halves the bytes at the same perceived quality.
 *
 * Note this sits *above* the storage provider: it calls `storage.upload` once
 * per artefact and never touches the filesystem itself, so it keeps working
 * unchanged when local disk is swapped for S3.
 */
export async function processAndStoreImage(
  file: Buffer,
  originalFilename: string,
  options?: { mimeType?: string; folder?: string },
): Promise<ProcessedImage> {
  const folder = options?.folder ?? 'images';
  const id = randomUUID();
  const extension = path.extname(originalFilename) || '.bin';

  const original = await storage.upload(file, `${id}-original${extension}`, {
    mimeType: options?.mimeType,
    folder,
  });

  const variants: GeneratedVariant[] = [];

  for (const [variant, width] of Object.entries(VARIANT_WIDTHS) as Array<
    [ImageVariant, number]
  >) {
    const { data, info } = await sharp(file)
      .rotate() // honour EXIF orientation before resizing
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    const stored = await storage.upload(data, `${id}-${variant}.webp`, {
      mimeType: 'image/webp',
      folder,
    });

    variants.push({
      variant,
      path: stored.path,
      url: stored.url,
      width: info.width,
      height: info.height,
      byteSize: info.size,
    });
  }

  return {
    original: { ...original, byteSize: file.byteLength },
    variants,
  };
}
