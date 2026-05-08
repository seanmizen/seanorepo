// File → tool-page routing.
//
// Given a dropped file, return the canonical tool-page path the homepage
// should send the user to. Spec §7.1: "dropping a .mov on the homepage routes
// to /convert/mov-to-mp4".
//
// SEAN-50: every candidate target must resolve to an existing route. We gate
// the lookup on `MATRIX_BY_SLUG` and `IMPLEMENTED_OPERATION_ROUTES` rather
// than maintaining a hand-rolled extension map that drifts out of sync with
// the matrix. Anything not covered by the matrix returns `null`, and the
// caller surfaces a "we don't recognise this format yet" message.

import { MATRIX, MATRIX_BY_SLUG } from '@/ops/matrix';
import type { Format, OperationRow } from '@/ops/types';
import { pathForSlug, routeExistsForSlug } from './route-registry';

/**
 * Default target output for each input extension. The matrix decides whether
 * a `${ext}-to-${target}` slug actually exists — these are just preference
 * hints (e.g. iPhone HEIC photos default to JPG, not WebP, because that's
 * what most users actually want).
 */
const PREFERRED_TARGET_BY_EXT: Record<string, Format> = {
  // Video: MP4 is the universal default.
  mov: 'mp4',
  webm: 'mp4',
  mkv: 'mp4',
  avi: 'mp4',
  flv: 'mp4',
  wmv: 'mp4',
  m4v: 'mp4',
  mpeg: 'mp4',
  mpg: 'mp4',
  // MP4 → WebM (browser-native, smaller).
  mp4: 'webm',

  // Image: WebP for the modern web; HEIC defaults to JPG (compatibility).
  jpg: 'webp',
  jpeg: 'webp',
  png: 'webp',
  heic: 'jpg',
  heif: 'jpg',
  bmp: 'jpg',
  tiff: 'jpg',
  tif: 'jpg',

  // Audio: MP3 is universal.
  wav: 'mp3',
  flac: 'mp3',
  aac: 'mp3',
  ogg: 'mp3',
  m4a: 'mp3',
  opus: 'mp3',
};

// Some input extensions normalise to a different `Format` enum value (the
// matrix uses canonical names). Phase 1 only needs `jpeg → jpg`, `mpg → mpeg`,
// `tif → tiff`, `heif → heic`. Anything else is a one-to-one mapping.
const EXT_TO_FORMAT: Record<string, string> = {
  jpeg: 'jpg',
  mpg: 'mpeg',
  tif: 'tiff',
  heif: 'heic',
};

/**
 * Lowercase extension without the leading dot, or `''` if the filename has no
 * extension.
 */
export function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Pick the tool-page path to route to for a given file. Returns `null` when
 *   - the file has no extension
 *   - the extension isn't in our preference table
 *   - the matrix has no `${ext}-to-${target}` row
 *   - the matrix row exists but its operation route isn't implemented yet
 *
 * The caller should surface a friendly "we don't recognise this format yet"
 * message rather than dumping the user on a 404.
 */
export function routeForFile(file: File | { name: string }): string | null {
  const match = matrixRowForFile(file);
  if (!match) return null;
  return pathForSlug(match.row.slug);
}

/**
 * Resolved matrix row for a dropped file. Used by SEAN-75's homepage in-place
 * conversion: instead of routing to a slug page (which loses the File object),
 * the homepage drop zone runs the conversion right there with the row's
 * backend op + output format already wired in.
 */
export interface MatrixRowMatch {
  row: OperationRow;
  /** Resolved input `Format` enum value (after `EXT_TO_FORMAT` normalisation). */
  inputFormat: Format;
}

/**
 * Look up the matrix row that corresponds to a given dropped file. Returns
 * `null` under the same conditions as `routeForFile` (no extension, no
 * preferred target, no matching row, or the row's operation route isn't
 * implemented yet).
 *
 * Mirrors `routeForFile`'s preference order: direct `${input}-to-${target}`
 * slug first, then a multi-input fallback row (e.g. `video-to-mp4`).
 */
export function matrixRowForFile(
  file: File | { name: string },
): MatrixRowMatch | null {
  const ext = extOf(file.name);
  if (!ext) return null;

  const inputFormat = (EXT_TO_FORMAT[ext] ?? ext) as Format;
  const target = PREFERRED_TARGET_BY_EXT[ext];
  if (!target) return null;

  const directSlug = `${inputFormat}-to-${target}`;
  const directRow = MATRIX_BY_SLUG[directSlug];
  if (directRow && routeExistsForSlug(directSlug)) {
    return { row: directRow, inputFormat };
  }

  // Fall back to multi-input rows like `video-to-mp4` (covers mkv/avi/flv/wmv
  // /m4v/mpeg → mp4 from a single matrix row).
  for (const row of MATRIX) {
    if (row.operation !== 'convert') continue;
    if (row.outputFormat !== target) continue;
    if (!row.inputFormats.includes(inputFormat)) continue;
    if (!MATRIX_BY_SLUG[row.slug]) continue;
    if (!routeExistsForSlug(row.slug)) continue;
    return { row, inputFormat };
  }

  return null;
}
