// SEAN-56 — `/extract-audio` hub page.
//
// Lists every `extract-audio` row in the matrix. Catches queries like
// "rip audio from mp4" or "video to mp3" that don't match a specific slug.

import type { Metadata } from 'next';
import { HubPage } from '@/components/HubPage';

export const metadata: Metadata = {
  title: 'Extract audio from video — MP3, WAV, FLAC, Opus',
  description:
    'Pull the audio track out of any video file and save it as MP3, WAV, FLAC, AAC, OGG, M4A, or Opus. Free, no watermark, no signup, runs in your browser.',
};

const INTRO =
  'Pull the audio out of a video and save it as a standalone file. The ' +
  "right output format depends on what you'll do with it next — MP3 for " +
  'anything universal, FLAC or WAV for editing, Opus for the smallest ' +
  'size at the same perceived quality. Each tool below picks sensible ' +
  'encoder defaults and shows the ffmpeg command it ran.';

export default function ExtractAudioHub() {
  return (
    <HubPage
      operation="extract-audio"
      h1="Extract audio from video"
      lede="Pull the soundtrack out of any video — MP3, WAV, FLAC, Opus, and more."
      intro={INTRO}
    />
  );
}
