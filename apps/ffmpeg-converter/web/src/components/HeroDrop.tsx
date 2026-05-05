'use client';

// Above-the-fold drop zone. Detects file type on drop / select and routes to
// the canonical tool page (e.g. .mov → /convert/mov-to-mp4). Acts as the
// homepage's primary CTA.
//
// Routing-only in Phase 1 — actual conversion happens on the destination tool
// page (Phase 2). We don't try to start the upload here because the tool page
// owns the conversion UI and result block.

import { useRouter } from 'next/navigation';
import { type DragEvent, useRef, useState } from 'react';
import { extOf, routeForFile } from './route-for-file';

export function HeroDrop() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (file: File) => {
    const target = routeForFile(file);
    if (!target) {
      const ext = extOf(file.name);
      setError(
        ext
          ? `We don't recognise .${ext} yet. Try MOV, MP4, WebM, MP3, JPG, or HEIC.`
          : "That file doesn't have an extension we can route on.",
      );
      return;
    }
    setError(null);
    router.push(target);
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
