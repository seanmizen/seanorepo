// Every conversion page on the site. One entry = one URL (/{slug}) = one
// Google search we want to answer. Keep the list to conversions that people
// search for and that the Go engine does well.
//
// `op` and `args` go to the Go service as-is. The args set real-world
// quality. The Go defaults are small and fast for the test suite.

export type Kind = 'video' | 'audio' | 'image';

export type Group = 'Video' | 'Audio' | 'Image' | 'Compress and edit';

export interface Faq {
  q: string;
  a: string;
}

export interface Tool {
  slug: string;
  /** Page heading and link text, e.g. "MOV to MP4". */
  name: string;
  /** One sentence under the heading. Plain English, no codec names. */
  lede: string;
  group: Group;
  /** Kind of input. The file picker also accepts any file of this kind. */
  kind: Kind;
  /** Input extensions that the page names, without the dot. */
  accepts: string[];
  /** Output extension, without the dot. */
  outputExt: string;
  /** Added to the download name when the extension does not change. */
  suffix?: string;
  op: string;
  args: Record<string, string>;
  /** Extra controls. The user sets them after choosing a file. */
  controls?: 'clip' | 'resolution';
  /** Question and answer pairs for this page only. */
  faqs: Faq[];
  related: string[];
  /** Shown in the "Popular" row on the home page. */
  popular?: boolean;
}

export const MAX_UPLOAD_MB = 2048;

const up = (ext: string) => ext.toUpperCase();

// ─── Video → MP4 ────────────────────────────────────────────────────────────

const MP4_ARGS = { crf: '23', preset: 'veryfast', audio_bitrate: '160k' };

const PLAYS_EVERYWHERE: Faq = {
  q: 'Will the MP4 play on my phone, Windows or a website?',
  a: 'Yes. The MP4 uses H.264 video and AAC audio. Almost every phone, computer, browser and upload form plays that.',
};

const toMp4 = (
  from: string,
  lede: string,
  opts: { accepts?: string[]; popular?: boolean; faq?: Faq } = {},
): Tool => ({
  slug: `${from}-to-mp4`,
  name: `${up(from)} to MP4`,
  lede,
  group: 'Video',
  kind: 'video',
  accepts: opts.accepts ?? [from],
  outputExt: 'mp4',
  op: 'transcode',
  args: MP4_ARGS,
  faqs: opts.faq ? [PLAYS_EVERYWHERE, opts.faq] : [PLAYS_EVERYWHERE],
  related: [`${from}-to-mp3`, 'compress-video', 'mp4-to-gif'],
  popular: opts.popular,
});

const VIDEO_TO_MP4: Tool[] = [
  toMp4(
    'mov',
    'Turn an iPhone or Mac video (MOV) into an MP4 that plays everywhere.',
    {
      popular: true,
      faq: {
        q: 'My MOV is from an iPhone. Will it work?',
        a: 'Yes. iPhones record MOV files with HEVC video, which some computers and websites cannot play. We convert the video to H.264 in an MP4.',
      },
    },
  ),
  toMp4('mkv', 'Turn an MKV video into an MP4 that plays everywhere.', {
    popular: true,
    faq: {
      q: 'What happens to subtitles in the MKV?',
      a: 'The MP4 has the main video and audio only. Subtitle tracks and extra audio tracks are not copied.',
    },
  }),
  toMp4('webm', 'Turn a WebM video into an MP4 that plays everywhere.'),
  toMp4('avi', 'Turn an old AVI video into an MP4 that plays everywhere.'),
  toMp4('wmv', 'Turn a Windows Media video (WMV) into an MP4.'),
  toMp4('flv', 'Turn a Flash video (FLV) into an MP4.'),
  toMp4('m4v', 'Turn an M4V video into a standard MP4.', {
    faq: {
      q: 'Can you convert iTunes movies?',
      a: 'No. Films bought from iTunes have copy protection, and we cannot read them. Your own M4V videos work.',
    },
  }),
  toMp4('3gp', 'Turn an old phone video (3GP) into an MP4.'),
  toMp4('mpeg', 'Turn an MPEG or MPG video into an MP4.', {
    accepts: ['mpeg', 'mpg'],
  }),
  toMp4('mts', 'Turn a camcorder video (MTS or M2TS) into an MP4.', {
    accepts: ['mts', 'm2ts'],
  }),
  toMp4('vob', 'Turn a DVD video file (VOB) into an MP4.', {
    faq: {
      q: 'Can you convert a whole DVD?',
      a: 'We convert one VOB file at a time. Copy-protected DVDs do not work.',
    },
  }),
  toMp4('ts', 'Turn a TS video stream into an MP4.'),
];

