// The phone camera (iOS and Android), with expo-camera. Each frame is a
// JPEG photo in the cache folder. The web build uses Camera.web.tsx.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Linking, StyleSheet } from 'react-native';
import type { CameraDevice, CameraProps, Frame } from '../types';
import { Notice } from '../ui';

const DEVICES: CameraDevice[] = [
  { id: 'back', label: 'Back' },
  { id: 'front', label: 'Front' },
];

export function Camera({ deviceId, onDevices, onReady, ref }: CameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const view = useRef<CameraView>(null);
  const asked = useRef(false);
  const [started, setStarted] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const facing = deviceId === 'front' ? 'front' : 'back';

  useEffect(() => {
    onDevices(DEVICES, facing);
  }, [facing]);

  // Ask one time when the screen opens. After that, only the button asks,
  // so a refusal does not cause a loop of prompts.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      if (!asked.current) {
        asked.current = true;
        requestPermission();
      }
    }
  }, [permission]);

  const ready = !!permission?.granted && started && !mountError;
  useEffect(() => {
    onReady(ready);
  }, [ready]);

  useImperativeHandle(
    ref,
    () => ({
      async capture(): Promise<Frame> {
        const photo = await view.current?.takePictureAsync({
          quality: 0.5,
          shutterSound: false,
        });
        if (!photo) throw new Error('The camera gave no photo.');
        return { uri: photo.uri, width: photo.width, height: photo.height };
      },
    }),
    [],
  );

  if (!permission) return <Notice text="Checking the camera permission." />;
  if (!permission.granted) {
    return permission.canAskAgain ? (
      <Notice
        text="Timelapse needs the camera. You refused the camera permission."
        action={{ label: 'Allow the camera', run: requestPermission }}
      />
    ) : (
      <Notice
        text="The camera permission is off. Turn it on in Settings."
        action={{ label: 'Open Settings', run: () => Linking.openSettings() }}
      />
    );
  }
  if (mountError) {
    return <Notice text={`No camera is available. ${mountError}`} />;
  }
  return (
    <CameraView
      ref={view}
      style={StyleSheet.absoluteFill}
      facing={facing}
      animateShutter={false}
      onCameraReady={() => setStarted(true)}
      onMountError={(e) => setMountError(e.message)}
    />
  );
}

/** Deletes the frame files from the cache folder. */
export function releaseFrames(frames: Frame[]) {
  for (const frame of frames) {
    try {
      new File(frame.uri).delete();
    } catch {
      // The file is gone already. The cache folder is the system's to clear.
    }
  }
}
