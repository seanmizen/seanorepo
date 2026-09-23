import type { Faq as FaqItem } from '@/tools';

export function Faq({ faqs }: { faqs: FaqItem[] }) {
  return (
    <section aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-xl font-semibold text-fg">
        Questions
      </h2>
      <dl className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
        {faqs.map((f) => (
          <div key={f.q} className="px-5 py-4">
            <dt className="font-semibold text-fg">{f.q}</dt>
            <dd className="mt-1 text-muted">{f.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
