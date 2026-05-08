/**
 * SEAN-60 — per-page unique body copy.
 *
 * Generates `whenToUse`, `commonPitfalls`, and `extendedHowItWorks` content
 * for any matrix row that doesn't ship hand-tuned versions. The design
 * constraint is **uniqueness**: Google's duplicate-content filter penalises
 * thin templated pages, so two pages must never share a paragraph verbatim.
 *
 * Strategy: every fallback paragraph is composed from row metadata —
 * `from` / `to` formats, op kind, codec hints — so the resulting prose
 * differs across the matrix even though the template is shared. A `mp4-to-gif`
 * page talks about palette quantisation; a `mov-to-mp4` page talks about
 * iPhone codec compatibility; a `compress-mkv` page talks about Matroska
 * containers. No spun filler — every sentence references a property the
 * specific (op, from, to) tuple actually has.
 *
 * The page template (`<ToolPage>`) calls `resolvePageCopy(row, page)` to get
 * the final {whenToUse, commonPitfalls, extendedHowItWorks} object — using
 * row overrides where present and these defaults otherwise.
 */

import type { FAQ, Format, OperationRow, ResolvedPage } from './types';
import { KIND_OF } from './types';

// ─────────────────────────────────────────────────────── FORMAT FACTS ────────

/**
 * Per-format flavour text. One short clause that describes a load-bearing
 * fact about the format — used to vary `whenToUse` and pitfall copy across
 * pages so no two share a paragraph.
 */
const FORMAT_NOTES: Record<Format, string> = {
  // video
  mp4: 'the universal H.264/AAC container that plays on iOS, Android, web, and every editor',
  mov: 'the QuickTime container iPhones record into and Final Cut/Premiere prefer',
  webm: 'the open VP9/Opus container that ships natively in every modern browser',
  mkv: 'the Matroska container that bundles multiple audio tracks and subtitles in one file',
  avi: 'the legacy Microsoft container many camcorders and screen recorders still emit',
  flv: 'the Flash Video container that survives in old screen recordings and downloads',
  wmv: 'the Windows Media container Windows 7-era Movie Maker exports',
  m4v: 'the iTunes/Apple variant of MP4 with optional FairPlay DRM',
  mpeg: 'the original MPEG-1/2 container for DVDs and broadcast captures',
  '3gp':
    'the legacy mobile container older feature phones and dashcams record into',
  ts: 'the MPEG-TS broadcast stream OBS, ATSC tuners, and DVRs save',
  mts: 'the AVCHD camcorder format Sony, Panasonic, and Canon record into',
  m2ts: 'the Blu-ray variant of AVCHD that holds longer runtimes per file',
  ogv: 'the Theora/Vorbis container that predates WebM in the open-codec lineage',
  vob: 'the DVD-Video object container ripped from physical discs',
  // audio
  mp3: 'the universal lossy audio format every device on Earth plays',
  wav: 'the uncompressed PCM container editors prefer for further processing',
  flac: 'the open lossless format that halves WAV size with no quality loss',
  aac: 'the more efficient successor to MP3 that Apple ecosystems default to',
  ogg: 'the open Vorbis/Opus container many open-source players default to',
  m4a: 'the AAC-in-MP4 container iTunes and iPhone Voice Memos write',
  opus: 'the modern low-latency codec built for streaming and voice chat',
  // image
  jpg: 'the universal lossy photo format that opens everywhere',
  png: 'the lossless format with alpha transparency screenshots and logos use',
  webp: 'the modern web format that beats JPG and PNG at the same quality',
  avif: 'the AV1-based image format with the best compression of any web image',
  heic: 'the HEVC-based image format iPhones default to since iOS 11',
  'gif-static': 'a GIF reduced to a single frame',
  // animated image
  gif: 'the 256-colour animated format Slack, Discord, and Twitter accept inline',
  'webp-anim': 'the modern animated alternative to GIF with full-colour frames',
  apng: 'animated PNG, the lossless cousin of GIF Firefox shipped first',
};

/**
 * Per-format common pitfall — short, specific, and load-bearing. These get
 * rotated into the pitfall block so the body copy diverges between pages.
 */
