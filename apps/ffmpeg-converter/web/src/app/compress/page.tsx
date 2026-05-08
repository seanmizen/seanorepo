// SEAN-56 — `/compress` hub page.
//
// Lists every `compress` row in the matrix. Catches fuzzy-intent traffic for
// queries like "compress mp4" or "compress video for discord" that don't
// match a specific format/size slug.

import type { Metadata } from 'next';
import { HubPage } from '@/components/HubPage';

export const metadata: Metadata = {
  title: 'Compress video — shrink files for Discord, email, web',
  description:
    'Compress MP4, MOV, MKV, and more in your browser. Pick a target format or size limit (under 8MB, under 25MB, under 100MB) and shrink the file without a watermark.',
};

const INTRO =
  'Shrink video files to clear an upload limit or save bandwidth. Each ' +
  'tool below targets a specific format or output size — pick the one ' +
  'that matches your destination (Discord at 25MB, Slack at 100MB, ' +
  'email at 8MB) and the converter handles the bitrate maths. The exact ' +
  'ffmpeg command is shown on every page so you can re-run it locally.';

export default function CompressHub() {
  return (
    <HubPage
      operation="compress"
      h1="Compress video"
      lede="Hit a size limit without losing more quality than you have to."
      intro={INTRO}
    />
  );
}
