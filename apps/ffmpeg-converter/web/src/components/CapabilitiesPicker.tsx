'use client';

// SEAN-121 — operation-first capabilities picker.
//
// Replaces the SEAN-106 `<OutputFormatChips />` for the picker entry surface.
// The old chip row asked "what output format do you want?" — the user is
// asking "what can I do with this file?". This component renders one chip
// per shipped operation that accepts the detected input's media kind, with
// the format sub-picker revealed only when the chosen op has more than one
// output format.
//
// Mental model:
//   - Drop .mov  →  Convert (MP4) [▾]   Compress  Extract audio (MP3) [▾]
//                   Make GIF  Trim  Resize  Thumbnail  Contact sheet
//                   ─ click a single-output chip → runs that op directly
//                   ─ click a multi-output chip → reveals format sub-picker
//   - Drop .png  →  Convert (WebP) [▾]
//                   ─ image-convert is the only op for png today; its chip
//                     reveals the sub-picker (jpg/webp/avif/png).
//   - Drop .mp3  →  Normalize audio
//                   ─ audio-to-audio convert rows don't exist today; the
//                     picker says so honestly via `EmptyCapabilities`.
//
// Sourcing principle (locked in SEAN-121, overturning the SEAN-79 / SEAN-103
// "different intents" framing): data comes from `capabilitiesForExt(ext)` —
// every shipped operation that has a routable matrix row for the input is
// surfaced. The picker never hardcodes a subset.
//
// Composition (explicitly open per SEAN-121 AC):
//   - Single-output ops render as a one-click chip with the operation's
//     friendly verb ("Compress", "Make GIF", "Trim", "Thumbnail").
//   - Multi-output ops render as a composite chip showing the operation +
//     the default output ("Convert (MP4)") with a chevron; clicking the
//     chevron (or the chip when the panel is closed) toggles a small
//     dropdown of all outputs. Clicking the chip body fires the default.
//   - The active capability (current op + format) is `aria-pressed`.

import { useState } from 'react';
import type { Format, OperationRow } from '@/ops/types';
import { capabilitiesForExt, type OperationCapability } from './route-for-file';

/**
 * Friendly verb-led labels for each operation. Used in the picker chips.
 * Mirrors the user's "what can I do with this file?" mental model:
 * verbs first ("Compress", "Make GIF"), not noun-based ("Compression").
 */
const OPERATION_VERB: Record<OperationRow['operation'], string> = {
  convert: 'Convert',
  'image-convert': 'Convert',
  compress: 'Compress',
  'extract-audio': 'Extract audio',
  gif: 'Make GIF',
  trim: 'Trim',
  resize: 'Resize',
  rotate: 'Rotate',
  thumbnail: 'Thumbnail',
  'contact-sheet': 'Contact sheet',
  'normalize-audio': 'Normalize audio',
  // Operations registered in the type but not yet routed — fall through to
  // a sensible default if they ever appear in the picker.
  'extract-frames': 'Extract frames',
  merge: 'Merge',
  mute: 'Mute',
  'change-speed': 'Change speed',
  'add-subtitles': 'Subtitles',
  'remove-audio': 'Remove audio',
  reverse: 'Reverse',
};

export interface CapabilitiesPickerProps {
  /**
   * Detected input extension (no leading dot). Drives the capability set via
   * `capabilitiesForExt(detectedInputExt)`. On first paint of a slug page
   * this is the slug's declared input; after a drop it's the dropped file's
   * ext.
   */
  detectedInputExt: string;
  /**
   * The operation currently driving the panel — `aria-pressed=true` for the
   * matching chip. After a drop on `/convert/mov-to-mp4` this is `convert`;
   * picking the GIF chip flips it to `gif`.
   */
  activeOperation?: OperationRow['operation'];
  /**
   * The active output format — used for the multi-output op chips' label
   * ("Convert (MP4)" instead of "Convert (default)"). `undefined` falls back
   * to the operation's default output.
   */
  activeFormat?: Format | string;
  /**
   * Called when the user picks a different (operation, output format) pair.
   * The caller is responsible for swapping the panel's row and updating the
   * URL via `history.replaceState`.
   */
  onPick: (next: {
    operation: OperationRow['operation'];
    format: Format;
  }) => void;
  /**
   * Optional file name to display alongside the picker — used by the
   * homepage flow to surface "{file.name} → .{ext}". Slug pages don't render
   * this header.
   */
  fileName?: string;
  /**
   * Optional cancel button — used by the homepage flow to return to the
   * empty hero drop zone.
   */
  onCancel?: () => void;
}

