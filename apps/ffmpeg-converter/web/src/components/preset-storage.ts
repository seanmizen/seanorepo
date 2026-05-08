// SEAN-94 — saved preset library backed by localStorage.
//
// STRATEGY.md §"Repeat-customer hooks" item #2: a user converts a 1080p MP4
// to 720p WebM at CRF 28, hits "Save as 'Discord webm'", and on the next
// visit the preset shows up as an extra chip in the converter panel. No
// login, no account — just localStorage. JSON export/import for cross-device
// sync.
//
// Combined with SEAN-93 URL-state, this is the loop that turns the one-shot
// converter into a personal tool: discover preset → tweak → save → reach
// for it next time. The saved preset shape is intentionally just the
// URL-state map plus a name + id + timestamp — the URL-state whitelist is
// the source of truth for "which params are real", so saved presets get the
// same hostile-key protection for free.
//
// Storage layout
// ──────────────
// One key per operation: `converter.presets.gif`, `converter.presets.convert`,
// etc. The gif page MUST NOT show a user's webm presets (they'd be
// inapplicable on the GIF row), so per-operation isolation falls out of the
// key shape rather than being a runtime filter.
//
// Each key holds a JSON-serialised `SavedPreset[]`. We keep the array (not
// a map) so the chip rendering order matches save order, and so the export
// JSON is human-readable without sorting.
//
// Quota fallback
// ──────────────
// localStorage can throw `QuotaExceededError` (Safari private mode caps
// quota at ~0 bytes; some Firefox configurations do too). Every write goes
// through `safeWrite` which swallows the error and returns `false`. Callers
// that care surface this to the UI; callers that don't (autosave-style
// writes) just silently degrade. Reads from a non-existent or malformed key
// return `[]` so the rest of the app keeps working.
//
// SSR safety
// ──────────
// All localStorage access is gated behind a `typeof window === 'undefined'`
// check so importing this module from a server component (or a non-browser
// test runner) is a no-op rather than a crash.

import type { Operation } from '@/ops/types';
import type { UrlState } from './url-state';

// ─────────────────────────────────────────────────────── TYPES ───────────────

/**
 * A single saved preset. The `args` map is exactly the URL-state shape — a
 * map of whitelisted param names to string values — so saving a preset is
 * "snapshot the current URL-state and tag it with a name and id".
 *
 * Shape kept stable across versions for the export JSON contract. If a
 * future schema bump is needed we'll bump `SCHEMA_VERSION` and write a
 * migration in `loadPresets`.
 */
export interface SavedPreset {
  /** Stable id — used by the chip's delete button and as the React key. */
  id: string;
  /** User-supplied label that shows up on the chip. */
  name: string;
  /** URL-state args at save time. Same shape as `UrlState`. */
  args: UrlState;
  /** Unix ms timestamp of save. Surfaced in the export JSON for sorting. */
  createdAt: number;
}

/**
 * Schema version baked into the export JSON so future imports can refuse or
 * migrate older payloads. Bump on any breaking change to `SavedPreset` or
 * the storage layout.
 */
export const SCHEMA_VERSION = 1;

/**
 * The export JSON envelope — one blob per device, covering all operations.
 * The user downloads this from "Export presets" and re-imports it on a
 * second device.
 */
export interface ExportPayload {
  version: number;
  exportedAt: number;
  /**
   * Map of operation → preset list. Empty operations are omitted to keep
   * the file small and human-readable.
   */
  presetsByOperation: Partial<Record<Operation, SavedPreset[]>>;
}

// ─────────────────────────────────────────────────────── KEYS ────────────────

/** Key prefix shared across operations. Public so tests can clean up. */
export const STORAGE_KEY_PREFIX = 'converter.presets.';

/**
 * Build the localStorage key for an operation. Pure — exported so tests can
 * seed/clear a key without going through the read/write helpers.
 */
export function storageKeyFor(operation: Operation): string {
  return `${STORAGE_KEY_PREFIX}${operation}`;
}

// ─────────────────────────────────────────────────────── INTERNAL I/O ────────

/**
 * Best-effort localStorage read. Returns `null` if `window` is undefined,
 * the key is missing, or the access throws (some browsers throw on
 * `localStorage.getItem` when storage is disabled, not just on writes).
 */
