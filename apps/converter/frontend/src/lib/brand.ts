// Single source of truth for brand strings. If the product is ever renamed,
// this is the only file that needs to change (plus docs/branding.md).
//
// Do NOT hardcode "Sean's Converter" or "seansconverter.com" anywhere else —
// import from here.

export const BRAND = {
  name: "Sean's Converter",
  shortName: 'Converter',
  domain: 'seansconverter.com',
  origin: 'https://seansconverter.com',
  tagline: 'Convert video, audio, and image files instantly. Free, no signup.',
  description:
    'Free file converter for video, audio, and images. Powered by ffmpeg. No signup, no limits, no file storage beyond 1 hour.',
} as const;
