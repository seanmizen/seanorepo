'use client';

// Client-only converter panel: owns the job state and toggles between the
// drop zone and the result block. Extracted from <ToolPage /> so the page
// shell (H1, value prop, sibling links, FAQ, "How it works") can render as
// a server component — keeping the route-specific JS as small as possible
// for Lighthouse / Core Web Vitals.
//
// Spec §7.2 render order is fixed at the page shell level; this component
// only handles the interactive convert step.

import { useState } from 'react';
import { type ConversionJob, DropZone } from './DropZone';
import { ResultBlock } from './ResultBlock';

export interface ConverterPanelProps {
  /** Backend op name. */
  goOp: string;
  /** Output extension (no leading dot) — used to name the download. */
  outputExt: string;
  /** `<input accept>` attribute, e.g. `.mov,.MOV`. */
  accept: string;
  /** Human-readable accept label, e.g. `MOV`. */
  acceptLabel: string;
  /** Extra args forwarded to the Go op. */
  extraArgs?: Record<string, string>;
  /** ffmpeg command shown in the result block. */
  ffmpegCommand: string;
  /** Reverse-tool slug fragment. */
  reverseSlug?: string;
  /** Reverse-tool label. */
  reverseLabel?: string;
  /** Operation prefix for the reverse URL. */
  reverseOperation?: string;
}

export function ConverterPanel({
  goOp,
  outputExt,
  accept,
  acceptLabel,
  extraArgs,
  ffmpegCommand,
  reverseSlug,
  reverseLabel,
  reverseOperation,
}: ConverterPanelProps) {
  const [job, setJob] = useState<ConversionJob | null>(null);

  if (!job) {
    return (
      <DropZone
        goOp={goOp}
        outputExt={outputExt}
        accept={accept}
        acceptLabel={acceptLabel}
        extraArgs={extraArgs}
        onJobComplete={setJob}
      />
    );
  }
  return (
    <ResultBlock
      job={job}
      ffmpegCommand={ffmpegCommand}
      reverseSlug={reverseSlug}
      reverseLabel={reverseLabel}
      reverseOperation={reverseOperation}
      onReset={() => setJob(null)}
    />
  );
}
