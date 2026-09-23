import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Converter } from '@/components/Converter';
import { Faq } from '@/components/Faq';
import { faqsFor } from '@/faqs';
import { TOOLS, TOOLS_BY_SLUG } from '@/tools';

export const dynamicParams = false;

export function generateStaticParams() {
  return TOOLS.map((t) => ({ slug: t.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tool = TOOLS_BY_SLUG[(await params).slug];
  if (!tool) return {};
  return {
    title: `${tool.name}: free online converter | Sean's Converter`,
    description: `${tool.lede} Free, no sign-up, no watermark. Files are deleted after one hour.`,
    alternates: { canonical: `/${tool.slug}` },
  };
}

export default async function ToolPage({ params }: Props) {
  const tool = TOOLS_BY_SLUG[(await params).slug];
  if (!tool) notFound();
  const faqs = faqsFor(tool);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: `${tool.name} converter`,
        url: `https://seansconverter.com/${tool.slug}`,
        description: tool.lede,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Any',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' },
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 sm:px-6 sm:pt-16">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD from our own data
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <h1 className="text-4xl font-bold tracking-tight text-fg sm:text-5xl">
        {tool.name}
      </h1>
      <p className="mt-3 text-lg text-muted">{tool.lede}</p>

      <div className="mt-8">
        <Converter tool={tool} />
      </div>

      <div className="mt-14">
        <Faq faqs={faqs} />
      </div>

      {tool.related.length > 0 && (
        <section aria-labelledby="related-heading" className="mt-12">
          <h2 id="related-heading" className="text-xl font-semibold text-fg">
            Other converters
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {tool.related.map((slug) => (
              <li key={slug}>
                <Link
                  href={`/${slug}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-fg hover:border-accent"
                >
                  {TOOLS_BY_SLUG[slug].name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