const FORMAT_PITFALLS: Partial<Record<Format, FAQ>> = {
  mov: {
    q: 'My MOV came out of an iPhone — does that change anything?',
    a: 'iPhone MOVs use HEVC (H.265) by default since iOS 11. Older Windows builds, Discord previews, and some web players choke on HEVC — convert to MP4 (H.264) to fix it.',
  },
  mkv: {
    q: 'Why does my MKV have multiple audio tracks?',
    a: 'Matroska bundles every track in the source file. We keep the first audio track by default. If your MKV has a director commentary or a 5.1 track you want to preserve, drop a note in the advanced panel.',
  },
  webm: {
    q: 'WebM looks blocky compared to my MP4 source — why?',
    a: 'VP9 takes longer to compress well than H.264. Our default uses realtime VP9 to keep the request fast. Expect slightly chunkier blocks on flat backgrounds — bump quality if you have time.',
  },
  flv: {
    q: 'Where did my FLV come from?',
    a: 'Almost certainly an old screen recording or a saved Flash video. The container survives but the codecs (Sorenson, VP6) are dead. We re-encode to H.264 so the result plays on modern devices.',
  },
  wmv: {
    q: 'Does WMV preserve metadata?',
    a: 'Mostly. ASF/WMV-specific tags drop when we re-encode. Standard EXIF-style timestamps and GPS data ride through fine.',
  },
  '3gp': {
    q: 'My 3GP looks low-resolution — can I upscale?',
    a: 'No magic — 3GP was designed for sub-VGA mobile screens. We preserve the source resolution so the output looks the same. AI upscaling is a separate tool.',
  },
  ts: {
    q: 'My TS is from OBS / a DVR — does that matter?',
    a: 'MPEG-TS streams sometimes have non-monotonic timestamps from where the recorder dropped frames. We re-mux into a clean container so seek bars and editors stop misbehaving.',
  },
  mts: {
    q: 'My MTS came off an AVCHD camcorder — anything to know?',
    a: 'AVCHD splits long recordings across multiple .mts files. Convert each one then concatenate — or merge first if you want one continuous output.',
  },
  m2ts: {
    q: 'M2TS from a Blu-ray rip — am I going to hit DRM?',
    a: 'Only if the source disc was AACS-protected and you ripped without decryption. We never strip DRM. If your file plays in VLC, conversion will work.',
  },
  vob: {
    q: 'Why do my VOBs come in pairs (VTS_01_1.VOB, VTS_01_2.VOB)?',
    a: 'DVD-Video splits 1 GB chunks across multiple VOBs. Concatenate them first, or upload the IFO and let the merge tool stitch in order.',
  },
  ogv: {
    q: 'Does OGV play in browsers anymore?',
    a: 'Theora was deprecated in favour of WebM/VP9 around 2013. Most browsers still play OGV for legacy reasons, but new content should target WebM or MP4.',
  },
  heic: {
    q: 'Why is my HEIC opening as a single frame?',
    a: 'iPhone Live Photos store the still frame as HEIC plus a separate MOV. We convert just the still — extract the MOV separately if you need the motion.',
  },
  avif: {
    q: 'Will the AVIF play on Safari < 16?',
    a: 'No — Safari shipped AVIF in version 16 (2022). Older iPhones and Macs need a JPG fallback. Use the image-to-jpg tool for compatibility.',
  },
};

// ─────────────────────────────────────────────────────── HELPERS ─────────────

/**
 * Map Format to extension as it appears in URLs and on disk. Matches
 * `extOf` in `ToolPage.tsx`.
 */
function extOf(format: Format): string {
  if (format === 'gif-static') return 'gif';
  if (format === 'webp-anim') return 'webp';
  return format;
}

function upper(format: Format): string {
  return extOf(format).toUpperCase();
}

/**
 * Best-guess input format for content variation. For multi-input rows we
 * pick the resolved page's actual input format; falls back to the first
 * declared input.
 */
function pickInput(row: OperationRow, page?: ResolvedPage): Format {
  if (page) return page.inputFormat;
  return row.inputFormats[0] ?? row.outputFormat;
}

// ─────────────────────────────────────────────────────── WHEN TO USE ─────────

