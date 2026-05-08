'use client';

// Above-the-fold homepage drop zone.
//
// SEAN-75: dropping a file used to immediately `router.push()` to the slug
// page — but the `File` object lived in this component's memory and never
// made it to the destination, so the user had to drop it a second time. The
// cancellation rate at that step was the central UX failure of the funnel.
// We fixed that by running the conversion in place via the same
// `<ConverterPanel />` the slug pages use, with the File pre-loaded.
//
// SEAN-79: the homepage now also lets the user re-pick the output format
// before the conversion fires. Drop a `.mov` and the picker shows MP4
// (default), WEBM, MOV — chip row, FlagshipPills-style, no modal. The slug
// pages still lock the format on the slug (someone landing on
// `/convert/mov-to-mp4` from Google wants exactly mp4), but the homepage
// drop zone is the converter and a fixed target there is artificially
// limiting.
//
// Flow on the homepage:
//   1. User drops a file. We resolve the matrix row for the preferred target.
//   2. We show: file name + chip row of available outputs + Convert button.
//      The default chip is highlighted; the user can click another chip to
//      change the target (single click — no third step). We do NOT auto-fire
//      the upload here, because the user might want to re-pick.
//   3. User clicks Convert. We mount `<ConverterPanel initialFile={file} />`
//      with the picked row, and the panel auto-fires the upload on mount.
//
// SEO is unaffected: someone landing on `/convert/mov-to-mp4` directly from
// Google still gets the slug page with its input-locked drop zone — those
// pages don't render the picker (slug owns intent).

import { type DragEvent, useMemo, useRef, useState } from 'react';
import { ConverterPanel } from './ConverterPanel';
import {
  buildAcceptLabel,
  buildAcceptString,
  buildExtraArgs,
  findReverse,
  formatToExt,
} from './converter-row-args';
import {
  extOf,
  friendlyDropError,
  type MatrixRowMatch,
  matrixRowForFile,
  type OutputOption,
  outputsForExt,
} from './route-for-file';

/**
 * SEAN-79 internal state machine:
 *   - null      → empty hero drop zone (initial)
 *   - 'picking' → file dropped, picker visible, awaiting Convert click
 *   - 'running' → user clicked Convert (or only one option), ConverterPanel
 *                 is mounted with `initialFile` so the upload auto-fires
 */
type Stage =
  | { kind: 'idle' }
  | { kind: 'picking'; file: File; match: MatrixRowMatch }
  | { kind: 'running'; file: File; match: MatrixRowMatch };