// ─── MP4 → other video ─────────────────────────────────────────────────────

const FROM_MP4: Tool[] = [
  {
    slug: 'mp4-to-mov',
    name: 'MP4 to MOV',
    lede: 'Turn an MP4 into a MOV for QuickTime, iMovie or Final Cut.',
    group: 'Video',
    kind: 'video',
    accepts: ['mp4'],
    outputExt: 'mov',
    op: 'transcode',
    args: MP4_ARGS,
    faqs: [
      {
        q: 'Will the MOV open in iMovie and Final Cut?',
        a: 'Yes. The MOV uses H.264 video and AAC audio, which Apple apps open.',
      },
    ],
    related: ['mov-to-mp4', 'compress-video', 'mp4-to-gif'],
  },
  {
    slug: 'mp4-to-webm',
    name: 'MP4 to WebM',
    lede: 'Turn an MP4 into a WebM for use on a website.',
    group: 'Video',
    kind: 'video',
    accepts: ['mp4'],
    outputExt: 'webm',
    op: 'transcode_webm',
    args: { crf: '33', audio_bitrate: '128k' },
    faqs: [
      {
        q: 'Do I need WebM?',
        a: 'Usually not. Every modern browser plays MP4. Some websites and tools ask for WebM, and this page is for them.',
      },
    ],
    related: ['webm-to-mp4', 'compress-video', 'mp4-to-gif'],
  },
];

// ─── Video → GIF ───────────────────────────────────────────────────────────

const GIF_FAQ: Faq = {
  q: 'How long can the GIF be?',
  a: 'Up to 30 seconds, but keep it short. GIF files get large fast. We make GIFs 480 pixels wide at 12 frames per second.',
};

const toGif = (from: string, name: string, accepts: string[]): Tool => ({
  slug: `${from}-to-gif`,
  name,
  lede: 'Pick a few seconds of a video and turn them into an animated GIF.',
  group: 'Video',
  kind: 'video',
  accepts,
  outputExt: 'gif',
  op: 'gif_from_video',
  args: { width: '480', fps: '12' },
  controls: 'clip',
  faqs: [GIF_FAQ],
  related: ['trim-video', 'compress-video', 'mp4-to-mp3'],
  popular: from === 'mp4',
});

const TO_GIF: Tool[] = [
  toGif('mp4', 'MP4 to GIF', ['mp4']),
  toGif('mov', 'MOV to GIF', ['mov']),
  toGif('webm', 'WebM to GIF', ['webm']),
  toGif('video', 'Video to GIF', []),
];

// ─── Audio ─────────────────────────────────────────────────────────────────

const MP3_QUALITY: Faq = {
  q: 'What quality is the MP3?',
  a: '192 kbps. That is good quality for music and for speech.',
};

const toMp3 = (
  from: string,
  kind: 'video' | 'audio',
  lede: string,
  opts: { accepts?: string[]; popular?: boolean; name?: string } = {},
): Tool => ({
  slug: `${from}-to-mp3`,
  name: opts.name ?? `${up(from)} to MP3`,
  lede,
  group: 'Audio',
  kind,
  accepts: opts.accepts ?? [from],
  outputExt: 'mp3',
  op: 'audio_mp3',
  args: { audio_bitrate: '192k' },
  faqs: [MP3_QUALITY],
  related:
    kind === 'video'
      ? ['video-to-mp3', 'mp4-to-wav', 'mp4-to-gif']
      : ['wav-to-mp3', 'm4a-to-mp3', 'mp3-to-wav'],
  popular: opts.popular,
});

