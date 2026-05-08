// SEAN-56 — `/trim` hub page.
//
// Lists every `trim` row in the matrix. Catches queries like "trim mp4" or
// "cut video clip" that don't match a specific format slug.

import type { Metadata } from 'next';
import { HubPage } from '@/components/HubPage';

export const metadata: Metadata = {
  title: 'Trim video — cut clips without re-encoding when possible',
  description:
    'Trim the start or end off any video file. Stream-copies the original codec where possible (no quality loss) and falls back to a fast re-encode when the cut lands mid-keyframe.',
};

const INTRO =
  'Cut a clip out of a longer recording without re-encoding the whole ' +
  'file. Where the trim point lands on a keyframe, the original audio ' +
  'and video streams are copied byte-for-byte, so quality stays ' +
  'identical and the export is near-instant. When the cut falls between ' +
  'keyframes, the converter does a quick re-encode of just the affected ' +
  'segment and stream-copies the rest.';

export default function TrimHub() {
  return (
    <HubPage
      operation="trim"
      h1="Trim video"
      lede="Cut clips out without re-encoding the whole file."
      intro={INTRO}
    />
  );
}
