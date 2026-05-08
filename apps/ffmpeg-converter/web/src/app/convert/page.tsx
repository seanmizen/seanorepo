// SEAN-56 — `/convert` hub page.
//
// Lists every `convert` AND `image-convert` row in the matrix as a card grid
// sorted by intent volume. Hub pages catch fuzzy-intent searches ("convert
// video", "convert mov") that don't match a specific slug.
//
// Note: `apps/converter/CLAUDE.md` Directive 1 specifies a "redirect /convert
// → /" policy — that directive applies to the OTHER converter project
// (`apps/converter/`), not this one (`apps/ffmpeg-converter/`). Here `/convert`
// is the hub page, not a redirect. See SEAN-56 for the rationale.

import type { Metadata } from 'next';
import { HubPage } from '@/components/HubPage';

export const metadata: Metadata = {
  title: 'Convert files online — free, no watermark, no signup',
  description:
    'Browse every video, audio, and image conversion supported by Sean’s Converter. Pick a format pair and convert in your browser, no upload, no email gate.',
};

const INTRO =
  'Pick the format pair you need and convert directly in your browser. ' +
  'Every conversion below runs locally — files never touch a third-party ' +
  "server, there's no watermark, no signup, and no email gate. Each tool " +
  "page shows the exact ffmpeg command we'd run, so you can copy it for " +
  'your own scripts.';

export default function ConvertHub() {
  return (
    <HubPage
      operation="convert"
      alsoInclude={['image-convert']}
      h1="Convert files"
      lede="Every video, audio, and image conversion in one place."
      intro={INTRO}
    />
  );
}
