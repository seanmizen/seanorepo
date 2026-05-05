/**
 * Operations matrix — single source of truth for pSEO page generation.
 *
 * Schema is defined in `./types.ts` and mirrors §6 of the original vision spec
 * (preserved in git at commit 058ab8c, file `apps/ffmpeg-converter/spec-2026-05-05.md`).
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

const VIDEO_INPUTS_COMMON: Format[] = [
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'flv',
  'wmv',
  'm4v',
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

// ─────────────────────────────────────────────────────── MATRIX ──────────────

/**
 * The matrix. Curated subset for Phase 1 — Phase 2 expands to ≥200 pages.
 *
 * Coverage:
 *   - `convert`: video↔video and audio↔audio core conversions (incl. flagship
 *     MP4↔WebM and MOV→MP4)
 *   - `compress`: video size reduction with size-targeted long-tail variants
 *   - `extract-audio`: video → mp3/wav/aac (incl. flagship Video → MP3)
 *   - `gif`: video → animated GIF (incl. flagship MP4 → GIF)
 *   - flagship-only rows for `trim`, `resize`, `thumbnail`, `contact-sheet`,
 *     `change-speed` (mapped via flagship #5 "Shrink for Discord"),
 *     `normalize-audio`, `image-convert` (HEIC/PNG → JPG and Image → WebP)
 *
 * Flagship ranks (1-12) come from `docs/STRATEGY.md` "Flagship 8-12 headline
 * conversions" — see that doc for the why-each-one rationale.
 */
export const MATRIX: OperationRow[] = [
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

  // Bulk video→mp4 row: covers MKV/AVI/FLV/WMV/M4V → MP4 from one row.
  {
    slug: 'video-to-mp4',
    operation: 'convert',
    inputFormats: ['mkv', 'avi', 'flv', 'wmv', 'm4v', 'mpeg'],
    outputFormat: 'mp4',
    goOp: 'transcode',
    title: 'Convert video to MP4 — free, no watermark',
    h1: 'Video to MP4',
    valueProp: 'MKV, AVI, FLV, WMV — into MP4. Free.',
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
    inputFormats: VIDEO_INPUTS_COMMON,
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
    inputFormats: VIDEO_INPUTS_COMMON,
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
    inputFormats: VIDEO_INPUTS_COMMON,
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
    inputFormats: VIDEO_INPUTS_COMMON,
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
  },
  {
    slug: 'video-to-gif',
    operation: 'gif',
    inputFormats: ['mov', 'webm', 'mkv', 'avi', 'm4v'],
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
    inputFormats: VIDEO_INPUTS_COMMON,
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
    inputFormats: VIDEO_INPUTS_COMMON,
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