function safeRead(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Best-effort localStorage write. Returns `true` on success, `false` on
 * quota exceeded / disabled storage / SSR. Callers that surface the failure
 * to the UI check the return value; autosave-style callers ignore it.
 */
function safeWrite(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort localStorage delete. Returns `true` on success. SSR-safe.
 */
function safeRemove(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────── VALIDATION ──────────

/**
 * Type-guard a parsed JSON blob into `SavedPreset[]`. Defensive because
 * localStorage is user-writable: a hostile or out-of-date payload should be
 * dropped silently rather than crashing the chip render. Each entry is
 * validated independently so one bad record doesn't poison the rest.
 */
export function isSavedPreset(value: unknown): value is SavedPreset {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id === '') return false;
  if (typeof v.name !== 'string') return false;
  if (typeof v.createdAt !== 'number') return false;
  if (!v.args || typeof v.args !== 'object') return false;
  // args must be a string→string map; any non-string value is suspicious.
  for (const [k, val] of Object.entries(v.args as Record<string, unknown>)) {
    if (typeof k !== 'string') return false;
    if (typeof val !== 'string') return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────── PUBLIC API ──────────

/**
 * Read every saved preset for `operation`. Returns `[]` when the key is
 * missing, malformed, or storage is unavailable — never throws. Order is
 * preserved (chip rendering order matches save order).
 */
export function loadPresets(operation: Operation): SavedPreset[] {
  const raw = safeRead(storageKeyFor(operation));
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isSavedPreset);
}

/**
 * Persist `presets` as the full preset list for `operation`. Pure-overwrite,
 * not append — callers who want to append must read, mutate, then call this.
 * Returns `true` on success, `false` on quota / SSR. The write goes through
 * `JSON.stringify` so any non-serialisable args (Functions, BigInts) blow
 * up loudly here rather than silently producing garbage on the next read.
 */
export function writePresets(
  operation: Operation,
  presets: SavedPreset[],
): boolean {
  return safeWrite(storageKeyFor(operation), JSON.stringify(presets));
}

/**
 * Append a new preset to `operation`'s list. Returns `true` on success,
 * `false` on quota / SSR. The id collision case (extremely unlikely with
 * `crypto.randomUUID`, but possible if the caller passes a hand-rolled id)
 * is resolved by overwriting the existing entry — the alternative (reject)
 * would surprise users who edited a preset and re-saved it under the same
 * id.
 */
export function savePreset(operation: Operation, preset: SavedPreset): boolean {
  const existing = loadPresets(operation);
  const next = existing.filter((p) => p.id !== preset.id);
  next.push(preset);
  return writePresets(operation, next);
}

/**
 * Remove the preset with `id` from `operation`'s list. Returns `true` on
 * success, `false` on quota / SSR / preset-not-found. The not-found case is
 * surfaced because callers (the chip's ✕ button) want to know whether the
 * UI should re-render — though in practice an immediate `loadPresets` would
 * pick up the same outcome.
 */
export function deletePreset(operation: Operation, id: string): boolean {
  const existing = loadPresets(operation);
  const next = existing.filter((p) => p.id !== id);
  if (next.length === existing.length) return false;
  return writePresets(operation, next);
}

/**
 * Generate a stable id for a new preset. Uses `crypto.randomUUID` when
 * available (every modern browser since ~2022, plus Node 19+) and falls
 * back to a timestamp-plus-random string otherwise so the function never
 * throws — the saved preset format only requires that ids be unique within
 * one operation's list, not globally unique.
 */
export function newPresetId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────── EXPORT / IMPORT ─────

/**
 * List of every operation we know how to load presets for. Mirrors the
 * `Operation` type union — kept as a runtime array because we need to
 * iterate it for export. Adding a new operation requires updating this
 * list (and `URL_PARAM_WHITELIST` in url-state.ts); a missing entry just
 * means the export JSON won't include that op's presets.
 */
const ALL_OPERATIONS: readonly Operation[] = [
  'convert',
  'compress',
  'extract-audio',
  'extract-frames',
  'trim',
  'resize',
  'rotate',
  'gif',
  'merge',
  'mute',
  'change-speed',
  'add-subtitles',
  'remove-audio',
  'reverse',
  'thumbnail',
  'contact-sheet',
  'normalize-audio',
  'image-convert',
];

/**
 * Build an `ExportPayload` covering every operation that has at least one
 * saved preset. Empty operations are dropped so the file stays small and
 * human-readable. The result is what the "Export presets" button serialises
 * via `exportPresetsAsJson`.
 */
export function buildExportPayload(now: number = Date.now()): ExportPayload {
  const presetsByOperation: Partial<Record<Operation, SavedPreset[]>> = {};
  for (const op of ALL_OPERATIONS) {
    const presets = loadPresets(op);
    if (presets.length > 0) {
      presetsByOperation[op] = presets;
    }
  }
  return {
    version: SCHEMA_VERSION,
    exportedAt: now,
    presetsByOperation,
  };
}

/**
 * JSON-stringify the export payload. Pretty-printed with 2-space indent so a
 * user who opens the file in a text editor can read it without tooling.
 */
export function exportPresetsAsJson(now: number = Date.now()): string {
  return JSON.stringify(buildExportPayload(now), null, 2);
}

/**
 * Result of an import. `addedByOperation` counts new presets per operation
 * (overwrites of an existing id count as 0, not 1, to match the "imported
 * X new presets" UI message).
 */
export interface ImportResult {
  ok: boolean;
  reason?:
    | 'invalid-json'
    | 'invalid-shape'
    | 'unsupported-version'
    | 'quota-exceeded';
  addedByOperation?: Partial<Record<Operation, number>>;
}

/**
 * Validate an arbitrary parsed value as an `ExportPayload`. Returns the
 * narrowed value or `null` if anything looks off. Used by `importPresets`
 * to gate writes — never throws, never partially applies.
 */
export function isExportPayload(value: unknown): value is ExportPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== 'number') return false;
  if (typeof v.exportedAt !== 'number') return false;
  if (!v.presetsByOperation || typeof v.presetsByOperation !== 'object') {
    return false;
  }
  // Validate each operation's preset list — we tolerate unknown operation
  // keys (forwards-compat) but reject any list whose entries aren't
  // SavedPreset-shaped.
  for (const presets of Object.values(
    v.presetsByOperation as Record<string, unknown>,
  )) {
    if (!Array.isArray(presets)) return false;
    if (!presets.every(isSavedPreset)) return false;
  }
  return true;
}

/**
 * Merge an import payload into the current localStorage. Existing presets
 * with the same id are overwritten (so re-importing the same export is a
 * no-op rather than a duplication). Operations are merged independently so
 * importing a payload that only has gif presets doesn't wipe the user's
 * convert presets.
 *
 * Returns an `ImportResult` describing what happened. The function never
 * throws — malformed input returns `{ ok: false, reason: ... }` so the UI
 * can surface a friendly message.
 */
export function importPresets(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (!isExportPayload(parsed)) {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (parsed.version > SCHEMA_VERSION) {
    return { ok: false, reason: 'unsupported-version' };
  }

  const addedByOperation: Partial<Record<Operation, number>> = {};
  for (const [op, incoming] of Object.entries(parsed.presetsByOperation)) {
    if (!incoming || incoming.length === 0) continue;
    const operation = op as Operation;
    const existing = loadPresets(operation);
    const existingIds = new Set(existing.map((p) => p.id));
    const merged = [...existing];
    let added = 0;
    for (const preset of incoming) {
      if (existingIds.has(preset.id)) {
        // Overwrite the existing entry in place so render order stays stable.
        const idx = merged.findIndex((p) => p.id === preset.id);
        if (idx >= 0) merged[idx] = preset;
      } else {
        merged.push(preset);
        added += 1;
      }
    }
    const ok = writePresets(operation, merged);
    if (!ok) {
      return { ok: false, reason: 'quota-exceeded', addedByOperation };
    }
    addedByOperation[operation] = added;
  }

  return { ok: true, addedByOperation };
}

/**
 * Wipe every preset key this module owns. Used by the test suite (and a
 * future "Clear all saved presets" UI) to reset state without leaving stale
 * keys behind.
 */
export function clearAllPresets(): void {
  for (const op of ALL_OPERATIONS) {
    safeRemove(storageKeyFor(op));
  }
}
