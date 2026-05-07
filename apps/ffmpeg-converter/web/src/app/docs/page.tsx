// Phase 4/5 placeholder. The real /docs surface — /docs/api (Phase 4) and
// /docs/mcp (Phase 5) — ships with the API tier and MCP server. This stub
// exists so the header & footer Docs link doesn't 404 in the meantime.
// Do NOT remove the route without also removing the nav links — see SEAN-51.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "Docs — Sean's Converter",
  description:
    "Developer docs for Sean's Converter — coming with the public API tier in Phase 4 and MCP server in Phase 5.",
};

export default function DocsPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 pt-16 pb-20 text-center">
      <h1 className="text-balance text-4xl font-bold tracking-tight text-gray-100 md:text-5xl">
        Docs
      </h1>
      <p className="mt-6 text-balance text-lg text-gray-400">
        The API reference and MCP server install guide are coming with the API
        tier in Phase 4. Until then, every tool page shows the exact ffmpeg
        command for the job — start there.
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
