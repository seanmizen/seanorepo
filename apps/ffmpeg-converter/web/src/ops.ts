// Frontend-side mirror of the backend op registry. Kept in sync by hand —
// backend truth is `apps/ffmpeg-converter/ops.go`. The presets here add UI metadata
// (labels, defaults, advanced fields) on top of the raw op name.

export type OpCategory = 'video' | 'audio' | 'image' | 'special';

export interface Preset {
  // Backend op name, MUST match a key in ops.go RegisterOps().
  op: string;
  // What shows up on the big button.
  label: string;
  // One-line tag under the label.
  tag: string;
  // Longer description shown in the panel.
  description: string;
  // Category, drives layout + icon.
  category: OpCategory;
  // Output file extension — matches backend DefaultExt.
  outputExt: string;
  // Min files to upload (mirrors backend MinInputs).
  minInputs: number;
  // Preset "chips" — named bundles of args that map to human intents.
  presets: PresetChip[];
  // Advanced fields exposed when the "Advanced" panel is open.
  advanced: AdvField[];
}

export interface PresetChip {
  id: string;
  label: string;
  args: Record<string, string>;
}

export interface AdvField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select';
  placeholder?: string;
  options?: { value: string; label: string }[];
  default?: string;
}

// The 5 most universally useful conversions shown on the homepage.
// Everything else lives in the full catalog at /catalog.
export const popularOpNames = [
  'gif_from_video', // MP4 → GIF
  'transcode', // MOV → MP4
  'transcode_webm', // MP4 → WebM
  'image_to_webp', // PNG/JPG → WebP
  'audio_mp3', // Video → MP3
];

// ─────────────── SEO conversion routes ───────────────
// Each entry maps a URL slug like /convert-mov-to-mp4 to a preset + metadata.
// Used by the SPA router to render dedicated landing pages for each conversion.

export interface ConversionRoute {
  /** URL slug, e.g. "convert-mov-to-mp4" (no leading slash) */
  slug: string;
  /** Page title for SEO */
  title: string;
  /** Meta description for SEO */
  description: string;
  /** The backend op name */
  op: string;
  /** Input file extension (e.g. ".mov") — used for drop zone accept + copy */
  inputExt: string;
  /** Human label for the input format */
  inputLabel: string;
  /** Human label for the output format */
  outputLabel: string;
}

