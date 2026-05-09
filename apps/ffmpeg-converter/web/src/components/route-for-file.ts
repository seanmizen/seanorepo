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
 * SEAN-79 / SEAN-121 — output options for the (ext, operation) pair.
 *
 * The original SEAN-79 `outputsForExt(ext)` filtered to `convert` /
 * `image-convert` rows only. SEAN-121 lifted that filter — the picker is now
 * operation-first via `capabilitiesForExt(ext)`. This helper is the
 * sub-picker data source: given a chosen operation and an input ext, return
 * the output formats that operation can produce for that input (what the
 * format chips render under "Convert" or "Extract audio").
 *
 * Returns an empty array when the operation has no matrix coverage for the
 * input — callers should hide the sub-picker in that case.
 *
 * Pure function of input ext + matrix — no API call, no side effects, safe
 * to compute at module load.
 */
export function outputsForOperation(
  ext: string,
  operation: OperationRow['operation'],
): OutputOption[] {
  const cap = capabilitiesForExt(ext).find((c) => c.operation === operation);
  if (!cap) return [];
  return cap.outputs.map((o) => ({
    row: o.row,
    format: o.format,
    label: o.label,
    isDefault: o.isDefault,
  }));
}

/**
 * SEAN-79 — backwards-compatible alias: every output format any `convert` /
 * `image-convert` row in the matrix can produce for the given input.
 *
 * SEAN-121 superseded the picker's use of this helper (the new picker is
 * operation-first via `capabilitiesForExt`). Kept for the same-operation
 * format-swap path inside `<ConverterPanel />` and `<HeroDrop />` — when a
 * user has already picked an operation (or landed on a slug that pins one),
 * the format sub-picker shows that operation's outputs only. For that
 * narrow use case, callers should prefer `outputsForOperation(ext, op)` —
 * `outputsForExt` resolves the same data through the convert-family
 * defaults so existing tests / call sites don't drift.
 */
