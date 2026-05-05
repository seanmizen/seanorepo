// pSEO tool page route. Phase 1 only renders rows whose `operation === 'convert'`
// — Phase 2 ships /compress/[slug], /extract-audio/[slug], /gif/[slug] etc.
// using the same <ToolPage row=... /> component.
//
// Dynamic param resolution:
//   - slug is looked up against MATRIX_BY_SLUG.
//   - If the slug is unknown OR points at a non-convert row, return notFound().
//   - generateStaticParams pre-renders every convert row at build time so the
//     pages ship as static HTML (Lighthouse Performance ≥95 budget).
//   - generateMetadata pulls the row's `title` for the <title> + meta tags.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ToolPage } from '@/components/ToolPage';
import { MATRIX, MATRIX_BY_SLUG } from '@/ops/matrix';

// Static generation — list every convert-row slug.
export function generateStaticParams() {
  return MATRIX.filter((row) => row.operation === 'convert').map((row) => ({
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
  if (!row || row.operation !== 'convert') {
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
  if (!row || row.operation !== 'convert') {
    notFound();
  }
  return <ToolPage row={row} />;
}
