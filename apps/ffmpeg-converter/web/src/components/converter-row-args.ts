// SEAN-75 — shared row → ConverterPanel-args mapping.
//
// Both `<ToolPage />` (slug pages) and `<HeroDrop />` (homepage in-place
// converter) need to translate an `OperationRow` into the props that
// `<ConverterPanel />` expects: accept string, accept label, extraArgs, the
// reverse-tool link, etc. Extracted here so the homepage flow can reuse the
// exact same mapping the slug pages already use — no behavioural drift between
// "drop on homepage" and "drop after landing on /convert/mov-to-mp4 from
// Google".

import { MATRIX_BY_SLUG } from '@/ops/matrix';
import type { OperationRow } from '@/ops/types';
import { pathForSlug, routeExistsForSlug } from './route-registry';

/**
 * Map a Format enum to the file extension used in URLs and filenames. Most
 * formats are their own extension; the special-cases below cover the ones
 * with longer names.
 */
export function formatToExt(format: string): string {
  switch (format) {
    case 'gif-static':
      return 'gif';
    case 'webp-anim':
      return 'webp';
    default:
      return format;
  }
}

/**
 * Build the `<input accept>` attribute from the row's accepted input formats.
 * Each format maps to its `.ext` form; we don't bother with MIME types since
 * the backend validates anyway.
 */
export function buildAcceptString(row: OperationRow): string {
  return row.inputFormats.map((f) => `.${formatToExt(f)}`).join(',');
}

/**
 * Human-readable accept label for the drop zone copy. Single format → just
 * the name (`MOV`); 2-3 formats → all listed; many formats → "video file" etc.
 */
export function buildAcceptLabel(row: OperationRow): string {
  if (row.inputFormats.length === 0) return 'file';
  if (row.inputFormats.length === 1) {
    return formatToExt(row.inputFormats[0] ?? '').toUpperCase();
  }
  if (row.inputFormats.length <= 3) {
    return row.inputFormats.map((f) => formatToExt(f).toUpperCase()).join(', ');
  }
  return 'video file';
}

/**
 * Build the `extraArgs` map forwarded to the Go op. Pulls preset hints from
 * the row (CRF, target size, FPS, etc.) — the backend reads them from the
 * multipart form values.
 */
export function buildExtraArgs(
  row: OperationRow,
): Record<string, string> | undefined {
  const args: Record<string, string> = {};
  const p = row.preset;
  if (!p) return undefined;
  if (p.crf !== undefined) args.crf = String(p.crf);
  if (p.preset !== undefined) args.preset = p.preset;
  if (p.targetSizeMb !== undefined) {
    args.target_size_mb = String(p.targetSizeMb);
  }
  if (p.resolution !== undefined) args.resolution = p.resolution;
  if (p.fps !== undefined) args.fps = String(p.fps);
  if (p.audioBitrate !== undefined) args.audio_bitrate = p.audioBitrate;
  // SEAN-92: gif preset chips + customise panel forward width/dither/max_colors
  // and a start/duration trim. The Go op (`gif_from_video`) reads these from
  // the multipart form; absent fields fall through to backend defaults.
  if (p.width !== undefined) args.width = String(p.width);
  if (p.dither !== undefined) args.dither = p.dither;
  if (p.maxColors !== undefined) args.max_colors = String(p.maxColors);
  if (p.trimStartSec !== undefined) args.start = String(p.trimStartSec);
  if (p.trimDurationSec !== undefined) {
    args.duration = String(p.trimDurationSec);
  }
  return Object.keys(args).length > 0 ? args : undefined;
}

export interface ReverseLink {
  slug: string;
  label: string;
  operation: string;
}

/**
 * Find the inverse-direction row (e.g. `mov-to-mp4` → `mp4-to-mov`). Only
 * applies to two-format `convert` rows whose reverse slug is in the matrix
 * AND whose route is implemented. Returns null otherwise — the converter
 * panel hides the reverse-link CTA when this is null.
 */
export function findReverse(row: OperationRow): ReverseLink | null {
  if (row.operation !== 'convert') return null;
  if (row.inputFormats.length !== 1) return null;
  const inputExt = formatToExt(row.inputFormats[0] ?? '');
  const outputExt = formatToExt(row.outputFormat);
  const reverseSlug = `${outputExt}-to-${inputExt}`;
  const sib = MATRIX_BY_SLUG[reverseSlug];
  if (!sib) return null;
  if (!routeExistsForSlug(reverseSlug)) return null;
  return {
    slug: sib.slug,
    label: sib.h1,
    operation: sib.operation,
  };
}

export interface SiblingLink {
  slug: string;
  label: string;
  href: string;
}

/**
 * Resolve `row.related` slugs against the matrix. Used by `<ToolPage />` for
 * the "Related" sibling-link block. Lives here so it shares the same matrix
 * + route-registry gating as the rest of the row → props mapping.
 */
export function resolveSiblings(row: OperationRow): SiblingLink[] {
  const out: SiblingLink[] = [];
  for (const slug of row.related ?? []) {
    const sib = MATRIX_BY_SLUG[slug];
    if (!sib) continue;
    if (!routeExistsForSlug(slug)) continue;
    const href = pathForSlug(slug);
    if (!href) continue;
    out.push({ slug, label: sib.h1, href });
  }
  return out;
}
