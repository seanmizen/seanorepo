/**
 * Typed schema for the operations matrix.
 *
 * Source of truth for pSEO page generation. Each row in the matrix becomes one
 * or more static pages under `/convert/...`, `/compress/...`, `/extract-audio/...`,
 * `/gif/...`, etc.
 *
 * Schema mirrors §6 of the original vision spec (folded into `phased-spec.md`;
 * the dated source doc lives only in git history at commit 058ab8c) — extended
 * with the metadata that Phase 2 page generation needs (intent volume, FAQ
 * blocks, related-page slugs, presets).
 *
 * The Go backend's op identifiers (`transcode`, `transcode_webm`, `gif_from_video`,
 * etc.) live in `apps/ffmpeg-converter/ops.go`. The `goOp` field on each row binds
 * a matrix row to its backend implementation.
 */

/**
 * High-level operation taxonomy.
 *
 * Maps to URL prefixes:
 *   - `convert`        → `/convert/[from]-to-[to]`
 *   - `compress`       → `/compress/[format]` and `/compress/[format]-under-[size]`
 *   - `extract-audio`  → `/extract-audio/[from]-to-[to]`
 *   - `extract-frames` → `/extract-frames/[format]`
 *   - `trim`           → `/trim/[format]`
 *   - `resize`         → `/resize/[format]` (and resolution-targeted variants)
 *   - `rotate`         → `/rotate/[format]`
 *   - `gif`            → `/gif/[from]-to-gif`
 *   - `merge`          → `/merge/[format]`
 *   - `mute`           → `/mute/[format]`
 *   - `change-speed`   → `/change-speed/[format]`
 *   - `add-subtitles`  → `/add-subtitles/[format]`
 *   - `remove-audio`   → `/remove-audio/[format]`
 *   - `reverse`        → `/reverse/[format]`
 *   - `thumbnail`      → `/thumbnail/[format]` (single-frame grab)
 *   - `contact-sheet`  → `/contact-sheet/[format]` (NxM grid)
 *   - `normalize-audio`→ `/normalize-audio/[format]`
 *   - `image-convert`  → `/image-convert/[from]-to-[to]` (e.g. heic-to-jpg)
 */
export type Operation =
  | 'convert'
  | 'compress'
  | 'extract-audio'
  | 'extract-frames'
  | 'trim'
  | 'resize'
  | 'rotate'
  | 'gif'
  | 'merge'
  | 'mute'
  | 'change-speed'
  | 'add-subtitles'
  | 'remove-audio'
  | 'reverse'
  | 'thumbnail'
  | 'contact-sheet'
  | 'normalize-audio'
  | 'image-convert';

/**
 * File format taxonomy. Grouped by media kind for validation.
 *
 * Adding a new format here is *almost* free — the `KIND_OF` map below must be
 * updated in the same commit so validation knows which media kind it belongs to.
 */
export type VideoFormat =
  | 'mp4'
  | 'mov'
  | 'webm'
  | 'mkv'
  | 'avi'
  | 'flv'
  | 'wmv'
  | 'm4v'
  | 'mpeg'
  | '3gp'
  | 'ts'
  | 'mts'
  | 'm2ts'
  | 'ogv'
  | 'vob';

export type AudioFormat =
  | 'mp3'
  | 'wav'
  | 'flac'
  | 'aac'
  | 'ogg'
  | 'm4a'
  | 'opus';

export type ImageFormat =
  | 'jpg'
  | 'png'
  | 'webp'
  | 'avif'
  | 'heic'
  | 'gif-static';

export type AnimatedImageFormat = 'gif' | 'webp-anim' | 'apng';

export type Format =
  | VideoFormat
  | AudioFormat
  | ImageFormat
  | AnimatedImageFormat;

export type MediaKind = 'video' | 'audio' | 'image' | 'animated-image';

/**
 * Reverse map: which kind is each format. Used by validation to reject
 * nonsensical combinations like `mp3-to-mov` (audio → video, no source video stream).
 */
