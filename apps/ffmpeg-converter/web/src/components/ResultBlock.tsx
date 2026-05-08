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
import { type DragEvent, useState } from 'react';
import type { ConversionJob } from './DropZone';
import {
  buildDownloadName,
  buildDownloadUrlPayload,
  mimeForExt,
} from './drag-out-download';

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

  // SEAN-96: drag the result out of the page directly into Finder, the
  // desktop, or an email/Slack compose window. Powered by Chromium's
  // `DownloadURL` data-transfer slot — Firefox sometimes ignores it, in
  // which case the user just sees an empty drag and falls back to the
  // Download button (which is always present).
  const handleDragStart = (event: DragEvent<HTMLAnchorElement>) => {
    if (!job.downloadUrl || typeof window === 'undefined') return;
    const payload = buildDownloadUrlPayload({
      downloadUrl: job.downloadUrl,
      filename: downloadName,
      outputExt: job.outputExt,
      origin: window.location.origin,
    });
    try {
      event.dataTransfer.setData('DownloadURL', payload);
      // Belt-and-braces: also set the URL/text slots so drop targets that
      // don't grok DownloadURL (most non-Chromium apps) at least get a
      // working hyperlink to the file.
      const absolute = payload.split(':').slice(2).join(':');
      event.dataTransfer.setData(
        'text/uri-list',
        `${mimeForExt(job.outputExt)}\n${absolute}`,
      );
      event.dataTransfer.setData('text/plain', absolute);
      event.dataTransfer.effectAllowed = 'copy';
    } catch {
      // Some browsers throw on unknown data-transfer types. The native
      // anchor drag still works (drops a URL onto most targets) — that's
      // the graceful fallback the AC calls out.
    }
  };

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
      <h2 className="text-xl font-semibold text-gray-100">Done.</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={job.downloadUrl}
          download={downloadName}
          draggable
          onDragStart={handleDragStart}
          title="Click to download, or drag to Finder / Mail / Slack"
          aria-label={`Download ${downloadName} (or drag to save anywhere)`}
          className={[
            'inline-flex items-center rounded-lg px-5 py-2.5',
            'bg-indigo-500 text-sm font-semibold text-white',
            'cursor-grab active:cursor-grabbing',
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