export const conversionRoutes: ConversionRoute[] = [
  // Video format conversions
  {
    slug: 'convert-mov-to-mp4',
    title: 'Convert MOV to MP4 online — free, instant, no signup',
    description:
      'Convert MOV video files to MP4 format instantly in your browser. No signup, no watermarks, no file size tricks.',
    op: 'transcode',
    inputExt: '.mov',
    inputLabel: 'MOV',
    outputLabel: 'MP4',
  },
  {
    slug: 'convert-mp4-to-webm',
    title: 'Convert MP4 to WebM online — free, instant, no signup',
    description:
      'Convert MP4 videos to WebM (VP9 + Opus) for smaller web-ready files. Free, no signup required.',
    op: 'transcode_webm',
    inputExt: '.mp4',
    inputLabel: 'MP4',
    outputLabel: 'WebM',
  },
  {
    slug: 'convert-mp4-to-mkv',
    title: 'Convert MP4 to MKV online — free, instant, no signup',
    description:
      'Convert MP4 videos to MKV container format. Free, no login, instant results.',
    op: 'transcode_mkv',
    inputExt: '.mp4',
    inputLabel: 'MP4',
    outputLabel: 'MKV',
  },
  {
    slug: 'convert-webm-to-mp4',
    title: 'Convert WebM to MP4 online — free, instant, no signup',
    description:
      'Convert WebM videos to universally compatible MP4 format. No signup, no watermarks.',
    op: 'transcode',
    inputExt: '.webm',
    inputLabel: 'WebM',
    outputLabel: 'MP4',
  },
  {
    slug: 'convert-mkv-to-mp4',
    title: 'Convert MKV to MP4 online — free, instant, no signup',
    description:
      'Convert MKV videos to MP4 for universal playback. Free, instant, no signup.',
    op: 'transcode',
    inputExt: '.mkv',
    inputLabel: 'MKV',
    outputLabel: 'MP4',
  },
  {
    slug: 'convert-avi-to-mp4',
    title: 'Convert AVI to MP4 online — free, instant, no signup',
    description:
      'Convert AVI video files to modern MP4 format. Free, no login needed.',
    op: 'transcode',
    inputExt: '.avi',
    inputLabel: 'AVI',
    outputLabel: 'MP4',
  },
  {
    slug: 'convert-mp4-to-gif',
    title: 'Convert MP4 to GIF online — free, instant, no signup',
    description:
      'Turn any MP4 video into an animated GIF with optimised colours. Free, no signup.',
    op: 'gif_from_video',
    inputExt: '.mp4',
    inputLabel: 'MP4',
    outputLabel: 'GIF',
  },
  {
    slug: 'convert-mov-to-gif',
    title: 'Convert MOV to GIF online — free, instant, no signup',
    description:
      'Turn iPhone MOV videos into animated GIFs. Free, no signup, instant conversion.',
    op: 'gif_from_video',
    inputExt: '.mov',
    inputLabel: 'MOV',
    outputLabel: 'GIF',
  },
  {
    slug: 'convert-h264-to-h265',
    title: 'Convert H.264 to H.265 (HEVC) online — free, instant',
    description:
      'Re-encode H.264 video to H.265/HEVC for smaller file sizes. Free, no signup.',
    op: 'h264_to_h265',
    inputExt: '.mp4',
    inputLabel: 'H.264',
    outputLabel: 'H.265',
  },

  // Audio conversions
  {
    slug: 'convert-mp4-to-mp3',
    title: 'Convert MP4 to MP3 online — free, instant, no signup',
    description:
      'Extract audio from MP4 video as MP3. Choose your bitrate. Free, no signup.',
    op: 'audio_mp3',
    inputExt: '.mp4',
    inputLabel: 'MP4',
    outputLabel: 'MP3',
  },
  {
    slug: 'convert-mov-to-mp3',
    title: 'Convert MOV to MP3 online — free, instant, no signup',
    description:
      'Extract audio from MOV video as MP3. Free, instant, no signup.',
    op: 'audio_mp3',
    inputExt: '.mov',
    inputLabel: 'MOV',
    outputLabel: 'MP3',
  },
  {
    slug: 'convert-wav-to-mp3',
    title: 'Convert WAV to MP3 online — free, instant, no signup',
    description:
      'Convert WAV audio to MP3. Choose your bitrate. Free, no signup required.',
    op: 'audio_mp3',
    inputExt: '.wav',
    inputLabel: 'WAV',
    outputLabel: 'MP3',
  },
  {
    slug: 'convert-flac-to-mp3',
    title: 'Convert FLAC to MP3 online — free, instant, no signup',
    description:
      'Convert lossless FLAC audio to MP3. Free, no signup, instant results.',
    op: 'audio_mp3',
    inputExt: '.flac',
    inputLabel: 'FLAC',
    outputLabel: 'MP3',
  },
  {
    slug: 'convert-mp3-to-opus',
    title: 'Convert MP3 to Opus online — free, instant, no signup',
    description:
      'Convert MP3 audio to Opus for smaller files with better quality. Free, no signup.',
    op: 'audio_opus',
    inputExt: '.mp3',
    inputLabel: 'MP3',
    outputLabel: 'Opus',
  },
  {
    slug: 'convert-mp3-to-aac',
    title: 'Convert MP3 to AAC online — free, instant, no signup',
    description: 'Convert MP3 audio to AAC. Free, no signup, instant results.',
    op: 'audio_aac',
    inputExt: '.mp3',
    inputLabel: 'MP3',
    outputLabel: 'AAC',
  },
  {
    slug: 'convert-wav-to-flac',
    title: 'Convert WAV to FLAC online — free, instant, no signup',
    description:
      'Convert WAV audio to lossless FLAC. Smaller files, same quality. Free, no signup.',
    op: 'audio_flac',
    inputExt: '.wav',
    inputLabel: 'WAV',
    outputLabel: 'FLAC',
  },

  // Image conversions
  {
    slug: 'convert-png-to-webp',
    title: 'Convert PNG to WebP online — free, instant, no signup',
    description:
      'Convert PNG images to WebP for smaller web-ready files. Free, instant, no signup.',
    op: 'image_to_webp',
    inputExt: '.png',
    inputLabel: 'PNG',
    outputLabel: 'WebP',
  },
  {
    slug: 'convert-jpg-to-webp',
    title: 'Convert JPG to WebP online — free, instant, no signup',
    description:
      'Convert JPG/JPEG images to WebP format. Smaller files, same quality. Free, no signup.',
    op: 'image_to_webp',
    inputExt: '.jpg',
    inputLabel: 'JPG',
    outputLabel: 'WebP',
  },
  {
    slug: 'convert-heic-to-jpg',
    title: 'Convert HEIC to JPG online — free, instant, no signup',
    description:
      'Convert iPhone HEIC photos to universally compatible JPG. Free, no signup.',
    op: 'image_to_jpg',
    inputExt: '.heic',
    inputLabel: 'HEIC',
    outputLabel: 'JPG',
  },
  {
    slug: 'convert-png-to-jpg',
    title: 'Convert PNG to JPG online — free, instant, no signup',
    description: 'Convert PNG images to JPG. Free, instant, no signup.',
    op: 'image_to_jpg',
    inputExt: '.png',
    inputLabel: 'PNG',
    outputLabel: 'JPG',
  },
  {
    slug: 'convert-webp-to-jpg',
    title: 'Convert WebP to JPG online — free, instant, no signup',
    description:
      'Convert WebP images to widely compatible JPG format. Free, no signup.',
    op: 'image_to_jpg',
    inputExt: '.webp',
    inputLabel: 'WebP',
    outputLabel: 'JPG',
  },
  {
    slug: 'convert-webp-to-png',
    title: 'Convert WebP to PNG online — free, instant, no signup',
    description:
      'Convert WebP images to PNG for lossless quality. Free, no signup.',
    op: 'image_to_png',
    inputExt: '.webp',
    inputLabel: 'WebP',
    outputLabel: 'PNG',
  },
  {
    slug: 'convert-png-to-avif',
    title: 'Convert PNG to AVIF online — free, instant, no signup',
    description:
      'Convert PNG images to next-gen AVIF format. Smaller files, better quality. Free, no signup.',
    op: 'image_to_avif',
    inputExt: '.png',
    inputLabel: 'PNG',
    outputLabel: 'AVIF',
  },
  {
    slug: 'convert-jpg-to-avif',
    title: 'Convert JPG to AVIF online — free, instant, no signup',
    description:
      'Convert JPG images to AVIF for next-gen compression. Free, no signup.',
    op: 'image_to_avif',
    inputExt: '.jpg',
    inputLabel: 'JPG',
    outputLabel: 'AVIF',
  },
];

