import { describe, expect, test } from 'bun:test';
import {
  adminDesignerFilters,
  briefFilters,
  designerFilters,
  toQueryString,
} from '@shared/filters';

const parse = (query: Record<string, unknown>) =>
  designerFilters.safeParse(query);

describe('multi-value params accept both conventions', () => {
  test('a comma list becomes an array', () => {
    const result = parse({ workTypes: 'kitchen,bathroom' });
    expect(result.success && result.data.workTypes).toEqual([
      'kitchen',
      'bathroom',
    ]);
  });

  test('repeated keys become the same array', () => {
    // Fastify hands repeated keys through as an array. A hand-written link or
    // another service may use either convention, so both must work.
    const result = parse({ workTypes: ['kitchen', 'bathroom'] });
    expect(result.success && result.data.workTypes).toEqual([
      'kitchen',
      'bathroom',
    ]);
  });

  test('the two forms produce identical results', () => {
    const comma = parse({ workTypes: 'kitchen,bathroom' });
    const repeated = parse({ workTypes: ['kitchen', 'bathroom'] });
    expect(comma).toEqual(repeated);
  });

  test('whitespace and empty entries are tolerated', () => {
    const result = parse({ workTypes: ' kitchen , ,bathroom ' });
    expect(result.success && result.data.workTypes).toEqual([
      'kitchen',
      'bathroom',
    ]);
  });

  test('an unknown value in the list is rejected, not dropped', () => {
    // Silently ignoring it would return results the caller did not ask for.
    const result = parse({ workTypes: 'kitchen,teleportation' });
    expect(result.success).toBe(false);
  });

  test('an empty value is absent rather than an empty filter', () => {
    const result = parse({ workTypes: '' });
    expect(result.success && result.data.workTypes).toBeUndefined();
  });
});

describe('unknown params are stripped, never rejected', () => {
  test('campaign tags do not 400 a landing page', () => {
    // The whole point: ?utm_source=instagram must not break a marketed link.
    const result = parse({
      workTypes: 'kitchen',
      utm_source: 'instagram',
      utm_campaign: 'spring',
      fbclid: 'abc123',
    });
    expect(result.success).toBe(true);
    expect(result.success && 'utm_source' in result.data).toBe(false);
  });
});

describe('bounded integers reject rather than clamp', () => {
  test('out-of-range is a failure, not a silent default', () => {
    // Clamping hands back a page the caller cannot tell is wrong.
    expect(parse({ limit: '9999' }).success).toBe(false);
    expect(parse({ page: '0' }).success).toBe(false);
  });

  test('non-numeric is a failure', () => {
    for (const limit of ['abc', '1e3', '-1', '1.5', ' 12']) {
      expect(parse({ limit }).success).toBe(false);
    }
  });

  test('absent falls back to the documented default', () => {
    const result = parse({});
    expect(result.success && result.data.page).toBe(1);
    expect(result.success && result.data.limit).toBe(24);
  });

  test('every endpoint shares the policy', () => {
    // Admin used to clamp with Math.min/Math.max, so ?limit=abc became 25.
    expect(adminDesignerFilters.safeParse({ limit: 'abc' }).success).toBe(
      false,
    );
    expect(briefFilters.safeParse({ limit: '99999' }).success).toBe(false);
  });
});

describe('text params', () => {
  test('are trimmed, and empty means absent', () => {
    const result = parse({ q: '  townhouse  ' });
    expect(result.success && result.data.q).toBe('townhouse');
    expect(
      parse({ q: '' }).success && parse({ q: '' }).data?.q,
    ).toBeUndefined();
  });

  test('over-long input is rejected', () => {
    expect(parse({ q: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('toQueryString produces one canonical URL', () => {
  test('omits defaults and empties', () => {
    expect(
      toQueryString(
        { page: 1, limit: 24, q: undefined },
        { page: 1, limit: 24 },
      ),
    ).toBe('');
  });

  test('joins arrays with commas', () => {
    expect(toQueryString({ workTypes: ['kitchen', 'bathroom'] })).toBe(
      '?workTypes=kitchen%2Cbathroom',
    );
  });

  test('drops empty arrays', () => {
    expect(toQueryString({ workTypes: [] })).toBe('');
  });

  test('round-trips through the schema', () => {
    const original = { workTypes: ['kitchen'], q: 'townhouse', page: 3 };
    const query = toQueryString(original, { page: 1, limit: 24 });
    const back = designerFilters.safeParse(
      Object.fromEntries(new URLSearchParams(query.slice(1))),
    );
    expect(back.success && back.data.workTypes).toEqual(['kitchen']);
    expect(back.success && back.data.q).toBe('townhouse');
    expect(back.success && back.data.page).toBe(3);
  });
});
