// Phase 4 placeholder. The real /pricing page (three columns: Free / Pro £10/mo
// / API metered, per phased-spec.md §"Phase 4") ships with the API tier. The
// header & footer Pricing nav links were removed in SEAN-82 — this stub now
// only covers direct/bookmarked URLs so they don't 404 until Phase 4 ships.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "Pricing — Sean's Converter",
  description:
    "Pricing for Sean's Converter — coming with the public API tier in Phase 4.",
};

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 pt-16 pb-20 text-center">
      <h1 className="text-balance text-4xl font-bold tracking-tight text-gray-100 md:text-5xl">
        Pricing
      </h1>
      <p className="mt-6 text-balance text-lg text-gray-400">
        The browser converter is — and stays — free. A Pro tier and a metered
        public API are coming with Phase 4. Until then, drop a file on the
        homepage and convert away.
      </p>
      <p className="mt-10">
        <Link
          href="/"
          className="text-sm text-gray-300 underline underline-offset-4 hover:text-white"
        >
          Back to home
        </Link>
      </p>
    </section>
  );
}
