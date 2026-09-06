import { toQueryString } from '@shared/filters';
import { useQueryStates } from 'nuqs';
import { parseAsString } from 'nuqs/server';
import { useCallback, useMemo } from 'react';
import type { z } from 'zod';

/**
 * URL-backed filter state, driven by a schema shared with the server.
 *
 * The schema in `shared/filters.ts` is the single source: the server validates
 * `request.query` with it and this hook parses the URL with it, so the two can
 * never disagree about what a filter means or which values are legal.
 *
 * nuqs handles the URL itself — reading, writing, batching and history. This
 * hook keeps every param as a raw string at that layer and lets Zod do the
 * parsing, so there is exactly ONE implementation of "what does this query
 * string mean" rather than a client copy that drifts.
 */
export function useFilters<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  const keys = useMemo(() => Object.keys(schema.shape), [schema]);

  const parsers = useMemo(
    () =>
      Object.fromEntries(keys.map((key) => [key, parseAsString])) as Record<
        string,
        typeof parseAsString
      >,
    [keys],
  );

  const [raw, setRaw] = useQueryStates(parsers, {
    // A filter tweak is not a navigation. Pushing every keystroke would make
    // the back button walk through a dozen states instead of leaving the page.
    history: 'replace',
  });

  /**
   * Parsed values, or the defaults.
   *
   * A URL someone hand-edited into nonsense should not blank the page — the
   * server is the authority on rejecting bad input, and it will. Here the
   * safest readable state is the defaults.
   */
  const values = useMemo(() => {
    const present = Object.fromEntries(
      Object.entries(raw).filter(([, value]) => value !== null),
    );
    const parsed = schema.safeParse(present);
    return parsed.success
      ? (parsed.data as z.infer<T>)
      : (schema.parse({}) as z.infer<T>);
  }, [raw, schema]);

  /** Merge a partial change into the URL, dropping anything now empty. */
  const setFilters = useCallback(
    (patch: Partial<Record<keyof z.infer<T> & string, unknown>>) => {
      const next: Record<string, string | null> = {};
      for (const key of keys) {
        if (!(key in patch)) continue;
        const value = patch[key as keyof typeof patch];
        next[key] =
          value === undefined ||
          value === null ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)
            ? null
            : Array.isArray(value)
              ? value.join(',')
              : String(value);
      }
      // Any filter change returns to the first page: page 7 of the old result
      // set is meaningless against the new one.
      if (!('page' in patch) && keys.includes('page')) next.page = null;
      setRaw(next);
    },
    [keys, setRaw],
  );

  /** The canonical query string for the current state, for links and canonicals. */
  const queryString = useMemo(
    () => toQueryString(values as Record<string, unknown>, schema.parse({})),
    [values, schema],
  );

  return { values, setFilters, queryString };
}