function whenToUseDefault(row: OperationRow, page?: ResolvedPage): string {
  const op = row.operation;
  const to = row.outputFormat;
  const from = pickInput(row, page);
  const fromU = upper(from);
  const toU = upper(to);
  const fromNote = FORMAT_NOTES[from];
  const toNote = FORMAT_NOTES[to];

  switch (op) {
    case 'convert':
      return `Reach for ${fromU} to ${toU} when your source is ${fromNote} and your target is ${toNote}. Common cases: a player or platform that flat-out refuses ${fromU}, an editor that imports ${toU} more cleanly, a CDN that prefers ${toU} for delivery, or a workflow that has settled on ${toU} as its house format. The conversion takes a few seconds for short clips and scales roughly linearly with duration and resolution; expect identical-looking playback aside from the codec change. Subtitles, chapter markers, and metadata flags survive when the target container supports them — drop the file and the result lands in your downloads folder ready to use.`;
    case 'compress': {
      const target = row.preset?.targetSizeMb;
      const lead = target
        ? `Compress ${fromU} under ${target} MB when you've got a hard upload cap to clear`
        : `Compress ${fromU} when the file is too large for the destination`;
      const targetCases = target
        ? target <= 8
          ? `the legacy 8 MB Discord limit, an old forum attachment cap, or a phpBB upload that hasn't been touched since 2010`
          : target <= 25
            ? `Discord's free-tier cap, a Gmail attachment limit, or a Slack free-workspace upload`
            : target <= 100
              ? `a Slack paid-tier upload, an Outlook-with-OneDrive attachment, or a CMS that softlocks at 100 MB`
              : `a Pro-tier platform cap or an internal storage budget`
        : `Discord, email, a CMS, your phone's storage`;
      return `${lead} — ${targetCases}. The default settings target around half the original size with imperceptible quality loss, which is the right trade for sharing. ${target ? `For this preset the encoder computes a bitrate from your clip duration that lands just under ${target} MB, then encodes with libx264 at the slow preset for the best quality at that budget.` : `Pick a size-targeted preset (under 8 MB, 25 MB, or 100 MB) when you have a hard cap to clear, and the encoder picks a bitrate that lands just under it.`} The container, codec, and stream layout stay the same — only the bitrate budget changes — so the result drops into any pipeline that expected the original.`;
    }
    case 'extract-audio': {
      const flavour =
        to === 'mp3' || to === 'aac' || to === 'opus'
          ? 'sharing and streaming'
          : to === 'wav' || to === 'flac'
            ? 'editing, transcription, and archival'
            : 'further processing';
      return `Pull ${toU} out of a ${fromU} when you want the soundtrack on its own — a podcast cut, a transcript run, a music sample, a voice memo, dialogue isolated for a remix. ${toU} is ${toNote}, so it suits ${flavour}. The video stream is discarded with -vn and the audio is re-encoded with sensible defaults: ${to === 'mp3' || to === 'aac' ? '192 kbps for a clean balance of size and fidelity' : to === 'wav' ? 'lossless 16-bit PCM for editor-friendly output' : to === 'flac' ? 'lossless compression that halves WAV size' : to === 'opus' ? '128 kbps Opus for streaming-grade efficiency' : 'codec-appropriate quality settings'}. Channel layout (stereo, mono, 5.1) and sample rate ride through unchanged unless you override them.`;
    }
    case 'gif':
      return `Make a GIF from a ${fromU} when you need an inline animation that plays everywhere without a player — Slack, Discord, Twitter, GitHub README files, blog posts, Stack Overflow answers, internal wikis. GIF carries no audio and tops out at 256 colours per palette, so it suits short, low-detail loops more than full-fidelity clips. We default to 10 FPS at 480 px wide, which preserves readable motion at a manageable file size; expect the GIF to weigh 5-10x the source ${fromU} since GIF has no inter-frame compression. For longer animations or higher fidelity, animated WebP or a hosted MP4 usually wins on size and looks cleaner on flat backgrounds.`;
    case 'image-convert':
      return `Convert ${fromU} to ${toU} when the destination doesn't accept ${fromU} or the bytes are too heavy for the budget. ${toU} is ${toNote}; ${fromU} is ${fromNote}. Common cases: a CMS that rejects ${fromU} on upload, a colleague's email client that previews ${toU} but not ${fromU}, a website that wants ${toU} for the bandwidth saving, or a print job that needs the format the printer expects. Output quality is set high enough that a side-by-side comparison at normal viewing distance looks identical to the source — drop into the advanced panel if you want to push the quality dial up or down.`;
    case 'trim':
      return `Trim a ${fromU} when only a slice of the file matters — a meme moment buried inside a longer clip, a sound bite for a podcast, a five-second loop for a social post, a highlight reel for sharing. We re-encode for frame-accuracy by default so the cut lands exactly where you set the in and out points; flip to stream-copy in the advanced panel for instant cuts at the nearest keyframe (within ~10 seconds of your mark, but no encoding time). For longer clips or batch editing, render in your editor of choice and drop the output here only if the destination needs a different format.`;
    case 'resize':
      return `Resize a ${fromU} when the destination expects a specific resolution — a 1080p Twitter cap, a 720p portfolio embed, a 480p mobile preview, a Reels/Shorts portrait crop. Aspect ratio is preserved by default so the picture isn't squashed; use pad-to-aspect if you need exact dimensions with letterbox or pillarbox bars filled in black. We use the lanczos scaler which holds detail better than the default bilinear filter most tools ship with, at the cost of a slightly slower encode. Audio rides through untouched — resize only re-encodes the video stream.`;
    case 'thumbnail':
      return `Grab a thumbnail from a ${fromU} when you need a still for a blog header, a video card on social, a CMS preview slot, an email teaser, or a YouTube custom thumbnail. We pull a single frame at the timestamp you pick and encode it as JPG by default — PNG and WebP outputs sit in the advanced panel when you need transparency or smaller bytes. Pick a timestamp at least one second past the start of the clip so a fade-in or black frame doesn't land in your thumbnail; use the contact-sheet tool first if you want to scan the file for a clean moment before grabbing the still.`;
    case 'contact-sheet':
      return `Build a contact sheet from a ${fromU} when you want to scan a long clip at a glance — finding the moment for a thumbnail, previewing a stock-footage library, checking a screen recording end-to-end, picking the cleanest frame for a press kit. Frames are sampled at even intervals across the entire runtime and tiled into a single JPG grid; the default 3x3 layout works for clips up to a few minutes, but bump to 5x5 or 6x6 for hour-long recordings so each tile represents a meaningfully different moment. Output is one image you can drop straight into a doc or share via screenshot.`;
    case 'normalize-audio':
      return `Normalise a ${fromU} when the source loudness drifts — a podcast guest who recorded too quietly relative to the host, a music track that clips a louder one in the same playlist, a voice memo at half the volume of the rest of your library. Loudness normalisation matches *perceived* volume across the whole track using EBU R128 (the same standard Spotify, YouTube, and BBC broadcast use), not just peak amplitude. The result lands at -16 LUFS by default — ideal for podcasts and dialogue. Bump to -23 LUFS for music or broadcast, or -14 LUFS for streaming-style "loud" master.`;
    case 'rotate':
      return `Rotate a ${fromU} when the source orientation is wrong — sideways phone footage taken in landscape, a 180° dashcam clip mounted upside down, an upside-down screen recording from a flipped monitor, a 90° clip that needs to be portrait. Re-encoding bakes the rotation into the pixels so every player respects it, not just the ones that read the rotation metadata flag. iPhone, modern Premiere, and most browsers honour the flag; older Windows builds, web preview thumbnails, and many social platforms ignore it — physically rotating the pixels guarantees consistent display everywhere.`;
    case 'merge':
      return `Merge multiple ${fromU} files when a source recording was split — AVCHD camcorders cap files at 4 GB and chunk into MTS segments, dashcams break long drives into one-minute or five-minute clips, screen recorders split sessions to keep file sizes manageable, action cameras divide footage by capture-card limit. Concatenation joins them end-to-end with no re-encoding when codecs match, which is the common case for files from the same camera. Mismatched codecs require a re-encode — slower but produces a single clean output instead of a stitched-together file with brief discontinuities.`;
    case 'mute':
    case 'remove-audio':
      return `Strip the audio from a ${fromU} when you only need the visual — a silent loop for a presentation, a meme template waiting for new audio, a clip you'll re-narrate over, a video for a sound-sensitive context like an office or a hospital waiting room. The video stream rides through untouched (no quality loss); only the audio track gets dropped. The result is a smaller file with the same picture quality, ready for a sound-off platform or a fresh soundtrack.`;
    case 'change-speed':
      return `Speed up or slow down a ${fromU} when timing matters — a tutorial that drags at real-time, a slow-motion shot you want at half-speed for emphasis, a long meeting recording compressed to fit a time slot, a comedic ramp from normal to chipmunk fast. We adjust both video and audio so pitch stays natural up to 2x; faster than that the audio starts to compress noticeably. The video frame rate stays constant — only the duration changes — so editors and players handle the result without complaint.`;
    case 'add-subtitles':
      return `Burn or attach subtitles to a ${fromU} for accessibility, ESL audiences, sound-off social platforms (TikTok, Instagram Reels, LinkedIn), or international distribution. Soft subs ride alongside the video as a separate track and can be toggled by the viewer; hard subs render directly into the pixels and survive every player and every platform that strips track metadata. For social media, hard subs are typically the safer pick — most platforms don't expose the soft-subs toggle even when the file carries one.`;
    case 'reverse':
      return `Reverse a ${fromU} when the gag or the visual depends on it — a meme reversal, an unboxing-in-reverse, a magic-trick reveal where the punchline is the setup, a "putting things back together" cut for a workshop video. Audio reverses with the video by default, which produces the eerie backwards-speech effect most viewers expect; mute first if you want the reversed visual with a clean (or new) soundtrack laid over the top.`;
    case 'extract-frames':
      return `Extract frames from a ${fromU} when you need stills — a key-moment screenshot, a frame-by-frame breakdown for a tutorial, training data for a vision model, raw frames to colour-grade or edit before reassembling. We sample at the FPS you pick and write each frame as a numbered file (frame_001.jpg, frame_002.jpg, …) so the order is preserved for reassembly. Drop the FPS to 1 for one-frame-per-second output, or match the source FPS for full frame extraction.`;
  }
}

