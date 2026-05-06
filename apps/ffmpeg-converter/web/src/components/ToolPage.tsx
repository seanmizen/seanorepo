// pSEO tool page composition. Spec §7.2 render order is fixed:
//
//   [H1: "MOV to MP4"]
//   [One-line value prop]
//   [Drop zone — works immediately, no scroll required]
//   [Result area, hidden until job runs:
//      - download button
//      - "ffmpeg command:" code block, copy button
//      - "Try another file" button
//      - reverse-link
//   ]
//   [Three sibling links]
//   [FAQ block]
//   [Tiny "How it works" block]
//   [Footer is in layout.tsx]
//
// SERVER component — only the interactive convert step (<ConverterPanel />)
// needs JS. Keeps the route-specific bundle minimal for Lighthouse.
//
// This component is the proof-of-concept for the entire pSEO strategy. Phase 2
// generates ≥200 pages by calling <ToolPage row={...} /> for every entry in
// the operations matrix — so the API surface here MUST be just the row.

import Link from 'next/link';
import { MATRIX_BY_SLUG } from '@/ops/matrix';
import type { OperationRow } from '@/ops/types';
import { ConverterPanel } from './ConverterPanel';
import { FAQ } from './FAQ';

export interface ToolPageProps {
  row: OperationRow;
}

