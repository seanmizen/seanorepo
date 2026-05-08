'use client';

// Client-only converter panel: owns the job state and toggles between the
// drop zone and the result block. Extracted from <ToolPage /> so the page
// shell (H1, value prop, sibling links, FAQ, "How it works") can render as
// a server component — keeping the route-specific JS as small as possible
// for Lighthouse / Core Web Vitals.
//
// Spec §7.2 render order is fixed at the page shell level; this component
// only handles the interactive convert step.
//
// SEAN-93 — reads URL query params on mount via `parseUrlState`, and any
// time the URL changes (popstate). The parsed state is merged into extraArgs
// (URL > preset > default) and substituted into the displayed ffmpeg command
// so a shared link like `/gif/mp4-to-gif?fps=24&width=320` rehydrates the
// panel and its copy-paste command verbatim. State writes go through
// `applyUrlState` which uses `history.replaceState` (no scroll jump, no
// history pollution).
//
// SEAN-94 — saved preset library on top of URL-state. The chip row above
// the drop zone shows the user's saved presets for this operation; clicking
// one applies the preset's args to the URL (which the existing useEffect
// picks up and merges into extraArgs). "Save as preset…" snapshots the
// current URL state into localStorage; a "JSON" toggle reveals export /
// import controls for cross-device sync. Storage and the UI live in
// `./preset-storage.ts` so this file stays focused on the rendering logic.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Operation } from '@/ops/types';
import { AdvancedPanel } from './AdvancedPanel';
import { type ConversionJob, DropZone } from './DropZone';
import {
  deletePreset as deletePresetFromStorage,
  exportPresetsAsJson,
  importPresets,
  loadPresets,
  newPresetId,
  type SavedPreset,
  savePreset as savePresetToStorage,
} from './preset-storage';
import { ResultBlock } from './ResultBlock';
import {
  applyUrlState,
  applyUrlToFfmpegCommand,
  mergeUrlIntoExtraArgs,
  parseUrlState,
  type UrlState,
} from './url-state';

export interface ConverterPanelProps {
  /** Backend op name. */
  goOp: string;
  /** Output extension (no leading dot) — used to name the download. */
  outputExt: string;
  /** `<input accept>` attribute, e.g. `.mov,.MOV`. */
  accept: string;
  /** Human-readable accept label, e.g. `MOV`. */
  acceptLabel: string;
  /** Extra args forwarded to the Go op. */
  extraArgs?: Record<string, string>;
  /** ffmpeg command shown in the result block. */
  ffmpegCommand: string;
  /** Reverse-tool slug fragment. */
  reverseSlug?: string;
  /** Reverse-tool label. */
  reverseLabel?: string;
  /** Operation prefix for the reverse URL. */
  reverseOperation?: string;
  /**
   * SEAN-93 — high-level operation. Drives the URL-param whitelist so a video
   * page rejects `max_colors` and a gif page rejects `crf`. Optional for
   * backwards compatibility; absent ⇒ URL-state is disabled for the panel.
   */
  operation?: Operation;
  /**
   * SEAN-95 — when true (video `convert` rows only) the panel renders the
   * Layer-3 Advanced disclosure below the dropzone. Per-row defaults flow
   * via `advancedDefaults`.
   */
  showAdvancedPanel?: boolean;
  /**
   * SEAN-95 — defaults for the Advanced panel's controls. Sourced from the
   * matrix row's `preset` (CRF + preset name) plus parsed-out hints from
   * the displayed ffmpeg command (so the slider position matches what the
   * copy-paste command shows on first paint).
   */
  advancedDefaults?: {
    crf?: number;
    preset?: string;
    bitrate?: string;
    fps?: string;
    audio_bitrate?: string;
    codec?: string;
  };
  /**
   * SEAN-75: pre-loaded file forwarded from the homepage drop zone. When set,
   * `<DropZone />` auto-fires the upload on mount so the user reaches the
   * converting/result UI without dropping a second time.
   */
  initialFile?: File;
  /**
   * SEAN-75: called when the user clicks "Try another file" in the result
   * block. Lets the homepage flow tear down the embedded converter and
   * restore the original hero drop zone, instead of leaving a slug-page-shaped
   * panel sitting on the homepage.
   */
  onReset?: () => void;
}

