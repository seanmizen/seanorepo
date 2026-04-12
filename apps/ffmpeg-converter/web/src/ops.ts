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
