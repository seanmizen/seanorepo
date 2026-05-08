'use client';

// Client-only converter panel: owns the job state and toggles between the
// drop zone and the result block. Extracted from <ToolPage /> so the page
// shell (H1, value prop, sibling links, FAQ, "How it works") can render as
// a server component — keeping the route-specific JS as small as possible
// for Lighthouse / Core Web Vitals.
//
// Spec §7.2 render order is fixed at the page shell level; this component
// only handles the interactive convert step.
//
// SEAN-93 — reads URL query params on mount via `parseUrlState`, and any
// time the URL changes (popstate). The parsed state is merged into extraArgs
// (URL > preset > default) and substituted into the displayed ffmpeg command
// so a shared link like `/gif/mp4-to-gif?fps=24&width=320` rehydrates the
// panel and its copy-paste command verbatim. State writes go through
// `applyUrlState` which uses `history.replaceState` (no scroll jump, no
// history pollution).

import { useEffect, useMemo, useState } from 'react';
import type { Operation } from '@/ops/types';
import { type ConversionJob, DropZone } from './DropZone';
import { ResultBlock } from './ResultBlock';
import {
  applyUrlToFfmpegCommand,
  mergeUrlIntoExtraArgs,
  parseUrlState,
  type UrlState,
} from './url-state';

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
  /**
   * SEAN-93 — high-level operation. Drives the URL-param whitelist so a video
   * page rejects `max_colors` and a gif page rejects `crf`. Optional for
   * backwards compatibility; absent ⇒ URL-state is disabled for the panel.
   */
  operation?: Operation;
  /**
   * SEAN-75: pre-loaded file forwarded from the homepage drop zone. When set,
   * `<DropZone />` auto-fires the upload on mount so the user reaches the
   * converting/result UI without dropping a second time.
   */
  initialFile?: File;
  /**
   * SEAN-75: called when the user clicks "Try another file" in the result
   * block. Lets the homepage flow tear down the embedded converter and
   * restore the original hero drop zone, instead of leaving a slug-page-shaped
   * panel sitting on the homepage.
   */
  onReset?: () => void;
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
  operation,
  initialFile,
  onReset,
}: ConverterPanelProps) {
  const [job, setJob] = useState<ConversionJob | null>(null);

  // SEAN-93 — initial URL-state snapshot, read on mount. SSR-safe (returns
  // empty when `window` is undefined). Subscribes to `popstate` so the
  // browser back/forward buttons resync the panel; updates triggered by the
  // panel itself go through `applyUrlState` (replaceState) which doesn't
  // fire popstate, so there's no feedback loop.
  const [urlState, setUrlState] = useState<UrlState>({});

  useEffect(() => {
    if (typeof window === 'undefined' || !operation) return;
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      setUrlState(parseUrlState(params, operation));
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
    };
  }, [operation]);

  // Merge URL state into the row's preset-derived extraArgs (URL wins) and
  // substitute the same values into the displayed ffmpeg command so a copy-
  // paste of the command matches what the backend will run. Both are memoised
  // so DropZone's effect deps stay stable when nothing changed.
  const mergedExtraArgs = useMemo(
    () => mergeUrlIntoExtraArgs(extraArgs, urlState),
    [extraArgs, urlState],
  );
  const displayedCommand = useMemo(
    () => applyUrlToFfmpegCommand(ffmpegCommand, urlState),
    [ffmpegCommand, urlState],
  );

  if (!job) {
    return (
      <DropZone
        goOp={goOp}
        outputExt={outputExt}
        accept={accept}
        acceptLabel={acceptLabel}
        extraArgs={mergedExtraArgs}
        onJobComplete={setJob}
        initialFile={initialFile}
      />
    );
  }
  return (
    <ResultBlock
      job={job}
      ffmpegCommand={displayedCommand}
      reverseSlug={reverseSlug}
      reverseLabel={reverseLabel}
      reverseOperation={reverseOperation}
      onReset={() => {
        setJob(null);
        onReset?.();
      }}
    />
  );
}