/** Find a conversion route by slug (e.g. "convert-mov-to-mp4"). */
export function findConversionRoute(slug: string): ConversionRoute | undefined {
  return conversionRoutes.find((r) => r.slug === slug);
}

// Flagship 12, ordered by how they'd appear on the landing page.
// See STRATEGY.md "Flagship 8–12 headline conversions" for rationale.
export const flagshipPresets: Preset[] = [
  {
    op: 'transcode_webm',
    label: 'MP4 → WebM',
    tag: '.mp4 → .webm',
    description:
      'Re-encode video to WebM (VP9 + Opus). Smaller files, perfect for the web.',
    category: 'video',
    outputExt: '.webm',
    minInputs: 1,
    presets: [
      { id: 'web', label: 'Web (balanced)', args: {} },
      { id: 'discord', label: 'For Discord (10 MB)', args: { ext: 'webm' } },
      { id: 'max', label: 'Max quality', args: {} },
    ],
    advanced: [
      {
        key: 'ext',
        label: 'Container',
        kind: 'select',
        options: [
          { value: 'webm', label: '.webm' },
          { value: 'mp4', label: '.mp4' },
          { value: 'mkv', label: '.mkv' },
        ],
        default: 'webm',
      },
    ],
  },
  {
    op: 'transcode',
    label: 'MOV → MP4',
    tag: '.mov → .mp4',
    description:
      'iPhone to everywhere. Re-encodes to H.264 + AAC in an MP4 container.',
    category: 'video',
    outputExt: '.mp4',
    minInputs: 1,
    presets: [
      { id: 'balanced', label: 'Balanced', args: {} },
      { id: 'fast', label: 'Fast encode', args: {} },
    ],
    advanced: [
      {
        key: 'ext',
        label: 'Container',
        kind: 'select',
        options: [
          { value: 'mp4', label: '.mp4' },
          { value: 'mkv', label: '.mkv' },
        ],
        default: 'mp4',
      },
    ],
  },
  {
    op: 'gif_from_video',
    label: 'MP4 → GIF',
    tag: 'video → .gif',
    description:
      'Turn any video into an animated GIF. Optimised palette for sharp colours.',
    category: 'image',
    outputExt: '.gif',
    minInputs: 1,
    presets: [
      { id: 'clip', label: 'Short clip', args: {} },
      { id: 'preview', label: 'YouTube-style preview', args: {} },
    ],
    advanced: [],
  },
  {
    op: 'audio_mp3',
    label: 'Video → MP3',
    tag: '* → .mp3',
    description: 'Extract audio from any video as MP3. Choose your bitrate.',
    category: 'audio',
    outputExt: '.mp3',
    minInputs: 1,
    presets: [
      { id: 'low', label: 'Podcast (64 k)', args: { bitrate: '64k' } },
      { id: 'mid', label: 'Music (128 k)', args: { bitrate: '128k' } },
      { id: 'high', label: 'High (192 k)', args: { bitrate: '192k' } },
    ],
    advanced: [
      { key: 'bitrate', label: 'Bitrate', kind: 'text', default: '64k' },
    ],
  },
  {
    op: 'change_bitrate',
    label: 'Shrink for Discord',
    tag: 'target 10 MB',
    description:
      'Re-encode video to fit upload limits on Discord, Bluesky, or email.',
    category: 'video',
    outputExt: '.mp4',
    minInputs: 1,
    presets: [
      { id: 'discord', label: 'Discord (≤10 MB)', args: { bitrate: '750k' } },
      { id: 'bsky', label: 'Bluesky (≤50 MB)', args: { bitrate: '2000k' } },
      { id: 'email', label: 'Email (≤5 MB)', args: { bitrate: '350k' } },
    ],
    advanced: [
      { key: 'bitrate', label: 'Bitrate', kind: 'text', default: '750k' },
    ],
  },
  {
    op: 'thumbnail',
    label: 'Grab a thumbnail',
    tag: '1 frame → .jpg',
    description: 'Pull a single frame from any video as a JPG.',
    category: 'image',
    outputExt: '.jpg',
    minInputs: 1,
    presets: [
      {
        id: 'early',
        label: 'Near the start',
        args: { timestamp: '00:00:00.3' },
      },
      { id: 'mid', label: 'Middle-ish', args: { timestamp: '00:00:01' } },
    ],
    advanced: [
      {
        key: 'timestamp',
        label: 'Timestamp',
        kind: 'text',
        default: '00:00:00.3',
        placeholder: '00:00:00.3',
      },
    ],
  },
  {
    op: 'trim',
    label: 'Trim a clip',
    tag: 'cut start/duration',
    description: 'Cut a section from a video by start time and duration.',
    category: 'video',
    outputExt: '.mp4',
    minInputs: 1,
    presets: [
      { id: 'first5', label: 'First 5 s', args: { start: '0', duration: '5' } },
      {
        id: 'first30',
        label: 'First 30 s',
        args: { start: '0', duration: '30' },
      },
    ],
    advanced: [
      { key: 'start', label: 'Start (s)', kind: 'text', default: '0' },
      { key: 'duration', label: 'Duration (s)', kind: 'text', default: '5' },
    ],
  },
  {
    op: 'resize',
    label: 'Resize',
    tag: 'w × h',
    description:
      'Scale a video to any resolution. Aspect ratio preserved automatically.',
    category: 'video',
    outputExt: '.mp4',
    minInputs: 1,
    presets: [
      { id: '720', label: '720p', args: { width: '1280', height: '720' } },
      { id: '480', label: '480p', args: { width: '854', height: '480' } },
      {
        id: 'square',
        label: 'Square 512',
        args: { width: '512', height: '512' },
      },
    ],
    advanced: [
      { key: 'width', label: 'Width', kind: 'number', default: '1280' },
      { key: 'height', label: 'Height', kind: 'number', default: '720' },
    ],
  },
  {
    op: 'image_to_webp',
    label: 'Image → WebP',
    tag: '.png/.jpg → .webp',
    description:
      'Convert any image to WebP. Smaller than PNG, wider support than AVIF.',
    category: 'image',
    outputExt: '.webp',
    minInputs: 1,
    presets: [{ id: 'web', label: 'Web (q=60)', args: {} }],
    advanced: [],
  },
  {
    op: 'image_to_jpg',
    label: 'HEIC/PNG → JPG',
    tag: '* → .jpg',
    description: 'Convert any image to JPEG. Works everywhere, no surprises.',
    category: 'image',
    outputExt: '.jpg',
    minInputs: 1,
    presets: [{ id: 'default', label: 'Standard quality', args: {} }],
    advanced: [],
  },
  {
    op: 'normalize_audio',
    label: 'Normalise audio',
    tag: 'EBU R128',
    description:
      'Loudness-normalise to broadcast standards. Podcast-ready out of the box.',
    category: 'audio',
    outputExt: '.wav',
    minInputs: 1,
    presets: [
      { id: 'pod', label: 'Podcast (-16 LUFS)', args: {} },
      { id: 'music', label: 'Music (-14 LUFS)', args: {} },
    ],
    advanced: [],
  },
  {
    op: 'contact_sheet',
    label: 'Contact sheet',
    tag: 'N × M grid',
    description:
      'Grid of frames sampled across a video. Great for previews and blog posts.',
    category: 'image',
    outputExt: '.jpg',
    minInputs: 1,
    presets: [
      { id: '3x3', label: '3 × 3', args: { cols: '3', rows: '3' } },
      { id: '4x4', label: '4 × 4', args: { cols: '4', rows: '4' } },
      { id: '6x3', label: '6 × 3', args: { cols: '6', rows: '3' } },
    ],
    advanced: [
      { key: 'cols', label: 'Cols', kind: 'number', default: '3' },
      { key: 'rows', label: 'Rows', kind: 'number', default: '3' },
    ],
  },
];

