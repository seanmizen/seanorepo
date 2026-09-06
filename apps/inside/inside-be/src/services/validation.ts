import type { BudgetBand, ProjectType } from '@shared/types';

/** Thrown for bad input; controllers turn it into a 400 with the message. */
export class ValidationError extends Error {}

export const BUDGET_BANDS: BudgetBand[] = [
  'under_10k',
  '10k_25k',
  '25k_50k',
  '50k_100k',
  '100k_250k',
  '250k_plus',
];

export const PROJECT_TYPES: ProjectType[] = [
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