export const KIND_OF: Record<Format, MediaKind> = {
  // video
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  flv: 'video',
  wmv: 'video',
  m4v: 'video',
  mpeg: 'video',
  '3gp': 'video',
  ts: 'video',
  mts: 'video',
  m2ts: 'video',
  ogv: 'video',
  vob: 'video',
  // audio
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  aac: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  opus: 'audio',
  // image
  jpg: 'image',
  png: 'image',
  webp: 'image',
  avif: 'image',
  heic: 'image',
  'gif-static': 'image',
  // animated image
  gif: 'animated-image',
  'webp-anim': 'animated-image',
  apng: 'animated-image',
};

/**
 * Search-intent volume bucket. Drives priority and internal-link strategy
 * during pSEO page generation.
 *
 * - `head`: 10k+ searches/mo (e.g. `mov to mp4`)
 * - `mid`:  ~500–10k searches/mo (e.g. `mkv to webm`)
 * - `tail`: long-tail (e.g. `mp4 under 8mb for old discord`)
 */
export type IntentVolume = 'head' | 'mid' | 'tail';

/**
 * Stable identifier for a Go backend op as registered in `ops.go`. Kept as a
 * string union (not just `string`) so adding a row that targets a non-existent
 * op fails type-checking.
 */
export type GoOpName =
  // video
  | 'transcode'
  | 'transcode_webm'
  | 'transcode_mkv'
  | 'resize'
  | 'h264_to_h265'
  | 'change_framerate'
  | 'change_bitrate'
  | 'trim'
  | 'concat'
  | 'watermark'
  | 'thumbnail'
  | 'contact_sheet'
  | 'speed'
  | 'reverse'
  | 'crop'
  | 'rotate'
  | 'flip'
  | 'loop'
  | 'subtitles_burn'
  | 'subtitles_soft'
  | 'pad_aspect'
  | 'timelapse'
  // audio
  | 'audio_mp3'
  | 'audio_opus'
  | 'audio_ogg'
  | 'audio_aac'
  | 'audio_flac'
  | 'extract_audio'
  | 'normalize_audio'
  | 'audio_trim'
  | 'audio_fade'
  | 'audio_concat'
  | 'stereo_to_mono'
  | 'audio_bitrate'
  | 'time_stretch'
  | 'pitch_shift'
  | 'spectrogram'
  | 'waveform_png'
  // image
  | 'image_resize'
  | 'image_to_jpg'
  | 'image_to_png'
  | 'image_to_webp'
  | 'image_to_avif'
  | 'gif_from_video'
  | 'gif_from_images'
  | 'blur'
  | 'sharpen'
  | 'grayscale'
  // special
  | 'youtube_preview'
  | 'meme_overlay'
  | 'silence_trim';

/**
 * Optional preset hints. Drive both default UI state (CRF slider position,
 * pre-filled bitrate, etc.) and the pSEO `/compress/[format]-under-[size]`
 * long-tail variants.
 */
export interface OperationPreset {
  /** Constant Rate Factor — for libx264/libx265/libvpx-vp9. Lower = better quality. */
  crf?: number;
  /** ffmpeg `-preset` value (`ultrafast`/`fast`/`medium`/`slow`). */
  preset?:
    | 'ultrafast'
    | 'superfast'
    | 'veryfast'
    | 'faster'
    | 'fast'
    | 'medium'
    | 'slow'
    | 'slower'
    | 'veryslow';
  /** Target output size in MB. Drives bitrate-targeted compress URLs. */
  targetSizeMb?: number;
  /** Target resolution e.g. `1080p`, `720p`, `480p`. */
  resolution?: '480p' | '720p' | '1080p' | '1440p' | '2160p';
  /** Frames-per-second override. Used by gif/preview ops. */
  fps?: number;
  /** Audio bitrate (`64k`, `128k`, `192k`). */
  audioBitrate?: string;
}

/**
 * One frequently-asked question + answer pair, rendered into a `FAQPage`
 * schema.org block plus visible HTML.
 */
export interface FAQ {
  q: string;
  a: string;
}