export function outputsForExt(ext: string): OutputOption[] {
  if (!ext) return [];
  const caps = capabilitiesForExt(ext);

  // Combine convert + image-convert. `outputsForExt` historically described
  // "format outputs of the convert intent" — keeping the same scope means
  // the existing same-op format-swap path inside <HeroDrop />'s RunningPanel
  // and <ConverterPanel />'s handleChipPick keep working unchanged.
  const merged = new Map<Format, OutputOption>();
  for (const op of ['convert', 'image-convert'] as const) {
    const cap = caps.find((c) => c.operation === op);
    if (!cap) continue;
    for (const o of cap.outputs) {
      // First write wins — convert outputs take precedence over image-convert
      // when both target the same format, mirroring the pre-SEAN-121 ordering
      // (the iteration order over MATRIX put convert rows first).
      if (!merged.has(o.format)) merged.set(o.format, o);
    }
  }

  const options = [...merged.values()];
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

// ─────────────────────────────────────────────── CAPABILITIES (SEAN-121) ─────

/**
 * SEAN-121 — one operation that can run on the detected input, plus every
 * output format that operation can produce for that input.
 *
 * Operations whose matrix coverage for the detected input has a single output
 * (`compress` always lands on the same format, `gif` always lands on `gif`,
 * `trim` round-trips back to the input format, etc.) get a one-element
 * `outputs` array — the picker renders these as a single "Compress" / "Make
 * GIF" / "Trim" chip and runs them on click without revealing a sub-picker.
 *
 * Operations with multiple outputs (`convert` lands on mp4/webm/mkv/etc;
 * `extract-audio` lands on mp3/wav/aac/flac/ogg/opus; `image-convert` lands
 * on jpg/webp/png/avif) get a multi-element `outputs` array — the picker
 * reveals a sub-picker after the user clicks the operation chip.
 */
export interface CapabilityOption {
  /** Resolved matrix row that runs if the user picks this output. */
  row: OperationRow;
  /** Output format enum (e.g. `mp4`, `gif`, `webp`). */
  format: Format;
  /** UI label (uppercase ext, e.g. `MP4`, `GIF`). */
  label: string;
  /** True when this output matches `PREFERRED_TARGET_BY_EXT[ext]`. */
  isDefault: boolean;
}

export interface OperationCapability {
  /** Operation enum value — keys the chip into the right copy + icon. */
  operation: OperationRow['operation'];
  /**
   * Every output format the matrix can produce for this (operation, input)
   * pair on a routable row. Single-element arrays render as a one-click chip;
   * multi-element arrays reveal a sub-picker on chip click.
   *
   * Sorted: default (per `PREFERRED_TARGET_BY_EXT`) first, then alphabetical.
   */
  outputs: CapabilityOption[];
  /**
   * The "default" option for this operation — `outputs[0]`, exposed
   * separately for picker components that want to fire a one-click run for
   * single-output ops without indexing into the array.
   */
  defaultOption: CapabilityOption;
}

/**
 * Display order for the capability chips. Mirrors the user's mental model:
 * convert first (the most-asked), then the value-add operations (compress,
 * extract-audio, gif, trim, resize, thumbnail, contact-sheet,
 * normalize-audio), then `image-convert` for image inputs (which doesn't
 * collide with `convert` because images don't have video-convert rows).
 *
 * Operations not in this list fall through to the end of the picker in
 * alphabetical order — this keeps the picker robust to new operations being
 * added to the matrix without an explicit ordering update.
 */
const CAPABILITY_DISPLAY_ORDER: ReadonlyArray<OperationRow['operation']> = [
  'convert',
  'image-convert',
  'compress',
  'extract-audio',
  'gif',
  'trim',
  'resize',
  'thumbnail',
  'contact-sheet',
  'normalize-audio',
];

/**
 * SEAN-121 — every shipped operation that accepts the dropped file's media
 * kind, grouped with its output formats. Replaces the old `outputsForExt`
 * filter that only surfaced `convert` / `image-convert` rows — that filter
 * hid GIF, audio extract, compress, trim, thumbnail, and contact-sheet from
 * any video drop, even though the matrix has rows for all of them.
 *
 * This is the picker's data source. Operation-first hierarchy: the picker
 * renders one chip per `OperationCapability`; chips for ops with multiple
 * outputs reveal a sub-picker after click.
 *
 * Pure function of input ext + matrix — no API call, no side effects, safe
 * to compute at module load. Empty array means the picker should be hidden.
 */
export function capabilitiesForExt(ext: string): OperationCapability[] {
  if (!ext) return [];
  const inputFormat = (EXT_TO_FORMAT[ext] ?? ext) as Format;
  const preferredTarget = PREFERRED_TARGET_BY_EXT[ext];

  // Group by operation → (output format → row). Dedupe by output format the
  // same way `outputsForExt` did: a flagship `mov-to-gif` row plus the
  // multi-input `video-to-gif` fallback both target gif from mov; the
  // direct `${input}-to-${target}` slug wins so the user lands on the page
  // Google ranks for the pair.
  const byOp = new Map<OperationRow['operation'], Map<Format, OperationRow>>();

  for (const row of MATRIX) {
    if (!row.inputFormats.includes(inputFormat)) continue;
    if (!MATRIX_BY_SLUG[row.slug]) continue;
    if (!routeExistsForSlug(row.slug)) continue;

    const directSlug = `${inputFormat}-to-${formatExtName(row.outputFormat)}`;
    let opMap = byOp.get(row.operation);
    if (!opMap) {
      opMap = new Map();
      byOp.set(row.operation, opMap);
    }
    const existing = opMap.get(row.outputFormat);
    if (!existing) {
      opMap.set(row.outputFormat, row);
      continue;
    }
    if (row.slug === directSlug && existing.slug !== directSlug) {
      opMap.set(row.outputFormat, row);
    }
  }

  const capabilities: OperationCapability[] = [];
  for (const [operation, opMap] of byOp) {
    const options: CapabilityOption[] = [];
    for (const [format, row] of opMap) {
      options.push({
        row,
        format,
        label: formatExtName(format).toUpperCase(),
        isDefault: format === preferredTarget,
      });
    }
    options.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.label.localeCompare(b.label);
    });
    const defaultOption = options[0];
    if (!defaultOption) continue;
    capabilities.push({ operation, outputs: options, defaultOption });
  }

  // Stable order per `CAPABILITY_DISPLAY_ORDER`; unknown ops sort to the end
  // alphabetically so a new operation added to the matrix without updating
  // the order list still renders, just at the bottom.
  capabilities.sort((a, b) => {
    const ai = CAPABILITY_DISPLAY_ORDER.indexOf(a.operation);
    const bi = CAPABILITY_DISPLAY_ORDER.indexOf(b.operation);
    if (ai === -1 && bi === -1) return a.operation.localeCompare(b.operation);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return capabilities;
}

/**
 * SEAN-105 — adaptive panel: pick the matrix row that best matches a dropped
 * file given the current page's operation + output format.
 *
 * Resolution order:
 *   1. Same-operation row whose `inputFormats` includes the dropped input AND
 *      whose `outputFormat` matches `currentOutputFormat`. Prefer the direct
 *      `${input}-to-${output}` slug, then any multi-input fallback.
 *   2. Otherwise fall back to `matrixRowForFile(file)` (which honours
 *      `PREFERRED_TARGET_BY_EXT` per the existing routing table). The output
 *      format necessarily changes here — the panel re-derives `goOp` /
 *      `outputExt` / `extraArgs` from whatever row this lands on.
 *   3. Returns `null` when the file's extension isn't routable at all (no
 *      matching matrix row anywhere). Caller should keep the existing row
 *      unchanged — friendly fallback messaging is a separate ticket.
 *
 * `currentOperation` is consulted as a soft hint: a `/convert/*` page should
 * prefer a `convert` row, a `/gif/*` page a `gif` row, etc. Without it, the
 * helper would happily swap a `/convert/mov-to-mp4` panel into a `/gif/mp4-to-gif`
 * panel just because the input matched, which surprises the user.
 */
export function adaptiveRowForFile(
  file: File | { name: string },
  currentOperation: OperationRow['operation'],
  currentOutputFormat: Format,
): MatrixRowMatch | null {
  const ext = extOf(file.name);
  if (!ext) return null;

  const inputFormat = (EXT_TO_FORMAT[ext] ?? ext) as Format;

  // Step 1 — find a same-operation row that lands on the same output format.
  // The direct `${input}-to-${output}` slug wins (Google ranks it; user landed
  // on the equivalent slug); multi-input rows like `video-to-mp4` are the
  // fallback within this step.
  const directSlug = `${inputFormat}-to-${formatExtName(currentOutputFormat)}`;
  const directRow = MATRIX_BY_SLUG[directSlug];
  if (
    directRow &&
    directRow.operation === currentOperation &&
    directRow.outputFormat === currentOutputFormat &&
    directRow.inputFormats.includes(inputFormat) &&
    routeExistsForSlug(directSlug)
  ) {
    return { row: directRow, inputFormat };
  }

  for (const row of MATRIX) {
    if (row.operation !== currentOperation) continue;
    if (row.outputFormat !== currentOutputFormat) continue;
    if (!row.inputFormats.includes(inputFormat)) continue;
    if (!MATRIX_BY_SLUG[row.slug]) continue;
    if (!routeExistsForSlug(row.slug)) continue;
    return { row, inputFormat };
  }

  // Step 2 — no row preserves the current output format for this input.
  // Fall back to the preferred-target row (`PREFERRED_TARGET_BY_EXT`).
  // Output format changes; the panel re-derives everything from the new row.
  return matrixRowForFile(file);
}
