/**
 * SEAN-54 — sitemap data + XML well-formedness checks.
 *
 * Validates:
 *   1. The sitemap covers every resolved (op × from × to) page in the matrix.
 *   2. Homepage is included with priority 0.5 (lower than tool pages).
 *   3. `intentVolume` → `priority` mapping is correct (head=1.0, mid=0.7, tail=0.4).
 *   4. Every entry has a valid absolute URL, a Date `lastModified`, and
 *      `changeFrequency: 'weekly'`.
 *   5. Serialised XML (using the same structure Next.js produces) passes a
 *      well-formedness check — every <url> opens-and-closes, every <loc>
 *      contains a parseable URL, no stray angle brackets in content.
 *
 * Test runner: `node:test` invoked via the same `ts-node`-based pattern as
 * `src/components/__tests__/dead-links.test.ts`. Wired up in package.json
 * as `yarn test:sitemap` and aggregated into `yarn test`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildSitemapEntries, SITE_ORIGIN } from '../app/sitemap';
import { MATRIX } from './matrix';

// ─────────────────────────────────────────────────────── HELPERS ─────────────

/**
 * Minimal XML serialiser that mirrors what Next.js emits for a
 * `MetadataRoute.Sitemap`. We don't use Next's runtime here because we want
 * the test to be hermetic — but the shape is identical.
 *
 * If Next ever changes its emit format, the test will still cover what we
 * care about: that the *data* round-trips through standard XML escape rules
 * and the result is well-formed.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function entriesToXml(entries: ReturnType<typeof buildSitemapEntries>): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  for (const e of entries) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(e.url)}</loc>`);
    if (e.lastModified) {
      const iso =
        e.lastModified instanceof Date
          ? e.lastModified.toISOString()
          : String(e.lastModified);
      lines.push(`    <lastmod>${escapeXml(iso)}</lastmod>`);
    }
    if (e.changeFrequency) {
      lines.push(
        `    <changefreq>${escapeXml(e.changeFrequency)}</changefreq>`,
      );
    }
    if (typeof e.priority === 'number') {
      lines.push(`    <priority>${e.priority.toFixed(1)}</priority>`);
    }
    lines.push('  </url>');
  }
  lines.push('</urlset>');
  return lines.join('\n');
}

/**
 * Tag-balance + escape check. Walks the XML once with a stack: every opening
 * tag must close in LIFO order, every entity reference must be one of the
 * five XML standard ones, and no unescaped `<` may appear inside text.
 *
 * This is not a full parser — but it catches every realistic regression
 * (missing close tag, stray angle bracket from un-escaped user content,
 * malformed entity).
 */
function assertXmlWellFormed(xml: string): void {
  // Strip the prolog. After that, every `<` should start a tag.
  const body = xml.replace(/^<\?xml[^?]+\?>\s*/, '');

  const stack: string[] = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '<') {
      const close = body.indexOf('>', i);
      assert.ok(close !== -1, `unterminated tag at offset ${i}`);
      const inner = body.slice(i + 1, close);
      if (inner.startsWith('/')) {
        const name = inner.slice(1).trim();
        const top = stack.pop();
        assert.equal(
          top,
          name,
          `unbalanced close: got </${name}>, expected </${top}>`,
        );
      } else if (inner.endsWith('/')) {
        // Self-closing — fine.
      } else {
        const name = inner.split(/\s/, 1)[0];
        stack.push(name);
      }
      i = close + 1;
    } else if (c === '&') {
      const semi = body.indexOf(';', i);
      assert.ok(semi !== -1, `unterminated entity at offset ${i}`);
      const ent = body.slice(i + 1, semi);
      assert.ok(
        ['amp', 'lt', 'gt', 'quot', 'apos'].includes(ent) ||
          /^#\d+$/.test(ent) ||
          /^#x[0-9a-fA-F]+$/.test(ent),
        `unknown entity: &${ent};`,
      );
      i = semi + 1;
    } else {
      i++;
    }
  }
  assert.equal(stack.length, 0, `unclosed tags: ${stack.join(', ')}`);
}

// ─────────────────────────────────────────────────────── TESTS ───────────────

