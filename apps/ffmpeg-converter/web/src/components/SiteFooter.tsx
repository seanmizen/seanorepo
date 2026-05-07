// Site footer. Every link here MUST resolve — /pricing, /docs, /llms.txt all
// have placeholder routes until Phase 4/5 ship the real pages (see SEAN-51).
// Do not add a nav link here without first creating its route.

import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-gray-800 pt-8 pb-12">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 text-sm text-gray-500 md:flex-row md:justify-between">
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
    </footer>
  );
}
