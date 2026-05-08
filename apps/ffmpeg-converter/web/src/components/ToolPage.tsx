// pSEO tool page composition. Spec §7.2 render order is fixed:
//
//   [H1: "MOV to MP4"]
//   [One-line value prop]
//   [Drop zone — works immediately, no scroll required]
//   [Result area, hidden until job runs:
//      - download button
//      - "ffmpeg command:" code block, copy button
//      - "Try another file" button
//      - reverse-link
//   ]
//   [Three sibling links]
//   [FAQ block]
//   [Tiny "How it works" block]
//   [Footer is in layout.tsx]
//
// SERVER component — only the interactive convert step (<ConverterPanel />)
// needs JS. Keeps the route-specific bundle minimal for Lighthouse.
//
// This component is the proof-of-concept for the entire pSEO strategy. Phase 2
// generates ≥200 pages by calling <ToolPage row={...} /> for every entry in
// the operations matrix — so the API surface here MUST be just the row.

import Link from 'next/link';
import { buildToolPageSchemas } from '@/lib/schemas';
import { resolvePageCopy } from '@/ops/copy';
import type { OperationRow, ResolvedPage } from '@/ops/types';
import { ConverterPanel } from './ConverterPanel';
import {
  buildAcceptLabel,
  buildAcceptString,
  buildExtraArgs,
  findReverse,
  formatToExt,
  resolveSiblings,
} from './converter-row-args';
import { FAQ } from './FAQ';
import { GifPresetPanel } from './GifPresetPanel';
import { JsonLd } from './JsonLd';

export interface ToolPageProps {
  row: OperationRow;
  /**
   * SEAN-60 — optional resolved (input, output) pair used to vary the body
   * copy. When present the per-input fallback copy uses the actual input
   * format from the URL; absent, copy falls back to the row's first input.
   * Pages routed via `/convert/[slug]` etc. don't pass this today (the
   * route is keyed on slug, not input format), so the copy resolves against
   * the row's flagship input — which is fine for the head-term flagship
   * pages and acceptable for the bulk multi-input rows whose body still
   * varies by output format.
   */
  page?: ResolvedPage;
}

