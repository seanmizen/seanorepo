// The playback in a browser. A loop draws the frames on a <canvas> at the
// playback frame rate. During the first pass, MediaRecorder records the
// canvas, and the result is the video file for "Download" (WebM in Chrome
// and Firefox, MP4 in Safari). The recording runs in real time, so the file
// is ready when the first pass ends. The phone build uses Playback.tsx.

import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Frame, PlaybackProps } from '../types';

const TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

export function Playback({ frames, fps, onAction }: PlaybackProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    el.width = frames[0].width;
    el.height = frames[0].height;
    const run = { stopped: false };
    let url: string | null = null;

    const play = async () => {
      const recording = startRecording(el, fps);
      onAction({
        label: 'Download',
        run: null,
        note: recording
          ? 'Making the video.'
          : 'This browser cannot record video.',
      });
      await playOnce(ctx, frames, fps, run, recording?.frame);
      if (recording) {
        const blob = await recording.finish();
        if (run.stopped) return;
        url = URL.createObjectURL(blob);
        const href = url;
        const name = `timelapse-${stamp()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
        onAction({
          label: 'Download',
          run: () => download(href, name),
          note: `${name.split('.').pop()?.toUpperCase()}, ${formatSize(blob.size)}`,
        });
      }
      while (!run.stopped) await playOnce(ctx, frames, fps, run);
    };
    play().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!run.stopped)
        onAction({ label: 'Download', run: null, note: message });
    });

    return () => {
      run.stopped = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [frames, fps]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <canvas ref={canvas} style={fill} />
    </View>
  );
}

/**
 * Draws each frame at its time: frame i at i / fps seconds after the start.
 * The next image decodes while the current one shows. After the last frame,
 * it waits one more frame time, so the last frame has its full time in the
 * video too. Each draw is in an animation frame. In Chrome, this gives one
 * video frame for each draw more reliably than a timer does.
 */
async function playOnce(
  ctx: CanvasRenderingContext2D,
  frames: Frame[],
  fps: number,
  run: { stopped: boolean },
  onDraw?: () => void,
) {
  const step = 1000 / fps;
  const start = performance.now();
  let next = load(frames[0].uri);
  for (let i = 0; i < frames.length; i++) {
    const image = await next;
    if (i + 1 < frames.length) next = load(frames[i + 1].uri);
    await animationFrameAt(start + i * step);
    if (run.stopped) return;
    ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
    onDraw?.();
  }
  await animationFrameAt(start + frames.length * step);
  onDraw?.();
}

/** Records the canvas. Each call to `frame` adds the canvas to the video. */
function startRecording(canvas: HTMLCanvasElement, fps: number) {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream)
    return null;
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) return null;
  // A rate of 0 adds a frame only at requestFrame(), so the video has
  // exactly the frames that playOnce draws.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.max(4_000_000, fps * 200_000),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () =>
      resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
  });
  recorder.start();
  return {
    frame: () => track.requestFrame(),
    finish: () => {
      recorder.stop();
      track.stop();
      return done;
    },
  };
}

function load(uri: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = uri;
  return image.decode().then(() => image);
}

/** Resolves in the first animation frame at or after `time`, less 4 ms. */
function animationFrameAt(time: number): Promise<void> {
  return new Promise((resolve) => {
    const tick = (now: number) => {
      if (now >= time - 4) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 2026-11-16T14:03:05 -> "20261116-140305". */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const fill = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  background: '#000',
} as const;