// ─────────────────────────────────────────────────────── PITFALLS ────────────

function commonPitfallsDefault(row: OperationRow, page?: ResolvedPage): FAQ[] {
  const op = row.operation;
  const to = row.outputFormat;
  const from = pickInput(row, page);
  const fromU = upper(from);
  const toU = upper(to);
  const out: FAQ[] = [];

  // Format-specific pitfall (input side) — only included when we have one
  // recorded for that format.
  const inputPitfall = FORMAT_PITFALLS[from];
  if (inputPitfall) out.push(inputPitfall);

  // Op-specific pitfalls — every row gets at least one.
  switch (op) {
    case 'convert':
      out.push({
        q: `Will the converted ${toU} match the source bit-for-bit?`,
        a: `No conversion is bit-for-bit unless the codec already matches the target container. Re-encoding pays a perceptual cost — ours stays inside the "you can't tell at typical viewing distance" envelope. For lossless workflows, render to the target codec from your editor.`,
      });
      out.push({
        q: `Why is my ${toU} bigger than the ${fromU}?`,
        a: `Different codecs compress different content shapes well. ${toU} can run larger than ${fromU} on flat-coloured clips or short loops. Use the compress tool with a target size if file size is the constraint.`,
      });
      break;
    case 'compress':
      out.push({
        q: `My compressed ${fromU} looks fine on my laptop but blocky on TV — why?`,
        a: `Big screens reveal compression artefacts that small screens hide. If the destination is a TV or projector, drop the CRF to 22 (or pick a higher target size) and re-run.`,
      });
      out.push({
        q: `Audio dropouts in the compressed file?`,
        a: `Default audio bitrate scales with the size target. The under-8 MB preset uses 64 kbps which can artefact on music. Use under-25 MB or higher when the audio matters.`,
      });
      break;
    case 'extract-audio':
      out.push({
        q: `The extracted ${toU} has clicks at chapter boundaries — why?`,
        a: `Some video sources splice multiple recordings together with brief gaps. The audio still extracts cleanly, but the gaps survive. Use the trim tool to clip them out, or normalise the result.`,
      });
      out.push({
        q: `Can I keep multiple audio languages?`,
        a: `Not in the default flow — we extract the first audio track. Files with multiple language tracks need the advanced panel; pick the track index before converting.`,
      });
      break;
    case 'gif':
      out.push({
        q: `My GIF is huge — way bigger than the source ${fromU}.`,
        a: `Expected. GIF has no inter-frame compression, so a 5-second clip can balloon 5-10x. Drop the FPS to 8 or width to 320 px in the advanced panel, or switch to animated WebP if the destination accepts it.`,
      });
      out.push({
        q: `Why does my GIF look posterised on flat backgrounds?`,
        a: `GIF tops out at 256 colours per palette. Our palettegen picks the optimal 256 for your clip, but gradients and skin tones still band. Animated WebP or a video tag handles those better.`,
      });
      break;
    case 'image-convert':
      out.push({
        q: `Does ${toU} preserve transparency from my ${fromU}?`,
        a:
          to === 'jpg'
            ? `No — JPG has no alpha channel. Transparent pixels render as white. Use PNG or WebP if you need transparency.`
            : `Yes. ${toU} carries an alpha channel, so transparency rides through unchanged.`,
      });
      out.push({
        q: `Will EXIF / camera metadata survive?`,
        a: `Yes by default. Use the strip-metadata option in the advanced panel if you're publishing the image and want to drop GPS, camera serial, or capture timestamp.`,
      });
      break;
    case 'trim':
      out.push({
        q: `My trimmed clip starts a few frames late — why?`,
        a: `Stream-copy mode (the fast option) snaps to the nearest keyframe before your start point. For frame-exact cuts, leave re-encode mode on (the default).`,
      });
      out.push({
        q: `The trimmed file plays past where I cut — what's happening?`,
        a: `Some browsers cache the original file's metadata. Hard-refresh (Cmd+Shift+R / Ctrl+F5) to play the trimmed version, or download and play locally.`,
      });
      break;
    case 'resize':
      out.push({
        q: `My resized ${fromU} looks soft — why?`,
        a: `Downscaling without sharpening always softens slightly. Bump the sharpness in the advanced panel by 10-20%, or render at 2x your target and let the destination resize.`,
      });
      out.push({
        q: `Pixel dimensions don't match what I asked for.`,
        a: `Some codecs require even dimensions. We round to the nearest even pair (e.g. 1080 → 1080, but 539 → 540). The aspect ratio is preserved; the off-by-one rounding is expected.`,
      });
      break;
    case 'thumbnail':
      out.push({
        q: `I picked timestamp 0:00:01 but got a black frame.`,
        a: `Many videos start with a fade-from-black. Bump to 0:00:02 or pick a timestamp inside the action. Use the contact-sheet tool to scan the file and find a good moment.`,
      });
      break;
    case 'contact-sheet':
      out.push({
        q: `Some tiles are blurry — why?`,
        a: `Sampled frames sometimes land on motion blur or transition cuts. Increase the grid size (5x5 instead of 3x3) so a clean frame lands in every cell.`,
      });
      break;
    case 'normalize-audio':
      out.push({
        q: `My normalised ${fromU} sounds crushed.`,
        a: `EBU R128 with a -16 LUFS target is loud. Drop to -23 LUFS (broadcast standard) for music; stay at -16 for voice and podcasts.`,
      });
      break;
    case 'rotate':
      out.push({
        q: `The rotated video plays correctly on iPhone but sideways on Windows.`,
        a: `That's the rotation-flag problem this tool exists to solve. iPhone reads the flag; older Windows builds ignore it. Re-encoding bakes the rotation into the pixels so every player respects it.`,
      });
      break;
    case 'merge':
      out.push({
        q: `Merged file has a black flash between segments.`,
        a: `Codec parameters differed slightly between segments — different framerate, resolution, or profile. Either re-encode the inputs to a common spec first, or accept the brief discontinuity.`,
      });
      break;
    case 'change-speed':
      out.push({
        q: `Sped-up audio sounds chipmunked.`,
        a: `Default mode preserves audio pitch with the atempo filter. If you want the chipmunk effect, disable pitch preservation in the advanced panel.`,
      });
      break;
    default:
      out.push({
        q: `Will the result still play on every device?`,
        a: `Yes — output is a standard ${toU} container with widely-supported codecs. We don't ship niche profiles that only some players read.`,
      });
  }

  return out;
}

