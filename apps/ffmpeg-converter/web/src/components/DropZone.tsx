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
  useRef,
  useState,
} from 'react';

export interface ConversionJob {
  /** Backend job id, e.g. UUID. */
  jobId: string;
  /** Same-origin download URL (`/api/jobs/<id>/output`). */
  downloadUrl: string;
  /** Original input filename, used to name the downloaded result. */
  inputFilename: string;
  /** Output extension (without leading dot), e.g. `mp4`, `webp`, `mp3`. */
  outputExt: string;
}

export interface DropZoneProps {
  /**
   * Backend op name as registered in the Go service (`ops.go::RegisterOps`).
   * Comes from the matrix row's `goOp` field.
   */
  goOp: string;
  /** Output format extension (no leading dot) — used to name the download. */
  outputExt: string;
  /**
   * Comma-separated list of accepted MIME types or extensions for the
   * `<input accept>` attribute (e.g. `.mov,.MOV,video/quicktime`).
   * Optional — accepting everything still works, the backend will reject.
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
}

type Status = 'idle' | 'uploading' | 'converting';

export function DropZone({
  goOp,
  outputExt,
  accept,
  acceptLabel,
  extraArgs,
  header,
  onJobComplete,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);

  const runConversion = useCallback(
    async (file: File) => {
      setError(null);
      setStatus('uploading');
      setPendingName(file.name);

      const form = new FormData();
      form.append('op', goOp);
      form.append('file', file);
      form.append('ext', outputExt);
      if (extraArgs) {
        for (const [k, v] of Object.entries(extraArgs)) {
          if (v !== '') form.append(k, v);
        }
      }

      try {
        setStatus('converting');
        const res = await fetch('/api/convert', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as {
          job_id?: string;
          output?: string;
        };
        const jobId = data.job_id ?? '';
        const downloadPath = data.output ?? `/jobs/${jobId}/output`;
        onJobComplete({
          jobId,
          downloadUrl: `/api${downloadPath}`,
          inputFilename: file.name,
          outputExt,
        });
        setStatus('idle');
        setPendingName(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus('idle');
        setPendingName(null);
      }
    },
    [goOp, outputExt, extraArgs, onJobComplete],
  );

  const handleFile = (file: File) => {
    void runConversion(file);
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
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={accept}
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
