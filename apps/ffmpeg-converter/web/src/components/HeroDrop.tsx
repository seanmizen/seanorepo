'use client';

// Above-the-fold homepage drop zone.
//
// SEAN-75: dropping a file used to immediately `router.push()` to the slug
// page — but the `File` object lived in this component's memory and never
// made it to the destination, so the user had to drop it a second time. We
// fixed that by running the conversion in place via the same
// `<ConverterPanel />` the slug pages use, with the File pre-loaded.
//
// SEAN-79: introduced a chip-row format picker so the user could re-pick the
// output format before the conversion fired. That added a third tap (drop →
// click chip → click Convert) for everyone — including the majority who want
// the inferred default.
//
// SEAN-81: the picker is now a *non-blocking* affordance. Drop a file and we
// fire the conversion immediately with the inferred default (mov→mp4,
// mp4→webm, png→webp, heic→jpg, audio→wav). While the upload is in flight
// (and after, until the user clicks "Try another file") we render a small
// chip row above the converter panel — "Converting to .X — change format?".
// Clicking a different chip aborts the in-flight request (via React unmount
// cleanup, which fires the `AbortController` inside `<DropZone />`) and
// remounts the panel with the new row. Clicking Cancel returns to the empty
// hero. See `apps/ffmpeg-converter/docs/STRATEGY.md` § "SEAN-81 — homepage
// drop fires conversion immediately" for the locked decision and rationale.
//
// SEO is unaffected: someone landing on `/convert/mov-to-mp4` directly from
// Google still gets the slug page with its input-locked drop zone — those
// pages don't render the chip row (slug owns intent).

import { type DragEvent, useMemo, useRef, useState } from 'react';
import type { Format, OperationRow } from '@/ops/types';
import { CapabilitiesPicker } from './CapabilitiesPicker';
import { ConverterPanel } from './ConverterPanel';
import {
  buildAcceptLabel,
  buildAcceptString,
  buildExtraArgs,
  findReverse,
  formatToExt,
} from './converter-row-args';
import {
  capabilitiesForExt,
  extOf,
  friendlyDropError,
  type MatrixRowMatch,
  matrixRowForFile,
} from './route-for-file';

/**
 * SEAN-81 internal state machine — collapsed to two stages from the SEAN-79
 * three-stage version:
 *   - 'idle'    → empty hero drop zone (initial)
 *   - 'running' → file dropped + ConverterPanel mounted (auto-fires upload).
 *                 The user can still re-pick format via the chip row above
 *                 the panel, which aborts the in-flight job and remounts the
 *                 panel with the new row.
 */
type Stage =
  | { kind: 'idle' }
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
    // audio, images") rather than naming only video extensions.
    const match = matrixRowForFile(file);
    if (!match) {
      setError(friendlyDropError(file.name));
      return;
    }
    setError(null);
    // SEAN-81: skip the picker stage — go straight to running with the
    // inferred default. The chip row above the panel lets the user re-pick.
    setStage({ kind: 'running', file, match });
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

  if (stage.kind === 'running') {
    return (
      <RunningPanel
        file={stage.file}
        match={stage.match}
        onChangeFormat={(nextMatch) =>
          // SEAN-81: switching the match changes the row.slug `key` we pass
          // to `<ConverterPanel />`, so React unmounts the old panel and
          // mounts a fresh one. The unmount fires the AbortController
          // cleanup inside `<DropZone />`, cancelling the in-flight upload.
          // The fresh mount auto-fires the upload for the new row.
          setStage({ kind: 'running', file: stage.file, match: nextMatch })
        }
        onCancel={() => setStage({ kind: 'idle' })}
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

// ─────────────────────────────────────────────────── RUNNING PANEL ───────────

interface RunningPanelProps {
  file: File;
  /** Currently-running match (default on first render, updated on chip click). */
  match: MatrixRowMatch;
  /** User picked a different output format mid-conversion. */
  onChangeFormat: (next: MatrixRowMatch) => void;
  /** User clicked Cancel — return to the empty hero drop zone. */
  onCancel: () => void;
}

/**
 * SEAN-81 — wraps the in-place ConverterPanel with a non-blocking chip row
 * that lets the user re-pick the output format mid-conversion (or after).
 * The panel itself auto-fires the upload via `initialFile`. Picking a chip
 * remounts the panel by changing the `key`, which:
 *
 *   1. Unmounts the old panel → `<DropZone />`'s effect cleanup aborts the
 *      in-flight `fetch`.
 *   2. Mounts a fresh panel with the new row → auto-fires upload for new ext.
 *
 * Hidden from slug pages — slug pages don't render this wrapper, they mount
 * `<ConverterPanel />` directly.
 */
function RunningPanel({
  file,
  match,
  onChangeFormat,
  onCancel,
}: RunningPanelProps) {
  const ext = extOf(file.name);
  const capabilities = useMemo(() => capabilitiesForExt(ext), [ext]);

  const { row } = match;
  const reverse = findReverse(row);
  const outputExt = formatToExt(row.outputFormat);

  // SEAN-121: capability-pick handler. Looks up the (operation, format) pair
  // in `capabilitiesForExt(ext)` and remounts the panel with the new row —
  // mirrors the slug-page handler in <ConverterPanel />. Replaces the
  // SEAN-106 format-only handler that only let users swap the output of the
  // existing operation.
  const handlePick = (next: {
    operation: OperationRow['operation'];
    format: Format;
  }) => {
    if (next.operation === row.operation && next.format === row.outputFormat) {
      return;
    }
    const cap = capabilities.find((c) => c.operation === next.operation);
    const opt = cap?.outputs.find((o) => o.format === next.format);
    if (!opt) return;
    onChangeFormat({
      row: opt.row,
      inputFormat: match.inputFormat,
    });
  };

  return (
    <div className="w-full">
      {/* SEAN-121: operation-first capabilities picker. Replaces the SEAN-106
          <OutputFormatChips /> entry surface. Surfaces every shipped operation
          that accepts the dropped file's media kind — convert, compress,
          extract-audio, gif, trim, resize, thumbnail, contact-sheet — instead
          of hiding the value-add operations behind the convert-only filter
          the old chip row used. The homepage flow passes the dropped file's
          name + a Cancel button (returns to empty hero); slug pages call the
          same component without those props. */}
      <CapabilitiesPicker
        detectedInputExt={ext}
        activeOperation={row.operation}
        activeFormat={row.outputFormat}
        onPick={handlePick}
        fileName={file.name}
        onCancel={onCancel}
      />
      <ConverterPanel
        // SEAN-81: keying on the row slug forces a fresh mount when the user
        // re-picks the output format. The unmount aborts the in-flight
        // request via DropZone's effect cleanup; the new mount fires the
        // upload for the new row.
        key={row.slug}
        goOp={row.goOp}
        outputExt={outputExt}
        accept={buildAcceptString(row)}
        acceptLabel={buildAcceptLabel(row)}
        extraArgs={buildExtraArgs(row)}
        ffmpegCommand={row.ffmpegCommand}
        reverseSlug={reverse?.slug}
        reverseLabel={reverse?.label}
        reverseOperation={reverse?.operation}
        operation={row.operation}
        initialFile={file}
        // SEAN-75: "Try another file" tears the panel back down to the
        // empty hero zone. Same hook the chip-row Cancel uses.
        onReset={onCancel}
      />
    </div>
  );
}