// ─────────────────────────────────────────────────────── EXTENDED HOW IT WORKS

function extendedHowItWorksDefault(
  row: OperationRow,
  page?: ResolvedPage,
): string {
  const op = row.operation;
  const to = row.outputFormat;
  const from = pickInput(row, page);
  const fromU = upper(from);
  const toU = upper(to);
  const fromKind = KIND_OF[from];

  switch (op) {
    case 'convert':
      if (fromKind === 'audio') {
        return `Audio-only conversions skip the video pipeline entirely. We decode the ${fromU} bitstream to PCM in memory, run any requested processing (loudness normalisation, sample-rate conversion, channel re-mapping), then re-encode to ${toU} with a sensible bitrate for the codec. The result writes to a fresh container with a clean header — sample rate, channel layout, and ID3-style tags are preserved unless you override them in the advanced panel. For lossless inputs like WAV or FLAC, conversion to another lossless target (FLAC ↔ WAV) is bit-perfect on the audio data; only the container and metadata layout change.`;
      }
      return `The encoder reads your ${fromU} container, demuxes the video and audio streams, and re-encodes each into the ${toU} container's expected codec — typically H.264 + AAC for MP4, VP9 + Opus for WebM, H.264 + AAC for MOV with QuickTime-friendly atoms ordered for fast-start playback. Stream order, language tags, and timing metadata ride through. Subtitles attached to the source survive only if the target container supports them; MP4 and MKV do, WebM partially. Default settings prioritise compatibility over file size — drop into compress afterwards if the output is too heavy for the destination.`;
    case 'compress': {
      const target = row.preset?.targetSizeMb;
      if (target) {
        return `The size-targeted compress pipeline runs in two passes. Pass one analyses the source ${fromU} to measure its duration; pass two computes a target bitrate (size-in-bits ÷ duration) that lands just under ${target} MB, then encodes with libx264 at the slow preset for the best quality at that budget. Audio is re-encoded to AAC at ${target <= 8 ? '64 kbps' : target <= 25 ? '96 kbps' : '128 kbps'} — enough for clear voice but tight enough to leave bitrate budget for the picture. The result is the same H.264 + AAC in MP4 you'd get from any standard encode, just bandwidth-limited to fit the cap.`;
      }
      return `Compression runs the source ${fromU} through libx264 at a higher CRF (28 by default — visibly identical to most viewers, half the bytes). Audio is re-encoded to AAC at a bitrate sized to your target. The container, codec family, and stream layout stay the same — only the bitrate budget changes — so the result drops into any pipeline that expected the original ${fromU}. The slow preset gives the encoder more time to find efficient motion vectors and quantisation choices, which is why the output looks better than a fast-encoded same-size clip.`;
    }
    case 'extract-audio':
      return `The video pipeline is bypassed entirely with -vn (no video). We decode the ${fromU} audio track to PCM, optionally pre-process (resample, downmix), then re-encode to ${toU} with a bitrate appropriate for the codec — ${to === 'mp3' ? '192 kbps libmp3lame' : to === 'aac' ? '192 kbps native AAC encoder' : to === 'wav' ? 'lossless 16-bit PCM' : to === 'flac' ? 'native FLAC at default compression level 5' : to === 'opus' ? '128 kbps libopus' : to === 'ogg' ? '~160 kbps Vorbis at quality 5' : 'codec-appropriate quality'}. Sample rate and channel layout are preserved from the source unless your destination needs a specific shape (16 kHz mono for transcription, 48 kHz stereo for streaming). The output is a fresh ${toU} file with a clean header and no traces of the source video container.`;
    case 'gif':
      return `GIF encoding is a two-pass palette operation. Pass one runs ffmpeg's palettegen filter over your ${fromU} to pick the optimal 256 colours for that specific clip — sampling every frame so the chosen palette covers the full colour range, not just the first few seconds. Pass two encodes each frame using paletteuse with Floyd-Steinberg dithering, which scatters quantisation error across neighbouring pixels so flat regions don't band visibly. We default to 10 FPS at 480 px wide, which keeps GIF size manageable while preserving readable motion. Increase FPS for smoother motion or width for more detail — both inflate file size linearly with the parameter.`;
    case 'image-convert':
      return `Single-frame image conversion decodes the ${fromU} bitstream into a raw bitmap, applies any colour-space adjustments the target needs (HEIC and AVIF are typically captured in Rec. 2020 P3; JPG and WebP get converted to web-safe sRGB), then re-encodes at the quality level you pick. Alpha channels survive when the destination supports them; ${to === 'jpg' ? 'JPG flattens transparency to white since the format has no alpha channel' : `${toU} preserves the alpha channel intact`}. EXIF metadata (camera model, capture time, GPS) rides through by default — flip the strip-metadata option if you're publishing the image and want to drop personal-identifying tags.`;
    case 'trim':
      return `Trimming runs ffmpeg with -ss (seek) and -t (duration). Re-encode mode (the default) is frame-accurate but pays the encode cost — typically a fraction of real-time on modern hardware for short clips. Stream-copy mode is instant but snaps to the nearest keyframe before your start point; for ${fromU}, keyframes typically land every 2-10 seconds, so stream-copy can shift the cut by up to 10 seconds. Re-encode is the safer default unless you need a fast-cut highlight from a long clip and the keyframe-snap is acceptable.`;
    case 'resize':
      return `Resize uses the lanczos scaler, which preserves edge detail and fine textures better than the bilinear or bicubic filters most quick tools default to — at the cost of slightly slower encoding. Audio is stream-copied (no re-encode) since resize doesn't touch it; only the video stream goes through the encoder. Even-pixel rounding preserves codec compatibility — H.264 and VP9 both require even width and height, so an odd target like 539 rounds to 540 to keep the encoder happy. Aspect ratio is preserved by default; pad-to-aspect adds letterbox bars for hard target dimensions.`;
    case 'thumbnail':
      return `We seek to the requested timestamp with -ss and grab a single frame with -frames:v 1. JPG quality defaults to 5 on ffmpeg's 1-31 scale (visually lossless for photo content, ~85 in the more familiar 0-100 quality scale); PNG and WebP outputs are available in the advanced panel for transparency or smaller bytes. The output resolution matches the source frame — use the resize tool first if you need a specific pixel count, or chain the operations together by piping the resize output into the thumbnail tool.`;
    case 'contact-sheet':
      return `The select filter samples one frame every N (default: every 30 frames, which is one per second at a 30 FPS source), the scale filter sizes each tile to a manageable resolution, and the tile filter arranges them into a grid. Output is a single JPG image. Adjust the sampling interval up for longer clips so the grid still represents the whole runtime — a 3-hour film at one-frame-per-second would produce a 10,800-frame sheet, which is unmanageable. For longer sources, sample one frame per minute and the grid stays readable.`;
    case 'normalize-audio':
      return `EBU R128 normalisation runs in two passes. Pass one analyses the ${fromU} to measure integrated loudness, true peak, and loudness range; pass two applies the gain that lands the file at your target (default -16 LUFS for podcasts). Unlike peak normalisation, which only matches the loudest sample, R128 matches *perceived* volume across the whole track — quiet passages are not pumped up just because the loudest sample fits the headroom. The result is a track that sounds the same loudness as every other R128-normalised file in your library, regardless of how the source was mixed.`;
    case 'rotate':
      return `Rotation re-encodes the ${fromU} with the transpose filter, which physically rotates pixels rather than setting the rotation metadata flag. Older Windows players, web embed previews, social media thumbnail generators, and many transcoders ignore the flag — baking the rotation into the picture guarantees correct orientation everywhere. Audio is stream-copied (rotation doesn't affect it). The encoder runs at the same quality settings as a standard convert, so rotated output is visually indistinguishable from a re-encoded original at the new orientation.`;
    case 'merge':
      return `Concatenation runs ffmpeg's concat demuxer, which stitches the input files end-to-end without re-encoding when codecs and stream parameters match — the common case for files from a single recording session that was split. When parameters differ, the demuxer falls back to re-encoding to a common spec, which is slower but produces a single clean output. Subtitle and chapter metadata from the first file is preserved; trailing files contribute their video and audio streams only.`;
    case 'change-speed':
      return `Speed adjustment uses the setpts filter for video (which scales presentation timestamps) and atempo for audio (which time-stretches without pitch-shifting up to 2x). For factors beyond 2x or below 0.5x we chain multiple atempo filters together. The video framerate stays constant — only the duration changes — so editors and players handle the result without complaint. Quality is preserved through the encoder at standard CRF settings.`;
    case 'add-subtitles':
      return `Soft subtitles attach as a separate track in the container (mov_text for MP4, WebVTT for WebM, SRT for MKV) and the viewer can toggle them on or off. Hard subtitles are burned into the video pixels using the subtitles filter, which requires re-encoding the video stream — slower but the subs survive every player, every platform, and every transcoder. For social media destinations, hard subs are usually the safer pick.`;
    case 'reverse':
      return `Reverse runs the reverse filter on the video stream and areverse on the audio. Both filters require buffering the entire stream in memory before emitting reversed output, so reverse is RAM-bounded — long clips can spike memory usage. The output is a fresh ${toU} container with the same codecs and quality settings as the source. Audio reverses to the spooky backwards-speech effect most viewers expect; mute the source first if you want a clean reversed visual.`;
    case 'extract-frames':
      return `The fps filter resamples the video to the target frame rate, then -f image2 writes each frame as a numbered file (frame_%04d.jpg by default). JPG quality defaults to ffmpeg's q:v 5 — visually lossless for photo content. PNG and WebP outputs are available for transparency or training-data uses where compression artefacts matter.`;
    default:
      return `The ${fromU} input rides through ffmpeg with operation-specific filters. Output container is ${toU}, codecs are picked to maximise device compatibility. Both files delete one hour after the job finishes — see the privacy notes below the converter.`;
  }
}

