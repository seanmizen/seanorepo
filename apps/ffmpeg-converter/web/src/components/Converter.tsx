'use client';

// The whole conversion flow on one card:
//   choose file → (set clip or size, when the tool needs it) → upload →
//   convert → download.
// A tool without controls starts as soon as the user chooses a file.
// There is no drag and drop. The page has one obvious button.
// On video pages, desktop browsers also get a second button: convert on
// this device. Only that button loads ffmpeg.wasm (src/local.ts).

import { useEffect, useId, useRef, useState } from 'react';
import { ConvertError, startJob, waitForJob } from '@/convert';
import {
  convertLocally,
  deviceRunsLocally,
  LocalError,
  toolRunsLocally,
} from '@/local';
import {
  acceptFor,
  downloadName,
  kindOfFile,
  MAX_UPLOAD_MB,
  type Tool,
} from '@/tools';

/** Where the conversion runs. The server is the default. */
type Mode = 'server' | 'local';

type State =
  | { step: 'idle' }
  | { step: 'setup'; file: File; mode: Mode }
  | { step: 'upload'; file: File; progress: number }
  | { step: 'convert'; file: File }
  | { step: 'load-local'; file: File }
  | { step: 'convert-local'; file: File; progress: number }
  | { step: 'done'; file: File; url: string; name: string; local: boolean }
  | { step: 'error'; file?: File; mode?: Mode; message: string };

export interface ConverterProps {
  tool: Tool;
  /** A file the user already chose, for example on the home page. */
  initialFile?: File;
  /** Called on "Convert another file". Default: back to the button. */
  onReset?: () => void;
}

