// Site footer. Per spec §7.1: link to /llms.txt (file ships in Phase 5 — the
// link is a placeholder for now, signalling AEO confidence).

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
                // /llms.txt is a Phase 5 deliverable — the route doesn't exist
                // yet. We still render the link so the IA is set in stone.
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
