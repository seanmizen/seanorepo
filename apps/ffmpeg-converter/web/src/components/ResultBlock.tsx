'use client';

// Result block shown after a successful conversion. Spec §7.2:
//   - download button
//   - "ffmpeg command:" code block, copy button
//   - "Try another file" button
//   - reverse-link to the inverse conversion (e.g. MP4 → MOV)
//
// Pure presentational client component. The parent (ToolPage) owns the job
// state and decides when to render this.

import Link from 'next/link';
import { useState } from 'react';
import type { ConversionJob } from './DropZone';

export interface ResultBlockProps {
  job: ConversionJob;
  /** ffmpeg command shown in the code block. */
  ffmpegCommand: string;
  /**
   * Reverse-tool slug fragment (e.g. `mp4-to-mov`). When present, renders a
   * "Convert X to Y instead?" link. Optional — not every row has a clean
   * reverse (e.g. extract-audio).
   */
  reverseSlug?: string;
  /** Reverse-tool label (e.g. "MP4 to MOV"). */
  reverseLabel?: string;
  /** Operation prefix for the reverse URL. Defaults to `convert`. */
  reverseOperation?: string;
  /** Called when the user clicks "Try another file". Resets the parent state. */
  onReset: () => void;
}

export function ResultBlock({
  job,
  ffmpegCommand,
  reverseSlug,
  reverseLabel,
  reverseOperation = 'convert',
  onReset,
}: ResultBlockProps) {
  const [copied, setCopied] = useState(false);

  const downloadName = buildDownloadName(job.inputFilename, job.outputExt);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ffmpegCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be denied (e.g. http://). Silently no-op — the user can
      // still triple-click the code block.
    }
  };

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
      <h2 className="text-xl font-semibold text-gray-100">Done.</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={job.downloadUrl}
          download={downloadName}
          className={[
            'inline-flex items-center rounded-lg px-5 py-2.5',
            'bg-indigo-500 text-sm font-semibold text-white',
            'transition-colors hover:bg-indigo-400',
          ].join(' ')}
        >
          Download {downloadName}
        </a>
        <button
          type="button"
          onClick={onReset}
          className={[
            'inline-flex items-center rounded-lg px-4 py-2.5',
            'border border-gray-700 bg-gray-900/60',
            'text-sm font-medium text-gray-100',
            'transition-colors hover:border-indigo-500 hover:bg-gray-900/80',
          ].join(' ')}
        >
          Try another file
        </button>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-300">
            ffmpeg command:
          </span>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy ffmpeg command to clipboard"
            className={[
              'inline-flex items-center rounded-md px-3 py-1.5',
              'border border-gray-700 bg-gray-900/60',
              'text-xs font-medium text-gray-100',
              'transition-colors hover:border-indigo-500 hover:bg-gray-900/80',
            ].join(' ')}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-950/80 p-4 text-xs text-gray-200">
          <code>{ffmpegCommand}</code>
        </pre>
      </div>

      {reverseSlug && reverseLabel && (
        <div className="mt-6 border-gray-800 border-t pt-4 text-sm text-gray-400">
          Need the other direction?{' '}
          <Link
            href={`/${reverseOperation}/${reverseSlug}`}
            className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200"
          >
            Convert {reverseLabel} instead
          </Link>
          .
        </div>
      )}
    </div>
  );
}

/**
 * Replace the input file's extension with the output extension. Falls back to
 * `output.<ext>` if the input has no extension at all.
 */
function buildDownloadName(input: string, outputExt: string): string {
  const dot = input.lastIndexOf('.');
  const base = dot > 0 ? input.slice(0, dot) : input || 'output';
  return `${base}.${outputExt}`;
}
