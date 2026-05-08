// SEAN-80 — `/normalize-audio` hub page.
//
// Lists the `normalize-audio` row in the matrix. Catches queries like
// "normalise audio" or "loudness normalisation" that don't match a specific
// slug, and ensures `seansconverter.com/normalize-audio` resolves instead
// of 404ing.

import type { Metadata } from 'next';
import { HubPage } from '@/components/HubPage';

export const metadata: Metadata = {
  title: 'Normalise audio loudness — EBU R128, free',
  description:
    'Level the perceived loudness of any audio file using EBU R128 loudness normalisation. Podcast (-16 LUFS), broadcast (-23 LUFS), or streaming (-14 LUFS) targets. Runs in your browser, no watermark.',
};

const INTRO =
  'Loudness normalisation matches the perceived volume of a track to a ' +
  'target loudness, not just its peak amplitude. Drop in any audio file and ' +
  'the converter applies the EBU R128 loudnorm filter at a podcast, ' +
  'broadcast, or streaming preset, so the output sits at the right level for ' +
  'its destination without clipping. Better than peak normalisation when ' +
  "you're stitching together episodes, lining up music tracks, or matching " +
  'voiceover to background.';

export default function NormalizeAudioHub() {
  return (
    <HubPage
      operation="normalize-audio"
      h1="Normalise audio"
      lede="EBU R128 loudness normalisation — podcast, broadcast, or streaming targets."
      intro={INTRO}
    />
  );
}
