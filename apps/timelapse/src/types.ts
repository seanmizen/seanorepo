// The contract between the screen and the two platform files of each part.
// camera/Camera.tsx and camera/Camera.web.tsx have the same exports.
// playback/Playback.tsx and playback/Playback.web.tsx have the same exports.
// Metro selects the .web file for the web build.

import type { Ref } from 'react';

/**
 * One captured frame. On a phone, `uri` is a JPEG file in the cache folder.
 * On the web, it is an object URL of a JPEG blob.
 */
export type Frame = { uri: string; width: number; height: number };

export type CameraDevice = { id: string; label: string };

export type CameraHandle = {
  /** Takes one frame. Rejects when the camera has no picture. */
  capture(): Promise<Frame>;
};

export type CameraProps = {
  /** The camera to open. An empty string opens the default camera. */
  deviceId: string;
  /** Gives the list of cameras, and the ID of the camera that is open. */
  onDevices(devices: CameraDevice[], activeId: string): void;
  /** True when the preview shows and `capture` can take a frame. */
  onReady(ready: boolean): void;
  ref?: Ref<CameraHandle>;
};

/** The button at the right of the bottom bar when a timelapse is ready. */
export type OutputAction = {
  label: string;
  /** Null while the output is not ready, or when this device cannot save it. */
  run: (() => void) | null;
  /** A short status line, for example the file size or the save progress. */
  note: string;
};

export type PlaybackProps = {
  frames: Frame[];
  fps: number;
  onAction(action: OutputAction): void;
};
