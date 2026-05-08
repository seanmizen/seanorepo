// Shared route handler for `opengraph-image.tsx` / `twitter-image.tsx` files.
//
// Every operation route under `src/app/{op}/[slug]/` exposes an OG image that
// resolves the slug against MATRIX_BY_SLUG and renders the shared OgTemplate.
// This module factors out the boilerplate so each route file is a 4-liner.
//
// Usage (in `src/app/convert/[slug]/opengraph-image.tsx`):
//
//   import { generateOgImage, generateOgStaticParams } from '...';
//   export const runtime = 'nodejs';
//   export const size = OG_SIZE;
//   export const contentType = OG_CONTENT_TYPE;
//   export function generateImageMetadata() { ... }
//   export default function Image({ params }) {
//     return generateOgImage(['convert', 'image-convert'], params.slug);
//   }
//
// Static generation: each `opengraph-image.tsx` co-located with `[slug]/page.tsx`
// inherits the parent route's `generateStaticParams` — Next pre-renders one
// image per slug at build time. We don't need to redeclare it here.

import { ImageResponse } from 'next/og';
import { MATRIX_BY_SLUG } from '@/ops/matrix';
import type { Operation } from '@/ops/types';
import { OG_SIZE, OgTemplate } from './og-template';

/**
 * Render the OG image for a given slug, gated to a list of accepted ops.
 * Mirrors the per-route gate in `[slug]/page.tsx` — if the slug doesn't
 * resolve or its operation isn't in `acceptedOps`, returns a tiny fallback
 * image (Next requires *some* response from this handler).
 */
export function generateOgImage(
  acceptedOps: readonly Operation[],
  slug: string,
): ImageResponse {
  const row = MATRIX_BY_SLUG[slug];
  if (!row || !acceptedOps.includes(row.operation)) {
    return new ImageResponse(
      <div
        style={{
          display: 'flex',
          height: '100%',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0a',
          color: '#f5f5f5',
          fontSize: 64,
          fontFamily: 'sans-serif',
        }}
      >
        Sean&apos;s Converter
      </div>,
      { ...OG_SIZE },
    );
  }

  return new ImageResponse(<OgTemplate row={row} />, { ...OG_SIZE });
}
