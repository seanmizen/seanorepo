'use client';

// SEAN-92 — GIF preset chips + customise disclosure.
//
// Wraps `<ConverterPanel />` for `/gif/[slug]` pages with the gif-specific
// preset chip row + optional advanced controls. Keeps the slug page itself a
// server component — only this wrapper opts into client state.
//
// Pattern matches `<HeroDrop />`'s SEAN-79/-81 chip row: changing the active
// preset re-keys the inner `<ConverterPanel />`, which unmounts the old panel
// (cancelling the in-flight request via `<DropZone />`'s AbortController
// cleanup) and mounts a fresh one with the new args. The user gets a single
// click to swap presets mid-conversion — no manual cancel + redrop.
//
// Out of scope for v1 (per ticket #92): dither method UI (sticks to default
// `sierra2_4a` from the Tiny preset's `none`), max-colours UI (sticks to 256),
// reverse/boomerang, speed.

import { useMemo, useState } from 'react';
import type { OperationPreset } from '@/ops/types';
import { ConverterPanel, type ConverterPanelProps } from './ConverterPanel';

// ─────────────────────────────────────────────── PRESETS ─────────────────────

/**
 * SEAN-92 — preset chip definitions. The labels and values come straight from
 * the ticket's AC. `Tiny` uses `dither=none` per the AC's "no dither" hint;
 * `Smooth`/`Compact` keep the default Floyd-Steinberg-equivalent (sierra2_4a)
 * which the backend treats as default when the field is absent.
 */
export interface GifPresetChip {
  /** Stable id used as the React key + URL-safe slug if we ever surface in URL state. */
  id: 'smooth' | 'compact' | 'tiny';
  /** Chip label shown to the user. */
  label: string;
  /** Preset values forwarded to the backend via `extraArgs`. */
  preset: OperationPreset;
}

const smoothChip: GifPresetChip = {
  id: 'smooth',
  label: 'Smooth (480p, 20fps)',
  preset: { width: 480, fps: 20 },
};

export const GIF_PRESET_CHIPS: GifPresetChip[] = [
  smoothChip,
  {
    id: 'compact',
    label: 'Compact (320p, 15fps)',
    preset: { width: 320, fps: 15 },
  },
  {
    id: 'tiny',
    label: 'Tiny (240p, 10fps, no dither)',
    preset: { width: 240, fps: 10, dither: 'none' },
  },
];

const FPS_OPTIONS = [10, 15, 20, 24, 30] as const;
const WIDTH_OPTIONS = [240, 320, 480, 640] as const;

// ─────────────────────────────────────────────── ARG MAPPING ─────────────────

/**
 * Build the `extraArgs` map sent to the backend `gif_from_video` op. Mirrors
 * the field-naming in `converter-row-args.ts::buildExtraArgs` — kept inline
 * here because the values are derived from local component state, not the
 * matrix row's static preset.
 *
 * Empty/zero trim values are dropped so the backend's "no -ss / no -t" path
 * runs (palette is built from the full input).
 */
function buildPresetExtraArgs(preset: OperationPreset): Record<string, string> {
  const args: Record<string, string> = {};
  if (preset.width !== undefined) args.width = String(preset.width);
  if (preset.fps !== undefined) args.fps = String(preset.fps);
  if (preset.dither !== undefined) args.dither = preset.dither;
  if (preset.maxColors !== undefined)
    args.max_colors = String(preset.maxColors);
  if (preset.trimStartSec !== undefined && preset.trimStartSec > 0) {
    args.start = String(preset.trimStartSec);
  }
  if (preset.trimDurationSec !== undefined && preset.trimDurationSec > 0) {
    args.duration = String(preset.trimDurationSec);
  }
  return args;
}

/**
 * Re-render the ffmpeg command line shown to the dev-funnel user. Mirrors the
 * shape of the command in the matrix (`ffmpeg -i input.X -vf '...' output.gif`)
 * but with the live preset values substituted so the user can paste it into
 * their own terminal with the exact same args we just used.
 */