export function ToolPage({ row }: ToolPageProps) {
  const accept = buildAcceptString(row);
  const acceptLabel = buildAcceptLabel(row);
  const reverse = findReverse(row);
  const siblings = resolveSiblings(row);
  const extraArgs = buildExtraArgs(row);

  return (
    <div className="mx-auto max-w-3xl px-6 pt-12 pb-20 md:pt-16">
      {/* Header — H1 + value prop */}
      <header className="mb-8">
        <h1 className="text-balance text-4xl font-bold tracking-tight text-gray-100 md:text-5xl">
          {row.h1}
        </h1>
        <p className="mt-3 text-balance text-gray-400 text-lg">
          {row.valueProp}
        </p>
      </header>

      {/* Convert panel — client-only state lives behind this boundary */}
      <section className="mb-10" aria-label="Convert your file">
        <ConverterPanel
          goOp={row.goOp}
          outputExt={extOf(row.outputFormat)}
          accept={accept}
          acceptLabel={acceptLabel}
          extraArgs={extraArgs}
          ffmpegCommand={row.ffmpegCommand}
          reverseSlug={reverse?.slug}
          reverseLabel={reverse?.label}
          reverseOperation={reverse?.operation}
        />
      </section>

      {/* Three sibling links — internal-link block per spec §7.2 */}
      {siblings.length > 0 && (
        <section className="mb-12" aria-label="Related conversions">
          <h2 className="mb-3 font-medium text-gray-300 text-sm uppercase tracking-wider">
            Related
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {siblings.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/${s.operation}/${s.slug}`}
                  className={[
                    'flex h-full items-center justify-center rounded-xl',
                    'border border-gray-800 bg-gray-900/40 px-4 py-3',
                    'text-center font-medium text-gray-100 text-sm',
                    'transition-colors hover:border-indigo-500 hover:bg-gray-900/60',
                  ].join(' ')}
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* FAQ block */}
      <section className="mb-12">
        <FAQ faqs={row.faqs} />
      </section>

      {/* Tiny "How it works" block */}
      <HowItWorks row={row} />
    </div>
  );
}

// ─────────────────────────────────────────────────────── HOW IT WORKS ────────

function HowItWorks({ row }: { row: OperationRow }) {
  // Per spec §7.2 the "how it works" block is intentionally tiny — wasm vs
  // server lane explanation + file deletion policy. Phase 6 will swap in the
  // wasm copy on rows that run client-side; until then everything is server.
  return (
    <section aria-label="How it works">
      <h2 className="mb-4 font-semibold text-gray-100 text-xl">How it works</h2>
      <div className="space-y-3 text-gray-400 text-sm leading-relaxed">
        <p>
          Drop a file. We run{' '}
          <code className="rounded bg-gray-900 px-1.5 py-0.5 text-gray-200">
            ffmpeg
          </code>{' '}
          on our server, hand you back the result, and delete both files one
          hour later.
        </p>
        <p>
          The exact command we run is shown above with a copy button — paste it
          into your own terminal if you prefer to keep the file on your machine.
        </p>
        <p className="text-gray-500 text-xs">
          Backend operation:{' '}
          <code className="rounded bg-gray-900 px-1.5 py-0.5 text-gray-300">
            {row.goOp}
          </code>
          .
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────── HELPERS ─────────────

/**
 * Map a Format enum to the file extension used in URLs and filenames. Most
 * formats are their own extension; the special-cases below cover the ones
 * with longer names.
 */
function extOf(format: string): string {
  switch (format) {
    case 'gif-static':
      return 'gif';
    case 'webp-anim':
      return 'webp';
    default:
      return format;
  }
}

/**
 * Build the `<input accept>` attribute from the row's accepted input formats.
 * Each format maps to its `.ext` form; we don't bother with MIME types since
 * the backend validates anyway.
 */
function buildAcceptString(row: OperationRow): string {
  return row.inputFormats.map((f) => `.${extOf(f)}`).join(',');
}

/**
 * Human-readable accept label for the drop zone copy. Single format → just
 * the name (`MOV`); 2-3 formats → all listed; many formats → "video file" etc.
 */
function buildAcceptLabel(row: OperationRow): string {
  if (row.inputFormats.length === 0) return 'file';
  if (row.inputFormats.length === 1) {
    return extOf(row.inputFormats[0] ?? '').toUpperCase();
  }
  if (row.inputFormats.length <= 3) {
    return row.inputFormats.map((f) => extOf(f).toUpperCase()).join(', ');
  }
  // Many inputs — group by media kind for the copy.
  return 'video file';
}

/**
 * Build the `extraArgs` map forwarded to the Go op. Pulls preset hints from
 * the row (CRF, target size, FPS, etc.) — the backend reads them from the
 * multipart form values.
 */
function buildExtraArgs(row: OperationRow): Record<string, string> | undefined {
  const args: Record<string, string> = {};
  const p = row.preset;
  if (!p) return undefined;
  if (p.crf !== undefined) args.crf = String(p.crf);
  if (p.preset !== undefined) args.preset = p.preset;
  if (p.targetSizeMb !== undefined) {
    args.target_size_mb = String(p.targetSizeMb);
  }
  if (p.resolution !== undefined) args.resolution = p.resolution;
  if (p.fps !== undefined) args.fps = String(p.fps);
  if (p.audioBitrate !== undefined) args.audio_bitrate = p.audioBitrate;
  return Object.keys(args).length > 0 ? args : undefined;
}

interface SiblingLink {
  slug: string;
  label: string;
  operation: string;
}

/**
 * Resolve `row.related` slugs against the matrix. Falls back to a plain label
 * derived from the slug when a sibling row isn't in the matrix yet (Phase 2
 * will add the long-tail rows).
 */
function resolveSiblings(row: OperationRow): SiblingLink[] {
  return (row.related ?? []).map((slug) => {
    const sib = MATRIX_BY_SLUG[slug];
    if (sib) {
      return { slug, label: sib.h1, operation: sib.operation };
    }
    // Sibling row doesn't exist yet — synthesise a label from the slug.
    return {
      slug,
      label: humanise(slug),
      operation: inferOperationFromSlug(slug),
    };
  });
}

/**
 * Find the inverse-direction row (e.g. `mov-to-mp4` → `mp4-to-mov`). Only
 * applies to two-format `convert` rows. Returns null when there's no clean
 * reverse (e.g. `extract-audio`, multi-input `video-to-mp4`).
 */
function findReverse(
  row: OperationRow,
): { slug: string; label: string; operation: string } | null {
  if (row.operation !== 'convert') return null;
  if (row.inputFormats.length !== 1) return null;
  const inputExt = extOf(row.inputFormats[0] ?? '');
  const outputExt = extOf(row.outputFormat);
  const reverseSlug = `${outputExt}-to-${inputExt}`;
  const sib = MATRIX_BY_SLUG[reverseSlug];
  if (!sib) return null;
  return {
    slug: sib.slug,
    label: sib.h1,
    operation: sib.operation,
  };
}

/** Convert a slug like `mp4-to-webm` to a plain label `MP4 → WebM`. */
function humanise(slug: string): string {
  return slug
    .replace('-to-', ' → ')
    .replace(/-/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(
      /Mp4|Mov|Webm|Mkv|Mpeg|Mp3|Wav|Aac|Flac|Webp|Heic|Avif|Jpg|Png|Gif/gi,
      (m) => m.toUpperCase(),
    );
}

/**
 * Infer the operation prefix (URL segment) from a slug. Used when a sibling
 * row isn't in the matrix yet — we still need to render a working link.
 */
function inferOperationFromSlug(slug: string): string {
  if (slug.startsWith('compress-')) return 'compress';
  if (slug.startsWith('trim-')) return 'trim';
  if (slug.startsWith('resize-')) return 'resize';
  if (slug.startsWith('thumbnail-')) return 'thumbnail';
  if (slug.startsWith('contact-sheet-')) return 'contact-sheet';
  if (slug.startsWith('image-')) return 'convert';
  if (
    slug.endsWith('-to-mp3') ||
    slug.endsWith('-to-wav') ||
    slug.endsWith('-to-aac') ||
    slug.endsWith('-to-flac')
  ) {
    return slug.startsWith('video-') ? 'extract-audio' : 'convert';
  }
  if (slug.endsWith('-to-gif')) return 'gif';
  return 'convert';
}
