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
//
// SEAN-78: reconciled the routing table with every matrix input format so
// dropping an image (avif/webp) or audio file no longer falls through to
// the friendly-error path. The audio family is routed to `/normalize-audio/`
// because the matrix today has no audio-to-audio convert rows — that gap is
// documented in `AUDIO_FALLBACK_NOTE` below.

import { MATRIX, MATRIX_BY_SLUG } from '@/ops/matrix';
import type { Format, OperationRow } from '@/ops/types';
import { KIND_OF } from '@/ops/types';
import { pathForSlug, routeExistsForSlug } from './route-registry';

/**
 * Default target output for each input extension. The matrix decides whether
 * a `${ext}-to-${target}` slug actually exists — these are just preference
 * hints (e.g. iPhone HEIC photos default to JPG, not WebP, because that's
 * what most users actually want).
 *
 * SEAN-78: every input format the matrix can handle has an entry here. The
 * `route-for-file.test.ts` test asserts this invariant so future matrix
 * additions can't quietly drop off the homepage drop zone.
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
  '3gp': 'mp4',
  ts: 'mp4',
  mts: 'mp4',
  m2ts: 'mp4',
  ogv: 'mp4',
  vob: 'mp4',
  // MP4 → WebM (browser-native, smaller).
  mp4: 'webm',

  // Image: WebP for the modern web; HEIC/AVIF/legacy formats default to JPG
  // for compatibility (Discord previews, Outlook attachments, older CMSes).
  // Note: bmp/tiff/tif aren't matrix inputs today — dropping one returns null,
  // which fires the friendly-error path. Add them here if/when the matrix
  // grows a row that accepts them.
  jpg: 'webp',
  jpeg: 'webp',
  png: 'webp',
  heic: 'jpg',
  heif: 'jpg',
  avif: 'jpg',
  webp: 'jpg',

  // Audio: the matrix has no audio-to-audio `convert` rows today — every
  // audio input lands on `/normalize-audio/normalize-audio` which is the only
  // audio→audio op currently implemented. Once audio-convert rows ship, swap
  // these targets to the appropriate format. See `AUDIO_FALLBACK_NOTE`.
  mp3: 'wav',
  wav: 'wav',
  flac: 'wav',
  aac: 'wav',
  ogg: 'wav',
  m4a: 'wav',
  opus: 'wav',
};

// Some input extensions normalise to a different `Format` enum value (the
// matrix uses canonical names). Phase 1 only needs `jpeg → jpg`, `mpg → mpeg`,
// `heif → heic`. Anything else is a one-to-one mapping.
//
// `tif → tiff` was here historically but neither `tif` nor `tiff` is a matrix
// `Format`, so `routeForFile('.tif')` always returned null. Dropped from this
// map until the matrix grows TIFF support.
const EXT_TO_FORMAT: Record<string, string> = {
  jpeg: 'jpg',
  mpg: 'mpeg',
  heif: 'heic',
};

/**
 * Operations whose matrix rows are eligible as "did the user drop a file we
 * can convert?" targets. `convert` covers the bulk of video/audio conversion;
 * `image-convert` covers JPG/PNG/HEIC/etc.; `normalize-audio` is the bridge
 * we use today for audio inputs since the matrix has no audio-to-audio
 * convert rows.
 */
const ROUTABLE_OPERATIONS: ReadonlySet<string> = new Set([
  'convert',
  'image-convert',
  'normalize-audio',
]);

/**
 * Documents the matrix gap: there are no audio→audio `convert` rows. Routing
 * audio drops to `normalize-audio` is the least-bad fallback — it's a real
 * audio-out page that accepts every common audio input, even if the user
 * actually wanted a transcode rather than a loudness adjustment. When audio
 * convert rows ship, drop this fallback and update PREFERRED_TARGET_BY_EXT
 * to point at the new convert slugs.
 */
