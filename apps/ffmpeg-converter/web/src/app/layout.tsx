import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import './globals.css';

export const metadata: Metadata = {
  title: "Sean's Converter — Convert anything, instantly",
  description:
    'Free file converter for video, audio, and images. No watermark, no signup, no email gate. The ffmpeg command is shown for every job.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <header className="border-b border-gray-800">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link
              href="/"
              className="text-base font-bold tracking-tight text-gray-100 hover:text-white"
            >
              Sean&apos;s Converter
            </Link>
            <nav aria-label="Primary">
              <ul className="flex items-center gap-5 text-sm text-gray-400">
                <li>
                  <Link href="/pricing" className="hover:text-gray-100">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link href="/docs" className="hover:text-gray-100">
                    Docs
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <SiteFooter />
      </body>
    </html>
  );
}
