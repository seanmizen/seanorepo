// Hardcoded flagship presets for the homepage pill row.
//
// Source: apps/ffmpeg-converter/docs/STRATEGY.md §"Flagship 8–12 headline
// conversions". Twelve presets, two rows of six on desktop.
//
// This file is intentionally hardcoded — Phase 1 does not depend on the typed
// operations matrix (SEAN-38). When the matrix lands, a follow-up ticket will
// derive these pills from the matrix instead of duplicating the data here.

export type FlagshipPreset = {
  /** Short label used on the pill button. */
  label: string;
  /** Tool-page slug (relative to /, no leading slash). */
  href: string;
  /** Op identifier from the Go backend's ops registry. */
  op: string;
};

export const FLAGSHIP_PRESETS: FlagshipPreset[] = [
  { label: 'MP4 → WebM', href: '/convert/mp4-to-webm', op: 'transcode_webm' },
  { label: 'MOV → MP4', href: '/convert/mov-to-mp4', op: 'transcode' },
  { label: 'MP4 → GIF', href: '/gif/mp4-to-gif', op: 'gif_from_video' },
  { label: 'Video → MP3', href: '/extract-audio/mp4-to-mp3', op: 'audio_mp3' },
  {
    label: 'Shrink for Discord',
    href: '/compress/mp4-under-10mb',
    op: 'change_bitrate',
  },
  { label: 'Grab a thumbnail', href: '/thumbnail/mp4', op: 'thumbnail' },
  { label: 'Trim a clip', href: '/trim/mp4', op: 'trim' },
  { label: 'Resize', href: '/resize/mp4', op: 'resize' },
  { label: 'Image → WebP', href: '/convert/jpg-to-webp', op: 'image_to_webp' },
  { label: 'HEIC/PNG → JPG', href: '/convert/heic-to-jpg', op: 'image_to_jpg' },
  {
    label: 'Normalise audio',
    href: '/audio/normalize-mp3',
    op: 'normalize_audio',
  },
  { label: 'Contact sheet', href: '/contact-sheet/mp4', op: 'contact_sheet' },
];
