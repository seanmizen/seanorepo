/**
 * Operations matrix — single source of truth for pSEO page generation.
 *
 * Schema is defined in `./types.ts` and mirrors §6 of the original vision spec
 * (folded into `phased-spec.md`; dated source doc lives only in git history at
 * commit 058ab8c).
 *
 * Phase 1 (this ticket): curated subset covering at minimum the four ops named
 * in `phased-spec.md` Phase 1 — `convert`, `compress`, `extract-audio`, `gif` —
 * plus the 12 flagship presets from `apps/ffmpeg-converter/docs/STRATEGY.md`.
 *
 * Phase 2 generates the full ≥200 pages from this same data; do not rename
 * fields without updating the page template and route generator together.
 */

import type {
  Format,
  GoOpName,
  Operation,
  OperationRow,
  ResolvedPage,
  ValidationError,
} from './types';
import { KIND_OF } from './types';

// ─────────────────────────────────────────────────────── VALIDATION ──────────

/**
 * Reject nonsensical (input, output) combos at generation time.
 *
 * The rules are intentionally narrow — we'd rather skip a borderline page than
 * produce a useless one. The Go backend will refuse the conversion anyway, but
 * shipping a `/convert/mp3-to-mov` URL would be embarrassing for SEO.
 *
 * Rules:
 *   1. Audio source can never produce a video output (no source video stream).
 *   2. Static-image source can never produce video/audio (single frame).
 *   3. `convert` op requires same-kind I/O (video↔video, audio↔audio, etc.).
 *   4. `extract-audio` op requires video input + audio output.
 *   5. `gif` op requires video input + animated-image output.
 *   6. Identity conversions for *changing-format* ops are skipped (e.g.
 *     `convert mp4 → mp4` is meaningless). For *transforming* ops where the
 *     output format legitimately equals the input (compress, trim, resize,
 *     normalize-audio, etc. — the format stays put while bytes change),
 *     identity is allowed.
 */
const FORMAT_CHANGING_OPS: Operation[] = [
  'convert',
  'extract-audio',
  'gif',
  'image-convert',
];

export function isValidCombo(
  operation: Operation,
  input: Format,
  output: Format,
): true | string {
  if (input === output && FORMAT_CHANGING_OPS.includes(operation)) {
    return 'identity conversion (input format equals output format)';
  }

  const inKind = KIND_OF[input];
  const outKind = KIND_OF[output];

  // Rule 1: audio in → never video/animated-image out.
  if (
    inKind === 'audio' &&
    (outKind === 'video' || outKind === 'animated-image')
  ) {
    return `cannot produce ${outKind} (${output}) from audio source (${input})`;
  }

  // Rule 2: static image in → never video/audio out.
  if (inKind === 'image' && (outKind === 'video' || outKind === 'audio')) {
    return `cannot produce ${outKind} (${output}) from single image (${input})`;
  }

  // Rule 3: `convert` op requires same media kind on both ends.
  if (operation === 'convert' && inKind !== outKind) {
    return `convert op requires same media kind on both sides (got ${inKind} → ${outKind})`;
  }

  // Rule 4: `extract-audio` requires video → audio.
  if (operation === 'extract-audio') {
    if (inKind !== 'video') {
      return `extract-audio requires video input (got ${inKind})`;
    }
    if (outKind !== 'audio') {
      return `extract-audio requires audio output (got ${outKind})`;
    }
  }

  // Rule 5: `gif` op requires video → animated-image.
  if (operation === 'gif') {
    if (inKind !== 'video') {
      return `gif op requires video input (got ${inKind})`;
    }
    if (outKind !== 'animated-image') {
      return `gif op requires animated-image output (got ${outKind})`;
    }
  }

  // Rule 6: `compress` op stays within the same kind (compress mp4 → mp4).
  if (operation === 'compress' && inKind !== outKind) {
    return `compress op preserves format kind (got ${inKind} → ${outKind})`;
  }

  return true;
}

/**
 * Walks a single matrix row and returns one `ResolvedPage` per valid
 * (input, output) pair. Invalid combos are silently dropped — call
 * `validateMatrix` separately if you want a list of rejections.
 */
export function resolveRow(row: OperationRow): ResolvedPage[] {
  const pages: ResolvedPage[] = [];
  for (const input of row.inputFormats) {
    if (isValidCombo(row.operation, input, row.outputFormat) !== true) {
      continue;
    }
    pages.push({
      slug: row.slug,
      inputFormat: input,
      outputFormat: row.outputFormat,
      row,
    });
  }
  return pages;
}

/**
 * Validate the entire matrix and return any rejected combos. Empty array means
 * every row produced at least one valid page.
 *
 * Used by the Phase 2 page generator to fail the build on a regression (e.g.
 * someone added a row that produces no valid pages at all).
 */
export function validateMatrix(
  rows: OperationRow[] = MATRIX,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const row of rows) {
    let validCount = 0;
    for (const input of row.inputFormats) {
      const result = isValidCombo(row.operation, input, row.outputFormat);
      if (result === true) {
        validCount++;
      } else {
        errors.push({
          slug: `${input}-to-${row.outputFormat}`,
          reason: result,
        });
      }
    }
    if (validCount === 0) {
      errors.push({
        slug: row.slug,
        reason: `row produces zero valid pages — every input format failed validation`,
      });
    }
  }
  return errors;
}

// ─────────────────────────────────────────────────────── HELPERS ─────────────

/**
 * The full set of 15 video formats Phase 2 covers. Used to build the
 * cross-product convert/extract-audio/gif rows.
 *
 * Order matters only for stable iteration in tests; matrix consumers do not
 * rely on any particular ordering.
 */
const VIDEO_FORMATS_ALL: Format[] = [
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'flv',
  'wmv',
  'm4v',
  'mpeg',
  '3gp',
  'ts',
  'mts',
  'm2ts',
  'ogv',
  'vob',
];

/**
 * The 6 audio targets covered by extract-audio per phased-spec §Phase 2.
 */
const AUDIO_OUTPUTS_EXTRACT: Format[] = [
  'mp3',
  'wav',
  'aac',
  'flac',
  'ogg',
  'opus',
];

/**
 * Standard FAQ block applied to every `convert` row. Per-row FAQs override
 * by appending; the page template renders both.
 */
function convertFaqs(from: string, to: string): OperationRow['faqs'] {
  return [
    {
      q: `Is ${from.toUpperCase()} to ${to.toUpperCase()} conversion free?`,
      a: `Yes. No watermark, no signup, no email gate. Files up to 100 MB on the free tier.`,
    },
    {
      q: `How long does it take?`,
      a: `Most ${from.toUpperCase()} → ${to.toUpperCase()} conversions complete in under 10 seconds for short clips. Longer files scale with duration and resolution.`,
    },
    {
      q: `Are my files private?`,
      a: `Server-side conversions auto-delete one hour after the job finishes. We do not view, share, or train on your files.`,
    },
    {
      q: `What ffmpeg command do you run?`,
      a: `The exact command is shown on the result page with a copy button — so you can run it yourself if you prefer.`,
    },
  ];
}

/**
 * Standard FAQ block for `extract-audio` rows — one per audio output format.
 */
function extractAudioFaqs(audioOut: Format): OperationRow['faqs'] {
  const upper = audioOut.toUpperCase();
  return [
    {
      q: `Does this rip from YouTube?`,
      a: `No — upload your own files. We do not download from third-party sites.`,
    },
    {
      q: `What bitrate is the ${upper}?`,
      a: `Sensible defaults — typically 192 kbps for MP3/AAC/Opus, lossless for WAV/FLAC. Use the advanced panel to override.`,
    },
    {
      q: `Is the conversion free?`,
      a: `Yes. No watermark, no signup, no email.`,
    },
    {
      q: `What ffmpeg command do you run?`,
      a: `Shown on the result page with a copy button.`,
    },
  ];
}

/**
 * Standard FAQ block for `compress` rows — one per video format.
 */
function compressFaqs(format: Format): OperationRow['faqs'] {
  const upper = format.toUpperCase();
  return [
    {
      q: `How much smaller will my ${upper} be?`,
      a: `Default settings target ~50% size reduction with minimal visible quality loss. Use the size-targeted presets for hard caps.`,
    },
    {
      q: `Will it lose quality?`,
      a: `Some — the default CRF 28 keeps perceptual quality high. Maximum quality preserves more detail at a larger size.`,
    },
    {
      q: `Is there a file size limit?`,
      a: `100 MB on the free tier, 10 GB on Pro.`,
    },
    {
      q: `What ffmpeg command do you run?`,
      a: `Shown on the result page with a copy button.`,
    },
  ];
}

