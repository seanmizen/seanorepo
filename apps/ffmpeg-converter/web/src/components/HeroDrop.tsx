'use client';

// Above-the-fold homepage drop zone.
//
// SEAN-75: dropping a file used to immediately `router.push()` to the slug
// page — but the `File` object lived in this component's memory and never
// made it to the destination, so the user had to drop it a second time. The
// cancellation rate at that step was the central UX failure of the funnel.
//
// New behaviour (Option A — KISS): the homepage runs the conversion in
// place. We pick the matrix row using the same preference table as the old
// `routeForFile`, mount the same `<ConverterPanel />` the slug pages use, and
// hand it the dropped File via `initialFile` so it auto-fires the upload on
// mount. No navigation, no lost File, one drop.
//
// SEO is unaffected: someone landing on `/convert/mov-to-mp4` directly from
// Google still gets the slug page with its input-locked drop zone — those
// pages are unchanged.

import { type DragEvent, useRef, useState } from 'react';
import { ConverterPanel } from './ConverterPanel';
import {
  buildAcceptLabel,
  buildAcceptString,
  buildExtraArgs,
  findReverse,
  formatToExt,
} from './converter-row-args';
import {
  friendlyDropError,
  type MatrixRowMatch,
  matrixRowForFile,
} from './route-for-file';

interface ActiveJob {
  file: File;
  match: MatrixRowMatch;
}

export function HeroDrop() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveJob | null>(null);

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
    setActive({ file, match });
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

  // Conversion in flight (or done) — render the same ConverterPanel the slug
  // pages use, with the file pre-loaded so the upload auto-fires on mount.
  if (active) {
    const { row } = active.match;
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
        initialFile={active.file}
        // SEAN-75: "Try another file" on the homepage tears the converter
        // back down to the original hero drop zone, so the user lands on a
        // clean, recognisable homepage state instead of an empty slug-shaped
        // panel.
        onReset={() => setActive(null)}
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
