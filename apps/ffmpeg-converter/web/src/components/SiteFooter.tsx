// Site footer. Every link here MUST resolve — /pricing, /docs, /llms.txt all
// have placeholder routes until Phase 4/5 ship the real pages (see SEAN-51).
// Do not add a nav link here without first creating its route.
//
// SEAN-56 added the "Browse" row of hub-page links. Each one targets a hub
// page (`/convert`, `/compress`, etc.) that lists every variant of that
// operation as a card grid, helping Google discover the ≥200 generated tool
// pages quickly.

import Link from 'next/link';

const HUB_LINKS = [
  { href: '/convert', label: 'Convert' },
  { href: '/compress', label: 'Compress' },
  { href: '/extract-audio', label: 'Extract audio' },
  { href: '/trim', label: 'Trim' },
  { href: '/resize', label: 'Resize' },
  { href: '/gif', label: 'GIF' },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-gray-800 pt-8 pb-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 text-sm text-gray-500">
        <nav
          aria-label="Browse tools"
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 md:justify-start"
        >
          <span className="text-gray-400">Browse:</span>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {HUB_LINKS.map((link, i) => (
              <li key={link.href} className="flex items-center gap-x-3">
                <Link href={link.href} className="hover:text-gray-300">
                  {link.label}
                </Link>
                {i < HUB_LINKS.length - 1 ? (
                  <span aria-hidden="true" className="text-gray-700">
                    &middot;
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col items-center gap-4 md:flex-row md:justify-between">
          <p>Files auto-delete one hour after conversion.</p>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              <li>
                <Link
                  href="/llms.txt"
                  className="hover:text-gray-300"
                  prefetch={false}
                >
                  /llms.txt
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-gray-300">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/docs" className="hover:text-gray-300">
                  Docs
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/seanmizen/seanorepo"
                  className="hover:text-gray-300"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