const toWav = (from: string, kind: 'video' | 'audio', lede: string): Tool => ({
  slug: `${from}-to-wav`,
  name: `${up(from)} to WAV`,
  lede,
  group: 'Audio',
  kind,
  accepts: [from],
  outputExt: 'wav',
  op: 'extract_audio',
  args: {},
  faqs: [
    {
      q: 'Why is the WAV so large?',
      a: 'WAV is not compressed. It keeps the full sound, which is good for editing. For a small file, use MP3.',
    },
  ],
  related: ['mp3-to-wav', 'm4a-to-wav', 'mp4-to-wav', 'wav-to-mp3'].filter(
    (s) => s !== `${from}-to-wav`,
  ),
});

const AUDIO: Tool[] = [
  toMp3('mp4', 'video', 'Save the sound from an MP4 video as an MP3.', {
    popular: true,
  }),
  toMp3('mov', 'video', 'Save the sound from a MOV or iPhone video as an MP3.'),
  toMp3('webm', 'video', 'Save the sound from a WebM video as an MP3.'),
  toMp3('mkv', 'video', 'Save the sound from an MKV video as an MP3.'),
  toMp3('video', 'video', 'Save the sound from any video as an MP3.', {
    accepts: [],
    name: 'Video to MP3',
  }),
  toMp3('wav', 'audio', 'Make a WAV file smaller as an MP3.', {
    popular: true,
  }),
  toMp3(
    'm4a',
    'audio',
    'Turn an M4A (iPhone voice memo or iTunes) into an MP3.',
    {
      popular: true,
    },
  ),
  toMp3('flac', 'audio', 'Turn a FLAC file into an MP3 that plays everywhere.'),
  toMp3('ogg', 'audio', 'Turn an OGG file into an MP3 that plays everywhere.'),
  toMp3('aac', 'audio', 'Turn an AAC file into an MP3.'),
  toMp3(
    'opus',
    'audio',
    'Turn an Opus file (for example a WhatsApp voice note) into an MP3.',
  ),
  toMp3('wma', 'audio', 'Turn a Windows Media audio file (WMA) into an MP3.'),
  toWav('mp3', 'audio', 'Turn an MP3 into a WAV for editing or burning to CD.'),
  toWav('m4a', 'audio', 'Turn an M4A into a WAV for editing.'),
  toWav('mp4', 'video', 'Save the sound from an MP4 video as a WAV.'),
];

// ─── Image ─────────────────────────────────────────────────────────────────

const imageTool = (
  from: string,
  to: 'jpg' | 'png' | 'webp',
  lede: string,
  extra: Partial<Tool> = {},
): Tool => {
  const op =
    to === 'jpg'
      ? 'image_to_jpg'
      : to === 'png'
        ? 'image_to_png'
        : 'image_to_webp';
  const faqs: Faq[] = [];
  if (to === 'jpg' && (from === 'png' || from === 'webp')) {
    faqs.push({
      q: 'What happens to a transparent background?',
      a: 'JPG cannot store transparency, so transparent areas get a solid color. Convert to PNG if you need to keep transparency.',
    });
  }
  if (to === 'webp') {
    faqs.push({
      q: 'Why WebP?',
      a: 'A WebP image is usually smaller than the same JPG or PNG, so web pages load faster. Every modern browser shows WebP.',
    });
  }
  if (from === 'heic') {
    faqs.push({
      q: 'What is a HEIC file?',
      a: 'iPhones save photos as HEIC. Many Windows computers, websites and apps cannot open HEIC. A JPG or PNG opens everywhere.',
    });
  }
  if (from === 'webp' || from === 'avif') {
    faqs.push({
      q: `Why can I not open ${up(from)} files?`,
      a: `Some older apps do not open ${up(from)}. A ${up(to)} opens everywhere.`,
    });
  }
  return {
    slug: `${from}-to-${to}`,
    name: `${up(from)} to ${up(to)}`,
    lede,
    group: 'Image',
    kind: 'image',
    accepts:
      from === 'jpg'
        ? ['jpg', 'jpeg']
        : from === 'heic'
          ? ['heic', 'heif']
          : [from],
    outputExt: to,
    op,
    args: to === 'jpg' ? { quality: '2' } : {},
    faqs,
    related: [],
    ...extra,
  };
};