export function Converter({ tool, initialFile, onReset }: ConverterProps) {
  const [state, setState] = useState<State>({ step: 'idle' });
  const [clip, setClip] = useState({ start: 0, end: 0 });
  const [shortSide, setShortSide] = useState('720');
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const blobUrl = useRef<string | undefined>(undefined);
  // Decided after the first render, so the server HTML and the first
  // client render match.
  const [localOk, setLocalOk] = useState(false);

  useEffect(() => {
    setLocalOk(toolRunsLocally(tool) && deviceRunsLocally());
  }, [tool]);

  useEffect(
    () => () => {
      abort.current?.abort();
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    },
    [],
  );

  const run = async (file: File, mode: Mode = 'server') => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const extra: Record<string, string> = {};
    let nameExtra = '';
    if (tool.controls === 'clip') {
      extra.start = clip.start.toFixed(2);
      extra.duration = Math.max(0.1, clip.end - clip.start).toFixed(2);
    }
    if (tool.controls === 'resolution') {
      extra.short_side = shortSide;
      nameExtra = `-${shortSide}p`;
    }
    const name = downloadName(file.name, tool, nameExtra);
    if (mode === 'local') {
      try {
        const url = await convertLocally(
          file,
          tool,
          extra,
          (step, progress) =>
            setState(
              step === 'load'
                ? { step: 'load-local', file }
                : { step: 'convert-local', file, progress: progress ?? 0 },
            ),
          ctl.signal,
        );
        if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
        blobUrl.current = url;
        setState({ step: 'done', file, url, name, local: true });
      } catch (e) {
        if (ctl.signal.aborted) return;
        setState({
          step: 'error',
          file,
          mode,
          message:
            e instanceof LocalError
              ? e.message
              : 'Something went wrong. Please try again.',
        });
      }
      return;
    }
    setState({ step: 'upload', file, progress: 0 });
    try {
      const job = await startJob(
        file,
        tool,
        extra,
        (progress) => setState({ step: 'upload', file, progress }),
        ctl.signal,
      );
      setState({ step: 'convert', file });
      await waitForJob(job, ctl.signal);
      setState({
        step: 'done',
        file,
        url: job.downloadUrl,
        name,
        local: false,
      });
    } catch (e) {
      if (ctl.signal.aborted) return;
      setState({
        step: 'error',
        file,
        mode,
        message:
          e instanceof ConvertError
            ? e.message
            : 'Something went wrong. Please try again.',
      });
    }
  };

  const choose = (file: File, mode: Mode = 'server') => {
    const kind = kindOfFile(file);
    if (kind !== tool.kind) {
      setState({
        step: 'error',
        message: `This page converts ${tool.kind} files, and ${file.name} is not a ${tool.kind} file. Go to the home page to find the right converter.`,
      });
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setState({
        step: 'error',
        message: `This file is too large. The limit is ${MAX_UPLOAD_MB / 1024} GB.`,
      });
      return;
    }
    if (tool.controls) {
      setClip({ start: 0, end: 0 });
      setState({ step: 'setup', file, mode });
    } else {
      void run(file, mode);
    }
  };

  // The home page hands over a file it already has.
  useEffect(() => {
    if (initialFile) choose(initialFile);
  }, [initialFile]);

  const reset = () => {
    abort.current?.abort();
    if (onReset) {
      onReset();
      return;
    }
    setState({ step: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
    if (localInputRef.current) localInputRef.current.value = '';
  };

  const noun =
    tool.accepts.length > 0 ? tool.accepts[0].toUpperCase() : tool.kind;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-8">
      {state.step === 'idle' && (
        <div className="text-center">
          <label className="inline-flex min-h-16 w-full cursor-pointer items-center justify-center rounded-xl bg-accent px-8 text-xl font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-hover focus-within:outline focus-within:outline-4 focus-within:outline-offset-2 focus-within:outline-accent sm:w-auto">
            Choose {noun} file
            <input
              ref={inputRef}
              type="file"
              accept={acceptFor(tool)}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) choose(f);
              }}
            />
          </label>
          <p className="mt-4 text-sm text-muted">
            Free. Up to {MAX_UPLOAD_MB / 1024} GB. Files are deleted after one
            hour.
          </p>
          {localOk && (
            <div className="mt-6 border-t border-line pt-6">
              <label className="inline-flex min-h-14 w-full cursor-pointer items-center justify-center rounded-xl bg-local px-6 text-lg font-semibold text-local-fg shadow-sm transition-colors hover:bg-local-hover focus-within:outline focus-within:outline-4 focus-within:outline-offset-2 focus-within:outline-local sm:w-auto">
                Convert on this device
                <input
                  ref={localInputRef}
                  type="file"
                  accept={acceptFor(tool)}
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) choose(f, 'local');
                  }}
                />
              </label>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted">
                Your file stays on this computer. It is slower than our server,
                and it downloads a 10 MB converter first.
              </p>
            </div>
          )}
        </div>
      )}

      {state.step === 'setup' && (
        <Setup
          tool={tool}
          file={state.file}
          clip={clip}
          setClip={setClip}
          shortSide={shortSide}
          setShortSide={setShortSide}
          onStart={() => run(state.file, 'server')}
          onStartLocal={localOk ? () => run(state.file, 'local') : undefined}
          preferLocal={state.mode === 'local'}
          onCancel={reset}
        />
      )}

      {state.step === 'upload' && (
        <Progress
          label={`Uploading ${state.file.name}`}
          fraction={state.progress}
          onCancel={reset}
        />
      )}

      {state.step === 'convert' && (
        <Progress
          label={`Converting to ${tool.outputExt.toUpperCase()}`}
          hint="Large videos can take a few minutes. Keep this page open."
          onCancel={reset}
        />
      )}

      {state.step === 'load-local' && (
        <Progress
          label="Loading the converter"
          hint="About 10 MB, only the first time. Your file stays on this computer."
          onCancel={reset}
        />
      )}

      {state.step === 'convert-local' && (
        <Progress
          label={`Converting to ${tool.outputExt.toUpperCase()} on this device`}
          fraction={state.progress}
          hint="Keep this tab open."
          onCancel={reset}
        />
      )}

      {state.step === 'done' && (
        <div className="text-center">
          <p className="text-lg font-semibold text-fg">
            Your {tool.outputExt.toUpperCase()} is ready
          </p>
          <a
            href={state.url}
            download={state.name}
            className="mt-5 inline-flex min-h-16 w-full items-center justify-center rounded-xl bg-accent px-8 text-xl font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-hover sm:w-auto"
          >
            Download {tool.outputExt.toUpperCase()}
          </a>
          <p className="mt-3 break-all text-sm text-muted">{state.name}</p>
          {state.local && (
            <p className="mt-1 text-sm text-muted">
              Converted on this device. Your file did not leave it.
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-6 text-base font-medium text-accent-text underline underline-offset-4"
          >
            Convert another file
          </button>
        </div>
      )}

      {state.step === 'error' && (
        <div className="text-center" role="alert">
          <p className="text-base text-danger">{state.message}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {state.file && (
              <button
                type="button"
                // After a failure on the device, the retry uses the server.
                onClick={() => state.file && choose(state.file, 'server')}
                className="min-h-12 rounded-xl bg-accent px-6 font-semibold text-accent-fg hover:bg-accent-hover"
              >
                {state.mode === 'local' ? 'Convert on our server' : 'Try again'}
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              className="min-h-12 rounded-xl border border-line px-6 font-semibold text-fg hover:bg-bg"
            >
              Choose another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Progress({
  label,
  fraction,
  hint,
  onCancel,
}: {
  label: string;
  /** 0..1, or undefined when the time left is unknown. */
  fraction?: number;
  hint?: string;
  onCancel: () => void;
}) {
  const pct = fraction === undefined ? undefined : Math.round(fraction * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="truncate font-medium text-fg">{label}</p>
        {pct !== undefined && <p className="tabular-nums text-muted">{pct}%</p>}
      </div>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        {pct === undefined ? (
          <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {hint && <p className="mt-3 text-sm text-muted">{hint}</p>}
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 text-sm text-muted underline underline-offset-4 hover:text-fg"
      >
        Cancel
      </button>
    </div>
  );
}

const RESOLUTIONS = [
  { value: '1080', label: '1080p', hint: 'Full HD' },
  { value: '720', label: '720p', hint: 'HD, smaller file' },
  { value: '480', label: '480p', hint: 'Smallest file' },
];

function Setup({
  tool,
  file,
  clip,
  setClip,
  shortSide,
  setShortSide,
  onStart,
  onStartLocal,
  preferLocal,
  onCancel,
}: {
  tool: Tool;
  file: File;
  clip: { start: number; end: number };
  setClip: (c: { start: number; end: number }) => void;
  shortSide: string;
  setShortSide: (s: string) => void;
  onStart: () => void;
  /** Present when the device can convert. */
  onStartLocal?: () => void;
  /** The user chose "Convert on this device" for this file. */
  preferLocal: boolean;
  onCancel: () => void;
}) {
  const local = preferLocal && onStartLocal !== undefined;
  const [src, setSrc] = useState<string>();
  const [duration, setDuration] = useState(0);
  // MKV, AVI and WMV often do not play in a browser. Then the user types
  // the times without a preview.
  const [noPreview, setNoPreview] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const startId = useId();
  const endId = useId();
  const isGif = tool.outputExt === 'gif';
  const maxLen = isGif ? 30 : Number.POSITIVE_INFINITY;

  useEffect(() => {
    if (tool.controls !== 'clip') return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file, tool.controls]);

  const len = clip.end - clip.start;
  const clipError =
    tool.controls !== 'clip' || (duration === 0 && !noPreview)
      ? ''
      : len <= 0
        ? 'The end must be after the start.'
        : len > maxLen
          ? `A GIF can be up to ${maxLen} seconds. This clip is ${len.toFixed(1)} seconds.`
          : '';

  const setTime = (which: 'start' | 'end', value: number) => {
    const v = Math.min(Math.max(0, value), duration || value);
    setClip({ ...clip, [which]: v });
  };

  return (
    <div>
      <p className="truncate font-medium text-fg">{file.name}</p>

      {tool.controls === 'clip' && (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: preview of the user's own file */}
          <video
            hidden={noPreview}
            ref={video}
            src={src}
            controls
            playsInline
            preload="metadata"
            className="mt-4 max-h-80 w-full rounded-lg bg-black"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (!Number.isFinite(d)) return;
              setDuration(d);
              setClip({ start: 0, end: isGif ? Math.min(d, 5) : d });
            }}
            onError={() => {
              setNoPreview(true);
              setClip({ start: 0, end: isGif ? 5 : 10 });
            }}
          />
          {noPreview && (
            <p className="mt-2 text-sm text-muted">
              Your browser cannot show this video. Type the start and end times.
            </p>
          )}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(
              [
                ['start', startId, 'Start'],
                ['end', endId, 'End'],
              ] as const
            ).map(([which, id, label]) => (
              <div key={which}>
                <label
                  htmlFor={id}
                  className="block text-sm font-medium text-fg"
                >
                  {label} (seconds)
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={duration || undefined}
                    step={0.1}
                    value={Number(clip[which].toFixed(1))}
                    onChange={(e) => setTime(which, Number(e.target.value))}
                    className="min-h-12 w-full rounded-lg border border-line bg-bg px-3 text-lg tabular-nums text-fg"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setTime(which, video.current?.currentTime ?? 0)
                    }
                    className="min-h-12 shrink-0 rounded-lg border border-line px-3 text-sm font-medium text-fg hover:bg-bg"
                  >
                    Use current time
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted" aria-live="polite">
            {clipError || `Clip length: ${Math.max(0, len).toFixed(1)} seconds`}
          </p>
        </>
      )}

      {tool.controls === 'resolution' && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-fg">Size</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {RESOLUTIONS.map((r) => (
              <label
                key={r.value}
                className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-line px-4 has-[:checked]:border-accent has-[:checked]:bg-accent/10"
              >
                <input
                  type="radio"
                  name="resolution"
                  value={r.value}
                  checked={shortSide === r.value}
                  onChange={() => setShortSide(r.value)}
                  className="accent-[rgb(var(--accent))]"
                />
                <span>
                  <span className="block font-semibold text-fg">{r.label}</span>
                  <span className="block text-sm text-muted">{r.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row">
        <button
          type="button"
          onClick={local ? onStartLocal : onStart}
          disabled={
            Boolean(clipError) ||
            (tool.controls === 'clip' && duration === 0 && !noPreview)
          }
          className={`min-h-14 w-full rounded-xl px-8 text-lg font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${
            local
              ? 'bg-local text-local-fg hover:bg-local-hover'
              : 'bg-accent text-accent-fg hover:bg-accent-hover'
          }`}
        >
          {tool.controls === 'clip'
            ? isGif
              ? 'Make GIF'
              : 'Trim video'
            : 'Resize video'}
          {local && ' on this device'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted underline underline-offset-4 hover:text-fg"
        >
          Choose another file
        </button>
      </div>
    </div>
  );
}
