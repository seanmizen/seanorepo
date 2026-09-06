import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { getTestEnv } from './setup';

getTestEnv();

const { processAndStoreImage, VARIANT_WIDTHS } = await import(
  '../services/images'
);

const makeJpeg = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: '#8a6f47' },
  })
    .jpeg()
    .toBuffer();

describe('image derivative pipeline', () => {
  test('generates every declared variant as webp', async () => {
    const src = await makeJpeg(3000, 2000);
    const result = await processAndStoreImage(src, 'hero.jpg', {
      mimeType: 'image/jpeg',
    });

    const variants = result.variants.map((v) => v.variant).sort();
    expect(variants).toEqual(['full', 'grid', 'thumb']);
    for (const v of result.variants) {
      expect(v.url.endsWith('.webp')).toBe(true);
      expect(v.byteSize).toBeGreaterThan(0);
    }
  });

  test('resizes to the declared widths and preserves aspect ratio', async () => {
    const src = await makeJpeg(3000, 2000);
    const result = await processAndStoreImage(src, 'hero.jpg');

    for (const v of result.variants) {
      expect(v.width).toBe(VARIANT_WIDTHS[v.variant]);
      // 3:2 source, allowing a pixel of rounding.
      expect(Math.abs(v.height - v.width / 1.5)).toBeLessThanOrEqual(1);
    }
  });

  test('never upscales a source smaller than the target', async () => {
    const src = await makeJpeg(200, 150);
    const result = await processAndStoreImage(src, 'tiny.jpg');

    for (const v of result.variants) {
      expect(v.width).toBe(200);
    }
  });

  test('keeps the original alongside the derivatives', async () => {
    const src = await makeJpeg(800, 600);
    const result = await processAndStoreImage(src, 'keep.jpg');

    expect(result.original.path.endsWith('.jpg')).toBe(true);
    expect(result.original.byteSize).toBe(src.byteLength);
  });

  test('gives each upload a distinct id so filenames never collide', async () => {
    const src = await makeJpeg(400, 300);
    const a = await processAndStoreImage(src, 'same-name.jpg');
    const b = await processAndStoreImage(src, 'same-name.jpg');

    expect(a.original.path).not.toBe(b.original.path);
  });
});