/**
 * SEAN-121 — operation-first picker. Renders one chip per operation; chips
 * for ops with multiple outputs reveal a format sub-picker on click.
 *
 * Returns `null` when there are no capabilities (unknown extension); returns
 * an honest "no operations available" message when the extension is known
 * but the matrix has no rows for it (the audio-without-audio-convert case).
 */
export function CapabilitiesPicker({
  detectedInputExt,
  activeOperation,
  activeFormat,
  onPick,
  fileName,
  onCancel,
}: CapabilitiesPickerProps) {
  const capabilities = capabilitiesForExt(detectedInputExt);
  const [openOp, setOpenOp] = useState<OperationRow['operation'] | null>(null);

  if (!detectedInputExt) return null;
  if (capabilities.length === 0) {
    return (
      <EmptyCapabilities
        ext={detectedInputExt}
        fileName={fileName}
        onCancel={onCancel}
      />
    );
  }

  const handlePick = (operation: OperationRow['operation'], format: Format) => {
    onPick({ operation, format });
    setOpenOp(null);
  };

  return (
    <div
      className={[
        'mb-4 flex flex-col items-stretch gap-3',
        'rounded-2xl border border-gray-800 bg-gray-900/40',
        'px-4 py-3',
      ].join(' ')}
    >
      {fileName ? (
        <div className="flex items-center justify-between gap-2 text-sm text-gray-300">
          <div className="flex items-center gap-2 truncate">
            <span aria-hidden>{'\u{1F4C4}'}</span>
            <span className="max-w-[16rem] truncate font-medium">
              {fileName}
            </span>
          </div>
          {onCancel ? (
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
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wide text-gray-500">
          What do you want to do?
        </span>
        <ul
          aria-label="Choose an operation"
          className="flex flex-wrap items-center gap-2"
        >
          {capabilities.map((cap) => (
            <CapabilityChip
              key={cap.operation}
              cap={cap}
              isActiveOp={cap.operation === activeOperation}
              activeFormat={activeFormat}
              isOpen={openOp === cap.operation}
              onToggle={() =>
                setOpenOp((current) =>
                  current === cap.operation ? null : cap.operation,
                )
              }
              onPick={handlePick}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────── CHIP ────────────────

interface CapabilityChipProps {
  cap: OperationCapability;
  isActiveOp: boolean;
  activeFormat?: Format | string;
  isOpen: boolean;
  onToggle: () => void;
  onPick: (operation: OperationRow['operation'], format: Format) => void;
}

/**
 * One chip in the capabilities picker.
 *
 * Single-output op  → renders as `<button>` running the op on click.
 * Multi-output op   → renders as a composite: a primary `<button>` running
 *                     the active (or default) format + a chevron toggle that
 *                     reveals the format sub-picker.
 */
function CapabilityChip({
  cap,
  isActiveOp,
  activeFormat,
  isOpen,
  onToggle,
  onPick,
}: CapabilityChipProps) {
  const verb = OPERATION_VERB[cap.operation] ?? cap.operation;
  const isMultiOutput = cap.outputs.length > 1;

  // Resolve the chip's "current" output: when this is the active op, the
  // active format; otherwise the operation's default. The label changes
  // accordingly so the user always knows which run is one click away.
  const currentOption = isActiveOp
    ? (cap.outputs.find((o) => o.format === activeFormat) ?? cap.defaultOption)
    : cap.defaultOption;

  // Single-output: one button, no chevron, no sub-picker.
  if (!isMultiOutput) {
    const isPressed = isActiveOp;
    return (
      <li>
        <button
          type="button"
          aria-pressed={isPressed}
          onClick={() => onPick(cap.operation, currentOption.format)}
          className={[
            'inline-flex items-center rounded-full',
            'border px-4 py-1.5 text-sm font-medium transition-colors',
            isPressed
              ? 'border-indigo-400 bg-indigo-500/20 text-white'
              : 'border-gray-700 bg-gray-900/60 text-gray-200 hover:border-indigo-500 hover:bg-indigo-500/10',
          ].join(' ')}
        >
          {verb}
        </button>
      </li>
    );
  }

  // Multi-output: composite chip.
  const isPressed = isActiveOp;
  return (
    <li className="relative">
      <span
        className={[
          'inline-flex items-stretch overflow-hidden rounded-full',
          'border transition-colors',
          isPressed
            ? 'border-indigo-400 bg-indigo-500/20'
            : 'border-gray-700 bg-gray-900/60 hover:border-indigo-500',
        ].join(' ')}
      >
        <button
          type="button"
          aria-pressed={isPressed}
          onClick={() => onPick(cap.operation, currentOption.format)}
          className={[
            'inline-flex items-center px-4 py-1.5 text-sm font-medium',
            isPressed
              ? 'text-white'
              : 'text-gray-200 hover:bg-indigo-500/10 hover:text-white',
          ].join(' ')}
        >
          {verb}
          <span className="ml-1 text-xs text-gray-400">
            ({currentOption.label})
          </span>
        </button>
        <button
          type="button"
          aria-label={`Choose ${verb} output format`}
          aria-expanded={isOpen}
          onClick={onToggle}
          className={[
            'inline-flex items-center px-2 py-1.5 text-sm',
            'border-l',
            isPressed
              ? 'border-indigo-400/60 text-white hover:bg-indigo-500/10'
              : 'border-gray-700 text-gray-400 hover:bg-indigo-500/10 hover:text-white',
          ].join(' ')}
        >
          <span aria-hidden>{isOpen ? '▴' : '▾'}</span>
        </button>
      </span>
      {isOpen ? (
        <ul
          aria-label={`${verb} output format`}
          className={[
            'absolute z-10 mt-1 flex min-w-[8rem] flex-col gap-0.5',
            'rounded-xl border border-gray-700 bg-gray-900',
            'p-1 shadow-lg',
          ].join(' ')}
        >
          {cap.outputs.map((option) => {
            const isFormatActive = isActiveOp && option.format === activeFormat;
            return (
              <li key={option.format}>
                <button
                  type="button"
                  aria-pressed={isFormatActive}
                  onClick={() => onPick(cap.operation, option.format)}
                  className={[
                    'flex w-full items-center justify-between rounded-md',
                    'px-3 py-1.5 text-sm transition-colors',
                    isFormatActive
                      ? 'bg-indigo-500/20 text-white'
                      : 'text-gray-200 hover:bg-indigo-500/10 hover:text-white',
                  ].join(' ')}
                >
                  <span>{option.label}</span>
                  {option.isDefault ? (
                    <span className="ml-2 text-xs text-gray-500">default</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

// ─────────────────────────────────────────────── EMPTY STATE ─────────────────

interface EmptyCapabilitiesProps {
  ext: string;
  fileName?: string;
  onCancel?: () => void;
}

/**
 * SEAN-121 AC: "If the matrix has no audio-to-audio convert rows yet, the
 * picker says so honestly rather than going blank."
 *
 * Used when the input ext is a known media kind we accept but no matrix row
 * has been wired for it yet (or all rows are gated out by the route
 * registry). The user sees a clear message instead of a blank panel.
 */
function EmptyCapabilities({
  ext,
  fileName,
  onCancel,
}: EmptyCapabilitiesProps) {
  return (
    <div
      className={[
        'mb-4 flex flex-col gap-2',
        'rounded-2xl border border-gray-800 bg-gray-900/40',
        'px-4 py-3',
      ].join(' ')}
    >
      {fileName ? (
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <span aria-hidden>{'\u{1F4C4}'}</span>
          <span className="truncate font-medium">{fileName}</span>
        </div>
      ) : null}
      <output className="block text-sm text-gray-300">
        We don't have any operations wired for <code>.{ext}</code> yet — the
        matrix is missing rows for this input. Try a different file format.
      </output>
      {onCancel ? (
        <div>
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
        </div>
      ) : null}
    </div>
  );
}