const IMAGE: Tool[] = [
  imageTool(
    'heic',
    'jpg',
    'Turn an iPhone photo (HEIC) into a JPG that opens everywhere.',
    {
      popular: true,
    },
  ),
  imageTool('heic', 'png', 'Turn an iPhone photo (HEIC) into a PNG.'),
  imageTool(
    'webp',
    'jpg',
    'Turn a WebP image from a website into a normal JPG.',
    { popular: true },
  ),
  imageTool('png', 'jpg', 'Turn a PNG image into a smaller JPG.', {
    popular: true,
  }),
  imageTool(
    'avif',
    'jpg',
    'Turn an AVIF image into a JPG that opens everywhere.',
  ),
  imageTool('jpg', 'png', 'Turn a JPG image into a PNG.'),
  imageTool(
    'webp',
    'png',
    'Turn a WebP image into a PNG and keep transparency.',
  ),
  imageTool('jpg', 'webp', 'Turn a JPG into a smaller WebP for your website.'),
  imageTool('png', 'webp', 'Turn a PNG into a smaller WebP for your website.'),
].map((t, _, all) => ({
  ...t,
  related: all
    .filter((o) => o.slug !== t.slug)
    .slice(0, 3)
    .map((o) => o.slug),
}));

// ─── Compress and edit ─────────────────────────────────────────────────────

const toSize = (mb: number, lede: string, popular = false): Tool => ({
  slug: `compress-video-to-${mb}mb`,
  name: `Compress video to ${mb} MB`,
  lede,
  group: 'Compress and edit',
  kind: 'video',
  accepts: [],
  outputExt: 'mp4',
  suffix: `-${mb}mb`,
  op: 'change_bitrate',
  args: { target_size_mb: String(mb) },
  faqs: [
    {
      q: `Will the video be under ${mb} MB?`,
      a: `Yes. If the video is too long to fit in ${mb} MB, we show an error. We do not give you a file that is too large.`,
    },
    {
      q: 'Will the quality drop?',
      a: 'A long video needs more compression, so it loses more detail. For a long video, trim it first.',
    },
  ],
  related: ['compress-video', 'trim-video', 'resize-video'],
  popular,
});

const EDIT: Tool[] = [
  {
    slug: 'compress-video',
    name: 'Compress video',
    lede: 'Make a video file smaller, with the same size on screen.',
    group: 'Compress and edit',
    kind: 'video',
    accepts: [],
    outputExt: 'mp4',
    suffix: '-compressed',
    op: 'transcode',
    args: { crf: '28', preset: 'veryfast', audio_bitrate: '96k' },
    faqs: [
      {
        q: 'How much smaller will it be?',
        a: 'That depends on the video. A video from a phone or a camera often gets much smaller. A video that is already compressed can stay the same size.',
      },
      {
        q: 'I need it under a size limit',
        a: 'Use Compress video to 8 MB, 10 MB or 25 MB. Those pages make sure the file fits.',
      },
    ],
    related: [
      'compress-video-to-10mb',
      'compress-video-to-25mb',
      'resize-video',
    ],
    popular: true,
  },
  toSize(8, 'Make a video small enough for an 8 MB upload limit.'),
  toSize(
    10,
    'Make a video small enough for Discord (10 MB without Nitro).',
    true,
  ),
  toSize(
    25,
    'Make a video small enough for a 25 MB limit, such as an email attachment.',
  ),
  {
    slug: 'trim-video',
    name: 'Trim video',
    lede: 'Cut a video to the part that you want to keep.',
    group: 'Compress and edit',
    kind: 'video',
    accepts: [],
    outputExt: 'mp4',
    suffix: '-trimmed',
    op: 'trim',
    args: { crf: '20', preset: 'veryfast', audio_bitrate: '160k' },
    controls: 'clip',
    faqs: [
      {
        q: 'What format do I get?',
        a: 'An MP4, which plays everywhere.',
      },
    ],
    related: ['compress-video', 'mp4-to-gif', 'resize-video'],
    popular: true,
  },
  {
    slug: 'resize-video',
    name: 'Resize video',
    lede: 'Make a video 1080p, 720p or 480p.',
    group: 'Compress and edit',
    kind: 'video',
    accepts: [],
    outputExt: 'mp4',
    op: 'resize',
    args: { crf: '23', preset: 'veryfast' },
    controls: 'resolution',
    faqs: [
      {
        q: 'Does it work for portrait videos?',
        a: 'Yes. 720p makes a landscape video 1280 × 720 and a portrait video 720 × 1280.',
      },
    ],
    related: ['compress-video', 'trim-video', 'mov-to-mp4'],
  },
];

