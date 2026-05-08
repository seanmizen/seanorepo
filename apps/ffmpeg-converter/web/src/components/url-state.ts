// SEAN-93 — URL-state for converter options.
//
// STRATEGY.md §"Repeat-customer hooks" calls out URL-state as the #1
// differentiator vs every competitor: a link like
// `/gif/mp4-to-gif?fps=24&width=320` is bookmarkable, shareable, and
// rehydrates the converter panel with those exact settings. None of
// CloudConvert / Zamzar / FreeConvert / Convertio / Media.io do this.
//
// This module is the typed parser + serializer + per-operation whitelist that
// the gif preset row (#92) and any future advanced-panel surface (CRF,
// bitrate, etc.) plug into. ConverterPanel reads state from the URL on mount
// via `parseUrlState`, writes state back via `applyUrlState` /
// `serializeUrlState`, and merges the result into extraArgs / the displayed
// ffmpeg command via `mergeUrlIntoExtraArgs` / `applyUrlToFfmpegCommand`.
//
// Design notes
// ────────────
// * Whitelist per operation. A `gif` page accepts `fps`, `width`, `max_colors`,
//   `dither`; a `convert` page accepts `crf`, `preset`, `audio_bitrate`. An
//   unknown param is silently dropped (not echoed back into the URL, not
//   forwarded to extraArgs) so a hostile share-link can't slip arbitrary
//   form fields onto the multipart body.
// * `replaceState`, not `pushState`. We don't want every fps tweak to add a
//   history entry — the back-button must still take the user to the previous
//   page. `replaceState` also avoids the scroll jump that `router.replace`
//   triggers in Next.js 15.
// * Merge order is URL > preset > default. The matrix row's preset (e.g.
//   `{ fps: 10 }` for the GIF flagship) is the page's default; URL params
//   override it. Hard-coded fallbacks in the ffmpegCommand template act as
//   the last resort when neither URL nor preset specify a value.

import type { Operation } from '@/ops/types';

// ─────────────────────────────────────────────────────── WHITELIST ───────────

/**
 * Canonical list of URL params each operation accepts. Adding a new param to
 * this list is the only way to make it survive `parseUrlState` — anything
 * else is silently dropped. Ordering inside each array matters only for
 * deterministic URL serialization (see `serializeUrlState`).
 *
 * Param naming convention: snake_case to match the multipart form field
 * names the Go backend reads. `width` and `height` are exceptions — they're
 * UI-level settings the frontend translates into ffmpeg `scale=W:H` filters,
 * not raw form fields.
 */
export const URL_PARAM_WHITELIST: Record<Operation, readonly string[]> = {
  convert: ['crf', 'preset', 'audio_bitrate', 'resolution', 'fps'],
  compress: ['crf', 'preset', 'target_size_mb', 'audio_bitrate', 'resolution'],
  'extract-audio': ['audio_bitrate'],
  'extract-frames': ['fps', 'width'],
  trim: ['start', 'duration'],
  resize: ['width', 'height', 'resolution'],
  rotate: ['angle'],
  gif: ['fps', 'width', 'max_colors', 'dither'],
  merge: [],
  mute: [],
  'change-speed': ['speed'],
  'add-subtitles': [],
  'remove-audio': [],
  reverse: [],
  thumbnail: ['width', 'time'],
  'contact-sheet': ['width', 'rows', 'cols'],
  'normalize-audio': ['target_lufs'],
  'image-convert': ['quality', 'width', 'height'],
};

// ─────────────────────────────────────────────────────── TYPES ───────────────

/**
 * Parsed URL state — a map of whitelisted param name → string value. Always a
 * string because URL params are strings; numeric coercion happens at the
 * point of use (e.g. when feeding into the ffmpeg command template).
 */
export type UrlState = Readonly<Record<string, string>>;

// ─────────────────────────────────────────────────────── PARSE ───────────────

/**
 * Read the URL query params and return only those whitelisted for `operation`.
 * Unknown params are silently dropped. Empty-string values are also dropped
 * (so `?fps=` doesn't override the preset with an empty string).
 *
 * Pure, testable — pass either a `URLSearchParams` or the raw search string
 * (with or without leading `?`). On the server (SSR) just don't call this;
 * the panel reads URL state inside a `useEffect` after mount.
 */
