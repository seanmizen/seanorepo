// Per-page Twitter card image for `/convert/[slug]` — generated at build time.
//
// Twitter accepts the OG image, but a dedicated `twitter-image.tsx` lets us
// emit `twitter:image` distinct from `og:image` and improves rendering on
// X / Slack / Discord previews. We share the same template — sizing and
// styling are identical to the OG image.

import { generateOgImage } from '@/components/og-image-handler';
import { OG_CONTENT_TYPE, OG_SIZE } from '@/components/og-template';
import { MATRIX } from '@/ops/matrix';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Sean's Converter — per-pair conversion preview";

const ACCEPTED = ['convert', 'image-convert'] as const;

export function generateStaticParams() {
  return MATRIX.filter((row) =>
    (ACCEPTED as readonly string[]).includes(row.operation),
  ).map((row) => ({ slug: row.slug }));
}

interface Props {
  params: { slug: string };
}

export default function TwitterImage({ params }: Props) {
  return generateOgImage(ACCEPTED, params.slug);
}
