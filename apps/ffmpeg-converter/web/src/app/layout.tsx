import type { Metadata } from 'next';
import Link from 'next/link';
import { GROUPS, TOOLS } from '@/tools';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://seansconverter.com'),
  title: "Sean's Converter: free video, audio and image converter",
  description:
    'Convert video, audio and images online. Free, no sign-up, no watermark. Files are deleted after one hour.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
            <Link href="/" className="text-lg font-bold text-fg">
              Sean&apos;s Converter
            </Link>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="mt-16 border-t border-line bg-surface">
          <nav
            aria-label="All converters"
            className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-4 py-10 sm:px-6 md:grid-cols-4"
          >
            {GROUPS.map((group) => (
              <div key={group}>
                <h2 className="text-sm font-semibold text-fg">{group}</h2>
                <ul className="mt-3 space-y-2">
                  {TOOLS.filter((t) => t.group === group).map((t) => (
                    <li key={t.slug}>
                      <Link
                        href={`/${t.slug}`}
                        className="text-sm text-muted hover:text-fg hover:underline"
                      >
                        {t.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <p className="mx-auto max-w-5xl px-4 pb-10 text-sm text-muted sm:px-6">
            Your files go to our server for conversion. The server deletes them
            after one hour.
          </p>
        </footer>
      </body>
    </html>
  );
}