export const AUDIO_FALLBACK_NOTE =
  'No audio-to-audio convert rows in the matrix yet — audio drops fall back to /normalize-audio/.';

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
 *   - the matrix has no row that accepts the (input, target) pair
 *   - the matrix row exists but its operation route isn't implemented yet
 *
 * The caller should surface a friendly "we don't recognise this format yet"
 * message rather than dumping the user on a 404 — see `friendlyDropError`.
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

  // Try the direct `${input}-to-${target}` slug first — covers the bulk of
  // single-input convert/extract-audio rows.
  const directSlug = `${inputFormat}-to-${target}`;
  const directRow = MATRIX_BY_SLUG[directSlug];
  if (directRow && routeExistsForSlug(directSlug)) {
    return { row: directRow, inputFormat };
  }

  // Fall back to multi-input rows. `convert` rows like `video-to-mp4` cover
  // mkv/avi/flv/wmv/m4v/mpeg → mp4 from a single row. `image-convert` rows
  // like `image-to-jpg` cover jpg/png/heic/webp/avif → jpg. `normalize-audio`
  // accepts every audio format and outputs wav.
  for (const row of MATRIX) {
    if (!ROUTABLE_OPERATIONS.has(row.operation)) continue;
    if (row.outputFormat !== target) continue;
    if (!row.inputFormats.includes(inputFormat)) continue;
    if (!MATRIX_BY_SLUG[row.slug]) continue;
    if (!routeExistsForSlug(row.slug)) continue;
    return { row, inputFormat };
  }

  return null;
}

/**
 * Build a friendly error message for a dropped file we can't route. Lists the
 * matrix-supported input families ("video, audio, images") plus a few
 * representative extensions so the user knows what _will_ work — instead of
 * the old "Try MOV, MP4, WebM, ..." message that named only video formats.
 *
 * Caller is `HeroDrop.handleFile`; pure function so it's easy to unit-test.
 */
export function friendlyDropError(filename: string): string {
  const ext = extOf(filename);
  if (!ext) {
    return "That file doesn't have an extension we can route on.";
  }
  const families = matrixSupportedFamilies();
  return `We can't convert .${ext} yet. We handle ${joinList(families.kinds)} — try ${joinList(families.examples, 'or')}.`;
}

/**
 * Collect the media kinds the matrix actually supports (by scanning every
 * input format on every routable row) plus a representative extension per
 * kind for the user-facing examples list. Computed at module load — the
 * matrix is static, so this is a one-shot pass.
 */
function matrixSupportedFamilies(): {
  kinds: string[];
  examples: string[];
} {
  const kindSet = new Set<string>();
  const exampleByKind = new Map<string, string>();
  // Order matters for a friendly message: video, audio, images.
  const KIND_ORDER: string[] = ['video', 'audio', 'image', 'animated-image'];
  const KIND_LABEL: Record<string, string> = {
    video: 'video',
    audio: 'audio',
    image: 'images',
    'animated-image': 'animated images',
  };
  // Pick a memorable extension per kind for the examples list.
  const PREFERRED_EXAMPLE: Record<string, string[]> = {
    video: ['mp4', 'mov'],
    audio: ['mp3', 'wav'],
    image: ['png', 'jpg', 'heic'],
    'animated-image': ['gif'],
  };

  for (const row of MATRIX) {
    if (!ROUTABLE_OPERATIONS.has(row.operation)) continue;
    if (!routeExistsForSlug(row.slug)) continue;
    for (const f of row.inputFormats) {
      const kind = KIND_OF[f];
      if (kind) kindSet.add(kind);
    }
  }

  const kinds: string[] = [];
  const examples: string[] = [];
  for (const k of KIND_ORDER) {
    if (!kindSet.has(k)) continue;
    kinds.push(KIND_LABEL[k] ?? k);
    for (const ext of PREFERRED_EXAMPLE[k] ?? []) {
      examples.push(`.${ext}`);
      if (!exampleByKind.has(k)) exampleByKind.set(k, ext);
      break;
    }
  }
  // Add a couple of extra examples so the list reads like a recommendation,
  // not a one-of-each enumeration.
  if (kindSet.has('video') && !examples.includes('.mov')) examples.push('.mov');
  if (kindSet.has('image') && !examples.includes('.png')) examples.push('.png');

  return { kinds, examples };
}

/**
 * Join a list as "a, b, and c" / "a, b, or c". Empty list → empty string.
 */
