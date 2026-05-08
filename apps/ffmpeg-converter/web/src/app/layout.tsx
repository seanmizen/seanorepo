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
            {/* SEAN-82 — Pricing/Docs nav links removed until Phase 4 ships the
                real pages. The conversion funnel is the homepage drop-zone;
                routing users to placeholder pages is pure friction. Re-add a
                primary nav once /pricing and /docs have content worth visiting. */}
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <SiteFooter />
      </body>
    </html>
  );
}