/**
 * One row of the operations matrix. Each row represents a *family* of pSEO
 * pages — typically one row per (operation, output format) pair, with the
 * `inputFormats` array driving the cartesian explosion into individual pages.
 *
 * Phase 1 renders the first row (`mov-to-mp4`) end-to-end. Phase 2 generates
 * 200+ pages from the same data.
 */
export interface OperationRow {
  /**
   * Canonical URL slug fragment. For `convert`/`extract-audio`/`gif` this is
   * `[from]-to-[to]`; for single-format ops (`compress`, `trim`) this is just
   * the format. For long-tail variants (`mp4-under-25mb`) the preset's
   * `targetSizeMb` is appended.
   */
  slug: string;

  /** High-level operation. Drives URL prefix and page template. */
  operation: Operation;

  /**
   * Accepted input formats. Page generation creates one URL per (input × output)
   * pair where the combination passes validation.
   */
  inputFormats: Format[];

  /** Single output format. Multi-output ops get one row per output. */
  outputFormat: Format;

  /** Stable Go backend op identifier — must exist in `ops.go::RegisterOps`. */
  goOp: GoOpName;

  /**
   * Page <title> tag. Convention: `[H1] — free, no watermark`. Kept short
   * enough to not get truncated in SERPs (~60 chars).
   */
  title: string;

  /** Page <h1>. Convention: `[FROM] to [TO]` or operation-noun. */
  h1: string;

  /** One-sentence value prop rendered directly under the H1. */
  valueProp: string;

  /**
   * Equivalent `ffmpeg -i ... output.X` command string shown on the result
   * page with a copy-button. The dev-funnel hook from spec §2.
   */
  ffmpegCommand: string;

  /** Search-intent volume bucket. Used to prioritise generation order. */
  intentVolume: IntentVolume;

  /** 4–6 FAQs rendered as visible HTML + `FAQPage` schema. */
  faqs: FAQ[];

  /**
   * Slug fragments of related pages for the "siblings" link block (spec §7.2
   * requires ≥3 internal links per page).
   */
  related: string[];

  /** Optional preset hints. */
  preset?: OperationPreset;

  /**
   * Marks rows that appear in the homepage 12-flagship pill row (per
   * `docs/STRATEGY.md`). At most 12 rows should set this.
   */
  flagship?: {
    /** Position 1-12 in the flagship grid (one row of six on desktop, 2x6 tablet, 3x4 phone). */
    rank: number;
    /** Short button label as it appears on the homepage pill. */
    label: string;
  };

  /**
   * SEAN-60: Optional ~60-100 word "When to use this" paragraph rendered
   * directly under the converter panel. Hand-tuned for flagship/head rows;
   * tail rows fall back to a per-operation default in `./copy.ts` that is
   * varied by row metadata (formats, codecs, op type) so no two pages get
   * identical body copy — Google's duplicate-content filter is unforgiving
   * for thin templated pages.
   */
  whenToUse?: string;

  /**
   * SEAN-60: Optional list of common pitfalls — same Q&A shape as `faqs`
   * but rendered in a separate "Watch out for" section. Hand-tuned content
   * for flagship rows; tail rows fall back to per-op defaults.
   */
  commonPitfalls?: FAQ[];

  /**
   * SEAN-60: Optional ~80-150 word extension to the "How it works" block
   * with format/codec-specific detail (e.g. palette quantisation for GIF
   * pages, codec-copy semantics for compatible video pairs). Falls back
   * to a per-operation default if absent.
   */
  extendedHowItWorks?: string;
}

/**
 * Validation error returned by `validateRow`. Carries enough detail for the
 * page generator to log + skip without throwing.
 */
export interface ValidationError {
  slug: string;
  reason: string;
}

/**
 * Returns the cartesian list of (input, output) pairs for a row, filtered to
 * those that pass `isValidCombo`. Page generation iterates this.
 */
export interface ResolvedPage {
  slug: string;
  inputFormat: Format;
  outputFormat: Format;
  row: OperationRow;
}
