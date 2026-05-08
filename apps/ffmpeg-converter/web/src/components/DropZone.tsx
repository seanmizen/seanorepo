'use client';

// Generic drop zone used on every pSEO tool page.
//
// Distinct from `HeroDrop` (homepage drop zone, which only routes by file
// extension). This drop zone *runs* the conversion: it accepts a file, posts
// it to the backend's `/api/convert` endpoint with the row's Go op name, and
// hands the resulting job back to the parent via `onJobComplete` / `onError`.
//
// Stays presentational — the parent (ToolPage) decides what to render with
// the result (see ResultBlock). DropZone owns: hover state, file input, the
// running spinner, and the upload itself.

import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type ConversionJob, submitConversion } from './submit-conversion';

// Re-export the job/args types from the JSX-free module so existing imports
// (`from './DropZone'`) keep working.
export type { ConversionJob, SubmitConversionArgs } from './submit-conversion';
export { submitConversion } from './submit-conversion';

export interface DropZoneProps {
  /**
   * Backend op name as registered in the Go service (`ops.go::RegisterOps`).
   * Comes from the matrix row's `goOp` field. Used as the default when
   * `resolveArgsForFile` is unset or returns a partial result.
   */
  goOp: string;
  /** Output format extension (no leading dot) — used to name the download. */
  outputExt: string;
  /**
   * Comma-separated list of accepted MIME types or extensions. Historically
   * forwarded into the underlying `<input type="file">` `accept` attribute.
   *
   * SEAN-105: NO LONGER FORWARDED. Slug pages used to lock the picker to the
   * row's input formats — drop a `.mov` on `/convert/mp4-to-gif` and the
   * browser silently rejected it. The panel now detects the input type from
   * the dropped file and adapts in place (see `ConverterPanel.slugDefault`),
   * so we accept any file at the picker. The prop is kept for source-compat
   * with existing call sites and may be removed in a follow-up.
   */
  accept?: string;
  /**
   * Human-readable list of accepted formats shown in the drop zone copy
   * (e.g. `MOV` or `MP4, MOV, WebM`). Falls back to "your file" if absent.
   */
  acceptLabel?: string;
  /**
   * Extra args forwarded to the Go op as multipart form fields. Used by
   * preset-driven rows (e.g. `targetSizeMb` for compress under-25mb).
   */
  extraArgs?: Record<string, string>;
  /** Slot above the drop target — typically the H1 + value prop. */
  header?: ReactNode;
  /** Called when the upload + conversion succeeds. */
  onJobComplete: (job: ConversionJob) => void;
  /**
   * SEAN-75: pre-loaded file. When provided, the drop zone immediately fires
   * the upload on mount instead of waiting for a fresh user drop. Used by the
   * homepage flow where the user already provided a file in the hero zone —
   * the file is forwarded to a freshly-mounted `<DropZone />` so they don't
   * have to drop it a second time.
   */
  initialFile?: File;
  /**
   * SEAN-105: optional per-file argument resolver. Called synchronously
   * before each `submitConversion`, with the file the user just dropped.
   * Returning a partial set replaces the corresponding prop defaults for
   * that single conversion (e.g. swapping `goOp` from `gif_from_video`
   * driven by `mp4` to the same op driven by `mov` after detecting the
   * actual input type).
   *
   * Keeping the resolver synchronous side-steps React's stale-state problem
   * — the parent can't update `goOp` props in time for the imminent submit,
   * but it CAN inspect the file and return the right args directly.
   *
   * SEAN-108: returning `{ reject: true }` blocks the imminent submit and
   * fires `onFileRejected` instead. Used by the slug-page panel to surface
   * `friendlyDropError` when the dropped file has no matrix coverage at all
   * (`.zip`, `.exe`, `.docx`, `.tif`) — without this the conversion would
   * fire with the slug's default `goOp` and the backend would reject it
   * with an opaque "unsupported input" error.
   */
  resolveArgsForFile?: (file: File) =>
    | {
        goOp?: string;
        outputExt?: string;
        extraArgs?: Record<string, string>;
        reject?: false;
      }
    | { reject: true }
    | null;
  /**
   * SEAN-108: called when `resolveArgsForFile` returns `{ reject: true }`.
   * The drop zone surrenders control of rendering to the parent — typically
   * the parent replaces the dropzone with a friendly message + Clear button.
   */
  onFileRejected?: (file: File) => void;
}

type Status = 'idle' | 'uploading' | 'converting';

