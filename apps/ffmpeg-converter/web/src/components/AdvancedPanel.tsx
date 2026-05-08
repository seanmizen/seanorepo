'use client';

// SEAN-95 — Layer 3 "Advanced..." disclosure for video convert pages.
//
// STRATEGY.md §"Where do fractal options give an edge?" specs a progressive-
// disclosure layer cake. Layers 0-2 (drop zone, target format, preset) ship
// as part of the slug-page + homepage flow already. This component is Layer 3
// — the per-conversion knob panel that power users (developers, podcasters,
// repeat visitors) need before they go to HandBrake. Hidden by default;
// remembered as expanded once the user opens it.
//
// Controls:
//   - CRF slider (0-51, default per row)
//   - Bitrate input (overrides CRF when set)
//   - Preset dropdown (ultrafast → veryslow)
//   - FPS override
//   - Audio bitrate
//   - Codec selector (hidden behind the "Show everything" power-user toggle)
//
// All controls write to URL state — the canonical home for converter options
// per #93 — so a panel state of `?crf=32&preset=slow&bitrate=2M` is shareable
// and bookmarkable. The displayed ffmpeg command (above the panel, owned by
// `<ConverterPanel />` via `applyUrlToFfmpegCommand`) updates live as the
// user tweaks (Layer 4 of the strategy doc).
//
// Backend coupling:
//   - The `transcode` / `transcode_webm` / `transcode_mkv` ops in `ops.go`
//     read `crf`, `bitrate`, `preset`, `fps`, `audio_bitrate`, `codec` via
//     `arg()` — keys here must match the snake_case form on the Go side.

import { useEffect, useMemo, useState } from 'react';
import {
  type AdvancedFormState,
  formStateToUrl,
  hydrateFormState,
} from './advanced-panel-state';
import {
  applyUrlState,
  applyUrlToFfmpegCommand,
  parseUrlState,
} from './url-state';

export type {
  AdvancedDefaults,
  AdvancedFormState,
} from './advanced-panel-state';
// Re-exports — call sites that already import from `<AdvancedPanel />` get
// the pure helpers without a second import. Tests import directly from
// `./advanced-panel-state` to avoid pulling React into the test runner.
export {
  formStateToUrl,
  hydrateFormState,
} from './advanced-panel-state';

const PRESET_OPTIONS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
] as const;

// Codec options the backend understands. Order: most common → niche. The
// power-user "Show everything" toggle reveals this dropdown; the default-
// codec inference happens server-side based on the output format.
const CODEC_OPTIONS = [
  { value: '', label: 'Auto (format default)' },
  { value: 'libx264', label: 'H.264 (libx264) — universal' },
  { value: 'libx265', label: 'H.265 / HEVC (libx265)' },
  { value: 'libvpx-vp9', label: 'VP9 (libvpx-vp9) — WebM' },
  { value: 'libaom-av1', label: 'AV1 (libaom-av1) — slow' },
  { value: 'mpeg4', label: 'MPEG-4 — legacy' },
] as const;

const LOCAL_STORAGE_KEY = 'ffmpegConverter:advancedPanelExpanded';
const LOCAL_STORAGE_SHOW_EVERYTHING = 'ffmpegConverter:advancedPanelShowAll';

export interface AdvancedPanelProps {
  /**
   * Operation. Used by URL-state read/write — the panel is currently only
   * mounted for `convert` rows but plumbed in case future ops adopt it.
   */
  operation: 'convert';
  /**
   * Matrix row's ffmpegCommand template — used for the live "Layer 4"
   * preview shown at the bottom of the disclosure. Per STRATEGY.md the
   * command should update live as the user tweaks; we show it inline so
   * the live-update is visible *before* the conversion runs (not just on
   * the result row).
   */
  ffmpegCommand?: string;
  /**
   * Default CRF for this row, sourced from `row.preset.crf` or the matrix
   * command literal. Used to initialise the slider when no URL value is
   * present.
   */
  defaultCrf?: number;
  /** Default `-preset` value (e.g. `medium`). */
  defaultPreset?: string;
  /** Default video bitrate (e.g. `500k`). Empty = CRF mode. */
  defaultBitrate?: string;
  /** Default fps (matches the row's preset.fps if present). */
  defaultFps?: string;
  /** Default audio bitrate (e.g. `128k`). */
  defaultAudioBitrate?: string;
  /** Default codec — only shown when the power-user toggle is on. */
  defaultCodec?: string;
}

function readInitialExpanded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOCAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readInitialShowAll(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOCAL_STORAGE_SHOW_EVERYTHING) === '1';
  } catch {
    return false;
  }
}

function persistExpanded(expanded: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, expanded ? '1' : '0');
  } catch {
    // localStorage may be disabled (private mode, quota exceeded). Silently
    // give up — disclosure state still works for the current session.
  }
}

function persistShowAll(showAll: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LOCAL_STORAGE_SHOW_EVERYTHING,
      showAll ? '1' : '0',
    );
  } catch {
    // ditto.
  }
}

