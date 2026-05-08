// SEAN-80 — `/thumbnail` hub page.
//
// Lists every `thumbnail` row in the matrix. Catches queries like
// "video thumbnail" or "grab a frame from mp4" that don't match a specific
// slug, and ensures `seansconverter.com/thumbnail` resolves instead of 404ing.

import type { Metadata } from 'next';
import { HubPage } from '@/components/HubPage';

export const metadata: Metadata = {
  title: 'Grab a video thumbnail — JPG, PNG, WebP, free',
  description:
    'Pull a single frame out of any video file at the timestamp you choose. JPG by default, PNG and WebP available. Runs in your browser, no watermark, no signup.',
};

const INTRO =
  'Grab a single frame from a video and save it as a still image. Pick the ' +
  'timestamp, pick the output format (JPG for size, PNG for transparency, ' +
  'WebP for both), and the converter pulls exactly one frame at that moment ' +
  'without re-encoding the rest of the file. Useful for blog post hero ' +
  'images, social-share previews, or scrubbing a long clip for the right ' +
  'cover frame.';

export default function ThumbnailHub() {
  return (
    <HubPage
      operation="thumbnail"
      h1="Video thumbnail"
      lede="Pull a single frame out of any video at the timestamp you pick."
      intro={INTRO}
    />
  );
}