// Full backend op catalogue — used in the "All 50 operations" disclosure.
// This is the static list of op names; the runtime fetches /api/ops for live metadata.
export const allOpsByCategory: Record<OpCategory, string[]> = {
  video: [
    'transcode',
    'transcode_webm',
    'transcode_mkv',
    'resize',
    'h264_to_h265',
    'change_framerate',
    'change_bitrate',
    'trim',
    'concat',
    'watermark',
    'thumbnail',
    'contact_sheet',
    'speed',
    'reverse',
    'crop',
    'rotate',
    'flip',
    'loop',
    'subtitles_burn',
    'subtitles_soft',
    'pad_aspect',
    'timelapse',
  ],
  audio: [
    'audio_mp3',
    'audio_opus',
    'audio_aac',
    'audio_flac',
    'extract_audio',
    'normalize_audio',
    'audio_trim',
    'audio_fade',
    'audio_concat',
    'stereo_to_mono',
    'audio_bitrate',
    'time_stretch',
    'pitch_shift',
    'spectrogram',
    'waveform_png',
  ],
  image: [
    'image_resize',
    'image_to_jpg',
    'image_to_png',
    'image_to_webp',
    'image_to_avif',
    'gif_from_video',
    'gif_from_images',
    'blur',
    'sharpen',
    'grayscale',
  ],
  special: ['youtube_preview', 'meme_overlay', 'silence_trim'],
};

