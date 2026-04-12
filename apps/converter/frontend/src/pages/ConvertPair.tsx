import { useMemo } from 'react';
import { Converter } from '@/components/Converter';
import { type ConversionPair, pairCanonical } from '@/data/pairs';
import { BRAND } from '@/lib/brand';
import { usePageMeta } from '@/lib/usePageMeta';

interface ConvertPairPageProps {
  pair: ConversionPair;
}

// Shared landing-page template. Each route renders <ConvertPair pair={...} />
// so that the HTML, JSON-LD, and Converter preset stay in lockstep.
//
// Per CLAUDE.md Directive 1: each landing page is self-canonical — NEVER
// cross-canonicalise to `/`. Every pair must rank on its own merit.
export default function ConvertPair({ pair }: ConvertPairPageProps) {
  const heading = `Convert ${pair.fromLabel} to ${pair.toLabel} online — free, instant, no signup`;
  const description = `${pair.blurb} Drop a ${pair.fromLabel} file and download the ${pair.toLabel} result — no account required.`;
  const canonical = pairCanonical(pair);

  const jsonLd = useMemo(
    () => ({
      howTo: {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: `How to convert ${pair.fromLabel} to ${pair.toLabel} online`,
        description,
        step: [
          {
            '@type': 'HowToStep',
            position: 1,
            name: `Drop your ${pair.fromLabel} file`,
            text: `Drag a ${pair.fromLabel} file onto ${BRAND.name}, or click to browse.`,
          },
          {
            '@type': 'HowToStep',
            position: 2,
            name: `${pair.toLabel} is pre-selected`,
            text: `The output format is already set to ${pair.toLabel} for this page.`,
          },
          {
            '@type': 'HowToStep',
            position: 3,
            name: 'Convert and download',
            text: `Click Convert, then download the ${pair.toLabel} result. Your file is deleted from the server within one hour.`,
          },
        ],
      },
      breadcrumb: {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: BRAND.name,
            item: `${BRAND.origin}/`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: `${pair.fromLabel} to ${pair.toLabel}`,
            item: canonical,
          },
        ],
      },
    }),
    [pair.fromLabel, pair.toLabel, description, canonical],
  );

  usePageMeta({
    title: `Convert ${pair.fromLabel} to ${pair.toLabel} — ${BRAND.name}`,
    description,
    canonical,
    jsonLd,
  });

  return (
    <>
      <section
        style={{ textAlign: 'center', marginBottom: '2rem', maxWidth: '640px' }}
      >
        <h1
          style={{
            fontSize: '1.75rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}
        >
          {heading}
        </h1>
        <p
          style={{
            color: 'var(--text-muted)',
            marginTop: '0.75rem',
            fontSize: '0.95rem',
            lineHeight: 1.5,
          }}
        >
          {pair.blurb}
        </p>
      </section>

      <Converter presetInputExt={pair.from} presetOutputFormat={pair.to} />

      <section
        style={{
          marginTop: '2rem',
          width: '100%',
          maxWidth: '560px',
          color: 'var(--text-muted)',
          fontSize: '0.9rem',
          lineHeight: 1.6,
        }}
      >
        <h2
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: '0.5rem',
          }}
        >
          How it works
        </h2>
        <ol style={{ paddingLeft: '1.25rem', margin: 0 }}>
          <li>Drop your {pair.fromLabel} file onto the area above.</li>
          <li>
            Click <strong>Convert to .{pair.to}</strong>.
          </li>
          <li>
            Download the {pair.toLabel} result. Files are deleted from the
            server within 1 hour.
          </li>
        </ol>
      </section>
    </>
  );
}
