import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTestEnv } from './setup';

getTestEnv();

/**
 * Seeding gets its own database.
 *
 * Every other suite keeps itself independent by using unique data, but a demo
 * dataset is the opposite by design: it uses fixed, recognisable names like
 * "Atelier Bloom" precisely so the seeded site reads like a real marketplace.
 * Sharing a database would mean every other suite had to dodge those names
 * forever — so this suite points DB_PATH at its own file instead.
 *
 * `openDbConnection` reads DB_PATH per call rather than at import, which is
 * what makes this possible.
 */
const seedDir = mkdtempSync(join(tmpdir(), 'inside-seed-'));
let sharedDbPath: string | undefined;

beforeAll(() => {
  sharedDbPath = process.env.DB_PATH;
  process.env.DB_PATH = seedDir;
});

afterAll(() => {
  process.env.DB_PATH = sharedDbPath;
  rmSync(seedDir, { recursive: true, force: true });
});

const { seed, RefusedInProductionError } = await import('../services/seed');
const { openDbConnection } = await import('../services/db');

const count = async (table: string): Promise<number> => {
  const db = await openDbConnection();
  try {
    return (
      db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  } finally {
    db.close();
  }
};

describe('seeding', () => {
  test('fills an empty database with browsable content', async () => {
    const result = await seed();

    expect(result.designers).toBeGreaterThan(0);
    expect(result.portfolioProjects).toBeGreaterThan(0);
    expect(result.briefs).toBeGreaterThan(0);
    expect(await count('designer_profiles')).toBeGreaterThan(0);
  });

  test('covers every profile status, so the approval gate is demonstrable', async () => {
    const db = await openDbConnection();
    const statuses = (
      db.query('SELECT DISTINCT status FROM designer_profiles').all() as Array<{
        status: string;
      }>
    ).map((r) => r.status);
    db.close();

    // A demo that only shows approved studios cannot show the gate working.
    for (const status of ['draft', 'pending', 'approved', 'rejected']) {
      expect(statuses).toContain(status);
    }
  });

  test('seeded images went through the real pipeline', async () => {
    // Rows pointing at files that do not exist would look fine in the database
    // and break the moment a page tried to render them.
    const db = await openDbConnection();
    const variants = (
      db.query('SELECT COUNT(*) AS n FROM image_variants').get() as {
        n: number;
      }
    ).n;
    const images = (
      db.query('SELECT COUNT(*) AS n FROM images').get() as { n: number }
    ).n;
    db.close();

    expect(images).toBeGreaterThan(0);
    // thumb, grid and full for every image.
    expect(variants).toBe(images * 3);
  });

  test('is idempotent — running it again changes nothing', async () => {
    const before = {
      users: await count('users'),
      profiles: await count('designer_profiles'),
      projects: await count('portfolio_projects'),
      briefs: await count('briefs'),
      bids: await count('bids'),
      images: await count('images'),
    };

    const second = await seed();
    expect(second.skipped).toBe(true);

    expect({
      users: await count('users'),
      profiles: await count('designer_profiles'),
      projects: await count('portfolio_projects'),
      briefs: await count('briefs'),
      bids: await count('bids'),
      images: await count('images'),
    }).toEqual(before);
  });

  test('refuses to run in production', async () => {
    // It writes fabricated accounts and fake portfolio work; doing that to
    // real data would be destructive, so this fails loudly rather than being
    // merely discouraged.
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(seed()).rejects.toThrow(RefusedInProductionError);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  test('every seeded address is unreachable', async () => {
    // .test is a reserved TLD, so a seeded account can never receive mail —
    // which matters the moment seeding runs somewhere with real SMTP.
    const db = await openDbConnection();
    const emails = (
      db.query('SELECT email FROM users').all() as Array<{ email: string }>
    ).map((r) => r.email);
    db.close();

    for (const email of emails) {
      expect(email.endsWith('@inside.test')).toBe(true);
    }
  });
});