export function ConverterPanel({
  goOp,
  outputExt,
  accept,
  acceptLabel,
  extraArgs,
  ffmpegCommand,
  reverseSlug,
  reverseLabel,
  reverseOperation,
  operation,
  showAdvancedPanel,
  advancedDefaults,
  initialFile,
  onReset,
}: ConverterPanelProps) {
  const [job, setJob] = useState<ConversionJob | null>(null);

  // SEAN-93 — initial URL-state snapshot, read on mount. SSR-safe (returns
  // empty when `window` is undefined). Subscribes to `popstate` so the
  // browser back/forward buttons resync the panel; updates triggered by the
  // panel itself go through `applyUrlState` (replaceState) which doesn't
  // fire popstate, so there's no feedback loop.
  const [urlState, setUrlState] = useState<UrlState>({});

  useEffect(() => {
    if (typeof window === 'undefined' || !operation) return;
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      setUrlState(parseUrlState(params, operation));
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
    };
  }, [operation]);

  // Merge URL state into the row's preset-derived extraArgs (URL wins) and
  // substitute the same values into the displayed ffmpeg command so a copy-
  // paste of the command matches what the backend will run. Both are memoised
  // so DropZone's effect deps stay stable when nothing changed.
  const mergedExtraArgs = useMemo(
    () => mergeUrlIntoExtraArgs(extraArgs, urlState),
    [extraArgs, urlState],
  );
  const displayedCommand = useMemo(
    () => applyUrlToFfmpegCommand(ffmpegCommand, urlState),
    [ffmpegCommand, urlState],
  );

  // SEAN-95 — Advanced disclosure. Mounted below the converter panel for
  // video `convert` rows only. The panel itself is a pure URL-state writer:
  // no callback up to the parent, the URL is the single source of truth and
  // ConverterPanel re-reads on the resulting popstate / its own mount.
  // BUT: replaceState doesn't fire popstate, so we expose a state-setter so
  // AdvancedPanel can also push the change directly into urlState here. We
  // wrap that into a child-callback to keep the URL ↔ React loop tight.
  const advanced =
    showAdvancedPanel && operation === 'convert' ? (
      <AdvancedPanel
        operation="convert"
        ffmpegCommand={ffmpegCommand}
        defaultCrf={advancedDefaults?.crf}
        defaultPreset={advancedDefaults?.preset}
        defaultBitrate={advancedDefaults?.bitrate}
        defaultFps={advancedDefaults?.fps}
        defaultAudioBitrate={advancedDefaults?.audio_bitrate}
        defaultCodec={advancedDefaults?.codec}
      />
    ) : null;

  // Re-sync urlState after Advanced panel writes — replaceState doesn't fire
  // popstate, so we listen on a custom event the panel emits when it writes.
  useEffect(() => {
    if (typeof window === 'undefined' || !operation) return;
    const onChange = () => {
      const params = new URLSearchParams(window.location.search);
      setUrlState(parseUrlState(params, operation));
    };
    window.addEventListener('ffmpeg-converter:url-state', onChange);
    return () => {
      window.removeEventListener('ffmpeg-converter:url-state', onChange);
    };
  }, [operation]);

  if (!job) {
    return (
      <>
        {operation && (
          <SavedPresetsBar
            operation={operation}
            currentArgs={urlState}
            onApply={(preset) => {
              if (typeof window === 'undefined') return;
              applyUrlState(preset.args, operation);
              setUrlState(preset.args);
            }}
          />
        )}
        <DropZone
          goOp={goOp}
          outputExt={outputExt}
          accept={accept}
          acceptLabel={acceptLabel}
          extraArgs={mergedExtraArgs}
          onJobComplete={setJob}
          initialFile={initialFile}
        />
        {advanced}
      </>
    );
  }
  return (
    <>
      <ResultBlock
        job={job}
        ffmpegCommand={displayedCommand}
        reverseSlug={reverseSlug}
        reverseLabel={reverseLabel}
        reverseOperation={reverseOperation}
        onReset={() => {
          setJob(null);
          onReset?.();
        }}
      />
      {advanced}
    </>
  );
}

// ─────────────────────────────────────────────────────── SAVED PRESETS UI ────

interface SavedPresetsBarProps {
  operation: Operation;
  /**
   * Current URL-state args — what gets snapshotted when the user clicks
   * "Save as preset". The bar shows a hint when this is empty so the user
   * knows there's nothing to save yet.
   */
  currentArgs: UrlState;
  /**
   * Apply a preset by routing its args through `applyUrlState`. The parent
   * also resyncs its own urlState so the merged extraArgs / command refresh
   * immediately rather than waiting for the next render cycle.
   */
  onApply: (preset: SavedPreset) => void;
}

/**
 * SEAN-94 — chip-row UI for saved presets.
 *
 * Three modes:
 *   - Empty list, no current args ⇒ render nothing (no UI noise).
 *   - Empty list, current args ⇒ render a single "Save as preset…" button.
 *   - Non-empty list ⇒ render the chips row + "Save as preset…" + JSON menu.
 *
 * State is read from localStorage on mount (SSR-safe — module's safeRead
 * returns `null` when `window` is undefined). The component only re-reads
 * from storage after a save / delete / import; we don't subscribe to a
 * storage event because cross-tab sync is out of scope (the user could open
 * a second tab and edit; the chip row just won't see it until next mount).
 */