export function HeroDrop() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const handleFile = (file: File) => {
    // SEAN-50 / SEAN-75: matrixRowForFile only resolves to rows whose
    // operation route is actually implemented (matrix slug + registry gate).
    // Anything else surfaces the friendly error — we don't drop the user
    // into a converter panel for an op we can't run.
    // SEAN-78: the error now lists the matrix-supported families ("video,
    // audio, images") rather than naming only video extensions, so users
    // dropping a .png/.mp3/.flac get a recommendation instead of a flat "no".
    const match = matrixRowForFile(file);
    if (!match) {
      setError(friendlyDropError(file.name));
      return;
    }
    setError(null);
    setStage({ kind: 'picking', file, match });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleClick = () => inputRef.current?.click();

  if (stage.kind === 'picking') {
    return (
      <FormatPicker
        file={stage.file}
        defaultMatch={stage.match}
        onConvert={(match) =>
          setStage({ kind: 'running', file: stage.file, match })
        }
        onCancel={() => setStage({ kind: 'idle' })}
      />
    );
  }

  if (stage.kind === 'running') {
    const { row } = stage.match;
    const reverse = findReverse(row);
    return (
      <ConverterPanel
        goOp={row.goOp}
        outputExt={formatToExt(row.outputFormat)}
        accept={buildAcceptString(row)}
        acceptLabel={buildAcceptLabel(row)}
        extraArgs={buildExtraArgs(row)}
        ffmpegCommand={row.ffmpegCommand}
        reverseSlug={reverse?.slug}
        reverseLabel={reverse?.label}
        reverseOperation={reverse?.operation}
        initialFile={stage.file}
        // SEAN-75: "Try another file" on the homepage tears the converter
        // back down to the original hero drop zone, so the user lands on a
        // clean, recognisable homepage state instead of an empty slug-shaped
        // panel.
        onReset={() => setStage({ kind: 'idle' })}
      />
    );
  }

  return (
    <div className="w-full">
      {/** biome-ignore lint/a11y/useSemanticElements: drop targets are containers, not buttons */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a file here or click to browse"
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          'flex w-full cursor-pointer flex-col items-center justify-center',
          'rounded-2xl border-2 border-dashed px-6 py-16 text-center',
          'transition-colors',
          dragOver
            ? 'border-indigo-400 bg-indigo-500/10'
            : 'border-gray-700 bg-gray-900/40 hover:border-indigo-500 hover:bg-gray-900/60',
        ].join(' ')}
      >
        <div aria-hidden className="mb-4 text-5xl">
          {/* simple icon glyph; no asset dependency */}
          {'\u{1F4C1}'}
        </div>
        <div className="text-xl font-semibold text-gray-100">
          Drop a file here
        </div>
        <div className="mt-2 text-sm text-gray-400">
          or{' '}
          <span className="underline decoration-indigo-400 underline-offset-2">
            click to browse
          </span>{' '}
          — video, audio, images
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────── FORMAT PICKER ───────────

interface FormatPickerProps {
  file: File;
  /**
   * Default-target match resolved by `matrixRowForFile` from the dropped file.
   * Used as the initial selection and to seed the input ext for `outputsForExt`.
   */
  defaultMatch: MatrixRowMatch;
  /** Fired when the user clicks Convert. Carries the resolved row. */
  onConvert: (match: MatrixRowMatch) => void;
  /** Fired when the user backs out (e.g. wrong file). */
  onCancel: () => void;
}

/**
 * SEAN-79 — homepage-only format picker. Server-renderable (the option list
 * is pure-function of input ext + matrix). Hidden from slug pages — those
 * lock the format on the slug.
 */
function FormatPicker({
  file,
  defaultMatch,
  onConvert,
  onCancel,
}: FormatPickerProps) {
  const ext = extOf(file.name);
  const options = useMemo(() => outputsForExt(ext), [ext]);

  // The picker only renders when there's at least one option. If `outputsForExt`
  // returns nothing (shouldn't happen — `matrixRowForFile` already resolved a
  // row, so at least the default row is in the matrix) we still surface the
  // default so the user has a way to convert.
  const initialFormat = defaultMatch.row.outputFormat;
  const [selectedFormat, setSelectedFormat] = useState(initialFormat);

  const selectedOption =
    options.find((o) => o.format === selectedFormat) ??
    ({
      row: defaultMatch.row,
      format: defaultMatch.row.outputFormat,
      label: formatToExt(defaultMatch.row.outputFormat).toUpperCase(),
      isDefault: true,
    } satisfies OutputOption);

  const handleConvert = () => {
    onConvert({
      row: selectedOption.row,
      inputFormat: defaultMatch.inputFormat,
    });
  };

  return (
    <div
      className={[
        'flex w-full flex-col items-center justify-center',
        'rounded-2xl border-2 border-dashed border-gray-700 bg-gray-900/40',
        'px-6 py-10 text-center',
      ].join(' ')}
    >
      <div aria-hidden className="mb-3 text-4xl">
        {'\u{1F4C4}'}
      </div>
      <div className="max-w-full truncate text-base font-medium text-gray-100">
        {file.name}
      </div>

      <div className="mt-6 w-full">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">
          Convert to
        </div>
        <ul
          aria-label="Output format"
          className="flex flex-wrap justify-center gap-2"
        >
          {options.map((option) => {
            const selected = option.format === selectedFormat;
            return (
              <li key={option.format}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedFormat(option.format)}
                  className={[
                    'inline-flex items-center rounded-full',
                    'border px-4 py-2 text-sm font-medium transition-colors',
                    selected
                      ? 'border-indigo-400 bg-indigo-500/20 text-white'
                      : 'border-gray-700 bg-gray-900/60 text-gray-100 hover:border-indigo-500 hover:bg-indigo-500/10',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleConvert}
          className={[
            'inline-flex items-center rounded-full',
            'border border-indigo-400 bg-indigo-500 px-6 py-2',
            'font-semibold text-sm text-white',
            'transition-colors hover:bg-indigo-400',
          ].join(' ')}
        >
          Convert to {selectedOption.label}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={[
            'inline-flex items-center rounded-full',
            'border border-gray-700 bg-transparent px-4 py-2',
            'text-gray-400 text-sm',
            'transition-colors hover:border-gray-600 hover:text-gray-300',
          ].join(' ')}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
