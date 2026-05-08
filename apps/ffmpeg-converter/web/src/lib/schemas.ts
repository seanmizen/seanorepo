// SEAN-55 — schema.org JSON-LD builders for tool pages.
//
// Pure functions. Each builder takes an OperationRow (plus a small amount of
// derived context like the canonical URL) and returns a plain object ready
// for JSON.stringify into a `<script type="application/ld+json">` block.
//
// The four schemas are emitted on every tool page per phased-spec.md §"Phase 2":
//   - SoftwareApplication: this page IS the tool — name, category, free offer.
//   - HowTo: drop file → wait → download. Derived from the page's "How it
//     works" copy in ToolPage.
//   - FAQPage: every row.faq Q/A becomes a Question entity.
//   - BreadcrumbList: Home > {operation} > {h1}.
//
// Validation: all four pass schema.org's validator at https://validator.schema.org/
// (manual check, no CI gate per the ticket — Phase 2's quality-gate ticket
// owns the automated validator pass).

import type { FAQ, OperationRow } from '@/ops/types';

/**
 * Production canonical origin. Hard-coded rather than env-driven so that
 * statically-generated pages always emit absolute URLs to the production
 * domain — preview/staging pages should not rank.
 */
export const CANONICAL_ORIGIN = 'https://seansconverter.com';

/**
 * Build the absolute canonical URL for a tool page given its operation +
 * slug. Mirrors `route-registry.ts::pathForSlug` but always returns an
 * absolute URL to the production origin (and never returns null — the schema
 * is generated from a row that already has an implemented route).
 */
export function canonicalUrlFor(row: OperationRow): string {
  return `${CANONICAL_ORIGIN}/${row.operation}/${row.slug}`;
}

// ─────────────────────────────────────────── SoftwareApplication ─────────────

/**
 * Build the SoftwareApplication schema for a tool page.
 *
 * `applicationCategory: "MultimediaApplication"` is the schema.org category
 * that covers "tools that work with media" — covers both video converters
 * and image/audio tools without needing a per-operation switch.
 *
 * The free offer (`price: "0"`, `priceCurrency: "USD"`) is required by
 * Google for SoftwareApplication rich-result eligibility — without an
 * offer block the schema validates but does NOT render in SERPs.
 */
export function buildSoftwareApplicationSchema(
  row: OperationRow,
): Record<string, unknown> {
  const url = canonicalUrlFor(row);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: row.h1,
    description: row.valueProp,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any',
    url,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };
}

// ──────────────────────────────────────────────────────── HowTo ──────────────

/**
 * Build the HowTo schema for a tool page.
 *
 * The visible "How it works" block on every tool page describes the same
 * three-step flow (drop file → wait → download). The schema mirrors that
 * verbatim so the structured data matches the on-page content — Google
 * penalises HowTo schemas whose steps don't map to visible page content.
 */
export function buildHowToSchema(row: OperationRow): Record<string, unknown> {
  const url = canonicalUrlFor(row);
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: `How to ${row.h1.toLowerCase()}`,
    description: row.valueProp,
    step: [
      {
        '@type': 'HowToStep',
        position: 1,
        name: 'Drop your file',
        text: 'Drag and drop your file onto the page, or click the drop zone to choose one.',
        url: `${url}#step-drop`,
      },
      {
        '@type': 'HowToStep',
        position: 2,
        name: 'Wait for conversion',
        text: 'We run the ffmpeg command on our server. The exact command is shown on the page.',
        url: `${url}#step-wait`,
      },
      {
        '@type': 'HowToStep',
        position: 3,
        name: 'Download the result',
        text: 'Click the download button. Both files are deleted from our server one hour later.',
        url: `${url}#step-download`,
      },
    ],
  };
}

// ─────────────────────────────────────────────────────── FAQPage ─────────────

/**
 * Build the FAQPage schema from a row's `faqs` array. Returns null when
 * there are no FAQs — emitting an empty FAQPage schema is a validator
 * warning, so we skip the script tag entirely in that case.
 */
export function buildFaqPageSchema(
  faqs: FAQ[],
): Record<string, unknown> | null {
  if (!faqs || faqs.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.a,
      },
    })),
  };
}

// ───────────────────────────────────────────────── BreadcrumbList ────────────

/**
 * Human-readable label for an operation segment. Used as the breadcrumb
 * mid-segment (`Home > Convert > MOV to MP4`).
 *
 * The taxonomy lives in `types.ts::Operation`. Adding a new operation there
 * MUST add a label here in the same commit — exhaustive switch is enforced
 * by the `never` fallback below.
 */
function operationLabel(operation: OperationRow['operation']): string {
  switch (operation) {
    case 'convert':
      return 'Convert';
    case 'compress':
      return 'Compress';
    case 'extract-audio':
      return 'Extract audio';
    case 'extract-frames':
      return 'Extract frames';
    case 'trim':
      return 'Trim';
    case 'resize':
      return 'Resize';
    case 'rotate':
      return 'Rotate';
    case 'gif':
      return 'GIF';
    case 'merge':
      return 'Merge';
    case 'mute':
      return 'Mute';
    case 'change-speed':
      return 'Change speed';
    case 'add-subtitles':
      return 'Add subtitles';
    case 'remove-audio':
      return 'Remove audio';
    case 'reverse':
      return 'Reverse';
    case 'thumbnail':
      return 'Thumbnail';
    case 'contact-sheet':
      return 'Contact sheet';
    case 'normalize-audio':
      return 'Normalize audio';
    case 'image-convert':
      return 'Convert';
    default: {
      // Exhaustive check — TS will fail compilation if a new Operation
      // type member is added without a label above.
      const _exhaustive: never = operation;
      return _exhaustive;
    }
  }
}

/**
 * Build the BreadcrumbList schema: Home > {operation} > {h1}. The middle
 * segment links to the operation hub page (`/convert`, `/compress` etc.) —
 * those hub pages are part of Phase 2 per phased-spec §"Phase 2", which is
 * the same phase shipping this schema. If a hub page doesn't exist yet the
 * link will 404 in the wild but the schema is still valid (Google's
 * BreadcrumbList docs don't require listed URLs to be live).
 */
export function buildBreadcrumbSchema(
  row: OperationRow,
): Record<string, unknown> {
  const url = canonicalUrlFor(row);
  const operationHub = `${CANONICAL_ORIGIN}/${row.operation}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: `${CANONICAL_ORIGIN}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: operationLabel(row.operation),
        item: operationHub,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: row.h1,
        item: url,
      },
    ],
  };
}

// ──────────────────────────────────────────────────── Aggregate ──────────────

/**
 * Build the full set of JSON-LD schemas for a tool page. `null` entries
 * (e.g. a row with no FAQs) are filtered out so the caller can blindly
 * iterate the array.
 */
export function buildToolPageSchemas(
  row: OperationRow,
): Record<string, unknown>[] {
  return [
    buildSoftwareApplicationSchema(row),
    buildHowToSchema(row),
    buildFaqPageSchema(row.faqs),
    buildBreadcrumbSchema(row),
  ].filter((s): s is Record<string, unknown> => s !== null);
}