/**
 * Standard FAQ block for `gif` rows — one per video input format.
 */
function gifFaqs(format: Format): OperationRow['faqs'] {
  const upper = format.toUpperCase();
  return [
    {
      q: `How big will the GIF be?`,
      a: `Larger than the source ${upper}, often 5-10x. GIF has no inter-frame compression. Use WebM for shorter file size.`,
    },
    {
      q: `Will it have audio?`,
      a: `No — GIF format has no audio track. Use WebM if you need it.`,
    },
    {
      q: `Can I trim the clip first?`,
      a: `Yes — use the trim tool, then convert the result.`,
    },
    {
      q: `What ffmpeg command do you run?`,
      a: `Shown on the result page with a copy button.`,
    },
  ];
}

/**
 * Build a `convert` row from one input video format to one output video format.
 * Used by the cross-product convert generator. The slug is canonical
 * `${from}-to-${to}`.
 */
function convertRow(from: Format, to: Format): OperationRow {
  const goOp: GoOpName =
    to === 'webm'
      ? 'transcode_webm'
      : to === 'mkv'
        ? 'transcode_mkv'
        : 'transcode';
  return {
    slug: `${from}-to-${to}`,
    operation: 'convert',
    inputFormats: [from],
    outputFormat: to,
    goOp,
    title: `Convert ${from.toUpperCase()} to ${to.toUpperCase()} — free, no watermark`,
    h1: `${from.toUpperCase()} to ${to.toUpperCase()}`,
    valueProp: 'Free, in your browser, no watermark.',
    ffmpegCommand: `ffmpeg -i input.${from} -c:v libx264 -preset ultrafast -crf 30 -c:a aac -b:a 64k output.${to}`,
    intentVolume: 'tail',
    faqs: convertFaqs(from, to),
    related: [`compress-${to}`, `${to}-to-${from}`, `video-to-${to}`].filter(
      (s): s is string => Boolean(s),
    ),
  };
}

/**
 * Build an `extract-audio` row pulling audio out of all 15 video formats.
 */
function extractAudioRow(audioOut: Format, goOp: GoOpName): OperationRow {
  const codecArgs =
    audioOut === 'mp3'
      ? '-c:a libmp3lame -b:a 192k'
      : audioOut === 'wav'
        ? '-acodec pcm_s16le'
        : audioOut === 'aac'
          ? '-c:a aac -b:a 192k'
          : audioOut === 'flac'
            ? '-c:a flac'
            : audioOut === 'ogg'
              ? '-c:a libvorbis -q:a 5'
              : '-c:a libopus -b:a 128k'; // opus
  const upper = audioOut.toUpperCase();
  return {
    slug: `video-to-${audioOut}`,
    operation: 'extract-audio',
    inputFormats: VIDEO_FORMATS_ALL,
    outputFormat: audioOut,
    goOp,
    title: `Extract ${upper} from video — free, no watermark`,
    h1: `Video to ${upper}`,
    valueProp: `Strip the audio. ${upper} out. No watermark.`,
    ffmpegCommand: `ffmpeg -i input.{ext} -vn ${codecArgs} output.${audioOut}`,
    intentVolume: audioOut === 'mp3' ? 'head' : 'tail',
    faqs: extractAudioFaqs(audioOut),
    related: ['video-to-mp3', 'video-to-wav', 'video-to-aac'].filter(
      (s) => s !== `video-to-${audioOut}`,
    ),
  };
}

/**
 * Build a `compress` row for one video format. Same kind on both ends.
 */
function compressRow(format: Format): OperationRow {
  return {
    slug: `compress-${format}`,
    operation: 'compress',
    inputFormats: [format],
    outputFormat: format,
    goOp: 'change_bitrate',
    title: `Compress ${format.toUpperCase()} — shrink video size, no watermark`,
    h1: `Compress ${format.toUpperCase()}`,
    valueProp: `Smaller file, same ${format.toUpperCase()}. No watermark, no signup.`,
    ffmpegCommand: `ffmpeg -i input.${format} -c:v libx264 -preset slow -crf 28 -c:a aac -b:a 64k output.${format}`,
    intentVolume: format === 'mp4' ? 'head' : 'tail',
    faqs: compressFaqs(format),
    related: [`video-to-${format}`, `${format}-to-mp4`, `compress-mp4`].filter(
      (s) => s !== `compress-${format}`,
    ),
  };
}

/**
 * Build a `gif` row for one video input format.
 */
function gifRow(from: Format): OperationRow {
  return {
    slug: `${from}-to-gif`,
    operation: 'gif',
    inputFormats: [from],
    outputFormat: 'gif',
    goOp: 'gif_from_video',
    title: `Convert ${from.toUpperCase()} to GIF — free, no watermark`,
    h1: `${from.toUpperCase()} to GIF`,
    valueProp: 'Animated GIF out. Palette-optimised. No watermark.',
    ffmpegCommand: `ffmpeg -i input.${from} -vf 'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse' output.gif`,
    intentVolume: 'tail',
    faqs: gifFaqs(from),
    related: ['mp4-to-gif', `compress-${from}`, `video-to-${from}`].filter(
      (s) => s !== `${from}-to-gif`,
    ),
    preset: { fps: 10 },
  };
}

// ─────────────────────────────────────────────────────── MATRIX ──────────────

/**
 * The curated portion of the matrix. Hand-tuned copy + flagship metadata for
 * the rows we want to control end-to-end. Phase 2 generators below append the
 * cross-product rows that bring `resolveAllPages(MATRIX)` over 200.
 *
 * Coverage of the curated subset:
 *   - `convert`: flagship video↔video pages (MP4↔WebM, MOV↔MP4, WebM→MP4) plus
 *     the bulk `video-to-mp4` row covering 12 long-tail input formats
 *   - `compress`: MP4 head term plus three size-targeted long-tail variants
 *     (`compress-mp4-under-25mb`/`-8mb`/`-100mb`)
 *   - `extract-audio`: video → mp3/wav/aac/flac across all 15 video formats
 *   - `gif`: MP4 → GIF flagship plus bulk `video-to-gif` covering 14 inputs
 *   - one-off flagship rows: `trim`, `resize`, `thumbnail`, `contact-sheet`,
 *     `normalize-audio`, `image-convert` (HEIC/PNG → JPG, Image → WebP)
 *
 * Phase 2 generators (`generatedConvertRows`, `generatedCompressRows`,
 * `generatedExtractAudioRows`, `generatedGifRows`) extend coverage to the
 * 15-video × 14-video convert grid, 15 compress rows, and the missing
 * extract-audio and gif outputs — pushing total resolved pages above 200.
 *
 * Flagship ranks (1-12) come from `docs/STRATEGY.md` "Flagship 8-12 headline
 * conversions" — see that doc for the why-each-one rationale.
 */