export function AdvancedPanel({
  operation,
  ffmpegCommand,
  // Defaults below match the literals baked into the matrix ffmpeg commands
  // (and the per-op defaults the Go `runTranscode` helper uses when the form
  // arg is empty). Keep them in sync — a mismatch here means the slider
  // position lies about what the conversion will actually do.
  defaultCrf = 30,
  defaultPreset = 'ultrafast',
  defaultBitrate = '',
  defaultFps = '',
  defaultAudioBitrate = '',
  defaultCodec = '',
}: AdvancedPanelProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [showAll, setShowAll] = useState<boolean>(false);
  const [form, setForm] = useState<AdvancedFormState>(() =>
    hydrateFormState(
      {},
      {
        crf: defaultCrf,
        preset: defaultPreset,
        bitrate: defaultBitrate,
        fps: defaultFps,
        audio_bitrate: defaultAudioBitrate,
        codec: defaultCodec,
      },
    ),
  );

  // Hydrate from localStorage + URL on mount. SSR-safe (no-op when `window`
  // is undefined; React then re-runs the effect on the client).
  useEffect(() => {
    setExpanded(readInitialExpanded());
    setShowAll(readInitialShowAll());
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const url = parseUrlState(params, operation);
      setForm(
        hydrateFormState(url, {
          crf: defaultCrf,
          preset: defaultPreset,
          bitrate: defaultBitrate,
          fps: defaultFps,
          audio_bitrate: defaultAudioBitrate,
          codec: defaultCodec,
        }),
      );
    }
    // Defaults derive from a stable row reference; rerun only when the
    // operation changes (e.g. between routes during client navigation).
  }, [
    operation,
    defaultCrf,
    defaultPreset,
    defaultBitrate,
    defaultFps,
    defaultAudioBitrate,
    defaultCodec,
  ]);

  const update = (patch: Partial<AdvancedFormState>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      // Mirror the change into the URL so the displayed ffmpeg command (read
      // by `<ConverterPanel />` via the same URL) updates live and the link
      // is shareable. Uses replaceState — no history pollution, no scroll.
      applyUrlState(
        formStateToUrl(next, { crf: defaultCrf, preset: defaultPreset }),
        operation,
      );
      // replaceState doesn't fire `popstate`, so emit a custom event the
      // ConverterPanel listens for to re-read URL state. Keeps the read-side
      // (ConverterPanel) and write-side (AdvancedPanel) decoupled — neither
      // needs a direct prop wire.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ffmpeg-converter:url-state'));
      }
      return next;
    });
  };

  // Live preview of the ffmpeg command — Layer 4 of the strategy doc. Reads
  // the same `applyUrlToFfmpegCommand` ResultBlock uses so the post-conversion
  // copy-paste exactly matches what the panel was advertising mid-tweak.
  // We feed it the form (not the URL) so the preview updates instantly even
  // before the URL replace has propagated through ConverterPanel's listener.
  const previewCommand = useMemo(() => {
    if (!ffmpegCommand) return '';
    const url = formStateToUrl(form, {
      crf: defaultCrf,
      preset: defaultPreset,
    });
    // The URL-state has the right keys (crf, bitrate, preset, audio_bitrate)
    // — `applyUrlToFfmpegCommand` does the substitutions. width/fps don't
    // currently substitute on convert pages (no `scale=W:-1` in the matrix
    // string for transcode rows) but the helper handles that no-op cleanly.
    return applyUrlToFfmpegCommand(ffmpegCommand, url);
  }, [ffmpegCommand, form, defaultCrf, defaultPreset]);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      persistExpanded(next);
      return next;
    });
  };

  const toggleShowAll = () => {
    setShowAll((prev) => {
      const next = !prev;
      persistShowAll(next);
      return next;
    });
  };

  return (
    <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900/40">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls="advanced-panel-body"
        className={[
          'flex w-full items-center justify-between',
          'rounded-2xl px-5 py-3 text-left',
          'text-gray-200 text-sm font-medium',
          'transition-colors hover:bg-gray-900/70 focus:outline-none focus:ring-2 focus:ring-indigo-500',
        ].join(' ')}
      >
        <span>Advanced</span>
        <span aria-hidden className="text-gray-500">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div
          id="advanced-panel-body"
          className="space-y-5 border-gray-800 border-t px-5 py-5"
        >
          {/* CRF slider — the canonical quality knob for libx264/libx265/VP9.
              0 = lossless, 51 = unwatchable. 23 is the libx264 default. */}
          <div>
            <label
              htmlFor="adv-crf"
              className="flex items-baseline justify-between text-gray-200 text-sm"
            >
              <span>
                Quality (CRF){form.bitrate && ' — overridden by bitrate'}
              </span>
              <span className="text-gray-400 tabular-nums">{form.crf}</span>
            </label>
            <input
              id="adv-crf"
              type="range"
              min={0}
              max={51}
              step={1}
              value={form.crf}
              disabled={Boolean(form.bitrate)}
              onChange={(e) => update({ crf: e.target.value })}
              className="mt-2 w-full accent-indigo-500 disabled:opacity-50"
            />
            <div className="mt-1 flex justify-between text-gray-500 text-xs">
              <span>0 — lossless</span>
              <span>{defaultCrf} — default</span>
              <span>51 — tiny</span>
            </div>
          </div>

          {/* Bitrate input — overrides CRF when set. */}
          <div>
            <label
              htmlFor="adv-bitrate"
              className="block text-gray-200 text-sm"
            >
              Video bitrate (overrides CRF)
            </label>
            <input
              id="adv-bitrate"
              type="text"
              placeholder="e.g. 2M, 500k"
              value={form.bitrate}
              onChange={(e) => update({ bitrate: e.target.value.trim() })}
              className={[
                'mt-2 w-full rounded-lg border border-gray-700 bg-gray-950',
                'px-3 py-2 text-gray-100 text-sm',
                'focus:border-indigo-500 focus:outline-none',
              ].join(' ')}
            />
          </div>

          {/* Preset dropdown — speed/compression trade-off. */}
          <div>
            <label htmlFor="adv-preset" className="block text-gray-200 text-sm">
              Encoder preset
            </label>
            <select
              id="adv-preset"
              value={form.preset}
              onChange={(e) => update({ preset: e.target.value })}
              className={[
                'mt-2 w-full rounded-lg border border-gray-700 bg-gray-950',
                'px-3 py-2 text-gray-100 text-sm',
                'focus:border-indigo-500 focus:outline-none',
              ].join(' ')}
            >
              {PRESET_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* FPS override. */}
          <div>
            <label htmlFor="adv-fps" className="block text-gray-200 text-sm">
              Frame rate (fps) — leave blank for source rate
            </label>
            <input
              id="adv-fps"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 30"
              value={form.fps}
              onChange={(e) => update({ fps: e.target.value.trim() })}
              className={[
                'mt-2 w-full rounded-lg border border-gray-700 bg-gray-950',
                'px-3 py-2 text-gray-100 text-sm',
                'focus:border-indigo-500 focus:outline-none',
              ].join(' ')}
            />
          </div>

          {/* Audio bitrate. */}
          <div>
            <label
              htmlFor="adv-audio-bitrate"
              className="block text-gray-200 text-sm"
            >
              Audio bitrate
            </label>
            <input
              id="adv-audio-bitrate"
              type="text"
              placeholder="e.g. 128k"
              value={form.audio_bitrate}
              onChange={(e) => update({ audio_bitrate: e.target.value.trim() })}
              className={[
                'mt-2 w-full rounded-lg border border-gray-700 bg-gray-950',
                'px-3 py-2 text-gray-100 text-sm',
                'focus:border-indigo-500 focus:outline-none',
              ].join(' ')}
            />
          </div>

          {/* Power-user toggle. Hidden behind disclosure so casual users
              never see it; pre-checked is too aggressive. */}
          <div className="flex items-center gap-2 border-gray-800 border-t pt-4">
            <input
              id="adv-show-all"
              type="checkbox"
              checked={showAll}
              onChange={toggleShowAll}
              className="h-4 w-4 accent-indigo-500"
            />
            <label
              htmlFor="adv-show-all"
              className="text-gray-300 text-sm select-none"
            >
              Show everything (codec selector, etc.)
            </label>
          </div>

          {/* Codec selector — only when "Show everything" is on. STRATEGY.md
              line 119: "pix_fmt only for power users who toggled a 'show
              everything' checkbox". Same rule for codec. */}
          {showAll && (
            <div>
              <label
                htmlFor="adv-codec"
                className="block text-gray-200 text-sm"
              >
                Video codec
              </label>
              <select
                id="adv-codec"
                value={form.codec}
                onChange={(e) => update({ codec: e.target.value })}
                className={[
                  'mt-2 w-full rounded-lg border border-gray-700 bg-gray-950',
                  'px-3 py-2 text-gray-100 text-sm',
                  'focus:border-indigo-500 focus:outline-none',
                ].join(' ')}
              >
                {CODEC_OPTIONS.map((c) => (
                  <option key={c.value || 'auto'} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Live ffmpeg command preview — Layer 4 of the strategy doc. Updates
              instantly as the user tweaks any control above. The same string
              flows through to the post-conversion result row so copy-paste
              users see exactly what was advertised. */}
          {previewCommand && (
            <div className="border-gray-800 border-t pt-4">
              <div className="mb-2 text-gray-400 text-xs uppercase tracking-wider">
                Live ffmpeg command
              </div>
              <pre
                aria-label="Live ffmpeg command preview"
                className={[
                  'overflow-x-auto rounded-lg border border-gray-800 bg-gray-950',
                  'px-3 py-2 text-gray-200 text-xs leading-relaxed',
                ].join(' ')}
              >
                <code>{previewCommand}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
