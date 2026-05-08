// Per-page Open Graph image for `/convert/[slug]` — generated at build time.
//
// Co-located with `page.tsx` so Next pre-renders one PNG per slug. The
// <head>'s `og:image` meta is auto-wired by Next — no manual <meta> tag needed.
//
// Accepts both `convert` and `image-convert` operations to match the parent
// route's gate (see `page.tsx` for the verb-first slug rationale).

import { generateOgImage } from '@/components/og-image-handler';
import { OG_CONTENT_TYPE, OG_SIZE } from '@/components/og-template';
import { MATRIX } from '@/ops/matrix';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Sean's Converter — per-pair conversion preview";

const ACCEPTED = ['convert', 'image-convert'] as const;

// Drives build-time generation: one image per matching matrix slug.
export function generateStaticParams() {
  return MATRIX.filter((row) =>
    (ACCEPTED as readonly string[]).includes(row.operation),
  ).map((row) => ({ slug: row.slug }));
}

interface Props {
  params: { slug: string };
}

export default function OpengraphImage({ params }: Props) {
  return generateOgImage(ACCEPTED, params.slug);
}
