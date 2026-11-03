import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { makeSlug, RESERVED_SLUGS } from './org';
import { testApp } from './test-helpers';

let db: Database;
let close: () => Promise<void>;

beforeEach(() => {
  ({ db, close } = testApp());
});

afterEach(async () => {
  await close();
});

const addOrgRow = (slug: string) =>
  db
    .query('INSERT INTO organisation (id, slug, name) VALUES (?, ?, ?);')
    .run(crypto.randomUUID(), slug, slug);

describe('makeSlug', () => {
  test('makes lowercase ASCII with hyphens from the name', () => {
    expect(makeSlug(db, 'Acme Plumbing Ltd.')).toBe('acme-plumbing-ltd');
    expect(makeSlug(db, '  Café   Crème  ')).toBe('cafe-creme');
    expect(makeSlug(db, 'Smith & Sons')).toBe('smith-and-sons');
    expect(makeSlug(db, "Zed's Bakery")).toBe('zeds-bakery');
    expect(makeSlug(db, '日本')).toBe('org');
    expect(makeSlug(db, 'a'.repeat(100))).toBe('a'.repeat(60));
  });

  test('adds -2, -3 when the slug is taken', () => {
    addOrgRow('acme');
    expect(makeSlug(db, 'Acme')).toBe('acme-2');
    addOrgRow('acme-2');
    expect(makeSlug(db, 'ACME')).toBe('acme-3');
  });

  test('never makes a reserved word', () => {
    for (const word of [
      'login',
      'logout',
      'account',
      'orgs',
      'static',
      'api',
    ]) {
      expect(RESERVED_SLUGS.has(word)).toBe(true);
      expect(makeSlug(db, word)).toBe(`${word}-2`);
    }
  });
});