export function ToolPage({ row, page }: ToolPageProps) {
  const accept = buildAcceptString(row);
  const acceptLabel = buildAcceptLabel(row);
  const reverse = findReverse(row);
  const siblings = resolveSiblings(row);
  const extraArgs = buildExtraArgs(row);

  // SEAN-60 — resolved body copy. Row-level overrides win; otherwise the
  // per-operation defaults compose paragraphs from row metadata so no two
  // pages share the same body verbatim (Google's duplicate-content filter).
  const copy = resolvePageCopy(row, page);

  // SEAN-55 — emit four schema.org JSON-LD blocks per tool page
  // (SoftwareApplication, HowTo, FAQPage, BreadcrumbList). Server-rendered
  // into the HTML so the structured data ships on first paint — never
  // injected client-side. See `@/lib/schemas` for the per-schema builders.
  const schemas = buildToolPageSchemas(row);

  return (
    <div className="mx-auto max-w-3xl px-6 pt-12 pb-20 md:pt-16">
      <JsonLd schemas={schemas} />

      {/* Header — H1 + value prop */}
      <header className="mb-8">
        <h1 className="text-balance text-4xl font-bold tracking-tight text-gray-100 md:text-5xl">
          {row.h1}
        </h1>
        <p className="mt-3 text-balance text-gray-400 text-lg">
          {row.valueProp}
        </p>
      </header>

      {/* Convert panel — client-only state lives behind this boundary.
          SEAN-92: gif rows render the preset-chip wrapper instead of the
          plain ConverterPanel — the wrapper renders the chip row + customise
          disclosure below the panel and re-keys ConverterPanel on every
          arg change so chip clicks abort the in-flight upload and re-fire. */}
      <section className="mb-10" aria-label="Convert your file">
        {row.operation === 'gif' ? (
          <GifPresetPanel
            inputExt={formatToExt(row.inputFormats[0] ?? row.outputFormat)}
            goOp={row.goOp}
            outputExt={formatToExt(row.outputFormat)}
            accept={accept}
            acceptLabel={acceptLabel}
            reverseSlug={reverse?.slug}
            reverseLabel={reverse?.label}
            reverseOperation={reverse?.operation}
          />
        ) : (
          <ConverterPanel
            goOp={row.goOp}
            outputExt={formatToExt(row.outputFormat)}
            accept={accept}
            acceptLabel={acceptLabel}
            extraArgs={extraArgs}
            ffmpegCommand={row.ffmpegCommand}
            reverseSlug={reverse?.slug}
            reverseLabel={reverse?.label}
            reverseOperation={reverse?.operation}
          />
        )}
      </section>

      {/* SEAN-60 — "When to use this" paragraph. Renders directly under the
          converter so users who scroll past the drop zone hit the load-bearing
          context immediately. Content varies per (op, from, to) tuple. */}
      <section className="mb-10" aria-label="When to use this">
        <h2 className="mb-3 font-semibold text-gray-100 text-xl">
          When to use this
        </h2>
        <p className="text-gray-400 text-sm leading-relaxed">
          {copy.whenToUse}
        </p>
      </section>

      {/* Three sibling links — internal-link block per spec §7.2 */}
      {siblings.length > 0 && (
        <section className="mb-12" aria-label="Related conversions">
          <h2 className="mb-3 font-medium text-gray-300 text-sm uppercase tracking-wider">
            Related
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {siblings.map((s) => (
              <li key={s.slug}>
                <Link
                  href={s.href}
                  className={[
                    'flex h-full items-center justify-center rounded-xl',
                    'border border-gray-800 bg-gray-900/40 px-4 py-3',
                    'text-center font-medium text-gray-100 text-sm',
                    'transition-colors hover:border-indigo-500 hover:bg-gray-900/60',
                  ].join(' ')}
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* FAQ block */}
      <section className="mb-12">
        <FAQ faqs={row.faqs} />
      </section>

      {/* SEAN-60 — "Watch out for" / common pitfalls block. Same shape as
          the FAQ section but separated visually so the load-bearing
          gotchas don't get buried under standard FAQ entries. */}
      {copy.commonPitfalls.length > 0 && (
        <section className="mb-12">
          <FAQ faqs={copy.commonPitfalls} heading="Watch out for" />
        </section>
      )}

      {/* "How it works" block — extended with op/format-specific detail */}
      <HowItWorks row={row} extendedHowItWorks={copy.extendedHowItWorks} />
    </div>
  );
}

// ─────────────────────────────────────────────────────── HOW IT WORKS ────────

function HowItWorks({
  row,
  extendedHowItWorks,
}: {
  row: OperationRow;
  /**
   * SEAN-60 — per-row deep dive (~80-150 words). Renders between the
   * generic "drop a file / one-hour delete" paragraphs and the backend-op
   * tag so users get the format-specific detail without breaking the
   * canonical "how it works" frame.
   */
  extendedHowItWorks: string;
}) {
  // Per spec §7.2 the "how it works" block is intentionally tiny — wasm vs
  // server lane explanation + file deletion policy. Phase 6 will swap in the
  // wasm copy on rows that run client-side; until then everything is server.
  return (
    <section aria-label="How it works">
      <h2 className="mb-4 font-semibold text-gray-100 text-xl">How it works</h2>
      <div className="space-y-3 text-gray-400 text-sm leading-relaxed">
        <p>
          Drop a file. We run{' '}
          <code className="rounded bg-gray-900 px-1.5 py-0.5 text-gray-200">
            ffmpeg
          </code>{' '}
          on our server, hand you back the result, and delete both files one
          hour later.
        </p>
        <p>{extendedHowItWorks}</p>
        <p>
          The exact command we run is shown above with a copy button — paste it
          into your own terminal if you prefer to keep the file on your machine.
        </p>
        <p className="text-gray-500 text-xs">
          Backend operation:{' '}
          <code className="rounded bg-gray-900 px-1.5 py-0.5 text-gray-300">
            {row.goOp}
          </code>
          .
        </p>
      </div>
    </section>
  );
}

// Row → ConverterPanel-args mapping helpers live in `./converter-row-args.ts`
// so the homepage `<HeroDrop />` flow (SEAN-75) reuses the same logic.
