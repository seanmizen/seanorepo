import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { makeSlug, resolveSlug } from './org';
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

  test('never makes "new", the one reserved slug, and keeps its own slug on an edit', () => {
    expect(makeSlug(db, 'New')).toBe('new-2');
    // The other words of the crm are free: each organisation is under /orgs/.
    expect(makeSlug(db, 'Login')).toBe('login');
    const id = crypto.randomUUID();
    db.query('INSERT INTO organisation (id, slug, name) VALUES (?, ?, ?);').run(
      id,
      'acme',
      'Acme',
    );
    expect(makeSlug(db, 'Acme', id)).toBe('acme');
    expect(makeSlug(db, 'Acme')).toBe('acme-2');
  });
});

describe('resolveSlug', () => {
  test('an empty URL slug comes from the name, and a typed one must be free', () => {
    addOrgRow('acme');
    expect(resolveSlug(db, { slug: '', name: 'Acme' })).toEqual({
      slug: 'acme-2',
    });
    expect(resolveSlug(db, { slug: 'acme', name: 'Other' })).toEqual({
      error: 'Another organisation has this URL slug.',
    });
    expect(resolveSlug(db, { slug: 'acme-west', name: 'Acme' })).toEqual({
      slug: 'acme-west',
    });
  });
});