function joinList(items: string[], conjunction: 'and' | 'or' = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

/**
 * Every input extension the matrix accepts as a routable input. Exposed for
 * the `route-for-file.test.ts` invariant: every matrix input must have a
 * `PREFERRED_TARGET_BY_EXT` entry, and that target must resolve to a real
 * route. Used by tests only; not imported from runtime code.
 */
export function matrixInputExtensions(): string[] {
  const exts = new Set<string>();
  for (const row of MATRIX) {
    if (!ROUTABLE_OPERATIONS.has(row.operation)) continue;
    if (!routeExistsForSlug(row.slug)) continue;
    for (const f of row.inputFormats) {
      // Map matrix `Format` back to the user-visible extension. The
      // `EXT_TO_FORMAT` map normalises `jpeg → jpg` etc., but the *matrix*
      // canonical names are also valid extensions (a user dropping a `.jpg`
      // file uses `jpg` directly). So we add the canonical name verbatim.
      exts.add(f);
    }
  }
  return [...exts].sort();
}

/**
 * SEAN-79 — one available output format the picker can render. The picker on
 * the homepage drop zone shows one chip per `OutputOption` returned here, so
 * the user who drops a `.mov` and wants `.webm` instead of the preferred
 * `.mp4` default can re-pick before the conversion fires.
 */
export interface OutputOption {
  /** Resolved matrix row that runs the conversion if the user picks this format. */
  row: OperationRow;
  /** Output format enum (e.g. `mp4`, `webm`, `webp`). */
  format: Format;
  /** UI label (uppercase ext, e.g. `MP4`, `WEBM`, `JPG`). */
  label: string;
  /** True for the row `routeForFile`'s preferred-target table picks by default. */
  isDefault: boolean;
}

/**
 * SEAN-79 — every pure-format output the matrix supports for a given input
 * extension. Used by the homepage format picker so the user can re-pick the
 * output before clicking Convert.
 *
 * Scope is intentionally narrow: only `convert` and `image-convert` rows are
 * returned (the picker's intent is "swap output format", not "switch
 * operation"). Extract-audio, gif, compress, trim etc. live on dedicated slug
 * pages and the homepage doesn't surface them via the picker — those are
 * different intents, not different output formats of the same intent.
 *
 * Pure function of input ext + matrix — no API call, no side effects, safe to
 * compute at module load. Empty array means the picker should be hidden.
 */
export function outputsForExt(ext: string): OutputOption[] {
  if (!ext) return [];
  const inputFormat = (EXT_TO_FORMAT[ext] ?? ext) as Format;
  const preferredTarget = PREFERRED_TARGET_BY_EXT[ext];

  // Map of outputFormat → chosen row. We dedupe by output format because two
  // rows can target the same output (e.g. a flagship `mov-to-mp4` row plus
  // the multi-input `video-to-mp4` fallback both produce mp4 from mov). The
  // direct `${input}-to-${target}` slug wins over multi-input rows so the
  // user lands on the page Google ranks for the pair.
  const byOutput = new Map<Format, OperationRow>();

  for (const row of MATRIX) {
    if (row.operation !== 'convert' && row.operation !== 'image-convert') {
      continue;
    }
    if (!row.inputFormats.includes(inputFormat)) continue;
    if (!MATRIX_BY_SLUG[row.slug]) continue;
    if (!routeExistsForSlug(row.slug)) continue;

    const directSlug = `${inputFormat}-to-${formatExtName(row.outputFormat)}`;
    const existing = byOutput.get(row.outputFormat);
    if (!existing) {
      byOutput.set(row.outputFormat, row);
      continue;
    }
    // Prefer the direct `${input}-to-${output}` slug over a multi-input row.
    if (row.slug === directSlug && existing.slug !== directSlug) {
      byOutput.set(row.outputFormat, row);
    }
  }

  const options: OutputOption[] = [];
  for (const [format, row] of byOutput) {
    options.push({
      row,
      format,
      label: formatExtName(format).toUpperCase(),
      isDefault: format === preferredTarget,
    });
  }

  // Stable order: default first, then alphabetical by label.
  options.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.label.localeCompare(b.label);
  });

  return options;
}

/**
 * Map a `Format` enum value to the file-extension form used in slugs and URLs.
 * Mirrors `formatToExt` in `./converter-row-args.ts`; duplicated here to keep
 * this module JSX-free and importable from tests without a tsx loader.
 */
function formatExtName(format: Format): string {
  switch (format) {
    case 'gif-static':
      return 'gif';
    case 'webp-anim':
      return 'webp';
    default:
      return format;
  }
}