function SavedPresetsBar({
  operation,
  currentArgs,
  onApply,
}: SavedPresetsBarProps) {
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [showJsonPanel, setShowJsonPanel] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Read once on mount and any time the operation changes (e.g. when the
  // homepage chip row remounts the panel onto a different row.slug).
  useEffect(() => {
    setPresets(loadPresets(operation));
  }, [operation]);

  const refresh = useCallback(() => {
    setPresets(loadPresets(operation));
  }, [operation]);

  const handleSave = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (Object.keys(currentArgs).length === 0) {
      window.alert(
        'Tweak a setting first — there are no custom args to save yet.',
      );
      return;
    }
    const name = window.prompt('Name this preset:', '');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = savePresetToStorage(operation, {
      id: newPresetId(),
      name: trimmed,
      args: currentArgs,
      createdAt: Date.now(),
    });
    if (!ok) {
      window.alert(
        'Could not save preset — your browser storage may be full or disabled.',
      );
      return;
    }
    refresh();
  }, [currentArgs, operation, refresh]);

  const handleDelete = useCallback(
    (id: string) => {
      deletePresetFromStorage(operation, id);
      refresh();
    },
    [operation, refresh],
  );

  const handleExport = useCallback(() => {
    if (typeof window === 'undefined') return;
    const json = exportPresetsAsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converter-presets-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportFile = useCallback(
    async (file: File) => {
      setImportError(null);
      try {
        const text = await file.text();
        const result = importPresets(text);
        if (!result.ok) {
          setImportError(
            result.reason === 'invalid-json'
              ? 'That file isn’t valid JSON.'
              : result.reason === 'invalid-shape'
                ? 'That file isn’t a converter preset export.'
                : result.reason === 'unsupported-version'
                  ? 'That preset file is from a newer version. Update first.'
                  : 'Browser storage rejected the import (quota / disabled).',
          );
          return;
        }
        refresh();
      } catch {
        setImportError('Could not read that file.');
      }
    },
    [refresh],
  );

  const hasPresets = presets.length > 0;
  const hasArgsToSave = Object.keys(currentArgs).length > 0;

  // Empty state with nothing to save = render nothing. The bar would just be
  // a lone disabled button — adds noise, removes nothing.
  if (!hasPresets && !hasArgsToSave) return null;

  return (
    <div
      className={[
        'mb-3 flex flex-col gap-2',
        'rounded-2xl border border-gray-800 bg-gray-900/40',
        'px-3 py-2',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        {hasPresets && <span className="text-xs text-gray-500">saved:</span>}
        {presets.map((preset) => (
          <span
            key={preset.id}
            className={[
              'inline-flex items-center rounded-full',
              'border border-gray-700 bg-gray-900/60',
              'pl-3 pr-1 py-1 text-xs font-medium text-gray-200',
              'hover:border-indigo-500 hover:bg-indigo-500/10',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={() => onApply(preset)}
              title={summarisePresetArgs(preset.args)}
              className="mr-1 cursor-pointer text-gray-100 hover:text-white"
            >
              {preset.name}
            </button>
            <button
              type="button"
              aria-label={`Delete preset ${preset.name}`}
              onClick={() => handleDelete(preset.id)}
              className={[
                'inline-flex h-5 w-5 items-center justify-center',
                'rounded-full text-gray-500',
                'hover:bg-red-500/20 hover:text-red-400',
              ].join(' ')}
            >
              {'×'}
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={handleSave}
          className={[
            'inline-flex items-center rounded-full',
            'border border-dashed border-gray-700 bg-transparent',
            'px-3 py-1 text-xs text-gray-300',
            'transition-colors hover:border-indigo-500 hover:text-white',
          ].join(' ')}
        >
          + Save as preset…
        </button>
        <button
          type="button"
          aria-expanded={showJsonPanel}
          onClick={() => setShowJsonPanel((v) => !v)}
          className={[
            'ml-auto inline-flex items-center rounded-full',
            'border border-gray-800 bg-transparent',
            'px-3 py-1 text-xs text-gray-500',
            'hover:border-gray-600 hover:text-gray-300',
          ].join(' ')}
        >
          JSON
        </button>
      </div>
      {showJsonPanel && (
        <div className="flex flex-col gap-2 border-t border-gray-800 pt-2">
          <p className="text-xs text-gray-500">
            Move presets between devices — there’s no login.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className={[
                'inline-flex items-center rounded-full',
                'border border-gray-700 bg-gray-900/60',
                'px-3 py-1 text-xs text-gray-200',
                'hover:border-indigo-500 hover:text-white',
              ].join(' ')}
            >
              Export JSON
            </button>
            <label
              className={[
                'inline-flex cursor-pointer items-center rounded-full',
                'border border-gray-700 bg-gray-900/60',
                'px-3 py-1 text-xs text-gray-200',
                'hover:border-indigo-500 hover:text-white',
              ].join(' ')}
            >
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportFile(file);
                  // Reset the input so re-selecting the same file fires onChange.
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {importError && (
            <p role="alert" className="text-xs text-red-400">
              {importError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact human-readable summary of a preset's args, used as the chip's
 * tooltip so the user can hover to see exactly what'll be applied. Order
 * is whatever `Object.entries` returns — fine for a tooltip; the actual
 * URL-state serialiser sorts deterministically for caching reasons.
 */
function summarisePresetArgs(args: UrlState): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '(no custom args)';
  return entries.map(([k, v]) => `${k}=${v}`).join(', ');
}
