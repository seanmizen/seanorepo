// SEAN-56 — `/gif` hub page.
//
// Lists every `gif` row in the matrix. Catches queries like "video to gif" or
// "make gif from mp4" that don't match a specific input-format slug.

import type { Metadata } from 'next';
import { HubPage } from '@/components/HubPage';

export const metadata: Metadata = {
  title: 'Video to GIF — make a GIF from any video, free',
  description:
    'Turn any video clip into an animated GIF. Palette-quantised for clean colours, capped at sensible frame rates so file sizes stay reasonable. Free, no watermark.',
};

const INTRO =
  'Turn a short video clip into an animated GIF. The converter generates ' +
  'a per-clip palette (palettegen + paletteuse) so colours stay clean ' +
  'instead of dithering badly, caps the frame rate at sensible defaults, ' +
  'and emits the ffmpeg command so you can re-run it with your own ' +
  'settings. Best for clips under ten seconds — longer than that and you ' +
  'probably want WebP or MP4 instead.';

export default function GifHub() {
  return (
    <HubPage
      operation="gif"
      h1="Video to GIF"
      lede="Turn any short clip into a clean, palette-quantised animated GIF."
      intro={INTRO}
    />
  );
}
