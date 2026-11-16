// The playback on a phone (iOS and Android). It shows the frame photos one
// after the other at the playback frame rate. "Save" puts the frames in the
// photo library. Expo Go has no video encoder, so the phone saves photos and
// not a video file. The web build uses Playback.web.tsx.

import { Image } from 'expo-image';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import type { Frame, PlaybackProps } from '../types';

export function Playback({ frames, fps, onAction }: PlaybackProps) {
  const [index, setIndex] = useState(0);
  const saving = useRef(false);

  useEffect(() => {
    setIndex(0);
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % frames.length),
      1000 / fps,
    );
    return () => clearInterval(timer);
  }, [frames, fps]);

  useEffect(() => {
    const run = async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        await save(frames, (note) =>
          onAction({ label: 'Save', run: null, note }),
        );
        onAction({
          label: 'Save',
          run,
          note: `Saved ${frames.length} photos.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onAction({ label: 'Save', run, note: message });
      } finally {
        saving.current = false;
      }
    };
    onAction({ label: 'Save', run, note: `${frames.length} photos.` });
  }, [frames]);

  const frame = frames[Math.min(index, frames.length - 1)];
  return (
    <Image
      source={{ uri: frame.uri }}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      transition={null}
      cachePolicy="memory"
    />
  );
}

async function save(frames: Frame[], progress: (note: string) => void) {
  // Write-only access is enough to add photos, so the app does not ask to
  // read the photo library.
  const permission = await requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) {
    throw new Error('The photo permission is off. Turn it on in Settings.');
  }
  for (let i = 0; i < frames.length; i++) {
    progress(`Saving ${i + 1} of ${frames.length}.`);
    await Asset.create(frames[i].uri);
  }
}
