import type {
  Availability,
  BudgetBand,
  DesignerSort,
  Timeline,
  WorkType,
} from '@shared/types';

/** Thrown for bad input. Controllers turn it into a 400 with the message. */
export class ValidationError extends Error {}

export const BUDGET_BANDS: BudgetBand[] = [
  'under_10k',
  '10k_25k',
  '25k_50k',
  '50k_100k',
  '100k_250k',
  '250k_plus',
];

export const WORK_TYPES: WorkType[] = [
  'full_home',
  'single_room',
  'kitchen',
  'bathroom',
  'extension',
  'new_build',
  'renovation',
  'commercial',
  'styling',
  'other',
];

export const TIMELINES: Timeline[] = [
  'asap',
  'within_3_months',
  'within_6_months',
  'within_12_months',
  'exploring',
];

/** A designer's availability. Narrower than a buyer's timeline: no 'exploring'. */
export const AVAILABILITIES: Availability[] = [
  'asap',
  'within_3_months',
  'within_6_months',
  'within_12_months',
];

export function requiredString(
  value: unknown,
  field: string,
  max = 200,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ValidationError(`${field} must be ${max} characters or fewer`);
  }
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  max = 2000,
): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be text`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ValidationError(`${field} must be ${max} characters or fewer`);
  }
  return trimmed || null;
}

/**
 * Only http(s) is accepted. Without the protocol check a stored
 * `javascript:...` value would become a live XSS vector the moment it is
 * rendered as an href.
 */
export function optionalUrl(value: unknown, field: string): string | null {
  const raw = optionalString(value, field, 500);
  if (raw === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`${field} must be an http or https URL`);
  }
  return parsed.toString();
}

export function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: T[],
): T | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export const DESIGNER_SORTS: DesignerSort[] = [
  'relevance',
  'newest',
  'oldest',
  'name',
];

/**
 * A whole number from a query string, inside `[min, max]`.
 *
 * Absent means "use the default". Present but not a plain non-negative integer
 * — `?page=abc`, `?limit=-1`, `?limit=1e3` — is rejected rather than coerced.
 * `Number('12abc')` is NaN and `Number('')` is 0, so a permissive parse turns a
 * typo into a silently different page, which is exactly the class of bug that
 * makes a paginated list look like it is losing rows.
 *
 * A value outside the range is a 400 rather than being clamped, so a client
 * asking for 500 results learns the ceiling instead of quietly getting a short
 * page and paginating wrongly on it.
 */
export function boundedInt(
  value: unknown,
  field: string,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ValidationError(`${field} must be a whole number`);
  }
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError(`${field} must be a whole number`);
  }
  const parsed = Number(raw);
  if (parsed < min || parsed > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}`);
  }
  return parsed;
}

export function optionalYear(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const year = Number(value);
  const nextYear = new Date().getFullYear() + 1;
  if (!Number.isInteger(year) || year < 1900 || year > nextYear) {
    throw new ValidationError(
      `${field} must be a year between 1900 and ${nextYear}`,
    );
  }
  return year;
}

/**
 * An optional instant, normalised to SQLite's UTC `YYYY-MM-DD HH:MM:SS`.
 *
 * Storing the client's raw string would leave a column that cannot be compared
 * with `CURRENT_TIMESTAMP`, so a deadline would silently never expire.
 */
export function optionalDateTime(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ValidationError(`${field} must be a date`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${field} must be a valid date`);
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** `now` in the same shape as `optionalDateTime`, so the two compare directly. */
export const sqliteNow = (): string =>
  new Date().toISOString().slice(0, 19).replace('T', ' ');
