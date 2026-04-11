// Conversion pair catalog. Each entry is one landing page route.
//
// URL convention is **locked** by apps/converter/CLAUDE.md Directive 1:
// verb-first, flat slug — `/convert-{from}-to-{to}`. The first word of the
// slug is always the verb users actually type into Google. Never nest under
// `/convert/...`.
//
// To add a pair: append an entry, add the route in App.tsx, and rebuild.
// The sitemap generator (see todo.md) will pick entries up from here.

import { BRAND } from '@/lib/brand';

export interface ConversionPair {
  slug: string; // e.g. "convert-mp4-to-gif" — must start with verb
  from: string; // input extension, lowercase, as users search it ("mp4" not "m4v")
  to: string; // output format passed to the backend
  fromLabel: string; // display form, e.g. "MP4"
  toLabel: string;
  // A single-sentence explanation rendered on the landing page. Keep it
  // factual — it feeds both human readers and the HowTo schema.
  blurb: string;
}

export const PAIRS: ConversionPair[] = [
  {
    slug: 'convert-mp4-to-gif',
    from: 'mp4',
    to: 'gif',
    fromLabel: 'MP4',
    toLabel: 'GIF',
    blurb:
      'Turn short MP4 clips into animated GIFs for messaging, Slack, Reddit, or embedding in docs. No watermark, no upload limit.',
  },
  {
    slug: 'convert-mp4-to-webm',
    from: 'mp4',
    to: 'webm',
    fromLabel: 'MP4',
    toLabel: 'WebM',
    blurb:
      'Re-encode MP4 videos as WebM (VP9) for smaller file sizes and native HTML5 playback without H.264 licensing overhead.',
  },
  {
    slug: 'convert-wav-to-mp3',
    from: 'wav',
    to: 'mp3',
    fromLabel: 'WAV',
    toLabel: 'MP3',
    blurb:
      'Compress uncompressed WAV audio to MP3 for portable players, podcast uploads, or smaller attachments. Quality defaults to ~192 kbps.',
  },
  {
    slug: 'convert-png-to-webp',
    from: 'png',
    to: 'webp',
    fromLabel: 'PNG',
    toLabel: 'WebP',
    blurb:
      'Shrink PNG assets to WebP for faster page loads. Typical savings run 25–40% at visually identical quality.',
  },
  {
    slug: 'convert-mov-to-mp4',
    from: 'mov',
    to: 'mp4',
    fromLabel: 'MOV',
    toLabel: 'MP4',
    blurb:
      'Convert QuickTime MOV files from iPhones and Macs into MP4 so they play everywhere — Android, Windows, web embeds, and editors.',
  },
];

export function pairCanonical(pair: ConversionPair): string {
  return `${BRAND.origin}/${pair.slug}`;
}