describe('SEAN-54 sitemap', () => {
  const entries = buildSitemapEntries(new Date('2026-01-01T00:00:00Z'));

  it('includes the homepage at priority 0.5', () => {
    const home = entries.find((e) => e.url === `${SITE_ORIGIN}/`);
    assert.ok(home, 'homepage entry missing');
    assert.equal(home?.priority, 0.5);
    assert.equal(home?.changeFrequency, 'weekly');
  });

  it('includes one entry per matrix row URL', () => {
    // homepage + every matrix row = total entries. URLs are unique per row
    // (no duplicates from bulk rows like `video-to-mp4` that accept many
    // inputs but share one slug).
    assert.equal(
      entries.length,
      MATRIX.length + 1,
      `expected ${MATRIX.length + 1} entries (homepage + ${MATRIX.length} rows), got ${entries.length}`,
    );
    const urls = new Set(entries.map((e) => e.url));
    assert.equal(urls.size, entries.length, 'sitemap contains duplicate URLs');
    for (const row of MATRIX) {
      // image-convert pages live under /convert/...; everything else under
      // /[operation]/...
      const prefix =
        row.operation === 'image-convert' ? '/convert' : `/${row.operation}`;
      const expected = `${SITE_ORIGIN}${prefix}/${row.slug}`;
      assert.ok(
        urls.has(expected),
        `missing sitemap URL for ${row.slug}: expected ${expected}`,
      );
    }
  });

  it('maps intentVolume to priority correctly (head=1.0, mid=0.7, tail=0.4)', () => {
    for (const e of entries) {
      // Skip homepage — its priority is the special 0.5 case.
      if (e.url === `${SITE_ORIGIN}/`) continue;
      const slug = e.url.split('/').pop();
      const row = MATRIX.find((r) => r.slug === slug);
      assert.ok(row, `no matrix row for ${slug}`);
      const expected =
        row.intentVolume === 'head'
          ? 1.0
          : row.intentVolume === 'mid'
            ? 0.7
            : 0.4;
      assert.equal(
        e.priority,
        expected,
        `${slug} (${row.intentVolume}) should be priority ${expected}, got ${e.priority}`,
      );
    }
  });

  it('every entry has a valid URL, a Date lastModified, and weekly changeFrequency', () => {
    for (const e of entries) {
      // URL parses.
      assert.doesNotThrow(() => new URL(e.url), `invalid URL: ${e.url}`);
      // lastModified is a Date.
      assert.ok(
        e.lastModified instanceof Date,
        `lastModified should be a Date for ${e.url}`,
      );
      assert.equal(e.changeFrequency, 'weekly');
      assert.ok(
        typeof e.priority === 'number' && e.priority >= 0 && e.priority <= 1,
        `priority out of range for ${e.url}: ${e.priority}`,
      );
    }
  });

  it('homepage priority is below every head/mid tool page (the SEO targets)', () => {
    // Tail variants legitimately fall below the homepage priority because the
    // homepage is still a more important crawl target than a long-tail
    // `mp4-under-8mb` slug. Per SEAN-54 AC the homepage is fixed at 0.5 and
    // tail at 0.4; the *head/mid* pages (the actual SEO targets) sit above it.
    const home = entries.find((e) => e.url === `${SITE_ORIGIN}/`);
    assert.ok(home);
    const tool = entries.filter((e) => e.url !== `${SITE_ORIGIN}/`);
    for (const e of tool) {
      const slug = e.url.split('/').pop();
      const row = MATRIX.find((r) => r.slug === slug);
      assert.ok(row);
      if (row.intentVolume === 'tail') continue;
      assert.ok(
        (home.priority ?? 0) < (e.priority ?? 0),
        `tool page ${e.url} priority (${e.priority}) should be > homepage (${home.priority})`,
      );
    }
  });

  it('serialises to well-formed XML', () => {
    const xml = entriesToXml(entries);
    // Smoke checks first: prolog, root element, expected child shape.
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org/);
    assert.match(xml, /<\/urlset>$/);
    // Tag-balance + escape check.
    assertXmlWellFormed(xml);
  });
});
