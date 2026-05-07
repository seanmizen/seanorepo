// pSEO tool page route. Phase 2 ships /compress/[slug], /extract-audio/[slug],
// /gif/[slug], /trim/[slug], /resize/[slug], /thumbnail/[slug],
// /contact-sheet/[slug] and /normalize-audio/[slug] alongside this one.
//
// `/convert/[slug]` accepts BOTH `operation === 'convert'` AND
// `operation === 'image-convert'` rows. Per Directive 1's verb-first slug rule,
// image-convert pages live under `/convert/...` (`image-to-webp`,
// `image-to-jpg` etc.) — the user-facing verb is still "convert" and the
// `/image/...` segment stays free for future image-only operations
// (compress-image, resize-image) that will own that segment.
//
// Dynamic param resolution:
//   - slug is looked up against MATRIX_BY_SLUG.
//   - If the slug is unknown OR its row.operation isn't convert/image-convert,
//     return notFound().
//   - generateStaticParams pre-renders every matching row at build time so the
//     pages ship as static HTML (Lighthouse Performance ≥95 budget).
//   - generateMetadata pulls the row's `title` for the <title> + meta tags.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ToolPage } from '@/components/ToolPage';
import { MATRIX, MATRIX_BY_SLUG } from '@/ops/matrix';

const ACCEPTED_OPERATIONS = ['convert', 'image-convert'] as const;
type AcceptedOperation = (typeof ACCEPTED_OPERATIONS)[number];

function isAccepted(op: string): op is AcceptedOperation {
  return (ACCEPTED_OPERATIONS as readonly string[]).includes(op);
}

// Static generation — list every convert/image-convert row slug.
export function generateStaticParams() {
  return MATRIX.filter((row) => isAccepted(row.operation)).map((row) => ({
    slug: row.slug,
  }));
}

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: RouteParams): Promise<Metadata> {
  const { slug } = await params;
  const row = MATRIX_BY_SLUG[slug];
  if (!row || !isAccepted(row.operation)) {
    return { title: 'Not found' };
  }
  return {
    title: row.title,
    description: row.valueProp,
  };
}

export default async function ConvertPage({ params }: RouteParams) {
  const { slug } = await params;
  const row = MATRIX_BY_SLUG[slug];
  if (!row || !isAccepted(row.operation)) {
    notFound();
  }
  return <ToolPage row={row} />;
}
