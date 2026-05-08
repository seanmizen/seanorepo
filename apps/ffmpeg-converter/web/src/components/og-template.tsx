// Shared Open Graph / Twitter image template.
//
// Rendered by `next/og`'s `ImageResponse` at build time from each operation's
// `opengraph-image.tsx` / `twitter-image.tsx` route handler. Co-located with
// each `[slug]/page.tsx` so Next pre-renders one image per matrix slug
// (generateStaticParams driven — no runtime cost).
//
// Constraints (per SEAN-58 AC):
//   - 1200×630 (standard OG card, also Twitter `summary_large_image` size).
//   - System fonts only — no font fetching at build (Next allows omitting
//     the `fonts` option, which falls back to a built-in default font).
//   - Shows the row's H1 (e.g. "MOV → MP4") prominently plus a "Sean's
//     Converter" wordmark.
//
// The exported `OG_SIZE` and `OG_CONTENT_TYPE` constants are re-used by every
// `opengraph-image.tsx` / `twitter-image.tsx` to satisfy Next's metadata API.

import type { OperationRow } from '@/ops/types';

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png' as const;

/**
 * Convert the matrix row's H1 ("MOV to MP4", "Compress MP4", "Image to WebP")
 * into a punchier OG headline. We swap the word "to" for an arrow when both
 * sides are short tokens — that's the per-pair pitch the AC calls out.
 */
function ogHeadline(row: OperationRow): string {
  const h1 = row.h1;
  // "X to Y" → "X → Y" (only when X and Y look like simple format tokens).
  const arrowed = h1.replace(/^(\S{1,8})\s+to\s+(\S{1,8})$/i, '$1 → $2');
  return arrowed;
}

interface OgTemplateProps {
  row: OperationRow;
}

/**
 * The JSX returned here is consumed by `ImageResponse` from `next/og`, which
 * supports a *subset* of CSS via Satori — flexbox layouts only, no grid, no
 * external assets unless explicitly fetched. Keep this template self-contained.
 */
export function OgTemplate({ row }: OgTemplateProps) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#0a0a0a',
        backgroundImage:
          'radial-gradient(circle at 25% 25%, #1a1a1a 0%, #0a0a0a 60%)',
        padding: '72px',
        color: '#f5f5f5',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Top row: wordmark */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: '#a3a3a3',
        }}
      >
        Sean&apos;s Converter
      </div>

      {/* Centre block: H1 + value prop */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 120,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            lineHeight: 1.0,
            color: '#fafafa',
          }}
        >
          {ogHeadline(row)}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 36,
            fontWeight: 500,
            color: '#d4d4d4',
            lineHeight: 1.2,
            maxWidth: 1000,
          }}
        >
          {row.valueProp}
        </div>
      </div>

      {/* Bottom row: badges */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontSize: 24,
          fontWeight: 600,
          color: '#737373',
        }}
      >
        <div style={{ display: 'flex' }}>Free</div>
        <div style={{ display: 'flex' }}>·</div>
        <div style={{ display: 'flex' }}>No watermark</div>
        <div style={{ display: 'flex' }}>·</div>
        <div style={{ display: 'flex' }}>No signup</div>
      </div>
    </div>
  );
}
