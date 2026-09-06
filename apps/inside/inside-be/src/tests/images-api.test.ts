import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredImage } from '@shared/types';
import sharp from 'sharp';
import { getApp, getTestEnv, uniqueEmail } from './setup';

const app = await getApp();
const env = getTestEnv();
const { openDbConnection } = await import('../services/db');

async function login(role: 'buyer' | 'designer' = 'designer') {
  const email = uniqueEmail(role);
  const link = await app.inject({
    method: 'POST',
    url: '/api/auth/magic-link',
    payload: { email, role },
  });
  const token = new URL(
    link.json<{ devLink: string }>().devLink,
  ).searchParams.get('token') as string;
  const verified = await app.inject({
    method: 'GET',
    url: `/api/auth/verify?token=${token}`,
  });
  return verified.cookies.find((c) => c.name === 'token')?.value as string;
}

const jpeg = (w = 800, h = 600) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#8a6f47' } })
    .jpeg()
    .toBuffer();

/** Builds a multipart body by hand — inject() has no form helper. */
function multipart(
  file: Buffer,
  filename: string,
  contentType: string,
  fields: Record<string, string> = {},
) {
  const boundary = `----inside${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const upload = async (
  cookie: string,
  file: Buffer,
  filename = 'photo.jpg',
  contentType = 'image/jpeg',
  fields: Record<string, string> = {},
) => {
  const { payload, headers } = multipart(file, filename, contentType, fields);
  return app.inject({
    method: 'POST',
    url: '/api/me/images',
    cookies: { token: cookie },
    headers,
    payload,
  });
};

const storedFiles = () => {
  try {
    return readdirSync(join(env.uploadsPath, 'images'));
  } catch {
    return [];
  }
};

describe('upload', () => {
  test('stores an image and returns every srcset variant', async () => {
    const cookie = await login();
    const res = await upload(cookie, await jpeg(3000, 2000));

    expect(res.statusCode).toBe(201);
    const image = res.json<{ image: StoredImage }>().image;
    expect(Object.keys(image.variants).sort()).toEqual([
      'full',
      'grid',
      'thumb',
    ]);
    // The frontend builds a srcset straight from this — url and width, no
    // rebuilding paths at the call site.
    for (const v of Object.values(image.variants)) {
      expect(v.url).toContain('/api/uploads/images/');
      expect(v.width).toBeGreaterThan(0);
    }
  });

  test('records the original and each variant in the database', async () => {
    const cookie = await login();
    const res = await upload(cookie, await jpeg());
    const id = res.json<{ image: StoredImage }>().image.id;

    const db = await openDbConnection();
    const variants = db
      .query(
        'SELECT variant, width, height, byte_size FROM image_variants WHERE image_id = ?',
      )
      .all(id) as Array<{ width: number; height: number; byte_size: number }>;
    db.close();

    expect(variants).toHaveLength(3);
    for (const v of variants) {
      expect(v.width).toBeGreaterThan(0);
      expect(v.height).toBeGreaterThan(0);
      expect(v.byte_size).toBeGreaterThan(0);
    }
  });

  test('accepts optional alt text', async () => {
    const cookie = await login();
    const res = await upload(cookie, await jpeg(), 'photo.jpg', 'image/jpeg', {
      alt: 'A panelled hallway',
    });
    expect(res.json<{ image: StoredImage }>().image.alt).toBe(
      'A panelled hallway',
    );
  });

  test('rejects an anonymous upload', async () => {
    const { payload, headers } = multipart(
      await jpeg(),
      'photo.jpg',
      'image/jpeg',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/images',
      headers,
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  test('rejects a request with no file', async () => {
    const cookie = await login();
    const boundary = '----inside-empty';
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/images',
      cookies: { token: cookie },
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(`--${boundary}--\r\n`),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('type checking is done by decoding, not by label', () => {
  test('a text file renamed .jpg with an image mime type is rejected', async () => {
    const cookie = await login();
    // Both the extension and the declared mime type are attacker-supplied and
    // claim this is a JPEG. Only decoding the bytes catches it.
    const res = await upload(
      cookie,
      Buffer.from('#!/bin/sh\necho not an image'),
      'payload.jpg',
      'image/jpeg',
    );
    expect(res.statusCode).toBe(415);
  });

  test('a truncated, corrupt image fails cleanly rather than throwing', async () => {
    const cookie = await login();
    const corrupt = (await jpeg()).subarray(0, 40);
    const res = await upload(cookie, corrupt);
    // 415, not a 500 from an unhandled sharp throw.
    expect(res.statusCode).toBe(415);
    expect(res.json<{ error: string }>().error).toBeString();
  });

  test('an unsupported but valid image format is rejected', async () => {
    const cookie = await login();
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#fff' },
    })
      .gif()
      .toBuffer();
    const res = await upload(cookie, gif, 'anim.gif', 'image/gif');
    expect(res.statusCode).toBe(415);
  });

  test('a rejected upload leaves no rows and no files behind', async () => {
    const cookie = await login();
    const before = storedFiles().length;

    await upload(cookie, Buffer.from('nope'), 'fake.jpg', 'image/jpeg');

    const list = await app.inject({
      method: 'GET',
      url: '/api/me/images',
      cookies: { token: cookie },
    });
    expect(list.json<{ total: number }>().total).toBe(0);
    // Nothing was written before the type check, so no orphans.
    expect(storedFiles().length).toBe(before);
  });
});

describe('listing', () => {
  test('paginates and reports a total', async () => {
    const cookie = await login();
    for (let i = 0; i < 3; i++) await upload(cookie, await jpeg(200, 150));

    const page1 = await app.inject({
      method: 'GET',
      url: '/api/me/images?limit=2&page=1',
      cookies: { token: cookie },
    });
    const body1 = page1.json<{ images: StoredImage[]; total: number }>();
    expect(body1.images).toHaveLength(2);
    expect(body1.total).toBe(3);

    const page2 = await app.inject({
      method: 'GET',
      url: '/api/me/images?limit=2&page=2',
      cookies: { token: cookie },
    });
    const body2 = page2.json<{ images: StoredImage[] }>();
    expect(body2.images).toHaveLength(1);

    // No row appears on both pages.
    const ids = [...body1.images, ...body2.images].map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
  });

  test("only ever lists the caller's own images", async () => {
    const mine = await login();
    const theirs = await login();
    await upload(mine, await jpeg(200, 150));

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/images',
      cookies: { token: theirs },
    });
    expect(res.json<{ total: number }>().total).toBe(0);
  });

  test('an empty library is an empty page, not a 404', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/images',
      cookies: { token: cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ images: unknown[] }>().images).toEqual([]);
  });
});

describe('deletion', () => {
  test('removes the rows and every stored object', async () => {
    const cookie = await login();
    const created = await upload(cookie, await jpeg());
    const image = created.json<{ image: StoredImage }>().image;

    const db = await openDbConnection();
    const paths = (
      db
        .query('SELECT storage_path FROM image_variants WHERE image_id = ?')
        .all(image.id) as Array<{ storage_path: string }>
    ).map((r) => r.storage_path);
    db.close();
    expect(paths).toHaveLength(3);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/me/images/${image.id}`,
      cookies: { token: cookie },
    });
    expect(res.statusCode).toBe(204);

    const after = await openDbConnection();
    expect(
      after.query('SELECT id FROM images WHERE id = ?').get(image.id),
    ).toBeNull();
    // Cascade must take the variants with it.
    expect(
      after
        .query('SELECT id FROM image_variants WHERE image_id = ?')
        .all(image.id),
    ).toEqual([]);
    after.close();

    // And no orphaned files: neither the original nor any derivative remains.
    const remaining = storedFiles();
    for (const p of [image.path, ...paths]) {
      expect(remaining).not.toContain(p.replace('images/', ''));
    }
  });

  test("a user cannot delete another user's image", async () => {
    const owner = await login();
    const intruder = await login();
    const created = await upload(owner, await jpeg(200, 150));
    const id = created.json<{ image: StoredImage }>().image.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/me/images/${id}`,
      cookies: { token: intruder },
    });
    // 404 rather than 403, so ids cannot be probed.
    expect(res.statusCode).toBe(404);

    const still = await app.inject({
      method: 'GET',
      url: '/api/me/images',
      cookies: { token: owner },
    });
    expect(still.json<{ total: number }>().total).toBe(1);
  });

  test('deleting something that does not exist is a 404', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/me/images/999999',
      cookies: { token: cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
