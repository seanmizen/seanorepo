// Per-page Open Graph image for `/thumbnail/[slug]` — generated at build time.
// See `/convert/[slug]/opengraph-image.tsx` for the full pattern rationale.

import { generateOgImage } from '@/components/og-image-handler';
import { OG_CONTENT_TYPE, OG_SIZE } from '@/components/og-template';
import { MATRIX } from '@/ops/matrix';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Sean's Converter — per-pair conversion preview";

const ACCEPTED = ['thumbnail'] as const;

export function generateStaticParams() {
  return MATRIX.filter((row) => row.operation === 'thumbnail').map((row) => ({
    slug: row.slug,
  }));
}

interface Props {
  params: { slug: string };
}

export default function OpengraphImage({ params }: Props) {
  return generateOgImage(ACCEPTED, params.slug);
}
