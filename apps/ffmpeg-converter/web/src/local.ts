// On-device conversion with ffmpeg.wasm. The server is the default. The
// user opts in per file, and only then does the page load ffmpeg.wasm and
// the 10 MB core from /ffmpeg/. Measurements: docs/WASM-SPIKE.md.

import type { Tool } from './tools';

/** Go ops that the WASM build can do with the same settings. */
const LOCAL_OPS = new Set([
  'transcode',
  'transcode_webm',
  'gif_from_video',
  'trim',
  'resize',
]);

/** True when this tool can run on the device. */
export function toolRunsLocally(tool: Tool): boolean {
  return tool.kind === 'video' && LOCAL_OPS.has(tool.op);
}

// The smallest module that uses a SIMD instruction. The core needs SIMD.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8,
  0, 65, 0, 253, 15, 253, 98, 11,
]);

/**
 * True when this browser can run the conversion. Phones are excluded until
 * we measure them: the spike has desktop numbers only.
 */
export function deviceRunsLocally(): boolean {
  if (typeof window === 'undefined' || typeof WebAssembly !== 'object') {
    return false;
  }
  const nav = navigator as Navigator & { userAgentData?: { mobile: boolean } };
  const mobile =
    nav.userAgentData?.mobile ??
    /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  // iPadOS reports itself as a Mac. A Mac has no touch points.
  const iPad = /Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1;
  if (mobile || iPad) return false;
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

/**
 * The ffmpeg arguments for a tool. They match the Go ops in ops.go, so a
 * file converted on the device matches one converted on the server.
 */
export function localArgs(
  tool: Tool,
  extra: Record<string, string>,
): { before: string[]; after: string[] } {
  const a = { ...tool.args, ...extra };
  const x264 = [
    '-c:v',
    'libx264',
    '-preset',
    a.preset ?? 'veryfast',
    '-crf',
    a.crf ?? '23',
    '-pix_fmt',
    'yuv420p',
  ];
  const faststart = ['mp4', 'mov', 'm4v'].includes(tool.outputExt)
    ? ['-movflags', '+faststart']
    : [];
  switch (tool.op) {
    case 'transcode':
      return {
        before: [],
        after: [
          ...x264,
          '-c:a',
          'aac',
          '-b:a',
          a.audio_bitrate ?? '160k',
          ...faststart,
        ],
      };
    case 'transcode_webm':
      return {
        before: [],
        after: [
          '-c:v',
          'libvpx-vp9',
          '-deadline',
          'realtime',
          '-crf',
          a.crf ?? '33',
          '-b:v',
          '0',
          '-c:a',
          'libopus',
          '-b:a',
          a.audio_bitrate ?? '128k',
        ],
      };
    case 'trim':
      return {
        before: ['-ss', a.start ?? '0'],
        after: [
          '-t',
          a.duration ?? '1',
          ...x264,
          '-c:a',
          'aac',
          '-b:a',
          a.audio_bitrate ?? '160k',
          ...faststart,
        ],
      };
    case 'resize': {
      const s = a.short_side ?? '720';
      return {
        before: [],
        after: [
          '-vf',
          `scale=${s}:${s}:force_original_aspect_ratio=increase:force_divisible_by=2`,
          ...x264,
          '-c:a',
          'copy',
          ...faststart,
        ],
      };
    }
    case 'gif_from_video':
      return {
        before: a.start ? ['-ss', a.start] : [],
        after: [
          ...(a.duration ? ['-t', a.duration] : []),
          '-vf',
          `fps=${a.fps ?? '10'},scale=${a.width ?? '480'}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
        ],
      };
    default:
      throw new Error(`${tool.op} does not run on the device`);
  }
}

// The parts of @ffmpeg/ffmpeg that we use. Its own types declare the
// webworker lib with no-default-lib, which removes the DOM types from the
// whole program, so we do not import them.
interface FFmpeg {
  load(config: {
    coreURL: string;
    wasmURL: string;
    workerURL?: string;
  }): Promise<boolean>;
  exec(args: string[]): Promise<number>;
  readFile(path: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<boolean>;
  createDir(path: string): Promise<boolean>;
  mount(
    fsType: 'WORKERFS',
    options: { files: File[] },
    dir: string,
  ): Promise<boolean>;
  unmount(dir: string): Promise<boolean>;
  on(event: 'progress', cb: (e: { progress: number }) => void): void;
  on(event: 'log', cb: (e: { message: string }) => void): void;
  off(event: 'progress', cb: (e: { progress: number }) => void): void;
  off(event: 'log', cb: (e: { message: string }) => void): void;
  terminate(): void;
}
let instance: Promise<FFmpeg> | undefined;

// With cross-origin isolation, the threaded core. Else the 1-thread core.
function threaded(): boolean {
  return self.crossOriginIsolated === true;
}

async function loadFFmpeg(): Promise<FFmpeg> {
  if (!instance) {
    instance = (async () => {
      // Served from /ffmpeg/ (scripts/copy-ffmpeg.mjs), not bundled: its
      // worker imports the core at run time, and webpack breaks that.
      const url = '/ffmpeg/ffmpeg/index.js';
      const { FFmpeg } = (await import(/* webpackIgnore: true */ url)) as {
        FFmpeg: new () => FFmpeg;
      };
      const ff = new FFmpeg();
      const base = threaded() ? '/ffmpeg/core-mt' : '/ffmpeg/core';
      await ff.load({
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
        ...(threaded() ? { workerURL: `${base}/ffmpeg-core.worker.js` } : {}),
      });
      return ff;
    })();
    // A failed load must not stick. The next try loads again.
    instance.catch(() => {
      instance = undefined;
    });
  }
  return instance;
}

// After an error or a cancel the instance is not safe to use again.
function discard() {
  const old = instance;
  instance = undefined;
  old?.then((ff) => ff.terminate()).catch(() => {});
}

export class LocalError extends Error {}

/**
 * Converts the file on the device. Calls onStep('load') while the core
 * loads, then onStep('convert', 0..1). Returns a blob URL of the result.
 */
export async function convertLocally(
  file: File,
  tool: Tool,
  extra: Record<string, string>,
  onStep: (step: 'load' | 'convert', fraction?: number) => void,
  signal: AbortSignal,
): Promise<string> {
  onStep('load');
  let ff: FFmpeg;
  try {
    ff = await loadFFmpeg();
  } catch (e) {
    console.warn('ffmpeg.wasm load failed:', e);
    throw new LocalError(
      'This browser could not start the converter. Our server can convert the file instead.',
    );
  }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

  const onAbort = () => discard();
  signal.addEventListener('abort', onAbort);
  const onProgress = ({ progress }: { progress: number }) =>
    onStep('convert', Math.min(1, Math.max(0, progress)));
  ff.on('progress', onProgress);
  const logs: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    logs.push(message);
    if (logs.length > 20) logs.shift();
  };
  ff.on('log', onLog);

  const output = `out.${tool.outputExt}`;
  const { before, after } = localArgs(tool, extra);
  // More than 4 threads deadlocks the threaded core (WASM-SPIKE.md).
  const threads = threaded()
    ? String(Math.min(4, navigator.hardwareConcurrency || 1))
    : '1';
  try {
    onStep('convert', 0);
    await ff.createDir('/in').catch(() => {});
    // Mount the file: the input is not copied into WASM memory.
    await ff.mount('WORKERFS', { files: [file] }, '/in');
    const code = await ff.exec([
      '-hide_banner',
      '-y',
      ...before,
      '-i',
      `/in/${file.name}`,
      '-threads',
      threads,
      ...after,
      output,
    ]);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (code !== 0) {
      console.warn('ffmpeg.wasm failed:', logs.join('\n'));
      discard();
      throw new LocalError(
        'We could not convert this file on your device. Our server can try instead.',
      );
    }
    const data = await ff.readFile(output);
    await ff.deleteFile(output).catch(() => {});
    const bytes =
      data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    return URL.createObjectURL(new Blob([bytes as BlobPart]));
  } catch (e) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (e instanceof LocalError) throw e;
    console.warn('ffmpeg.wasm error:', e);
    discard();
    throw new LocalError(
      'The conversion on your device stopped. Our server can convert the file instead.',
    );
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (instance) {
      ff.off('progress', onProgress);
      ff.off('log', onLog);
      await ff.unmount('/in').catch(() => {});
    }
  }
}
