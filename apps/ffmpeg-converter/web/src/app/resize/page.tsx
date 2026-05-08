// SEAN-56 — `/resize` hub page.
//
// Lists every `resize` row in the matrix. Catches queries like
// "resize mp4 to 720p" or "scale video down" that don't match a specific
// format slug.

import type { Metadata } from 'next';
import { HubPage } from '@/components/HubPage';

export const metadata: Metadata = {
  title: 'Resize video — scale to 480p, 720p, 1080p, 1440p',
  description:
    'Scale video files to a target resolution while preserving aspect ratio. Pick a tool below for your input format and choose 480p, 720p, 1080p, or 1440p output.',
};

const INTRO =
  'Scale a video to a target resolution without stretching or cropping. ' +
  'Aspect ratio is preserved — width or height is computed from the ' +
  "other to match the source's shape. Pick the format below that " +
  'matches your input file; each tool offers presets for the common ' +
  'output sizes (480p through 1440p) and shows the ffmpeg scale filter ' +
  'it used.';

export default function ResizeHub() {
  return (
    <HubPage
      operation="resize"
      h1="Resize video"
      lede="Scale clips to 480p, 720p, 1080p, or 1440p — aspect ratio preserved."
      intro={INTRO}
    />
  );
}