const CURATED_MATRIX: OperationRow[] = [
  // ─── Flagship #2: MOV → MP4 (Phase 1 hero page per phased-spec) ──────────
  {
    slug: 'mov-to-mp4',
    operation: 'convert',
    inputFormats: ['mov'],
    outputFormat: 'mp4',
    goOp: 'transcode',
    title: 'Convert MOV to MP4 — free, no watermark',
    h1: 'MOV to MP4',
    valueProp: 'Free, in your browser, no watermark.',
    ffmpegCommand:
      'ffmpeg -i input.mov -c:v libx264 -preset ultrafast -crf 30 -c:a aac -b:a 64k output.mp4',
    intentVolume: 'head',
    faqs: convertFaqs('mov', 'mp4'),
    related: ['mp4-to-mov', 'mov-to-webm', 'compress-mp4'],
    flagship: { rank: 2, label: 'MOV → MP4' },
    // SEAN-60: hand-tuned copy for flagship rank-2 page. Talks specifically
    // about iPhone HEVC-in-MOV vs widely-supported H.264-in-MP4 — the load-
    // bearing reason this conversion exists at all.
    whenToUse: `Reach for MOV to MP4 when you've got an iPhone or Final Cut export and the destination wants something more universal. Since iOS 11 every iPhone records into HEIC stills and HEVC-inside-MOV video by default, which Apple devices and modern Macs play fine — but Discord previews, Google Slides embeds, Outlook attachment thumbnails, older Windows builds, and a long tail of CMS uploaders still expect H.264 inside MP4. Converting unwraps the QuickTime container, re-encodes the HEVC stream to H.264 (or stream-copies it where the source already used H.264), and writes a fresh MP4 with the moov atom up front so playback starts instantly.`,
    extendedHowItWorks: `The encoder reads the QuickTime container, demuxes the video and audio streams, and re-encodes the video to H.264 with libx264 if the source uses HEVC (iPhone default). When the source MOV already wraps H.264 — common for Final Cut renders — we stream-copy the video to skip the re-encode and finish in a few seconds. Audio is re-encoded to AAC at 64 kbps regardless, since MOV happily holds AAC but the bitrate is sometimes higher than MP4 needs. The result is a fast-start MP4 with the moov atom at the front of the file, so progressive download and HTML5 video playback start instantly without waiting for the full file. Subtitles and chapter markers ride through where present.`,
    commonPitfalls: [
      {
        q: 'My MOV is from an iPhone — will it work?',
        a: 'Yes. iPhone MOVs use HEVC (H.265) by default since iOS 11, which we re-encode to H.264 so the result plays everywhere Discord, Outlook, and old Windows builds expect MP4 to play.',
      },
      {
        q: 'Will the audio sync drift?',
        a: 'No. We preserve the source timestamps, so audio sync rides through identically. Drift only shows up on broken sources where the MOV header already disagreed with the actual stream.',
      },
      {
        q: 'Is the MP4 fast-start (moov atom up front)?',
        a: 'Yes. We move the moov atom to the start of the file so HTML5 video and progressive download start playback instantly without waiting for the full file.',
      },
      {
        q: 'Will the file be smaller?',
        a: 'Slightly. HEVC is more efficient than H.264 at the same quality, so a re-encoded MP4 is typically 10-40% larger than the source MOV. Use compress afterwards if size matters more than universal compatibility.',
      },
    ],
  },

  // Reverse direction (matches the "reverse-link" convention in spec §7.2).
  {
    slug: 'mp4-to-mov',
    operation: 'convert',
    inputFormats: ['mp4'],
    outputFormat: 'mov',
    goOp: 'transcode',
    title: 'Convert MP4 to MOV — free, no watermark',
    h1: 'MP4 to MOV',
    valueProp: 'Free, in your browser, no watermark.',
    ffmpegCommand:
      'ffmpeg -i input.mp4 -c:v libx264 -preset ultrafast -crf 30 -c:a aac -b:a 64k output.mov',
    intentVolume: 'mid',
    faqs: convertFaqs('mp4', 'mov'),
    related: ['mov-to-mp4', 'mp4-to-webm', 'compress-mp4'],
  },

  // ─── Flagship #1: MP4 → WebM ─────────────────────────────────────────────
  {
    slug: 'mp4-to-webm',
    operation: 'convert',
    inputFormats: ['mp4'],
    outputFormat: 'webm',
    goOp: 'transcode_webm',
    title: 'Convert MP4 to WebM — free, browser-native',
    h1: 'MP4 to WebM',
    valueProp: 'VP9 + Opus. Browser-native. No watermark.',
    ffmpegCommand:
      'ffmpeg -i input.mp4 -c:v libvpx-vp9 -b:v 200k -deadline realtime -c:a libopus -b:a 48k output.webm',
    intentVolume: 'head',
    faqs: convertFaqs('mp4', 'webm'),
    related: ['webm-to-mp4', 'mp4-to-mov', 'compress-mp4'],
    flagship: { rank: 1, label: 'MP4 → WebM' },
  },

  // Reverse: WebM → MP4 — also frequent.
  {
    slug: 'webm-to-mp4',
    operation: 'convert',
    inputFormats: ['webm'],
    outputFormat: 'mp4',
    goOp: 'transcode',
    title: 'Convert WebM to MP4 — free, no watermark',
    h1: 'WebM to MP4',
    valueProp: 'Free, in your browser, no watermark.',
    ffmpegCommand:
      'ffmpeg -i input.webm -c:v libx264 -preset ultrafast -crf 30 -c:a aac -b:a 64k output.mp4',
    intentVolume: 'head',
    faqs: convertFaqs('webm', 'mp4'),
    related: ['mp4-to-webm', 'mov-to-mp4', 'compress-mp4'],
  },

  // Bulk video→mp4 row: covers all non-flagship video inputs → MP4 from one
  // row. mov & webm have their own flagship single-input rows above; this row
  // resolves into pages for the remaining 12 video formats.
  {
    slug: 'video-to-mp4',
    operation: 'convert',
    inputFormats: [
      'mkv',
      'avi',
      'flv',
      'wmv',
      'm4v',
      'mpeg',
      '3gp',
      'ts',
      'mts',
      'm2ts',
      'ogv',
      'vob',
    ],
    outputFormat: 'mp4',
    goOp: 'transcode',
    title: 'Convert video to MP4 — free, no watermark',
    h1: 'Video to MP4',
    valueProp: 'MKV, AVI, FLV, WMV, MPEG-TS — into MP4. Free.',
    ffmpegCommand:
      'ffmpeg -i input.{ext} -c:v libx264 -preset ultrafast -crf 30 -c:a aac -b:a 64k output.mp4',
    intentVolume: 'mid',
    faqs: convertFaqs('video', 'mp4'),
    related: ['mp4-to-mov', 'mp4-to-webm', 'compress-mp4'],
  },

  // ─── COMPRESS ────────────────────────────────────────────────────────────
  {
    slug: 'compress-mp4',
    operation: 'compress',
    inputFormats: ['mp4'],
    outputFormat: 'mp4',
    goOp: 'change_bitrate',
    title: 'Compress MP4 — shrink video size, no watermark',
    h1: 'Compress MP4',
    valueProp: 'Smaller file, same MP4. No watermark, no signup.',
    ffmpegCommand:
      'ffmpeg -i input.mp4 -c:v libx264 -preset slow -crf 28 -c:a aac -b:a 64k output.mp4',
    intentVolume: 'head',
    faqs: [
      {
        q: 'How much smaller will my MP4 be?',
        a: 'Default settings target ~50% size reduction with minimal visible quality loss. Use the Discord/email presets for hard size targets.',
      },
      {
        q: 'Will it lose quality?',
        a: 'Some — the default CRF 28 keeps perceptual quality high. Maximum quality preserves more detail at a larger size.',
      },
      {
        q: 'Is there a file size limit?',
        a: '100 MB on the free tier, 10 GB on Pro.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'The exact command is shown on the result page with a copy button.',
      },
    ],
    related: [
      'mp4-to-webm',
      'compress-mp4-under-25mb',
      'compress-mp4-under-8mb',
    ],
  },

  // Long-tail size-targeted compress variants (per phased-spec Phase 2 coverage).
  // Phase 1 ships them too — same op, just different preset hints + URL slugs.
  {
    slug: 'compress-mp4-under-25mb',
    operation: 'compress',
    inputFormats: ['mp4'],
    outputFormat: 'mp4',
    goOp: 'change_bitrate',
    title: 'Compress MP4 under 25 MB — for Discord, email',
    h1: 'Compress MP4 to under 25 MB',
    valueProp: 'Hits the 25 MB Discord/email cap. No watermark.',
    ffmpegCommand:
      'ffmpeg -i input.mp4 -c:v libx264 -preset slow -b:v {target_bitrate} -c:a aac -b:a 96k output.mp4',
    intentVolume: 'tail',
    faqs: [
      {
        q: 'Why 25 MB?',
        a: 'Discord (free tier) and most email providers cap attachments at 25 MB. We compute the bitrate from your clip length to land just under.',
      },
      {
        q: 'What if my clip is too long to fit?',
        a: 'Trim it first or use the under-100MB preset. Heavy compression below 200 kbps degrades visibly.',
      },
      {
        q: 'How long does it take?',
        a: 'Typically 2-3x clip duration on the slow preset. Quality is the priority for size-targeted compress.',
      },
      {
        q: 'Will the result still play everywhere?',
        a: 'Yes — output is standard H.264 + AAC in an MP4 container.',
      },
    ],
    related: [
      'compress-mp4',
      'compress-mp4-under-8mb',
      'compress-mp4-under-100mb',
    ],
    preset: { targetSizeMb: 25, preset: 'slow', audioBitrate: '96k' },
  },
  {
    slug: 'compress-mp4-under-8mb',
    operation: 'compress',
    inputFormats: ['mp4'],
    outputFormat: 'mp4',
    goOp: 'change_bitrate',
    title: 'Compress MP4 under 8 MB — for old Discord limits',
    h1: 'Compress MP4 to under 8 MB',
    valueProp: 'Hits the legacy 8 MB Discord cap. No watermark.',
    ffmpegCommand:
      'ffmpeg -i input.mp4 -c:v libx264 -preset slow -b:v {target_bitrate} -c:a aac -b:a 64k output.mp4',
    intentVolume: 'tail',
    faqs: [
      {
        q: 'Why 8 MB?',
        a: 'Pre-Nitro Discord and a number of forums still cap at 8 MB. We compute the bitrate from your clip length to land just under.',
      },
      {
        q: 'Will quality suffer at 8 MB?',
        a: 'For clips over ~30s, yes — visibly. Trim first if you can.',
      },
      {
        q: 'What about Discord Nitro?',
        a: 'Use the under-100MB preset (Nitro Basic) or under-500MB (Nitro).',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: [
      'compress-mp4',
      'compress-mp4-under-25mb',
      'compress-mp4-under-100mb',
    ],
    preset: { targetSizeMb: 8, preset: 'slow', audioBitrate: '64k' },
  },
  {
    slug: 'compress-mp4-under-100mb',
    operation: 'compress',
    inputFormats: ['mp4'],
    outputFormat: 'mp4',
    goOp: 'change_bitrate',
    title: 'Compress MP4 under 100 MB — for email and Slack',
    h1: 'Compress MP4 to under 100 MB',
    valueProp: 'Hits the 100 MB cap on most email and Slack uploads.',
    ffmpegCommand:
      'ffmpeg -i input.mp4 -c:v libx264 -preset slow -b:v {target_bitrate} -c:a aac -b:a 128k output.mp4',
    intentVolume: 'tail',
    faqs: [
      {
        q: 'Why 100 MB?',
        a: 'Slack free, Outlook (with OneDrive), Gmail, and most CMS uploaders cap around 100 MB.',
      },
      {
        q: 'Will quality suffer?',
        a: 'Barely — 100 MB is enough headroom for most short clips at 1080p.',
      },
      {
        q: 'How long does it take?',
        a: '2-3x clip duration on the slow preset.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['compress-mp4', 'compress-mp4-under-25mb', 'mp4-to-webm'],
    preset: { targetSizeMb: 100, preset: 'slow', audioBitrate: '128k' },
  },

  // ─── EXTRACT-AUDIO ───────────────────────────────────────────────────────
  // Flagship #4: Video → MP3.
  {
    slug: 'video-to-mp3',
    operation: 'extract-audio',
    inputFormats: VIDEO_FORMATS_ALL,
    outputFormat: 'mp3',
    goOp: 'audio_mp3',
    title: 'Extract MP3 from video — free, no watermark',
    h1: 'Video to MP3',
    valueProp: 'Strip the audio. MP3 out. No watermark.',
    ffmpegCommand:
      'ffmpeg -i input.{ext} -vn -c:a libmp3lame -b:a 192k output.mp3',
    intentVolume: 'head',
    faqs: [
      {
        q: 'Does this rip from YouTube?',
        a: 'No — upload your own files. We do not download from third-party sites.',
      },
      {
        q: 'What bitrate is the MP3?',
        a: 'Default 192 kbps. Use the advanced panel for 64k / 128k / 320k.',
      },
      {
        q: 'Is the conversion free?',
        a: 'Yes. No watermark, no signup, no email.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['mp4-to-wav', 'mp4-to-aac', 'mp4-to-gif'],
    flagship: { rank: 4, label: 'Video → MP3' },
  },
  {
    slug: 'video-to-wav',
    operation: 'extract-audio',
    inputFormats: VIDEO_FORMATS_ALL,
    outputFormat: 'wav',
    goOp: 'extract_audio',
    title: 'Extract WAV from video — free, no watermark',
    h1: 'Video to WAV',
    valueProp: 'Lossless audio out. No watermark.',
    ffmpegCommand: 'ffmpeg -i input.{ext} -vn -acodec pcm_s16le output.wav',
    intentVolume: 'mid',
    faqs: [
      {
        q: 'Why WAV instead of MP3?',
        a: 'WAV is lossless — best for re-editing, transcription, or further processing. MP3 is smaller for sharing.',
      },
      {
        q: 'Is there a file size limit?',
        a: 'WAVs are large. 100 MB free, 10 GB Pro.',
      },
      {
        q: 'Are my files private?',
        a: 'Server-side conversions auto-delete one hour after the job finishes.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['video-to-mp3', 'video-to-aac', 'video-to-flac'],
  },
  {
    slug: 'video-to-aac',
    operation: 'extract-audio',
    inputFormats: VIDEO_FORMATS_ALL,
    outputFormat: 'aac',
    goOp: 'audio_aac',
    title: 'Extract AAC from video — free, no watermark',
    h1: 'Video to AAC',
    valueProp: 'AAC (m4a) audio out. Apple-friendly. No watermark.',
    ffmpegCommand: 'ffmpeg -i input.{ext} -vn -c:a aac -b:a 192k output.m4a',
    intentVolume: 'tail',
    faqs: [
      {
        q: 'Why AAC instead of MP3?',
        a: 'AAC is more efficient at the same bitrate — better for Apple ecosystems and modern players.',
      },
      {
        q: 'Will it play on iPhone?',
        a: 'Yes — AAC in m4a is the iTunes/iOS native format.',
      },
      {
        q: 'Is the conversion free?',
        a: 'Yes. No watermark, no signup.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['video-to-mp3', 'video-to-wav', 'video-to-flac'],
  },
  {
    slug: 'video-to-flac',
    operation: 'extract-audio',
    inputFormats: VIDEO_FORMATS_ALL,
    outputFormat: 'flac',
    goOp: 'audio_flac',
    title: 'Extract FLAC from video — free, lossless',
    h1: 'Video to FLAC',
    valueProp: 'Lossless compressed audio out.',
    ffmpegCommand: 'ffmpeg -i input.{ext} -vn -c:a flac output.flac',
    intentVolume: 'tail',
    faqs: [
      {
        q: 'Why FLAC?',
        a: 'Lossless and ~50% smaller than WAV. Best when you need archival quality but want to save disk.',
      },
      {
        q: 'Will Apple Music / iTunes play FLAC?',
        a: 'macOS yes (via QuickTime). iTunes historically no — use AAC for those.',
      },
      {
        q: 'Is the conversion free?',
        a: 'Yes.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['video-to-mp3', 'video-to-wav', 'video-to-aac'],
  },

  // ─── GIF ─────────────────────────────────────────────────────────────────
  // Flagship #3: MP4 → GIF.
  {
    slug: 'mp4-to-gif',
    operation: 'gif',
    inputFormats: ['mp4'],
    outputFormat: 'gif',
    goOp: 'gif_from_video',
    title: 'Convert MP4 to GIF — free, no watermark',
    h1: 'MP4 to GIF',
    valueProp: 'Animated GIF out. Palette-optimised. No watermark.',
    ffmpegCommand:
      "ffmpeg -i input.mp4 -vf 'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse' output.gif",
    intentVolume: 'head',
    faqs: [
      {
        q: 'How big will the GIF be?',
        a: 'Larger than the MP4, often 5-10x. GIF has no inter-frame compression. Use WebM for shorter file size.',
      },
      {
        q: 'Why does my GIF look pixelated?',
        a: "GIF is limited to 256 colours per palette. We use ffmpeg's palettegen filter to pick the best 256 for your clip.",
      },
      {
        q: 'Can I change the FPS or width?',
        a: 'Yes — open the advanced panel before converting.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['mov-to-gif', 'webm-to-gif', 'mp4-to-webp-anim'],
    flagship: { rank: 3, label: 'MP4 → GIF' },
    preset: { fps: 10 },
    // SEAN-60: hand-tuned copy for flagship rank-3 GIF page. Talks
    // specifically about GIF's 256-colour palette quantisation — the load-
    // bearing technical detail this format demands.
    whenToUse: `Reach for MP4 to GIF when you need an inline animation that plays without a video player — Slack messages, Discord chats, Twitter timelines, GitHub README files, Stack Overflow answers, Reddit comments, internal wikis. GIF carries no audio and tops out at 256 colours per palette, so it suits short low-detail loops more than full-fidelity clips. Expect the GIF to weigh five to ten times the source MP4 since GIF has no inter-frame compression — every frame stores a full bitmap rather than a delta from the previous frame. We default to 10 FPS at 480 px wide, which keeps file size manageable while preserving readable motion. For longer animations or higher fidelity, animated WebP or a hosted MP4 wins on size and looks cleaner on flat backgrounds.`,
    extendedHowItWorks: `GIF encoding is a two-pass palette operation. Pass one runs ffmpeg's palettegen filter over the entire MP4 to pick the optimal 256 colours for that specific clip — sampling every frame so the chosen palette covers the full colour range, not just the first few seconds. Pass two encodes each frame using paletteuse with Floyd-Steinberg dithering, which scatters quantisation error across neighbouring pixels so flat regions like skies and skin tones don't band visibly. The lanczos scaler resizes each frame to 480 px wide before palette mapping. Increase FPS for smoother motion (24 FPS produces near-video smoothness but doubles the file size) or width for more detail (720 px roughly doubles size again). Both parameters trade size for fidelity linearly.`,
    commonPitfalls: [
      {
        q: 'My GIF looks pixelated or banded — why?',
        a: 'GIF is hard-capped at 256 colours per palette. Our palettegen picks the optimal 256 for your clip, but gradients, skin tones, and flat backgrounds still band slightly. For full-colour animation, use animated WebP — most modern destinations accept it.',
      },
      {
        q: 'My GIF is enormous — way bigger than the MP4.',
        a: 'Expected. GIF stores every frame as a full bitmap (no inter-frame compression), so a 5-second clip can balloon 5-10x. Drop FPS to 8 or width to 320 px in the advanced panel, or switch to animated WebP if the destination accepts it.',
      },
      {
        q: 'Will Discord / Slack / Twitter play this inline?',
        a: 'Yes — GIF is the universal inline-animation format. Discord and Slack both autoplay GIFs in chat; Twitter converts uploaded GIFs to MP4 internally but still displays them inline.',
      },
      {
        q: 'Can I add audio to the GIF?',
        a: 'No — GIF format has no audio track. If you need sound with your loop, render to animated WebP (which also has no audio) plus a separate audio track, or use a video container.',
      },
    ],
  },

  // ─── SEAN-76: high-intent gif siblings to the mp4-to-gif flagship ────────
  // These three slugs were declared in `mp4-to-gif`'s `related` block but
  // didn't exist as matrix rows, so the flagship's Related section silently
  // collapsed (resolveSiblings filters dead links per SEAN-50). They also
  // cover high-intent SEO queries that were being absorbed by the 14-input
  // `video-to-gif` bulk row.

  // MOV → GIF — iPhone screen recording / Final Cut export → Slack/Discord.
  {
    slug: 'mov-to-gif',
    operation: 'gif',
    inputFormats: ['mov'],
    outputFormat: 'gif',
    goOp: 'gif_from_video',
    title: 'Convert MOV to GIF — free, no watermark',
    h1: 'MOV to GIF',
    valueProp: 'iPhone clip → animated GIF. Palette-optimised. No watermark.',
    ffmpegCommand:
      "ffmpeg -i input.mov -vf 'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse' output.gif",
    intentVolume: 'mid',
    faqs: [
      {
        q: 'My MOV is a screen recording from iOS — will the conversion handle HEVC?',
        a: 'Yes. iPhone screen recordings since iOS 11 wrap HEVC inside the QuickTime MOV container. We decode the HEVC video stream first, then run palettegen + paletteuse to land a clean 256-colour GIF.',
      },
      {
        q: 'How big will the GIF be vs the MOV?',
        a: 'Typically 5-10x bigger. GIF has no inter-frame compression, so every frame stores a full bitmap rather than a delta. Drop FPS to 8 or width to 320 px in the advanced panel for a smaller output.',
      },
      {
        q: 'Will the audio survive?',
        a: 'No — GIF format has no audio track. The audio in the MOV is discarded silently. Use animated WebP (also no audio) plus a separate audio track, or a video container, if sound matters.',
      },
      {
        q: 'Why does the GIF look posterised on flat backgrounds?',
        a: 'GIF is hard-capped at 256 colours per palette. Our palettegen filter picks the optimal 256 for your specific clip, but flat colours like skies and skin tones still band slightly. Switch to animated WebP for full-colour output.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button — paste into your terminal if you prefer to keep the file local.',
      },
    ],
    related: ['mp4-to-gif', 'webm-to-gif', 'mp4-to-webp-anim'],
    preset: { fps: 10 },
    // SEAN-76 — hand-tuned copy. Required because the default `gif` op copy
    // collides with `video-to-gif` resolved with input=mov (would have
    // produced an identical body signature and tripped the duplicate-content
    // check in word-count.test.ts).
    whenToUse: `Reach for MOV to GIF when an iPhone clip or a Final Cut export needs to play inline somewhere a video tag won't fit — a Slack thread, a Discord chat, a Twitter timeline, a GitHub README, a Stack Overflow answer. The MOV container almost always wraps HEVC since iOS 11 made it the default, which a GIF encoder can't read directly; we decode HEVC to raw frames first, then run palettegen + paletteuse to land a clean animated GIF on the other side. The audio track is dropped silently — GIF has no sound. For long iPhone clips or any source that needs full colour fidelity, animated WebP holds up better; reach for MOV to GIF specifically when the destination is one of the older platforms that still expect literal .gif files.`,
    extendedHowItWorks: `The pipeline runs in three logical stages. Stage one demuxes the MOV container and decodes the HEVC (or H.264) video stream to raw frames in memory. Stage two passes those frames through ffmpeg's palettegen filter, which scans every frame to pick the optimal 256 colours for that specific clip — sampling the entire runtime so the chosen palette covers the full colour range, not just the opening shot. Stage three encodes each frame using paletteuse with Floyd-Steinberg dithering, scaling to 480 px wide via the lanczos resampler so flat regions like skies and skin tones don't band visibly. The audio track is discarded with -an. Output is a standard GIF89a animation that plays inline on every platform that accepts the format.`,
    commonPitfalls: [
      {
        q: 'My MOV came out of an iPhone — does the HEVC codec change anything for the GIF?',
        a: 'iPhone MOVs use HEVC (H.265) by default since iOS 11. We decode HEVC fine, but if the source is a screen recording at 60 FPS, the default 10 FPS GIF output will skip frames. Bump FPS in the advanced panel to keep more motion detail.',
      },
      {
        q: 'My GIF is enormous compared to the source MOV.',
        a: 'Expected. iPhone HEVC inside MOV is highly compressed — often 50-100x smaller than an equivalent uncompressed bitmap stream. GIF stores every frame as a full bitmap with no inter-frame compression, so the size jump is unavoidable. Trim the clip first or switch to animated WebP if size matters.',
      },
      {
        q: 'The GIF stutters where the MOV played smoothly.',
        a: 'GIF browsers cap playback at the framerate they were encoded at, and 10 FPS is our default to keep file size manageable. If the source MOV was 60 FPS and the motion matters, bump GIF FPS to 24 in the advanced panel — file size roughly doubles but the playback stays smoother.',
      },
      {
        q: 'Will Slack / Discord / Twitter autoplay this inline?',
        a: 'Yes. GIF is the universal inline-animation format on chat and social platforms. Discord and Slack autoplay every GIF in chat; Twitter transcodes uploaded GIFs to MP4 internally but still displays them as inline animations.',
      },
    ],
  },

  // WebM → GIF — modern browser export / OBS → chat platforms.
  {
    slug: 'webm-to-gif',
    operation: 'gif',
    inputFormats: ['webm'],
    outputFormat: 'gif',
    goOp: 'gif_from_video',
    title: 'Convert WebM to GIF — free, no watermark',
    h1: 'WebM to GIF',
    valueProp: 'WebM clip → animated GIF. Palette-optimised. No watermark.',
    ffmpegCommand:
      "ffmpeg -i input.webm -vf 'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse' output.gif",
    intentVolume: 'mid',
    faqs: [
      {
        q: 'My WebM came from a browser export — is it VP9 or VP8?',
        a: 'Modern browsers (Chrome, Firefox, Safari since 14) encode WebM as VP9 + Opus by default; older recordings may be VP8 + Vorbis. We decode both transparently and the output GIF is identical either way.',
      },
      {
        q: 'How big will the GIF be vs the WebM?',
        a: 'Typically 8-15x bigger. WebM with VP9 is one of the most efficient web video codecs — close to half the bytes of an equivalent MP4. GIF has no inter-frame compression, so every frame is a full bitmap. The relative jump is bigger than for MP4 sources.',
      },
      {
        q: 'Will the audio survive in the GIF?',
        a: 'No — GIF format has no audio track. The Opus or Vorbis audio in the WebM is dropped silently. Use animated WebP (which also has no audio) or a video container for sound.',
      },
      {
        q: 'Why does my GIF lose the smooth gradients my WebM had?',
        a: 'GIF is capped at 256 colours per palette per frame. VP9 inside WebM holds gradients natively at the full codec colour space; GIF must quantise. Our palettegen picks the optimal 256 for your clip, but for full-colour output use animated WebP instead.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button — paste into your terminal if you prefer to keep the file local.',
      },
    ],
    related: ['mp4-to-gif', 'mov-to-gif', 'mp4-to-webp-anim'],
    preset: { fps: 10 },
    // SEAN-76 — hand-tuned copy required for the same reason as mov-to-gif:
    // avoids body-signature collision with `video-to-gif` resolved input=webm.
    whenToUse: `Reach for WebM to GIF when a browser export or an OBS recording landed you on the modern open codec but the destination only accepts the legacy format — Slack messages, Discord channels, Reddit comments, GitHub issue replies, Stack Overflow answers, internal documentation. WebM is the open VP9/Opus container every modern browser ships natively, which makes it the default for Chrome screen recorders and browser capture tools; GIF is what every chat and forum still expects in return. The audio track in the WebM is dropped — GIF has no sound — so reach for animated WebP or a video container instead when the audio matters.`,
    extendedHowItWorks: `WebM-to-GIF runs the same palette-quantisation pipeline as every gif-from-video operation, but the input decoding stage is more demanding because VP9 holds more visual detail than the codec GIF can represent. Stage one decodes the VP9 (or VP8) bitstream to raw frames at the source resolution. Stage two runs palettegen across the full clip to choose the optimal 256-colour palette — sampling every frame so the choice represents the entire animation, not just the opening shot. Stage three encodes each frame with paletteuse plus Floyd-Steinberg dithering and scales to 480 px wide via the lanczos resampler. The Opus or Vorbis audio is discarded with -an. Output is a standard GIF89a animation; expect noticeable colour banding on flat regions where the VP9 source held smooth gradients.`,
    commonPitfalls: [
      {
        q: 'WebM looks blocky compared to my MP4 source — why?',
        a: 'VP9 takes longer to compress well than H.264. If the WebM was generated quickly (a browser screen recording, an OBS realtime output), expect chunky blocks on flat backgrounds even before GIF conversion. The blocks survive — and become more obvious — once GIF quantises down to 256 colours.',
      },
      {
        q: 'My GIF is way bigger than the source WebM.',
        a: 'Expected, and the gap is wider than for MP4 sources. WebM with VP9 is one of the most efficient web video codecs — often half the bytes of an equivalent MP4. GIF has no inter-frame compression at all, so the relative size jump is roughly double what you would see going from MP4 to GIF.',
      },
      {
        q: 'My WebM has a transparent background — does the GIF preserve it?',
        a: 'Partially. GIF supports a single fully-transparent palette index but no alpha channel, so semi-transparent pixels in the WebM (common when the source is a layered animation) flatten to either fully transparent or fully opaque. Use animated WebP if you need true alpha.',
      },
      {
        q: 'Will the GIF play in browsers that don’t support WebM?',
        a: 'Yes — GIF predates every browser GIF support is older than WebM by two decades. The GIF output plays in IE6, Safari on iOS, every Android version, and every legacy app or CMS that survives. That’s the whole reason this conversion exists.',
      },
    ],
  },

  // MP4 → animated WebP — modern alternative to GIF, half the size.
  {
    slug: 'mp4-to-webp-anim',
    operation: 'gif',
    inputFormats: ['mp4'],
    outputFormat: 'webp-anim',
    goOp: 'gif_to_webp_anim',
    title: 'Convert MP4 to animated WebP — half the size of GIF',
    h1: 'MP4 to animated WebP',
    valueProp:
      'Full-colour animated WebP. Roughly half the bytes of an equivalent GIF.',
    ffmpegCommand:
      'ffmpeg -i input.mp4 -vf "fps=10,scale=480:-1:flags=lanczos" -c:v libwebp_anim -loop 0 -quality 75 -an output.webp',
    intentVolume: 'mid',
    faqs: [
      {
        q: 'Why animated WebP instead of GIF?',
        a: 'WebP is full-colour (no 256-palette cap), supports alpha, and typically lands at half the file size of an equivalent GIF for the same visible quality. Modern browsers and chat platforms (Discord, Slack, Telegram, modern WhatsApp) display animated WebP inline.',
      },
      {
        q: 'Will animated WebP play everywhere a GIF plays?',
        a: 'Almost. Chrome, Firefox, Safari (since 14), and Edge support animated WebP natively. Older browsers, some legacy email clients, and a small number of CMS uploaders still expect literal GIF — use the mp4-to-gif tool for those destinations.',
      },
      {
        q: 'Will the audio survive?',
        a: 'No — animated WebP, like GIF, has no audio track. The audio in the MP4 is discarded silently. For sound use a video container.',
      },
      {
        q: 'How does file size compare to my source MP4?',
        a: 'Animated WebP is typically 2-4x bigger than a well-encoded MP4 of the same clip — much closer than GIF, which is usually 5-10x. The gap shrinks further on flat-coloured or low-motion clips.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button — paste into your terminal if you prefer to keep the file local.',
      },
    ],
    related: ['mp4-to-gif', 'mov-to-gif', 'webm-to-gif'],
    preset: { fps: 10 },
    // SEAN-76 — hand-tuned copy required because the default `gif` op copy
    // hard-codes "animated GIF" semantics (palettegen, 256 colours, etc.) that
    // don't apply to webp-anim. This row needs its own narrative about the
    // GIF-vs-WebP tradeoff.
    whenToUse: `Reach for MP4 to animated WebP when the destination is modern enough to render WebP — Discord, Slack, Telegram, modern WhatsApp, Chrome and Firefox web embeds, GitHub README files (since 2022), most Notion blocks, and every modern email client except a stubborn corner of Outlook. Animated WebP holds full colour rather than quantising to 256 like GIF, supports alpha cleanly, and typically lands at half the bytes for the same visible quality — which makes it the right choice when bandwidth or upload caps matter and the destination accepts the format. Audio is dropped (WebP has no sound track), so reach for a video container instead when the soundtrack matters. For older or stricter destinations that still expect literal .gif files, use the mp4-to-gif tool.`,
    extendedHowItWorks: `Animated WebP encoding skips the palette-quantisation step entirely — that is the load-bearing difference from GIF. Stage one decodes the MP4 to raw frames using the H.264 (or HEVC, for newer devices) decoder. Stage two scales each frame to 480 px wide via the lanczos resampler and resamples to 10 FPS, which keeps file size manageable while preserving readable motion. Stage three encodes the frame sequence with libwebp_anim at quality 75, which produces a full-colour animated WebP file with no per-frame palette and no banding on gradients or skin tones — both of which GIF cannot represent. The audio track is discarded with -an. Output is a single .webp file containing the entire animation, recognised inline by every modern browser and chat platform.`,
    commonPitfalls: [
      {
        q: 'My destination shows a broken-image icon instead of the animation.',
        a: 'The destination doesn’t support animated WebP. Older email clients, legacy CMS uploaders, and a handful of social platforms (LinkedIn historically) still expect literal GIF. Use the mp4-to-gif tool for those — animated WebP is the modern alternative, not a universal replacement.',
      },
      {
        q: 'My WebP is bigger than I expected.',
        a: 'Animated WebP is much smaller than GIF for the same clip but still 2-4x the source MP4. WebP has no inter-frame compression as efficient as H.264. Drop FPS to 8 or width to 320 px in the advanced panel if the file size matters more than full-fidelity playback.',
      },
      {
        q: 'Does Twitter / X display animated WebP inline?',
        a: 'No — Twitter strips animated WebP and shows it as a static image. Use mp4-to-gif for X/Twitter, or upload the source MP4 directly (Twitter transcodes video natively and displays it inline as if it were a GIF).',
      },
      {
        q: 'Why no audio?',
        a: 'WebP, like GIF, was designed as an image format. Neither carries an audio track. If the soundtrack matters, render to a video container (MP4 or WebM) instead — both display inline on every modern chat platform.',
      },
    ],
  },

  {
    // SEAN-76: mov & webm pulled out of this bulk row; they now have their
    // own curated `mov-to-gif` / `webm-to-gif` rows above so the high-intent
    // queries "convert mov to gif" and "convert webm to gif" land on a
    // dedicated SEO page instead of being absorbed by the 14-input bulk row.
    slug: 'video-to-gif',
    operation: 'gif',
    inputFormats: [
      'mkv',
      'avi',
      'flv',
      'wmv',
      'm4v',
      'mpeg',
      '3gp',
      'ts',
      'mts',
      'm2ts',
      'ogv',
      'vob',
    ],
    outputFormat: 'gif',
    goOp: 'gif_from_video',
    title: 'Convert video to GIF — free, no watermark',
    h1: 'Video to GIF',
    valueProp: 'Any video → animated GIF. Palette-optimised.',
    ffmpegCommand:
      "ffmpeg -i input.{ext} -vf 'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse' output.gif",
    intentVolume: 'mid',
    faqs: [
      {
        q: 'How big will the GIF be?',
        a: 'Larger than the source video, often 5-10x. GIF lacks inter-frame compression.',
      },
      {
        q: 'Will it have audio?',
        a: 'No — GIF format has no audio track. Use WebM if you need it.',
      },
      {
        q: 'Can I trim the clip first?',
        a: 'Yes — use the trim tool, then convert the result.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['mp4-to-gif', 'trim-mp4', 'compress-mp4'],
    preset: { fps: 10 },
  },

  // ─── Flagship #5: Shrink for Discord (alias of compress-mp4-under-25mb,
  // exposed at homepage flagship rank 5). The flagship row is the same data
  // pointed at the same Go op — just labelled for the pill UI.
  // We mark it on the under-25mb row above by leaving flagship there.
  // (Implemented inline above for clarity — see compress-mp4-under-25mb.)

  // ─── Flagship #6: Grab a thumbnail ──────────────────────────────────────
  {
    slug: 'thumbnail-mp4',
    operation: 'thumbnail',
    inputFormats: VIDEO_FORMATS_ALL,
    outputFormat: 'jpg',
    goOp: 'thumbnail',
    title: 'Grab a thumbnail from video — free, no watermark',
    h1: 'Video thumbnail',
    valueProp: 'One frame at a timestamp. JPG out.',
    ffmpegCommand:
      'ffmpeg -ss 00:00:01 -i input.{ext} -frames:v 1 -q:v 5 output.jpg',
    intentVolume: 'mid',
    faqs: [
      {
        q: 'Can I pick the timestamp?',
        a: 'Yes — open the advanced panel and set the timestamp before converting.',
      },
      {
        q: 'What format is the thumbnail?',
        a: 'JPG by default. PNG and WebP are available in the advanced panel.',
      },
      {
        q: 'Is the conversion free?',
        a: 'Yes.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['contact-sheet-mp4', 'mp4-to-gif', 'trim-mp4'],
    flagship: { rank: 6, label: 'Grab a thumbnail' },
  },

  // ─── Flagship #7: Trim a clip ───────────────────────────────────────────
  {
    slug: 'trim-mp4',
    operation: 'trim',
    inputFormats: ['mp4'],
    outputFormat: 'mp4',
    goOp: 'trim',
    title: 'Trim MP4 video — free, no watermark',
    h1: 'Trim MP4',
    valueProp: 'Cut a clip. Set start and duration. Done in seconds.',
    ffmpegCommand:
      'ffmpeg -ss {start} -i input.mp4 -t {duration} -c:v libx264 -preset ultrafast -crf 30 -c:a aac output.mp4',
    intentVolume: 'head',
    faqs: [
      {
        q: 'How precise is the trim?',
        a: 'Frame-accurate when re-encoding (the default). Use the stream-copy advanced option for instant cuts at keyframe boundaries.',
      },
      {
        q: 'Can I trim other formats?',
        a: 'Yes — see /trim/[format] for MOV, WebM, MKV.',
      },
      {
        q: 'Is the conversion free?',
        a: 'Yes.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['compress-mp4', 'mp4-to-gif', 'video-to-mp3'],
    flagship: { rank: 7, label: 'Trim a clip' },
  },

  // ─── Flagship #8: Resize ────────────────────────────────────────────────
  {
    slug: 'resize-mp4',
    operation: 'resize',
    inputFormats: ['mp4'],
    outputFormat: 'mp4',
    goOp: 'resize',
    title: 'Resize MP4 video — free, no watermark',
    h1: 'Resize MP4',
    valueProp:
      'Make this fit X by Y. Pick a resolution preset or set custom dimensions.',
    ffmpegCommand:
      'ffmpeg -i input.mp4 -vf scale={w}:{h} -c:v libx264 -preset ultrafast -crf 30 -c:a copy output.mp4',
    intentVolume: 'mid',
    faqs: [
      {
        q: 'What resolutions can I pick?',
        a: '480p, 720p, 1080p, 1440p, 2160p as one-click presets, plus a custom width/height field.',
      },
      {
        q: 'Will it preserve aspect ratio?',
        a: 'Yes by default. Use the pad-to-aspect option for letterboxing/pillarboxing.',
      },
      {
        q: 'Is the conversion free?',
        a: 'Yes.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['compress-mp4', 'mp4-to-webm', 'trim-mp4'],
    flagship: { rank: 8, label: 'Resize' },
  },

  // ─── Flagship #9: Image → WebP ──────────────────────────────────────────
  {
    slug: 'image-to-webp',
    operation: 'image-convert',
    inputFormats: ['jpg', 'png', 'heic', 'avif'],
    outputFormat: 'webp',
    goOp: 'image_to_webp',
    title: 'Convert image to WebP — free, no watermark',
    h1: 'Image to WebP',
    valueProp: 'JPG, PNG, HEIC → WebP. Smaller files for the web.',
    ffmpegCommand: 'ffmpeg -i input.{ext} -c:v libwebp -quality 75 output.webp',
    intentVolume: 'mid',
    faqs: [
      {
        q: 'How much smaller is WebP?',
        a: 'Typically 25-35% smaller than JPG at the same quality. Larger savings vs PNG.',
      },
      {
        q: 'Will WebP load in all browsers?',
        a: 'Yes — Chrome, Firefox, Safari, Edge all support WebP since 2020.',
      },
      {
        q: 'Is the conversion free?',
        a: 'Yes.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['image-to-jpg', 'image-to-avif', 'image-to-png'],
    flagship: { rank: 9, label: 'Image → WebP' },
  },

  // ─── Flagship #10: HEIC/PNG → JPG ───────────────────────────────────────
  {
    slug: 'image-to-jpg',
    operation: 'image-convert',
    inputFormats: ['png', 'heic', 'webp', 'avif'],
    outputFormat: 'jpg',
    goOp: 'image_to_jpg',
    title: 'Convert image to JPG — HEIC, PNG, WebP → JPG, free',
    h1: 'Image to JPG',
    valueProp:
      'HEIC, PNG, WebP → JPG. Send via email or Slack without compatibility issues.',
    ffmpegCommand: 'ffmpeg -i input.{ext} -q:v 5 output.jpg',
    intentVolume: 'head',
    faqs: [
      {
        q: 'Why convert HEIC to JPG?',
        a: 'iPhone photos are HEIC by default. Many email clients, Windows apps, and CMS tools still expect JPG.',
      },
      {
        q: 'Will quality suffer?',
        a: 'JPG default quality (q:v 5) is visually lossless for photos. Use the advanced panel for q:v 1-3 if you need maximum quality.',
      },
      {
        q: 'Can I batch-convert?',
        a: 'On the Pro tier — drop multiple files and they queue up.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['image-to-webp', 'image-to-png', 'image-to-avif'],
    flagship: { rank: 10, label: 'HEIC/PNG → JPG' },
  },

  // ─── Flagship #11: Normalise audio ──────────────────────────────────────
  {
    slug: 'normalize-audio',
    operation: 'normalize-audio',
    inputFormats: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'],
    outputFormat: 'wav',
    goOp: 'normalize_audio',
    title: 'Normalise audio loudness — EBU R128, free',
    h1: 'Normalise audio',
    valueProp: 'EBU R128 loudness normalisation. Podcast-ready.',
    ffmpegCommand:
      "ffmpeg -i input.{ext} -af 'loudnorm=I=-16:TP=-1.5:LRA=11' output.wav",
    intentVolume: 'mid',
    faqs: [
      {
        q: 'What is EBU R128?',
        a: 'A loudness standard (target -16 LUFS for podcasts, -23 LUFS for broadcast). Levels every track to the same perceived loudness without clipping.',
      },
      {
        q: 'Why not just use peak normalisation?',
        a: 'Peak normalisation only matches the loudest sample. Loudness normalisation matches *perceived* volume across the whole track — much more useful for mixing podcasts or music.',
      },
      {
        q: 'Can I pick the target LUFS?',
        a: 'Yes — open the advanced panel for podcast (-16), broadcast (-23), or streaming (-14) presets.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['video-to-mp3', 'video-to-wav', 'video-to-flac'],
    flagship: { rank: 11, label: 'Normalise audio' },
  },

  // ─── Flagship #12: Contact sheet ────────────────────────────────────────
  {
    slug: 'contact-sheet-mp4',
    operation: 'contact-sheet',
    inputFormats: VIDEO_FORMATS_ALL,
    outputFormat: 'jpg',
    goOp: 'contact_sheet',
    title: 'Video contact sheet — NxM grid of frames, free',
    h1: 'Video contact sheet',
    valueProp: 'NxM grid of sampled frames. Fun. Shareable.',
    ffmpegCommand:
      "ffmpeg -i input.{ext} -vf 'select=not(mod(n,30)),scale=320:-1,tile=3x3' -frames:v 1 -q:v 5 output.jpg",
    intentVolume: 'tail',
    faqs: [
      {
        q: 'What is a contact sheet?',
        a: 'A grid of evenly-sampled frames from your video — useful for previewing long clips, scrubbing for moments, or making thumbnails for blog posts.',
      },
      {
        q: 'Can I change the grid size?',
        a: 'Yes — open the advanced panel for cols and rows. Defaults to 3x3.',
      },
      {
        q: 'Is the conversion free?',
        a: 'Yes.',
      },
      {
        q: 'What ffmpeg command do you run?',
        a: 'Shown on the result page with a copy button.',
      },
    ],
    related: ['thumbnail-mp4', 'mp4-to-gif', 'trim-mp4'],
    flagship: { rank: 12, label: 'Contact sheet' },
  },
];

// ─────────────────────────────────────────────────────── GENERATED ───────────

/**
 * Set of slugs already claimed by the curated rows above. Generators consult
 * this to avoid emitting duplicates (e.g. the cross-product convert generator
 * skips `mov-to-mp4` because the flagship row owns that slug).
 */
const CURATED_SLUGS: ReadonlySet<string> = new Set(
  CURATED_MATRIX.map((row) => row.slug),
);

/**
 * Set of (input, output) pairs already covered by a curated multi-input
 * convert row. Single-input generated rows skip these pairs to keep every
 * (from, to) conversion uniquely addressable by exactly one slug — preventing
 * the duplicate-content SEO penalty that two URLs serving the same conversion
 * would invite.
 */
const CURATED_MULTI_INPUT_PAIRS: ReadonlySet<string> = new Set(
  CURATED_MATRIX.filter(
    (row) => row.operation === 'convert' && row.inputFormats.length > 1,
  ).flatMap((row) =>
    row.inputFormats.map((f) => `${f}-to-${row.outputFormat}`),
  ),
);

/**
 * Cross-product convert rows. For each video pair (from, to) where from ≠ to,
 * emit one single-input `${from}-to-${to}` row. Skips:
 *   - slugs already curated (the four flagship single-input rows)
 *   - pairs absorbed by a curated multi-input row (e.g. `video-to-mp4`
 *     already serves the (mkv, mp4) page — emitting `mkv-to-mp4` here would
 *     duplicate it under a different slug).
 *
 * Result: 15 × 14 = 210 convert pages, each with exactly one canonical slug.
 */
function generateConvertRows(): OperationRow[] {
  const rows: OperationRow[] = [];
  for (const from of VIDEO_FORMATS_ALL) {
    for (const to of VIDEO_FORMATS_ALL) {
      if (from === to) continue; // identity
      const slug = `${from}-to-${to}`;
      if (CURATED_SLUGS.has(slug)) continue;
      if (CURATED_MULTI_INPUT_PAIRS.has(slug)) continue;
      rows.push(convertRow(from, to));
    }
  }
  return rows;
}

/**
 * Cross-product compress rows: one per video format. `compress-mp4` is
 * curated; the other 14 formats are generated.
 */
function generateCompressRows(): OperationRow[] {
  const rows: OperationRow[] = [];
  for (const f of VIDEO_FORMATS_ALL) {
    const slug = `compress-${f}`;
    if (CURATED_SLUGS.has(slug)) continue;
    rows.push(compressRow(f));
  }
  return rows;
}

/**
 * Generated extract-audio rows for the audio outputs not covered by curated
 * rows (ogg, opus). The four curated outputs (mp3/wav/aac/flac) already span
 * all 15 video inputs, so we only need to add the remaining two.
 */
function generateExtractAudioRows(): OperationRow[] {
  const rows: OperationRow[] = [];
  const audioOpMap: Partial<Record<Format, GoOpName>> = {
    ogg: 'extract_audio',
    opus: 'audio_opus',
  };
  for (const audioOut of AUDIO_OUTPUTS_EXTRACT) {
    const slug = `video-to-${audioOut}`;
    if (CURATED_SLUGS.has(slug)) continue;
    const goOp = audioOpMap[audioOut];
    if (!goOp) continue;
    rows.push(extractAudioRow(audioOut, goOp));
  }
  return rows;
}

/**
 * Single-input gif rows for every video format except mp4 (curated) and the
 * formats covered by the bulk `video-to-gif` curated row. We emit one
 * `${from}-to-gif` per remaining format so each (video → gif) page gets an
 * SEO-friendly canonical slug.
 *
 * Returns empty when every video input is already covered — currently the
 * curated `video-to-gif` row spans 14 inputs and `mp4-to-gif` is the
 * flagship, so this generator returns nothing today. Kept as a safety net
 * for future curated-row reshuffles.
 */
function generateGifRows(): OperationRow[] {
  const rows: OperationRow[] = [];
  // Determine which video inputs the curated rows already cover for output gif.
  const covered = new Set<Format>();
  for (const row of CURATED_MATRIX) {
    if (row.operation !== 'gif' || row.outputFormat !== 'gif') continue;
    for (const f of row.inputFormats) covered.add(f);
  }
  for (const from of VIDEO_FORMATS_ALL) {
    if (covered.has(from)) continue;
    const slug = `${from}-to-gif`;
    if (CURATED_SLUGS.has(slug)) continue;
    rows.push(gifRow(from));
  }
  return rows;
}

const GENERATED_MATRIX: OperationRow[] = [
  ...generateConvertRows(),
  ...generateCompressRows(),
  ...generateExtractAudioRows(),
  ...generateGifRows(),
];

/**
 * Final matrix = curated rows + generated rows. This is what the rest of the
 * codebase imports; consumers should not need to know which rows came from
 * which path.
 */
export const MATRIX: OperationRow[] = [...CURATED_MATRIX, ...GENERATED_MATRIX];

// ─────────────────────────────────────────────────────── INDEXES ─────────────

/**
 * Indexed lookup by canonical slug. Used by the page template and route
 * generator to fetch a row by URL fragment.
 */
export const MATRIX_BY_SLUG: Record<string, OperationRow> = Object.fromEntries(
  MATRIX.map((row) => [row.slug, row]),
);

/**
 * The 12 flagship rows in flagship-rank order. Drives the homepage pill row.
 *
 * Rank 5 (`Shrink for Discord`) maps to `compress-mp4-under-25mb` — that row
 * carries the flagship metadata directly.
 *
 * Note: the matrix above attaches `flagship` to 11 rows; flagship rank 5
 * is recorded against the under-25mb row by re-tagging here, since one row
 * legitimately wears two hats (long-tail SEO target AND flagship pill).
 */
const FLAGSHIP_5_SLUG = 'compress-mp4-under-25mb';
const flagship5Row = MATRIX_BY_SLUG[FLAGSHIP_5_SLUG];
if (flagship5Row && !flagship5Row.flagship) {
  flagship5Row.flagship = { rank: 5, label: 'Shrink for Discord' };
}

export const FLAGSHIP_PRESETS: OperationRow[] = MATRIX.filter(
  (r) => r.flagship,
).sort((a, b) => (a.flagship?.rank ?? 0) - (b.flagship?.rank ?? 0));

/**
 * Indexed lookup by Go op identifier. Useful for the result page's
 * "ffmpeg command" block when the API returns the op name verbatim.
 */
export const MATRIX_BY_GO_OP: Map<GoOpName, OperationRow[]> = new Map();
for (const row of MATRIX) {
  const list = MATRIX_BY_GO_OP.get(row.goOp) ?? [];
  list.push(row);
  MATRIX_BY_GO_OP.set(row.goOp, list);
}

/**
 * Returns every valid (input, output) page resolved across the entire matrix.
 * This is what Phase 2's static-page generator iterates over.
 */
export function resolveAllPages(rows: OperationRow[] = MATRIX): ResolvedPage[] {
  return rows.flatMap(resolveRow);
}
