'use client';

// SEAN-106 — reusable output-format chip row.
//
// Extracted from `<HeroDrop />`'s `<RunningPanel />` (introduced in #79 and
// hardened in #81 for the auto-fire / abort-on-pick flow). The same chip row
// now also mounts above `<ConverterPanel />` on every non-gif slug page so
// the user can swap the output format mid-conversion without re-dropping the
// file. See `apps/ffmpeg-converter/docs/STRATEGY.md` § "Adaptive panel —
// input-type detection over URL-as-constraint".
//
// Sourcing principle (locked in SEAN-103 + SEAN-105): the chip row's options
// come from `outputsForExt(detectedInputExt)` — never hardcoded per-slug. The
// caller passes the *currently-detected* input ext (which is the slug's input
// on first paint, the dropped file's ext after a drop) and the active output
// format; this component handles rendering, hover state, and the click-to-pick
// callback.
//
// Hidden when `outputsForExt(ext).length < 2` — a one-output input (rare in
// practice) would render a single chip showing what's already running.

import { useMemo } from 'react';
import type { Format } from '@/ops/types';
import { outputsForExt } from './route-for-file';

export interface OutputFormatChipsProps {
  /**
   * The detected input extension (no leading dot). Drives the option set via
   * `outputsForExt(detectedInputExt)`. On first paint of a slug page this is
   * the slug's declared input; after a drop it's the dropped file's ext.
   */
  detectedInputExt: string;
  /**
   * Currently-active output format (the one the panel is converting to).
   * Matched against `option.format` to render the active chip's pressed state.
   */
  activeFormat: Format | string;
  /**
   * Called when the user picks a different output format. The caller is
   * responsible for swapping the panel's row + aborting any in-flight upload
   * (typically by re-keying the inner `<DropZone />` so its AbortController
   * cleanup fires on unmount).
   *
   * Picks of the already-active format are suppressed inside this component
   * — the callback only fires for genuine swaps.
   */
  onPick: (nextFormat: Format) => void;
  /**
   * Optional file name to display in the chip header — used by the homepage
   * `<HeroDrop />` flow to surface "{file.name} → .{ext}" alongside the chip
   * row. Slug pages don't render this header (the file may not be uploaded
   * yet on first paint and the surrounding shell already names the format).
   */
  fileName?: string;
  /**
   * Optional cancel button — used by the homepage flow to return to the empty
   * hero drop zone. Slug pages don't render Cancel (there's no empty state to
   * return to; "Try another file" on the result block is the equivalent).
   */
  onCancel?: () => void;
}

/**
 * SEAN-106 — output-format chip row. Renders one chip per `outputsForExt`
 * option; the active chip is `aria-pressed`. Returns `null` when fewer than
 * two options would render (per the AC: "When `outputsForExt(ext).length < 2`
 * chip row hides itself").
 */
export function OutputFormatChips({
  detectedInputExt,
  activeFormat,
  onPick,
  fileName,
  onCancel,
}: OutputFormatChipsProps) {
  const options = useMemo(
    () => outputsForExt(detectedInputExt),
    [detectedInputExt],
  );

  // Per AC: hide entirely when there's nothing to choose between.
  if (options.length < 2) return null;

  const handlePick = (nextFormat: string) => {
    if (nextFormat === activeFormat) return;
    onPick(nextFormat as Format);
  };

  return (
    <div
      className={[
        'mb-4 flex flex-col items-center gap-3',
        'rounded-2xl border border-gray-800 bg-gray-900/40',
        'px-4 py-3 sm:flex-row sm:justify-between',
      ].join(' ')}
    >
      {fileName ? (
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <span aria-hidden>{'\u{1F4C4}'}</span>
          <span className="max-w-[16rem] truncate font-medium">{fileName}</span>
          <span className="text-gray-500">→</span>
          <span className="font-medium text-gray-100">.{activeFormat}</span>
        </div>
      ) : null}
      <ul
        aria-label="Change output format"
        className="flex flex-wrap items-center justify-center gap-2"
      >
        <li className="text-xs text-gray-500">change format:</li>
        {options.map((option) => {
          const active = option.format === activeFormat;
          return (
            <li key={option.format}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => handlePick(option.format)}
                className={[
                  'inline-flex items-center rounded-full',
                  'border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-indigo-400 bg-indigo-500/20 text-white'
                    : 'border-gray-700 bg-gray-900/60 text-gray-200 hover:border-indigo-500 hover:bg-indigo-500/10',
                ].join(' ')}
              >
                {option.label}
              </button>
            </li>
          );
        })}
        {onCancel ? (
          <li>
            <button
              type="button"
              onClick={onCancel}
              className={[
                'inline-flex items-center rounded-full',
                'border border-gray-700 bg-transparent px-3 py-1',
                'text-xs text-gray-400',
                'transition-colors hover:border-gray-600 hover:text-gray-300',
              ].join(' ')}
            >
              Cancel
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
