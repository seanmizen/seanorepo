// pSEO tool page route for `gif` rows.
//
// Renders one static page per matrix row whose `operation === 'gif'`.
// All rendering goes through the shared <ToolPage row={...} /> component —
// no per-operation customisation lives here.
//
// See `/convert/[slug]/page.tsx` for the full Phase 2 routing rationale.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ToolPage } from '@/components/ToolPage';
import { MATRIX, MATRIX_BY_SLUG } from '@/ops/matrix';

const OPERATION = 'gif' as const;

export function generateStaticParams() {
  return MATRIX.filter((row) => row.operation === OPERATION).map((row) => ({
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
  if (!row || row.operation !== OPERATION) {
    return { title: 'Not found' };
  }
  return {
    title: row.title,
    description: row.valueProp,
  };
}

export default async function GifPage({ params }: RouteParams) {
  const { slug } = await params;
  const row = MATRIX_BY_SLUG[slug];
  if (!row || row.operation !== OPERATION) {
    notFound();
  }
  return <ToolPage row={row} />;
}