// ─────────────── catalog ───────────────
// Organises all 51 ops into human-friendly categories for the full catalog.

export interface CatalogCategory {
  id: string;
  title: string;
  description: string;
  ops: string[];
}

export const catalogCategories: CatalogCategory[] = [
  {
    id: 'image-formats',
    title: 'Image Formats',
    description: 'Convert between image types — JPG, PNG, WebP, AVIF.',
    ops: ['image_to_jpg', 'image_to_png', 'image_to_webp', 'image_to_avif'],
  },
  {
    id: 'image-effects',
    title: 'Image Effects',
    description: 'Resize, blur, sharpen, or desaturate images.',
    ops: ['image_resize', 'blur', 'sharpen', 'grayscale'],
  },
  {
    id: 'video-to-images',
    title: 'Video to Images',
    description: 'Extract frames, thumbnails, or animated GIFs from video.',
    ops: ['thumbnail', 'contact_sheet', 'gif_from_video'],
  },
  {
    id: 'images-to-video',
    title: 'Images to Video',
    description: 'Combine an image sequence into a timelapse video.',
    ops: ['timelapse'],
  },
  {
    id: 'images-to-gif',
    title: 'Images to GIF',
    description: 'Stitch images into an animated GIF.',
    ops: ['gif_from_images'],
  },
  {
    id: 'video-conversion',
    title: 'Video Conversion',
    description: 'Re-container or transcode between video formats.',
    ops: ['transcode', 'transcode_webm', 'transcode_mkv', 'h264_to_h265'],
  },
  {
    id: 'video-editing',
    title: 'Video Editing',
    description: 'Trim, crop, resize, rotate, loop, and more.',
    ops: [
      'trim',
      'resize',
      'crop',
      'rotate',
      'flip',
      'speed',
      'reverse',
      'loop',
      'concat',
      'change_framerate',
      'change_bitrate',
      'pad_aspect',
    ],
  },
  {
    id: 'video-overlays',
    title: 'Video Overlays',
    description: 'Burn subtitles, watermarks, or meme text onto video.',
    ops: ['watermark', 'subtitles_burn', 'subtitles_soft', 'meme_overlay'],
  },
  {
    id: 'audio-conversion',
    title: 'Audio Conversion',
    description: 'Convert or extract audio to MP3, Opus, AAC, FLAC, or WAV.',
    ops: [
      'audio_mp3',
      'audio_opus',
      'audio_aac',
      'audio_flac',
      'extract_audio',
    ],
  },
  {
    id: 'audio-editing',
    title: 'Audio Editing',
    description: 'Trim, fade, concat, normalise, pitch-shift, and more.',
    ops: [
      'normalize_audio',
      'audio_trim',
      'audio_fade',
      'audio_concat',
      'stereo_to_mono',
      'audio_bitrate',
      'time_stretch',
      'pitch_shift',
      'silence_trim',
    ],
  },
  {
    id: 'audio-visualisation',
    title: 'Audio Visualisation',
    description: 'Render audio as a spectrogram or waveform image.',
    ops: ['spectrogram', 'waveform_png'],
  },
  {
    id: 'special',
    title: 'Special',
    description: 'YouTube-style previews and other one-off tools.',
    ops: ['youtube_preview'],
  },
];

// Auto-suggest which presets to highlight based on the dropped file's extension.
export function suggestPresetsForFile(filename: string): string[] {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const videoExts = [
    'mp4',
    'mov',
    'mkv',
    'webm',
    'avi',
    'wmv',
    'm4v',
    'mpg',
    'mpeg',
    'flv',
  ];
  const audioExts = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'wma'];
  const imageExts = [
    'png',
    'jpg',
    'jpeg',
    'heic',
    'heif',
    'webp',
    'gif',
    'bmp',
    'tiff',
  ];

  if (videoExts.includes(ext)) {
    return [
      'transcode_webm',
      'transcode',
      'gif_from_video',
      'audio_mp3',
      'change_bitrate',
      'trim',
      'thumbnail',
    ];
  }
  if (audioExts.includes(ext)) {
    return ['audio_mp3', 'normalize_audio'];
  }
  if (imageExts.includes(ext)) {
    return ['image_to_webp', 'image_to_jpg'];
  }
  return flagshipPresets.map((p) => p.op);
}

export function findPreset(op: string): Preset | undefined {
  return flagshipPresets.find((p) => p.op === op);
}
