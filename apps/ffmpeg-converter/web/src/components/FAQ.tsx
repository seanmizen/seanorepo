// FAQ block. Renders the per-row `faqs` array as native <details>/<summary>
// pairs (no JS) plus a JSON-LD `FAQPage` schema block for SEO.
//
// Pure server component. Phase 2 will add full schema.org coverage
// (SoftwareApplication, HowTo, BreadcrumbList) — Phase 1 ships FAQPage only,
// since it is the highest-leverage SERP feature (rich-result eligibility).

import type { FAQ as FAQItem } from '@/ops/types';

export interface FAQProps {
  faqs: FAQItem[];
  /** Optional heading override. Defaults to "Frequently asked". */
  heading?: string;
}

export function FAQ({ faqs, heading = 'Frequently asked' }: FAQProps) {
  if (!faqs || faqs.length === 0) return null;

  // FAQPage schema — generated inline so the SERP eligibility ships with the
  // page on first paint, not after hydration.
  const schema = {
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

  return (
    <section aria-label="Frequently asked questions">
      <h2 className="mb-4 font-semibold text-gray-100 text-xl">{heading}</h2>
      <div className="divide-y divide-gray-800 rounded-2xl border border-gray-800 bg-gray-900/40">
        {faqs.map((f) => (
          <details
            key={f.q}
            className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-gray-100">
              <span className="font-medium">{f.q}</span>
              <span
                aria-hidden
                className="text-gray-400 transition-transform group-open:rotate-90"
              >
                ▸
              </span>
            </summary>
            <p className="mt-3 text-gray-400 text-sm leading-relaxed">{f.a}</p>
          </details>
        ))}
      </div>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD schema is required to be a script tag with serialized JSON
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </section>
  );
}
