// FAQ block. Renders the per-row `faqs` array as native <details>/<summary>
// pairs (no JS).
//
// Pure server component. The FAQPage JSON-LD schema is emitted centrally
// from <ToolPage /> via `@/lib/schemas` (SEAN-55) — alongside the other
// three schema.org blocks (SoftwareApplication, HowTo, BreadcrumbList).
// Keeping all four schemas in one place means future schema changes only
// touch `lib/schemas.ts`, not this presentation component.

import type { FAQ as FAQItem } from '@/ops/types';

export interface FAQProps {
  faqs: FAQItem[];
  /** Optional heading override. Defaults to "Frequently asked". */
  heading?: string;
}

export function FAQ({ faqs, heading = 'Frequently asked' }: FAQProps) {
  if (!faqs || faqs.length === 0) return null;

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
    </section>
  );
}