const ALL: Tool[] = [
  ...VIDEO_TO_MP4,
  ...FROM_MP4,
  ...TO_GIF,
  ...AUDIO,
  ...IMAGE,
  ...EDIT,
];

const SLUGS = new Set(ALL.map((t) => t.slug));

// A related link to a page that does not exist is dropped, not broken.
export const TOOLS: Tool[] = ALL.map((t) => ({
  ...t,
  related: t.related.filter((s) => SLUGS.has(s) && s !== t.slug).slice(0, 3),
}));

export const TOOLS_BY_SLUG: Record<string, Tool> = Object.fromEntries(
  TOOLS.map((t) => [t.slug, t]),
);

export const GROUPS: Group[] = ['Video', 'Audio', 'Image', 'Compress and edit'];

// ─── Files ─────────────────────────────────────────────────────────────────

const KIND_EXTS: Record<Kind, string[]> = {
  video: [
    'mp4',
    'mov',
    'mkv',
    'webm',
    'avi',
    'wmv',
    'flv',
    'm4v',
    '3gp',
    'mpeg',
    'mpg',
    'mts',
    'm2ts',
    'vob',
    'ts',
    'ogv',
  ],
  audio: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'opus', 'wma'],
  image: [
    'jpg',
    'jpeg',
    'png',
    'webp',
    'avif',
    'heic',
    'heif',
    'gif',
    'bmp',
    'tif',
    'tiff',
  ],
};

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function kindOfFile(file: { name: string; type: string }): Kind | null {
  const ext = extOf(file.name);
  for (const kind of ['video', 'audio', 'image'] as Kind[]) {
    if (KIND_EXTS[kind].includes(ext)) return kind;
  }
  const top = file.type.split('/')[0];
  return top === 'video' || top === 'audio' || top === 'image' ? top : null;
}

/** Value for <input accept>. Mobile pickers use the MIME type. */
export function acceptFor(tool: Tool): string {
  const exts = tool.accepts.length > 0 ? tool.accepts : KIND_EXTS[tool.kind];
  return [`${tool.kind}/*`, ...exts.map((e) => `.${e}`)].join(',');
}

/** Tools that take this file, best match first. For the home page. */
export function toolsForFile(file: { name: string; type: string }): Tool[] {
  const kind = kindOfFile(file);
  if (!kind) return [];
  const ext = extOf(file.name);
  const named = TOOLS.filter((t) => t.accepts.includes(ext));
  const general = TOOLS.filter(
    (t) => t.kind === kind && t.accepts.length === 0,
  );
  // MOV to MOV is no conversion. Compress, trim and resize keep the format.
  const picked = [...named, ...general].filter(
    (t) => t.outputExt !== ext || t.group === 'Compress and edit',
  );
  // A named tool and its general twin do the same job. Keep the named one.
  const seen = new Set<string>();
  return picked.filter((t) => {
    const key = `${t.op}:${t.outputExt}:${JSON.stringify(t.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function downloadName(
  inputName: string,
  tool: Tool,
  extra = '',
): string {
  const dot = inputName.lastIndexOf('.');
  const base = dot > 0 ? inputName.slice(0, dot) : inputName || 'converted';
  return `${base}${tool.suffix ?? ''}${extra}.${tool.outputExt}`;
}