export function DropZone({
  goOp,
  outputExt,
  accept: _acceptIgnored,
  acceptLabel,
  extraArgs,
  header,
  onJobComplete,
  initialFile,
  resolveArgsForFile,
  onFileRejected,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);

  // SEAN-81: track the in-flight AbortController so the effect cleanup can
  // cancel the upload when the parent unmounts/remounts the panel (e.g. when
  // the homepage user picks a different output format mid-conversion).
  const abortRef = useRef<AbortController | null>(null);

  const runConversion = useCallback(
    async (file: File) => {
      // SEAN-108: rejection branch runs BEFORE we flip into the busy state
      // so the parent's friendly-fallback UI swaps in immediately, with no
      // spinner flash. The resolver decides; we just plumb the signal.
      const overrides = resolveArgsForFile?.(file) ?? null;
      if (overrides && 'reject' in overrides && overrides.reject === true) {
        onFileRejected?.(file);
        return;
      }

      setError(null);
      setStatus('uploading');
      setPendingName(file.name);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setStatus('converting');
        // SEAN-105: synchronous per-file override hook. Lets ConverterPanel
        // detect the dropped file's type and supply matching args before the
        // submit fires (the React state update in the parent runs after this
        // callback chain returns, so we can't rely on prop changes here).
        const job = await submitConversion({
          file,
          goOp: overrides?.goOp ?? goOp,
          outputExt: overrides?.outputExt ?? outputExt,
          extraArgs: overrides?.extraArgs ?? extraArgs,
          signal: controller.signal,
        });
        onJobComplete(job);
        setStatus('idle');
        setPendingName(null);
      } catch (e) {
        // Aborted requests are expected when the parent remounts the panel
        // (e.g. format change mid-conversion). Don't surface as an error.
        const isAbort =
          (e instanceof DOMException && e.name === 'AbortError') ||
          (e instanceof Error && e.name === 'AbortError');
        if (!isAbort) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
        }
        setStatus('idle');
        setPendingName(null);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [
      goOp,
      outputExt,
      extraArgs,
      onJobComplete,
      resolveArgsForFile,
      onFileRejected,
    ],
  );

  const handleFile = (file: File) => {
    void runConversion(file);
  };

  // SEAN-75: when the homepage hands us a pre-dropped file, fire the upload
  // immediately on mount so the user doesn't have to interact a second time.
  // Each `initialFile` is auto-submitted exactly once — subsequent renders
  // (parent re-render, status changes) don't re-fire because we key on the
  // File object reference. (biome's useExhaustiveDependencies is off in the
  // repo config, so we don't need a suppression comment for the missing
  // `runConversion` dep — that's intentional, fire only on file change.)
  //
  // SEAN-81: on cleanup (component unmount, e.g. the parent remounted with a
  // different `goOp`/`outputExt` because the user changed the output format),
  // abort the in-flight request. Without this, the user changes their mind to
  // .webm and we still finish the .mp4 upload they cancelled — wasted server
  // compute and bandwidth.
  useEffect(() => {
    if (initialFile) {
      void runConversion(initialFile);
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [initialFile]);

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

  const handleClick = () => {
    if (status === 'idle') inputRef.current?.click();
  };

  const busy = status !== 'idle';

  return (
    <div className="w-full">
      {header}
      {/** biome-ignore lint/a11y/useSemanticElements: drop targets are containers, not buttons */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a file here or click to browse"
        aria-disabled={busy}
        onClick={handleClick}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            e.preventDefault();
            handleClick();
          }
        }}
        onDrop={busy ? undefined : handleDrop}
        onDragOver={busy ? undefined : handleDragOver}
        onDragLeave={busy ? undefined : handleDragLeave}
        className={[
          'flex w-full flex-col items-center justify-center',
          'rounded-2xl border-2 border-dashed px-6 py-16 text-center',
          'transition-colors',
          busy ? 'cursor-wait' : 'cursor-pointer',
          dragOver
            ? 'border-indigo-400 bg-indigo-500/10'
            : 'border-gray-700 bg-gray-900/40 hover:border-indigo-500 hover:bg-gray-900/60',
        ].join(' ')}
      >
        <div aria-hidden className="mb-4 text-5xl">
          {busy ? '⏳' : '\u{1F4C1}'}
        </div>
        {busy ? (
          <>
            <div className="text-xl font-semibold text-gray-100">
              {status === 'uploading' ? 'Uploading…' : 'Converting…'}
            </div>
            {pendingName && (
              <div className="mt-2 max-w-full truncate text-sm text-gray-400">
                {pendingName}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-xl font-semibold text-gray-100">
              Drop a {acceptLabel ?? 'file'} here
            </div>
            <div className="mt-2 text-sm text-gray-400">
              or{' '}
              <span className="underline decoration-indigo-400 underline-offset-2">
                click to browse
              </span>
            </div>
          </>
        )}
        {/* SEAN-105: no `accept` attribute. The picker accepts every file;
            the panel detects the input type and adapts its op + args in
            place via `resolveArgsForFile`. Also no extension-based guard
            in `handleDrop` — every dropped file flows through. */}
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
          Conversion failed: {error}
        </p>
      )}
    </div>
  );
}