export function parseUrlState(
  search: URLSearchParams | string,
  operation: Operation,
): UrlState {
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search;
  const whitelist = URL_PARAM_WHITELIST[operation] ?? [];
  const out: Record<string, string> = {};
  for (const key of whitelist) {
    const value = params.get(key);
    if (value !== null && value !== '') {
      out[key] = value;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────── SERIALIZE ───────────

/**
 * Build a deterministic query string from a UrlState. Empty / nullish values
 * are skipped. Output is sorted by the operation's whitelist order so two
 * panels with the same state always produce byte-identical URLs (otherwise
 * `replaceState` thrashes on every render).
 *
 * Returns `''` when the state is empty — never returns just `?`.
 */
export function serializeUrlState(
  state: UrlState,
  operation: Operation,
): string {
  const whitelist = URL_PARAM_WHITELIST[operation] ?? [];
  const parts: string[] = [];
  for (const key of whitelist) {
    const value = state[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

// ─────────────────────────────────────────────────────── APPLY (browser) ─────

/**
 * Push the URL state into the browser bar via `history.replaceState` — never
 * `pushState` (back-button must still go back to the previous page). Skips
 * the call entirely when the URL would be unchanged so we don't trigger the
 * Next.js scroll restore handler on every keystroke.
 *
 * Server-safe no-op when `window` is undefined.
 */
export function applyUrlState(state: UrlState, operation: Operation): void {
  if (typeof window === 'undefined') return;
  const search = serializeUrlState(state, operation);
  const next = `${window.location.pathname}${search}${window.location.hash}`;
  if (
    next ===
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  ) {
    return;
  }
  window.history.replaceState(window.history.state, '', next);
}

// ─────────────────────────────────────────────────────── MERGE ───────────────

/**
 * Merge URL params into the row's preset-derived extraArgs. URL wins over
 * preset; preset wins over hard-coded fallbacks (which live in the ffmpeg
 * command template, not here).
 *
 * Both inputs must be already-whitelisted: extraArgs comes from
 * `buildExtraArgs(row)` and only contains preset-blessed keys; UrlState
 * comes from `parseUrlState` and only contains operation-whitelisted keys.
 * The output is the multipart-form payload the backend will receive.
 *
 * Returns `undefined` when the merged result is empty so callers can spread
 * it into the panel props with the same shape as before.
 */
export function mergeUrlIntoExtraArgs(
  presetArgs: Record<string, string> | undefined,
  urlState: UrlState,
): Record<string, string> | undefined {
  const merged: Record<string, string> = { ...(presetArgs ?? {}) };
  for (const [key, value] of Object.entries(urlState)) {
    if (value === undefined || value === null || value === '') continue;
    merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

// ─────────────────────────────────────────────────────── FFMPEG TEMPLATE ─────

/**
 * Substitute URL-state values into a row's ffmpegCommand string so the
 * displayed command reflects what will actually run.
 *
 * The matrix authors ffmpeg commands with literal preset values baked in
 * (e.g. `fps=10,scale=480:-1` for the GIF flagship row). When the user
 * overrides via URL params we patch those literals so the copy-paste command
 * stays accurate. Scope is intentionally narrow:
 *   - `fps=N` → replaces `fps=<digits>` everywhere in the command
 *   - `width=N` → replaces `scale=<digits>:-1` and `scale=<digits>:<anything>`
 *
 * Anything else (CRF, bitrate, etc.) is forwarded to the backend via
 * extraArgs but the ffmpeg command keeps its original literal — Phase 2 of
 * URL-state will extend this list once a wider set of advanced controls
 * actually exists in the UI.
 */
export function applyUrlToFfmpegCommand(
  template: string,
  state: UrlState,
): string {
  let out = template;
  if (state.fps) {
    out = out.replace(/fps=\d+/g, `fps=${state.fps}`);
  }
  if (state.width) {
    // Match `scale=<digits>:-1` and `scale=<digits>:<digits>` (the two shapes
    // the matrix uses today) without touching the height side.
    out = out.replace(/scale=\d+:(-?\d+)/g, `scale=${state.width}:$1`);
  }
  return out;
}