export function renderGifFfmpegCommand(
  inputExt: string,
  preset: OperationPreset,
): string {
  const width = preset.width ?? 480;
  const fps = preset.fps ?? 10;
  const dither = preset.dither ?? 'sierra2_4a';
  const maxColors = preset.maxColors ?? 256;
  const filter =
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${maxColors}[p];` +
    `[b][p]paletteuse=dither=${dither}`;
  const trimFlags: string[] = [];
  if (preset.trimStartSec !== undefined && preset.trimStartSec > 0) {
    trimFlags.push(`-ss ${preset.trimStartSec}`);
  }
  // -t goes after -i in the actual command we run, but ffmpeg accepts both
  // orderings; we surface the canonical shape for readability.
  if (preset.trimDurationSec !== undefined && preset.trimDurationSec > 0) {
    trimFlags.push(`-t ${preset.trimDurationSec}`);
  }
  const trim = trimFlags.length > 0 ? `${trimFlags.join(' ')} ` : '';
  return `ffmpeg ${trim}-i input.${inputExt} -vf '${filter}' output.gif`;
}

// ─────────────────────────────────────────────── COMPONENT ───────────────────

export interface GifPresetPanelProps
  extends Omit<ConverterPanelProps, 'extraArgs' | 'ffmpegCommand'> {
  /** Input format extension (no leading dot). Used to render the live ffmpeg
   *  command preview. Examples: `mp4`, `mov`, `webm`. */
  inputExt: string;
  /**
   * Initial preset id — defaults to `smooth` which matches the current
   * 480-wide default behaviour after #91. Chosen because it preserves the
   * width users get today; the fps bump from 10 to 20 is the Smooth chip's
   * deliberate trade-off (richer motion, larger file).
   */
  initialPresetId?: GifPresetChip['id'];
}

export function GifPresetPanel({
  inputExt,
  initialPresetId = 'smooth',
  ...converterProps
}: GifPresetPanelProps) {
  const [activePresetId, setActivePresetId] =
    useState<GifPresetChip['id']>(initialPresetId);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // Custom overrides — when the user opens the panel and changes a value,
  // it overrides the chip-preset's value. Reset on chip change so picking a
  // chip is always a clean re-fire with the chip's exact values.
  const [customFps, setCustomFps] = useState<number | null>(null);
  const [customWidth, setCustomWidth] = useState<number | null>(null);
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimDuration, setTrimDuration] = useState<number>(0);

  const baseChip = useMemo(
    () =>
      GIF_PRESET_CHIPS.find((c) => c.id === activePresetId) ??
      // GIF_PRESET_CHIPS is a const array with three entries — index 0 is
      // always defined. The `?? smoothChip` form keeps biome happy without
      // resorting to a non-null assertion.
      smoothChip,
    [activePresetId],
  );

  // Effective preset = base chip + custom overrides + trim. The trim values
  // are always live from the sliders (they live above the chip selection
  // conceptually — clipping a section is a different intent from "smaller
  // file or smoother motion").
  const effectivePreset: OperationPreset = useMemo(
    () => ({
      ...baseChip.preset,
      ...(customFps !== null ? { fps: customFps } : {}),
      ...(customWidth !== null ? { width: customWidth } : {}),
      ...(trimStart > 0 ? { trimStartSec: trimStart } : {}),
      ...(trimDuration > 0 ? { trimDurationSec: trimDuration } : {}),
    }),
    [baseChip, customFps, customWidth, trimStart, trimDuration],
  );

  const extraArgs = useMemo(
    () => buildPresetExtraArgs(effectivePreset),
    [effectivePreset],
  );

  const ffmpegCommand = useMemo(
    () => renderGifFfmpegCommand(inputExt, effectivePreset),
    [inputExt, effectivePreset],
  );

  // Stable key forces ConverterPanel to remount whenever any arg changes.
  // The remount unmounts the old DropZone, which fires its AbortController
  // cleanup and cancels the in-flight upload — same pattern as HeroDrop.
  // We hash the extraArgs into a single string so the key changes iff a
  // value the backend cares about changed.
  const panelKey = useMemo(
    () =>
      Object.entries(extraArgs)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&'),
    [extraArgs],
  );

  // Picking a chip resets the custom overrides — clicking "Compact" should
  // give exactly the Compact preset, not Compact-with-the-fps-you-tweaked.
  const handleChipClick = (id: GifPresetChip['id']) => {
    setActivePresetId(id);
    setCustomFps(null);
    setCustomWidth(null);
  };

  return (
    <div className="w-full">
      <ConverterPanel
        key={panelKey}
        {...converterProps}
        extraArgs={extraArgs}
        ffmpegCommand={ffmpegCommand}
      />

      {/* SEAN-92 — preset chip row. Lives below the converter panel per the
          ticket AC: the chips are an after-the-drop affordance for tinkering,
          not a pre-flight gate. Re-keying the panel above on any chip change
          aborts the in-flight upload. */}
      <div
        className={[
          'mt-6 flex flex-col gap-3',
          'rounded-2xl border border-gray-800 bg-gray-900/40',
          'px-4 py-4',
        ].join(' ')}
      >
        <ul
          aria-label="GIF preset"
          className="flex flex-wrap items-center gap-2"
        >
          <li className="text-xs text-gray-500 uppercase tracking-wider">
            Preset:
          </li>
          {GIF_PRESET_CHIPS.map((chip) => {
            const active = chip.id === activePresetId;
            return (
              <li key={chip.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleChipClick(chip.id)}
                  className={[
                    'inline-flex items-center rounded-full',
                    'border px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-indigo-400 bg-indigo-500/20 text-white'
                      : 'border-gray-700 bg-gray-900/60 text-gray-200 hover:border-indigo-500 hover:bg-indigo-500/10',
                  ].join(' ')}
                >
                  {chip.label}
                </button>
              </li>
            );
          })}
        </ul>

        <details
          open={customizeOpen}
          onToggle={(e) =>
            setCustomizeOpen((e.target as HTMLDetailsElement).open)
          }
          className="text-sm"
        >
          <summary className="cursor-pointer select-none text-gray-300 hover:text-gray-100">
            Customize
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            {/* fps row */}
            <div>
              <div className="mb-2 text-xs text-gray-500 uppercase tracking-wider">
                FPS
              </div>
              <ul className="flex flex-wrap gap-2">
                {FPS_OPTIONS.map((value) => {
                  const active =
                    (customFps ?? baseChip.preset.fps ?? 10) === value;
                  return (
                    <li key={value}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setCustomFps(value)}
                        className={[
                          'inline-flex items-center rounded-full',
                          'border px-3 py-1 text-xs font-medium transition-colors',
                          active
                            ? 'border-indigo-400 bg-indigo-500/20 text-white'
                            : 'border-gray-700 bg-gray-900/60 text-gray-200 hover:border-indigo-500 hover:bg-indigo-500/10',
                        ].join(' ')}
                      >
                        {value}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* width row */}
            <div>
              <div className="mb-2 text-xs text-gray-500 uppercase tracking-wider">
                Width
              </div>
              <ul className="flex flex-wrap gap-2">
                {WIDTH_OPTIONS.map((value) => {
                  const active =
                    (customWidth ?? baseChip.preset.width ?? 480) === value;
                  return (
                    <li key={value}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setCustomWidth(value)}
                        className={[
                          'inline-flex items-center rounded-full',
                          'border px-3 py-1 text-xs font-medium transition-colors',
                          active
                            ? 'border-indigo-400 bg-indigo-500/20 text-white'
                            : 'border-gray-700 bg-gray-900/60 text-gray-200 hover:border-indigo-500 hover:bg-indigo-500/10',
                        ].join(' ')}
                      >
                        {value}px
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* trim row */}
            <div>
              <div className="mb-2 text-xs text-gray-500 uppercase tracking-wider">
                Trim
              </div>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  <span>
                    Start: <span className="text-gray-200">{trimStart}s</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={0.5}
                    value={trimStart}
                    onChange={(e) => setTrimStart(Number(e.target.value))}
                    className="w-full accent-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  <span>
                    Duration:{' '}
                    <span className="text-gray-200">
                      {trimDuration === 0 ? 'full' : `${trimDuration}s`}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={0.5}
                    value={trimDuration}
                    onChange={(e) => setTrimDuration(Number(e.target.value))}
                    className="w-full accent-indigo-400"
                  />
                </label>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
