// The browser webcam, with getUserMedia. The browser shows its own
// permission prompt. Each frame is a JPEG blob, drawn from the <video>
// element. The phone build uses Camera.tsx.

import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CameraProps, Frame } from '../types';
import { Notice } from '../ui';

/** The longest side of a frame, in pixels. It keeps a long capture in memory. */
const MAX_SIDE = 1280;

export function Camera({ deviceId, onDevices, onReady, ref }: CameraProps) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setProblem(
        'This page has no camera access. The browser gives the camera only to an HTTPS page.',
      );
      return;
    }
    let stream: MediaStream | null = null;
    let closed = false;
    setProblem(null);
    onReady(false);

    const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
    media
      .getUserMedia({
        audio: false,
        video: deviceId ? { ...size, deviceId: { exact: deviceId } } : size,
      })
      .then(async (opened) => {
        if (closed) {
          stopTracks(opened);
          return;
        }
        stream = opened;
        const el = video.current;
        if (!el) return;
        el.srcObject = opened;
        await el.play();
        // The device labels are empty until the user allows the camera.
        const all = await media.enumerateDevices();
        const cameras = all.filter((d) => d.kind === 'videoinput');
        const activeId = opened.getVideoTracks()[0]?.getSettings().deviceId;
        if (closed) return;
        onDevices(
          cameras.map((d, i) => ({
            id: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
          })),
          activeId ?? '',
        );
        onReady(true);
      })
      .catch((error: unknown) => {
        if (!closed) setProblem(describe(error));
      });

    return () => {
      closed = true;
      onReady(false);
      if (stream) stopTracks(stream);
    };
  }, [deviceId, attempt]);

  useImperativeHandle(
    ref,
    () => ({
      async capture(): Promise<Frame> {
        const el = video.current;
        if (!el?.videoWidth) throw new Error('The camera has no picture.');
        const scale = Math.min(
          1,
          MAX_SIDE / Math.max(el.videoWidth, el.videoHeight),
        );
        const width = Math.round(el.videoWidth * scale);
        const height = Math.round(el.videoHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(el, 0, 0, width, height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.9),
        );
        if (!blob) throw new Error('The browser did not make the frame.');
        return { uri: URL.createObjectURL(blob), width, height };
      },
    }),
    [],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <video ref={video} autoPlay muted playsInline style={fill} />
      {problem && (
        <Notice
          text={problem}
          action={{ label: 'Try again', run: () => setAttempt((a) => a + 1) }}
        />
      )}
    </View>
  );
}

/** Frees the memory of the frame blobs. */
export function releaseFrames(frames: Frame[]) {
  for (const frame of frames) URL.revokeObjectURL(frame.uri);
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function describe(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The browser refused the camera. Allow the camera for this site, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera found. Connect a camera, then try again.';
  }
  if (name === 'NotReadableError') {
    return 'The camera did not start. Another app possibly uses it.';
  }
  const message = error instanceof Error ? error.message : String(error);
  return `The camera did not start: ${message}`;
}

const fill = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  background: '#000',
} as const;