// ─────────────────────────────────────────────────────── PUBLIC API ──────────

export interface PageCopy {
  whenToUse: string;
  commonPitfalls: FAQ[];
  extendedHowItWorks: string;
}

/**
 * Resolve the body-copy fields for one (row, page) pair. Row-level overrides
 * win where present; otherwise the per-operation defaults compose unique
 * paragraphs from the row metadata.
 */
export function resolvePageCopy(
  row: OperationRow,
  page?: ResolvedPage,
): PageCopy {
  return {
    whenToUse: row.whenToUse ?? whenToUseDefault(row, page),
    commonPitfalls:
      row.commonPitfalls && row.commonPitfalls.length > 0
        ? row.commonPitfalls
        : commonPitfallsDefault(row, page),
    extendedHowItWorks:
      row.extendedHowItWorks ?? extendedHowItWorksDefault(row, page),
  };
}

/**
 * Count words in a single string. "Word" = whitespace-separated tokens after
 * collapsing whitespace and stripping leading/trailing punctuation. Used by
 * `<ToolPage>` for nothing — the count lives in the test only — but exported
 * for the test to reuse so the production path and test path agree on
 * methodology.
 */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((t) => /[a-zA-Z0-9]/.test(t)).length;
}

/**
 * Estimate the total visible body word count for a given (row, page). Counts:
 *   - h1
 *   - valueProp
 *   - whenToUse paragraph
 *   - commonPitfalls answers
 *   - extendedHowItWorks paragraph
 *   - faqs answers (NOT questions — per AC, "excluding FAQ Q's")
 *
 * Excludes nav, footer, ffmpeg command code blocks, and structural labels
 * (matching the AC: "counting body copy + FAQ A's + How-it-works + value prop").
 */
export function estimatePageWordCount(
  row: OperationRow,
  page?: ResolvedPage,
): number {
  const copy = resolvePageCopy(row, page);
  const parts: string[] = [
    row.h1,
    row.valueProp,
    copy.whenToUse,
    copy.extendedHowItWorks,
    ...copy.commonPitfalls.map((p) => p.a),
    ...row.faqs.map((f) => f.a),
  ];
  let total = 0;
  for (const p of parts) total += countWords(p);
  return total;
}
