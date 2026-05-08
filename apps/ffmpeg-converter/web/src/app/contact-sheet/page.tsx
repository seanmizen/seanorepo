// SEAN-80 — `/contact-sheet` hub page.
//
// Lists every `contact-sheet` row in the matrix. Catches queries like
// "video contact sheet" or "grid of frames from mp4" that don't match a
// specific slug, and ensures `seansconverter.com/contact-sheet` resolves
// instead of 404ing.

import type { Metadata } from 'next';
import { HubPage } from '@/components/HubPage';

export const metadata: Metadata = {
  title: 'Video contact sheet — NxM grid of frames, free',
  description:
    'Generate a contact sheet from any video — a grid of evenly-sampled frames in a single image. Useful for previewing long clips, picking a cover frame, or scrubbing for moments without scrubbing.',
};

const INTRO =
  'A contact sheet is a single image that tiles a grid of frames sampled ' +
  'evenly across a video. Drop a clip in, pick the grid size (3x3 by ' +
  'default), and the converter samples frames at regular intervals, scales ' +
  'each one down, and stitches them into one JPG. Useful for previewing a ' +
  'long recording at a glance, picking a thumbnail without scrubbing, or ' +
  'sharing a quick visual summary.';

export default function ContactSheetHub() {
  return (
    <HubPage
      operation="contact-sheet"
      h1="Video contact sheet"
      lede="A grid of evenly-sampled frames stitched into one image."
      intro={INTRO}
    />
  );
}
